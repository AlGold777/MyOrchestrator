const Executor = require('../disput/debate-stage-executor');

const makeExecutor = (behavior, options = {}) => {
  const calls = [];
  const adapter = {
    type: 'llm',
    async dispatch({ participant, attempt, prompt }) {
      calls.push({ participantId: participant.participantId, attempt, prompt });
      return behavior({ participant, attempt, prompt });
    }
  };
  const adapters = Executor.createAdapterRegistry({ llm: adapter, human: Executor.createHumanAdapter() });
  const events = [];
  const executor = Executor.createStageExecutor({
    adapters,
    acceptResponse: options.acceptResponse || ((text) => ({ ok: Boolean(String(text || '').trim()), reason: 'empty_response' })),
    repairPrompt: options.repairPrompt,
    extractArtifacts: options.extractArtifacts || (() => [{ id: 'a1' }]),
    proposeStateDelta: options.proposeStateDelta || (({ participant }) => ({ by: participant.participantId })),
    retryPolicy: options.retryPolicy || { maxAttempts: 2, delayMs: 0 },
    emit: (type, payload) => events.push({ type, payload }),
    ...options.executorOptions
  });
  return { executor, calls, events };
};

const stage = (overrides = {}) => ({
  runId: 'run-1', stageInstanceId: 'stage-1', purpose: 'verification',
  participants: [{ participantId: 'alpha', type: 'llm' }, { participantId: 'beta', type: 'llm' }],
  dispatchMode: 'parallel', completionMode: 'all', ...overrides
});

describe('StageExecutor — dispatch and completion modes', () => {
  test('parallel dispatch, all completed', async () => {
    const { executor } = makeExecutor(({ participant }) => ({ status: 'received', text: `answer:${participant.participantId}` }));
    const result = await executor.execute(stage());
    expect(result.executionStatus).toBe('completed');
    expect(result.acceptedResponses).toHaveLength(2);
    expect(result.proposedStateDeltas).toHaveLength(2);
  });

  test('all mode with one failure yields partial (degraded continuation)', async () => {
    const { executor } = makeExecutor(({ participant }) => ({ status: 'received', text: participant.participantId === 'alpha' ? 'good' : '' }));
    const result = await executor.execute(stage());
    expect(result.executionStatus).toBe('partial');
    expect(result.failedParticipants).toEqual(['beta']);
  });

  test('quorum mode completes when quorum reached', async () => {
    const { executor } = makeExecutor(({ participant }) => ({ status: 'received', text: participant.participantId === 'alpha' ? 'good' : '' }));
    const result = await executor.execute(stage({ completionMode: 'quorum', quorumSize: 1 }));
    expect(result.executionStatus).toBe('completed');
  });

  test('first_success stops sequential dispatch after first accepted answer', async () => {
    const { executor, calls } = makeExecutor(() => ({ status: 'received', text: 'ok' }));
    const result = await executor.execute(stage({ dispatchMode: 'sequential', completionMode: 'first_success' }));
    expect(result.executionStatus).toBe('completed');
    expect(calls).toHaveLength(1);
  });

  test('sequential dispatch preserves participant order', async () => {
    const { executor, calls } = makeExecutor(() => ({ status: 'received', text: 'ok' }));
    await executor.execute(stage({ dispatchMode: 'sequential' }));
    expect(calls.map((c) => c.participantId)).toEqual(['alpha', 'beta']);
  });

  test('parallel LLM participants use one native batch dispatch', async () => {
    const runModelBatch = jest.fn(async ({ models, promptsByModel }) => ({
      responses: Object.fromEntries(models.map((model) => [model, `answer:${model}:${promptsByModel[model]}`])), failed: {}
    }));
    const executor = Executor.createStageExecutor({
      adapters: Executor.createAdapterRegistry({ llm: Executor.createLlmAdapter({ runModelBatch }) }),
      compilePrompt: ({ participant }) => `prompt:${participant.participantId}`,
      retryPolicy: { maxAttempts: 2, delayMs: 0 }
    });
    const result = await executor.execute(stage());
    expect(result.executionStatus).toBe('completed');
    expect(runModelBatch).toHaveBeenCalledTimes(1);
    expect(runModelBatch.mock.calls[0][0]).toMatchObject({
      models: ['alpha', 'beta'], promptsByModel: { alpha: 'prompt:alpha', beta: 'prompt:beta' }
    });
  });

  test('native batch releases the barrier with accepted peers and canonical terminal failure', async () => {
    const runModelBatch = jest.fn(async () => ({ responses: { alpha: 'good' }, failed: { beta: 'TIMEOUT' } }));
    const executor = Executor.createStageExecutor({
      adapters: Executor.createAdapterRegistry({ llm: Executor.createLlmAdapter({ runModelBatch }) }),
      retryPolicy: { maxAttempts: 3, delayMs: 0 }
    });
    const result = await executor.execute(stage());
    expect(result.executionStatus).toBe('partial');
    expect(result.acceptedResponses.map((entry) => entry.participantId)).toEqual(['alpha']);
    expect(result.terminalFailures).toEqual([expect.objectContaining({ participantId: 'beta', reasonCode: 'TIMEOUT' })]);
    expect(runModelBatch).toHaveBeenCalledTimes(1);
  });
});

describe('StageExecutor — retry, repair, idempotency, cancellation', () => {
  test('retries until acceptance within retry policy', async () => {
    let attempts = 0;
    const { executor } = makeExecutor(() => { attempts += 1; return { status: 'received', text: attempts >= 2 ? 'ok' : '' }; });
    const result = await executor.execute(stage({ participants: [{ participantId: 'alpha', type: 'llm' }], dispatchMode: 'single' }));
    expect(result.executionStatus).toBe('completed');
    expect(result.attempts[0].attempts).toBe(2);
  });

  test('repair prompt is dispatched on contract violation and can rescue the attempt', async () => {
    const { executor, events } = makeExecutor(
      ({ prompt }) => ({ status: 'received', text: prompt.startsWith('REPAIR') ? 'valid full answer' : 'broken' }),
      {
        acceptResponse: (text) => ({ ok: text === 'valid full answer', reason: 'missing_sections' }),
        repairPrompt: () => 'REPAIR: add required sections'
      }
    );
    const result = await executor.execute(stage({ participants: [{ participantId: 'alpha', type: 'llm' }], dispatchMode: 'single' }));
    expect(result.executionStatus).toBe('completed');
    expect(events.some((e) => e.type === 'RESPONSE_CONTRACT_REPAIR')).toBe(true);
  });

  test('idempotency key format is stable', () => {
    expect(Executor.idempotencyKey({ runId: 'r', stageInstanceId: 's' }, 2, 'alpha')).toBe('r:s:2:alpha');
  });

  test('abort signal yields cancelled result', async () => {
    const controller = new AbortController();
    controller.abort();
    const { executor } = makeExecutor(() => ({ status: 'received', text: 'ok' }));
    const result = await executor.execute(stage(), { signal: controller.signal });
    expect(result.executionStatus).toBe('cancelled');
  });

  test('failure after exhausted retries reports failed with reason', async () => {
    const { executor } = makeExecutor(() => { throw new Error('transport_down'); });
    const result = await executor.execute(stage({ participants: [{ participantId: 'alpha', type: 'llm' }], dispatchMode: 'single' }));
    expect(result.executionStatus).toBe('failed');
    expect(result.attempts[0].reason).toBe('transport_down');
  });

  test('terminal transport failure is not repaired or retried and is reported canonically', async () => {
    const runModelBatch = jest.fn().mockResolvedValue({ responses: {}, failed: { alpha: 'NO_SEND' } });
    const adapter = Executor.createLlmAdapter({ runModelBatch });
    const executor = Executor.createStageExecutor({
      adapters: Executor.createAdapterRegistry({ llm: adapter }),
      repairPrompt: jest.fn(() => 'repair'),
      retryPolicy: { maxAttempts: 3, delayMs: 0 }
    });
    const result = await executor.execute(stage({ participants: [{ participantId: 'alpha', model: 'alpha', type: 'llm' }], dispatchMode: 'single' }));
    expect(result.executionStatus).toBe('failed');
    expect(runModelBatch).toHaveBeenCalledTimes(1);
    expect(result.terminalFailures).toEqual([expect.objectContaining({
      participantId: 'alpha', terminal: true, reasonCode: 'NO_SEND', stageId: 'stage-1'
    })]);
  });
});

describe('StageExecutor — human participant adapter', () => {
  test('human participant leaves stage awaiting_participant (Slice F)', async () => {
    const { executor, events } = makeExecutor(() => ({ status: 'received', text: 'ok' }));
    const result = await executor.execute(stage({
      participants: [{ participantId: 'human:owner', type: 'human' }], dispatchMode: 'single'
    }));
    expect(result.executionStatus).toBe('awaiting_participant');
    expect(result.awaitingParticipants).toEqual(['human:owner']);
    expect(events.some((e) => e.type === 'PARTICIPANT_TASK_ASSIGNED')).toBe(true);
  });

  test('missing adapter type fails the participant, not the process', async () => {
    const { executor } = makeExecutor(() => ({ status: 'received', text: 'ok' }));
    const result = await executor.execute(stage({ participants: [{ participantId: 'tool-1', type: 'tool' }], dispatchMode: 'single' }));
    expect(result.executionStatus).toBe('failed');
    expect(result.attempts[0].reason).toMatch(/adapter_missing/);
  });
});

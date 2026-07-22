// Barrier settlement after terminal participant failure (2 SUCCESS + 1 FAILED
// must not freeze the run): dropout handling in the FreeTalk opening stage.
const Runtime = require('../disput/free-talk-runtime');
global.FreeTalkRuntime = Runtime;
const Protocol = require('../disput/free-talk-protocol');
const Runner = require('../disput/free-talk-runner');

const makeDeps = (overrides = {}) => {
  const batches = [];
  const stageEvents = [];
  const notifications = [];
  let protocolState;
  const deps = {
    protocol: Protocol,
    createRegistry: () => ({ artifacts: {} }),
    resolveServiceRoles: ({ synthesizer }) => ({ synthesizer, auditor: '' }),
    acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()) && !String(text).startsWith('Error:') }),
    transition: (state, event) => Protocol.reduce(state, event),
    replaceAggregateState: (state) => { protocolState = state; },
    syncState: (state) => { protocolState = state; },
    appendModerator: jest.fn(), clearModerator: jest.fn(), setRunPresentation: jest.fn(), renderCards: jest.fn(),
    // C is terminally failed: settled with an error, never a usable answer.
    runModelBatch: async ({ models, context }) => {
      const stage = context?.pipelineStageId || '';
      batches.push({ models: models.slice(), stage });
      return {
        responses: Object.fromEntries(models.map((model) => [model, model === 'C' ? '' : (stage === 'final:synthesis' ? 'Final synthesis' : `Position ${model}`)])),
        missing: models.includes('C') ? ['C'] : [],
        failed: models.includes('C') ? { C: 'ERROR' } : {},
        timedOut: false
      };
    },
    appendFeed: jest.fn(), appendVerdict: jest.fn(),
    runCheckpoint: () => null,
    projectStateMap: () => ({ runId: 'ft-1', claims: [], objections: [], blockers: [], evidence: [], revisions: [], dissent: [], readiness: { id: 'ready', label: 'Ready' }, stats: {} }),
    planNext: Runtime.plan, settleTask: Runtime.settle, confirmTask: Runtime.confirm,
    buildFinalSynthesisPrompt: () => 'Synthesize',
    recordStageEvent: (type, payload) => stageEvents.push({ type, ...payload }),
    notify: (message, level) => notifications.push({ message, level }),
    notifyControl: jest.fn(), recordFinalization: jest.fn(), handleTerminalOutputs: jest.fn(), finalizeRuntime: jest.fn(),
    recordRunFailure: jest.fn(),
    ...overrides
  };
  return { deps, batches, stageEvents, notifications, getProtocolState: () => protocolState };
};

const startInput = (overrides = {}) => ({
  runId: 'ft-1', runContext: { pipelineRunId: 'ft-1', sessionId: 's1' },
  pipelineNameText: 'Question', moderatorEntryText: 'Question',
  selectedModels: ['A', 'B', 'C'], synthesizer: 'A',
  presetConfig: { presetId: 'FREE_TALK_MVP', resourceBudget: { limit: 10, reserved: 1 } },
  ...overrides
});

describe('FreeTalk opening barrier — participant dropout', () => {
  test('2 of 3 answered → run continues degraded without the failed model, with dropout events and user notice', async () => {
    const { deps, batches, stageEvents, notifications } = makeDeps();
    const started = await Runner.createFreeTalkRunner(deps).start(startInput());
    expect(started).toBe(true); // run finishes, does not stay in `running`
    // Dropout is recorded.
    expect(stageEvents.some((e) => e.type === 'BARRIER_PARTICIPANT_FAILED' && e.model === 'C')).toBe(true);
    expect(stageEvents.some((e) => e.type === 'DROPOUT_DECISION_REQUESTED')).toBe(true);
    expect(stageEvents.some((e) => e.type === 'DROPOUT_CONTINUE_SELECTED')).toBe(true);
    // User sees the degraded-continuation notice.
    expect(notifications.some((n) => n.message.includes('C') && n.message.includes('Продолжаем'))).toBe(true);
    // No dispatch after the opening includes the dead participant.
    const afterOpening = batches.slice(1);
    expect(afterOpening.length).toBeGreaterThan(0);
    afterOpening.forEach((batch) => expect(batch.models).not.toContain('C'));
  });

  test('failurePolicy fail_run stops the run instead of waiting', async () => {
    const { deps } = makeDeps({
      stageById: (plan, stageId) => stageId === 'free-talk:positions' ? { failurePolicy: 'fail_run' } : null
    });
    const started = await Runner.createFreeTalkRunner(deps).start(startInput());
    expect(started).toBe(false);
    expect(deps.notifyControl).toHaveBeenCalledWith('CANCELLED', expect.objectContaining({ reason: 'participant_dropout_user_stop' }));
  });

  test('ask_user with an explicit stop decision cancels the run', async () => {
    const { deps } = makeDeps({ resolveParticipantDropout: async () => 'stop' });
    const started = await Runner.createFreeTalkRunner(deps).start(startInput());
    expect(started).toBe(false);
    expect(deps.recordRunFailure).toHaveBeenCalledWith('participant_dropout_user_stop:positions');
  });

  test('ask_user retry decision restarts the opening stage', async () => {
    let calls = 0;
    const { deps, batches } = makeDeps({
      resolveParticipantDropout: async () => { calls += 1; return calls === 1 ? 'retry' : 'continue'; }
    });
    const started = await Runner.createFreeTalkRunner(deps).start(startInput());
    expect(started).toBe(true);
    // Opening dispatched twice (retry), both times to the full participant set.
    const openings = batches.filter((batch) => batch.stage === 'free-talk:positions');
    expect(openings).toHaveLength(2);
  });

  test('repair is not dispatched to terminally failed participants', async () => {
    const { deps, batches } = makeDeps();
    await Runner.createFreeTalkRunner(deps).start(startInput());
    const repairBatches = batches.filter((batch) => batch.stage.includes(':repair'));
    repairBatches.forEach((batch) => expect(batch.models).not.toContain('C'));
  });

  test('all participants failed still throws (no silent empty run)', async () => {
    const { deps } = makeDeps({
      runModelBatch: async ({ models }) => ({ responses: Object.fromEntries(models.map((m) => [m, ''])), missing: models, failed: Object.fromEntries(models.map((m) => [m, 'ERROR'])), timedOut: false })
    });
    await expect(Runner.createFreeTalkRunner(deps).start(startInput())).rejects.toThrow('no usable responses');
  });
});

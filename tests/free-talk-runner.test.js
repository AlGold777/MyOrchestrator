const Runtime = require('../disput/free-talk-runtime');
global.FreeTalkRuntime = Runtime;
const Protocol = require('../disput/free-talk-protocol');
const Runner = require('../disput/free-talk-runner');

describe('FreeTalk runner', () => {
  test('runs blind positions and readiness-driven synthesis without a round limit', async () => {
    const batches = []; const checkpoints = []; const verdicts = []; const finalizations = []; let protocolState;
    let projectionCount = 0;
    const runner = Runner.createFreeTalkRunner({
      protocol: Protocol,
      createRegistry: () => ({ artifacts: {} }),
      resolveServiceRoles: ({ synthesizer }) => ({ synthesizer, auditor: 'B' }),
      acceptResponse: (text) => ({ ok: Boolean(text) }),
      transition: (state, event) => Protocol.reduce(state, event),
      replaceAggregateState: (state) => { protocolState = state; },
      syncState: (state) => { protocolState = state; },
      appendModerator: jest.fn(), clearModerator: jest.fn(), setRunPresentation: jest.fn(), renderCards: jest.fn(),
      runModelBatch: async ({ models, pipelineStageId, context }) => {
        const stage = pipelineStageId || context?.pipelineStageId || '';
        batches.push({ models, stage });
        return { responses: Object.fromEntries(models.map((model) => [model, stage === 'final:synthesis' ? 'Final synthesis' : `Position ${model}`])) };
      },
      appendFeed: jest.fn(), appendVerdict: (text) => verdicts.push(text),
      runCheckpoint: (state, input) => { checkpoints.push({ synthesizer: state.synthesizer, input }); return null; },
      projectStateMap: () => {
        projectionCount += 1;
        if (projectionCount === 1) return {
          runId: 'ft-1', claims: [], objections: [{ id: 'o1', status: 'raised' }], blockers: [{ id: 'o1', status: 'raised' }],
          evidence: [{ id: 'e1', status: 'supported', tier: 'model_argument' }], revisions: [], dissent: [], readiness: { id: 'not_ready', label: 'Not ready' }, stats: {}
        };
        return { runId: 'ft-1', claims: [], objections: [], blockers: [], evidence: [], revisions: [], dissent: [], readiness: { id: 'ready', label: 'Ready' }, stats: {} };
      },
      planNext: Runtime.plan, settleTask: Runtime.settle, confirmTask: Runtime.confirm,
      buildFinalSynthesisPrompt: () => 'Synthesize', recordStageEvent: jest.fn(), notifyControl: jest.fn(),
      recordFinalization: (payload) => finalizations.push(payload), handleTerminalOutputs: jest.fn(), finalizeRuntime: jest.fn()
    });
    const started = await runner.start({
      runId: 'ft-1', runContext: { pipelineRunId: 'ft-1', sessionId: 's1' }, pipelineNameText: 'Question', moderatorEntryText: 'Question',
      selectedModels: ['A', 'B', 'C'], synthesizer: 'A', presetConfig: { presetId: 'FREE_TALK_MVP', resourceBudget: { limit: 10, reserved: 1 } }
    });
    expect(started).toBe(true);
    expect(batches[0].models).toEqual(['A', 'B', 'C']);
    expect(batches[1].models).toHaveLength(2);
    expect(new Set(batches[1].models).size).toBe(2);
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints.every((checkpoint) => checkpoint.synthesizer === 'A')).toBe(true);
    expect(batches.at(-1).models).toEqual(['A']);
    expect(verdicts).toEqual(['Final synthesis']);
    expect(finalizations[0]).toMatchObject({ synthesis: true, epistemicOutcome: 'resolved' });
    expect(protocolState.status).toBe('completed');
  });

  test('requires at least one selected model and has no maximum', async () => {
    const notify = jest.fn();
    const runner = Runner.createFreeTalkRunner({ protocol: Protocol, notify });
    expect(await runner.start({ selectedModels: [] })).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('хотя бы одну'), 'warn');
  });

  test('terminal mid-run failure removes the participant from all later dispatch', async () => {
    const batches = [];
    const events = [];
    let protocolState;
    let planned = false;
    const task = { id: 'task-1', action: 'verify_claim', role: 'verifier', reason: 'verify', triggerId: 'VERIFY', expectedArtifactTypes: [] };
    const runner = Runner.createFreeTalkRunner({
      protocol: Protocol,
      createRegistry: () => ({ artifacts: {} }),
      resolveServiceRoles: ({ synthesizer }) => ({ synthesizer, auditor: '' }),
      acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()) }),
      transition: (state, event) => Protocol.reduce(state, event),
      replaceAggregateState: (state) => { protocolState = state; },
      syncState: (state) => { protocolState = state; },
      appendModerator: jest.fn(), clearModerator: jest.fn(), setRunPresentation: jest.fn(), renderCards: jest.fn(),
      chooseModel: () => ({ model: 'B', degraded: false }),
      runModelBatch: async ({ models, context }) => {
        const stage = context?.pipelineStageId || '';
        batches.push({ models: models.slice(), stage });
        if (stage === 'free-talk:dynamic-batch') {
          return { responses: { B: '' }, missing: ['B'], failed: { B: 'ERROR' }, timedOut: false };
        }
        return { responses: Object.fromEntries(models.map((model) => [model, stage === 'final:synthesis' ? 'Final synthesis' : `Position ${model}`])), missing: [], failed: {} };
      },
      appendFeed: jest.fn(), appendVerdict: jest.fn(), runCheckpoint: () => null,
      projectStateMap: () => ({ claims: [], objections: [], blockers: [], evidence: [], revisions: [], dissent: [], readiness: { id: 'ready' }, stats: {} }),
      planNext: (_map, state) => {
        if (!planned) { planned = true; return { state, next: task, batch: [task], blockedByBudget: false }; }
        return { state: { ...state, forceSynthesis: true }, next: null, batch: [], blockedByBudget: false };
      },
      settleTask: (state) => ({ ...state, forceSynthesis: true }),
      confirmTask: (state) => state,
      buildFinalSynthesisPrompt: () => 'Synthesize',
      recordStageEvent: (type, payload) => events.push({ type, ...payload }),
      notify: jest.fn(), notifyControl: jest.fn(), recordFinalization: jest.fn(), handleTerminalOutputs: jest.fn(), finalizeRuntime: jest.fn()
    });

    const started = await runner.start({
      runId: 'ft-mid-drop', runContext: { pipelineRunId: 'ft-mid-drop', sessionId: 's1' },
      pipelineNameText: 'Question', moderatorEntryText: 'Question', selectedModels: ['A', 'B'], synthesizer: 'A',
      presetConfig: { presetId: 'FREE_TALK_MVP', runPolicy: 'auto', resourceBudget: { limit: 10, reserved: 1 } }
    });

    expect(started).toBe(true);
    expect(protocolState.configuredParticipants).toEqual(['A', 'B']);
    expect(protocolState.activeParticipants).toEqual(['A']);
    expect(protocolState.droppedParticipants).toEqual([expect.objectContaining({ modelId: 'B', terminal: true, stageId: 'free-talk:trigger-loop' })]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'BARRIER_PARTICIPANT_FAILED', model: 'B', terminal: true }),
      expect.objectContaining({ type: 'DROPOUT_CONTINUE_SELECTED', failedModels: ['B'] })
    ]));
    batches.slice(batches.findIndex((batch) => batch.stage === 'free-talk:dynamic-batch') + 1)
      .forEach((batch) => expect(batch.models).not.toContain('B'));
  });

  test('acceptance failure without terminal transport evidence keeps participant active', async () => {
    const events = [];
    let protocolState;
    let planned = false;
    const task = { id: 'task-invalid', action: 'verify_claim', role: 'verifier', reason: 'verify', triggerId: 'VERIFY', expectedArtifactTypes: [] };
    const runner = Runner.createFreeTalkRunner({
      protocol: Protocol,
      createRegistry: () => ({ artifacts: {} }),
      resolveServiceRoles: ({ synthesizer }) => ({ synthesizer, auditor: '' }),
      acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()) }),
      transition: (state, event) => Protocol.reduce(state, event),
      replaceAggregateState: (state) => { protocolState = state; },
      syncState: (state) => { protocolState = state; },
      appendModerator: jest.fn(), clearModerator: jest.fn(), setRunPresentation: jest.fn(), renderCards: jest.fn(),
      chooseModel: () => ({ model: 'B', degraded: false }),
      runModelBatch: async ({ models, context }) => ({
        responses: Object.fromEntries(models.map((model) => [model, context?.pipelineStageId === 'free-talk:dynamic-batch' ? '' : (context?.pipelineStageId === 'final:synthesis' ? 'Final synthesis' : `Position ${model}`)])),
        missing: [], failed: {}
      }),
      appendFeed: jest.fn(), appendVerdict: jest.fn(), runCheckpoint: () => null,
      projectStateMap: () => ({ claims: [], objections: [], blockers: [], evidence: [], revisions: [], dissent: [], readiness: { id: 'ready' }, stats: {} }),
      planNext: (_map, state) => {
        if (!planned) { planned = true; return { state, next: task, batch: [task], blockedByBudget: false }; }
        return { state: { ...state, forceSynthesis: true }, next: null, batch: [], blockedByBudget: false };
      },
      settleTask: (state) => ({ ...state, forceSynthesis: true }),
      confirmTask: (state) => state,
      buildFinalSynthesisPrompt: () => 'Synthesize', recordStageEvent: (type, payload) => events.push({ type, ...payload }),
      notifyControl: jest.fn(), recordFinalization: jest.fn(), handleTerminalOutputs: jest.fn(), finalizeRuntime: jest.fn()
    });

    await runner.start({
      runId: 'ft-invalid', runContext: { pipelineRunId: 'ft-invalid', sessionId: 's1' }, pipelineNameText: 'Question', moderatorEntryText: 'Question',
      selectedModels: ['A', 'B'], synthesizer: 'B', presetConfig: { presetId: 'FREE_TALK_MVP', runPolicy: 'auto', resourceBudget: { limit: 10, reserved: 1 } }
    });
    expect(protocolState.activeParticipants).toEqual(['A', 'B']);
    expect(protocolState.droppedParticipants).toEqual([]);
    expect(events.filter((event) => event.type === 'BARRIER_PARTICIPANT_FAILED')).toHaveLength(0);
  });
});

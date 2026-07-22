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
});

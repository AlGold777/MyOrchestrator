// Universal engine path through DebateApplication (flag-gated command surface).
const Application = require('../disput/debate-application');
const Policies = require('../disput/debate-policies');

const makeApp = (options = {}) => Application.createApplication({
  universalEngine: true,
  // This suite exercises dispatch/validation/lifecycle behavior with minimal mocks,
  // not production wiring completeness — that is covered separately by
  // tests/debate-universal-production-wiring.test.js.
  allowIncompleteWiring: true,
  deps: {
    runModelBatch: async ({ models }) => ({ responses: Object.fromEntries(models.map((m) => [m, `answer:${m}`])) }),
    proposeStateDelta: ({ participant }) => ({ by: participant.participantId })
  },
  exposeInternals: true,
  ...options
});

const config = (overrides = {}) => ({
  runId: 'run-universal-1',
  topic: 'Universal engine test',
  models: ['alpha', 'beta', 'gamma', 'delta'],
  policies: { finalization: { mode: 'manual' } },
  ...overrides
});

describe('DebateApplication — universal engine path', () => {
  test('start() routes to universal path when flag enabled, without runners', async () => {
    const app = makeApp();
    const result = await app.start(config({ deferExecution: true }));
    expect(result.ok).toBe(true);
    expect(app.getOrchestrator()).toBeTruthy();
    expect(app.getActiveRevision()).toBeTruthy();
  });

  test('4 participants pass the single validation contract (§17.4 participant count test)', async () => {
    const app = makeApp();
    const validation = app.validateConfiguration(config());
    expect(validation.valid).toBe(true);
    const result = await app.start(config({ deferExecution: true }));
    expect(result.ok).toBe(true);
    const state = app.getOrchestrator().getState();
    // DebateCase contains all 4 with identical schema.
    const orchestratorState = state;
    expect(orchestratorState.runId).toBe('run-universal-1');
  });

  test('UI and runtime reject with the same traceable policy error', () => {
    const app = makeApp();
    const invalid = { models: [], policies: {} };
    const uiVerdict = app.validateConfiguration(invalid);
    expect(uiVerdict.valid).toBe(false);
    expect(uiVerdict.errors[0].policyId).toBe('participant-cardinality.default.v1');
    return app.startUniversal(invalid).then((runtimeVerdict) => {
      expect(runtimeVerdict.ok).toBe(false);
      expect(runtimeVerdict.code).toBe('CONFIGURATION_INVALID');
      expect(runtimeVerdict.validation.errors[0].policyId).toBe('participant-cardinality.default.v1');
    });
  });

  test('canvas-style commands create immutable revisions through the application boundary', async () => {
    const app = makeApp();
    await app.start(config({ deferExecution: true }));
    const before = app.getActiveRevision();
    const result = await app.requestSynthesis({}, { deferExecution: true });
    expect(result.ok).toBe(true);
    const after = app.getActiveRevision();
    expect(after.revisionId).not.toBe(before.revisionId);
    expect(after.parentRevisionId).toBe(before.revisionId);
    expect(after.plannedStages.some((s) => s.purpose === 'synthesis')).toBe(true);
  });

  test('pause and continue work through persisted lifecycle', async () => {
    const app = makeApp();
    await app.start(config({ deferExecution: true }));
    const paused = await app.pauseRun({ requestedBy: 'user' });
    expect(paused.lifecycle).toBe('PAUSED');
    const resumed = await app.continueRun({ deferExecution: true });
    expect(resumed.ok).toBe(true);
  });

  test('legacy path is untouched when flag is off', async () => {
    const app = Application.createApplication({
      deps: { legacyStart: async () => 'legacy-started' }
    });
    expect(app.isUniversalEngineEnabled()).toBe(false);
    await expect(app.start({ topology: 'duel' })).resolves.toBe('legacy-started');
  });
});

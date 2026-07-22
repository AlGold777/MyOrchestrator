const RunStore = require('../disput/debate-run-store');
const DebateApplication = require('../disput/debate-application');
const ArtifactPipeline = require('../disput/debate-artifact-pipeline');

const makeApplication = () => {
  const store = RunStore.createStore();
  const application = DebateApplication.createApplication({
    store,
    deps: {
      runModelBatch: async ({ models }) => ({
        responses: Object.fromEntries(models.map((model) => [model, `answer:${model}`])), failed: {}
      }),
      acceptResponse: (value) => ({ ok: Boolean(String(value || '').trim()), reason: '' }),
      compilePrompt: ({ stage, participant }) => `${stage.purpose}:${participant.participantId}`,
      extractArtifacts: ArtifactPipeline.extractArtifacts,
      proposeStateDelta: ArtifactPipeline.proposeStateDelta,
      commitStateDelta: ArtifactPipeline.commitStateDelta,
      projectStateMap: ArtifactPipeline.projectStateMap
    }
  });
  return { application, store };
};

const config = (overrides = {}) => ({
  runId: 'run-1', sessionId: 'session-1', topic: 'Universal lifecycle',
  models: ['alpha', 'beta'], deferExecution: true, ...overrides
});

describe('DebateApplication — universal lifecycle bridge', () => {
  test('starts one universal aggregate and ignores obsolete topology input', async () => {
    const { application, store } = makeApplication();
    await expect(application.start(config({ topology: 'duel' }))).resolves.toMatchObject({ ok: true, runId: 'run-1' });
    expect(store.getState()).toMatchObject({
      runId: 'run-1', sessionId: 'session-1', topology: 'universal', status: 'running'
    });
  });

  test('page entry point remains a UI adapter, not a legacy execution path', async () => {
    const startFromPage = jest.fn().mockResolvedValue(true);
    const application = DebateApplication.createApplication({
      allowIncompleteWiring: true, deps: { startFromPage }
    });
    await application.startFromPage('from-ui');
    expect(startFromPage).toHaveBeenCalledWith('from-ui');
  });

  test('pause, resume, and cancellation are owned by the universal orchestrator', async () => {
    const { application, store } = makeApplication();
    await application.start(config());
    await expect(application.pause()).resolves.toMatchObject({ lifecycle: 'PAUSED' });
    await expect(application.resume()).resolves.toMatchObject({ lifecycle: 'RUNNING' });
    await application.cancel('user_cancel');
    expect(application.getOrchestrator().getState().lifecycle).toBe('CANCELLED');
    expect(store.getState().status).toBe('cancelled');
  });

  test('orchestrator stage events are projected into the UI aggregate', async () => {
    const { application, store } = makeApplication();
    await application.start(config({ deferExecution: false, maxSteps: 1 }));
    expect(store.getState().events.some((item) => item.type === RunStore.EVENTS.STAGE_STARTED)).toBe(true);
    expect(store.getState().events.some((item) => item.type === RunStore.EVENTS.STAGE_COMPLETED)).toBe(true);
  });
});

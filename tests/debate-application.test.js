const RunStore = require('../disput/debate-run-store');
const DebateApplication = require('../disput/debate-application');

describe('DebateApplication', () => {
  const duelInput = (extra = {}) => ({
    topology: 'duel',
    scenario: { ok: true, modelA: 'GPT', modelB: 'Claude' },
    selectedModels: ['GPT', 'Claude'],
    synthesizer: 'GPT',
    presetConfig: { presetId: 'DUEL_STANDARD', topology: 'duel', runPolicy: 'auto', roundLimit: 1, roundPlan: [] },
    ...extra
  });

  test('selects a topology runner and starts the canonical aggregate', async () => {
    const store = RunStore.createStore();
    const runner = { start: jest.fn().mockResolvedValue('done') };
    const application = DebateApplication.createApplication({
      store,
      runners: { duel: runner },
      deps: { createId: () => 'run-1' }
    });
    await expect(application.start(duelInput({ sessionId: 'session-1' }))).resolves.toBe('done');
    expect(runner.start).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', topology: 'duel', store, auto: true }));
    expect(store.getState()).toMatchObject({
      runId: 'run-1', sessionId: 'session-1', topology: 'duel', status: 'running',
      executionPlan: { runPolicy: 'auto', participants: ['GPT', 'Claude'] }
    });
  });

  test('keeps the page compatibility entry point behind one dependency', async () => {
    const legacyStart = jest.fn().mockResolvedValue(true);
    const application = DebateApplication.createApplication({ deps: { legacyStart } });
    await application.startFromPage('from-ui');
    expect(legacyStart).toHaveBeenCalledWith('from-ui');
  });

  test('ignores stale cancellation after a runner already completed', async () => {
    const store = RunStore.createStore();
    const runner = {
      start: jest.fn(({ store: activeStore }) => {
        activeStore.dispatch({ type: RunStore.EVENTS.FINALIZATION_COMPLETED });
      }),
      cancel: jest.fn()
    };
    const application = DebateApplication.createApplication({ store, runners: { duel: runner } });
    await application.start(duelInput({ runId: 'run-1' }));
    await application.cancel('late');
    expect(store.getState().status).toBe('completed');
  });

  test('runner failure closes both protocol and aggregate state', async () => {
    const store = RunStore.createStore();
    const protocol = {
      createState: () => ({ active: true, status: 'running' }),
      reduce: (state, event) => event.type === 'FAILED'
        ? { ...state, active: false, status: 'error', stopReason: event.payload.reason }
        : state
    };
    const application = DebateApplication.createApplication({
      store,
      protocols: { topologyOf: () => 'duel', getProtocol: () => protocol },
      runners: { duel: { start: jest.fn().mockRejectedValue(new Error('runner_failed')) } }
    });
    await expect(application.start(duelInput({ runId: 'run-fail', protocolState: protocol.createState() })))
      .rejects.toThrow('runner_failed');
    expect(store.getState()).toMatchObject({
      status: 'error',
      protocolState: { active: false, status: 'error', stopReason: 'runner_failed' }
    });
  });
});

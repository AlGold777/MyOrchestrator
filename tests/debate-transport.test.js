const RunStore = require('../disput/debate-run-store');
global.DebateRunStore = RunStore;
const DebateTransport = require('../results/debate-transport');

describe('DebateTransport', () => {
  test('maps the transport port to extension messages and persists aggregate', async () => {
    const messages = [];
    const runtime = { sendMessage: (message, callback) => { messages.push(message); callback({ status: 'process_started' }); } };
    const memory = {};
    const storage = {
      set: async (payload) => Object.assign(memory, payload),
      get: async (key) => ({ [key]: memory[key] }),
      remove: async (key) => { delete memory[key]; }
    };
    const store = RunStore.createStore();
    const port = DebateTransport.create({ runtime, storage, runStore: store });
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r1' } });
    await port.persist();
    await port.dispatchBatch({ prompt: 'p', models: ['GPT'], pipelineContext: { pipelineRunId: 'r1' } });
    expect(messages[0]).toMatchObject({ type: 'START_FULLPAGE_PROCESS', selectedLLMs: ['GPT'] });
    expect((await port.recoverRun()).runId).toBe('r1');
    await port.cancelRun('r1');
    expect(messages[1]).toEqual({ type: 'CANCEL_PIPELINE_RUN', pipelineRunId: 'r1' });
    port.dispose();
  });
});

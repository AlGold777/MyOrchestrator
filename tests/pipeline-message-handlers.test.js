const Handlers = require('../background/pipeline-message-handlers');

describe('PipelineMessageHandlers', () => {
  const makeDeps = () => {
    const responses = [];
    const jobState = { session: { pipelineRunId: 'r1', startTime: 1, pipelineControl: { pipelineRunId: 'r1', state: 'RUNNING' } } };
    return {
      responses,
      jobState,
      deps: {
        jobState,
        sendResponse: (value) => responses.push(value),
        stopAllProcesses: jest.fn(),
        saveJobState: jest.fn(),
        chromeApi: { storage: { local: { set: jest.fn().mockResolvedValue() }, session: { set: jest.fn().mockResolvedValue() } } },
        fsm: {
          STORAGE_KEY: 'control',
          cancelRun: (state) => ({ ...state, state: 'CANCELLED', stage: 'cancelled' }),
          transition: (state, event) => ({ ...state, state: event.state, pipelineRunId: event.pipelineRunId || state.pipelineRunId })
        }
      }
    };
  };

  test('rejects stale cancellation without stopping the active run', async () => {
    const { deps, responses } = makeDeps();
    await Handlers.cancelPipelineRun({ pipelineRunId: 'old' }, deps);
    expect(responses[0]).toMatchObject({ ignored: true, reason: 'stale_pipeline_run' });
    expect(deps.stopAllProcesses).not.toHaveBeenCalled();
  });

  test('owns cancellation persistence and cleanup', async () => {
    const { deps, responses, jobState } = makeDeps();
    await Handlers.cancelPipelineRun({ pipelineRunId: 'r1' }, deps);
    expect(jobState.session.pipelineState).toBe('CANCELLED');
    expect(deps.stopAllProcesses).toHaveBeenCalledWith('cancel_pipeline_run', { closeTabs: false });
    expect(responses[0]).toEqual({ success: true, pipelineRunId: 'r1' });
  });

  test('owns pipeline FSM event projection', async () => {
    const { deps, responses, jobState } = makeDeps();
    await Handlers.pipelineFsmEvent({ event: { state: 'PAUSED', pipelineRunId: 'r1' } }, deps);
    expect(jobState.session.pipelineState).toBe('PAUSED');
    expect(responses[0]).toMatchObject({ success: true, state: 'PAUSED' });
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MODEL_RUN_STATE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'model-run-state.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const STATE_MANAGER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'state-manager.js'), 'utf8');

function createSandbox() {
  const context = {
    console,
    Date,
    Math,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    jobState: {
      session: { startTime: 1779916480462 },
      llms: {}
    },
    appendLogEntry: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    broadcastGlobalState: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    emitTelemetry: jest.fn(() => ({ stored: true })),
    broadcastDiagnostic: jest.fn(),
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
  vm.runInContext(MODEL_RUN_STATE_SOURCE, context, { filename: 'shared/model-run-state.js' });
  vm.runInContext(STATE_MANAGER_SOURCE, context, { filename: 'background/state-manager.js' });
  return context;
}

describe('model run telemetry', () => {
  test('emits MODEL_RUN_TRANSITION for blocked post-terminal transition', () => {
    const context = createSandbox();
    const entry = {
      status: 'SUCCESS',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: 100000,
      answer: 'done'
    };
    entry.modelRunState = context.ModelRunState.deriveModelRunState(entry);

    const result = context.commitModelRunTransition('Gemini', entry, 'LIFECYCLE_READY', {
      status: 'RECEIVING',
      source: 'test'
    });

    expect(result.applied).toBe(false);
    expect(entry.modelRunState.postTerminalNoiseCount).toBe(1);
    expect(context.emitTelemetry).toHaveBeenCalledWith(
      'Gemini',
      'MODEL_RUN_TRANSITION',
      expect.objectContaining({
        level: 'warning',
        meta: expect.objectContaining({
          transition: 'LIFECYCLE_READY',
          applied: false,
          reason: 'terminal_quarantine'
        })
      })
    );
  });

  test('emits STATE_DIVERGENCE_DETECTED when legacy status disagrees with modelRunState', () => {
    const context = createSandbox();
    const entry = {
      status: 'GENERATING',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: 100000,
      answer: 'done'
    };
    entry.modelRunState = {
      uiStatus: 'SUCCESS',
      terminalStatus: 'SUCCESS',
      terminalState: 'success',
      executionState: 'terminal_success',
      generationState: 'closed',
      answerState: 'accepted'
    };

    const diverged = context.detectModelStateDivergence('Gemini', entry, 'test');

    expect(diverged).toBe(true);
    expect(context.emitTelemetry).toHaveBeenCalledWith(
      'Gemini',
      'STATE_DIVERGENCE_DETECTED',
      expect.objectContaining({
        level: 'warning',
        meta: expect.objectContaining({
          source: 'test',
          statusDiverged: true
        })
      })
    );
  });

  test('does not export direct POST_TERMINAL_NOISE transition by default', () => {
    const context = createSandbox();
    const entry = {
      status: 'SUCCESS',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: 100000,
      answer: 'done'
    };
    entry.modelRunState = context.ModelRunState.deriveModelRunState(entry);

    const result = context.commitModelRunTransition('Gemini', entry, 'POST_TERMINAL_NOISE', {
      status: 'GENERATING',
      source: 'test_noise'
    });

    expect(result.applied).toBe(true);
    expect(entry.modelRunState.postTerminalNoiseCount).toBe(1);
    expect(context.emitTelemetry).not.toHaveBeenCalledWith(
      'Gemini',
      'MODEL_RUN_TRANSITION',
      expect.any(Object)
    );
  });

  test('updateModelState commits projection through the projection telemetry helper', () => {
    const context = createSandbox();
    context.jobState.llms.Gemini = {
      llmName: 'Gemini',
      status: 'IDLE',
      logs: [],
      lastDispatchMeta: { dispatchId: 'dispatch-1' }
    };
    context.jobState.llms.Gemini.modelRunState = context.ModelRunState.deriveModelRunState(context.jobState.llms.Gemini);

    context.updateModelState('Gemini', 'GENERATING', { source: 'test_update' });

    expect(context.jobState.llms.Gemini.status).toBe('GENERATING');
    expect(context.emitTelemetry).toHaveBeenCalledWith(
      'Gemini',
      'MODEL_RUN_TRANSITION',
      expect.objectContaining({
        meta: expect.objectContaining({
          transition: 'STATUS_UPDATE',
          source: 'test_update'
        })
      })
    );
    expect(context.emitTelemetry).toHaveBeenCalledWith(
      'Gemini',
      'STATE_PROJECTION_COMMITTED',
      expect.objectContaining({
        meta: expect.objectContaining({
          source: 'updateModelState',
          stateOwner: 'legacyProjection'
        })
      })
    );
  });
});

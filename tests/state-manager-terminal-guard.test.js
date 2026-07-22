const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const MODEL_RUN_STATE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'model-run-state.js'), 'utf8');
const STATE_MANAGER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'state-manager.js'), 'utf8');

function createSandbox() {
  const context = {
    console,
    Date,
    JSON,
    Object,
    String,
    Number,
    Boolean,
    jobState: {
      session: { startTime: 1778621552201 },
      llms: {
        Gemini: {
          llmName: 'Gemini',
          status: 'SUCCESS',
          finalStatus: 'SUCCESS',
          finalStatusRecorded: true,
          finalizedAt: 1778621552301,
          answer: 'accepted answer'
        }
      }
    },
    appendLogEntry: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    broadcastGlobalState: jest.fn(),
    emitTelemetry: jest.fn(),
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

describe('StateManager terminal guard', () => {
  test('legacy finalStatusRecorded blocks late non-terminal status updates', () => {
    const context = createSandbox();
    const entry = context.jobState.llms.Gemini;
    entry.modelRunState = null;

    context.updateModelState('Gemini', 'RECEIVING', {
      message: 'generation_active',
      source: 'late_poll'
    });

    expect(entry.status).toBe('SUCCESS');
    expect(context.sendMessageToResultsTab).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'STATUS_UPDATE',
        llmName: 'Gemini',
        status: 'RECEIVING'
      })
    );
    expect(context.appendLogEntry).toHaveBeenCalledWith(
      'Gemini',
      expect.objectContaining({
        label: 'STATUS_IGNORED',
        meta: expect.objectContaining({
          incomingStatus: 'RECEIVING',
          reason: 'legacy_terminal_blocks_non_terminal_status'
        })
      })
    );
  });
});

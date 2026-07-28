const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);

function createContext() {
  const entry = {
    tabId: 77,
    status: 'EXTRACT_FAILED',
    finalStatus: 'EXTRACT_FAILED',
    finalStatusRecorded: true,
    lastDispatchMeta: { dispatchId: 'DeepSeek:run:1' }
  };
  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    setTimeout,
    clearTimeout,
    MutexManager: class {},
    TimingConfig: { getTiming: (_key, fallback) => fallback },
    chrome: {
      runtime: { getURL: (value) => value },
      tabs: {},
      scripting: {}
    },
    jobState: { session: { startTime: 100 }, llms: { DeepSeek: entry } },
    resultsTabId: null,
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn(),
    updateModelState: jest.fn(),
    self: null
  };
  context.self = context;
  context.ModelRunState = {
    isTerminalRunState: jest.fn(() => true),
    recordPostTerminalNoise: jest.fn()
  };
  context.recoverTerminalFailureAfterLifecycle = jest.fn();
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'background/dispatch-coordinator.js' });
  return { context, entry };
}

describe('terminal lifecycle auto recovery', () => {
  test('a late COMPLETE signal is preserved and starts recovery after EXTRACT_FAILED', () => {
    const { context, entry } = createContext();

    context.updateTypingStateFromDiagnostic('DeepSeek', {
      ts: 1234,
      label: 'ANSWER_COMPLETE_DETECTED',
      source: 'lifecycle',
      meta: { dispatchId: 'DeepSeek:run:1', textLength: 3818 }
    });

    expect(entry.lifecycleReadyAt).toBe(1234);
    expect(entry.answerCompleteTextLength).toBe(3818);
    expect(entry.lifecycleReadyMeta.state).toBe('COMPLETE');
    expect(context.recoverTerminalFailureAfterLifecycle).toHaveBeenCalledWith(
      'DeepSeek',
      expect.objectContaining({ dispatchId: 'DeepSeek:run:1', textLength: 3818 })
    );
  });

  test('a stale COMPLETE signal from another dispatch does not recover the current run', () => {
    const { context, entry } = createContext();

    context.updateTypingStateFromDiagnostic('DeepSeek', {
      ts: 1234,
      label: 'ANSWER_COMPLETE_DETECTED',
      meta: { dispatchId: 'DeepSeek:old:0', textLength: 9999 }
    });

    expect(entry.lifecycleReadyAt).toBeUndefined();
    expect(context.recoverTerminalFailureAfterLifecycle).not.toHaveBeenCalled();
  });
});

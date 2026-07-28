const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ModelPolicy = require('../shared/model-policy');

const DISPATCH_COORDINATOR_PATH = path.join(__dirname, '..', 'background', 'dispatch-coordinator.js');
const DISPATCH_COORDINATOR_SOURCE = fs.readFileSync(DISPATCH_COORDINATOR_PATH, 'utf8');

function createDispatchSandbox() {
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
    self: {},
    ModelPolicy,
    jobState: { llms: {}, session: {} },
    resultsTabId: null,
    MutexManager: class {
      async withLock(_key, fn) {
        return fn();
      }
    },
    TimingConfig: {
      getTiming(_key, fallback) {
        return fallback;
      }
    },
    chrome: {
      runtime: {
        getURL(file) {
          return `chrome-extension://test/${file}`;
        },
        lastError: null
      },
      tabs: {
        query(_query, cb) {
          cb([]);
        },
        sendMessage(_tabId, _message, cb) {
          if (typeof cb === 'function') cb({});
        }
      },
      windows: {
        update(_windowId, _update, cb) {
          if (typeof cb === 'function') cb();
        }
      }
    },
    emitTelemetry: jest.fn(),
    broadcastDiagnostic: jest.fn(),
    updateModelState: jest.fn(),
    handleLLMResponse: jest.fn(),
    isValidTabId(tabId) {
      return Number.isInteger(tabId) && tabId > 0;
    },
    isTerminalLlmEntry() {
      return false;
    },
    stopHumanPresenceLoop: jest.fn(),
    saveJobState: jest.fn()
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(DISPATCH_COORDINATOR_SOURCE, context, { filename: 'background/dispatch-coordinator.js' });
  return context;
}

describe('ModelPolicy Lite', () => {
  test('centralizes runtime-only model quirks', () => {
    expect(ModelPolicy.getModelPolicy('Qwen')).toEqual(expect.objectContaining({
      stableTextMs: 1800,
      terminalFailureRequiresEvidenceMiss: true,
      requireAckReady: true,
      transportErrorsRecoverable: true,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000
    }));
    expect(ModelPolicy.getModelPolicy('Perplexity')).toEqual(expect.objectContaining({
      requireAckReady: false,
      promptSubmitTimeoutMs: 12000
    }));
  });

  test('dispatch coordinator consumes policy for timeout and conservative backoff', () => {
    const context = createDispatchSandbox();

    expect(context.getPromptSubmitTimeoutMs('DeepSeek')).toBe(22000);
    expect(context.getRetryBackoffForModel('Qwen')).toEqual([2000, 2500, 5000, 9000]);
    expect(context.getRetryBackoffForModel('GPT')).toEqual([500, 800, 3000, 8000]);
  });

  test('policy exposes ack requirement as an explicit decision', () => {
    expect(ModelPolicy.modelRequiresAckReady('Perplexity')).toBe(false);
    expect(ModelPolicy.modelRequiresAckReady('Qwen')).toBe(true);
  });
});

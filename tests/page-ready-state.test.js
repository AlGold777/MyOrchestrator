const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DISPATCH_COORDINATOR_PATH = path.join(__dirname, '..', 'background', 'dispatch-coordinator.js');
const DISPATCH_COORDINATOR_SOURCE = fs.readFileSync(DISPATCH_COORDINATOR_PATH, 'utf8');
const PAGE_BLOCKER_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'page-blocker-policy.js'), 'utf8');

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
    dispatchDeregisterSessionTimer: jest.fn(),
    dispatchRegisterSessionTimer(timerId) {
      return timerId;
    },
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
  vm.runInContext(PAGE_BLOCKER_POLICY_SOURCE, context, { filename: 'shared/page-blocker-policy.js' });
  vm.runInContext(DISPATCH_COORDINATOR_SOURCE, context, { filename: 'background/dispatch-coordinator.js' });
  return context;
}

describe('PageReadyState Lite normalization', () => {
  test('dispatch keeps no-focus probe response in outer scope for page-ready gate', () => {
    expect(DISPATCH_COORDINATOR_SOURCE).toContain('let noFocusResponse = null;');
    expect(DISPATCH_COORDINATOR_SOURCE).not.toContain('const noFocusResponse = await sendMessageWithTimeout');
  });

  test('keeps legacy requires-focus response dispatchable', () => {
    const context = createDispatchSandbox();

    const state = context.normalizePageReadyState({
      status: 'requires_focus',
      requiresFocus: true
    });

    expect(state).toEqual(expect.objectContaining({
      ok: true,
      requiresFocus: true,
      status: 'requires_focus'
    }));
  });

  test('blocks explicit page readiness failures', () => {
    const context = createDispatchSandbox();

    expect(context.normalizePageReadyState({
      status: 'login_required',
      pageReady: false,
      blockers: ['login_required']
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: 'auth_required',
      blockerPolicy: expect.objectContaining({
        action: 'terminal_user_action_required',
        retryable: false
      })
    }));

    expect(context.normalizePageReadyState({
      pageReady: false,
      reason: 'wrong_page'
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: 'wrong_page'
    }));
  });

  test('blocks composer missing when focus is not the only blocker', () => {
    const context = createDispatchSandbox();

    expect(context.normalizePageReadyState({
      status: 'ready_no_focus',
      requiresFocus: false,
      pageReady: true,
      composerReady: false
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: 'composer_not_ready'
    }));

    expect(context.normalizePageReadyState({
      status: 'requires_focus',
      requiresFocus: true,
      pageReady: true,
      composerReady: false
    })).toEqual(expect.objectContaining({
      ok: true,
      requiresFocus: true
    }));
  });
});

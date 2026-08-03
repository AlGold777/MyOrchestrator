const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEALTH_MONITOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'health-monitor.js'), 'utf8');

function createSandbox() {
  const telemetry = [];
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
    TERMINAL_STATUSES: ['SUCCESS', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED'],
    // Provided by the worker scope in production.
    emitTelemetry: (llmName, event, payload) => telemetry.push({ llmName, event, payload }),
    TimingConfig: {
      getTiming(_key, fallback) {
        return fallback;
      }
    },
    chrome: {
      runtime: { lastError: null },
      tabs: {
        sendMessage() {},
        reload(_tabId, cb) { if (typeof cb === 'function') cb(); },
        onUpdated: {
          addListener() {},
          removeListener() {}
        }
      }
    },
    TabMapManager: {
      entries: () => []
    },
    ModelRunState: {
      isTerminalRunState(entry) {
        return entry?.modelRunState?.terminalState && entry.modelRunState.terminalState !== 'open';
      }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(HEALTH_MONITOR_SOURCE, context, { filename: 'background/health-monitor.js' });
  context.__telemetry = telemetry;
  return context;
}

describe('health-monitor terminal state', () => {
  test('uses ModelRunState terminal state even when legacy status is non-terminal', () => {
    const context = createSandbox();

    expect(context.isTerminalHealthEntry({
      status: 'GENERATING',
      modelRunState: {
        terminalState: 'success',
        terminalStatus: 'SUCCESS'
      }
    })).toBe(true);
  });

  test('requests a fresh handshake before waiting on an old page after worker restart', async () => {
    const context = createSandbox();
    context.ReadySignalManager = {
      hasCorrelatedHandshake: jest.fn(() => false),
      waitForReady: jest.fn(async () => ({ tabSessionId: 'tab-session-old-page' })),
      waitForAck: jest.fn(async () => ({ tabSessionId: 'tab-session-old-page' }))
    };
    context.chrome.tabs.sendMessage = jest.fn((_tabId, _message, callback) => callback?.());

    await expect(context.waitForScriptReady(42, 'GPT', { timeoutMs: 6000 })).resolves.toBe(true);

    expect(context.chrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
      type: 'REQUEST_SCRIPT_READY',
      llmName: 'GPT',
      reason: 'dispatch_handshake_recovery'
    }, expect.any(Function));
    expect(context.ReadySignalManager.waitForReady).toHaveBeenCalledWith(42, 6000);
    expect(context.ReadySignalManager.waitForAck).toHaveBeenCalledWith(42, 'tab-session-old-page', 6000);
    expect(context.__telemetry).toContainEqual(expect.objectContaining({
      llmName: 'GPT',
      event: 'READY_REANNOUNCE_REQUESTED'
    }));
  });
});

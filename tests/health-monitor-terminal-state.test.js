const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HEALTH_MONITOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'health-monitor.js'), 'utf8');

function createSandbox() {
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
});

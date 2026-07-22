// Phase D of the global review: CSP-safe main-world bridge injection.
// Inline <script> runs under the PAGE's CSP and can be silently blocked on
// provider sites; chrome.scripting.executeScript({world:'MAIN'}) is guaranteed
// by the browser. The token travels through extension args, never the DOM.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const MESSAGE_ROUTER_SOURCE = read('background', 'message-router.js');

function createRouterSandbox() {
  let onMessageListener = null;
  const executeCalls = [];
  const context = {
    console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, RegExp, JSON,
    setTimeout, clearTimeout,
    TERMINAL_STATUSES: [],
    jobState: { session: { startTime: 1 }, llms: {} },
    CompressedStorage: { get: jest.fn(() => Promise.resolve([])), set: jest.fn(() => Promise.resolve()), migrate: jest.fn(() => Promise.resolve()), pruneIfNeeded: jest.fn(() => Promise.resolve()) },
    clearDiagnosticsRuntimeLogs: jest.fn(() => false),
    saveJobState: jest.fn(),
    loadJobState: jest.fn(() => Promise.resolve()),
    loadResolutionMetrics: jest.fn(() => Promise.resolve()),
    loadCircuitBreakerState: jest.fn(() => Promise.resolve()),
    startProcess: jest.fn(() => Promise.resolve()),
    stopAllProcesses: jest.fn(),
    writeDiagnosticsEventsToStorage: jest.fn(() => Promise.resolve()),
    handleLLMResponse: jest.fn(),
    emitTelemetry: jest.fn(),
    broadcastDiagnostic: jest.fn(),
    TabMapManager: { load: jest.fn(() => Promise.resolve()), get: jest.fn(() => null), getNameByTabId: jest.fn(() => null), entries: jest.fn(() => []), removeByName: jest.fn() },
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        getManifest: () => ({ version: 'test' })
      },
      scripting: {
        executeScript: jest.fn((options) => {
          executeCalls.push(options);
          if (options.func) {
            // Simulate the MAIN-world token setter accepting the token.
            return Promise.resolve([{ result: true }]);
          }
          return Promise.resolve([{ result: null }]);
        })
      },
      storage: {
        local: { get: jest.fn((k, cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); }), set: jest.fn(() => Promise.resolve()) },
        session: { get: jest.fn(() => Promise.resolve({})), set: jest.fn(() => Promise.resolve()) },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} }, onActivated: { addListener: () => {} },
        sendMessage: jest.fn(() => Promise.resolve()), update: jest.fn(), query: jest.fn(() => Promise.resolve([]))
      },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  return {
    context,
    executeCalls,
    sendMessage(message, sender) {
      return new Promise((resolve) => {
        const handled = onMessageListener(message, sender, resolve);
        if (handled !== true) resolve(undefined);
      });
    }
  };
}

describe('BRIDGE_INJECT_REQUEST (CSP-safe MAIN-world path)', () => {
  test('injects the bridge file and passes the token through executeScript args', async () => {
    const { executeCalls, sendMessage } = createRouterSandbox();
    const response = await sendMessage(
      { type: 'BRIDGE_INJECT_REQUEST', bridgeToken: 'bridge_1_abc' },
      { tab: { id: 42 } }
    );
    expect(response).toEqual({ ok: true, tokenAccepted: true });
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[0]).toEqual(expect.objectContaining({
      world: 'MAIN',
      files: ['content-scripts/content-bridge.js'],
      target: { tabId: 42 }
    }));
    expect(executeCalls[1]).toEqual(expect.objectContaining({
      world: 'MAIN',
      args: ['bridge_1_abc']
    }));
  });

  test('rejects requests without a sender tab or token', async () => {
    const { sendMessage } = createRouterSandbox();
    expect((await sendMessage({ type: 'BRIDGE_INJECT_REQUEST', bridgeToken: 't' }, {}))?.reason).toBe('no_sender_tab');
    expect((await sendMessage({ type: 'BRIDGE_INJECT_REQUEST' }, { tab: { id: 42 } }))?.reason).toBe('no_token');
  });

  test('reports a consumed/hijacked token setter instead of claiming success', async () => {
    const { context, sendMessage } = createRouterSandbox();
    context.chrome.scripting.executeScript = jest.fn((options) => Promise.resolve(
      options.func ? [{ result: false }] : [{ result: null }]
    ));
    const response = await sendMessage(
      { type: 'BRIDGE_INJECT_REQUEST', bridgeToken: 'bridge_1_abc', llmName: 'GPT' },
      { tab: { id: 42 } }
    );
    expect(response).toEqual({ ok: true, tokenAccepted: false });
    expect(context.emitTelemetry).toHaveBeenCalledWith('GPT', 'BRIDGE_TOKEN_NOT_ACCEPTED', expect.anything());
  });
});

describe('bridge + bootstrap source contracts', () => {
  test('bridge supports the deferred one-shot token setter for file injection', () => {
    const bridge = read('content-scripts', 'content-bridge.js');
    expect(bridge).toContain("const placeholder = ['__LLM_BRIDGE', 'TOKEN__'].join('_');");
    expect(bridge).toContain('window.__LLM_BRIDGE_SET_TOKEN__ = (token) => {');
    expect(bridge).toContain('if (tokenConsumed || typeof token !== ');
  });

  test('bootstrap prefers the background path and falls back to inline injection', () => {
    const bootstrap = read('content-scripts', 'content-bootstrap.js');
    expect(bootstrap).toContain("chrome.runtime.sendMessage({ type: 'BRIDGE_INJECT_REQUEST', bridgeToken }");
    expect(bootstrap).toContain('if (injected?.ok && injected.tokenAccepted) return;');
    expect(bootstrap).toContain("bridgeSource.replaceAll('__LLM_BRIDGE_TOKEN__', JSON.stringify(bridgeToken))");
  });
});

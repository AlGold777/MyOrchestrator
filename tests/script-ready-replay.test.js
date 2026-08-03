const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BOOTSTRAP_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-bootstrap.js'),
  'utf8'
);

function createBootstrapSandbox() {
  const runtimeListeners = [];
  const sentMessages = [];
  const window = {
    __LLMMainBridgeInjected: true,
    addEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
    location: { href: 'https://chatgpt.com/c/old-conversation' }
  };
  const chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      getManifest: () => ({ version: '2.81.261' }),
      sendMessage(payload, callback) {
        sentMessages.push(payload);
        callback?.({ status: 'ok' });
      },
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        }
      }
    },
    storage: {
      local: {
        onChanged: { addListener: jest.fn() }
      }
    }
  };
  const context = {
    window,
    globalThis: window,
    chrome,
    location: window.location,
    console,
    CustomEvent: function CustomEvent(type, init) { return { type, ...init }; },
    TimingConfig: {
      getTiming(_key, fallback) { return fallback; }
    },
    setInterval: jest.fn(() => 1),
    clearInterval: jest.fn(),
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(BOOTSTRAP_SOURCE, context, { filename: 'content-scripts/content-bootstrap.js' });
  return { window, runtimeListeners, sentMessages };
}

describe('old-page SCRIPT_READY replay', () => {
  test('replays the same tab session when a restarted worker requests readiness', () => {
    const { window, runtimeListeners, sentMessages } = createBootstrapSandbox();
    const tabSessionId = window.LLMExtension.sendScriptReady('GPT');
    runtimeListeners.forEach((listener) => listener({
      type: 'ACK_READY',
      llmName: 'GPT',
      tabSessionId
    }));

    runtimeListeners.forEach((listener) => listener({
      type: 'REQUEST_SCRIPT_READY',
      llmName: 'GPT',
      reason: 'dispatch_handshake_recovery'
    }));

    const readyMessages = sentMessages.filter((message) => message.type === 'SCRIPT_READY');
    expect(readyMessages).toHaveLength(2);
    expect(readyMessages[1]).toMatchObject({
      llmName: 'GPT',
      tabSessionId,
      meta: {
        tabSessionId,
        reason: 'background_recovery_request'
      }
    });
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROUTER = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

const sliceRuntime = (startMarker, endMarker) => ROUTER.slice(
  ROUTER.indexOf(startMarker),
  ROUTER.indexOf(endMarker, ROUTER.indexOf(startMarker))
);

describe('trusted provider dispatch runtime', () => {
  test('Perplexity trusted Enter focuses the matching composer and emits native Enter', async () => {
    const runtime = sliceRuntime(
      'const buildProviderComposerFocusExpression',
      'async function dispatchProviderTrustedInput'
    );
    const calls = [];
    const sandbox = {
      JSON,
      Number,
      emitTelemetry: (...args) => calls.push(['telemetry', ...args]),
      callChromeDebugger: async (method, target, command, params) => {
        calls.push([method, target, command, params]);
        if (method === 'sendCommand' && command === 'Runtime.evaluate') {
          return { result: { value: true } };
        }
        return {};
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${runtime}\n;globalThis.dispatchEnter = dispatchProviderTrustedEnter;`, sandbox);

    await expect(sandbox.dispatchEnter(17, 'Perplexity', 'exact prompt'))
      .resolves.toEqual({ ok: true, method: 'cdp_focused_composer_enter' });
    expect(calls.some((call) => call[0] === 'attach')).toBe(true);
    expect(calls.some((call) => call[2] === 'Runtime.evaluate'
      && String(call[3]?.expression).includes('exact prompt'))).toBe(true);
    expect(calls.filter((call) => call[2] === 'Input.dispatchKeyEvent')).toHaveLength(2);
    expect(calls.some((call) => call[0] === 'detach')).toBe(true);
  });

  test('trusted Send clicks the enabled composer-owned control and detaches', async () => {
    const runtime = sliceRuntime(
      'const buildProviderSendControlExpression',
      'const isTerminalRouterEntry'
    );
    const calls = [];
    const sandbox = {
      JSON,
      emitTelemetry: (...args) => calls.push(['telemetry', ...args]),
      trustedClickDebuggerObject: async (_target, objectId) => ({
        clicked: objectId === 'send-control',
        descriptor: { label: 'Send' }
      }),
      callChromeDebugger: async (method, target, command, params) => {
        calls.push([method, target, command, params]);
        if (method === 'sendCommand' && command === 'Runtime.evaluate') {
          return { result: { objectId: 'send-control' } };
        }
        return {};
      }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${runtime}\n;globalThis.dispatchSend = dispatchProviderTrustedSend;`, sandbox);

    await expect(sandbox.dispatchSend(23, 'Le Chat', ''))
      .resolves.toEqual(expect.objectContaining({ ok: true, method: 'cdp_send_control_click' }));
    expect(calls.some((call) => call[0] === 'attach')).toBe(true);
    expect(calls.some((call) => call[2] === 'Runtime.releaseObject')).toBe(true);
    expect(calls.some((call) => call[0] === 'detach')).toBe(true);
  });

  test('Send expression resolves the current Lexical composer localized control', () => {
    const runtime = sliceRuntime(
      'const buildProviderSendControlExpression',
      'async function dispatchProviderTrustedSend'
    );
    const sandbox = { JSON };
    vm.createContext(sandbox);
    vm.runInContext(`${runtime}\n;globalThis.buildSendExpression = buildProviderSendControlExpression;`, sandbox);
    const dom = new JSDOM(`
      <div id="composer-shell">
        <div><div><div id="ask-input" contenteditable="true" role="textbox">probe prompt</div></div></div>
        <button type="button" aria-label="Ввести голосом"></button>
        <button type="button" aria-label="Отправить"></button>
      </div>
    `, { runScripts: 'outside-only' });
    dom.window.document.querySelectorAll('*').forEach((element) => {
      element.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, left: 0, right: 100, bottom: 40 });
    });
    const control = dom.window.eval(sandbox.buildSendExpression('probe prompt'));
    expect(control).toBe(dom.window.document.querySelector('[aria-label="Отправить"]'));
  });
});

const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
const start = source.indexOf('async function runPreCollectScrollNudge');
const functionSource = source.slice(start, source.indexOf('\nasync function ', start + 10));

function setup() {
  const c = {
    jobState: { llms: { GPT: {} } }, isValidTabId: () => true,
    isSessionActive: () => true, isFinalizedEntry: e => !!e.finalizedAt,
    emitTelemetry: jest.fn(), activateTabForDispatch: jest.fn(async () => {}),
    orchestratorSleepMs: async () => {}, PRECOLLECT_NUDGE_STABILIZE_MS: 250,
    document, window, getComputedStyle, Event, setTimeout,
    chrome: { scripting: { executeScript: jest.fn(async ({ func, args }) => [{ result: await func(...args) }]) } }
  };
  c.self = c;
  vm.createContext(c);
  vm.runInContext(functionSource, c);
  return c;
}

function scroller(parent, height = 1000, width = 800) {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  parent.appendChild(el);
  Object.defineProperties(el, {
    clientHeight: { value: 500 }, clientWidth: { value: width },
    scrollHeight: { get: () => height }
  });
  el.getClientRects = () => [{}];
  el.scrollTo = jest.fn(({ top }) => { el.scrollTop = top; });
  return { el, grow: n => { height = n; } };
}

beforeEach(() => { jest.useFakeTimers(); document.body.innerHTML = ''; });
afterEach(() => jest.useRealTimers());

test('finds an unnamed chat scroller after sidebar decoys and follows lazy growth to the new bottom', async () => {
  const nav = document.createElement('nav'); document.body.appendChild(nav);
  const decoys = Array.from({ length: 6 }, () => scroller(nav));
  const main = document.createElement('main'); document.body.appendChild(main);
  const chat = scroller(main);
  let grown = false;
  chat.el.scrollTo.mockImplementation(({ top, behavior }) => {
    expect(behavior).toBe('instant');
    chat.el.scrollTop = top;
    if (!grown) {
      grown = true;
      setTimeout(() => { chat.grow(2400); chat.el.textContent = 'Full answer including its final paragraph'; }, 80);
    }
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTop).toBe(1900);
  expect(decoys.every(d => d.el.scrollTo.mock.calls.length === 0)).toBe(true);
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: true }) })
  }));
});

test('re-resolves a replaced virtualized container and bounds a continuously growing answer', async () => {
  const main = document.createElement('main'); document.body.appendChild(main);
  const old = scroller(main);
  let replacement;
  old.el.scrollTo.mockImplementation(() => {
    old.el.remove(); replacement = scroller(main, 1500);
    replacement.el.scrollTo.mockImplementation(({ top }) => {
      replacement.el.scrollTop = top;
      replacement.grow(replacement.el.scrollHeight + 100);
    });
  });
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync(); await result;
  expect(replacement.el.scrollTo).toHaveBeenCalled();
  expect(c.emitTelemetry).toHaveBeenCalledWith('GPT', 'PRECOLLECT_NUDGE', expect.objectContaining({
    meta: expect.objectContaining({ scrollPreparation: expect.objectContaining({ settled: false, passes: 8 }) })
  }));
});

test('keeps focus lock through DOM preparation and settling', async () => {
  const c = setup(); let locked = false;
  c.withPromptDispatchFocusLock = async fn => { locked = true; try { return await fn(); } finally { locked = false; } };
  c.chrome.scripting.executeScript.mockImplementation(async () => { expect(locked).toBe(true); return [{ result: { settled: true } }]; });
  c.orchestratorSleepMs = async () => { expect(locked).toBe(true); };
  expect(await c.runPreCollectScrollNudge('GPT', 1, 1)).toBe(true);
  expect(locked).toBe(false);
});

test.each(['first-pass', 'session-changed', 'finalized', 'focus-expired'])('rechecks %s after waiting for focus lock', async state => {
  const c = setup();
  c.withPromptDispatchFocusLock = async fn => {
    if (state === 'first-pass') c.isInitialPromptPassActive = () => true;
    if (state === 'session-changed') c.isSessionActive = () => false;
    if (state === 'finalized') c.jobState.llms.GPT.finalizedAt = 1;
    if (state === 'focus-expired') c.isActiveFocusAllowedForEntry = () => false;
    return fn();
  };
  expect(await c.runPreCollectScrollNudge('GPT', 1, 1)).toBe(false);
  expect(c.activateTabForDispatch).not.toHaveBeenCalled();
  expect(c.chrome.scripting.executeScript).not.toHaveBeenCalled();
});

test('Qwen uses the explicit bottom button when direct scrolling is ignored', async () => {
  const chat = scroller(document.body);
  chat.el.scrollTo.mockImplementation(() => {});
  const arrow = document.createElement('button');
  arrow.setAttribute('aria-label', 'Scroll to bottom');
  arrow.getClientRects = () => [{}];
  arrow.onclick = () => { chat.el.scrollTop = 500; };
  document.body.appendChild(arrow);
  const c = setup(); c.jobState.llms.Qwen = {};
  const result = c.runPreCollectScrollNudge('Qwen', 1, 1);
  await jest.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(chat.el.scrollTop).toBe(500);
});

test('GPT fails the mandatory visit when scrolling does not reach the bottom', async () => {
  const chat = scroller(document.body); chat.el.scrollTo.mockImplementation(() => {});
  const c = setup(); const result = c.runPreCollectScrollNudge('GPT', 1, 1);
  await jest.runAllTimersAsync();
  expect(await result).toBe(false);
});

test('mandatory response gate drops the pre-scroll payload and requests fresh text only after success', async () => {
  const c = setup();
  const gateStart = source.indexOf('function deferResponseUntilRequiredBottom');
  vm.runInContext(source.slice(gateStart, start), c);
  c.getActiveSessionId = () => 1;
  c.resolveBoundTabIdForOrchestrator = () => 10;
  c.triggerResponseCollectionPing = jest.fn();
  let resolveVisit;
  c.runPreCollectScrollNudge = jest.fn(() => new Promise(resolve => { resolveVisit = resolve; }));
  const entry = c.jobState.llms.GPT = { lastDispatchMeta: { dispatchId: 'current' } };
  expect(c.deferResponseUntilRequiredBottom('GPT', entry)).toBe(true);
  expect(c.deferResponseUntilRequiredBottom('GPT', entry)).toBe(true);
  expect(c.runPreCollectScrollNudge).toHaveBeenCalledTimes(1);
  expect(c.triggerResponseCollectionPing).not.toHaveBeenCalled();
  resolveVisit(true); await jest.runAllTimersAsync();
  expect(c.triggerResponseCollectionPing).toHaveBeenCalledWith('GPT', 10, 'required_bottom_fresh_collection', { forceEmitOnUnchanged: true });
  expect(c.deferResponseUntilRequiredBottom('GPT', entry)).toBe(false);
  entry.lastDispatchMeta.dispatchId = 'next';
  expect(c.deferResponseUntilRequiredBottom('GPT', entry)).toBe(true);
  expect(c.deferResponseUntilRequiredBottom('Claude', entry)).toBe(false);
});

test('failed visit never grants acceptance proof or requests collection', async () => {
  const c = setup();
  const gateStart = source.indexOf('function deferResponseUntilRequiredBottom');
  vm.runInContext(source.slice(gateStart, start), c);
  c.getActiveSessionId = () => 1;
  c.resolveBoundTabIdForOrchestrator = () => 10;
  c.triggerResponseCollectionPing = jest.fn();
  c.runPreCollectScrollNudge = async () => false;
  const entry = c.jobState.llms.Qwen = { lastDispatchMeta: { dispatchId: 'current' } };
  expect(c.deferResponseUntilRequiredBottom('Qwen', entry)).toBe(true);
  await jest.runAllTimersAsync();
  expect(entry.requiredBottomProof).toBeUndefined();
  expect(c.triggerResponseCollectionPing).not.toHaveBeenCalled();
});

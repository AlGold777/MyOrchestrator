const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/health-monitor'), 'utf8');
function runtime() {
  const listeners = new Set();
  const c = { setTimeout, clearTimeout, console, HEALTH_CHECK_TIMEOUT_MS: 15000,
    emitTelemetry: jest.fn(), SCRIPT_MAP: { GPT: 'gpt.js' }, jobState: { llms: {} },
    isTerminalHealthEntry: () => false, healthRegisterSessionTimer: x => x,
    healthDeregisterSessionTimer: jest.fn(), awaitSessionDelay: ms => new Promise(r => setTimeout(r, ms)),
    chrome: { runtime: {}, tabs: { sendMessage: jest.fn(() => Promise.resolve()), reload: jest.fn(),
      onUpdated: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) } } } };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('async function checkScriptHealth'), source.indexOf('const READY_WAIT_TIMEOUT_MS')), c);
  vm.runInContext(source.slice(source.indexOf('async function reinjectScript'), source.indexOf('async function prepareTabForUse')), c);
  return { c, listeners };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('lost health callback releases dispatch and ignores late response', async () => {
  const { c } = runtime();
  const result = c.checkScriptHealth(1, 'GPT', { silent: true, timeoutMs: 6000 });
  await jest.advanceTimersByTimeAsync(6000);
  expect(await result).toBe(false);
  c.chrome.tabs.sendMessage.mock.calls[0][2]({ ok: true });
  expect(jest.getTimerCount()).toBe(0);
});
test('health API exception settles immediately', async () => {
  const { c } = runtime();
  c.chrome.tabs.sendMessage.mockImplementation(() => { throw new Error('closed tab'); });
  expect(await c.checkScriptHealth(1, 'GPT')).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});
test('hanging reload API is bounded and removes its observer', async () => {
  const { c, listeners } = runtime();
  c.chrome.tabs.reload.mockImplementation(() => new Promise(() => {}));
  const result = c.reinjectScript(1, 'GPT');
  await jest.advanceTimersByTimeAsync(30000);
  expect(await result).toBe(false);
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
test('fast reload completion cannot occur before observer registration', async () => {
  const { c, listeners } = runtime();
  c.chrome.tabs.reload.mockImplementation(async () => {
    for (const f of listeners) f(1, { status: 'complete' });
  });
  const result = c.reinjectScript(1, 'GPT');
  await jest.advanceTimersByTimeAsync(500);
  expect(await result).toBe(true);
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

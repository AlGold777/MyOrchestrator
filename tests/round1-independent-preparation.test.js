/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const orchestrator = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
const coordinator = fs.readFileSync(require.resolve('../background/dispatch-coordinator'), 'utf8');
const functionSource = (source, name) => {
  const start = source.indexOf(`async function ${name}`);
  return source.slice(start, source.indexOf('\nasync function ', start + 10));
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const names = ['Qwen', 'GPT', 'Claude', 'Gemini'];
  const c = { console, Date, Promise, jobState: { session: { startTime: 1 }, llms: {} },
    orderRound1Models: n => n, isSessionActive: id => c.jobState.session.startTime === id,
    isFinalizedEntry: e => !!e.finalizedAt, resolveBoundTabIdForOrchestrator: (_, e) => e.tabId,
    isValidTabId: Number.isInteger, getTabSafe: async () => ({ url: 'https://example.com' }),
    initRequestMetadata: jest.fn(), resolvePromptForDispatch: (_, p) => p,
    emitModelRoundTelemetry: jest.fn(), endBudgetPhase: jest.fn(),
    ROUND1_BEFORE_SEND_MS: 0, ROUND1_POST_SEND_MS: 0, ROUND1_PROGRESS_FOCUS_EXTENSION_MS: 0,
    resolveRound1PostCommandFocusHoldMs: () => 0, orchestratorSleepMs: async () => {} };
  c.self = c;
  names.forEach((name, i) => { c.jobState.llms[name] = { tabId: i + 1 }; });
  vm.createContext(c);
  vm.runInContext(functionSource(orchestrator, 'dispatchRound1Sequentially'), c);
  vm.runInContext('var promptDispatchFocusMutex = Promise.resolve();\n' + coordinator.slice(
    coordinator.indexOf('function withPromptDispatchFocusLock'), coordinator.indexOf('\nfunction resolvePromptSubmitted')
  ), c);
  return { c, names };
}

test('a stuck preparation cannot starve ready models; their foreground transactions stay serialized', async () => {
  const { c, names } = setup();
  const slow = deferred(), focus = deferred();
  const sent = [];
  let active = 0, maxActive = 0;
  c.dispatchPromptToTab = jest.fn(async (name) => {
    if (name === 'Qwen') await slow.promise;
    if (name === 'Gemini') throw new Error('health failed');
    await c.withPromptDispatchFocusLock(async () => {
      active++; maxActive = Math.max(maxActive, active); sent.push(name);
      if (name === 'GPT') await focus.promise;
      active--;
    });
  });
  const run = c.dispatchRound1Sequentially(names, '8 / 4', [], 1);
  await flush();
  expect(c.dispatchPromptToTab).toHaveBeenCalledTimes(4);
  expect(sent).toEqual(['GPT']);
  focus.resolve(); await flush();
  expect(sent).toEqual(['GPT', 'Claude']);
  slow.resolve();
  expect(await run).toBe(true);
  expect(sent).toEqual(['GPT', 'Claude', 'Qwen']);
  expect(maxActive).toBe(1);
  expect(c.emitModelRoundTelemetry).toHaveBeenCalledWith('Gemini', 1, 'END', 'dispatch preparation failed', expect.anything());
});

test('a new session cancels models still resolving their tabs', async () => {
  const { c, names } = setup();
  const tab = deferred();
  c.getTabSafe = jest.fn(() => tab.promise);
  c.dispatchPromptToTab = jest.fn();
  const run = c.dispatchRound1Sequentially(names, 'old prompt', [], 1);
  c.jobState.session.startTime = 2;
  tab.resolve({url: 'https://example.com'});
  expect(await run).toBe(false);
  expect(c.dispatchPromptToTab).not.toHaveBeenCalled();
});

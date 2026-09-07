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
  const c = { console, Date, Promise, setTimeout, clearTimeout, jobState: { session: { startTime: 1 }, llms: {} },
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

test('the first pass waits for each bounded dispatch in order and continues after a failed model', async () => {
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
  expect(c.dispatchPromptToTab).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([]);
  slow.resolve(); await flush();
  expect(sent).toEqual(['Qwen', 'GPT']);
  focus.resolve(); await flush();
  expect(sent).toEqual(['Qwen', 'GPT', 'Claude']);
  expect(await run).toBe(true);
  expect(sent).toEqual(['Qwen', 'GPT', 'Claude']);
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

test('collection and verification helpers cannot visit before the initial pass completes', async () => {
  const { c } = setup();
  c.isInitialPromptPassActive = () => true;
  for (const name of ['focusTabForVerification', 'runPreCollectScrollNudge', 'runForcedAutomationVisits']) {
    vm.runInContext(functionSource(orchestrator, name), c);
    expect(await c[name]('GPT', 2, 1, 1)).toBe(false);
  }
  const human = fs.readFileSync(require.resolve('../background/human-presence'), 'utf8');
  const start = human.indexOf('function visitTabWithAutomation');
  vm.runInContext(human.slice(start, human.indexOf('\nfunction ', start + 10)), c);
  expect(await c.visitTabWithAutomation('GPT', 2)).toBe(false);
});

test('the real model mutex cannot finish Round 1 while a focus transaction still runs after 30 seconds', async () => {
  jest.useFakeTimers();
  try {
    const { c, names } = setup();
    Object.assign(c, { setTimeout, clearTimeout });
    vm.runInContext(fs.readFileSync(require.resolve('../utils/safe-mutex'), 'utf8'), c);
    c.dispatchMutexManager = new c.MutexManager();
    vm.runInContext(coordinator.slice(coordinator.indexOf('async function withPromptDispatchLock'),
      coordinator.indexOf('\nfunction withPromptDispatchFocusLock')), c);
    const release = deferred();
    c.dispatchPromptToTab = name => c.withPromptDispatchLock(name, () => c.withPromptDispatchFocusLock(async () => {
      if (name === names[0]) await release.promise;
    }));
    let roundFinished = false;
    const run = c.dispatchRound1Sequentially(names, '8 / 4', [], 1).then(() => { roundFinished = true; });
    await jest.advanceTimersByTimeAsync(31000);
    expect(roundFinished).toBe(false);
    release.resolve();
    await run;
    expect(roundFinished).toBe(true);
    expect(c.emitModelRoundTelemetry.mock.calls.filter(call => call[3] === 'dispatch preparation failed')).toHaveLength(0);
  } finally { jest.useRealTimers(); }
});

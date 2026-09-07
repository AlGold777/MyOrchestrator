/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(require.resolve('../background/dispatch-coordinator'), 'utf8');

test('Stop during an awaited delay does not strand the focus queue for the next run', async () => {
  jest.useFakeTimers();
  try {
    const timers = [];
    const c = {Promise, console, setTimeout, clearTimeout,
      dispatchRegisterSessionTimer: t => {timers.push(t); return t;}, dispatchDeregisterSessionTimer: () => {}};
    vm.createContext(c);
    vm.runInContext(src.slice(src.indexOf('const dispatchSleepMs'), src.indexOf('function resolveDispatchFlags'))
      + '\nglobalThis.sleep = dispatchSleepMs;', c);
    vm.runInContext('var promptDispatchFocusMutex = Promise.resolve();\n' + src.slice(
      src.indexOf('function withPromptDispatchFocusLock'), src.indexOf('function resolvePromptSubmitted')), c);
    const visits = [];
    const old = c.withPromptDispatchFocusLock(async () => { visits.push('old'); await c.sleep(500); });
    await jest.advanceTimersByTimeAsync(100);
    timers.forEach(clearTimeout);
    const next = c.withPromptDispatchFocusLock(() => visits.push('next'));
    await jest.advanceTimersByTimeAsync(1000);
    expect(visits).toEqual(['old', 'next']);
    await Promise.all([old, next]);
  } finally { jest.useRealTimers(); }
});

test('send recovery never returns to the completed DeepSeek tab it started from', async () => {
  jest.useFakeTimers();
  try {
    let active = 7;
    const visits = [];
    const c = { console, Date, Promise, Map, setTimeout, clearTimeout,
      providerSendOnlyRecoveryTimers: new Map(),
      PROVIDER_SEND_ONLY_RECOVERY_DELAY_MS: 500, PROVIDER_SEND_ONLY_RECOVERY_TIMEOUT_MS: 15000,
      dispatchRegisterSessionTimer: x => x, dispatchDeregisterSessionTimer: () => {},
      dispatchSleepMs: ms => new Promise(resolve => setTimeout(resolve, ms)),
      withPromptDispatchFocusLock: fn => fn(),
      isValidTabId: Number.isInteger, resolveBoundTabIdForDispatch: (_, e) => e.tabId,
      ModelPolicy: { modelSupportsSendOnlyRecovery: () => true },
      jobState: { session: {startTime: 1}, llms: {
        DeepSeek: {tabId: 7, status: 'SUCCESS', promptSubmittedAt: 1},
        GPT: {tabId: 8, lastDispatchMeta: {dispatchId:'g1'}, providerDispatchStage: 'send_action_failed'}
      }}, emitTelemetry: jest.fn(),
      chrome: {runtime: {}, windows: {update: (_, __, cb) => cb()}, tabs: {
        query: (_, cb) => cb([{id:active, windowId:1}]),
        update: (id, _, cb) => { active = id; visits.push(id); cb(); }
      }}
    };
    c.self = c;
    c.activateTabForDispatch = async id => { active = id; visits.push(id); return true; };
    c.sendMessageWithTimeout = async () => {
      c.jobState.llms.GPT.promptSubmittedAt = Date.now();
      return {ok: true};
    };
    vm.createContext(c);
    // Load the old helper too when running this regression against its parent.
    if (src.includes('function getActiveTabSnapshot')) vm.runInContext(src.slice(
      src.indexOf('function getActiveTabSnapshot'), src.indexOf('function resolveDispatchFlags')), c);
    vm.runInContext(src.slice(src.indexOf('function cancelProviderSendOnlyRecovery'),
      src.indexOf('const dispatchSessionTimerManager')), c);
    c.scheduleProviderSendOnlyRecovery('GPT');
    await jest.advanceTimersByTimeAsync(9000);
    expect(visits).toEqual([8]);
    expect(active).toBe(8);
  } finally { jest.useRealTimers(); }
});

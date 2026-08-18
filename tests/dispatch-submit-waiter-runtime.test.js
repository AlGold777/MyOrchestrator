const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);

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
    self: {},
    jobState: { llms: {}, session: {} },
    resultsTabId: null,
    MutexManager: class { async withLock(_key, fn) { return fn(); } },
    TimingConfig: { getTiming: (_key, fallback) => fallback },
    chrome: {
      runtime: { getURL: (file) => `chrome-extension://test/${file}`, lastError: null },
      tabs: { query: (_query, cb) => cb([]), sendMessage: () => {} },
      windows: { update: (_id, _update, cb) => cb?.() }
    },
    emitTelemetry: jest.fn(),
    broadcastDiagnostic: jest.fn(),
    updateModelState: jest.fn(),
    handleLLMResponse: jest.fn(),
    dispatchRegisterSessionTimer: (timer) => timer,
    dispatchDeregisterSessionTimer: jest.fn(),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    isTerminalLlmEntry: () => false,
    stopHumanPresenceLoop: jest.fn(),
    saveJobState: jest.fn()
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'background/dispatch-coordinator.js' });
  return context;
}

describe('submit waiter runtime boundary', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('does not consume timeout budget until command acceptance arms it', async () => {
    const context = createSandbox();
    const waiter = context.createPromptSubmittedWaiter('GPT', 'GPT:run:1', 1000);
    let settled = false;
    waiter.promise.then(() => { settled = true; });

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(settled).toBe(false);

    expect(waiter.arm()).toBe(true);
    jest.advanceTimersByTime(999);
    await Promise.resolve();
    expect(settled).toBe(false);

    context.resolvePromptSubmitted('GPT', { ok: true, dispatchId: 'GPT:run:1' });
    await expect(waiter.promise).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  test('times out only after it has been armed', async () => {
    const context = createSandbox();
    const waiter = context.createPromptSubmittedWaiter('Claude', 'Claude:run:1', 1000);
    waiter.arm();
    jest.advanceTimersByTime(1000);
    await expect(waiter.promise).resolves.toBe(false);
  });
});

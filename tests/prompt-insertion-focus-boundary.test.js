const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);
const ORCHESTRATOR = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);

const INSERTION_RUNTIME = SOURCE.slice(
  SOURCE.indexOf('function resolvePromptInsertion'),
  SOURCE.indexOf('function getPromptSubmitTimeoutMs')
);

const buildRuntime = () => {
  const sandbox = {
    Map,
    Set,
    Promise,
    Number,
    setTimeout,
    clearTimeout,
    dispatchRegisterSessionTimer: (timerId) => timerId,
    dispatchDeregisterSessionTimer: () => {},
    dispatchSleepMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    var promptInsertionWaiters = new Map();
    ${INSERTION_RUNTIME}
    globalThis.waitInsertion = waitForPromptInsertion;
    globalThis.resolveInsertion = resolvePromptInsertion;
    globalThis.waitBoundary = waitForPromptFocusBoundary;
  `, sandbox);
  return sandbox;
};

describe('Round 1 prompt insertion focus boundary', () => {
  test('Round 1 uses an eight-second insertion cap, not model submit timeouts', () => {
    const resolver = ORCHESTRATOR.slice(
      ORCHESTRATOR.indexOf('const resolveRound1PostCommandFocusHoldMs'),
      ORCHESTRATOR.indexOf('async function dispatchRound1Sequentially')
    );
    expect(ORCHESTRATOR).toContain('const ROUND1_PROMPT_INSERTION_FOCUS_HOLD_MS = 8000');
    expect(resolver).toContain('ROUND1_PROMPT_INSERTION_FOCUS_HOLD_MS');
    expect(resolver).not.toContain('getPromptSubmitTimeoutMs');
    expect(ORCHESTRATOR).toContain('const ROUND1_PROGRESS_FOCUS_EXTENSION_MS = 5000');
    expect(ORCHESTRATOR).toContain('progressFocusExtensionMs: ROUND1_PROGRESS_FOCUS_EXTENSION_MS');
  });

  test('focus extension is bounded and requires current correlated progress', () => {
    expect(SOURCE).toContain('const progressIsCurrent = entry.providerDispatchStageDispatchId === dispatchId');
    expect(SOURCE).toContain("boundary.reason === 'hold_elapsed'");
    expect(SOURCE).toContain('extendableStages.has(progressStage)');
    expect(SOURCE).toContain("reason: extendedBoundary.reason === 'hold_elapsed'");
    expect(SOURCE).toContain("? 'progress_extension_elapsed'");
  });

  test('insertion waiters resolve only for the exact model and dispatch', async () => {
    const runtime = buildRuntime();
    const insertion = runtime.waitInsertion('Grok', 'dispatch-current', 200);

    expect(runtime.resolveInsertion('Grok', {
      dispatchId: 'dispatch-stale',
      insertionState: 'inserted'
    })).toBe(false);
    expect(runtime.resolveInsertion('Claude', {
      dispatchId: 'dispatch-current',
      insertionState: 'inserted'
    })).toBe(false);
    expect(runtime.resolveInsertion('Grok', {
      dispatchId: 'dispatch-current',
      insertionState: 'inserted'
    })).toBe(true);

    await expect(insertion).resolves.toMatchObject({
      dispatchId: 'dispatch-current',
      insertionState: 'inserted'
    });
  });

  test.each([
    ['inserted', 'prompt_inserted'],
    ['failed', 'insertion_failed']
  ])('releases focus on a correlated %s outcome', async (insertionState, reason) => {
    const runtime = buildRuntime();
    const neverSubmitted = new Promise(() => {});
    await expect(runtime.waitBoundary(
      neverSubmitted,
      Promise.resolve({ insertionState }),
      1000
    )).resolves.toMatchObject({ reason });
  });

  test('caps focus independently of the longer submit watchdog', async () => {
    const runtime = buildRuntime();
    const never = new Promise(() => {});
    const startedAt = Date.now();
    const result = await runtime.waitBoundary(never, never, 25);

    expect(result).toMatchObject({ reason: 'hold_elapsed' });
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});

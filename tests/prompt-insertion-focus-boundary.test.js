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
  test('Round 1 uses a short insertion cap, not model submit timeouts', () => {
    const resolver = ORCHESTRATOR.slice(
      ORCHESTRATOR.indexOf('const resolveRound1PostCommandFocusHoldMs'),
      ORCHESTRATOR.indexOf('async function dispatchRound1Sequentially')
    );
    expect(ORCHESTRATOR).toContain('const ROUND1_PROMPT_INSERTION_FOCUS_HOLD_MS = 1500');
    expect(resolver).toContain('ROUND1_PROMPT_INSERTION_FOCUS_HOLD_MS');
    expect(resolver).not.toContain('getPromptSubmitTimeoutMs');
    expect(ORCHESTRATOR).toContain('const ROUND1_PROGRESS_FOCUS_EXTENSION_MS = 1500');
    expect(ORCHESTRATOR).toContain('progressFocusExtensionMs: ROUND1_PROGRESS_FOCUS_EXTENSION_MS');
  });

  test('focus extension is bounded and requires current correlated progress', () => {
    // Progress must belong to this dispatch, and must have arrived since the
    // previous extension step -- a stalled provider cannot keep the tab pinned
    // on a report it filed once.
    expect(SOURCE).toContain('const stageIsCurrent = entry.providerDispatchStageDispatchId === dispatchId');
    expect(SOURCE).toContain('if (!composerTransactionActive && (!stageIsCurrent || stageAt < progressFloorAt)) break;');
    expect(SOURCE).toContain('progressFloorAt = Date.now();');
    expect(SOURCE).toContain("boundary.reason === 'hold_elapsed'");
    expect(SOURCE).toContain('extendableStages.has(progressStage)');
    expect(SOURCE).toContain("reason: extendedBoundary.reason === 'hold_elapsed'");
    expect(SOURCE).toContain("? 'progress_extension_elapsed'");
    // The long ceiling belongs only to attachment upload. A composer lease by
    // itself must not pin the provider throughout answer collection.
    expect(SOURCE).toContain('if (extendedMs >= ceilingMs) break;');
    expect(SOURCE).toContain('const composerTransactionActive = entry.providerComposerTransactionActive === true');
    expect(SOURCE).toContain('const ceilingMs = attachmentInFlight');
    expect(SOURCE).not.toContain('const ceilingMs = (composerTransactionActive || attachmentInFlight)');
    expect(SOURCE).toContain('const attachmentInFlight = progressStage === ATTACHMENT_PROGRESS_STAGE;');
    expect(SOURCE).toContain('ATTACHMENT_FOCUS_EXTENSION_CEILING_MS');
    // The waiter has to outlast the longest reachable hold, or an
    // attachment-extended hold can never resolve as an insertion.
    expect(SOURCE).toContain('Math.max(progressFocusExtensionMs, ATTACHMENT_FOCUS_EXTENSION_CEILING_MS)');
  });

  test('observed provider Send ends the focus extension', () => {
    expect(SOURCE).toContain('entry.providerSendActionObservedDispatchId === dispatchId');
    expect(SOURCE).toContain("progressStage === 'send_action_requested'");
    expect(SOURCE).toContain("boundary = { reason: 'send_action_observed'");
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

  test('prompt insertion is progress and does not release focus before Send', async () => {
    const runtime = buildRuntime();
    const neverSubmitted = new Promise(() => {});
    await expect(runtime.waitBoundary(
      neverSubmitted,
      Promise.resolve({ insertionState: 'inserted' }),
      25
    )).resolves.toMatchObject({ reason: 'hold_elapsed' });
  });

  test('a failed insertion releases focus as a terminal transaction failure', async () => {
    const runtime = buildRuntime();
    await expect(runtime.waitBoundary(
      new Promise(() => {}),
      Promise.resolve({ insertionState: 'failed' }),
      1000
    )).resolves.toMatchObject({ reason: 'insertion_failed' });
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

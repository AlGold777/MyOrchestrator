// Verifies F1: a denied recovery (resend) intent backs the entry off and does not
// re-emit RECOVERY_INTENT_DENIED on every call, so periodic callers
// (runPromptDispatchSupervisor) stop spamming identical denials.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RecoveryIntent = require('../shared/recovery-intent');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
  'utf8'
);

function makeSandbox() {
  const telemetry = [];
  const diagnostics = [];
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
    TERMINAL_STATUSES: [],
    MutexManager: class {
      acquire() { return Promise.resolve(() => {}); }
    },
    TimingConfig: { getTiming: (_name, def) => def },
    chrome: {
      tabs: { sendMessage: () => {}, reload: () => {} },
      runtime: { getURL: (p) => `chrome-extension://test/${p}` }
    },
    emitTelemetry: (llm, ev, meta) => telemetry.push({ llm, ev, meta }),
    broadcastDiagnostic: (llm, d) => diagnostics.push({ llm, d }),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    jobState: { session: { startTime: 1 }, llms: {} }
  };
  context.self = context;
  context.RecoveryIntent = RecoveryIntent;
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: 'dispatch-coordinator.js' });
  return { context, telemetry, diagnostics };
}

describe('recovery deny throttle (F1)', () => {
  test('denied resend sets a backoff and emits the denial only once per window', async () => {
    const { context, telemetry } = makeSandbox();
    // Entry with strong answer-evidence -> resend intent must be denied.
    const entry = {
      status: 'GENERATING',
      answer: 'x'.repeat(300),
      promptSubmittedAt: Date.now() - 1000,
      submitSource: 'content',
      confirmedDispatchId: 'Le Chat:1:1',
      lastDispatchMeta: { dispatchId: 'Le Chat:1:1' }
    };
    context.jobState.llms['Le Chat'] = entry;

    await context.dispatchPromptToTab('Le Chat', 5, 'prompt', [], 'retry_supervisor');

    const denials = () => telemetry.filter((t) => t.ev === 'RECOVERY_INTENT_DENIED');
    expect(denials()).toHaveLength(1);
    expect(entry.recoveryDeniedUntil).toBeGreaterThan(Date.now());

    // Simulate the next supervisor ticks hitting the same entry: no new denial spam.
    await context.dispatchPromptToTab('Le Chat', 5, 'prompt', [], 'retry_supervisor');
    await context.dispatchPromptToTab('Le Chat', 5, 'prompt', [], 'retry_supervisor');
    expect(denials()).toHaveLength(1);
  });

  test('supervisor skips entries inside the recovery-deny backoff window', () => {
    // Structural guarantee: the supervisor honors recoveryDeniedUntil.
    expect(SRC).toContain('entry.recoveryDeniedUntil && now < entry.recoveryDeniedUntil');
  });
});

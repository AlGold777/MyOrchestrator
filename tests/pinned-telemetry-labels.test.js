// One-shot causal dispatch events must survive diagnostics-buffer trimming.
// Run 1782997990116 (632 events): guard decisions survived, but the causal
// DISPATCH_BASELINE_CAPTURED (carrying anchorAnswerCount) was evicted, so the
// export could not show why the stale-baseline guard had a baseline.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TELEMETRY_LOGS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'telemetry-logs.js'),
  'utf8'
);

const ONE_SHOT_CAUSAL_LABELS = [
  'TRANSPORT_DECISION',
  'PROMPT_SUBMITTED_ACCEPTED',
  'PROMPT_SUBMITTED_INFERRED',
  'PROMPT_SUBMITTED_PENDING',
  'PAGE_READY_BLOCKED',
  'DISPATCH_BASELINE_CAPTURED',
  'UNSAFE_REUSE_SKIPPED',
  'DONOR_STICKY_TAB_REUSED',
  'PROVIDER_TRUSTED_ENTER_DISPATCHED',
  'PROVIDER_TRUSTED_SEND_CLICKED',
  'PROVIDER_TRUSTED_ENTER_FAILED',
  'PROVIDER_TRUSTED_SEND_FAILED',
  'FINALIZE_BLOCKED_SUBMIT_PENDING',
  'SENDER_TAB_MISMATCH_REJECTED',
  'STALE_SNAPSHOT_SIGNATURE_EXCLUDED',
  'TAB_CREATE_FAILED'
];

function createTelemetryLogsSandbox() {
  class TTLMapStub {
    constructor() { this.map = new Map(); }
    get(key) { return this.map.get(key); }
    set(key, value) { this.map.set(key, value); }
    has(key) { return this.map.has(key); }
    delete(key) { return this.map.delete(key); }
  }
  const context = {
    console, Date, JSON, Math, Set, Map, Array, Object, Number, String, Boolean, RegExp, Promise,
    setTimeout, clearTimeout,
    TTLMap: TTLMapStub,
    jobState: { llms: {} },
    chrome: {
      storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
      runtime: { lastError: null }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(TELEMETRY_LOGS_SOURCE, context, { filename: 'background/telemetry-logs.js' });
  return context;
}

describe('pinned one-shot causal dispatch events', () => {
  test('trim keeps causal labels under a noise flood', () => {
    const context = createTelemetryLogsSandbox();
    const baseTs = 1782997990116;
    const causalEvents = ONE_SHOT_CAUSAL_LABELS.map((label, i) => ({
      ts: baseTs + i, label, platform: 'GPT', level: 'info'
    }));
    const noise = Array.from({ length: 700 }, (_, i) => ({
      ts: baseTs + 1000 + i,
      label: i % 2 ? 'SELECTOR_STATS' : 'MANUAL_PING_FAIL',
      platform: 'GPT',
      level: 'warning'
    }));
    const trimmed = context.trimDiagnosticsBuffer([...causalEvents, ...noise], 200);
    const keptLabels = new Set(trimmed.map((e) => e.label));
    ONE_SHOT_CAUSAL_LABELS.forEach((label) => {
      expect({ label, kept: keptLabels.has(label) }).toEqual({ label, kept: true });
    });
  });

  test('both trim paths pin the same causal labels', () => {
    const routerSource = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
    const routerPinned = routerSource.slice(routerSource.indexOf('DIAG_PINNED_LABELS'));
    ONE_SHOT_CAUSAL_LABELS.forEach((label) => {
      expect(TELEMETRY_LOGS_SOURCE).toContain(`'${label}'`);
      expect(routerPinned).toContain(`'${label}'`);
    });
  });
});

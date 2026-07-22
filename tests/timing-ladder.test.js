// Timeout ladder invariants (timing review 2026-07-02): every outer ceiling is
// strictly above the inner mechanism it governs, in BOTH wait profiles, and the
// background follows the same longGenerationMode flag as the content side.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const num = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = (\\d+)`));
  if (!m) throw new Error(`constant ${name} not found`);
  return Number(m[1]);
};

const ORCH = read('background', 'job-orchestrator.js');
const DISPATCH = read('background', 'dispatch-coordinator.js');
const PIPE_CFG = read('content-scripts', 'pipeline-config.js');

describe('timeout ladder invariants', () => {
  const ladder = (profile) => ({
    contentHardMax: profile === 'long'
      ? Number(PIPE_CFG.match(/hardMax: (\d+)\s*\n\s*\}\s*,\s*\n\s*intelligentRetry/) ? RegExp.$1 : 450000)
      : 180000,
    deferMax: num(ORCH, `DEFER_STREAM_FINAL_MAX_${profile.toUpperCase()}_MS`),
    hardStop: num(DISPATCH, `SCRIPT_RUNTIME_HARD_STOP_${profile.toUpperCase()}_MS`),
    round4Gate: num(ORCH, `ROUND4_PENDING_WAIT_MAX_${profile.toUpperCase()}_MS`),
    probesWindow: num(ORCH, `ADAPTIVE_PROBE_TOTAL_WINDOW_${profile.toUpperCase()}_MS`),
    baselineWindow: num(ORCH, `BASELINE_GUARD_WINDOW_${profile.toUpperCase()}_MS`)
  });

  ['short', 'long'].forEach((profile) => {
    test(`${profile}: deferMax <= contentHardMax+margin < hardStop < round4Gate < probesWindow; baseline outlives generation`, () => {
      const L = ladder(profile);
      expect(L.deferMax).toBeLessThan(L.hardStop);
      expect(L.hardStop).toBeGreaterThan(L.contentHardMax);          // hard stop above content ceiling
      expect(L.round4Gate).toBeGreaterThan(L.hardStop);              // gate closes after hard stop
      expect(L.probesWindow).toBeGreaterThan(L.hardStop);            // recovery outlives the hard stop
      expect(L.baselineWindow).toBeGreaterThan(L.contentHardMax);    // stale guard survives the whole generation
    });
  });

  test('long ceilings are strictly above short ceilings', () => {
    const s = ladder('short');
    const l = ladder('long');
    ['deferMax', 'hardStop', 'round4Gate', 'probesWindow', 'baselineWindow'].forEach((key) => {
      expect(l[key]).toBeGreaterThan(s[key]);
    });
  });

  test('all ladder consumers resolve through the profiled getters', () => {
    ['getDeferStreamFinalMaxMs()', 'getRound4PendingWaitMaxMs()', 'getAdaptiveProbeTotalWindowMs()', 'getBaselineGuardWindowMs()'].forEach((getter) => {
      expect(ORCH).toContain(getter);
    });
    expect(DISPATCH).toContain('getScriptRuntimeHardStopMs()');
    // No bare fixed-constant usages left.
    expect(ORCH).not.toMatch(/[^_A-Z]DEFER_STREAM_FINAL_MAX_MS/);
    expect(DISPATCH).not.toMatch(/[^_A-Z]SCRIPT_RUNTIME_HARD_STOP_MS/);
  });
});

describe('background follows longGenerationMode (behavioral)', () => {
  function loadSharedState() {
    let storageListener = null;
    const context = {
      console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, RegExp, JSON,
      setTimeout, clearTimeout,
      TTLMap: class { constructor() { this.m = new Map(); } get(k) { return this.m.get(k); } set(k, v) { this.m.set(k, v); } },
      chrome: {
        storage: {
          local: { get: jest.fn((key, cb) => cb({ longGenerationMode: false })) },
          onChanged: { addListener: (fn) => { storageListener = fn; } }
        }
      },
      self: null
    };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(read('background', 'shared-state.js'), context, { filename: 'background/shared-state.js' });
    return { context, fireStorageChange: (changes, area) => storageListener?.(changes, area) };
  }

  test('profile flips ladder values on storage change', () => {
    const { context, fireStorageChange } = loadSharedState();
    expect(context.isLongGenerationProfile()).toBe(false);
    expect(context.profiledTimeoutMs(210000, 480000)).toBe(210000);

    fireStorageChange({ longGenerationMode: { newValue: true } }, 'local');
    expect(context.isLongGenerationProfile()).toBe(true);
    expect(context.profiledTimeoutMs(210000, 480000)).toBe(480000);

    fireStorageChange({ longGenerationMode: { newValue: false } }, 'local');
    expect(context.isLongGenerationProfile()).toBe(false);
  });
});

describe('dispatch tuning (slice 2)', () => {
  test('no zero-delay retries in any dispatch backoff', () => {
    const m1 = DISPATCH.match(/DISPATCH_RETRY_BACKOFF_MS = \[([^\]]+)\]/);
    const m2 = DISPATCH.match(/CONSERVATIVE_RETRY_BACKOFF_MS = \[([^\]]+)\]/);
    [m1, m2].forEach((m) => {
      const values = m[1].split(',').map((v) => Number(v.trim()));
      values.forEach((v) => expect(v).toBeGreaterThanOrEqual(500));
    });
  });

  test('reload path waits longer than the warm-tab check', () => {
    const TAB_MANAGER = read('background', 'tab-manager.js');
    expect(num(TAB_MANAGER, 'TAB_READY_RELOAD_TIMEOUT_MS')).toBeGreaterThan(15000);
    expect(TAB_MANAGER).toContain('waitForTabComplete(tabId, TAB_READY_RELOAD_TIMEOUT_MS, {');
  });
});

describe('knob consolidation (slice 3)', () => {
  test('round2 batch budget scales with model count', () => {
    expect(ORCH).toContain('const getRound2BatchBudgetMs = (modelCount) => Math.max(');
    expect(ORCH).toContain('getRound2BatchBudgetMs(selectedLLMs.length)');
    // 9 models must get more than the old fixed 45s.
    const slice = num(ORCH, 'ROUND2_MODEL_TIME_SLICE_MS');
    expect(Math.max(45000, 9 * slice)).toBeGreaterThan(45000);
  });

  test('visit quota fits the planned visit schedule', () => {
    const HP = read('background', 'human-presence.js');
    expect(num(HP, 'VISIT_QUOTA_MAX_MS')).toBeGreaterThanOrEqual(20000);
  });

  test('one stability threshold: stable-pending equals defer stable-force', () => {
    expect(ORCH).toContain('const STABLE_PENDING_AUTO_FINALIZE_MS = DEFER_STREAM_STABLE_FORCE_MS;');
  });

  test('submit timeout has a single source (ModelPolicy); legacy map removed', () => {
    expect(DISPATCH).not.toContain('const PROMPT_SUBMIT_TIMEOUTS_MS = {');
    expect(DISPATCH).toContain("TimingConfig.getTiming('promptSubmitTimeoutMs', 15000)");
    const TIMING = read('config', 'timing.js');
    expect(TIMING).toContain('promptSubmitTimeoutMs: 15_000,');
  });

  test('length thresholds live in answer-length-policy', () => {
    const POLICY = read('shared', 'answer-length-policy.js');
    ['earlyGuardForceSuccessChars: 1800', 'minPartialChars: 120', 'manualLatestMinChars: 20'].forEach((field) => {
      expect(POLICY).toContain(field);
    });
    expect(ORCH).toContain('self.AnswerLengthPolicy?.DEFAULTS?.earlyGuardForceSuccessChars || 1800');
    expect(ORCH).toContain('self.AnswerLengthPolicy?.DEFAULTS?.minPartialChars || 120');
  });
});

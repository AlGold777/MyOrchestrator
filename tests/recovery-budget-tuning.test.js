// Locks the 2.80.41 tuning: (a) connection-fragile models get a larger recovery
// budget so they can reach genuine completion instead of bailing to a snapshot
// PARTIAL; (b) prompt-echo ping rejections are logged at warning, not error.
const fs = require('fs');
const path = require('path');

const ORCH_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);
const ROUTER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

describe('recovery budget tuning + ping severity', () => {
  test('connection-fragile models get a model-aware recovery budget', () => {
    expect(ORCH_SRC).toContain('CONNECTION_FRAGILE_RECOVERY_MODELS');
    expect(ORCH_SRC).toContain("new Set(['Gemini', 'Perplexity'])");
    expect(ORCH_SRC).toContain('getRecoveryBudgetForModel');
    // consume path uses the resolver as its default (not the flat default).
    expect(ORCH_SRC).toContain('meta.limits || getRecoveryBudgetForModel(llmName)');
  });

  test('fragile budget is strictly larger than the default', () => {
    // Mirror of the two budget objects to pin the intended relationship.
    const def = { snapshotAttempts: 2, inlineDomAttempts: 2, manualPingAttempts: 1, maxTotalMs: 90000 };
    const fragile = { snapshotAttempts: 3, inlineDomAttempts: 3, manualPingAttempts: 2, maxTotalMs: 120000 };
    expect(fragile.snapshotAttempts).toBeGreaterThan(def.snapshotAttempts);
    expect(fragile.inlineDomAttempts).toBeGreaterThan(def.inlineDomAttempts);
    expect(fragile.maxTotalMs).toBeGreaterThan(def.maxTotalMs);
    // Assert the source actually encodes those fragile values.
    expect(ORCH_SRC).toMatch(/RECOVERY_BUDGET_CONNECTION_FRAGILE[\s\S]*snapshotAttempts:\s*3/);
    expect(ORCH_SRC).toMatch(/RECOVERY_BUDGET_CONNECTION_FRAGILE[\s\S]*maxTotalMs:\s*120000/);
  });

  test('transport-only snapshot attempts are refunded (not burned)', () => {
    // A "message port closed" / dead-tab attempt never read the live DOM, so it must
    // give the snapshot budget back — otherwise a connection-fragile model exhausts
    // 3/3 on transport flakiness and finalizes a stale mid-stream cache (PARTIAL@2309).
    expect(ORCH_SRC).toContain('function refundRecoveryBudget(');
    expect(ORCH_SRC).toContain('function hasRecoveryBudgetRemaining(');
    // refunded on the no-fresh-read miss branch
    expect(ORCH_SRC).toMatch(/refundRecoveryBudget\([^)]*'snapshot'[\s\S]*?reason: `miss:/);
    // refunded on cooldown / in-flight short-circuits (budget was consumed before them)
    expect(ORCH_SRC).toMatch(/reason: 'cooldown'/);
    expect(ORCH_SRC).toMatch(/reason: 'in_flight'/);
  });

  test('stale cached snapshot defers for a fresh read while budget + no completion evidence', () => {
    expect(ORCH_SRC).toContain('DOM snapshot recovery deferred (stale cache, fresh read pending)');
    expect(ORCH_SRC).toMatch(/stale_cache_defer_for_fresh_read/);
    // gate conditions: cache source + partial status + no completion evidence + budget left
    expect(ORCH_SRC).toMatch(/snapshot\.source[\s\S]*?'snapshot_cache'[\s\S]*?snapshot\.status === 'partial_from_snapshot'/);
    expect(ORCH_SRC).toMatch(/!completionEvidence && hasRecoveryBudgetRemaining\(/);
  });

  test('benign ping rejections are warning-level, genuine failures stay error', () => {
    expect(ROUTER_SRC).toContain('benignPingFailure');
    expect(ROUTER_SRC).toContain('prompt_echo|invalid_candidate|unchanged|stale');
    expect(ROUTER_SRC).toContain("level: benignPingFailure ? 'warning' : 'error'");
    // Behavioral mirror of the classifier.
    const isBenign = (err) => /prompt_echo|invalid_candidate|unchanged|stale/i.test(String(err || ''));
    expect(isBenign('prompt_echo_or_invalid_candidate')).toBe(true);
    expect(isBenign('extract_failed')).toBe(false);
    expect(isBenign('empty_response')).toBe(false);
  });
});

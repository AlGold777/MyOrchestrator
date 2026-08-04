const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ORACLE = require(path.join(ROOT, 'shared', 'provider-submit-confirmation.js'));
const DISPATCH_COORDINATOR = fs.readFileSync(path.join(ROOT, 'background', 'dispatch-coordinator.js'), 'utf8');
const MESSAGE_ROUTER = fs.readFileSync(path.join(ROOT, 'background', 'message-router.js'), 'utf8');

// 2.81.117 field regression. Gemini and Claude each carried a private submit
// oracle that returned true for "nothing happened": an empty composer, a disabled
// Send button (disabled precisely because the composer is empty) and any
// page-wide spinner. Field evidence for Gemini: composerLength 190 at send, 0 at
// "send confirmed", and TURN_RESOLUTION unresolved — the turn was never committed
// but the run reported PROMPT_SUBMITTED_ACCEPTED.
describe('provider submit proof contract', () => {
  const PROVIDERS = ['gemini', 'claude', 'lechat', 'perplexity'];

  const sourceFor = (name) => fs.readFileSync(
    path.join(ROOT, 'content-scripts', `content-${name}.js`), 'utf8'
  );

  test('shared oracle never accepts composer clearing as proof', () => {
    const baseline = ORACLE.capture({
      userTurnCount: 3, responseCount: 3, composerTextLength: 190, generationElements: []
    });
    const cleared = ORACLE.evaluate(baseline, {
      userTurnCount: 3, responseCount: 3, composerTextLength: 0, generationElements: []
    });
    expect(cleared.composerCleared).toBe(true);
    expect(cleared.confirmed).toBe(false);
    expect(cleared.directSignals).toEqual([]);
  });

  test('shared oracle confirms only on new current-turn evidence', () => {
    const baseline = ORACLE.capture({
      userTurnCount: 3, responseCount: 3, composerTextLength: 190, generationElements: []
    });
    const newTurn = ORACLE.evaluate(baseline, {
      userTurnCount: 4, responseCount: 3, composerTextLength: 0, generationElements: []
    });
    expect(newTurn.confirmed).toBe(true);
    expect(newTurn.directSignals).toContain('new_user_turn');
  });

  test('a completed native browser dispatch is not submission evidence by itself', () => {
    const baseline = ORACLE.capture({
      userTurnCount: 3, responseCount: 3, composerTextLength: 190, generationElements: []
    });
    const nativeDispatch = ORACLE.evaluate(baseline, {
      userTurnCount: 3,
      responseCount: 3,
      composerTextLength: 190,
      generationElements: [],
      trustedBrowserDispatch: true
    });
    expect(nativeDispatch.confirmed).toBe(false);
    expect(nativeDispatch.directSignals).not.toContain('trusted_browser_dispatch');
    expect(nativeDispatch.trustedBrowserDispatch).toBe(true);
  });

  test('a pre-existing generation element is not fresh evidence', () => {
    const stale = { id: 'stale-spinner' };
    const baseline = ORACLE.capture({
      userTurnCount: 3, responseCount: 3, composerTextLength: 190, generationElements: [stale]
    });
    const unchanged = ORACLE.evaluate(baseline, {
      userTurnCount: 3, responseCount: 3, composerTextLength: 0, generationElements: [stale]
    });
    expect(unchanged.freshGenerationElement).toBe(false);
    expect(unchanged.confirmed).toBe(false);
  });

  test('every provider page loads the shared oracle', () => {
    const blocks = MANIFEST.content_scripts || [];
    PROVIDERS.forEach((name) => {
      const owning = blocks.filter((block) => (block.js || []).some((file) => (
        file.endsWith(`content-${name}.js`)
      )));
      expect(owning.length).toBeGreaterThan(0);
      // The oracle may live in the shared block that matches every provider page,
      // so accept it there as well as in the provider-specific block.
      const shared = blocks[0] || {};
      const loaded = (shared.js || []).includes('shared/provider-submit-confirmation.js')
        || owning.some((block) => (block.js || []).includes('shared/provider-submit-confirmation.js'));
      expect(loaded).toBe(true);
    });
  });

  test('no provider treats an empty or shortened composer as submission proof', () => {
    PROVIDERS.forEach((name) => {
      const src = sourceFor(name);
      // Any surviving "composer is empty -> return true" shortcut reintroduces the
      // exact defect this contract exists to prevent.
      expect(src).not.toMatch(/if\s*\(\s*!\s*current\.length\s*\)\s*return true/);
      expect(src).not.toMatch(/if\s*\(\s*!\s*composerText\.length\s*\)\s*return true/);
    });
  });

  test('no provider treats a disabled Send button as submission proof', () => {
    PROVIDERS.forEach((name) => {
      const src = sourceFor(name);
      expect(src).not.toMatch(/sendButtonCandidate\?\.disabled[^\n]*\)\s*return true/);
    });
  });

  test('dispatch creates and propagates one generation-scoped attempt identity', () => {
    expect(DISPATCH_COORDINATOR).toContain("const attemptId = `${dispatchId}:generation:${entry.generationEpoch}`");
    expect(DISPATCH_COORDINATOR).toContain('entry.lastDispatchMeta = { dispatchReason: reason, sessionId, ...dispatchIdentityMeta }');
    expect(DISPATCH_COORDINATOR).toContain('...dispatchIdentityMeta,');
    expect(MESSAGE_ROUTER).toContain('generationEpoch: normalizedMeta.generationEpoch ?? entry?.generationEpoch ?? null');
    expect(MESSAGE_ROUTER).toContain('attemptId: normalizedMeta.attemptId || entry?.lastDispatchMeta?.attemptId || null');
  });

  test('fast confirmation cannot regress back to pending', () => {
    expect(DISPATCH_COORDINATOR).toContain('const dispatchAlreadyConfirmed = entry.confirmedDispatchId === dispatchId');
    expect(DISPATCH_COORDINATOR).toMatch(/if \(!dispatchAlreadyConfirmed\) \{[\s\S]*PROMPT_SUBMITTED_PENDING/);
  });
});

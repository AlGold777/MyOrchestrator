(function initDebateStagnationWarning(root) {
  'use strict';
  function assess({ roundDeltas = [], checkpointStats = {}, budget = {} } = {}) {
    const reasons = [];
    const recent = roundDeltas.slice(-2);
    const unwrap = (entry) => entry?.delta || entry || {};
    const empty = recent.length >= 2 && recent.every((entry) => {
      const delta = unwrap(entry);
      return !(delta.newClaims || []).length && !(delta.newObjections || []).length && !(delta.revisions || []).length;
    });
    if (empty) reasons.push('two_empty_round_deltas');
    const stagnating = recent.length >= 2 && recent.every((entry) => Number(unwrap(entry)?.stagnation?.newContentRatio || 0) === 0);
    if (checkpointStats.stagnating || stagnating) reasons.push('stagnation_detected');
    if (Number(checkpointStats.count || 0) >= Number(budget.softStopAfterCheckpoints || 10)) reasons.push('soft_checkpoint_budget');
    return { recommendation: reasons.length ? 'suggest_finalize' : 'continue', reasons };
  }
  const api = Object.freeze({ assess });
  root.DebateStagnationWarning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

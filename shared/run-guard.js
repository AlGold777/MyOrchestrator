// shared/run-guard.js
// Prevents overlapping orchestrator runs from sharing mutable background state.

(function initRunGuard(root) {
  'use strict';

  function canStartNewRun(session, options = {}) {
    if (session?.roundsInProgress && options.force !== true) {
      return {
        ok: false,
        errorCode: 'RUN_ALREADY_ACTIVE',
        activeSessionId: session.sessionId || session.pipelineRunId || null
      };
    }
    return { ok: true };
  }

  const api = Object.freeze({
    canStartNewRun
  });

  root.RunGuard = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

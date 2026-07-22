// Neutral Debate registry API.
//
// The implementation is shared with the Triad registry to keep anchor
// validation, artifacts, triggers, pending actions and derived logs identical
// across Duel and Triad. Existing Triad imports remain valid.

(function initDebateRegistry(root) {
  'use strict';

  const api = typeof require === 'function'
    ? require('./triad-registry')
    : root.TriadRegistry;

  root.DebateRegistry = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// shared/logger.js
// Leveled, gated logger to cut release-path console noise (README roadmap:
// "Reduce release-path console noise"; global-code-review-2026-06-18.md F-D).
//
// Background alone carried ~116 console.log calls firing on every dispatch,
// retry, and module load. In an MV3 service worker that noise costs real time
// and buries the structured telemetry/diagnostics that actually matter.
//
// Policy:
//   - error / warn  -> ALWAYS emitted (real problems must stay visible).
//   - debug / info / log -> gated behind a debug flag, DEFAULT OFF.
//
// Call sites use `globalThis.LLMLog?.debug?.(...)` so they are no-ops (never
// throw) in any context where the logger was not installed — including the
// isolated vm.runInContext sandboxes the background tests run in. That keeps
// the conversion zero-touch for the test harness.
//
// Enabling verbose logs without a rebuild: set chrome.storage.local
// { "__llm_debug_logging__": true } (or globalThis.__LLM_DEBUG__ = true), then
// reload the service worker / page.

(function initLogger(root) {
  'use strict';

  const STORAGE_FLAG = '__llm_debug_logging__';
  const GLOBAL_FLAG = '__LLM_DEBUG__';

  let enabled = false;
  try { enabled = !!root[GLOBAL_FLAG]; } catch (_) { /* sealed global */ }

  // Hydrate the persisted flag asynchronously so a developer can flip verbose
  // logging on via storage without touching code. Failures are silent.
  try {
    const storage = (typeof chrome !== 'undefined' && chrome?.storage?.local) || null;
    if (storage?.get) {
      storage.get(STORAGE_FLAG, (data) => {
        try {
          if (chrome.runtime?.lastError) return;
          if (data && data[STORAGE_FLAG]) enabled = true;
        } catch (_) {}
      });
    }
    if (chrome?.storage?.onChanged?.addListener) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes && STORAGE_FLAG in changes) {
          enabled = !!changes[STORAGE_FLAG].newValue;
        }
      });
    }
  } catch (_) {}

  const hasConsole = typeof console !== 'undefined';
  const bind = (method, fallback) => {
    if (hasConsole && typeof console[method] === 'function') return console[method].bind(console);
    if (hasConsole && typeof console[fallback] === 'function') return console[fallback].bind(console);
    return () => {};
  };

  const emitLog = bind('log', 'log');
  const emitInfo = bind('info', 'log');
  const emitWarn = bind('warn', 'log');
  const emitError = bind('error', 'log');

  const api = {
    isEnabled: () => enabled,
    setEnabled: (value) => { enabled = !!value; },
    debug: (...args) => { if (enabled) emitLog(...args); },
    log: (...args) => { if (enabled) emitLog(...args); },
    info: (...args) => { if (enabled) emitInfo(...args); },
    // Always visible — real problems must not be silenced by the gate.
    warn: (...args) => { emitWarn(...args); },
    error: (...args) => { emitError(...args); }
  };

  root.LLMLog = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));

// shared/visit-policy.js
// Shared classification for foreground tab visits used by orchestration.

(function initVisitPolicy(root) {
  'use strict';

  const DEFAULT_MIN_USEFUL_VISIT_MS = 1500;
  const DEFAULT_MAX_SHORT_RETRIES = 1;
  const NON_RETRY_REASONS = new Set([
    'automation_terminal_success',
    'automation_session_stale',
    'terminal_success',
    'terminal_success_pre_visit',
    'terminal_success_automation_skip',
    'terminal_focus_skip',
    'session_cleared',
    'session_closed',
    'stop_loop',
    'tab_closed'
  ]);

  function normalizeReason(reason) {
    return String(reason || 'unknown').trim() || 'unknown';
  }

  function normalizeDuration(durationMs) {
    const value = Number(durationMs);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  function classifyVisit(input = {}) {
    const reason = normalizeReason(input.reason);
    const source = String(input.source || 'unknown').trim() || 'unknown';
    const durationMs = normalizeDuration(input.durationMs);
    const minUsefulMs = Math.max(
      0,
      normalizeDuration(input.minUsefulMs || DEFAULT_MIN_USEFUL_VISIT_MS)
    );
    const nonRetryable = NON_RETRY_REASONS.has(reason);
    const shortVisit = !nonRetryable && durationMs < minUsefulMs;
    return Object.freeze({
      schemaVersion: 1,
      reason,
      source,
      durationMs,
      minUsefulMs,
      shortVisit,
      usefulVisit: !shortVisit,
      retryable: shortVisit && !nonRetryable
    });
  }

  function shouldRetryVisit(summary = {}, options = {}) {
    const maxShortRetries = Math.max(
      0,
      normalizeDuration(options.maxShortRetries ?? DEFAULT_MAX_SHORT_RETRIES)
    );
    const attempt = Math.max(0, normalizeDuration(options.attempt || 0));
    return summary?.retryable === true
      && summary?.shortVisit === true
      && attempt < maxShortRetries;
  }

  const api = Object.freeze({
    DEFAULT_MIN_USEFUL_VISIT_MS,
    DEFAULT_MAX_SHORT_RETRIES,
    NON_RETRY_REASONS,
    classifyVisit,
    shouldRetryVisit
  });

  root.VisitPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

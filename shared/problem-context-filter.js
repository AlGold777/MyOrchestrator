// Shared problem-event classifier and causal-context filter for telemetry exports.
(function initProblemContextFilter(root) {
  'use strict';

  const DEFAULT_CONTEXT_BEFORE = 10;
  const PROBLEM_TOKEN_RE = /(ERROR|FAILED|FAILURE|TIMEOUT|REJECTED|EXCEPTION|UNSAFE|BLOCKED|MISMATCH|DIVERGENCE)/i;
  const PROBLEM_LEVELS = new Set(['error', 'warning', 'high', 'critical']);

  function isProblem(item = {}) {
    const level = String(item?.level || item?.severity || '').toLowerCase();
    const searchable = [
      item?.label,
      item?.event,
      item?.eventType,
      item?.action,
      item?.status,
      item?.type,
      item?.details,
      item?.message,
      item?.reasonCode,
      item?.meta?.event,
      item?.meta?.reason,
      item?.meta?.message
    ].filter(Boolean).join(' ');
    return PROBLEM_LEVELS.has(level)
      || String(item?.type || '').toUpperCase() === 'ERROR'
      || PROBLEM_TOKEN_RE.test(searchable);
  }

  function filterWithContext(items = [], options = {}) {
    const source = Array.isArray(items) ? items.slice() : [];
    const contextBefore = Math.max(0, Number(options.contextBefore ?? DEFAULT_CONTEXT_BEFORE) || 0);
    const classify = typeof options.isProblem === 'function' ? options.isProblem : isProblem;
    const getContextKey = typeof options.getContextKey === 'function'
      ? options.getContextKey
      : () => '__all__';
    const keep = new Set();

    source.forEach((item, index) => {
      if (!classify(item)) return;
      keep.add(index);
      const contextKey = String(getContextKey(item) ?? '');
      for (let cursor = index - 1, added = 0; cursor >= 0 && added < contextBefore; cursor -= 1) {
        if (String(getContextKey(source[cursor]) ?? '') !== contextKey) continue;
        keep.add(cursor);
        added += 1;
      }
    });

    return source.filter((_, index) => keep.has(index));
  }

  const api = Object.freeze({
    DEFAULT_CONTEXT_BEFORE,
    isProblem,
    filterWithContext
  });

  root.ProblemContextFilter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

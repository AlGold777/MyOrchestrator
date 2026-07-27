// shared/telemetry-meta-delta.js
// Lossless delta-compaction for telemetry event `meta` objects.
//
// Every telemetry event carries a `meta` object with ~15-20 fields
// (extVersion, runSessionId, llmName, tabId, pipelineRunId, ...). Most of
// these are constant across all events emitted for the same platform within
// a run, but background/telemetry-logs.js rebuilds the full object on every
// single event, so it gets serialized in full on every event -- the root
// cause of oversized diagnostics storage and telemetry JSON exports.
//
// compactTelemetryEvents() replaces `meta` on each event (after the first
// seen for a given platform) with only the keys that changed since the
// previous event for that same platform. expandTelemetryEvents() reverses
// this exactly, so any consumer that reads `event.meta.xxx` on an expanded
// array sees the identical object it would have seen before compaction.

'use strict';

(function initTelemetryMetaDelta(root) {
  const DELTA_MARKER = '__telemetryMetaDelta';
  const REMOVED_KEYS = '__telemetryMetaRemovedKeys';

  function groupKeyOf(event) {
    return String(event?.platform || event?.meta?.llmName || event?.llmName || 'unknown');
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch (_) {
        return false;
      }
    }
    return false;
  }

  function compactTelemetryEvents(events) {
    if (!Array.isArray(events)) return [];
    const lastFullMeta = new Map();
    return events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      const meta = event.meta;
      if (!meta || typeof meta !== 'object') return event;
      const key = groupKeyOf(event);
      const prev = lastFullMeta.get(key);
      lastFullMeta.set(key, meta);
      if (!prev) return event;

      const metaKeys = Object.keys(meta);
      const delta = {};
      let deltaCount = 0;
      metaKeys.forEach((k) => {
        if (!sameValue(meta[k], prev[k])) {
          delta[k] = meta[k];
          deltaCount += 1;
        }
      });
      const removedKeys = Object.keys(prev).filter((k) => !(k in meta));

      if (!deltaCount && !removedKeys.length) {
        return { ...event, meta: { [DELTA_MARKER]: true } };
      }
      // Only worth compacting if the delta is actually smaller than the
      // full object; otherwise keep the event untouched (still round-trips
      // correctly since expand() treats any event without the marker as a
      // fresh baseline).
      if (deltaCount + removedKeys.length >= metaKeys.length) {
        return event;
      }
      const compactedMeta = { [DELTA_MARKER]: true, ...delta };
      if (removedKeys.length) compactedMeta[REMOVED_KEYS] = removedKeys;
      return { ...event, meta: compactedMeta };
    });
  }

  function expandTelemetryEvents(events) {
    if (!Array.isArray(events)) return [];
    const lastFullMeta = new Map();
    return events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      const meta = event.meta;
      const key = groupKeyOf(event);
      if (!meta || typeof meta !== 'object' || !meta[DELTA_MARKER]) {
        if (meta && typeof meta === 'object') lastFullMeta.set(key, meta);
        return event;
      }
      const prev = lastFullMeta.get(key) || {};
      const removedKeys = Array.isArray(meta[REMOVED_KEYS]) ? meta[REMOVED_KEYS] : [];
      const merged = { ...prev };
      Object.keys(meta).forEach((k) => {
        if (k === DELTA_MARKER || k === REMOVED_KEYS) return;
        merged[k] = meta[k];
      });
      removedKeys.forEach((k) => { delete merged[k]; });
      lastFullMeta.set(key, merged);
      return { ...event, meta: merged };
    });
  }

  const api = { compactTelemetryEvents, expandTelemetryEvents };
  root.TelemetryMetaDelta = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));

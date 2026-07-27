// shared/telemetry-meta-delta.js
// Lossless nested delta-compaction for telemetry event `meta` objects.
//
// Every telemetry event carries a `meta` object with ~15-20 top-level fields
// (extVersion, runSessionId, llmName, tabId, pipelineRunId, ...) plus several
// heavy nested state snapshots (previousState, nextState, legacyBefore,
// legacyAfter, modelRunState, projection, payload, decisionSnapshot,
// telemetryTaxonomy). background/telemetry-logs.js rebuilds the whole object on
// every single event, so without compaction it is serialized in full on every
// event -- the root cause of oversized diagnostics storage and JSON exports.
//
// compactTelemetryEvents() replaces `meta` on each event (after the first seen
// for a given platform) with only what changed since the previous event for that
// same platform. The diff recurses into plain objects: when one field inside
// previousState changes, only that field is emitted, not the whole snapshot --
// a top-level-only diff was measured to save just ~22% per event on real runs
// because these nested snapshots dominate the payload.
// expandTelemetryEvents() reverses this exactly, so any consumer that reads
// `event.meta.xxx` on an expanded array sees the identical object it would have
// seen before compaction.

'use strict';

(function initTelemetryMetaDelta(root) {
  const DELTA_MARKER = '__telemetryMetaDelta';
  const REMOVED_KEYS = '__telemetryMetaRemovedKeys';
  // Format 1 (marker === true) diffed only top-level keys against the previous
  // event of the same platform: a nested object in the delta meant "replace this
  // key wholesale". Format 2 diffs recursively, where a nested object means
  // "merge into the previous value". Format 3 additionally picks the baseline
  // per (platform, label) rather than per platform.
  //
  // The baseline choice matters more than the diff algorithm: meta shape follows
  // the event label, not the model. On a real run 407 of 466 consecutive
  // same-platform pairs had different labels, so format 2 was diffing structurally
  // unrelated events and spending its savings on __telemetryMetaRemovedKeys lists
  // (present in 322 of 474 events; 7 after switching baseline).
  //
  // All three formats are ambiguous without the marker, so expand() dispatches on
  // each event's own marker -- data written by an earlier build can still be in
  // DIAG_KEY storage, and a stream may even mix formats.
  const DELTA_FORMAT_NESTED = 2;
  const DELTA_FORMAT_LABELED = 3;

  function platformKeyOf(event) {
    return String(event?.platform || event?.meta?.llmName || event?.llmName || 'unknown');
  }

  function labelKeyOf(event) {
    return `${platformKeyOf(event)}|${String(event?.label || event?.meta?.event || '')}`;
  }

  // Arrays are diffed atomically (replaced whole): element-wise diffing would
  // need index bookkeeping that costs more than it saves on telemetry payloads.
  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  // Reserved markers must never be confused with real payload keys. Real telemetry
  // never uses them, but a nested object carrying one would break round-tripping,
  // so such an object is stored whole instead of diffed.
  function hasReservedKey(obj) {
    return Object.prototype.hasOwnProperty.call(obj, DELTA_MARKER)
      || Object.prototype.hasOwnProperty.call(obj, REMOVED_KEYS);
  }

  // Returns { changed, delta } where delta contains only differing keys, with
  // nested plain objects recursed into. `changed: false` means "identical".
  function diffObject(prev, next) {
    const delta = {};
    let changed = false;
    Object.keys(next).forEach((key) => {
      const prevValue = prev[key];
      const nextValue = next[key];
      if (sameValue(prevValue, nextValue)) return;
      if (isPlainObject(prevValue) && isPlainObject(nextValue)
        && !hasReservedKey(prevValue) && !hasReservedKey(nextValue)) {
        const nested = diffObject(prevValue, nextValue);
        if (nested.changed) {
          delta[key] = nested.delta;
          changed = true;
        }
        return;
      }
      delta[key] = nextValue;
      changed = true;
    });
    const removedKeys = Object.keys(prev).filter((key) => !(key in next));
    if (removedKeys.length) {
      delta[REMOVED_KEYS] = removedKeys;
      changed = true;
    }
    return { changed, delta };
  }

  // Mirror of diffObject: merges a delta produced above back onto the previous
  // value. Must stay exactly symmetrical or round-tripping breaks. `nested`
  // selects format-2 recursive merge vs. format-1 wholesale key replacement.
  function mergeDelta(prev, delta, nested) {
    const merged = { ...prev };
    const removedKeys = Array.isArray(delta[REMOVED_KEYS]) ? delta[REMOVED_KEYS] : [];
    Object.keys(delta).forEach((key) => {
      if (key === DELTA_MARKER || key === REMOVED_KEYS) return;
      const prevValue = merged[key];
      const deltaValue = delta[key];
      if (nested && isPlainObject(prevValue) && isPlainObject(deltaValue) && !hasReservedKey(prevValue)) {
        merged[key] = mergeDelta(prevValue, deltaValue, nested);
        return;
      }
      merged[key] = deltaValue;
    });
    removedKeys.forEach((key) => { delete merged[key]; });
    return merged;
  }

  function compactTelemetryEvents(events) {
    if (!Array.isArray(events)) return [];
    const lastFullMeta = new Map();
    return events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      const meta = event.meta;
      if (!isPlainObject(meta) || hasReservedKey(meta)) return event;
      const key = labelKeyOf(event);
      const prev = lastFullMeta.get(key);
      lastFullMeta.set(key, meta);
      if (!prev) return event;

      const { changed, delta } = diffObject(prev, meta);
      if (!changed) {
        return { ...event, meta: { [DELTA_MARKER]: DELTA_FORMAT_LABELED } };
      }
      const compactedMeta = { [DELTA_MARKER]: DELTA_FORMAT_LABELED, ...delta };
      // Only keep the compacted form when it is actually smaller; a delta that
      // touches nearly everything can serialize larger than the original once
      // the marker and removed-key bookkeeping are added. Storing the full meta
      // instead still round-trips, since expand() treats any event without the
      // marker as a fresh baseline.
      try {
        if (JSON.stringify(compactedMeta).length >= JSON.stringify(meta).length) return event;
      } catch (_) {
        return event;
      }
      return { ...event, meta: compactedMeta };
    });
  }

  function expandTelemetryEvents(events) {
    if (!Array.isArray(events)) return [];
    // Both baselines are tracked so a stream may mix formats: each event resolves
    // its baseline from its own marker, and every resolved meta updates both maps.
    const lastByPlatform = new Map();
    const lastByLabel = new Map();
    const remember = (event, meta) => {
      lastByPlatform.set(platformKeyOf(event), meta);
      lastByLabel.set(labelKeyOf(event), meta);
    };
    return events.map((event) => {
      if (!event || typeof event !== 'object') return event;
      const meta = event.meta;
      if (!isPlainObject(meta) || !meta[DELTA_MARKER]) {
        if (isPlainObject(meta)) remember(event, meta);
        return event;
      }
      const format = meta[DELTA_MARKER];
      const prev = (format === DELTA_FORMAT_LABELED
        ? lastByLabel.get(labelKeyOf(event))
        : lastByPlatform.get(platformKeyOf(event))) || {};
      const nested = format === DELTA_FORMAT_NESTED || format === DELTA_FORMAT_LABELED;
      const merged = mergeDelta(prev, meta, nested);
      remember(event, merged);
      return { ...event, meta: merged };
    });
  }

  const api = { compactTelemetryEvents, expandTelemetryEvents };
  root.TelemetryMetaDelta = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));

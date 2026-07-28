// Clock comparison primitives for proof telemetry schema 6.
(function initProofTelemetryClock(root) {
  'use strict';

  const CONTRACT_VERSION = '1.0';

  function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function point(clock, field = 'observedAtLocalMonoMs') {
    if (!clock || typeof clock !== 'object') return null;
    const monoMs = finite(clock[field]);
    if (monoMs === null || !clock.producerEpochId) return null;
    return { epochId: String(clock.producerEpochId), monoMs };
  }

  function compareClockPoints(left, right, bridge = null) {
    if (!left || !right) return { kind: 'unavailable', reason: 'clock_point_missing' };
    if (left.epochId === right.epochId) {
      return { kind: 'exact', durationMs: right.monoMs - left.monoMs };
    }
    if (bridge && bridge.fromEpochId === left.epochId && bridge.toEpochId === right.epochId
      && finite(bridge.lowerBoundMs) !== null && finite(bridge.upperBoundMs) !== null) {
      return {
        kind: 'bounded',
        lowerBoundMs: (right.monoMs - left.monoMs) + Number(bridge.lowerBoundMs),
        upperBoundMs: (right.monoMs - left.monoMs) + Number(bridge.upperBoundMs),
        bridgeId: bridge.bridgeId || null
      };
    }
    return { kind: 'unavailable', reason: 'different_clock_epochs' };
  }

  function thresholdAtLeast(comparison, thresholdMs) {
    if (comparison?.kind === 'exact') return comparison.durationMs >= thresholdMs;
    if (comparison?.kind === 'bounded') {
      if (comparison.lowerBoundMs >= thresholdMs) return true;
      if (comparison.upperBoundMs < thresholdMs) return false;
    }
    return 'unknown';
  }

  function signalCoverage(checks, maximumSignalSkewMs) {
    const values = Object.values(checks || {}).map(finite).filter((value) => value !== null);
    if (!values.length) return { status: 'unknown', maximumSignalSkewMs: null, checkedSignalCount: 0 };
    const skew = Math.max(...values) - Math.min(...values);
    return {
      status: skew <= maximumSignalSkewMs ? 'reliable' : 'degraded',
      maximumSignalSkewMs: skew,
      checkedSignalCount: values.length
    };
  }

  const api = Object.freeze({ CONTRACT_VERSION, point, compareClockPoints, thresholdAtLeast, signalCoverage });
  root.ProofTelemetryClock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

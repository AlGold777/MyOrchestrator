/**
 * Shared timing configuration with defaults and runtime overrides.
 * Consumers should only call `TimingConfig.getTiming()` when accessing magic numbers.
 */
(function (global) {
  if (global.TimingConfig) {
    return;
  }

  const DEFAULTS = {
    tabLoadTimeoutMs: 45_000,
    tabReadyTimeoutMs: 15_000,
    promptSubmitTimeoutMs: 15_000,
    sendPromptDelayMs: 3_000,
    heartbeatIntervalMs: 5_000,
    heartbeatTimeoutMs: 15_000,
    selectorCleanupPeriodMs: 10 * 60_000,
    handshakeRetryMs: 2_000,
    handshakeLocationPollMs: 1_000,
    readyAckTimeoutMs: 6_000,
    noFocusTimeoutMs: 3_000,
    focusRestoreDelayMs: 1_500,
    focusRestoreMaxMs: 5_000,
    attachmentTimeoutMs: 10_000,
    attachmentPollMs: 200
  };

  const overrides = {};

  function getTiming(key, fallback) {
    if (typeof overrides[key] === 'number') {
      return overrides[key];
    }
    if (typeof DEFAULTS[key] === 'number') {
      return DEFAULTS[key];
    }
    return fallback;
  }

  function setTiming(key, value) {
    if (typeof value === 'number') {
      overrides[key] = value;
      return value;
    }
    return null;
  }

  function resetTiming(key) {
    delete overrides[key];
  }

  global.TimingConfig = Object.freeze({
    getTiming,
    setTiming,
    resetTiming
  });
})(typeof self !== 'undefined' ? self : this);

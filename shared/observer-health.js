// shared/observer-health.js
// Health of the sensors, tracked separately from the state of the provider.
//
// The failure this exists to prevent: a broken hook, a detached content script
// or a discarded tab produces exactly the same observable as a model that
// simply stopped emitting — silence. Treating that silence as completion is the
// expensive error. So each observer carries its own state, and the witness set
// as a whole sets the ceiling on what any run over it may claim.

(function initObserverHealth(root) {
  'use strict';

  const RunResultContract = root.RunResultContract || (() => {
    try { return typeof require === 'function' ? require('./run-result-contract.js') : null; } catch (_) { return null; }
  })();

  const GUARANTEE = RunResultContract?.GUARANTEE || Object.freeze({
    STRICT: 'STRICT', DEGRADED: 'DEGRADED', HEURISTIC: 'HEURISTIC', BLIND: 'BLIND'
  });

  const STATES = Object.freeze({
    HEALTHY: 'HEALTHY',
    SUSPECT: 'SUSPECT',
    DEGRADED: 'DEGRADED',
    BLIND: 'BLIND'
  });

  const STATE_RANK = Object.freeze({ HEALTHY: 3, SUSPECT: 2, DEGRADED: 1, BLIND: 0 });

  // Observation channels, strongest first. `transport` sees the provider
  // protocol; `dom` only sees its rendered projection.
  const CHANNELS = Object.freeze(['transport', 'application', 'dom', 'lifecycle']);

  // What the strongest healthy channel allows a run to claim. DOM alone is a
  // projection of the answer, never a proof of the protocol, so it caps at
  // HEURISTIC no matter how many DOM signals agree.
  const CHANNEL_CEILING = Object.freeze({
    transport: GUARANTEE.STRICT,
    application: GUARANTEE.DEGRADED,
    dom: GUARANTEE.HEURISTIC,
    lifecycle: GUARANTEE.BLIND
  });

  const DEFAULT_SILENCE_MS = 15000;

  function normalizeState(value) {
    const key = String(value || '').trim().toUpperCase();
    return STATES[key] || STATES.BLIND;
  }

  function worseState(a, b) {
    return (STATE_RANK[normalizeState(a)] || 0) <= (STATE_RANK[normalizeState(b)] || 0)
      ? normalizeState(a)
      : normalizeState(b);
  }

  // One observer's own view of itself. `installed` answers "is the sensor
  // there", `expectSignals` answers "should it be saying something right now" —
  // an installed sensor that has gone quiet while output is expected is SUSPECT,
  // and a sensor that was never installed is BLIND, not merely quiet.
  function assessObserver(channel, input = {}) {
    const now = Number(input.now) || Date.now();
    const reasons = [];
    if (input.installed === false) {
      return { channel, state: STATES.BLIND, reasons: ['not_installed'], lastSignalAt: null, silenceMs: null };
    }
    if (input.detached === true) {
      return { channel, state: STATES.BLIND, reasons: ['detached'], lastSignalAt: input.lastSignalAt || null, silenceMs: null };
    }
    if (input.contextInvalidated === true) {
      return { channel, state: STATES.BLIND, reasons: ['context_invalidated'], lastSignalAt: input.lastSignalAt || null, silenceMs: null };
    }
    if (input.documentEpochChanged === true) {
      // The document the observer was attached to is gone; anything it still
      // reports belongs to a different page instance.
      return { channel, state: STATES.BLIND, reasons: ['document_epoch_changed'], lastSignalAt: input.lastSignalAt || null, silenceMs: null };
    }
    if (input.discarded === true) {
      return { channel, state: STATES.BLIND, reasons: ['tab_discarded'], lastSignalAt: input.lastSignalAt || null, silenceMs: null };
    }

    let state = STATES.HEALTHY;
    if (input.parseFailures > 0) {
      state = worseState(state, STATES.DEGRADED);
      reasons.push('parse_failures');
    }
    if (input.schemaMismatch === true) {
      state = worseState(state, STATES.DEGRADED);
      reasons.push('schema_mismatch');
    }
    const lastSignalAt = Number(input.lastSignalAt) || 0;
    const silenceMs = lastSignalAt ? Math.max(0, now - lastSignalAt) : null;
    const silenceLimit = Number(input.silenceLimitMs) || DEFAULT_SILENCE_MS;
    if (input.expectSignals === true) {
      if (!lastSignalAt) {
        state = worseState(state, STATES.SUSPECT);
        reasons.push('no_signal_yet');
      } else if (silenceMs > silenceLimit) {
        state = worseState(state, STATES.SUSPECT);
        reasons.push('silent_while_output_expected');
      }
    }
    return { channel, state, reasons, lastSignalAt: lastSignalAt || null, silenceMs };
  }

  function buildWitnessSet(input = {}, options = {}) {
    const now = Number(options.now) || Date.now();
    const observers = {};
    CHANNELS.forEach((channel) => {
      const declared = input[channel];
      if (declared === undefined || declared === null) {
        observers[channel] = { channel, state: STATES.BLIND, reasons: ['not_declared'], lastSignalAt: null, silenceMs: null };
        return;
      }
      observers[channel] = assessObserver(channel, Object.assign({ now }, declared));
    });

    // The ceiling is set by the strongest channel that is actually healthy —
    // a lost strong observer lowers what the run may claim, it does not merely
    // remove one vote from a sum.
    let ceiling = GUARANTEE.BLIND;
    let ceilingChannel = null;
    CHANNELS.forEach((channel) => {
      if (observers[channel].state !== STATES.HEALTHY) return;
      const candidate = CHANNEL_CEILING[channel] || GUARANTEE.BLIND;
      if (RunResultContract?.compareGuarantee
        ? RunResultContract.compareGuarantee(candidate, ceiling) > 0
        : candidate !== ceiling && ceiling === GUARANTEE.BLIND) {
        ceiling = candidate;
        ceilingChannel = channel;
      }
    });

    // A DOM observer that has gone blind mid-run is not a missing vote either:
    // it is the case where nobody can say whether the page still changed.
    const domBlind = observers.dom.state === STATES.BLIND;
    const anyHealthy = CHANNELS.some((channel) => observers[channel].state === STATES.HEALTHY);
    const degradedReasons = [];
    CHANNELS.forEach((channel) => {
      if (observers[channel].state !== STATES.HEALTHY) {
        degradedReasons.push(`${channel}:${observers[channel].state.toLowerCase()}`);
      }
    });

    return {
      schemaVersion: 1,
      observers,
      ceiling,
      ceilingChannel,
      domBlind,
      anyHealthy,
      // Silence from a blind observer is not evidence about the model.
      silenceIsEvidence: !domBlind && anyHealthy,
      degradedReasons,
      assessedAt: now
    };
  }

  function observerAxisState(witnessSet = {}) {
    const states = RunResultContract?.AXIS_STATES || { PROVEN: 'proven', SUSPECTED: 'suspected', UNPROVEN: 'unproven', CONTRADICTED: 'contradicted' };
    if (!witnessSet || !witnessSet.observers) return states.UNPROVEN;
    if (!witnessSet.anyHealthy) return states.CONTRADICTED;
    if (witnessSet.domBlind) return states.CONTRADICTED;
    const anySuspect = CHANNELS.some((channel) => {
      const state = witnessSet.observers[channel]?.state;
      return state === STATES.SUSPECT || state === STATES.DEGRADED;
    });
    return anySuspect ? states.SUSPECTED : states.PROVEN;
  }

  const api = Object.freeze({
    STATES,
    STATE_RANK,
    CHANNELS,
    CHANNEL_CEILING,
    DEFAULT_SILENCE_MS,
    assessObserver,
    buildWitnessSet,
    observerAxisState,
    worseState,
    normalizeState
  });

  root.ObserverHealth = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

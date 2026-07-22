// disput/triad-runtime.js
// Explicit finite-state core for the Triad (3-model wave) runtime.
//
// Protocol (docs/disput-docs/D9_triad-protocol.md §2): isolated init wave -> criticism waves
// (each model attacks the other two, one batch per wave with a per-model prompt
// map) -> final words -> synthesis. No speakers, no A/B routing: the only
// ordering primitive is the wave barrier (all three cards resolved).
// Pure and unit-testable, mirrors disput/debate-runtime.js conventions.

(function initTriadRuntime(root) {
  'use strict';

  const PHASES = Object.freeze({ INIT: 'init', PUBLIC: 'public', FINAL: 'final' });
  const STATUSES = Object.freeze({
    RUNNING: 'running',
    PAUSED: 'paused',
    PAUSED_BY_MODERATOR: 'paused_by_moderator',
    STOPPED_BY_MODERATOR: 'stopped_by_moderator',
    FINALIZATION_PENDING: 'finalization_pending',
    TECHNICAL_PAUSE: 'technical_pause',
    COMPLETED: 'completed',
    ERROR: 'error',
    CANCELLED: 'cancelled'
  });
  const PARTICIPANT_COUNT = 3;

  function createState(overrides) {
    const state = {
      active: false,
      runId: '',
      sessionId: '1',
      moderatorMessage: '',
      models: [],
      role: '',
      topic: '',
      presetId: 'TRIAD_STANDARD',
      topology: 'triad',
      duration: 'fixed',
      terminationOwner: 'runtime',
      phase: PHASES.INIT,
      wave: 0,
      maxWaves: 3,
      waveLimit: 3,
      completedWaves: 0,
      checkpointPolicy: { enabled: true, everyWaves: 1 },
      lastCheckpointAtWave: 0,
      finalizationPolicy: 'auto_after_limit',
      stopReason: '',
      pauseReason: '',
      technicalPause: false,
      autoMode: false,
      positions: {},
      positionWaves: {},
      responsesByWave: [],
      initTexts: {},
      finalWords: {},
      synthesizer: '',
      synthesisText: '',
      finalWordsRequested: false,
      waitingWaveApproval: false,
      pendingWaveContinuation: null,
      newPagesOpenedModels: new Set(),
      routedTurnIds: new Set()
    };
    if (overrides && typeof overrides === 'object') {
      Object.assign(state, overrides);
      if (Object.prototype.hasOwnProperty.call(overrides, 'maxWaves')
        && !Object.prototype.hasOwnProperty.call(overrides, 'waveLimit')) {
        state.waveLimit = overrides.maxWaves;
      }
    }
    return state;
  }

  function beginInitWave(state) {
    if (!state) return state;
    state.phase = PHASES.INIT;
    state.initTexts = {};
    state.positions = {};
    state.positionWaves = {};
    state.responsesByWave = [];
    state.wave = 0;
    state.completedWaves = 0;
    return state;
  }

  function recordInitAnswer(state, model, text) {
    if (!state || !model) return state;
    state.initTexts[model] = text;
    state.positions[model] = text;
    if (!state.positionWaves || typeof state.positionWaves !== 'object') state.positionWaves = {};
    state.positionWaves[model] = 0;
    if (allInitCaptured(state)) state.phase = PHASES.PUBLIC;
    return state;
  }

  function allInitCaptured(state) {
    if (!state || !Array.isArray(state.models)) return false;
    return state.models.length > 0 && state.models.length <= PARTICIPANT_COUNT
      && state.models.every((m) => typeof state.initTexts[m] === 'string' && state.initTexts[m].trim());
  }

  function retainParticipants(state, models = []) {
    if (!state) return state;
    const keep = new Set((Array.isArray(models) ? models : []).map((model) => String(model || '').trim()).filter(Boolean));
    const previous = Array.isArray(state.models) ? state.models.slice() : [];
    const dropped = previous.filter((model) => !keep.has(model));
    state.models = previous.filter((model) => keep.has(model));
    state.droppedModels = Array.from(new Set([...(state.droppedModels || []), ...dropped]));
    // A synthesizer may be a service model outside the public participant
    // pool. Keep it across participant dropouts; only replace it when the
    // synthesizer itself was one of the dropped participants.
    if (state.synthesizer && previous.includes(state.synthesizer) && !state.models.includes(state.synthesizer)) {
      state.synthesizer = state.models[0] || '';
    }
    if (state.phase === PHASES.INIT && allInitCaptured(state)) state.phase = PHASES.PUBLIC;
    return state;
  }

  const canRouteWave = (state) => !!state && state.phase === PHASES.PUBLIC;

  // `wave` is the 1-based number of the wave being collected; defaults to the
  // wave currently in flight (state.wave + 1). Positions from silent models are
  // NOT overwritten — positionWaves records when each position last changed so
  // consumers can flag stale ones instead of presenting them as current.
  function recordWaveAnswer(state, model, text, wave = null) {
    if (!state || !model) return state;
    if (typeof text === 'string' && text.trim()) {
      state.positions[model] = text;
      if (!state.positionWaves || typeof state.positionWaves !== 'object') state.positionWaves = {};
      const waveNumber = Number.isFinite(Number(wave)) && Number(wave) > 0
        ? Number(wave)
        : Number(state.wave || 0) + 1;
      state.positionWaves[model] = waveNumber;
    }
    return state;
  }

  function positionWaveFor(state, model) {
    const value = Number(state?.positionWaves?.[model]);
    return Number.isFinite(value) ? value : 0;
  }

  function isPositionStale(state, model) {
    if (!state) return false;
    return positionWaveFor(state, model) < Number(state.wave || 0);
  }

  function completeWave(state) {
    if (!state) return state;
    state.wave += 1;
    state.completedWaves += 1;
    state.waitingWaveApproval = false;
    return state;
  }

  function opponentsFor(state, model) {
    if (!state || !Array.isArray(state.models)) return [];
    return state.models
      .filter((m) => m !== model)
      .map((m) => ({
        model: m,
        text: state.positions[m] || '',
        wave: positionWaveFor(state, m),
        stale: isPositionStale(state, m)
      }))
      .filter((entry) => entry.text.trim());
  }

  function usablePositions(state) {
    if (!state || !Array.isArray(state.models)) return [];
    return state.models
      .map((m) => ({
        model: m,
        text: state.positions[m] || '',
        wave: positionWaveFor(state, m),
        stale: isPositionStale(state, m)
      }))
      .filter((entry) => entry.text.trim());
  }

  function hasReachedWaveLimit(state) {
    if (!state) return false;
    const limit = state.waveLimit == null ? null : Number(state.waveLimit);
    if (limit == null || !Number.isFinite(limit)) return false;
    const explicitCompleted = Number(state.completedWaves);
    const wave = Number(state.wave || 0);
    const completed = Number.isFinite(explicitCompleted) && explicitCompleted > 0
      ? explicitCompleted
      : wave;
    return completed >= limit;
  }
  const shouldAutoContinue = (state, { auto } = {}) =>
    !!auto && !!state && state.active && !hasReachedWaveLimit(state);

  function markRunning(state) { if (state) state.status = STATUSES.RUNNING; return state; }
  function markPaused(state) { if (state) state.status = STATUSES.PAUSED; return state; }
  function markCompleted(state) { if (state) { state.active = false; state.status = STATUSES.COMPLETED; } return state; }
  function markError(state) { if (state) { state.active = false; state.status = STATUSES.ERROR; } return state; }
  function markCancelled(state) { if (state) { state.active = false; state.status = STATUSES.CANCELLED; } return state; }
  function markPausedByModerator(state, reason = 'moderator') {
    if (state) {
      state.status = STATUSES.PAUSED_BY_MODERATOR;
      state.pauseReason = reason;
      state.technicalPause = false;
    }
    return state;
  }
  function markResumedByModerator(state) {
    if (state) {
      state.status = STATUSES.RUNNING;
      state.pauseReason = '';
      state.technicalPause = false;
    }
    return state;
  }
  function markStoppedByModerator(state, reason = 'moderator_stop') {
    if (state) {
      state.active = false;
      state.status = STATUSES.STOPPED_BY_MODERATOR;
      state.stopReason = reason;
    }
    return state;
  }
  function markFinalizationPending(state) {
    if (state) state.status = STATUSES.FINALIZATION_PENDING;
    return state;
  }
  function markCompletedByModerator(state, reason = 'moderator_finalized') {
    if (state) {
      state.active = false;
      state.status = STATUSES.COMPLETED;
      state.stopReason = reason;
    }
    return state;
  }
  function markTechnicalPause(state, reason = 'technical_pause', details = null) {
    if (state) {
      state.status = STATUSES.TECHNICAL_PAUSE;
      state.pauseReason = reason;
      state.technicalPause = true;
      if (details != null) state.technicalPauseDetails = details;
    }
    return state;
  }
  function shouldRunTriadCheckpoint(state) {
    if (!state || !state.checkpointPolicy?.enabled) return false;
    const every = Number(state.checkpointPolicy.everyWaves || 0);
    if (!Number.isFinite(every) || every <= 0) return false;
    const completed = Number(state.completedWaves || state.wave || 0);
    return completed > 0 && completed - Number(state.lastCheckpointAtWave || 0) >= every;
  }

  const api = Object.freeze({
    PHASES,
    STATUSES,
    PARTICIPANT_COUNT,
    createState,
    beginInitWave,
    recordInitAnswer,
    allInitCaptured,
    retainParticipants,
    canRouteWave,
    recordWaveAnswer,
    positionWaveFor,
    isPositionStale,
    completeWave,
    opponentsFor,
    usablePositions,
    hasReachedWaveLimit,
    shouldAutoContinue,
    markRunning,
    markPaused,
    markCompleted,
    markError,
    markCancelled,
    markPausedByModerator,
    markResumedByModerator,
    markStoppedByModerator,
    markFinalizationPending,
    markCompletedByModerator,
    markTechnicalPause,
    shouldRunTriadCheckpoint
  });

  root.TriadFSM = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

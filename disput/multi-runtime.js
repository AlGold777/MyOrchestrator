// Explicit finite-state core for the Multi debate protocol.
// Keeps topology semantics out of results.js and mirrors DebateFSM/TriadFSM.
(function initMultiRuntime(root) {
  'use strict';

  const PHASES = Object.freeze({ INIT: 'init', WAVE: 'wave', SYNTHESIS: 'synthesis', FINAL: 'final' });
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

  function createState(overrides = {}) {
    const state = {
      active: false,
      runId: '',
      sessionId: '1',
      topic: '',
      role: '',
      models: [],
      synthesizer: '',
      presetId: 'MULTI_STANDARD',
      topology: 'multi',
      duration: 'fixed',
      terminationOwner: 'runtime',
      finalizationPolicy: 'auto_after_limit',
      phase: PHASES.INIT,
      currentPhase: PHASES.INIT,
      wave: 0,
      waveLimit: 4,
      completedWaves: 0,
      currentWaveKey: '',
      responsesByWave: [],
      roundFilters: [],
      synthesisText: '',
      autoMode: false,
      waitingApproval: false,
      pauseReason: '',
      stopReason: '',
      technicalPause: false
    };
    Object.assign(state, overrides && typeof overrides === 'object' ? overrides : {});
    state.models = Array.isArray(state.models) ? state.models.slice() : [];
    state.responsesByWave = Array.isArray(state.responsesByWave) ? state.responsesByWave.slice() : [];
    state.roundFilters = Array.isArray(state.roundFilters) ? state.roundFilters.slice() : [];
    state.phase = String(state.phase || state.currentPhase || PHASES.INIT);
    state.currentPhase = state.phase;
    return state;
  }

  function begin(state) {
    if (!state) return state;
    state.active = true;
    state.status = STATUSES.RUNNING;
    state.phase = PHASES.INIT;
    state.currentPhase = PHASES.INIT;
    state.wave = 0;
    state.completedWaves = 0;
    state.responsesByWave = [];
    state.roundFilters = [];
    state.synthesisText = '';
    state.waitingApproval = false;
    return state;
  }

  function beginWave(state, waveNumber) {
    if (!state) return state;
    const next = Math.max(1, Number(waveNumber || state.completedWaves + 1));
    state.phase = PHASES.WAVE;
    state.currentPhase = PHASES.WAVE;
    state.wave = next;
    state.currentWaveKey = `multi-r${next}`;
    state.waitingApproval = false;
    return state;
  }

  function recordWave(state, turns = []) {
    if (!state) return state;
    const normalized = Array.isArray(turns) ? turns.slice() : [];
    state.responsesByWave.push(normalized);
    state.completedWaves = Math.max(Number(state.completedWaves || 0), Number(state.wave || 0));
    return state;
  }

  function hasReachedWaveLimit(state) {
    if (!state) return false;
    if (state.waveLimit == null) return false;
    const limit = Number(state.waveLimit);
    return Number.isFinite(limit) && Number(state.completedWaves || 0) >= limit;
  }

  function shouldAutoContinue(state, { auto = state?.autoMode } = {}) {
    return Boolean(auto && state?.active && !state.waitingApproval && !hasReachedWaveLimit(state));
  }

  function markAwaitingApproval(state) {
    if (state) {
      state.waitingApproval = true;
      state.status = STATUSES.PAUSED;
    }
    return state;
  }

  function beginSynthesis(state) {
    if (state) {
      state.phase = PHASES.SYNTHESIS;
      state.currentPhase = PHASES.SYNTHESIS;
      state.currentWaveKey = 'multi-synthesis';
      state.status = STATUSES.FINALIZATION_PENDING;
      state.waitingApproval = false;
    }
    return state;
  }

  function recordSynthesis(state, text) {
    if (state) state.synthesisText = String(text || '');
    return state;
  }

  function markRunning(state) { if (state) { state.active = true; state.status = STATUSES.RUNNING; state.waitingApproval = false; } return state; }
  function markPaused(state, reason = '') { if (state) { state.status = STATUSES.PAUSED; state.pauseReason = reason; } return state; }
  function markPausedByModerator(state, reason = 'moderator') { if (state) { state.status = STATUSES.PAUSED_BY_MODERATOR; state.pauseReason = reason; } return state; }
  function markTechnicalPause(state, reason = 'technical_pause') { if (state) { state.status = STATUSES.TECHNICAL_PAUSE; state.pauseReason = reason; state.technicalPause = true; } return state; }
  function markCompleted(state) { if (state) { state.active = false; state.status = STATUSES.COMPLETED; state.phase = PHASES.FINAL; state.currentPhase = PHASES.FINAL; } return state; }
  function markError(state, reason = '') { if (state) { state.active = false; state.status = STATUSES.ERROR; state.stopReason = reason; } return state; }
  function markCancelled(state, reason = 'cancelled') { if (state) { state.active = false; state.status = STATUSES.CANCELLED; state.stopReason = reason; state.phase = STATUSES.CANCELLED; state.currentPhase = STATUSES.CANCELLED; } return state; }
  function markStoppedByModerator(state, reason = 'moderator_stop') { if (state) { state.active = false; state.status = STATUSES.STOPPED_BY_MODERATOR; state.stopReason = reason; } return state; }

  const api = Object.freeze({
    PHASES,
    STATUSES,
    createState,
    begin,
    beginWave,
    recordWave,
    hasReachedWaveLimit,
    shouldAutoContinue,
    markAwaitingApproval,
    beginSynthesis,
    recordSynthesis,
    markRunning,
    markPaused,
    markPausedByModerator,
    markTechnicalPause,
    markCompleted,
    markError,
    markCancelled,
    markStoppedByModerator
  });

  root.MultiFSM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

(function initDebateSchema(root) {
  'use strict';

  const PHASES = new Set(['init', 'public']);
  const STATUSES = new Set([
    'running',
    'paused',
    'paused_by_moderator',
    'stopped_by_moderator',
    'finalization_pending',
    'technical_pause',
    'completed',
    'error',
    'cancelled'
  ]);

  class DebateSchemaError extends Error {
    constructor(field, value, expected) {
      super(`Debate schema validation failed: ${field}=${JSON.stringify(value)}, expected ${expected}`);
      this.name = 'DebateSchemaError';
      this.field = field;
      this.value = value;
      this.expected = expected;
    }
  }

  function assertSet(value, field) {
    if (!(value instanceof Set)) {
      throw new DebateSchemaError(field, Object.prototype.toString.call(value), 'Set');
    }
  }

  function validateSerialState(state, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    if (!state || typeof state !== 'object') {
      throw new DebateSchemaError('state', state, 'object');
    }
    if (!PHASES.has(state.phase)) {
      throw new DebateSchemaError('phase', state.phase, Array.from(PHASES).join('|'));
    }
    if (state.status && !STATUSES.has(state.status)) {
      throw new DebateSchemaError('status', state.status, Array.from(STATUSES).join('|'));
    }
    assertSet(state.newPagesOpenedModels, 'newPagesOpenedModels');
    if (opts.requireParticipants) {
      if (!String(state.modelA || '').trim()) {
        throw new DebateSchemaError('modelA', state.modelA, 'non-empty string');
      }
      if (!String(state.modelB || '').trim()) {
        throw new DebateSchemaError('modelB', state.modelB, 'non-empty string');
      }
      if (String(state.modelA).trim() === String(state.modelB).trim()) {
        throw new DebateSchemaError('modelA/modelB', state.modelA, 'different models');
      }
    }
    return true;
  }

  function validateTriadState(state) {
    if (!state || typeof state !== 'object') throw new DebateSchemaError('state', state, 'object');
    if (!['init', 'public', 'final'].includes(String(state.phase || ''))) {
      throw new DebateSchemaError('phase', state.phase, 'init|public|final');
    }
    if (!Array.isArray(state.models)) throw new DebateSchemaError('models', state.models, 'array');
    if (state.active && state.models.length !== 3) throw new DebateSchemaError('models.length', state.models.length, '3 for active Triad');
    assertSet(state.newPagesOpenedModels, 'newPagesOpenedModels');
    assertSet(state.routedTurnIds, 'routedTurnIds');
    return true;
  }

  function validateMultiState(state) {
    if (!state || typeof state !== 'object') throw new DebateSchemaError('state', state, 'object');
    if (String(state.topology || '') !== 'multi') throw new DebateSchemaError('topology', state.topology, 'multi');
    if (!Array.isArray(state.models)) throw new DebateSchemaError('models', state.models, 'array');
    if (state.active && state.models.length < 2) throw new DebateSchemaError('models.length', state.models.length, '>=2 for active Multi');
    if (!Array.isArray(state.responsesByWave)) throw new DebateSchemaError('responsesByWave', state.responsesByWave, 'array');
    return true;
  }

  function validateRunAggregate(state) {
    if (!state || typeof state !== 'object') throw new DebateSchemaError('aggregate', state, 'object');
    if (!['duel', 'triad', 'multi'].includes(String(state.topology || ''))) {
      throw new DebateSchemaError('topology', state.topology, 'duel|triad|multi');
    }
    if (!Array.isArray(state.events)) throw new DebateSchemaError('events', state.events, 'array');
    const seqs = state.events.map((event) => Number(event?.seq));
    if (seqs.some((seq, index) => !Number.isFinite(seq) || (index > 0 && seq <= seqs[index - 1]))) {
      throw new DebateSchemaError('events.seq', seqs, 'strictly increasing numbers');
    }
    if (state.status !== 'idle' && !String(state.runId || '').trim()) {
      throw new DebateSchemaError('runId', state.runId, 'non-empty outside idle');
    }
    return true;
  }

  const api = Object.freeze({
    DebateSchemaError,
    validateSerialState,
    validateTriadState,
    validateMultiState,
    validateRunAggregate
  });

  root.DebateSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

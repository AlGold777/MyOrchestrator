(function initDebateSchema(root) {
  'use strict';
  class DebateSchemaError extends Error {
    constructor(field, value, expected) {
      super(`Debate schema validation failed: ${field}=${JSON.stringify(value)}, expected ${expected}`);
      this.name = 'DebateSchemaError'; this.field = field; this.value = value; this.expected = expected;
    }
  }
  function validateState(state, options = {}) {
    if (!state || typeof state !== 'object') throw new DebateSchemaError('state', state, 'object');
    if (options.requireParticipants && (!Array.isArray(state.participants) || !state.participants.length)) {
      throw new DebateSchemaError('participants', state.participants, 'non-empty array');
    }
    if (state.events != null && !Array.isArray(state.events) && !Array.isArray(state.eventLog)) {
      throw new DebateSchemaError('events', state.events, 'array');
    }
    return true;
  }
  function validateRunAggregate(state) {
    validateState(state);
    const events = Array.isArray(state.events) ? state.events : [];
    const seqs = events.map((event) => Number(event.seq ?? event.eventSequence));
    if (seqs.some((seq, index) => !Number.isFinite(seq) || (index > 0 && seq <= seqs[index - 1]))) {
      throw new DebateSchemaError('events.seq', seqs, 'strictly increasing numbers');
    }
    if (!['', 'idle'].includes(String(state.status || state.lifecycle || '').toLowerCase()) && !String(state.runId || '')) {
      throw new DebateSchemaError('runId', state.runId, 'non-empty outside idle');
    }
    return true;
  }
  const api = Object.freeze({ DebateSchemaError, validateState, validateRunAggregate });
  root.DebateSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

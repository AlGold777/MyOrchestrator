// Stable vocabulary for compiled Debate execution stages.
(function initDebateStageTypes(root) {
  'use strict';

  const KINDS = Object.freeze({
    OPENING_BATCH: 'opening_batch',
    PUBLIC_TURN: 'public_turn',
    WAVE_BATCH: 'wave_batch',
    ROUND_FILTER: 'round_filter',
    CHECKPOINT: 'checkpoint',
    FINAL_WORDS: 'final_words',
    FINAL_SYNTHESIS: 'final_synthesis'
    ,SYNTHESIS_AUDIT: 'synthesis_audit'
    ,DYNAMIC_ACTION: 'dynamic_action'
  });
  const ROLES = Object.freeze({
    PARTICIPANT: 'participant',
    FILTER: 'filter',
    CHECKPOINT: 'checkpoint',
    SYNTHESIZER: 'synthesizer'
  });
  const VISIBILITY = Object.freeze({ PUBLIC: 'public', SYSTEM: 'system' });
  const CONTINUATION = Object.freeze({ AUTO: 'auto', APPROVAL: 'approval' });
  const TAB_POLICIES = Object.freeze({
    CREATE: 'create',
    REUSE_PARTICIPANT_SESSION: 'reuse_participant_session',
    REUSE_IF_VALID: 'reuse_if_valid',
    ISOLATED: 'isolated',
    API: 'api'
  });

  const api = Object.freeze({ KINDS, ROLES, VISIBILITY, CONTINUATION, TAB_POLICIES });
  root.DebateStageTypes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

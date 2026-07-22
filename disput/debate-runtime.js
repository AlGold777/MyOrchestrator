// disput/debate-runtime.js
// Explicit finite-state core for the serial debate runtime.
//
// Background (global-code-review-2026-06-18.md F-C, Phase 3): the debate runtime
// (`serialDebateState`) lived as raw procedural code woven through the 18k-line
// results.js — the project's strongest pattern (explicit state machines in
// shared/) had not reached its busiest flow. This module lifts the *implicit*
// FSM out into one explicit, pure, unit-testable place:
//
//   - the canonical state shape (one factory, replacing two drifting
//     initializers that lived in results.js);
//   - the A0/B0 opening-statement phase gate (disput-logic §8/§22): no public
//     turn may route until BOTH opening statements are captured;
//   - the A/B routing transition applied when an approved turn is sent to the
//     opponent;
//   - the pure turn/status mappers used to render debate cards.
//
// It is behaviour-preserving: every function does exactly what the inline code
// in results.js did. Pure (no DOM / no chrome) and dual-context so it is
// unit-testable and usable from the results UI.

(function initDebateRuntime(root) {
  'use strict';

  const PHASES = Object.freeze({ INIT: 'init', PUBLIC: 'public' });
  const EVENT_PHASES = Object.freeze({ OPENING: 'opening', PUBLIC: 'public', FINAL: 'final', CHECKPOINT: 'checkpoint' });
  const SPEAKERS = Object.freeze({ A: 'A', B: 'B' });
  // Run-status lifecycle. Initial state has no status set (matches the previous
  // implicit behaviour); it becomes RUNNING on start and one of the terminal
  // values when the run ends.
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

  // Single source of truth for serial debate runtime state. Replaces the
  // `makeInitialSerialDebateState` factory and the divergent object literal that
  // had drifted apart in results.js (the literal was missing
  // `newPagesOpenedModels`). Sets are fresh per call.
  function createState(overrides) {
    const state = {
      active: false,
      runId: '',
      sessionId: '1',
      moderatorMessage: '',
      modelA: '',
      modelB: '',
      roleA: '',
      roleB: '',
      participants: {
        A: { slot: SPEAKERS.A, model: '', role: '', openingTurnId: null, finalTurnId: null },
        B: { slot: SPEAKERS.B, model: '', role: '', openingTurnId: null, finalTurnId: null }
      },
      topic: '',
      presetId: 'DUEL_STANDARD',
      topology: 'duel',
      duration: 'fixed',
      terminationOwner: 'runtime',
      // 'init' = opening statements (A0/B0) still being prepared; 'public' =
      // both openings exist and public turns may route.
      phase: PHASES.INIT,
      openingStatementA: '',
      openingStatementB: '',
      firstPublicBTurnDispatched: false,
      autoMode: false,
      turnLimit: 3,
      turns: {
        openingTurnsDispatched: 0,
        publicTurnsDispatched: 0,
        publicRound: 1,
        publicTurnLimit: 3
      },
      publicTurnsDispatched: 0,
      checkpointPolicy: { enabled: false },
      lastCheckpointAtTurn: 0,
      finalizationPolicy: 'auto_after_limit',
      stopReason: '',
      pauseReason: '',
      technicalPause: false,
      currentSpeaker: SPEAKERS.A,
      nextTarget: SPEAKERS.B,
      round: 1,
      dispatchedTurns: 0,
      lastText: '',
      waitingApprovalModel: '',
      newPagesOpenedModels: new Set(),
      eventLog: [],
      eventSeq: 0,
      registry: null,
      derived: null
    };
    if (overrides && typeof overrides === 'object') Object.assign(state, overrides);
    normalizeParticipants(state);
    normalizeTurns(state);
    return state;
  }

  function normalizeParticipants(state) {
    if (!state) return state;
    const current = state.participants && typeof state.participants === 'object' ? state.participants : {};
    state.participants = {
      A: {
        slot: SPEAKERS.A,
        model: String(current.A?.model || state.modelA || ''),
        role: String(current.A?.role || state.roleA || ''),
        openingTurnId: current.A?.openingTurnId || null,
        finalTurnId: current.A?.finalTurnId || null
      },
      B: {
        slot: SPEAKERS.B,
        model: String(current.B?.model || state.modelB || ''),
        role: String(current.B?.role || state.roleB || ''),
        openingTurnId: current.B?.openingTurnId || null,
        finalTurnId: current.B?.finalTurnId || null
      }
    };
    state.modelA = state.participants.A.model;
    state.modelB = state.participants.B.model;
    state.roleA = state.participants.A.role;
    state.roleB = state.participants.B.role;
    return state;
  }

  function setParticipants(state, { modelA = '', modelB = '', roleA = '', roleB = '' } = {}) {
    if (!state) return state;
    if (state.participants?.A?.model || state.participants?.B?.model) return state;
    state.participants = {
      A: { slot: SPEAKERS.A, model: String(modelA || ''), role: String(roleA || ''), openingTurnId: null, finalTurnId: null },
      B: { slot: SPEAKERS.B, model: String(modelB || ''), role: String(roleB || ''), openingTurnId: null, finalTurnId: null }
    };
    state.modelA = state.participants.A.model;
    state.modelB = state.participants.B.model;
    state.roleA = state.participants.A.role;
    state.roleB = state.participants.B.role;
    return state;
  }

  function retainParticipant(state, modelName) {
    if (!state) return state;
    normalizeParticipants(state);
    const survivor = String(modelName || '').trim();
    const survivorSlot = slotForModel(state, survivor);
    if (!survivor || !survivorSlot) return state;
    const source = state.participants[survivorSlot] || {};
    const role = survivorSlot === SPEAKERS.A ? state.roleA : state.roleB;
    const opening = survivorSlot === SPEAKERS.A ? state.openingStatementA : state.openingStatementB;
    const finalWord = survivorSlot === SPEAKERS.A ? state.finalWordA : state.finalWordB;
    const droppedParticipants = [state.modelA, state.modelB].filter((model) => model && model !== survivor);
    state.droppedModels = Array.from(new Set([...(state.droppedModels || []), ...droppedParticipants]));
    state.modelA = survivor;
    state.roleA = role || '';
    state.openingStatementA = opening || '';
    state.finalWordA = finalWord || '';
    state.modelB = '';
    state.roleB = '';
    state.openingStatementB = '';
    state.finalWordB = '';
    state.participants = {
      A: { ...source, slot: SPEAKERS.A, model: survivor, role: role || '' },
      B: { slot: SPEAKERS.B, model: '', role: '', openingTurnId: null, finalTurnId: null }
    };
    if (droppedParticipants.includes(state.synthesizer)) state.synthesizer = '';
    state.waitingApprovalModel = '';
    state.pendingAutoContinuation = null;
    return state;
  }

  function slotForModel(state, model) {
    const name = String(model || '');
    if (!state) return '';
    normalizeParticipants(state);
    if (name === state.participants.A.model) return SPEAKERS.A;
    if (name === state.participants.B.model) return SPEAKERS.B;
    return '';
  }

  function normalizeTurns(state) {
    if (!state) return state;
    const turns = state.turns && typeof state.turns === 'object' ? state.turns : {};
    const publicTurns = Number.isFinite(Number(turns.publicTurnsDispatched))
      ? Number(turns.publicTurnsDispatched)
      : Number(state.publicTurnsDispatched || 0);
    const rawLimit = turns.publicTurnLimit;
    const fallbackLimit = state.turnLimit;
    const limit = rawLimit == null
      ? (fallbackLimit == null ? null : Number(fallbackLimit))
      : (Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : null);
    state.turns = {
      openingTurnsDispatched: Math.max(0, Number(turns.openingTurnsDispatched || 0)),
      publicTurnsDispatched: Math.max(0, publicTurns),
      publicRound: computePublicRound(publicTurns, limit == null ? Math.max(1, publicTurns) : limit),
      publicTurnLimit: limit
    };
    state.publicTurnsDispatched = state.turns.publicTurnsDispatched;
    state.round = state.turns.publicRound;
    return state;
  }

  // --- Phase gate (A0/B0 opening-statement invariant) --------------------------

  // Public routing is gated on this so an early approval of A cannot send A0 to
  // B before B0 has been captured.
  const canRoutePublic = (state) => !!state && state.phase === PHASES.PUBLIC;

  // Enter the opening phase: clear both opening slots and the B-dispatch flag.
  function beginOpenings(state) {
    if (!state) return state;
    normalizeParticipants(state);
    normalizeTurns(state);
    state.phase = PHASES.INIT;
    state.openingStatementA = '';
    state.openingStatementB = '';
    state.participants.A.openingTurnId = null;
    state.participants.B.openingTurnId = null;
    state.firstPublicBTurnDispatched = false;
    state.turns.openingTurnsDispatched = 0;
    state.turns.publicTurnsDispatched = 0;
    state.turns.publicRound = 1;
    state.publicTurnsDispatched = 0;
    state.dispatchedTurns = 0;
    return state;
  }

  function allOpeningsCaptured(state) {
    return Boolean(
      String(state?.openingStatementA || '').trim()
      && String(state?.openingStatementB || '').trim()
    );
  }

  function maybeEnterPublicPhase(state) {
    if (allOpeningsCaptured(state)) state.phase = PHASES.PUBLIC;
    return state;
  }

  function recordOpeningA(state, text, turnId = null) {
    if (!state) return state;
    normalizeParticipants(state);
    normalizeTurns(state);
    state.openingStatementA = text;
    if (turnId) state.participants.A.openingTurnId = String(turnId);
    state.turns.openingTurnsDispatched = [state.openingStatementA, state.openingStatementB]
      .filter((value) => String(value || '').trim()).length;
    return maybeEnterPublicPhase(state);
  }

  function recordOpeningB(state, text, turnId = null) {
    if (!state) return state;
    normalizeParticipants(state);
    normalizeTurns(state);
    state.openingStatementB = text;
    if (turnId) state.participants.B.openingTurnId = String(turnId);
    state.turns.openingTurnsDispatched = [state.openingStatementA, state.openingStatementB]
      .filter((value) => String(value || '').trim()).length;
    return maybeEnterPublicPhase(state);
  }

  // --- A/B routing transition --------------------------------------------------

  // Applied when an approved turn from `llmName` is routed to `targetModel`
  // (mirrors the inline block in results.js routeSerialApprovedTurnToOpponent).
  function applyApprovedRoutingTargets(state, { llmName, targetModel } = {}) {
    if (!state) return state;
    normalizeParticipants(state);
    normalizeTurns(state);
    const fromSlot = slotForModel(state, llmName);
    const toSlot = slotForModel(state, targetModel);
    const targetIsA = toSlot === SPEAKERS.A;
    if (!targetIsA) {
      state.firstPublicBTurnDispatched = true;
    }
    state.waitingApprovalModel = '';
    state.currentSpeaker = toSlot || (targetModel === state.modelA ? SPEAKERS.A : SPEAKERS.B);
    state.nextTarget = fromSlot === SPEAKERS.A ? SPEAKERS.B : SPEAKERS.A;
    incrementPublicTurn(state);
    return state;
  }

  function computePublicRound(publicTurnsDispatched, maxTurns) {
    const turns = Math.max(0, Number(publicTurnsDispatched || 0));
    const cap = Number.isFinite(Number(maxTurns)) ? Number(maxTurns) : turns || 1;
    return Math.max(1, Math.min(cap, Math.ceil(Math.max(1, turns) / 2)));
  }

  function incrementPublicTurn(state) {
    if (!state) return 0;
    normalizeTurns(state);
    state.turns.publicTurnsDispatched += 1;
    state.turns.publicRound = computePublicRound(state.turns.publicTurnsDispatched, state.turns.publicTurnLimit);
    state.publicTurnsDispatched = state.turns.publicTurnsDispatched;
    state.round = state.turns.publicRound;
    state.dispatchedTurns = state.turns.publicTurnsDispatched;
    return state.turns.publicTurnsDispatched;
  }

  function appendEvent(state, {
    turnId,
    phase = EVENT_PHASES.PUBLIC,
    slot = '',
    model = null,
    role = null,
    text = '',
    promptHash = null,
    source = 'model',
    publicTurnIndex = null,
    round = null
  } = {}) {
    if (!state || !turnId) return null;
    if (!Array.isArray(state.eventLog)) state.eventLog = [];
    const id = String(turnId);
    const existing = state.eventLog.find((event) => event.turnId === id);
    if (existing) return existing;
    state.eventSeq = Number(state.eventSeq || 0) + 1;
    const event = {
      turnId: id,
      seq: state.eventSeq,
      phase: String(phase || EVENT_PHASES.PUBLIC),
      slot: String(slot || ''),
      model: model == null ? null : String(model),
      role: role == null ? null : String(role),
      text: String(text == null ? '' : text),
      promptHash: promptHash == null ? null : String(promptHash),
      source: String(source || 'model'),
      publicTurnIndex: publicTurnIndex == null ? null : Number(publicTurnIndex),
      round: round == null ? null : Number(round),
      createdAt: Date.now()
    };
    state.eventLog.push(event);
    return event;
  }

  // --- Run-status lifecycle transitions ---------------------------------------
  // Each mirrors the inline serialState mutations in results.js. Terminal
  // transitions clear `active`; running/paused keep the run live.

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

  // Public round number derived from how many turns have been dispatched.
  // (Mirrors the inline formula: 1-based, two turns per round, capped at max.)
  function computeRound(dispatchedTurns, maxTurns) {
    return Math.max(1, Math.min(maxTurns, Math.floor((dispatchedTurns - 1) / 2) + 1));
  }

  function hasReachedTurnLimit(state, maxTurns) {
    if (!state) return false;
    const externalLimit = Number.isFinite(Number(maxTurns)) ? Number(maxTurns) : null;
    normalizeTurns(state);
    const stateLimit = state.turns?.publicTurnLimit == null ? (state.turnLimit == null ? null : Number(state.turnLimit)) : Number(state.turns.publicTurnLimit);
    const limit = externalLimit != null ? externalLimit : stateLimit;
    if (limit == null || !Number.isFinite(limit)) return false;
    const publicTurns = Number(state.turns?.publicTurnsDispatched || 0);
    return publicTurns >= limit;
  }
  const shouldAutoContinue = (state, { auto, maxTurns } = {}) =>
    !!auto && !!state && !hasReachedTurnLimit(state, maxTurns);

  // --- Pure presentation / status mappers (moved verbatim from results.js) -----

  function mapMessageStatusToTurnStatus(message = {}) {
    if (message.kind === 'moderator') return 'approved';
    if (message.status === 'printing') return 'streaming';
    if (message.status === 'approved') return 'approved';
    if (message.status === 'rejected') return 'rejected';
    if (message.status === 'pending') return 'awaiting_approval';
    return 'pending';
  }

  function turnKind(turn = {}) {
    if (turn.authorType === 'moderator' || turn.author === 'Moderator') return 'moderator';
    if (turn.authorType === 'system') return 'system';
    return 'model';
  }

  function turnStatus(turn = {}) {
    if (turn.status === 'streaming') return 'printing';
    if (turn.status === 'approved' || turn.authorType === 'moderator') return 'approved';
    if (turn.status === 'rejected') return 'rejected';
    if (turn.status === 'completed' || turn.status === 'awaiting_approval') return 'pending';
    return turn.status || 'pending';
  }

  const normalizeBoolean = (value) => value === true || value === 'true';

  const normalizeKind = (value, fallback = 'answer') => {
    const kind = String(value || fallback || '').trim();
    return kind || fallback;
  };

  const api = Object.freeze({
    PHASES,
    EVENT_PHASES,
    SPEAKERS,
    STATUSES,
    createState,
    normalizeParticipants,
    setParticipants,
    retainParticipant,
    slotForModel,
    normalizeTurns,
    canRoutePublic,
    beginOpenings,
    allOpeningsCaptured,
    maybeEnterPublicPhase,
    recordOpeningA,
    recordOpeningB,
    applyApprovedRoutingTargets,
    computePublicRound,
    incrementPublicTurn,
    appendEvent,
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
    computeRound,
    hasReachedTurnLimit,
    shouldAutoContinue,
    mapMessageStatusToTurnStatus,
    turnKind,
    turnStatus,
    normalizeBoolean,
    normalizeKind
  });

  root.DebateFSM = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

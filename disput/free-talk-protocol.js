// Mutable lifecycle state for the trigger-driven FreeTalk pipeline.
(function initFreeTalkProtocol(root) {
  'use strict';

  function createState(input = {}) {
    return {
      version: 1,
      topology: 'free_talk',
      active: true,
      status: 'idle',
      phase: 'positions',
      runId: String(input.runId || ''),
      sessionId: String(input.sessionId || ''),
      topic: String(input.topic || ''),
      models: Array.isArray(input.models) ? input.models.slice() : [],
      configuredParticipants: Array.isArray(input.models) ? input.models.slice() : [],
      activeParticipants: Array.isArray(input.models) ? input.models.slice() : [],
      droppedParticipants: [],
      droppedModels: [],
      synthesizer: String(input.synthesizer || ''),
      presetId: String(input.presetId || 'FREE_TALK_MVP'),
      profileId: String(input.profileId || 'FREE_TALK_MVP'),
      actionCount: 0,
      responsesByAction: [],
      roundFilters: [],
      registry: input.registry || null,
      triggerState: root.FreeTalkRuntime?.createState?.(input.triggerState || {}) || input.triggerState || {},
      stopReason: ''
    };
  }

  function reduce(state, event = {}) {
    if (!state) return state;
    const payload = event.payload || {};
    switch (event.type) {
      case 'RUNNING': state.active = true; state.status = 'running'; break;
      case 'FREE_TALK_POSITIONS_COMPLETED': state.phase = 'trigger_loop'; state.responsesByAction.push({ kind: 'positions', turns: payload.turns || [] }); break;
      case 'FREE_TALK_ACTION_STARTED': state.phase = 'trigger_loop'; state.currentTask = payload.task || null; break;
      case 'FREE_TALK_ACTION_COMPLETED':
        state.actionCount += 1;
        state.responsesByAction.push({ kind: 'trigger', task: payload.task || null, turns: payload.turns || [] });
        state.currentTask = null;
        break;
      case 'FREE_TALK_SYNTHESIS_STARTED': state.phase = 'synthesis'; break;
      case 'FREE_TALK_SYNTHESIS_RECORDED': state.synthesisText = String(payload.text || ''); break;
      case 'PAUSED': state.status = 'paused'; break;
      case 'TECHNICAL_PAUSE': state.status = 'technical_pause'; state.stopReason = String(payload.reason || ''); break;
      case 'COMPLETED': state.active = false; state.status = 'completed'; state.phase = 'completed'; state.stopReason = String(payload.reason || 'ready'); state.epistemicOutcome = String(payload.epistemicOutcome || state.epistemicOutcome || 'inconclusive'); break;
      case 'FAILED': state.active = false; state.status = 'error'; state.stopReason = String(payload.reason || 'failed'); break;
      case 'CANCELLED': state.active = false; state.status = 'cancelled'; state.stopReason = String(payload.reason || 'cancelled'); break;
      default: break;
    }
    return state;
  }

  const by = (type) => (state, reason) => reduce(state, { type, payload: { reason } });
  const api = Object.freeze({
    createState, reduce,
    markRunning: by('RUNNING'),
    markPaused: by('PAUSED'),
    markTechnicalPause: by('TECHNICAL_PAUSE'),
    markCompleted: by('COMPLETED'),
    markError: by('FAILED'),
    markCancelled: by('CANCELLED')
  });
  root.FreeTalkProtocol = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

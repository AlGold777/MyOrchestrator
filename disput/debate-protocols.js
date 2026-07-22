// Uniform protocol facade for Duel, Triad, Multi and FreeTalk.
(function initDebateProtocols(root) {
  'use strict';

  const DebateFSM = root.DebateFSM || (typeof require === 'function' ? require('./debate-runtime') : null);
  const TriadFSM = root.TriadFSM || (typeof require === 'function' ? require('./triad-runtime') : null);
  const MultiFSM = root.MultiFSM || (typeof require === 'function' ? require('./multi-runtime') : null);
  const FreeTalkFSM = root.FreeTalkProtocol || (typeof require === 'function' ? require('./free-talk-protocol') : null);

  const topologyOf = (value) => {
    const raw = String(value?.topology || value?.scheme || value || 'duel').trim().toLowerCase();
    if (raw === '3' || raw === 'triad') return 'triad';
    if (raw === 'many' || raw === 'multi') return 'multi';
    if (raw === 'free_talk' || raw === 'freetalk' || raw === 'free-talk') return 'free_talk';
    return 'duel';
  };

  function lifecycleAdapter(fsm, topology) {
    return Object.freeze({
      topology,
      createState(config = {}) {
        return fsm.createState({ ...config, topology });
      },
      markRunning: (state) => fsm.markRunning?.(state) || state,
      markPaused: (state, reason) => (fsm.markPausedByModerator || fsm.markPaused)?.(state, reason) || state,
      markTechnicalPause: (state, reason, details) => fsm.markTechnicalPause?.(state, reason, details) || state,
      markCompleted: (state, reason) => (fsm.markCompletedByModerator || fsm.markCompleted)?.(state, reason) || state,
      markError: (state, reason) => fsm.markError?.(state, reason) || state,
      markCancelled: (state, reason) => fsm.markCancelled?.(state, reason) || state,
      reduce(state, event = {}) {
        const payload = event.payload || {};
        switch (event.type) {
          case 'RUNNING': return fsm.markRunning?.(state) || state;
          case 'PAUSED': return (fsm.markPausedByModerator || fsm.markPaused)?.(state, payload.reason) || state;
          case 'TECHNICAL_PAUSE': return fsm.markTechnicalPause?.(state, payload.reason, payload.details) || state;
          case 'COMPLETED': return (fsm.markCompletedByModerator || fsm.markCompleted)?.(state, payload.reason) || state;
          case 'FAILED': return fsm.markError?.(state, payload.reason) || state;
          case 'CANCELLED': return fsm.markCancelled?.(state, payload.reason) || state;
          case 'DUEL_OPENING_A': return topology === 'duel' ? fsm.recordOpeningA(state, payload.text, payload.turnId) : state;
          case 'DUEL_OPENING_B': return topology === 'duel' ? fsm.recordOpeningB(state, payload.text, payload.turnId) : state;
          case 'DUEL_TURN_ROUTED': return topology === 'duel' ? fsm.applyApprovedRoutingTargets(state, payload) : state;
          case 'TRIAD_INIT_ANSWER': return topology === 'triad' ? fsm.recordInitAnswer(state, payload.model, payload.text) : state;
          case 'TRIAD_WAVE_ANSWER': return topology === 'triad' ? fsm.recordWaveAnswer(state, payload.model, payload.text, payload.wave) : state;
          case 'TRIAD_WAVE_COMPLETED': return topology === 'triad' ? fsm.completeWave(state) : state;
          case 'MULTI_BEGIN_WAVE': return topology === 'multi' ? fsm.beginWave(state, payload.wave) : state;
          case 'MULTI_WAVE_COMPLETED': return topology === 'multi' ? fsm.recordWave(state, payload.turns) : state;
          case 'MULTI_BEGIN_SYNTHESIS': return topology === 'multi' ? fsm.beginSynthesis(state) : state;
          case 'MULTI_SYNTHESIS_RECORDED': return topology === 'multi' ? fsm.recordSynthesis(state, payload.text) : state;
          default: return fsm.reduce?.(state, event) || state;
        }
      },
      planNextEffects(state) {
        if (!state || (!state.active && ['completed', 'error', 'cancelled', 'stopped_by_moderator'].includes(String(state.status || '')))) return [];
        if (String(state.status || '') === 'technical_pause') return [{ type: 'WAIT_FOR_RECOVERY' }];
        if (topology === 'duel') {
          if (state.phase === 'init') return [{ type: 'DISPATCH_OPENINGS' }];
          if (fsm.hasReachedTurnLimit?.(state)) return [{ type: 'FINALIZE_DUEL' }];
          if (state.waitingApprovalModel) return [{ type: 'REQUEST_APPROVAL', model: state.waitingApprovalModel }];
          return [{ type: 'DISPATCH_DUEL_TURN', target: state.currentSpeaker }];
        }
        if (topology === 'triad') {
          if (state.phase === 'init') return [{ type: 'DISPATCH_TRIAD_INIT' }];
          if (fsm.hasReachedWaveLimit?.(state)) return [{ type: 'FINALIZE_TRIAD' }];
          if (state.waitingWaveApproval) return [{ type: 'REQUEST_APPROVAL' }];
          return [{ type: 'DISPATCH_TRIAD_WAVE', wave: Number(state.wave || 0) + 1 }];
        }
        if (topology === 'free_talk') {
          if (state.phase === 'positions') return [{ type: 'DISPATCH_FREE_TALK_POSITIONS' }];
          if (state.phase === 'synthesis') return [{ type: 'DISPATCH_FREE_TALK_SYNTHESIS' }];
          return [{ type: 'PLAN_FREE_TALK_TRIGGER' }];
        }
        if (state.phase === 'synthesis') return [{ type: 'DISPATCH_MULTI_SYNTHESIS' }];
        if (fsm.hasReachedWaveLimit?.(state)) return [{ type: 'BEGIN_MULTI_SYNTHESIS' }];
        if (state.waitingApproval) return [{ type: 'REQUEST_APPROVAL' }];
        return [{ type: 'DISPATCH_MULTI_WAVE', wave: Number(state.completedWaves || 0) + 1 }];
      },
      buildPrompt(effect, context = {}) {
        const catalog = root.DebatePromptCatalog;
        if (!catalog || !effect) return '';
        if (effect.type === 'DISPATCH_MULTI_WAVE') return catalog.buildMultiWave(context);
        if (effect.type === 'DISPATCH_MULTI_SYNTHESIS') return catalog.buildMultiFinalSynthesis(context);
        if (effect.type === 'FINALIZE_DUEL') return catalog.buildDuelFinalSynthesis(context.state || context);
        if (effect.type === 'RUN_ROUND_FILTER') return catalog.buildRoundFilter(context);
        return '';
      },
      isTerminal(state) {
        return !state?.active && ['completed', 'error', 'cancelled', 'stopped_by_moderator'].includes(String(state?.status || ''));
      }
    });
  }

  const protocols = Object.freeze({
    duel: lifecycleAdapter(DebateFSM, 'duel'),
    triad: lifecycleAdapter(TriadFSM, 'triad'),
    multi: lifecycleAdapter(MultiFSM, 'multi')
    ,free_talk: lifecycleAdapter(FreeTalkFSM, 'free_talk')
  });

  function getProtocol(value) {
    return protocols[topologyOf(value)];
  }

  const api = Object.freeze({ topologyOf, getProtocol, protocols });
  root.DebateProtocols = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

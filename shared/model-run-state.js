// shared/model-run-state.js
// Authoritative per-model run state helpers for background orchestration and results UI.

(function initModelRunState(root) {
  'use strict';

  const STATUS_CONTRACT = root.LLMStatusContract || (() => {
    if (typeof require === 'function') {
      try { return require('./status-contract'); } catch (_) { /* browser/importScripts fallback below */ }
    }
    return {};
  })();
  const SUCCESS_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.SUCCESS_STATUSES || ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN']));
  const FAILURE_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.FAILURE_STATUSES || [
    'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT',
    'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'
  ]));
  const TERMINAL_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.TERMINAL_STATUSES || [...SUCCESS_STATUSES, ...FAILURE_STATUSES]));
  const NON_FINAL_FAILURE_STATUSES = Object.freeze(Array.from(STATUS_CONTRACT.NON_TERMINAL_FAILURE_STATUSES || ['RECOVERABLE_ERROR']));
  const GENERATION_NOISE_LABELS = Object.freeze([
    'ANSWER_GENERATING',
    'ANSWER_COMPLETE_TIMEOUT',
    'ANSWER_PARTIAL_ON_TIMEOUT',
    'ANSWER: LAYER SEMANTIC',
    'PIPELINE_ERROR',
    'SELECTOR_STATS',
    'SELECTOR_RESOLVE',
    'SELECTOR_RESOLVE_FAIL',
    'FOCUS_STUCK',
    'BUDGET_EXHAUSTED',
    'DETECT_DONE',
    'DOM_FALLBACK_START',
    'DOM_FALLBACK_TIMEOUT',
    'LATE_COLLECT_DECISION_TRACE',
    'PING_TRANSPORT_ERROR',
    'RETRY ANSWER EXTRACTION',
    'WAITING FOR ANSWER TO APPEAR',
    'ANSWER UNCHANGED AFTER PING',
    'GETRESPONSES COMMAND SENT',
    'TAB_VISIT',
    'VISIT_QUOTA_BACKOFF',
    'HUMAN_VISIT_START',
    'HUMAN_VISIT_END',
    'HUMAN_VISIT_HARD_CAP',
    'LEASE_GRANTED',
    'LEASE_RELEASED',
    'USER_FOCUS_CHANGE',
    'AUTOMATION_VISIT_SKIPPED',
    'AUTOMATION_VISIT_HARD_CAP'
  ]);
  const GENERATION_NOISE_LABEL_SET = new Set(GENERATION_NOISE_LABELS);

  const TRANSITIONS = Object.freeze({
    ENTRY_CREATED: 'ENTRY_CREATED',
    STATUS_UPDATE: 'STATUS_UPDATE',
    DISPATCH_SENT: 'DISPATCH_SENT',
    GENERATION_SIGNAL: 'GENERATION_SIGNAL',
    LIFECYCLE_READY: 'LIFECYCLE_READY',
    ANSWER_CANDIDATE_ACCEPTED: 'ANSWER_CANDIDATE_ACCEPTED',
    ANSWER_CANDIDATE_REJECTED: 'ANSWER_CANDIDATE_REJECTED',
    TERMINAL_FAILURE: 'TERMINAL_FAILURE',
    MANUAL_RECOVERY_STARTED: 'MANUAL_RECOVERY_STARTED',
    POST_TERMINAL_NOISE: 'POST_TERMINAL_NOISE',
    RESET: 'RESET'
  });

  function normalizeStatus(status) {
    if (typeof STATUS_CONTRACT.normalizeStatus === 'function') {
      return STATUS_CONTRACT.normalizeStatus(status);
    }
    return String(status || '').trim().toUpperCase();
  }

  function isSuccessStatus(status) {
    if (typeof STATUS_CONTRACT.isSuccessStatus === 'function') {
      return STATUS_CONTRACT.isSuccessStatus(status);
    }
    return SUCCESS_STATUSES.includes(normalizeStatus(status));
  }

  function isFailureStatus(status) {
    if (typeof STATUS_CONTRACT.isFailureStatus === 'function') {
      return STATUS_CONTRACT.isFailureStatus(status);
    }
    return FAILURE_STATUSES.includes(normalizeStatus(status));
  }

  function isTerminalStatus(status) {
    if (typeof STATUS_CONTRACT.isTerminalStatus === 'function') {
      return STATUS_CONTRACT.isTerminalStatus(status);
    }
    return TERMINAL_STATUSES.includes(normalizeStatus(status));
  }

  function isFinalTerminalStatus(status) {
    const normalized = normalizeStatus(status);
    return isTerminalStatus(normalized) && !NON_FINAL_FAILURE_STATUSES.includes(normalized);
  }

  function hashText(value = '') {
    const text = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function resolveTerminalStatus(entry = {}) {
    const finalStatus = normalizeStatus(entry.finalStatus);
    const liveStatus = normalizeStatus(entry.status);
    if (entry.finalStatusRecorded && finalStatus) return finalStatus;
    if (entry.finalizedAt && finalStatus) return finalStatus;
    if (isFinalTerminalStatus(finalStatus)) return finalStatus;
    if (isFinalTerminalStatus(liveStatus)) return liveStatus;
    return null;
  }

  function resolveUiStatus(entry = {}, state = null) {
    const terminalStatus = state?.terminalStatus || resolveTerminalStatus(entry);
    if (terminalStatus) return terminalStatus;
    return normalizeStatus(entry.status || state?.liveStatus || 'UNKNOWN');
  }

  function deriveExecutionState(entry = {}, uiStatus = null) {
    const normalized = normalizeStatus(uiStatus || entry.status);
    if (resolveTerminalStatus(entry)) return 'terminal';
    if (['RECEIVING', 'COLLECTING', 'EXTRACTING'].includes(normalized)) return 'collecting';
    if (['GENERATING', 'PROMPT_TO_LLM', 'SENDING', 'PROMPT_READY', 'READY', 'INITIALIZING', 'API_PENDING'].includes(normalized)) {
      return 'running';
    }
    if (entry.messageSent || entry.dispatchInFlight) return 'running';
    return 'idle';
  }

  function deriveGenerationState(entry = {}, uiStatus = null) {
    const normalized = normalizeStatus(uiStatus || entry.status);
    if (entry.lifecycleReadyAt || entry.answerCompleteDetectedAt) return 'complete_detected';
    if (resolveTerminalStatus(entry)) return 'terminal';
    if (['RECEIVING', 'GENERATING'].includes(normalized)) return 'generating';
    if (entry.messageSent || entry.dispatchInFlight) return 'submitted';
    return 'not_started';
  }

  function deriveAnswerState(entry = {}, uiStatus = null) {
    const normalized = normalizeStatus(uiStatus || resolveUiStatus(entry));
    const hasAnswer = String(entry.answer || '').trim().length > 0;
    if (['SUCCESS', 'COMPLETE', 'COPY_SUCCESS', 'DONE'].includes(normalized)) return 'accepted';
    if (['PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(normalized)) return 'partial_accepted';
    if (isFailureStatus(normalized)) return hasAnswer ? 'preserved_after_failure' : 'failed';
    if (entry.pendingFinalAnswer) return 'candidate';
    if (hasAnswer) return 'candidate';
    return 'none';
  }

  function deriveModelRunState(entry = {}) {
    const previous = entry.modelRunState && typeof entry.modelRunState === 'object' ? entry.modelRunState : {};
    const terminalStatus = resolveTerminalStatus(entry);
    const uiStatus = resolveUiStatus(entry, { terminalStatus });
    const answerText = String(entry.answer || entry.pendingFinalAnswer || '').trim();
    const terminal = !!terminalStatus;
    const success = isSuccessStatus(terminalStatus || uiStatus);
    const failure = isFailureStatus(terminalStatus || uiStatus);
    const now = Date.now();
    const state = {
      schemaVersion: 1,
      llmName: entry.llmName || previous.llmName || null,
      runSessionId: previous.runSessionId || null,
      dispatchId: entry.confirmedDispatchId || entry.lastDispatchMeta?.dispatchId || previous.dispatchId || null,
      tabId: entry.tabId || previous.tabId || null,
      dispatchState: entry.dispatchState || previous.dispatchState || 'UNKNOWN',
      executionState: terminal ? (success ? 'terminal_success' : 'terminal_failure') : deriveExecutionState(entry, uiStatus),
      generationState: terminal ? 'closed' : deriveGenerationState(entry, uiStatus),
      extractionState: previous.extractionState || (answerText ? 'has_candidate' : 'none'),
      answerState: deriveAnswerState(entry, uiStatus),
      terminalState: terminal ? (success ? 'success' : (failure ? 'failure' : 'terminal')) : 'open',
      terminalStatus: terminalStatus || null,
      liveStatus: normalizeStatus(entry.status || previous.liveStatus || 'UNKNOWN'),
      uiStatus,
      finalReason: entry.statusReason || previous.finalReason || null,
      answerLength: answerText.length,
      answerHash: answerText ? hashText(answerText) : (previous.answerHash || null),
      answerAcceptedAt: previous.answerAcceptedAt || (success && entry.finalizedAt ? entry.finalizedAt : null),
      finalizedAt: entry.finalizedAt || previous.finalizedAt || null,
      postTerminalNoiseCount: Number(previous.postTerminalNoiseCount || 0),
      lastTransition: previous.lastTransition || null,
      lastTransitionAt: previous.lastTransitionAt || null,
      updatedAt: now,

      // Backward-compatible aliases used by existing tests and diagnostics.
      executionStatus: previous.executionStatus || (terminal ? (success ? 'finalized_success' : 'finalized_failure') : deriveExecutionState(entry, uiStatus)),
      generationStatus: previous.generationStatus || deriveGenerationState(entry, uiStatus),
      answerStatus: previous.answerStatus || deriveAnswerState(entry, uiStatus)
    };
    return state;
  }

  function isTerminalRunState(stateOrEntry = {}) {
    const state = stateOrEntry.modelRunState || stateOrEntry;
    if (state?.terminalStatus && !isFinalTerminalStatus(state.terminalStatus)) return false;
    return Boolean(
      state?.terminalState && state.terminalState !== 'open'
      || state?.terminalStatus
      || (stateOrEntry?.finalStatusRecorded && isFinalTerminalStatus(stateOrEntry?.finalStatus))
      || isFinalTerminalStatus(stateOrEntry?.finalStatus)
      || stateOrEntry?.finalizedAt
    );
  }

  function shouldBlockTransition(entry = {}, transition, payload = {}) {
    if (payload.force === true || payload.reset === true || transition === TRANSITIONS.RESET) {
      return { block: false, reason: 'forced' };
    }
    const terminal = isTerminalRunState(entry);
    if (!terminal) return { block: false, reason: 'open' };
    const allowedAfterTerminal = new Set([
      TRANSITIONS.POST_TERMINAL_NOISE,
      TRANSITIONS.ANSWER_CANDIDATE_ACCEPTED,
      TRANSITIONS.STATUS_UPDATE
    ]);
    if (!allowedAfterTerminal.has(transition)) {
      return { block: true, reason: 'terminal_quarantine' };
    }
    if (transition === TRANSITIONS.STATUS_UPDATE && !isTerminalStatus(payload.status)) {
      return { block: true, reason: 'terminal_blocks_non_terminal_status' };
    }
    if (
      transition === TRANSITIONS.ANSWER_CANDIDATE_ACCEPTED
      && !payload.manualRecovery
      && !payload.allowTerminalUpgrade
      && !isSuccessStatus(payload.status)
    ) {
      return { block: true, reason: 'terminal_blocks_candidate' };
    }
    return { block: false, reason: 'terminal_allowed' };
  }

  function applyModelRunTransition(entry, transition, payload = {}) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, applied: false, reason: 'missing_entry', state: null };
    }
    const normalizedTransition = String(transition || '').trim().toUpperCase();
    const block = shouldBlockTransition(entry, normalizedTransition, payload);
    if (block.block) {
      const previousState = entry.modelRunState && typeof entry.modelRunState === 'object'
        ? { ...entry.modelRunState }
        : deriveModelRunState(entry);
      if (normalizedTransition !== TRANSITIONS.POST_TERMINAL_NOISE) {
        applyModelRunTransition(entry, TRANSITIONS.POST_TERMINAL_NOISE, {
          originalTransition: normalizedTransition,
          reason: block.reason,
          label: payload.label || payload.status || null
        });
      }
      return { ok: true, applied: false, reason: block.reason, previousState, state: deriveModelRunState(entry) };
    }

    const now = Date.now();
    const previousState = entry.modelRunState && typeof entry.modelRunState === 'object'
      ? { ...entry.modelRunState }
      : deriveModelRunState(entry);
    const state = deriveModelRunState(entry);
    state.lastTransition = normalizedTransition;
    state.lastTransitionAt = now;

    if (payload.runSessionId) state.runSessionId = payload.runSessionId;
    if (payload.dispatchId) state.dispatchId = payload.dispatchId;
    if (payload.tabId) state.tabId = payload.tabId;

    switch (normalizedTransition) {
      case TRANSITIONS.ENTRY_CREATED:
        state.executionState = 'idle';
        state.generationState = 'not_started';
        state.answerState = 'none';
        state.terminalState = 'open';
        state.uiStatus = normalizeStatus(payload.status || entry.status || 'IDLE');
        break;
      case TRANSITIONS.STATUS_UPDATE: {
        const status = normalizeStatus(payload.status || entry.status);
        state.liveStatus = status || state.liveStatus;
        state.uiStatus = resolveUiStatus({ ...entry, status }, state);
        if (isFinalTerminalStatus(status)) {
          state.terminalStatus = status;
          state.terminalState = isSuccessStatus(status) ? 'success' : 'failure';
          state.executionState = isSuccessStatus(status) ? 'terminal_success' : 'terminal_failure';
          state.generationState = 'closed';
          state.finalizedAt = entry.finalizedAt || now;
        }
        break;
      }
      case TRANSITIONS.DISPATCH_SENT:
        state.executionState = 'running';
        state.generationState = 'submitted';
        state.dispatchState = payload.dispatchState || entry.dispatchState || 'WAITING';
        state.uiStatus = normalizeStatus(payload.status || entry.status || 'GENERATING');
        break;
      case TRANSITIONS.GENERATION_SIGNAL:
        state.executionState = 'running';
        state.generationState = 'generating';
        state.uiStatus = normalizeStatus(payload.status || entry.status || 'GENERATING');
        break;
      case TRANSITIONS.LIFECYCLE_READY:
        state.executionState = 'collecting';
        state.generationState = 'complete_detected';
        state.uiStatus = normalizeStatus(payload.status || entry.status || 'RECEIVING');
        break;
      case TRANSITIONS.ANSWER_CANDIDATE_REJECTED:
        state.answerState = payload.reason === 'prompt_echo_candidate' ? 'rejected_prompt_echo' : 'rejected';
        state.extractionState = 'rejected';
        state.uiStatus = normalizeStatus(payload.status || entry.status || state.uiStatus || 'RECOVERABLE_ERROR');
        break;
      case TRANSITIONS.TERMINAL_FAILURE:
        state.terminalStatus = normalizeStatus(payload.status || entry.finalStatus || entry.status || 'ERROR');
        state.terminalState = 'failure';
        state.executionState = 'terminal_failure';
        state.generationState = 'closed';
        state.answerState = state.answerLength ? 'preserved_after_failure' : 'failed';
        state.extractionState = state.answerLength ? 'preserved' : 'failed';
        state.finalReason = payload.reason || entry.statusReason || state.finalReason;
        state.finalizedAt = entry.finalizedAt || now;
        state.uiStatus = state.terminalStatus;
        break;
      case TRANSITIONS.ANSWER_CANDIDATE_ACCEPTED: {
        const status = normalizeStatus(payload.status || entry.finalStatus || entry.status || 'SUCCESS');
        const answerLength = Number(payload.answerLength || 0) || state.answerLength || 0;
        state.terminalStatus = status;
        state.terminalState = isSuccessStatus(status) ? 'success' : (isFailureStatus(status) ? 'failure' : 'terminal');
        state.executionState = isSuccessStatus(status) ? 'terminal_success' : 'terminal_failure';
        state.generationState = 'closed';
        state.extractionState = 'accepted';
        state.answerState = isFailureStatus(status)
          ? (answerLength ? 'preserved_after_failure' : 'failed')
          : (status === 'PARTIAL' || status === 'STREAM_TIMEOUT_HIDDEN' ? 'partial_accepted' : 'accepted');
        state.uiStatus = status;
        state.finalReason = payload.reason || entry.statusReason || state.finalReason;
        state.answerLength = answerLength;
        state.answerHash = payload.answerHash || state.answerHash || null;
        state.answerAcceptedAt = state.answerAcceptedAt || now;
        state.finalizedAt = entry.finalizedAt || now;
        break;
      }
      case TRANSITIONS.MANUAL_RECOVERY_STARTED:
        state.extractionState = 'manual_recovery';
        if (!state.terminalStatus) state.executionState = 'collecting';
        break;
      case TRANSITIONS.POST_TERMINAL_NOISE:
        state.postTerminalNoiseCount = Number(state.postTerminalNoiseCount || 0) + 1;
        state.lastPostTerminalNoiseAt = now;
        state.lastPostTerminalNoise = payload.label || payload.originalTransition || null;
        break;
      case TRANSITIONS.RESET:
        entry.modelRunState = null;
        entry.modelRunState = deriveModelRunState(entry);
      return { ok: true, applied: true, reason: 'reset', previousState, state: entry.modelRunState };
      default:
        break;
    }

    // Preserve legacy aliases after transition mutation.
    state.executionStatus = state.executionState;
    state.generationStatus = state.generationState;
    state.answerStatus = state.answerState;
    state.updatedAt = now;
    entry.modelRunState = state;
    return { ok: true, applied: true, reason: block.reason || 'accepted', previousState, state };
  }

  function isPostTerminalNoiseEvent(entry = {}, event = {}) {
    if (!isTerminalRunState(entry)) return false;
    const status = entry.modelRunState?.terminalStatus || entry.finalStatus || entry.status;
    if (!isSuccessStatus(status)) return false;
    const finalizedAt = Number(entry.finalizedAt || entry.modelRunState?.finalizedAt || 0);
    const eventTs = Number(event?.ts || Date.now());
    if (finalizedAt && eventTs && eventTs + 1000 < finalizedAt) return false;
    const label = normalizeStatus(event?.label || event?.event || event?.meta?.event || '');
    if (GENERATION_NOISE_LABEL_SET.has(label)) return true;
    const type = normalizeStatus(event?.type || '');
    const level = String(event?.level || '').toLowerCase();
    return level === 'error' && (type === 'TELEMETRY' || type === 'PIPELINE');
  }

  function recordPostTerminalNoise(entry, event = {}) {
    return applyModelRunTransition(entry, TRANSITIONS.POST_TERMINAL_NOISE, {
      label: event?.label || event?.event || event?.meta?.event || null
    });
  }

  function buildRunMetrics(jobState = {}) {
    const llms = jobState?.llms && typeof jobState.llms === 'object' ? jobState.llms : {};
    const entries = Object.entries(llms);
    const metrics = {
      total: entries.length,
      terminal: 0,
      terminalSuccess: 0,
      terminalFailure: 0,
      running: 0,
      collecting: 0,
      open: 0,
      answerAccepted: 0,
      answerPartial: 0,
      answerMissing: 0,
      postTerminalNoise: 0,
      statuses: {}
    };
    entries.forEach(([, entry]) => {
      const state = entry?.modelRunState || deriveModelRunState(entry || {});
      const uiStatus = normalizeStatus(state.uiStatus || entry?.status || 'UNKNOWN') || 'UNKNOWN';
      metrics.statuses[uiStatus] = (metrics.statuses[uiStatus] || 0) + 1;
      metrics.postTerminalNoise += Number(state.postTerminalNoiseCount || 0);
      if (state.terminalState && state.terminalState !== 'open') {
        metrics.terminal += 1;
        if (state.terminalState === 'success') metrics.terminalSuccess += 1;
        else metrics.terminalFailure += 1;
      } else if (state.executionState === 'collecting') {
        metrics.collecting += 1;
        metrics.open += 1;
      } else if (state.executionState === 'running') {
        metrics.running += 1;
        metrics.open += 1;
      } else {
        metrics.open += 1;
      }
      if (state.answerState === 'accepted') metrics.answerAccepted += 1;
      else if (state.answerState === 'partial_accepted') metrics.answerPartial += 1;
      else if (state.answerState === 'none' || state.answerState === 'failed') metrics.answerMissing += 1;
    });
    metrics.completedPercent = metrics.total ? Math.round((metrics.terminal / metrics.total) * 100) : 0;
    metrics.successPercent = metrics.total ? Math.round((metrics.terminalSuccess / metrics.total) * 100) : 0;
    return metrics;
  }

  const api = Object.freeze({
    TRANSITIONS,
    SUCCESS_STATUSES,
    FAILURE_STATUSES,
    TERMINAL_STATUSES,
    GENERATION_NOISE_LABELS,
    normalizeStatus,
    isSuccessStatus,
    isFailureStatus,
    isTerminalStatus,
    isFinalTerminalStatus,
    hashText,
    deriveModelRunState,
    applyModelRunTransition,
    isTerminalRunState,
    isPostTerminalNoiseEvent,
    recordPostTerminalNoise,
    buildRunMetrics
  });

  root.ModelRunState = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

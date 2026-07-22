// shared/status-contract.js
// Single status contract for background orchestration and results UI.

(function initStatusContract(root) {
  'use strict';

  const SUCCESS_STATUSES = Object.freeze(['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN']);
  const FAILURE_STATUSES = Object.freeze([
    'ERROR',
    'CRITICAL_ERROR',
    'RECOVERABLE_ERROR',
    'UNRESPONSIVE',
    'CIRCUIT_OPEN',
    'API_FAILED',
    'NO_SEND',
    'EXTRACT_FAILED',
    'STREAM_TIMEOUT',
    'EXTERNAL_LLM_FAILURE',
    'USER_ACTION_REQUIRED',
    'UNCERTAIN'
  ]);
  const NON_TERMINAL_FAILURE_STATUSES = Object.freeze(['RECOVERABLE_ERROR']);
  const TERMINAL_STATUSES = Object.freeze([
    ...SUCCESS_STATUSES,
    ...FAILURE_STATUSES.filter((status) => !NON_TERMINAL_FAILURE_STATUSES.includes(status))
  ]);
  const STATUS_RANK = Object.freeze({
    SUCCESS: 4,
    COPY_SUCCESS: 4,
    DONE: 4,
    COMPLETE: 4,
    PARTIAL: 3,
    STREAM_TIMEOUT_HIDDEN: 3,
    STREAM_TIMEOUT: 3,
    ERROR: 2,
    RECOVERABLE_ERROR: 2,
    CRITICAL_ERROR: 2,
    UNRESPONSIVE: 2,
    CIRCUIT_OPEN: 2,
    API_FAILED: 2,
    EXTRACT_FAILED: 2,
    EXTERNAL_LLM_FAILURE: 2,
    USER_ACTION_REQUIRED: 2,
    UNCERTAIN: 2,
    NO_SEND: 1
  });

  function normalizeStatus(status) {
    return String(status || '').trim().toUpperCase();
  }

  function getStatusRank(status) {
    return Number(STATUS_RANK[normalizeStatus(status)] || 0);
  }

  function isTerminalStatus(status) {
    return TERMINAL_STATUSES.includes(normalizeStatus(status));
  }

  function isSuccessStatus(status) {
    return SUCCESS_STATUSES.includes(normalizeStatus(status));
  }

  function isFailureStatus(status) {
    return FAILURE_STATUSES.includes(normalizeStatus(status));
  }

  function resolveDisplayStatus(entry = {}) {
    if (entry && entry.finalStatusRecorded && entry.finalStatus) {
      return normalizeStatus(entry.finalStatus);
    }
    return normalizeStatus(entry?.status || entry?.finalStatus || 'UNKNOWN');
  }

  function shouldApplyStatusUpdate(currentStatus, incomingStatus, options = {}) {
    const current = normalizeStatus(currentStatus);
    const incoming = normalizeStatus(incomingStatus);
    const force = options.force === true || options.reset === true;
    if (!incoming) {
      return { apply: false, reason: 'empty_incoming', current, incoming, currentRank: 0, incomingRank: 0 };
    }
    if (force) {
      return { apply: true, reason: 'forced', current, incoming, currentRank: getStatusRank(current), incomingRank: getStatusRank(incoming) };
    }
    const currentRank = getStatusRank(current);
    const incomingRank = getStatusRank(incoming);
    if (isTerminalStatus(current) && !isTerminalStatus(incoming)) {
      return { apply: false, reason: 'terminal_blocks_non_terminal', current, incoming, currentRank, incomingRank };
    }
    if (currentRank > 0 && incomingRank > 0 && incomingRank < currentRank) {
      return { apply: false, reason: 'terminal_rank_downgrade', current, incoming, currentRank, incomingRank };
    }
    if (isSuccessStatus(current) && isFailureStatus(incoming)) {
      return { apply: false, reason: 'success_blocks_failure', current, incoming, currentRank, incomingRank };
    }
    return { apply: true, reason: 'accepted', current, incoming, currentRank, incomingRank };
  }

  function deriveStatusContract(entry = {}) {
    if (entry?.modelRunState && typeof entry.modelRunState === 'object') {
      const state = entry.modelRunState;
      const uiStatus = normalizeStatus(state.uiStatus || state.terminalStatus || entry.status || 'UNKNOWN');
      const liveStatus = normalizeStatus(state.liveStatus || entry.status || 'UNKNOWN');
      const finalStatus = state.terminalStatus ? normalizeStatus(state.terminalStatus) : (
        entry?.finalStatusRecorded && entry?.finalStatus ? normalizeStatus(entry.finalStatus) : null
      );
      const executionState = (() => {
        if (String(state.executionState || '').startsWith('terminal')) return 'finalized';
        if (state.executionState === 'collecting') return 'collecting';
        if (state.executionState === 'running') return 'generating';
        return state.executionState || 'idle';
      })();
      const answerState = (() => {
        if (state.answerState === 'accepted') return 'complete';
        if (state.answerState === 'partial_accepted') return 'partial';
        if (state.answerState === 'failed') return 'failed';
        if (state.answerState === 'candidate') return 'partial';
        return entry?.answer ? 'partial' : 'none';
      })();
      return {
        executionState,
        answerState,
        liveStatus,
        finalStatus,
        uiStatus,
        terminal: isTerminalStatus(uiStatus),
        rank: getStatusRank(uiStatus),
        modelRunState: state
      };
    }
    const finalStatus = entry?.finalStatusRecorded && entry?.finalStatus ? normalizeStatus(entry.finalStatus) : null;
    const liveStatus = normalizeStatus(entry?.status || 'UNKNOWN');
    const uiStatus = finalStatus || liveStatus;
    const executionState = finalStatus
      ? 'finalized'
      : (['RECEIVING'].includes(liveStatus)
        ? 'collecting'
        : (['GENERATING', 'PROMPT_TO_LLM', 'SENDING', 'PROMPT_READY', 'READY', 'INITIALIZING'].includes(liveStatus)
          ? 'generating'
          : 'idle'));
    const answerState = (() => {
      if (['SUCCESS', 'COMPLETE', 'COPY_SUCCESS', 'DONE'].includes(uiStatus)) return 'complete';
      if (['PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].includes(uiStatus)) return 'partial';
      if (uiStatus === 'USER_ACTION_REQUIRED') return 'action_required';
      if (uiStatus === 'UNCERTAIN') return 'unknown';
      if (isFailureStatus(uiStatus)) return 'failed';
      return entry?.answer ? 'partial' : 'none';
    })();
    return {
      executionState,
      answerState,
      liveStatus,
      finalStatus,
      uiStatus,
      terminal: isTerminalStatus(uiStatus),
      rank: getStatusRank(uiStatus)
    };
  }

  function deriveResultMeta(entry = {}) {
    const state = deriveStatusContract(entry);
    const uiStatus = normalizeStatus(state.uiStatus || entry?.status || 'UNKNOWN');
    const phase = (() => {
      if (uiStatus === 'USER_ACTION_REQUIRED') return 'action_required';
      if (uiStatus === 'UNCERTAIN') return 'unknown';
      if (isFailureStatus(uiStatus)) return 'error';
      if (state.answerState === 'partial') return 'partial';
      if (['PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'STREAM_TIMEOUT'].includes(uiStatus)) return 'partial';
      if (state.answerState === 'complete' || isSuccessStatus(uiStatus)) return 'success';
      return 'pending';
    })();
    const labels = {
      pending: 'Pending',
      success: 'Success',
      partial: 'Partial',
      error: 'Error',
      action_required: 'Action required',
      unknown: 'Uncertain'
    };
    return {
      phase,
      label: labels[phase] || labels.pending,
      status: uiStatus,
      executionState: state.executionState,
      answerState: state.answerState,
      finalStatus: state.finalStatus || null,
      terminal: !!state.terminal,
      rank: state.rank
    };
  }

  const contract = Object.freeze({
    SUCCESS_STATUSES,
    FAILURE_STATUSES,
    TERMINAL_STATUSES,
    NON_TERMINAL_FAILURE_STATUSES,
    STATUS_RANK,
    normalizeStatus,
    getStatusRank,
    isTerminalStatus,
    isSuccessStatus,
    isFailureStatus,
    resolveDisplayStatus,
    shouldApplyStatusUpdate,
    deriveStatusContract,
    deriveResultMeta
  });

  root.LLMStatusContract = contract;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = contract;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

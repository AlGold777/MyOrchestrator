// Versioned, machine-first event contract for Debate observability.
(function initDebateTraceSchema(root) {
  'use strict';

  const VERSION = 3;
  const SOURCES = Object.freeze({
    APPLICATION: 'application', RUNNER: 'runner', RUN_STORE: 'run_store',
    BACKGROUND: 'background', CONTENT: 'content', RECOVERY: 'recovery',
    UI_PROJECTION: 'ui_projection', LEGACY: 'legacy_adapter'
  });
  const SEVERITIES = Object.freeze({ DEBUG: 'debug', INFO: 'info', WARNING: 'warning', HIGH: 'high', CRITICAL: 'critical' });
  const EVENT_TYPES = Object.freeze([
    'RUN_CREATED', 'PLAN_COMPILED', 'PLAN_VALIDATION_FAILED', 'RUN_STARTED',
    'RUN_PAUSED', 'RUN_RESUMED', 'RUN_CANCELLED', 'RUN_COMPLETED', 'RUN_FAILED',
    'STAGE_SCHEDULED', 'STAGE_STARTED', 'STAGE_COMPLETED', 'STAGE_FAILED',
    'STAGE_SKIPPED', 'STAGE_ARTIFACT_PRODUCED', 'BARRIER_OPENED',
    'BARRIER_PARTICIPANT_READY', 'BARRIER_PARTICIPANT_FAILED', 'BARRIER_WAITING',
    'BARRIER_RELEASED', 'BARRIER_TIMEOUT', 'DISPATCH_CREATED', 'TAB_ACQUIRED',
    'COMPOSER_READY', 'PROMPT_INSERTED', 'SUBMIT_ATTEMPTED', 'SUBMIT_CONFIRMED',
    'SUBMIT_REJECTED', 'SUBMIT_TIMEOUT', 'GENERATION_OBSERVED',
    'FRESH_ANSWER_OBSERVED', 'TEXT_STABLE', 'COMPLETION_DETECTED',
    'ANSWER_COLLECTED', 'ANSWER_REJECTED', 'MODEL_TERMINAL_COMMITTED',
    'RECOVERY_REQUIRED', 'RECOVERY_ATTEMPT_STARTED', 'RECOVERY_ATTEMPT_FAILED',
    'RECOVERY_ATTEMPT_SUCCEEDED', 'MANUAL_RECOVERY_REQUESTED',
    'TERMINAL_FAILURE_UPGRADED', 'STABLE_TEXT_FALLBACK_USED',
    'DROPOUT_DECISION_REQUESTED', 'DROPOUT_CONTINUE_SELECTED',
    'DROPOUT_STOP_SELECTED', 'STATE_DIVERGENCE', 'STALE_EVENT_REJECTED',
    'CORRELATION_REJECTED', 'DUPLICATE_FINAL_REJECTED',
    'UNEXPECTED_STAGE_TRANSITION', 'MISSING_REQUIRED_ARTIFACT',
    'UI_PROJECTION_FAILED', 'TAB_OWNERSHIP_VIOLATION', 'PLAN_ACTUAL_MISMATCH',
    'PROMPT_COMPILED', 'STATE_DELTA_PROPOSED', 'STATE_DELTA_APPLIED',
    'STATE_DELTA_REJECTED', 'HUMAN_DECISION_RECORDED', 'INDEPENDENCE_DEGRADED',
    'CONTEXT_PART_OMITTED', 'RESPONSE_CONTRACT_REPAIR',
    'DECISION_REQUESTED', 'DECISION_RESOLVED', 'RULE_EVALUATED', 'RULE_FIRED',
    'RULE_SUPPRESSED', 'PROGRESS_WINDOW_UPDATED', 'MODEL_SIGNAL_OBSERVED',
    'MODEL_SIGNAL_INVALID',
    'LEGACY_TIMELINE_EVENT', 'LEGACY_DIAGNOSTIC_EVENT'
  ]);
  const EVENT_SET = new Set(EVENT_TYPES);
  const CRITICAL_FLUSH = new Set(EVENT_TYPES.filter((type) => (
    /(?:FAILED|CANCELLED|COMPLETED|REJECTED|DIVERGENCE|TIMEOUT|UPGRADED)$/.test(type)
    || type === 'MODEL_TERMINAL_COMMITTED'
    || type === 'STABLE_TEXT_FALLBACK_USED'
  )));
  const CORRELATION_KEYS = Object.freeze([
    'debateRunId', 'planId', 'stageId', 'stageAttemptId', 'pipelineRunId',
    'pipelineRoundId', 'pipelineBatchId', 'dispatchId', 'tabId', 'sessionId'
  ]);
  const FORBIDDEN_KEY = /(?:^|_)(?:prompt|answer|html|dom|cookie|authorization|api.?key|access.?token|refresh.?token|credential|secret)(?:$|_)/i;
  const SECRET_PATTERNS = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    /\bsk-[A-Za-z0-9_-]{12,}/g,
    /\b(?:api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]{8,}/gi
  ];

  const cleanString = (value) => {
    let text = String(value == null ? '' : value);
    SECRET_PATTERNS.forEach((pattern) => { text = text.replace(pattern, '[REDACTED]'); });
    return root.SecretRedaction?.redactString ? root.SecretRedaction.redactString(text) : text;
  };

  function sanitize(value, stats = { redactedFieldsCount: 0 }, key = '') {
    if (FORBIDDEN_KEY.test(String(key || ''))) {
      stats.redactedFieldsCount += 1;
      return '[REDACTED]';
    }
    if (typeof value === 'string') return cleanString(value);
    if (Array.isArray(value)) return value.map((item) => sanitize(item, stats));
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.entries(value).forEach(([childKey, childValue]) => {
      result[childKey] = sanitize(childValue, stats, childKey);
    });
    return result;
  }

  const normalizeCorrelation = (value = {}) => {
    const result = {};
    CORRELATION_KEYS.forEach((key) => {
      const raw = value?.[key];
      if (raw !== null && typeof raw !== 'undefined' && String(raw).trim()) result[key] = String(raw).trim();
    });
    result.correlationQuality = ['exact', 'partial', 'inferred'].includes(value?.correlationQuality)
      ? value.correlationQuality
      : (result.debateRunId ? 'exact' : 'partial');
    return result;
  };

  function validate(input = {}) {
    const errors = [];
    if (!EVENT_SET.has(String(input.eventType || ''))) errors.push('unknown_event_type');
    if (!String(input.source || '').trim()) errors.push('missing_source');
    if (!input.correlation?.debateRunId && input.eventType !== 'RUN_CREATED') errors.push('missing_debate_run_id');
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) errors.push('invalid_payload');
    return errors;
  }

  function createEvent(input = {}, collector = {}) {
    const stats = { redactedFieldsCount: 0 };
    const correlation = normalizeCorrelation({ ...(collector.correlation || {}), ...(input.correlation || {}) });
    const sourceTimestamp = Number(input.sourceTimestamp || input.timestamp || 0) || Date.now();
    const eventType = String(input.eventType || 'LEGACY_DIAGNOSTIC_EVENT').trim().toUpperCase();
    const receivedSeq = Math.max(0, Number(collector.receivedSeq || input.receivedSeq || 0));
    const eventId = String(input.eventId || `${correlation.debateRunId || 'unscoped'}:${receivedSeq || sourceTimestamp}:${eventType}`);
    const event = {
      schemaVersion: VERSION,
      eventId,
      eventType,
      source: String(input.source || SOURCES.LEGACY),
      severity: String(input.severity || SEVERITIES.INFO),
      sourceTimestamp,
      receivedAt: Number(collector.receivedAt || input.receivedAt || 0) || Date.now(),
      receivedSeq,
      reasonCode: String(input.reasonCode || ''),
      correlation,
      causality: sanitize({
        parentEventId: input.causality?.parentEventId || '',
        causedByEventId: input.causality?.causedByEventId || '',
        relatedEventIds: Array.isArray(input.causality?.relatedEventIds) ? input.causality.relatedEventIds : []
      }, stats),
      payload: sanitize(input.payload && typeof input.payload === 'object' ? input.payload : {}, stats),
      provenance: String(input.provenance || (input.source === SOURCES.LEGACY ? 'legacy_adapter' : 'native')),
      redactedFieldsCount: stats.redactedFieldsCount
    };
    event.validationErrors = validate(event);
    return Object.freeze(event);
  }

  const api = Object.freeze({
    VERSION, SOURCES, SEVERITIES, EVENT_TYPES, CORRELATION_KEYS, CRITICAL_FLUSH,
    sanitize, normalizeCorrelation, validate, createEvent
  });
  root.DebateTraceSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

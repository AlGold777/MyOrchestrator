// shared/log-replay-harness.js
// Deterministic replay helpers for diagnostics/telemetry/decision-ledger logs.

(function initLogReplayHarness(root) {
  'use strict';

  const FINAL_STATUSES = new Set([
    'SUCCESS',
    'PARTIAL',
    'ERROR',
    'NO_SEND',
    'EXTRACT_FAILED',
    'STREAM_TIMEOUT',
    'EXTERNAL_LLM_FAILURE',
    'USER_ACTION_REQUIRED',
    'UNCERTAIN'
  ]);
  const FAILURE_STATUS = new Set(['ERROR', 'FAILED', 'TIMEOUT', 'CANCELLED', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN']);
  const INPUT_SCHEMAS = Object.freeze({
    EMPTY: 'empty',
    LEGACY_EVENTS_V1: 'legacy-events-v1',
    LEGACY_GROUPED_V1: 'legacy-grouped-v1',
    PROOF_EVENTS_V6: 'proof-events-v6',
    ALL_PRESETS_V5: 'all-presets-v5',
    STANDALONE_REPORT_V5: 'standalone-report-v5',
    MIXED: 'mixed',
    UNSUPPORTED: 'unsupported'
  });

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function upper(value) {
    return normalizeText(value).toUpperCase();
  }

  function getMeta(event = {}) {
    const meta = event.meta && typeof event.meta === 'object' ? event.meta : {};
    const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const payloadMetadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    return Object.assign({}, metadata, payloadMetadata, payload, meta);
  }

  function extractModelName(event = {}) {
    const meta = getMeta(event);
    return normalizeText(
      event.llmName
      || event.modelId
      || event.modelName
      || event.model
      || meta.llmName
      || meta.modelName
      || meta.model
      || 'unknown'
    );
  }

  function extractDecision(event = {}) {
    const meta = getMeta(event);
    return normalizeText(
      event.decision
      || meta.decision
      || event.finalizationDecision?.decision
      || meta.finalizationDecision?.decision
      || event.lastDecisionRecord?.decision
      || meta.lastDecisionRecord?.decision
    );
  }

  function extractReason(event = {}) {
    const meta = getMeta(event);
    return normalizeText(
      event.reason
      || meta.reason
      || event.error
      || meta.error
      || event.lastDecisionRecord?.reason
      || meta.lastDecisionRecord?.reason
    );
  }

  function extractStatus(event = {}) {
    const meta = getMeta(event);
    return upper(
      event.status
      || event.finalStatus
      || meta.status
      || meta.finalStatus
      || event.resultingState
      || meta.resultingState
      || event.lastDecisionRecord?.resultingState
      || meta.lastDecisionRecord?.resultingState
    );
  }

  function extractLabel(event = {}) {
    return normalizeText(event.eventType || event.label || event.type || event.event || event.name);
  }

  function normalizeLegacyReplayEvent(event = {}) {
    const meta = getMeta(event);
    const label = extractLabel(event);
    const decision = extractDecision(event);
    const reason = extractReason(event);
    const status = extractStatus(event);
    const telemetryTaxonomy = meta.telemetryTaxonomy || event.telemetryTaxonomy || null;
    const ts = Number(event.ts || event.timestamp || event.time || meta.ts || meta.timestamp || 0) || null;
    return {
      raw: event,
      ts,
      llmName: extractModelName(event),
      label,
      labelKey: upper(label),
      status,
      decision,
      decisionKey: normalizeText(decision).toLowerCase(),
      reason,
      meta,
      telemetryTaxonomy
    };
  }

  function normalizeProofReplayEvent(event = {}) {
    const normalized = normalizeLegacyReplayEvent(event);
    return {
      ...normalized,
      ts: Number(event.wallTs) || normalized.ts,
      llmName: normalizeText(event.modelId || normalized.llmName),
      label: normalizeText(event.eventType),
      labelKey: upper(event.eventType),
      schemaVersion: Number(event.schemaVersion || 0),
      eventId: normalizeText(event.eventId),
      seq: Number(event.seq || 0) || null
    };
  }

  const normalizeReplayEvent = normalizeLegacyReplayEvent;

  function isProofEventV6(event) {
    return Number(event?.schemaVersion) === 6
      && typeof event?.eventId === 'string'
      && typeof event?.eventType === 'string'
      && typeof event?.modelId === 'string'
      && Number.isFinite(Number(event?.wallTs));
  }

  function isLegacyEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
    if (isProofEventV6(event)) return false;
    return Boolean(normalizeText(event.label || event.event || event.name)
      || (normalizeText(event.type) && Number.isFinite(Number(event.ts || event.timestamp || event.time))));
  }

  function detectInputSchema(input) {
    if (Array.isArray(input)) {
      if (!input.length) return INPUT_SCHEMAS.EMPTY;
      const proofCount = input.filter(isProofEventV6).length;
      const legacyCount = input.filter(isLegacyEvent).length;
      if (proofCount === input.length) return INPUT_SCHEMAS.PROOF_EVENTS_V6;
      if (legacyCount === input.length) return INPUT_SCHEMAS.LEGACY_EVENTS_V1;
      if (proofCount || legacyCount) return INPUT_SCHEMAS.MIXED;
      return INPUT_SCHEMAS.UNSUPPORTED;
    }
    if (!input || typeof input !== 'object') return INPUT_SCHEMAS.UNSUPPORTED;
    if (input.containerType === 'all-presets' && Array.isArray(input?.ledger?.events)) return INPUT_SCHEMAS.ALL_PRESETS_V5;
    if (input.fileKind === 'diagnostic-report' && Array.isArray(input?.eventSelection?.materializedEvents)) return INPUT_SCHEMAS.STANDALONE_REPORT_V5;
    const values = Object.values(input);
    if (values.length && values.every(Array.isArray)) {
      const flattened = values.flat();
      return flattened.length && flattened.every(isLegacyEvent)
        ? INPUT_SCHEMAS.LEGACY_GROUPED_V1
        : INPUT_SCHEMAS.UNSUPPORTED;
    }
    return INPUT_SCHEMAS.UNSUPPORTED;
  }

  function resolveInput(input) {
    const inputSchema = detectInputSchema(input);
    if (inputSchema === INPUT_SCHEMAS.EMPTY) return { inputSchema, events: [], adapter: 'empty' };
    if (inputSchema === INPUT_SCHEMAS.LEGACY_EVENTS_V1) return { inputSchema, events: input.slice(), adapter: 'legacy' };
    if (inputSchema === INPUT_SCHEMAS.LEGACY_GROUPED_V1) return { inputSchema, events: Object.values(input).flat(), adapter: 'legacy' };
    if (inputSchema === INPUT_SCHEMAS.PROOF_EVENTS_V6) return { inputSchema, events: input.slice(), adapter: 'proof-v6' };
    if (inputSchema === INPUT_SCHEMAS.ALL_PRESETS_V5) return { inputSchema, events: input.ledger.events.slice(), adapter: 'proof-v6' };
    if (inputSchema === INPUT_SCHEMAS.STANDALONE_REPORT_V5) return { inputSchema, events: input.eventSelection.materializedEvents.slice(), adapter: 'proof-v6' };
    const error = new TypeError(`Unsupported replay input schema: ${inputSchema}`);
    error.code = 'UNSUPPORTED_REPLAY_SCHEMA';
    error.inputSchema = inputSchema;
    throw error;
  }

  function ensureModel(result, llmName) {
    const key = llmName || 'unknown';
    if (!result.models[key]) {
      result.models[key] = {
        llmName: key,
        finalStatus: null,
        finalReason: null,
        decisions: [],
        staleEvents: 0,
        recoveryDenied: 0,
        duplicateFinalIgnored: 0,
        terminalEvents: 0,
        lastEventAt: null
      };
    }
    return result.models[key];
  }

  function appendDecision(model, event) {
    if (!event.decisionKey) return;
    model.decisions.push({
      ts: event.ts,
      decision: event.decision,
      reason: event.reason || null,
      status: event.status || null,
      label: event.label || null
    });
  }

  function applyEvent(model, event) {
    model.lastEventAt = event.ts || model.lastEventAt;
    appendDecision(model, event);

    const taxonomyClass = normalizeText(event.telemetryTaxonomy?.eventClass).toLowerCase();
    const duplicateFinal = event.decisionKey === 'ignore_duplicate_final'
      || taxonomyClass === 'finalization_duplicate_ignored'
      || event.labelKey.includes('DEDUPLICATED')
      || event.reason === 'duplicate_final';
    if (duplicateFinal) {
      model.duplicateFinalIgnored += 1;
      return;
    }

    if (event.decisionKey === 'ignore_stale_event' || event.labelKey.includes('STALE_EVENT_QUARANTINED')) {
      model.staleEvents += 1;
    }
    if (event.decisionKey === 'deny_recovery_intent' || event.labelKey.includes('RECOVERY_INTENT_DENIED')) {
      model.recoveryDenied += 1;
    }

    const acceptedTerminal = event.decisionKey === 'accept_success'
      || event.decisionKey === 'finalize_error'
      || event.decisionKey === 'upgrade_terminal';
    const terminalLabel = event.labelKey.includes('MODEL_FINAL')
      || event.labelKey.includes('MODEL_TERMINAL_RECORDED')
      || event.labelKey.includes('PIPELINE_ERROR');
    if ((acceptedTerminal || terminalLabel) && FINAL_STATUSES.has(event.status)) {
      model.finalStatus = event.status;
      model.finalReason = event.reason || model.finalReason;
      model.terminalEvents += 1;
      return;
    }
    if (!model.finalStatus && FAILURE_STATUS.has(event.status)) {
      model.finalStatus = 'ERROR';
      model.finalReason = event.reason || event.status.toLowerCase();
    }
  }

  function replay(input = []) {
    const resolved = resolveInput(input);
    const result = {
      schemaVersion: 1,
      inputSchema: resolved.inputSchema,
      adapter: resolved.adapter,
      models: {},
      totals: {
        events: 0,
        models: 0,
        staleEvents: 0,
        recoveryDenied: 0,
        duplicateFinalIgnored: 0,
        terminalEvents: 0
      }
    };
    const normalized = resolved.events.map(resolved.adapter === 'proof-v6'
      ? normalizeProofReplayEvent
      : normalizeLegacyReplayEvent);
    normalized.forEach((event) => {
      result.totals.events += 1;
      const model = ensureModel(result, event.llmName);
      applyEvent(model, event);
    });
    Object.values(result.models).forEach((model) => {
      result.totals.staleEvents += model.staleEvents;
      result.totals.recoveryDenied += model.recoveryDenied;
      result.totals.duplicateFinalIgnored += model.duplicateFinalIgnored;
      result.totals.terminalEvents += model.terminalEvents;
    });
    result.totals.models = Object.keys(result.models).length;
    if (resolved.adapter === 'proof-v6') {
      const policy = root.ProofTelemetryPolicy
        || (typeof require === 'function' ? require('./proof-telemetry-policy.js') : null);
      if (!policy?.replay) {
        const error = new Error('ProofTelemetryPolicy.replay is unavailable for schema 6 comparison');
        error.code = 'PROOF_POLICY_REPLAY_UNAVAILABLE';
        throw error;
      }
      const policyReplay = policy.replay(resolved.events);
      const summaryModels = Object.keys(result.models).sort();
      const policyModels = Object.keys(policyReplay.models || {}).sort();
      result.proofPolicyComparison = {
        compared: true,
        modelSetEquivalent: JSON.stringify(summaryModels) === JSON.stringify(policyModels),
        summaryModels,
        policyModels,
        invariantViolationCount: (policyReplay.invariantViolations || []).length,
        throughSeqByModel: Object.fromEntries(Object.entries(policyReplay.models || {})
          .map(([modelId, state]) => [modelId, state.throughSeq || null]))
      };
    } else {
      result.proofPolicyComparison = { compared: false, reason: 'legacy-input-requires-canonicalization' };
    }
    return result;
  }

  const api = Object.freeze({
    INPUT_SCHEMAS,
    detectInputSchema,
    resolveInput,
    normalizeLegacyReplayEvent,
    normalizeProofReplayEvent,
    normalizeReplayEvent,
    replay
  });

  root.LogReplayHarness = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

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
    return Object.assign({}, metadata, payload, meta);
  }

  function extractModelName(event = {}) {
    const meta = getMeta(event);
    return normalizeText(
      event.llmName
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
    return normalizeText(event.label || event.type || event.event || event.name);
  }

  function normalizeReplayEvent(event = {}) {
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
    const terminalLabel = event.labelKey.includes('MODEL_FINAL') || event.labelKey.includes('PIPELINE_ERROR');
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

  function replay(events = []) {
    const result = {
      schemaVersion: 1,
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
    const normalized = Array.isArray(events) ? events.map(normalizeReplayEvent) : [];
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
    return result;
  }

  const api = Object.freeze({
    normalizeReplayEvent,
    replay
  });

  root.LogReplayHarness = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

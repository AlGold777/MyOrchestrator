// Read-only Timeline and Markdown projections from the canonical proof ledger.
(function initProofTelemetryPresentations(root) {
  'use strict';

  const PRESENTATION_VERSION = 'proof-presentations@1.0.0';

  function sourceType(event) {
    return String(event?.payload?.sourceEventType || event?.eventType || event?.label || event?.type || 'UNKNOWN');
  }

  function modelId(event) {
    return String(event?.modelId || event?.platform || event?.llmName || event?.meta?.llmName || 'SYSTEM');
  }

  function dispatchId(event) {
    return event?.dispatchId || event?.meta?.dispatchId || null;
  }

  function timestamp(event) {
    return Number(event?.wallTs || event?.ts || 0);
  }

  function timelineRows(events = []) {
    return (Array.isArray(events) ? events : []).map((event, index) => ({
      seq: Number(event?.seq || event?.ingestSeq || index + 1),
      eventId: event?.eventId || null,
      timestamp: timestamp(event),
      modelId: modelId(event),
      dispatchId: dispatchId(event),
      generationEpoch: event?.generationEpoch ?? event?.meta?.generationEpoch ?? null,
      eventType: String(event?.eventType || event?.label || event?.type || 'UNKNOWN'),
      sourceEventType: sourceType(event),
      layer: event?.layer || 'legacy',
      factKind: event?.payload?.typed?.kind || null,
      factState: event?.payload?.typed?.state || null
    })).sort((left, right) => Number(left.seq) - Number(right.seq));
  }

  function sortedUnique(values) {
    return Array.from(new Set(values.filter(Boolean).map(String))).sort();
  }

  function compareLegacyToProof(legacyEvents = [], proofEvents = []) {
    const legacyRows = timelineRows(legacyEvents);
    const proofRows = timelineRows(proofEvents);
    const legacyTypes = new Set(legacyRows.map((row) => row.sourceEventType));
    const proofSourceTypes = new Set(proofRows.map((row) => row.sourceEventType));
    const legacyModels = sortedUnique(legacyRows.map((row) => row.modelId));
    const proofModels = sortedUnique(proofRows.map((row) => row.modelId).filter((value) => value !== 'SYSTEM'));
    const legacyDispatches = sortedUnique(legacyRows.map((row) => row.dispatchId));
    const proofDispatches = sortedUnique(proofRows.map((row) => row.dispatchId));
    const legacyTerminalCount = legacyRows.filter((row) => /MODEL_FINAL|MODEL_TERMINAL_RECORDED/.test(row.sourceEventType)).length;
    const proofTerminalCount = proofRows.filter((row) => row.eventType === 'MODEL_TERMINAL_RECORDED').length;
    const legacyOnlyEventTypes = [...legacyTypes].filter((type) => !proofSourceTypes.has(type)).sort();
    const proofOnlyEventTypes = [...proofSourceTypes].filter((type) => !legacyTypes.has(type)).sort();
    const mismatchCodes = [];
    if (JSON.stringify(legacyModels) !== JSON.stringify(proofModels)) mismatchCodes.push('model_set_mismatch');
    if (JSON.stringify(legacyDispatches) !== JSON.stringify(proofDispatches)) mismatchCodes.push('dispatch_identity_mismatch');
    if (legacyTerminalCount !== proofTerminalCount) mismatchCodes.push('terminal_count_mismatch');
    const legacyBoundary = { firstTs: legacyRows.length ? Math.min(...legacyRows.map((row) => row.timestamp).filter(Number.isFinite)) : null, lastTs: legacyRows.length ? Math.max(...legacyRows.map((row) => row.timestamp).filter(Number.isFinite)) : null };
    const proofBoundary = { firstTs: proofRows.length ? Math.min(...proofRows.map((row) => row.timestamp).filter(Number.isFinite)) : null, lastTs: proofRows.length ? Math.max(...proofRows.map((row) => row.timestamp).filter(Number.isFinite)) : null };
    return {
      version: PRESENTATION_VERSION,
      status: mismatchCodes.length ? 'mismatch' : 'matched',
      mismatchCodes,
      legacyEventCount: legacyRows.length,
      proofEventCount: proofRows.length,
      legacyModels,
      proofModels,
      legacyDispatches,
      proofDispatches,
      legacyTerminalCount,
      proofTerminalCount,
      legacyBoundary,
      proofBoundary,
      legacyOnlyEventTypes,
      proofOnlyEventTypes
    };
  }

  function escapeMarkdown(value) {
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }

  function renderMarkdown(events = [], options = {}) {
    const rows = timelineRows(events);
    const title = options.title || 'Canonical proof telemetry';
    const boundary = options.snapshotBoundary || {};
    const header = [
      `## ${title}`,
      '',
      `Projection: ${PRESENTATION_VERSION}`,
      `Snapshot: ${boundary.runSessionId || 'unknown'} through seq ${boundary.ledgerCompleteThroughSeq ?? (rows[rows.length - 1]?.seq || 0)}`,
      '',
      'Seq | Time | Model | Dispatch | Event | Layer | Fact | EventId',
      '--- | --- | --- | --- | --- | --- | --- | ---'
    ];
    const lines = rows.map((row) => [
      row.seq,
      row.timestamp ? new Date(row.timestamp).toISOString() : '-',
      row.modelId,
      row.dispatchId || '-',
      row.eventType,
      row.layer,
      [row.factKind, row.factState].filter(Boolean).join(':') || '-',
      row.eventId || '-'
    ].map(escapeMarkdown).join(' | '));
    if (!lines.length) lines.push('_No canonical proof events were captured._');
    return `${header.join('\n')}\n${lines.join('\n')}\n`;
  }

  function buildShadowBundle(legacyEvents = [], proofEvents = [], options = {}) {
    return {
      version: PRESENTATION_VERSION,
      timeline: timelineRows(proofEvents),
      markdown: renderMarkdown(proofEvents, options),
      comparison: compareLegacyToProof(legacyEvents, proofEvents),
      generatedAt: Number(options.generatedAt || Date.now())
    };
  }

  const api = Object.freeze({ PRESENTATION_VERSION, timelineRows, compareLegacyToProof, renderMarkdown, buildShadowBundle });
  root.ProofTelemetryPresentations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

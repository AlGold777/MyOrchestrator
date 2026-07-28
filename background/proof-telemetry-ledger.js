// background/proof-telemetry-ledger.js
// Persistent append-only schema 5 ledger for the active runtime run.

'use strict';

(function initProofTelemetryLedger(root) {
  const STORAGE_KEY = '__proof_telemetry_ledger_v5__';
  const MAX_EVENTS = 10000;
  const PRODUCER_VERSION = 'proof-runtime-ledger@1.0.0';
  let mutationChain = Promise.resolve();

  const proof = () => root.ProofOrientedTelemetry;

  async function readStored() {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const value = stored?.[STORAGE_KEY];
    if (!value || typeof value !== 'object') return { runSessionId: null, firstWallTs: null, events: [] };
    return {
      runSessionId: value.runSessionId ?? null,
      firstWallTs: Number(value.firstWallTs || 0) || null,
      events: Array.isArray(value.events) ? value.events : []
    };
  }

  async function writeStored(value) {
    await chrome.storage.local.set({ [STORAGE_KEY]: value });
    return value;
  }

  function enqueue(mutator) {
    const operation = mutationChain.catch(() => {}).then(async () => {
      const current = await readStored();
      const next = await mutator(current);
      return next === current ? current : writeStored(next);
    });
    mutationChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function resolveRunSessionId(entry = {}, fallback = null) {
    return entry?.meta?.runSessionId || entry?.runSessionId || entry?.sessionId || fallback || null;
  }

  function createEvent(entry = {}, llmName, state, options = {}) {
    const api = proof();
    if (!api) return null;
    const wallTs = Number(entry?.ts || Date.now());
    const seq = state.events.length + 1;
    const runSessionId = resolveRunSessionId(entry, options.runSessionId || state.runSessionId || `runtime-${wallTs}`);
    const modelId = String(llmName || entry?.platform || entry?.llmName || entry?.meta?.llmName || 'SYSTEM');
    const eventType = String(entry?.proofEventType || entry?.meta?.proofEventType || api.canonicalType(entry));
    const metadata = api.sanitizeValue(entry?.meta || {}, 'meta') || {};
    const dispatchId = metadata.dispatchId || metadata.requestId || undefined;
    const firstWallTs = state.firstWallTs || wallTs;
    const sourceEventType = String(entry?.label || entry?.event || entry?.meta?.event || 'UNKNOWN')
      .trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'UNKNOWN';
    const event = {
      schemaVersion: api.EVENT_SCHEMA_VERSION,
      eventId: `ev-${seq}-${api.eventFingerprint(`${runSessionId}|${modelId}|${dispatchId || ''}|${sourceEventType}|${wallTs}|${seq}`)}`,
      eventType,
      layer: String(entry?.proofLayer || entry?.meta?.proofLayer || api.layerFor(eventType)),
      seq,
      wallTs,
      monoMs: Math.max(0, wallTs - firstWallTs),
      runSessionId: String(runSessionId),
      modelId,
      producer: {
        component: String(entry?.meta?.producerComponent || options.producerComponent || 'runtime-telemetry'),
        version: String(entry?.meta?.producerVersion || options.producerVersion || PRODUCER_VERSION)
      },
      payload: {
        sourceEventType,
        sourceLevel: String(entry?.level || 'info'),
        detailsLength: String(entry?.details || '').length,
        metadata
      }
    };
    if (dispatchId) event.dispatchId = String(dispatchId);
    if (Number.isFinite(Number(metadata.generationEpoch))) event.generationEpoch = Number(metadata.generationEpoch);
    if (Number.isFinite(Number(metadata.tabId))) event.tabId = Number(metadata.tabId);
    if (metadata.documentInstanceId) event.documentInstanceId = String(metadata.documentInstanceId);
    if (Number.isFinite(Number(metadata.navigationEpoch))) event.navigationEpoch = Number(metadata.navigationEpoch);
    if (metadata.conversationId !== undefined) event.conversationId = metadata.conversationId === null ? null : String(metadata.conversationId);
    if (metadata.turnId) event.turnId = String(metadata.turnId);
    if (metadata.candidateId) event.candidateId = String(metadata.candidateId);
    if (metadata.captureId) event.captureId = String(metadata.captureId);
    if (metadata.causationId) event.causationId = String(metadata.causationId);
    if (metadata.correlationId) event.correlationId = String(metadata.correlationId);
    if (Array.isArray(entry?.evidenceRefs || entry?.meta?.evidenceRefs)) {
      event.evidenceRefs = (entry.evidenceRefs || entry.meta.evidenceRefs).map(String).slice(0, 50);
    }
    return event;
  }

  function record(entry = {}, llmName, options = {}) {
    return enqueue((state) => {
      const requestedRunId = resolveRunSessionId(entry, options.runSessionId || state.runSessionId);
      const runChanged = state.runSessionId !== null && requestedRunId !== null
        && String(state.runSessionId) !== String(requestedRunId);
      const base = runChanged
        ? { runSessionId: requestedRunId, firstWallTs: Number(entry?.ts || Date.now()), events: [] }
        : state;
      if (base.events.length >= MAX_EVENTS) return base;
      const event = createEvent(entry, llmName, base, options);
      if (!event) return base;
      const previous = base.events[base.events.length - 1];
      const previousComparable = previous ? {
        eventType: previous.eventType,
        modelId: previous.modelId,
        dispatchId: previous.dispatchId || null,
        payload: previous.payload
      } : null;
      const nextComparable = {
        eventType: event.eventType,
        modelId: event.modelId,
        dispatchId: event.dispatchId || null,
        payload: event.payload
      };
      if (previousComparable && proof().stableStringify(previousComparable) === proof().stableStringify(nextComparable)) {
        return base;
      }
      return {
        runSessionId: event.runSessionId,
        firstWallTs: base.firstWallTs || event.wallTs,
        events: [...base.events, event]
      };
    });
  }

  function appendCanonical(event = {}) {
    return enqueue((state) => {
      if (!event || Number(event.schemaVersion) !== 5) throw new Error('invalid canonical telemetry event');
      const next = { ...event, seq: state.events.length + 1 };
      if (!next.eventId) next.eventId = `ev-${next.seq}-${proof().eventFingerprint(JSON.stringify(next))}`;
      return {
        runSessionId: next.runSessionId || state.runSessionId,
        firstWallTs: state.firstWallTs || next.wallTs || Date.now(),
        events: [...state.events, next]
      };
    });
  }

  function snapshot({ runSessionId = null } = {}) {
    return mutationChain.catch(() => {}).then(readStored).then((state) => {
      const events = runSessionId === null
        ? state.events
        : state.events.filter((event) => String(event.runSessionId) === String(runSessionId));
      return {
        schemaVersion: 5,
        runSessionId: runSessionId ?? state.runSessionId,
        firstSeq: events[0]?.seq || 0,
        lastSeq: events[events.length - 1]?.seq || 0,
        eventCount: events.length,
        events: events.slice()
      };
    });
  }

  function clear(runSessionId = null) {
    return enqueue(() => ({ runSessionId, firstWallTs: null, events: [] }));
  }

  root.ProofTelemetryLedger = Object.freeze({
    STORAGE_KEY,
    MAX_EVENTS,
    record,
    appendCanonical,
    snapshot,
    clear
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

// background/proof-telemetry-ledger.js
// Persistent append-only schema 5 ledger for the active runtime run.

'use strict';

(function initProofTelemetryLedger(root) {
  const STORAGE_KEY = '__proof_telemetry_ledger_v5__';
  const MAX_EVENTS = 10000;
  const MAX_QUARANTINE_EVENTS = 200;
  const MAX_PENDING_EVENTS = 200;
  const PRODUCER_VERSION = 'proof-runtime-ledger@1.0.0';
  let mutationChain = Promise.resolve();

  const proof = () => root.ProofOrientedTelemetry;

  async function readStored() {
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    const value = stored?.[STORAGE_KEY];
    if (!value || typeof value !== 'object') return { runSessionId: null, firstWallTs: null, events: [], pending: {}, quarantine: [], stagingLosses: [] };
    return {
      runSessionId: value.runSessionId ?? null,
      firstWallTs: Number(value.firstWallTs || 0) || null,
      events: Array.isArray(value.events) ? value.events : [],
      pending: value.pending && typeof value.pending === 'object' ? value.pending : {},
      quarantine: Array.isArray(value.quarantine) ? value.quarantine : [],
      stagingLosses: Array.isArray(value.stagingLosses) ? value.stagingLosses : []
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

  function boundedPush(items, value, limit, lossDescriptor) {
    const next = [...(Array.isArray(items) ? items : []), value];
    if (next.length <= limit) return { items: next, loss: null };
    const dropped = next.length - limit;
    return {
      items: next.slice(-limit),
      loss: { ...lossDescriptor, droppedCount: dropped, detectedAtIngest: true }
    };
  }

  function safeStagingRecord(entry, llmName, requestedRunId, activeRunId, reason) {
    return {
      stagingId: `stg-${proof().eventFingerprint(`${requestedRunId}|${llmName}|${entry?.label || entry?.event || ''}|${entry?.ts || ''}|${reason}`)}`,
      requestedRunSessionId: requestedRunId === null ? null : String(requestedRunId),
      activeRunSessionId: activeRunId === null ? null : String(activeRunId),
      modelId: String(llmName || entry?.platform || entry?.llmName || 'SYSTEM'),
      sourceEventType: String(entry?.label || entry?.event || entry?.meta?.event || 'UNKNOWN'),
      metadata: proof().sanitizeValue(entry?.meta || {}, 'meta') || {},
      reason
    };
  }

  function beginRun(runSessionId, options = {}) {
    const requested = runSessionId === null || runSessionId === undefined ? null : String(runSessionId);
    if (!requested) return Promise.reject(new Error('proof telemetry beginRun requires runSessionId'));
    return enqueue((state) => {
      if (String(state.runSessionId || '') === requested) return state;
      const promoted = Array.isArray(state.pending?.[requested]) ? state.pending[requested] : [];
      const pending = { ...(state.pending || {}) };
      delete pending[requested];
      const opened = {
        runSessionId: requested,
        firstWallTs: Number(options.wallTs || Date.now()),
        events: [],
        pending,
        quarantine: state.quarantine || [],
        stagingLosses: state.stagingLosses || []
      };
      if (promoted.length) {
        const seed = { ts: opened.firstWallTs, meta: { runSessionId: requested } };
        opened.events.push(createRunConfig(seed, 'SYSTEM', opened, { runSessionId: requested }));
        promoted.forEach((record) => {
          const event = createEvent({
            ts: opened.firstWallTs,
            label: record.sourceEventType,
            level: 'info',
            meta: { ...(record.metadata || {}), runSessionId: requested, promotedFromPending: true }
          }, record.modelId, opened, { runSessionId: requested, producerComponent: 'pending-promotion' });
          if (event) opened.events.push(event);
        });
      }
      return opened;
    });
  }

  function stagePending(entry = {}, llmName, runSessionId) {
    const requested = runSessionId === null || runSessionId === undefined ? null : String(runSessionId);
    if (!requested) return Promise.reject(new Error('proof telemetry pending evidence requires runSessionId'));
    return enqueue((state) => {
      const pending = { ...(state.pending || {}) };
      const staged = safeStagingRecord(entry, llmName, requested, state.runSessionId, 'run_not_open');
      const result = boundedPush(pending[requested], staged, MAX_PENDING_EVENTS, {
        eventType: 'PENDING_EVIDENCE_DROPPED',
        buffer: 'pending',
        runSessionId: requested
      });
      pending[requested] = result.items;
      return {
        ...state,
        pending,
        stagingLosses: result.loss ? [...(state.stagingLosses || []), result.loss].slice(-MAX_PENDING_EVENTS) : (state.stagingLosses || [])
      };
    });
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
    const safeDetails = String(entry?.details || '');
    if (eventType === 'FINALIZATION_POLICY_EVALUATED') {
      if (/accepted/i.test(safeDetails)) metadata.decisionAccepted = true;
      if (/rejected|blocked/i.test(safeDetails)) metadata.decisionAccepted = false;
    }
    if (eventType === 'MODEL_TERMINAL_RECORDED') {
      const status = safeDetails.trim().split(/[\s|:]+/)[0].toUpperCase();
      if (/^[A-Z][A-Z0-9_]{1,40}$/.test(status)) metadata.terminalStatus = status;
    }
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
    if (eventType === 'OBSERVATION_FRAME_CAPTURED') {
      event.payload.metadata.captureStartedMonoMs = Number.isFinite(Number(metadata.captureStartedMonoMs)) ? Number(metadata.captureStartedMonoMs) : null;
      event.payload.metadata.captureCompletedMonoMs = Number.isFinite(Number(metadata.captureCompletedMonoMs)) ? Number(metadata.captureCompletedMonoMs) : null;
      event.payload.metadata.maximumSignalSkewMs = Number.isFinite(Number(metadata.maximumSignalSkewMs)) ? Number(metadata.maximumSignalSkewMs) : null;
      event.payload.metadata.tabActive = metadata.tabActive ?? 'unknown';
      event.payload.metadata.tabVisible = metadata.tabVisible ?? 'unknown';
      event.payload.metadata.tabDiscarded = metadata.tabDiscarded ?? 'unknown';
      event.payload.metadata.documentVisibility = metadata.documentVisibility ?? 'unknown';
      event.payload.metadata.contentScriptAvailable = metadata.contentScriptAvailable ?? 'unknown';
      event.payload.metadata.snapshotAgeMs = Number.isFinite(Number(metadata.snapshotAgeMs)) ? Number(metadata.snapshotAgeMs) : null;
      event.payload.metadata.timerThrottlingSuspected = metadata.timerThrottlingSuspected ?? 'unknown';
      event.payload.metadata.focusLeaseOwner = metadata.focusLeaseOwner ?? null;
      event.payload.metadata.pageHealth = metadata.pageHealth ?? 'unknown';
      event.payload.metadata.candidateSetRef = metadata.candidateSetRef ?? null;
      event.payload.metadata.mutationCount = Number.isFinite(Number(metadata.mutationCount)) ? Number(metadata.mutationCount) : null;
      event.payload.metadata.lastRelevantMutationMonoMs = Number.isFinite(Number(metadata.lastRelevantMutationMonoMs)) ? Number(metadata.lastRelevantMutationMonoMs) : null;
    }
    return event;
  }

  function createRunConfig(entry, llmName, state, options = {}) {
    const wallTs = Number(entry?.ts || Date.now());
    const runSessionId = resolveRunSessionId(entry, options.runSessionId || state.runSessionId || `runtime-${wallTs}`);
    return {
      schemaVersion: 5,
      eventId: `ev-1-${proof().eventFingerprint(`${runSessionId}|RUN_CONFIG_RECORDED|${wallTs}`)}`,
      eventType: 'RUN_CONFIG_RECORDED',
      layer: 'system',
      seq: 1,
      wallTs,
      monoMs: 0,
      runSessionId: String(runSessionId),
      modelId: 'SYSTEM',
      producer: { component: 'proof-runtime-ledger', version: PRODUCER_VERSION },
      payload: {
        schemaVersion: '5.0',
        policyId: 'proof-default-v1',
        automaticMinimumEvidenceTier: 3,
        privacyMode: 'metadata-only',
        initialProducer: options.producerComponent || String(llmName || 'runtime-telemetry')
      }
    };
  }

  function createCompanion(descriptor, sourceEvent, events) {
    const seq = events.length + 1;
    const eventType = String(descriptor.eventType);
    return {
      schemaVersion: 5,
      eventId: `ev-${seq}-${proof().eventFingerprint(`${sourceEvent.runSessionId}|${sourceEvent.modelId}|${eventType}|${sourceEvent.eventId}|${seq}`)}`,
      eventType,
      layer: descriptor.layer || proof().layerFor(eventType),
      seq,
      wallTs: sourceEvent.wallTs,
      monoMs: sourceEvent.monoMs,
      runSessionId: sourceEvent.runSessionId,
      modelId: sourceEvent.modelId,
      ...(sourceEvent.dispatchId ? { dispatchId: sourceEvent.dispatchId } : {}),
      ...(sourceEvent.generationEpoch !== undefined ? { generationEpoch: sourceEvent.generationEpoch } : {}),
      ...(sourceEvent.tabId !== undefined ? { tabId: sourceEvent.tabId } : {}),
      producer: { component: 'proof-inference-policy', version: 'proof-policy@1.0.0' },
      payload: descriptor.payload || {},
      evidenceRefs: Array.isArray(descriptor.evidenceRefs) ? descriptor.evidenceRefs.slice() : [sourceEvent.eventId]
    };
  }

  function record(entry = {}, llmName, options = {}) {
    return enqueue((state) => {
      const requestedRunId = resolveRunSessionId(entry, options.runSessionId || state.runSessionId);
      const runChanged = state.runSessionId !== null && requestedRunId !== null
        && String(state.runSessionId) !== String(requestedRunId);
      if (runChanged) {
        const staged = safeStagingRecord(entry, llmName, requestedRunId, state.runSessionId, 'run_identity_mismatch');
        const result = boundedPush(state.quarantine, staged, MAX_QUARANTINE_EVENTS, {
          eventType: 'PENDING_EVIDENCE_DROPPED',
          buffer: 'quarantine',
          runSessionId: String(requestedRunId)
        });
        return {
          ...state,
          quarantine: result.items,
          stagingLosses: result.loss ? [...(state.stagingLosses || []), result.loss].slice(-MAX_PENDING_EVENTS) : (state.stagingLosses || [])
        };
      }
      const base = state;
      // MAX_EVENTS is an operational warning threshold, not a deletion cap.
      // Canonical proof events are never discarded merely to satisfy a size
      // budget; exportAudit reports overflow and downstream retention may move
      // the completed run as a whole.
      const workingBase = base.events.length
        ? base
        : {
          runSessionId: requestedRunId,
          firstWallTs: Number(entry?.ts || Date.now()),
          events: [createRunConfig(entry, llmName, base, options)]
        };
      const event = createEvent(entry, llmName, workingBase, options);
      if (!event) return base;
      const previous = [...workingBase.events].reverse().find((candidate) => (
        candidate?.producer?.component !== 'proof-inference-policy'
        && candidate.eventType !== 'RUN_CONFIG_RECORDED'
      ));
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
      if (event.eventType === 'MODEL_TERMINAL_RECORDED') {
        const decision = [...base.events].reverse().find((candidate) => (
          candidate.eventType === 'DECISION_RECORDED'
          && String(candidate.modelId) === String(event.modelId)
          && (!candidate.dispatchId || !event.dispatchId || String(candidate.dispatchId) === String(event.dispatchId))
        ));
        if (decision) {
          event.evidenceRefs = Array.from(new Set([...(event.evidenceRefs || []), decision.eventId]));
          event.payload.metadata.decisionId = decision.eventId;
        }
      }
      const events = [...workingBase.events, event];
      const companions = [
        ...(root.ProofTelemetryPolicy?.planCompanions?.(event, events) || []),
        ...(root.ProofTelemetryAudit?.planAfterEvent?.(event, events) || [])
      ];
      companions.forEach((descriptor) => events.push(createCompanion(descriptor, event, events)));
      return {
        runSessionId: event.runSessionId,
        firstWallTs: workingBase.firstWallTs || event.wallTs,
        events
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
        events: events.slice(),
        pendingEventCount: Object.values(state.pending || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
        quarantineEventCount: (state.quarantine || []).length,
        stagingLosses: (state.stagingLosses || []).slice()
      };
    });
  }

  function clear(runSessionId = null) {
    return enqueue(() => ({ runSessionId, firstWallTs: null, events: [] }));
  }

  root.ProofTelemetryLedger = Object.freeze({
    STORAGE_KEY,
    MAX_EVENTS,
    MAX_QUARANTINE_EVENTS,
    MAX_PENDING_EVENTS,
    beginRun,
    stagePending,
    record,
    appendCanonical,
    snapshot,
    clear
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

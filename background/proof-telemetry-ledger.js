// background/proof-telemetry-ledger.js
// Sole-writer, append-only schema 6 proof telemetry runtime.

'use strict';

(function initProofTelemetryLedger(root) {
  const STORAGE_KEY = '__proof_telemetry_ledger_v6__';
  const MAX_EVENTS = 10000;
  const MAX_QUARANTINE_EVENTS = 200;
  const MAX_PENDING_EVENTS = 200;
  const MAX_LEGACY_DEBUG_RECORDS = 200;
  const OPERATIONAL_CHECKPOINT_COUNT = 50;
  let idCounter = 0;
  const HEARTBEAT_EVERY_NOOPS = 120;
  const PRODUCER_VERSION = 'proof-runtime-ledger@2.2.0';
  const WORKER_EPOCH_ID = makeId('sw');
  const WORKER_STARTED_MONO_MS = monotonicNow();
  let mutationChain = Promise.resolve();
  let mutationQueue = [];
  let mutationDrainScheduled = false;
  let mutationDrainActive = false;
  let stateCache = null;
  let stateLoadPromise = null;
  let pendingRecordBatch = [];
  let recordBatchScheduled = false;
  let queuedMutationCount = 0;

  const proof = () => root.ProofOrientedTelemetry;
  const contracts = () => root.ProofTelemetryContracts;

  function monotonicNow() {
    return typeof performance !== 'undefined' && Number.isFinite(performance.now()) ? performance.now() : 0;
  }

  function makeId(prefix) {
    const uuid = root.crypto?.randomUUID?.();
    if (uuid) return `${prefix}-${uuid}`;
    idCounter += 1;
    const random = root.crypto?.getRandomValues ? Array.from(root.crypto.getRandomValues(new Uint32Array(2))).join('-') : `${Math.random()}-${idCounter}`;
    return `${prefix}-${String(random).replace(/[^a-zA-Z0-9-]/g, '').padEnd(16, '0')}`;
  }

  function emptyState() {
    return {
      runSessionId: null,
      runGeneration: null,
      status: 'closed',
      firstWallTs: null,
      nextRunGeneration: 1,
      nextIngestSeq: 1,
      events: [],
      lifecycle: [],
      pending: {},
      quarantine: [],
      unattributed: [],
      stagingLosses: [],
      signalStates: {},
      noopCounts: {},
      openObservationIntervals: {},
      producerEpochs: {},
      producerSequences: {},
      operationalIntervals: {},
      legacyDebugRing: []
    };
  }

  function normalizeState(value) {
    const base = emptyState();
    if (!value || typeof value !== 'object') return base;
    const lifecycle = Array.isArray(value.lifecycle) ? value.lifecycle.slice() : [];
    const events = Array.isArray(value.events) ? value.events.slice() : [];
    const maxGeneration = [...lifecycle, ...events].reduce((max, event) => Math.max(max, Number(event.runGeneration || 0)), 0);
    const maxIngest = [...lifecycle, ...events].reduce((max, event) => Math.max(max, Number(event.ingestSeq || 0)), 0);
    return {
      ...base,
      ...value,
      events,
      lifecycle,
      pending: value.pending && typeof value.pending === 'object'
        ? Object.fromEntries(Object.entries(value.pending).map(([key, records]) => [key, Array.isArray(records) ? records.slice() : []]))
        : {},
      quarantine: Array.isArray(value.quarantine) ? value.quarantine.slice() : [],
      unattributed: Array.isArray(value.unattributed) ? value.unattributed.slice() : [],
      stagingLosses: Array.isArray(value.stagingLosses) ? value.stagingLosses.slice() : [],
      signalStates: value.signalStates && typeof value.signalStates === 'object' ? { ...value.signalStates } : {},
      noopCounts: value.noopCounts && typeof value.noopCounts === 'object' ? { ...value.noopCounts } : {},
      openObservationIntervals: value.openObservationIntervals && typeof value.openObservationIntervals === 'object'
        ? Object.fromEntries(Object.entries(value.openObservationIntervals).map(([key, interval]) => [key, { ...interval }]))
        : {},
      producerEpochs: value.producerEpochs && typeof value.producerEpochs === 'object' ? { ...value.producerEpochs } : {},
      producerSequences: value.producerSequences && typeof value.producerSequences === 'object' ? { ...value.producerSequences } : {},
      operationalIntervals: value.operationalIntervals && typeof value.operationalIntervals === 'object'
        ? Object.fromEntries(Object.entries(value.operationalIntervals).map(([key, interval]) => [key, {
          ...interval,
          reasons: Array.isArray(interval?.reasons) ? interval.reasons.slice() : []
        }]))
        : {},
      legacyDebugRing: Array.isArray(value.legacyDebugRing)
        ? value.legacyDebugRing.slice(-MAX_LEGACY_DEBUG_RECORDS).map((record) => ({ ...record }))
        : [],
      nextRunGeneration: Math.max(Number(value.nextRunGeneration || 1), maxGeneration + 1),
      nextIngestSeq: Math.max(Number(value.nextIngestSeq || 1), maxIngest + 1)
    };
  }

  async function readStored() {
    if (root.ProofTelemetryStore?.loadState) {
      const segmented = await root.ProofTelemetryStore.loadState();
      if (segmented) return normalizeState(segmented);
    }
    const stored = await chrome.storage.local.get([STORAGE_KEY]);
    return normalizeState(stored?.[STORAGE_KEY]);
  }

  async function writeStored(value) {
    if (root.ProofTelemetryStore?.saveState) return root.ProofTelemetryStore.saveState(value);
    await chrome.storage.local.set({ [STORAGE_KEY]: value });
    return value;
  }

  async function readCurrentState() {
    if (stateCache) return stateCache;
    if (!stateLoadPromise) {
      stateLoadPromise = readStored()
        .then((stored) => {
          stateCache = normalizeState(stored);
          return stateCache;
        })
        .finally(() => {
          stateLoadPromise = null;
        });
    }
    return stateLoadPromise;
  }

  async function drainMutationQueue() {
    if (mutationDrainActive) return;
    mutationDrainActive = true;
    try {
      while (mutationQueue.length) {
        const batch = mutationQueue;
        mutationQueue = [];
        const committed = await readCurrentState();
        let working = normalizeState(committed);
        let changed = false;
        const applied = [];

        for (const item of batch) {
          try {
            const input = normalizeState(working);
            const next = await item.mutator(input);
            if (next !== input) changed = true;
            working = normalizeState(next || input);
            applied.push(item);
          } catch (error) {
            queuedMutationCount = Math.max(0, queuedMutationCount - 1);
            item.reject(error);
          }
        }

        if (!applied.length) continue;
        try {
          if (changed) {
            const persisted = await writeStored(working);
            stateCache = normalizeState(persisted || working);
          } else {
            stateCache = normalizeState(committed);
          }
          applied.forEach((item) => {
            queuedMutationCount = Math.max(0, queuedMutationCount - 1);
            item.resolve(stateCache);
          });
        } catch (error) {
          stateCache = normalizeState(committed);
          applied.forEach((item) => {
            queuedMutationCount = Math.max(0, queuedMutationCount - 1);
            item.reject(error);
          });
        }
      }
    } finally {
      mutationDrainActive = false;
      if (mutationQueue.length) scheduleMutationDrain();
    }
  }

  function scheduleMutationDrain() {
    if (mutationDrainScheduled || mutationDrainActive) return;
    mutationDrainScheduled = true;
    const schedule = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);
    schedule(() => {
      mutationDrainScheduled = false;
      const prior = mutationChain;
      const operation = prior.catch(() => {}).then(() => drainMutationQueue());
      mutationChain = operation.then(() => undefined, () => undefined);
    });
  }

  function enqueue(mutator) {
    queuedMutationCount += 1;
    const operation = new Promise((resolve, reject) => {
      mutationQueue.push({ mutator, resolve, reject });
    });
    scheduleMutationDrain();
    return operation;
  }

  function resolveRunSessionId(entry = {}, fallback = null) {
    return entry?.meta?.runSessionId || entry?.runSessionId || entry?.sessionId || fallback || null;
  }

  function boundedPush(items, value, limit, lossDescriptor) {
    const next = [...(Array.isArray(items) ? items : []), value];
    if (next.length <= limit) return { items: next, loss: null };
    return { items: next.slice(-limit), loss: { ...lossDescriptor, droppedCount: next.length - limit, detectedAtIngest: true } };
  }

  function stripEnvelopeMetadata(metadata) {
    const duplicateKeys = new Set([
      'runSessionId', 'llmName', 'platform', 'dispatchId', 'requestId', 'generationEpoch',
      'tabId', 'documentInstanceId', 'navigationEpoch', 'conversationId', 'turnId',
      'candidateId', 'captureId', 'causationId', 'correlationId', 'producerComponent',
      'producerVersion', 'proofEventType', 'proofLayer', 'clock'
    ]);
    return Object.fromEntries(Object.entries(metadata || {}).filter(([key]) => !duplicateKeys.has(key)));
  }

  function compactProofMetadata(metadata) {
    const staticKeys = new Set(['telemetryTaxonomy', 'extVersion', 'schemaVersion', 'event', 'legacyBefore', 'legacyAfter', 'previousState', 'nextState', 'projection', 'modelState']);
    const structuredKeys = new Set(['checkedAtLocalMonoMs']);
    const proofIdentityKeys = new Set([
      'attemptId', 'payloadEvidenceId', 'expectedCardId', 'observedCardId',
      'evaluationBoundaryId', 'sourceRevisionId', 'decisionId'
    ]);
    const proofKey = /(?:hash|length|len|count|status|state|outcome|step|phase|reasons?|mode|tier|coverage|verified|visible|active|discarded|health|mutation|attempt|deadline|timeout|duration|delay|skew|growth|candidate|answerIdentity|finalStatus|terminalStatus|finishReason|decisionAccepted|promotedFromPending|promotedStagingIngestSeq|dispatchId|answerEvidenceDispatchId|priorIncidentRef|evidence|source|signal|version|ms)$/i;
    const compact = {};
    Object.entries(metadata || {}).forEach(([key, value]) => {
      if (staticKeys.has(key) || value === undefined || value === null) return;
      if (structuredKeys.has(key) && value && typeof value === 'object') {
        compact[key] = Object.fromEntries(Object.entries(value).filter(([, item]) => Number.isFinite(Number(item))).slice(0, 20));
        return;
      }
      if (!proofKey.test(key) && !proofIdentityKeys.has(key)) return;
      if (['string', 'number', 'boolean'].includes(typeof value)) {
        compact[key] = typeof value === 'string' ? value.slice(0, 200) : value;
      } else if (Array.isArray(value)) {
        compact[key] = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 20);
      }
    });
    return compact;
  }

  function safeStagingRecord(entry, llmName, requestedRunId, activeRunId, reason, ingestSeq) {
    return {
      stagingId: makeId('stg'),
      ingestSeq,
      requestedRunSessionId: requestedRunId === null ? null : String(requestedRunId),
      activeRunSessionId: activeRunId === null ? null : String(activeRunId),
      modelId: String(llmName || entry?.platform || entry?.llmName || 'SYSTEM'),
      sourceEventType: String(entry?.label || entry?.event || entry?.meta?.event || 'UNKNOWN'),
      metadata: proof().sanitizeValue(entry?.meta || {}, 'meta') || {},
      reason
    };
  }

  function clockFor(entry, state, producerComponent) {
    const supplied = entry?.clock || entry?.meta?.clock || {};
    const ingestMonoMs = Math.max(0, monotonicNow() - WORKER_STARTED_MONO_MS);
    const producerEpochId = supplied.producerEpochId || entry?.meta?.producerEpochId || `${producerComponent}:clockless`;
    const clock = {
      contractVersion: contracts()?.CLOCK_CONTRACT_VERSION || '1.0',
      producerEpochId: String(producerEpochId),
      originKind: ['document', 'worker', 'system'].includes(supplied.originKind) ? supplied.originKind : 'unknown',
      ingestEpochId: WORKER_EPOCH_ID,
      ingestMonoMs
    };
    if (supplied.producerSequence !== null && supplied.producerSequence !== undefined && Number.isInteger(Number(supplied.producerSequence))) clock.producerSequence = Number(supplied.producerSequence);
    if (supplied.observedAtLocalMonoMs !== null && supplied.observedAtLocalMonoMs !== undefined && Number.isFinite(Number(supplied.observedAtLocalMonoMs))) clock.observedAtLocalMonoMs = Number(supplied.observedAtLocalMonoMs);
    if (supplied.sentAtLocalMonoMs !== null && supplied.sentAtLocalMonoMs !== undefined && Number.isFinite(Number(supplied.sentAtLocalMonoMs))) clock.sentAtLocalMonoMs = Number(supplied.sentAtLocalMonoMs);
    return clock;
  }

  function nextEnvelope(state, fields) {
    const ingestSeq = state.nextIngestSeq;
    state.nextIngestSeq += 1;
    return {
      schemaVersion: contracts()?.EVENT_SCHEMA_VERSION || 6,
      eventId: makeId('event'),
      seq: state.events.length + 1,
      ingestSeq,
      runGeneration: Number(fields.runGeneration || state.runGeneration || 1),
      wallTs: Number(fields.wallTs || Date.now()),
      runSessionId: String(fields.runSessionId || state.runSessionId),
      ...fields
    };
  }

  function appendLifecycle(state, eventType, payload, identity = {}) {
    const event = nextEnvelope(state, {
      eventType,
      layer: 'system',
      wallTs: Number(identity.wallTs || Date.now()),
      runSessionId: String(identity.runSessionId || state.runSessionId || 'unattributed'),
      runGeneration: Number(identity.runGeneration || state.runGeneration || state.nextRunGeneration),
      modelId: 'SYSTEM',
      producer: { component: 'proof-run-lifecycle', version: PRODUCER_VERSION },
      clock: clockFor({ clock: { producerEpochId: WORKER_EPOCH_ID, originKind: 'worker', observedAtLocalMonoMs: monotonicNow() } }, state, 'proof-run-lifecycle'),
      payload: { typed: { kind: 'run_lifecycle', state: eventType }, ...payload }
    });
    event.seq = state.lifecycle.length + 1;
    state.lifecycle.push(event);
    return event;
  }

  function createRunConfig(state, options = {}) {
    return nextEnvelope(state, {
      eventType: 'RUN_CONFIG_RECORDED',
      layer: 'system',
      wallTs: Number(options.wallTs || Date.now()),
      modelId: 'SYSTEM',
      producer: { component: 'proof-runtime-ledger', version: PRODUCER_VERSION },
      clock: clockFor({ clock: { producerEpochId: WORKER_EPOCH_ID, originKind: 'worker', observedAtLocalMonoMs: monotonicNow() } }, state, 'proof-runtime-ledger'),
      payload: {
        typed: { kind: 'run_configuration', state: 'recorded' },
        schemaVersion: '6.0',
        policyId: 'proof-default-v2',
        automaticMinimumEvidenceTier: 3,
        privacyMode: 'metadata-only',
        initialProducer: options.producerComponent || 'runtime-telemetry'
      }
    });
  }

  function closeIntervalsInState(state, reason) {
    Object.entries(state.openObservationIntervals || {}).forEach(([key, interval]) => {
      const event = nextEnvelope(state, {
        eventType: 'OBSERVATION_INTERVAL_CLOSED',
        layer: 'fact',
        wallTs: Date.now(),
        modelId: interval.modelId,
        ...(interval.dispatchId ? { dispatchId: interval.dispatchId } : {}),
        ...(interval.generationEpoch !== undefined ? { generationEpoch: interval.generationEpoch } : {}),
        producer: { component: 'proof-observation-runtime', version: PRODUCER_VERSION },
        clock: clockFor({ clock: { producerEpochId: WORKER_EPOCH_ID, originKind: 'worker', observedAtLocalMonoMs: monotonicNow() } }, state, 'proof-observation-runtime'),
        payload: {
          typed: { kind: 'observation_interval', state: 'closed' },
          reason,
          coverage: 'degraded',
          sampleCount: interval.sampleCount || 1,
          firstEventId: interval.firstEventId,
          lastEventId: interval.lastEventId
        },
        evidenceRefs: Array.from(new Set([interval.firstEventId, interval.lastEventId].filter(Boolean)))
      });
      state.events.push(event);
      delete state.openObservationIntervals[key];
    });
  }

  function beginRun(runSessionId, options = {}) {
    const requested = runSessionId === null || runSessionId === undefined ? null : String(runSessionId);
    if (!requested) return Promise.reject(new Error('proof telemetry beginRun requires runSessionId'));
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      if (state.runSessionId === requested && state.status === 'active') return state;
      if (state.status === 'active') {
        flushOperationalIntervals(state, 'run_superseded');
        closeIntervalsInState(state, 'run_superseded');
        appendLifecycle(state, 'RUN_SUPERSESSION_REQUESTED', { successorRunSessionId: requested }, { wallTs: options.wallTs });
        appendLifecycle(state, 'RUN_CLOSE_INTENT', { reason: 'superseded' }, { wallTs: options.wallTs });
        appendLifecycle(state, 'RUN_CLOSED', { reason: 'superseded', completenessKnown: false }, { wallTs: options.wallTs });
      }
      const generation = state.nextRunGeneration;
      state.nextRunGeneration += 1;
      const intentId = makeId('run-intent');
      appendLifecycle(state, 'RUN_OPEN_INTENT', { intentId, predecessorRunId: state.runSessionId }, {
        runSessionId: requested, runGeneration: generation, wallTs: options.wallTs
      });
      state.runSessionId = requested;
      state.runGeneration = generation;
      state.status = 'opening';
      state.firstWallTs = Number(options.wallTs || Date.now());
      state.events = [];
      state.signalStates = {};
      state.noopCounts = {};
      state.openObservationIntervals = {};
      state.producerEpochs = {};
      state.producerSequences = {};
      state.operationalIntervals = {};
      state.legacyDebugRing = [];
      appendLifecycle(state, 'RUN_OPENED', { intentId }, { runSessionId: requested, runGeneration: generation, wallTs: options.wallTs });
      state.status = 'active';
      const config = createRunConfig(state, options);
      state.events.push(config);
      const epochStarted = nextEnvelope(state, {
        eventType: 'CLOCK_EPOCH_STARTED',
        layer: 'system',
        wallTs: Number(options.wallTs || Date.now()),
        modelId: 'SYSTEM',
        producer: { component: 'proof-clock-runtime', version: PRODUCER_VERSION },
        clock: clockFor({ clock: { producerEpochId: WORKER_EPOCH_ID, originKind: 'worker', observedAtLocalMonoMs: monotonicNow() } }, state, 'proof-clock-runtime'),
        payload: { typed: { kind: 'clock_epoch', state: 'started' }, epochId: WORKER_EPOCH_ID, originKind: 'worker' }
      });
      state.events.push(epochStarted);
      state.producerEpochs[WORKER_EPOCH_ID] = epochStarted.eventId;
      const promoted = [...(state.pending?.[requested] || [])].sort((a, b) => a.ingestSeq - b.ingestSeq);
      delete state.pending[requested];
      promoted.forEach((record) => appendRecordToState(state, {
        ts: state.firstWallTs,
        label: record.sourceEventType,
            meta: { ...(record.metadata || {}), runSessionId: requested, promotedFromPending: true, promotedStagingIngestSeq: record.ingestSeq }
      }, record.modelId, { producerComponent: 'pending-promotion' }));
      return state;
    });
  }

  function closeRun(reason = 'normal', options = {}) {
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      if (state.status !== 'active') return state;
      flushOperationalIntervals(state, reason);
      closeIntervalsInState(state, options.observationReason || 'run_closed');
      appendLifecycle(state, 'RUN_CLOSE_INTENT', { reason }, { wallTs: options.wallTs });
      state.status = 'closing';
      appendLifecycle(state, 'RUN_CLOSED', { reason, completenessKnown: options.completenessKnown === true }, { wallTs: options.wallTs });
      state.status = 'closed';
      return state;
    });
  }

  function stagePending(entry = {}, llmName, runSessionId) {
    const requested = runSessionId === null || runSessionId === undefined ? null : String(runSessionId);
    if (!requested) return Promise.reject(new Error('proof telemetry pending evidence requires runSessionId'));
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      const ingestSeq = state.nextIngestSeq++;
      const staged = safeStagingRecord(entry, llmName, requested, state.runSessionId, 'run_not_open', ingestSeq);
      const result = boundedPush(state.pending[requested], staged, MAX_PENDING_EVENTS, { eventType: 'PENDING_EVIDENCE_DROPPED', buffer: 'pending', runSessionId: requested });
      state.pending[requested] = result.items;
      if (result.loss) state.stagingLosses = [...state.stagingLosses, result.loss].slice(-MAX_PENDING_EVENTS);
      return state;
    });
  }

  function createEvent(entry, llmName, state, options = {}) {
    const api = proof();
    const rawMetadata = api.sanitizeValue(entry?.meta || {}, 'meta') || {};
    const modelId = String(llmName || entry?.platform || entry?.llmName || rawMetadata.llmName || 'SYSTEM');
    const eventType = String(entry?.proofEventType || rawMetadata.proofEventType || api.canonicalType(entry));
    const sourceEventType = String(entry?.label || entry?.event || rawMetadata.event || 'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'UNKNOWN';
    const metadata = compactProofMetadata(stripEnvelopeMetadata(rawMetadata));
    const details = String(entry?.details || '');
    if (eventType === 'FINALIZATION_POLICY_EVALUATED') {
      if (/accepted/i.test(details)) metadata.decisionAccepted = true;
      if (/rejected|blocked/i.test(details)) metadata.decisionAccepted = false;
    }
    if (eventType === 'MODEL_TERMINAL_RECORDED') {
      const status = details.trim().split(/[\s|:]+/)[0].toUpperCase();
      if (/^[A-Z][A-Z0-9_]{1,40}$/.test(status)) metadata.terminalStatus = status;
    }
    const canonicalTyped = contracts()?.canonicalFactOf?.({ eventType, payload: { metadata } });
    const canonicalKnown = canonicalTyped
      && canonicalTyped.kind !== 'unknown'
      && canonicalTyped.state !== 'unknown';
    const typed = canonicalKnown
      ? canonicalTyped
      : (entry?.typed || rawMetadata.typed || contracts()?.adaptLegacyEvent?.({ payload: { sourceEventType, metadata: rawMetadata } }) || { kind: 'unknown', state: 'unknown' });
    const dispatchId = rawMetadata.dispatchId || rawMetadata.requestId || undefined;
    const event = nextEnvelope(state, {
      eventType,
      layer: String(entry?.proofLayer || rawMetadata.proofLayer || api.layerFor(eventType)),
      wallTs: Number(entry?.ts || Date.now()),
      modelId,
      producer: {
        component: String(rawMetadata.producerComponent || options.producerComponent || 'runtime-telemetry'),
        version: String(rawMetadata.producerVersion || options.producerVersion || PRODUCER_VERSION)
      },
      clock: clockFor(entry, state, String(rawMetadata.producerComponent || options.producerComponent || 'runtime-telemetry')),
      payload: { typed, sourceEventType, sourceLevel: String(entry?.level || 'info'), detailsLength: details.length, metadata }
    });
    if (dispatchId) event.dispatchId = String(dispatchId);
    if (Number.isFinite(Number(rawMetadata.generationEpoch))) event.generationEpoch = Number(rawMetadata.generationEpoch);
    ['documentInstanceId', 'turnId', 'candidateId', 'captureId', 'causationId', 'correlationId'].forEach((key) => {
      if (rawMetadata[key]) event[key] = String(rawMetadata[key]);
    });
    if (!event.candidateId && (rawMetadata.answerCandidateId || rawMetadata.selectedCandidateId)) {
      event.candidateId = String(rawMetadata.answerCandidateId || rawMetadata.selectedCandidateId);
    }
    ['tabId', 'navigationEpoch'].forEach((key) => {
      if (Number.isFinite(Number(rawMetadata[key]))) event[key] = Number(rawMetadata[key]);
    });
    if (rawMetadata.conversationId !== undefined) event.conversationId = rawMetadata.conversationId === null ? null : String(rawMetadata.conversationId);
    if (Array.isArray(entry?.evidenceRefs || rawMetadata.evidenceRefs)) event.evidenceRefs = (entry.evidenceRefs || rawMetadata.evidenceRefs).map(String).slice(0, 50);
    if (eventType === 'MODEL_TERMINAL_RECORDED' && rawMetadata.answerEvidenceDispatchId) {
      const acceptedIdentity = api.normalizeDispatchIdentity?.(rawMetadata.answerEvidenceDispatchId, modelId);
      const prior = [...state.events].reverse().find((candidate) => candidate.modelId === modelId
        && candidate.dispatchId
        && api.normalizeDispatchIdentity?.(candidate.dispatchId, modelId) === acceptedIdentity
        && api.normalizeDispatchIdentity?.(candidate.dispatchId, modelId) !== api.normalizeDispatchIdentity?.(event.dispatchId, modelId));
      if (prior) {
        event.payload.metadata.priorIncidentRef = `incident:${prior.runSessionId}|${prior.runGeneration ?? 'none'}|${prior.modelId}|${prior.dispatchId}|${prior.generationEpoch ?? 'none'}`;
      }
    }
    if (eventType === 'MODEL_TERMINAL_RECORDED' && !event.candidateId) {
      const acceptedExtraction = [...state.events].reverse().find((candidate) => candidate.eventType === 'EXTRACTION_COMPLETED'
        && candidate.modelId === event.modelId
        && candidate.dispatchId === event.dispatchId
        && candidate.generationEpoch === event.generationEpoch
        && candidate.candidateId);
      if (acceptedExtraction) event.candidateId = acceptedExtraction.candidateId;
    }
    if (eventType === 'EXTRACTION_COMPLETED') {
      const source = String(rawMetadata.source || rawMetadata.answerSource || '').toLowerCase();
      const isRecoveryExtraction = /recovery|retry|repair/.test(source);
      if (isRecoveryExtraction) {
        const priorTerminal = [...state.events].reverse().find((candidate) => candidate.eventType === 'MODEL_TERMINAL_RECORDED'
          && candidate.modelId === event.modelId
          && candidate.dispatchId === event.dispatchId
          && (candidate.generationEpoch ?? null) === (event.generationEpoch ?? null));
        const priorRecoveryDecision = [...state.events].reverse().find((candidate) => (
          candidate.eventType === 'FINALIZATION_POLICY_EVALUATED' || candidate.eventType === 'POLICY_OVERRIDE_APPLIED'
        ) && candidate.modelId === event.modelId
          && candidate.dispatchId === event.dispatchId
          && /recovery|retry|repair/i.test(JSON.stringify(candidate.payload || {})));
        const recoveryRefs = [priorTerminal?.eventId, priorRecoveryDecision?.eventId].filter(Boolean);
        if (recoveryRefs.length) event.evidenceRefs = Array.from(new Set([...(event.evidenceRefs || []), ...recoveryRefs])).slice(0, 50);
      }
    }
    if (eventType === 'OBSERVATION_FRAME_CAPTURED') {
      const checks = rawMetadata.checkedAtLocalMonoMs || {};
      const coverage = root.ProofTelemetryClock?.signalCoverage?.(checks, contracts()?.THRESHOLDS?.maximumSignalSkewMs || 250);
      Object.assign(event.payload.metadata, {
        checkedAtLocalMonoMs: checks,
        maximumSignalSkewMs: coverage?.maximumSignalSkewMs ?? null,
        observationCoverage: coverage?.status || 'unknown',
        observationToSendDelayMs: Number.isFinite(event.clock.sentAtLocalMonoMs) && Number.isFinite(event.clock.observedAtLocalMonoMs)
          ? Math.max(0, event.clock.sentAtLocalMonoMs - event.clock.observedAtLocalMonoMs) : null,
        tabActive: rawMetadata.tabActive ?? 'unknown',
        tabVisible: rawMetadata.tabVisible ?? 'unknown',
        tabDiscarded: rawMetadata.tabDiscarded ?? 'unknown',
        documentVisibility: rawMetadata.documentVisibility ?? 'unknown',
        contentScriptAvailable: rawMetadata.contentScriptAvailable ?? 'unknown',
        timerThrottlingSuspected: rawMetadata.timerThrottlingSuspected ?? 'unknown',
        pageHealth: rawMetadata.pageHealth ?? 'unknown'
      });
    }
    return event;
  }

  function createCompanion(descriptor, sourceEvent, state) {
    const eventType = String(descriptor.eventType);
    const descriptorPayload = descriptor.payload || {};
    return nextEnvelope(state, {
      eventType,
      layer: descriptor.layer || proof().layerFor(descriptor.eventType),
      wallTs: sourceEvent.wallTs,
      modelId: sourceEvent.modelId,
      ...(sourceEvent.dispatchId ? { dispatchId: sourceEvent.dispatchId } : {}),
      ...(sourceEvent.generationEpoch !== undefined ? { generationEpoch: sourceEvent.generationEpoch } : {}),
      ...(sourceEvent.candidateId ? { candidateId: sourceEvent.candidateId } : {}),
      ...(sourceEvent.documentInstanceId ? { documentInstanceId: sourceEvent.documentInstanceId } : {}),
      ...(sourceEvent.turnId ? { turnId: sourceEvent.turnId } : {}),
      ...(sourceEvent.navigationEpoch !== undefined ? { navigationEpoch: sourceEvent.navigationEpoch } : {}),
      ...(sourceEvent.causationId ? { causationId: sourceEvent.causationId } : {}),
      ...(sourceEvent.correlationId ? { correlationId: sourceEvent.correlationId } : {}),
      producer: { component: 'proof-inference-policy', version: 'proof-policy@2.0.0' },
      clock: { ...sourceEvent.clock, ingestMonoMs: Math.max(0, monotonicNow() - WORKER_STARTED_MONO_MS) },
      payload: { typed: contracts()?.factOf?.({ eventType, payload: descriptorPayload }) || { kind: 'inference', state: 'recorded' }, ...descriptorPayload },
      evidenceRefs: Array.isArray(descriptor.evidenceRefs) ? descriptor.evidenceRefs.slice() : [sourceEvent.eventId]
    });
  }

  function stateKey(event) {
    const typed = contracts()?.factOf?.(event) || {};
    return [
      event.runSessionId,
      event.runGeneration ?? 'none',
      event.modelId,
      event.dispatchId || 'none',
      event.generationEpoch ?? 'none',
      event.candidateId || 'candidate-none',
      event.documentInstanceId || 'document-none',
      event.turnId || 'turn-none',
      event.navigationEpoch ?? 'navigation-none',
      event.layer,
      typed.kind || event.eventType
    ].join('|');
  }

  function operationalKey(entry, llmName, state) {
    const meta = entry?.meta || {};
    const route = proof().classifyRuntimeEvent?.(entry) || {};
    return [state.runSessionId, llmName || meta.llmName || 'SYSTEM', meta.dispatchId || meta.requestId || 'none', meta.generationEpoch ?? 'none', route.label || 'UNKNOWN'].join('|');
  }

  function flushOperationalAccumulator(state, key, reason = 'checkpoint') {
    const interval = state.operationalIntervals[key];
    if (!interval) return false;
    delete state.operationalIntervals[key];
    appendRecordToState(state, {
      ts: interval.lastWallTs,
      label: 'OPERATIONAL_INTERVAL_CLOSED',
      proofEventType: 'OBSERVER_HEALTH_INTERVAL_CLOSED',
      proofLayer: 'fact',
      typed: { kind: 'observation_interval', state: interval.degraded ? 'degraded' : 'observed' },
      meta: {
        runSessionId: interval.runSessionId,
        dispatchId: interval.dispatchId,
        generationEpoch: interval.generationEpoch,
        source: interval.signal,
        signal: interval.signal,
        count: interval.count,
        reason,
        reasons: interval.reasons,
        firstObservedIngestMonoMs: interval.firstIngestMonoMs,
        lastObservedIngestMonoMs: interval.lastIngestMonoMs,
        distinctReasonCount: interval.reasons.length
      }
    }, interval.modelId, { producerComponent: 'proof-operational-aggregator' });
    return true;
  }

  function flushOperationalIntervals(state, reason) {
    let count = 0;
    Object.keys(state.operationalIntervals || {}).forEach((key) => {
      if (flushOperationalAccumulator(state, key, reason)) count += 1;
    });
    return count;
  }

  function accumulateOperational(state, entry, llmName) {
    const key = operationalKey(entry, llmName, state);
    const meta = entry?.meta || {};
    const label = proof().classifyRuntimeEvent(entry).label;
    const nowMono = monotonicNow();
    const reason = String(meta.reason || meta.errorReason || meta.status || 'unspecified').slice(0, 120);
    const current = state.operationalIntervals[key] || {
      runSessionId: String(state.runSessionId),
      modelId: String(llmName || meta.llmName || 'SYSTEM'),
      dispatchId: meta.dispatchId || meta.requestId || null,
      generationEpoch: Number.isFinite(Number(meta.generationEpoch)) ? Number(meta.generationEpoch) : undefined,
      signal: label,
      count: 0,
      firstWallTs: Number(entry?.ts || Date.now()),
      firstIngestMonoMs: nowMono,
      reasons: [],
      degraded: false
    };
    current.count += 1;
    current.lastWallTs = Number(entry?.ts || Date.now());
    current.lastIngestMonoMs = nowMono;
    if (!current.reasons.includes(reason)) current.reasons = [...current.reasons, reason].slice(0, 10);
    current.degraded ||= /FAIL|EXHAUSTED|DENIED|ERROR/.test(label);
    state.operationalIntervals[key] = current;
    if (current.count >= OPERATIONAL_CHECKPOINT_COUNT) flushOperationalAccumulator(state, key, 'count_checkpoint');
  }

  function stageLegacyDebug(state, entry, llmName, route) {
    const meta = entry?.meta || {};
    const key = [llmName || meta.llmName || 'SYSTEM', route.label || 'UNKNOWN', meta.dispatchId || 'none'].join('|');
    const previous = state.legacyDebugRing[state.legacyDebugRing.length - 1];
    if (previous?.key === key) {
      previous.count += 1;
      previous.lastWallTs = Number(entry?.ts || Date.now());
      return;
    }
    state.legacyDebugRing.push({
      key,
      sourceEventType: route.label || 'UNKNOWN',
      modelId: String(llmName || meta.llmName || 'SYSTEM'),
      dispatchId: meta.dispatchId || null,
      firstWallTs: Number(entry?.ts || Date.now()),
      lastWallTs: Number(entry?.ts || Date.now()),
      count: 1
    });
    state.legacyDebugRing = state.legacyDebugRing.slice(-MAX_LEGACY_DEBUG_RECORDS);
  }

  function ensureProducerEpoch(state, entry, llmName) {
    const supplied = entry?.clock || entry?.meta?.clock;
    if (!supplied?.producerEpochId || state.producerEpochs[supplied.producerEpochId]) return;
    const event = nextEnvelope(state, {
      eventType: 'CLOCK_EPOCH_STARTED',
      layer: 'system',
      wallTs: Number(entry?.ts || Date.now()),
      modelId: String(llmName || entry?.meta?.llmName || 'SYSTEM'),
      producer: { component: 'proof-clock-runtime', version: PRODUCER_VERSION },
      clock: clockFor(entry, state, 'proof-clock-runtime'),
      payload: {
        typed: { kind: 'clock_epoch', state: 'started' },
        epochId: String(supplied.producerEpochId),
        originKind: supplied.originKind || 'unknown',
        predecessorEpochId: supplied.predecessorEpochId || null
      }
    });
    state.events.push(event);
    state.producerEpochs[supplied.producerEpochId] = event.eventId;
  }

  function appendRecordToState(state, entry, llmName, options = {}) {
    const normalizedSource = String(entry?.label || entry?.event || '').toUpperCase();
    if (/SPA_NAVIGATION|DOCUMENT_REPLACED|NAVIGATION_COMMITTED/.test(normalizedSource)) {
      closeIntervalsInState(state, 'navigation');
    }
    ensureProducerEpoch(state, entry, llmName);
    const event = createEvent(entry, llmName, state, options);
    const producerSequence = event.clock?.producerSequence;
    const producerEpochId = event.clock?.producerEpochId;
    if (producerSequence !== null && producerEpochId) {
      const previousSequence = state.producerSequences[producerEpochId];
      if (Number.isInteger(previousSequence) && producerSequence <= previousSequence) {
        const anomaly = nextEnvelope(state, {
          eventType: 'CLOCK_ORDER_ANOMALY_RECORDED',
          layer: 'audit',
          wallTs: event.wallTs,
          modelId: event.modelId,
          ...(event.dispatchId ? { dispatchId: event.dispatchId } : {}),
          ...(event.generationEpoch !== undefined ? { generationEpoch: event.generationEpoch } : {}),
          producer: { component: 'proof-clock-runtime', version: PRODUCER_VERSION },
          clock: { ...event.clock, ingestMonoMs: Math.max(0, monotonicNow() - WORKER_STARTED_MONO_MS) },
          payload: { typed: { kind: 'clock_anomaly', state: 'producer_reordered' }, producerEpochId, previousSequence, observedSequence: producerSequence },
          evidenceRefs: [event.eventId]
        });
        state.events.push(anomaly);
      }
      state.producerSequences[producerEpochId] = Math.max(Number(previousSequence ?? -1), producerSequence);
    }
    const key = stateKey(event);
    const comparison = proof().stableStringify({
      eventType: event.eventType,
      identity: {
        candidateId: event.candidateId || null,
        documentInstanceId: event.documentInstanceId || null,
        turnId: event.turnId || null,
        navigationEpoch: event.navigationEpoch ?? null,
        causationId: event.causationId || null,
        correlationId: event.correlationId || null
      },
      payload: event.payload
    });
    if (state.signalStates[key] === comparison) {
      state.nextIngestSeq -= 1;
      state.noopCounts[key] = Number(state.noopCounts[key] || 0) + 1;
      if (state.noopCounts[key] % HEARTBEAT_EVERY_NOOPS !== 0) return null;
      event.eventType = 'OBSERVATION_HEARTBEAT';
      event.payload = { typed: { kind: 'observation_heartbeat', state: 'unchanged' }, signalKey: key, suppressedNoopCount: state.noopCounts[key] };
      event.ingestSeq = state.nextIngestSeq++;
      event.eventId = makeId('event');
    } else {
      state.signalStates[key] = comparison;
      state.noopCounts[key] = 0;
    }
    if (event.eventType === 'MODEL_TERMINAL_RECORDED') {
      const decision = [...state.events].reverse().find((candidate) => candidate.eventType === 'DECISION_RECORDED'
        && candidate.modelId === event.modelId && candidate.dispatchId === event.dispatchId
        && candidate.generationEpoch === event.generationEpoch);
      if (decision) {
        event.evidenceRefs = Array.from(new Set([...(event.evidenceRefs || []), decision.eventId]));
        event.payload.metadata.decisionId = decision.eventId;
      }
    }
    state.events.push(event);
    if (event.eventType === 'OBSERVATION_FRAME_CAPTURED') {
      const intervalKey = [event.modelId, event.dispatchId || 'none', event.generationEpoch ?? 'none'].join('|');
      const prior = state.openObservationIntervals[intervalKey];
      state.openObservationIntervals[intervalKey] = prior
        ? { ...prior, lastEventId: event.eventId, sampleCount: prior.sampleCount + 1 }
        : { modelId: event.modelId, dispatchId: event.dispatchId, generationEpoch: event.generationEpoch, firstEventId: event.eventId, lastEventId: event.eventId, sampleCount: 1 };
    }
    const companions = [
      ...(root.ProofTelemetryPolicy?.planCompanions?.(event, state.events) || []),
      ...(root.ProofTelemetryAudit?.planAfterEvent?.(event, state.events) || [])
    ];
    companions.forEach((descriptor) => {
      const companion = createCompanion(descriptor, event, state);
      const companionKey = stateKey(companion);
      const companionState = proof().stableStringify(companion.payload);
      if (state.signalStates[companionKey] !== companionState) {
        state.signalStates[companionKey] = companionState;
        state.events.push(companion);
      } else {
        state.nextIngestSeq -= 1;
      }
    });
    return event;
  }

  function applyRecord(state, recordEntry = {}, llmName, options = {}) {
      let entry = recordEntry;
      const requestedRunId = resolveRunSessionId(entry, options.runSessionId || state.runSessionId);
      if (!requestedRunId) {
        const ingestSeq = state.nextIngestSeq++;
        const staged = safeStagingRecord(entry, llmName, null, state.runSessionId, 'unattributed_identity', ingestSeq);
        const result = boundedPush(state.unattributed, staged, MAX_PENDING_EVENTS, { eventType: 'PENDING_EVIDENCE_DROPPED', buffer: 'unattributed' });
        state.unattributed = result.items;
        if (result.loss) state.stagingLosses.push(result.loss);
        return state;
      }
      if (state.status !== 'active') {
        const ingestSeq = state.nextIngestSeq++;
        const staged = safeStagingRecord(entry, llmName, requestedRunId, state.runSessionId, 'run_not_active', ingestSeq);
        const result = boundedPush(state.pending[requestedRunId], staged, MAX_PENDING_EVENTS, { eventType: 'PENDING_EVIDENCE_DROPPED', buffer: 'pending', runSessionId: String(requestedRunId) });
        state.pending[requestedRunId] = result.items;
        if (result.loss) state.stagingLosses.push(result.loss);
        return state;
      }
      if (String(state.runSessionId) !== String(requestedRunId)) {
        const ingestSeq = state.nextIngestSeq++;
        const staged = safeStagingRecord(entry, llmName, requestedRunId, state.runSessionId, 'run_identity_mismatch', ingestSeq);
        const result = boundedPush(state.quarantine, staged, MAX_QUARANTINE_EVENTS, { eventType: 'PENDING_EVIDENCE_DROPPED', buffer: 'quarantine', runSessionId: String(requestedRunId) });
        state.quarantine = result.items;
        if (result.loss) state.stagingLosses.push(result.loss);
        return state;
      }
      const route = proof().classifyRuntimeEvent?.(entry) || { route: 'canonical' };
      if (route.route === 'operational') {
        accumulateOperational(state, entry, llmName);
        return state;
      }
      if (route.route === 'debug') {
        stageLegacyDebug(state, entry, llmName, route);
        return state;
      }
      if ((!entry.proofEventType && !entry?.meta?.proofEventType && route.eventType) || route.typed) {
        entry = { ...entry, ...(route.eventType ? { proofEventType: route.eventType } : {}), ...(route.typed ? { typed: route.typed } : {}) };
      }
      appendRecordToState(state, entry, llmName, options);
      return state;
  }

  function flushPendingRecordBatch() {
    if (!pendingRecordBatch.length) {
      recordBatchScheduled = false;
      return mutationChain;
    }
    const batch = pendingRecordBatch;
    pendingRecordBatch = [];
    recordBatchScheduled = false;
    const operation = enqueue((current) => {
      const state = normalizeState(current);
      batch.forEach((item) => applyRecord(state, item.entry, item.llmName, item.options));
      return state;
    });
    operation.then(
      (state) => batch.forEach((item) => item.resolve(state)),
      (error) => batch.forEach((item) => item.reject(error))
    );
    return operation;
  }

  function scheduleRecordBatchFlush() {
    if (recordBatchScheduled) return;
    recordBatchScheduled = true;
    const schedule = typeof queueMicrotask === 'function'
      ? queueMicrotask
      : (callback) => Promise.resolve().then(callback);
    schedule(() => flushPendingRecordBatch());
  }

  function record(entry = {}, llmName, options = {}) {
    return new Promise((resolve, reject) => {
      pendingRecordBatch.push({ entry, llmName, options, resolve, reject });
      scheduleRecordBatchFlush();
    });
  }

  function appendCanonical(event = {}) {
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      if (!event || ![5, 6].includes(Number(event.schemaVersion))) throw new Error('invalid canonical telemetry event');
      const next = { ...event, schemaVersion: 6, eventId: event.eventId || makeId('event'), seq: state.events.length + 1, ingestSeq: state.nextIngestSeq++, runGeneration: state.runGeneration || 1 };
      next.clock ||= clockFor({}, state, next.producer?.component || 'canonical-import');
      next.payload = { typed: contracts()?.factOf?.(next) || { kind: 'unknown', state: 'unknown' }, ...(next.payload || {}) };
      state.events.push(next);
      return state;
    });
  }

  // A caller that passes no runSessionId means "the run I am looking at", not
  // "every run ever recorded". The old null-means-everything contract made the
  // JSON export carry events from earlier sessions while labelling the file with
  // the current runSessionId, so a reload before a fresh run produced an export
  // that silently mixed two sessions. Absent scope now resolves to the ledger's
  // own current session; `allRunSessions: true` is the explicit opt-in for the
  // whole history.
  function resolveSnapshotScope(state, runSessionId, allRunSessions) {
    if (allRunSessions === true) return null;
    if (runSessionId !== null && typeof runSessionId !== 'undefined') return runSessionId;
    return state.runSessionId ?? null;
  }

  function buildSnapshot(state, { runSessionId = null, allRunSessions = false, consistency = 'queue_drained' } = {}) {
      const scope = resolveSnapshotScope(state, runSessionId, allRunSessions);
      const events = scope === null ? state.events : state.events.filter((event) => String(event.runSessionId) === String(scope));
      const lifecycle = scope === null ? state.lifecycle : state.lifecycle.filter((event) => String(event.runSessionId) === String(scope));
      return {
        schemaVersion: 6,
        runSessionId: scope ?? state.runSessionId,
        runSessionScope: scope === null ? 'all_run_sessions' : 'single_run_session',
        runGeneration: state.runGeneration,
        status: state.status,
        firstSeq: events[0]?.seq || 0,
        lastSeq: events[events.length - 1]?.seq || 0,
        firstIngestSeq: [...lifecycle, ...events].length
          ? [...lifecycle, ...events].reduce((min, event) => Math.min(min, event.ingestSeq), Infinity)
          : 0,
        lastIngestSeq: [...lifecycle, ...events].reduce((max, event) => Math.max(max, event.ingestSeq), 0),
        eventCount: events.length,
        events: events.slice(),
        lifecycle: lifecycle.slice(),
        pendingEventCount: Object.values(state.pending).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
        quarantineEventCount: state.quarantine.length,
        unattributedEventCount: state.unattributed.length,
        legacyDebugRecordCount: state.legacyDebugRing.length,
        stagingLosses: state.stagingLosses.slice(),
        snapshotConsistency: consistency,
        queuedMutationCount,
        pendingRecordCount: pendingRecordBatch.length
      };
  }

  function snapshot({ runSessionId = null, allRunSessions = false } = {}) {
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      return flushOperationalIntervals(state, 'export_snapshot') ? state : current;
    }).then((state) => buildSnapshot(state, { runSessionId, allRunSessions, consistency: 'queue_drained' }));
  }

  async function snapshotCommitted({ runSessionId = null, allRunSessions = false } = {}) {
    const state = stateCache
      ? normalizeState(stateCache)
      : normalizeState(await readStored());
    return buildSnapshot(state, { runSessionId, allRunSessions, consistency: 'committed_boundary' });
  }

  function snapshotIncident(scope) {
    if (root.ProofTelemetryStore?.readIncident) return root.ProofTelemetryStore.readIncident(scope);
    return snapshot({ runSessionId: scope?.runSessionId }).then((result) => result.events.filter((event) => (
      String(event.modelId) === String(scope?.modelId)
      && String(event.dispatchId) === String(scope?.dispatchId)
      && Number(event.generationEpoch ?? -1) === Number(scope?.generationEpoch ?? -1)
    )));
  }

  function recover() {
    flushPendingRecordBatch();
    return enqueue((current) => {
      const state = normalizeState(current);
      const opening = [...state.lifecycle].reverse().find((event) => event.eventType === 'RUN_OPEN_INTENT');
      const opened = [...state.lifecycle].reverse().find((event) => event.eventType === 'RUN_OPENED');
      if (opening && (!opened || opened.ingestSeq < opening.ingestSeq)) {
        appendLifecycle(state, 'RUN_OPEN_ABANDONED', { intentId: opening.payload.intentId, reason: 'worker_restart' }, opening);
      }
      if (state.status === 'closing') {
        appendLifecycle(state, 'RUN_CLOSED', { reason: 'recovered_after_crash', completenessKnown: false });
        state.status = 'closed';
      } else if (state.status === 'active' && Object.keys(state.openObservationIntervals).length) {
        closeIntervalsInState(state, 'observer_restart');
      }
      return state;
    });
  }

  function clear(runSessionId = null) {
    flushPendingRecordBatch();
    const operation = mutationChain.catch(() => {}).then(async () => {
      const current = normalizeState(await readCurrentState());
      if (root.ProofTelemetryStore?.clearActive) await root.ProofTelemetryStore.clearActive();
      else await chrome.storage.local.set({ [STORAGE_KEY]: null });
      const next = { ...emptyState(), nextRunGeneration: current.nextRunGeneration, nextIngestSeq: current.nextIngestSeq, runSessionId };
      if (root.ProofTelemetryStore?.saveState) await root.ProofTelemetryStore.saveState(next);
      else await chrome.storage.local.set({ [STORAGE_KEY]: next });
      stateCache = normalizeState(next);
      return stateCache;
    });
    mutationChain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  // Synchronous read of the session the ledger currently considers active, for
  // callers that must scope a different store (the diagnostics buffer) to the
  // same run without awaiting a full snapshot. Returns null before the first run.
  function currentRunSessionId() {
    const state = stateCache ? normalizeState(stateCache) : null;
    return state?.runSessionId ?? null;
  }

  root.ProofTelemetryLedger = Object.freeze({
    STORAGE_KEY, MAX_EVENTS, MAX_QUARANTINE_EVENTS, MAX_PENDING_EVENTS,
    beginRun, closeRun, stagePending, record, appendCanonical, snapshot, snapshotCommitted, snapshotIncident,
    currentRunSessionId, recover, clear
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

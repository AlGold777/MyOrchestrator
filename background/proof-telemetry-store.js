// Segmented IndexedDB persistence for proof telemetry.
'use strict';

(function initProofTelemetryStore(root) {
  const DB_NAME = 'proof-telemetry-v6';
  const DB_VERSION = 1;
  const POINTER_KEY = '__proof_telemetry_active_pointer_v6__';
  const FALLBACK_KEY = '__proof_telemetry_store_fallback_v6__';
  const STORE_NAMES = Object.freeze({
    lifecycle: 'lifecycle',
    events: 'canonicalEvents',
    incidents: 'incidents',
    quarantine: 'quarantine',
    attachments: 'attachments',
    meta: 'meta'
  });
  let dbPromise = null;

  function incidentId(event) {
    if (!event?.dispatchId || event.modelId === 'SYSTEM') return null;
    return [event.runSessionId, event.runGeneration, event.modelId, event.dispatchId, event.generationEpoch ?? 'none'].join('|');
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    });
  }

  function openDatabase() {
    if (!root.indexedDB) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const lifecycle = db.createObjectStore(STORE_NAMES.lifecycle, { keyPath: 'eventId' });
        lifecycle.createIndex('byRunGeneration', 'runGeneration');
        lifecycle.createIndex('byIngestSeq', 'ingestSeq', { unique: true });
        const events = db.createObjectStore(STORE_NAMES.events, { keyPath: 'eventId' });
        events.createIndex('byRunGeneration', 'runGeneration');
        events.createIndex('byRunSession', 'runSessionId');
        events.createIndex('byIngestSeq', 'ingestSeq', { unique: true });
        events.createIndex('byIncident', 'incidentId');
        const incidents = db.createObjectStore(STORE_NAMES.incidents, { keyPath: 'incidentId' });
        incidents.createIndex('byRunGeneration', 'runGeneration');
        incidents.createIndex('byPlatform', 'modelId');
        const quarantine = db.createObjectStore(STORE_NAMES.quarantine, { keyPath: 'stagingId' });
        quarantine.createIndex('byRequestedRun', 'requestedRunSessionId');
        db.createObjectStore(STORE_NAMES.attachments, { keyPath: 'attachmentId' });
        db.createObjectStore(STORE_NAMES.meta, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open proof telemetry database'));
      request.onblocked = () => reject(new Error('Proof telemetry database upgrade blocked'));
    });
    return dbPromise;
  }

  async function readFallback() {
    const stored = await chrome.storage.local.get([FALLBACK_KEY]);
    return stored?.[FALLBACK_KEY] || null;
  }

  async function writePointer(state, extra = {}) {
    await chrome.storage.local.set({
      [POINTER_KEY]: {
        runSessionId: state.runSessionId ?? null,
        runGeneration: state.runGeneration ?? null,
        status: state.status || 'closed',
        nextRunGeneration: state.nextRunGeneration || 1,
        nextIngestSeq: state.nextIngestSeq || 1,
        derivedThroughSeq: Math.max(0, ...(state.events || []).map((event) => Number(event.ingestSeq || 0))),
        storageMode: root.indexedDB ? 'indexeddb' : 'fallback-test-only',
        ...extra
      }
    });
  }

  async function saveState(state) {
    const db = await openDatabase();
    if (!db) {
      const existing = await readFallback();
      await chrome.storage.local.set({ [FALLBACK_KEY]: { ...state, attachments: existing?.attachments || state.attachments || {} } });
      await writePointer(state);
      return state;
    }
    const names = Object.values(STORE_NAMES);
    const tx = db.transaction(names, 'readwrite', { durability: 'strict' });
    const eventStore = tx.objectStore(STORE_NAMES.events);
    const lifecycleStore = tx.objectStore(STORE_NAMES.lifecycle);
    const incidentStore = tx.objectStore(STORE_NAMES.incidents);
    const quarantineStore = tx.objectStore(STORE_NAMES.quarantine);
    let priorMeta = null;
    try {
      priorMeta = await requestResult(tx.objectStore(STORE_NAMES.meta).get('runtime-state'));
      const persistedThrough = Number(priorMeta?.value?.lastPersistedIngestSeq || 0);
      (state.events || []).filter((event) => Number(event.ingestSeq) > persistedThrough).forEach((event) => {
        const id = incidentId(event);
        eventStore.add(id ? { ...event, incidentId: id } : event);
        if (id) incidentStore.put({
          incidentId: id,
          runSessionId: event.runSessionId,
          runGeneration: event.runGeneration,
          modelId: event.modelId,
          dispatchId: event.dispatchId,
          generationEpoch: event.generationEpoch ?? null,
          lastIngestSeq: event.ingestSeq
        });
      });
      (state.lifecycle || []).filter((event) => Number(event.ingestSeq) > persistedThrough).forEach((event) => lifecycleStore.add(event));
      (state.quarantine || []).filter((record) => Number(record.ingestSeq || 0) > persistedThrough).forEach((record) => quarantineStore.put(record));
      const projection = { ...state };
      delete projection.events;
      delete projection.lifecycle;
      delete projection.quarantine;
      projection.lastPersistedIngestSeq = Math.max(persistedThrough, Number(state.nextIngestSeq || 1) - 1);
      tx.objectStore(STORE_NAMES.meta).put({ key: 'runtime-state', value: projection });
      await transactionDone(tx);
      await writePointer(state, { lastPersistenceError: null });
      return state;
    } catch (error) {
      try { tx.abort(); } catch (_) { /* already aborted */ }
      await writePointer(priorMeta?.value || {
        runSessionId: null,
        runGeneration: null,
        status: 'closed',
        nextRunGeneration: 1,
        nextIngestSeq: 1,
        events: []
      }, { lastPersistenceError: error?.name || 'transaction_failed' });
      throw error;
    }
  }

  async function getAll(store) {
    return requestResult(store.getAll());
  }

  async function loadState() {
    const db = await openDatabase();
    if (!db) return readFallback();
    const tx = db.transaction([STORE_NAMES.meta, STORE_NAMES.events, STORE_NAMES.lifecycle, STORE_NAMES.quarantine], 'readonly');
    const meta = await requestResult(tx.objectStore(STORE_NAMES.meta).get('runtime-state'));
    if (!meta?.value) return null;
    const projection = meta.value;
    const activeEvents = projection.runGeneration === null || projection.runGeneration === undefined
      ? []
      : await requestResult(tx.objectStore(STORE_NAMES.events).index('byRunGeneration').getAll(projection.runGeneration));
    const events = activeEvents
      .sort((left, right) => left.ingestSeq - right.ingestSeq)
      .map((event) => {
        const copy = { ...event };
        delete copy.incidentId;
        return copy;
      });
    const lifecycle = (await getAll(tx.objectStore(STORE_NAMES.lifecycle))).sort((left, right) => left.ingestSeq - right.ingestSeq);
    const quarantine = await getAll(tx.objectStore(STORE_NAMES.quarantine));
    await transactionDone(tx);
    const pointer = await chrome.storage.local.get([POINTER_KEY]);
    const persistenceError = pointer?.[POINTER_KEY]?.lastPersistenceError;
    return {
      ...projection,
      events,
      lifecycle,
      quarantine,
      stagingLosses: persistenceError
        ? [...(projection.stagingLosses || []), { eventType: 'PERSISTENCE_FAILURE_DETECTED', reason: persistenceError }]
        : (projection.stagingLosses || [])
    };
  }

  async function readIncident(scope) {
    const db = await openDatabase();
    if (!db) {
      const state = await readFallback();
      return (state?.events || []).filter((event) => incidentId(event) === incidentId(scope));
    }
    const id = incidentId(scope);
    if (!id) return [];
    const tx = db.transaction(STORE_NAMES.events, 'readonly');
    const records = await requestResult(tx.objectStore(STORE_NAMES.events).index('byIncident').getAll(id));
    await transactionDone(tx);
    return records.sort((left, right) => left.ingestSeq - right.ingestSeq).map((record) => {
      const copy = { ...record };
      delete copy.incidentId;
      return copy;
    });
  }

  async function recoverIndexes() {
    const db = await openDatabase();
    if (!db) return { recovered: false, mode: 'fallback-test-only' };
    const readTx = db.transaction(STORE_NAMES.events, 'readonly');
    const events = await getAll(readTx.objectStore(STORE_NAMES.events));
    await transactionDone(readTx);
    const writeTx = db.transaction(STORE_NAMES.incidents, 'readwrite');
    const store = writeTx.objectStore(STORE_NAMES.incidents);
    store.clear();
    events.forEach((event) => {
      const id = incidentId(event);
      if (id) store.put({ incidentId: id, runSessionId: event.runSessionId, runGeneration: event.runGeneration, modelId: event.modelId, dispatchId: event.dispatchId, generationEpoch: event.generationEpoch ?? null, lastIngestSeq: event.ingestSeq });
    });
    await transactionDone(writeTx);
    return { recovered: true, incidentCount: new Set(events.map(incidentId).filter(Boolean)).size };
  }

  async function putAttachment(attachment) {
    if (!attachment?.attachmentId) throw new Error('attachmentId is required');
    const db = await openDatabase();
    if (!db) {
      const state = await readFallback() || {};
      const attachments = { ...(state.attachments || {}), [attachment.attachmentId]: attachment };
      await chrome.storage.local.set({ [FALLBACK_KEY]: { ...state, attachments } });
      return attachment;
    }
    const tx = db.transaction(STORE_NAMES.attachments, 'readwrite');
    tx.objectStore(STORE_NAMES.attachments).put(attachment);
    await transactionDone(tx);
    return attachment;
  }

  async function getAttachment(attachmentId) {
    const db = await openDatabase();
    if (!db) return (await readFallback())?.attachments?.[attachmentId] || null;
    const tx = db.transaction(STORE_NAMES.attachments, 'readonly');
    const attachment = await requestResult(tx.objectStore(STORE_NAMES.attachments).get(attachmentId));
    await transactionDone(tx);
    return attachment || null;
  }

  async function listIncidents({ runGeneration = null, modelId = null } = {}) {
    const db = await openDatabase();
    if (!db) {
      const state = await readFallback();
      const seen = new Map();
      (state?.events || []).forEach((event) => {
        const id = incidentId(event);
        if (id) seen.set(id, { incidentId: id, runSessionId: event.runSessionId, runGeneration: event.runGeneration, modelId: event.modelId, dispatchId: event.dispatchId, generationEpoch: event.generationEpoch ?? null, lastIngestSeq: event.ingestSeq });
      });
      return [...seen.values()].filter((item) => (runGeneration === null || Number(item.runGeneration) === Number(runGeneration)) && (!modelId || item.modelId === modelId));
    }
    const tx = db.transaction(STORE_NAMES.incidents, 'readonly');
    const records = runGeneration === null
      ? await getAll(tx.objectStore(STORE_NAMES.incidents))
      : await requestResult(tx.objectStore(STORE_NAMES.incidents).index('byRunGeneration').getAll(runGeneration));
    await transactionDone(tx);
    return records.filter((item) => !modelId || item.modelId === modelId).sort((left, right) => left.lastIngestSeq - right.lastIngestSeq);
  }

  async function clearActive() {
    const db = await openDatabase();
    if (!db) {
      await chrome.storage.local.set({ [FALLBACK_KEY]: null, [POINTER_KEY]: null });
      return;
    }
    const tx = db.transaction(Object.values(STORE_NAMES), 'readwrite');
    Object.values(STORE_NAMES).forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
    await chrome.storage.local.set({ [POINTER_KEY]: null });
  }

  root.ProofTelemetryStore = Object.freeze({ DB_NAME, DB_VERSION, POINTER_KEY, STORE_NAMES, openDatabase, saveState, loadState, readIncident, listIncidents, recoverIndexes, putAttachment, getAttachment, clearActive });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ProofTelemetryStore;
})(typeof globalThis !== 'undefined' ? globalThis : self);

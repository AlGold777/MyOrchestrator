// background/dispatch-retry.js
// Purpose: dispatch idempotency + retry classification + circuit breaker persistence.

'use strict';

// Idempotency window must exceed the longest realistic web-UI generation
// (long answers regularly exceed 5 minutes).
const DISPATCH_ID_TTL_MS = 15 * 60 * 1000;
const DISPATCH_ID_CLEANUP_LIMIT = 50;
const DISPATCH_CIRCUIT_STORAGE_KEY = 'unifiedCircuitState.v1';
const LEGACY_CIRCUIT_BREAKER_KEY = 'circuit' + 'BreakerState';
const DISPATCH_CIRCUIT_DEBOUNCE_MS = 2000;
const DISPATCH_ID_STORAGE_KEY = 'dispatchIdRegistry.v1';
const DISPATCH_ID_DEBOUNCE_MS = 1500;

const dispatchIdRegistry = new Map();
const dispatchCircuitMap = new Map();
let dispatchCircuitPersistTimer = null;
let dispatchIdPersistTimer = null;

const resolveRetryStrategy = () => {
  if (typeof self.RetryStrategy === 'function') {
    return new self.RetryStrategy({
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitterFactor: 0.3
    });
  }
  return null;
};

const retryStrategy = resolveRetryStrategy();

const cleanupDispatchIds = (limit = DISPATCH_ID_CLEANUP_LIMIT) => {
  const now = Date.now();
  let removed = 0;
  for (const [dispatchId, entry] of dispatchIdRegistry.entries()) {
    if (removed >= limit) break;
    if (now - entry.ts >= DISPATCH_ID_TTL_MS) {
      dispatchIdRegistry.delete(dispatchId);
      removed += 1;
    }
  }
};

const resolveDispatchIdStorage = () => (typeof chrome !== 'undefined' && chrome.storage?.session) ? 'session' : 'local';
const readDispatchIdStorage = async () => {
  try {
    const area = resolveDispatchIdStorage();
    const stored = await chrome.storage[area].get(DISPATCH_ID_STORAGE_KEY);
    return stored?.[DISPATCH_ID_STORAGE_KEY] || null;
  } catch (error) {
    console.warn('[DISPATCH_ID] Failed to read persistent ledger', error);
    return null;
  }
};
const writeDispatchIdStorage = async () => {
  cleanupDispatchIds();
  const payload = Object.fromEntries(dispatchIdRegistry.entries());
  try {
    const area = resolveDispatchIdStorage();
    await chrome.storage[area].set({ [DISPATCH_ID_STORAGE_KEY]: payload });
  } catch (error) {
    console.warn('[DISPATCH_ID] Failed to persist ledger', error);
  }
};
const persistDispatchIds = (immediate = false) => {
  if (immediate) {
    if (dispatchIdPersistTimer) clearTimeout(dispatchIdPersistTimer);
    dispatchIdPersistTimer = null;
    return writeDispatchIdStorage();
  }
  if (dispatchIdPersistTimer) clearTimeout(dispatchIdPersistTimer);
  dispatchIdPersistTimer = setTimeout(() => {
    dispatchIdPersistTimer = null;
    writeDispatchIdStorage();
  }, DISPATCH_ID_DEBOUNCE_MS);
  return null;
};
const loadDispatchIdRegistry = async () => {
  const stored = await readDispatchIdStorage();
  dispatchIdRegistry.clear();
  if (stored && typeof stored === 'object') {
    Object.entries(stored).forEach(([dispatchId, entry]) => {
      if (entry && typeof entry === 'object') dispatchIdRegistry.set(dispatchId, entry);
    });
  }
  cleanupDispatchIds();
  return dispatchIdRegistry.size;
};

const registerDispatchId = (dispatchId, meta = {}) => {
  if (!dispatchId) return { ok: false, reason: 'missing_dispatch_id' };
  cleanupDispatchIds();
  const existing = dispatchIdRegistry.get(dispatchId);
  if (existing?.confirmed && Date.now() - existing.ts < DISPATCH_ID_TTL_MS) {
    return { ok: false, reason: 'already_confirmed' };
  }
  dispatchIdRegistry.set(dispatchId, {
    ts: Date.now(),
    confirmed: false,
    meta
  });
  persistDispatchIds();
  return { ok: true };
};

const markDispatchConfirmed = (dispatchId, meta = {}) => {
  if (!dispatchId) return;
  cleanupDispatchIds();
  const existing = dispatchIdRegistry.get(dispatchId) || { ts: Date.now() };
  existing.confirmed = true;
  existing.confirmedAt = Date.now();
  existing.meta = { ...(existing.meta || {}), ...meta };
  dispatchIdRegistry.set(dispatchId, existing);
  // Confirmation is durable immediately: a worker restart must not make a
  // provider response look like a fresh logical dispatch.
  persistDispatchIds(true);
};

const isDispatchConfirmed = (dispatchId) => {
  if (!dispatchId) return false;
  cleanupDispatchIds();
  const existing = dispatchIdRegistry.get(dispatchId);
  if (!existing) return false;
  if (Date.now() - existing.ts >= DISPATCH_ID_TTL_MS) {
    dispatchIdRegistry.delete(dispatchId);
    return false;
  }
  return !!existing.confirmed;
};

const classifyDispatchError = (error) => {
  if (!retryStrategy) return { classification: 'UNKNOWN', retryable: true, delayMs: 0 };
  const classification = retryStrategy.classifyError(error || {});
  return {
    classification,
    retryable: retryStrategy.shouldRetry(0, error || {}),
    delayMs: retryStrategy.getDelay(1, error || {})
  };
};

const getDispatchRetryDelay = (attempt, error) => {
  if (!retryStrategy) return 0;
  return retryStrategy.getDelay(attempt, error || {});
};

const getDispatchRetryDecision = (attempt, error) => {
  if (!retryStrategy) return { shouldRetry: true, delayMs: 0, classification: 'UNKNOWN' };
  return {
    shouldRetry: retryStrategy.shouldRetry(attempt, error || {}),
    delayMs: retryStrategy.getDelay(attempt, error || {}),
    classification: retryStrategy.classifyError(error || {})
  };
};

const resolveDispatchCircuitStorage = () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) return 'session';
  return 'local';
};

const readDispatchCircuitStorage = async () => {
  const area = resolveDispatchCircuitStorage();
  try {
    const stored = await chrome.storage[area].get(DISPATCH_CIRCUIT_STORAGE_KEY);
    return stored?.[DISPATCH_CIRCUIT_STORAGE_KEY] || null;
  } catch (err) {
    console.warn('[DISPATCH_CIRCUIT] Failed to read storage', err);
    return null;
  }
};

const writeDispatchCircuitStorage = async (payload) => {
  const area = resolveDispatchCircuitStorage();
  try {
    await chrome.storage[area].set({ [DISPATCH_CIRCUIT_STORAGE_KEY]: payload });
  } catch (err) {
    console.warn('[DISPATCH_CIRCUIT] Failed to persist', err);
  }
};

const persistDispatchCircuitState = () => {
  if (dispatchCircuitPersistTimer) {
    clearTimeout(dispatchCircuitPersistTimer);
  }
  dispatchCircuitPersistTimer = setTimeout(async () => {
    dispatchCircuitPersistTimer = null;
    const payload = {};
    dispatchCircuitMap.forEach((breaker, llmName) => {
      if (breaker?.toJSON) {
        payload[llmName] = breaker.toJSON();
      }
    });
    await writeDispatchCircuitStorage(payload);
  }, DISPATCH_CIRCUIT_DEBOUNCE_MS);
};

const loadDispatchCircuitState = async () => {
  const stored = await readDispatchCircuitStorage();
  if (stored && typeof stored === 'object') {
    Object.keys(stored).forEach((llmName) => {
      const raw = stored[llmName];
      if (self.CircuitBreaker?.from) {
        dispatchCircuitMap.set(llmName, self.CircuitBreaker.from(raw));
      }
    });
  }
  try {
    await chrome.storage.local.remove([LEGACY_CIRCUIT_BREAKER_KEY]);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) await chrome.storage.session.remove([LEGACY_CIRCUIT_BREAKER_KEY, 'dispatchCircuitState']);
    await chrome.storage.local.remove(['dispatchCircuitState']);
  } catch (_) {}
};

const getDispatchCircuitBreaker = (llmName) => {
  if (!llmName) return null;
  if (!dispatchCircuitMap.has(llmName)) {
    const breaker = self.CircuitBreaker
      ? new self.CircuitBreaker({ failureThreshold: 3, recoveryTimeMs: 5 * 60 * 1000 })
      : null;
    if (breaker) {
      dispatchCircuitMap.set(llmName, breaker);
    }
  }
  return dispatchCircuitMap.get(llmName) || null;
};

const canDispatchWithCircuit = (llmName) => {
  const breaker = getDispatchCircuitBreaker(llmName);
  if (!breaker) return { ok: true, retryAfterMs: 0 };
  if (breaker.canExecute()) {
    return { ok: true, retryAfterMs: 0 };
  }
  const retryAfterMs = Math.max(0, (breaker.reopensAt || 0) - Date.now());
  return { ok: false, retryAfterMs };
};

const recordDispatchSuccess = (llmName) => {
  const breaker = getDispatchCircuitBreaker(llmName);
  if (!breaker) return;
  breaker.recordSuccess();
  persistDispatchCircuitState();
};

const recordDispatchFailure = (llmName, error) => {
  const breaker = getDispatchCircuitBreaker(llmName);
  if (!breaker) return null;
  breaker.recordFailure(error);
  persistDispatchCircuitState();
  return breaker;
};

function initializeCircuitBreakers(llmNames) {
  if (!Array.isArray(llmNames)) return;
  llmNames.forEach((name) => { getDispatchCircuitBreaker(name); });
}

function allowCircuitHalfOpenForNewRun(llmNames) {
  if (!Array.isArray(llmNames)) return;
  let changed = false;
  llmNames.forEach((name) => {
    const breaker = getDispatchCircuitBreaker(name);
    if (breaker && breaker.state === 'OPEN') {
      breaker.state = 'HALF_OPEN';
      breaker.failures = Math.max(0, breaker.failureThreshold - 1);
      breaker.reopensAt = null;
      changed = true;
    }
  });
  if (changed) persistDispatchCircuitState();
}

function getCircuitSnapshot() {
  const snapshot = {};
  dispatchCircuitMap.forEach((breaker, llmName) => {
    snapshot[llmName] = breaker?.toJSON ? breaker.toJSON() : breaker;
  });
  return snapshot;
}

self.DispatchIdRegistry = {
  registerDispatchId,
  markDispatchConfirmed,
  isDispatchConfirmed,
  cleanupDispatchIds,
  loadDispatchIdRegistry
};

self.DispatchRetry = {
  classifyDispatchError,
  getDispatchRetryDelay,
  getDispatchRetryDecision
};

self.DispatchCircuit = {
  loadDispatchCircuitState,
  getDispatchCircuitBreaker,
  canDispatchWithCircuit,
  recordDispatchSuccess,
  recordDispatchFailure,
  getCircuitSnapshot
};

self.initializeCircuitBreakers = initializeCircuitBreakers;
self.allowCircuitHalfOpenForNewRun = allowCircuitHalfOpenForNewRun;

globalThis.LLMLog?.debug?.('[DispatchRetry] Module loaded');
// Loading is intentionally best-effort. The first dispatch remains safe when
// storage is unavailable; a later worker wake restores the persisted ledger.
loadDispatchIdRegistry().catch(() => {});

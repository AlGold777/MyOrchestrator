// background/selector-metrics.js
// Selector metrics, health checks, and override audit helpers.

'use strict';

const RESOLUTION_LAYER_MAP = {
  cache: 'L1',
  versioned: 'L2',
  autodiscovery: 'L3',
  emergency: 'L4'
};
const VERSION_STATUS_ALARM = 'selector_version_audit';
const VERSION_STATUS_REFRESH_MINUTES = 60 * 24;
const SELECTOR_ELEMENT_TYPES = ['composer', 'sendButton', 'response'];
const SELECTOR_OVERRIDE_AUDIT_KEY = 'selector_override_audit';
const SELECTOR_OVERRIDE_AUDIT_LIMIT = 80;
const SELECTOR_HEALTH_FAILURES_KEY = 'selector_health_failures';
const SELECTOR_HEALTH_META_KEY = 'selector_health_meta';
const SELECTOR_HEALTH_CHECKS_KEY = 'selector_health_checks';
const SELECTOR_HEALTH_PROFILE_KEY = 'selector_health_profile_v1';
const SELECTOR_METRICS_FLUSH_MS = 5000;

const loadResolutionMetrics = async () => {
  try {
    const stored = await chrome.storage.local.get([
      'selectorResolutionMetrics',
      SELECTOR_HEALTH_FAILURES_KEY,
      SELECTOR_HEALTH_META_KEY,
      SELECTOR_HEALTH_CHECKS_KEY
    ]);
    if (stored.selectorResolutionMetrics) {
      Object.entries(stored.selectorResolutionMetrics).forEach(([key, value]) => {
        selectorResolutionMetrics.set(key, Number(value) || 0);
      });
      globalThis.LLMLog?.debug?.('[BACKGROUND] Resolution metrics loaded:', Object.fromEntries(selectorResolutionMetrics.entries()));
    }
    if (stored[SELECTOR_HEALTH_FAILURES_KEY]) {
      Object.assign(selectorFailureMetrics, stored[SELECTOR_HEALTH_FAILURES_KEY]);
    }
    if (stored[SELECTOR_HEALTH_META_KEY]) {
      selectorHealthMeta.updatedAt = stored[SELECTOR_HEALTH_META_KEY].updatedAt || null;
      selectorHealthMeta.perKey = stored[SELECTOR_HEALTH_META_KEY].perKey || {};
    }
    if (stored[SELECTOR_HEALTH_CHECKS_KEY]) {
      Object.assign(selectorHealthChecks, stored[SELECTOR_HEALTH_CHECKS_KEY]);
    }
  } catch (e) {
    console.warn('[BACKGROUND] Failed to load resolution metrics:', e);
  }
};

const persistResolutionMetrics = async () => {
  try {
    await chrome.storage.local.set({
      selectorResolutionMetrics: Object.fromEntries(selectorResolutionMetrics.entries()),
      [SELECTOR_HEALTH_FAILURES_KEY]: selectorFailureMetrics,
      [SELECTOR_HEALTH_META_KEY]: selectorHealthMeta,
      [SELECTOR_HEALTH_CHECKS_KEY]: selectorHealthChecks,
      [SELECTOR_HEALTH_PROFILE_KEY]: buildSelectorHealthProfiles()
    });
  } catch (e) {
    console.warn('[BACKGROUND] Failed to persist resolution metrics:', e);
  }
};

const scheduleSelectorMetricsFlush = () => {
  if (selectorMetricsFlushTimer) return;
  selectorMetricsFlushTimer = setTimeout(() => {
    flushSelectorMetrics(false);
  }, SELECTOR_METRICS_FLUSH_MS);
};

const markSelectorMetricsDirty = () => {
  selectorMetricsDirty = true;
  scheduleSelectorMetricsFlush();
};

const flushSelectorMetrics = async (force = false) => {
  if (!force && !selectorMetricsDirty) return;
  if (selectorMetricsFlushInFlight) return;
  if (selectorMetricsFlushTimer) {
    clearTimeout(selectorMetricsFlushTimer);
    selectorMetricsFlushTimer = null;
  }
  selectorMetricsDirty = false;
  selectorMetricsFlushInFlight = true;
  try {
    await persistResolutionMetrics();
  } finally {
    selectorMetricsFlushInFlight = false;
  }
};

const buildSelectorHealthKey = (modelName, elementType) => `${modelName}::${elementType}`;

const touchSelectorHealthMeta = (modelName, elementType, ts = Date.now()) => {
  selectorHealthMeta.updatedAt = ts;
  if (!selectorHealthMeta.perKey || typeof selectorHealthMeta.perKey !== 'object') {
    selectorHealthMeta.perKey = {};
  }
  if (modelName && elementType) {
    const key = buildSelectorHealthKey(modelName, elementType);
    selectorHealthMeta.perKey[key] = ts;
  }
  return ts;
};

const recordResolutionMetric = async ({ modelName, elementType, layer }) => {
  if (!modelName || !elementType || !layer) return;
  const level = RESOLUTION_LAYER_MAP[layer] || layer;
  const key = `${modelName}_${elementType}_${level}`;
  const current = selectorResolutionMetrics.get(key) || 0;
  selectorResolutionMetrics.set(key, current + 1);
  touchSelectorHealthMeta(modelName, elementType);
  appendLogEntry(modelName, {
    type: 'SELECTOR',
    label: `${elementType}: layer ${level}`,
    details: '',
    level: level === 'L4' ? 'warning' : 'info',
    meta: { elementType, layer: level }
  });
  markSelectorMetricsDirty();
};

const recordSelectorFailureMetric = async ({ modelName, elementType, event }) => {
  if (!modelName || !elementType || !event) return;
  const status = event === 'selector_search_error' ? 'error' : 'fail';
  const key = `${modelName}_${elementType}_${status}`;
  selectorFailureMetrics[key] = (selectorFailureMetrics[key] || 0) + 1;
  touchSelectorHealthMeta(modelName, elementType);
  markSelectorMetricsDirty();
};

const updateSelectorHealthChecks = async (modelName, report = []) => {
  if (!modelName || !Array.isArray(report) || !report.length) return;
  const ts = Date.now();
  report.forEach((entry) => {
    if (!entry?.elementType) return;
    const key = buildSelectorHealthKey(modelName, entry.elementType);
    selectorHealthChecks[key] = {
      ts,
      success: !!entry.success,
      layer: entry.layer || null,
      selector: entry.selector || null,
      error: entry.error || null
    };
    touchSelectorHealthMeta(modelName, entry.elementType, ts);
  });
  markSelectorMetricsDirty();
};

const parseSelectorMetricKey = (key) => {
  const parts = String(key || '').split('_');
  if (parts.length < 3) return null;
  const suffix = parts.pop();
  const elementType = parts.pop();
  const modelName = parts.join('_') || 'unknown';
  return { modelName, elementType, suffix };
};

const parseSelectorHealthKey = (key) => {
  const [modelName = 'unknown', elementType = 'unknown'] = String(key || '').split('::');
  return { modelName, elementType };
};

const ensureSelectorHealthEntry = (map, modelName, elementType) => {
  const key = buildSelectorHealthKey(modelName, elementType);
  if (map.has(key)) return map.get(key);
  const entry = {
    modelName,
    elementType,
    counts: { L1: 0, L2: 0, L3: 0, L4: 0, fail: 0, error: 0, total: 0 },
    lastOverride: null,
    lastHealthCheck: null,
    activeUiVersion: null,
    activeTabId: null,
    lastUpdatedAt: null
  };
  map.set(key, entry);
  return entry;
};

const classifySelectorHealthStatus = (entry = {}) => {
  const counts = entry.counts || {};
  const hits = Number(counts.L1 || 0) + Number(counts.L2 || 0) + Number(counts.L3 || 0) + Number(counts.L4 || 0);
  const failures = Number(counts.fail || 0) + Number(counts.error || 0);
  const total = hits + failures;
  const fallbackHits = Number(counts.L3 || 0) + Number(counts.L4 || 0);
  const failedHealthCheck = entry.lastHealthCheck && entry.lastHealthCheck.success === false;
  if (!total && !entry.lastHealthCheck) return 'unknown';
  if ((total >= 3 && hits === 0 && failures >= 3) || (failedHealthCheck && failures >= 3)) {
    return 'broken';
  }
  if ((total >= 4 && failures / total >= 0.5) || (total >= 4 && fallbackHits / total >= 0.5) || failedHealthCheck) {
    return 'degraded';
  }
  return 'healthy';
};

const buildSelectorHealthProfiles = () => {
  const profileMap = new Map();
  Array.from(selectorResolutionMetrics.entries()).forEach(([key, count]) => {
    const parsed = parseSelectorMetricKey(key);
    if (!parsed) return;
    const entry = ensureSelectorHealthEntry(profileMap, parsed.modelName, parsed.elementType);
    if (['L1', 'L2', 'L3', 'L4'].includes(parsed.suffix)) {
      entry.counts[parsed.suffix] += Number(count || 0);
    }
  });
  Object.entries(selectorFailureMetrics).forEach(([key, count]) => {
    const parsed = parseSelectorMetricKey(key);
    if (!parsed) return;
    if (parsed.suffix !== 'fail' && parsed.suffix !== 'error') return;
    const entry = ensureSelectorHealthEntry(profileMap, parsed.modelName, parsed.elementType);
    entry.counts[parsed.suffix] += Number(count || 0);
  });
  Object.entries(selectorHealthChecks).forEach(([key, check]) => {
    const parsed = parseSelectorHealthKey(key);
    const entry = ensureSelectorHealthEntry(profileMap, parsed.modelName, parsed.elementType);
    entry.lastHealthCheck = {
      ts: check?.ts || null,
      success: !!check?.success,
      layer: check?.layer || null,
      error: check?.error || null
    };
  });
  const profiles = {};
  profileMap.forEach((entry) => {
    const key = buildSelectorHealthKey(entry.modelName, entry.elementType);
    const counts = entry.counts || {};
    const hits = Number(counts.L1 || 0) + Number(counts.L2 || 0) + Number(counts.L3 || 0) + Number(counts.L4 || 0);
    const failures = Number(counts.fail || 0) + Number(counts.error || 0);
    profiles[key] = {
      modelName: entry.modelName,
      elementType: entry.elementType,
      profileStatus: classifySelectorHealthStatus(entry),
      hits,
      failures,
      total: hits + failures,
      counts: { ...counts },
      lastHealthCheck: entry.lastHealthCheck || null,
      updatedAt: selectorHealthMeta.perKey?.[key] || selectorHealthMeta.updatedAt || Date.now()
    };
  });
  return {
    updatedAt: selectorHealthMeta.updatedAt || Date.now(),
    profiles
  };
};

const detectActiveUiVersionOnTab = async (modelName, tabId) => {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (model) => {
        if (!window.SelectorConfig || typeof window.SelectorConfig.detectUIVersion !== 'function') {
          return { ok: false, error: 'SelectorConfig unavailable' };
        }
        const version = window.SelectorConfig.detectUIVersion(model, document) || 'unknown';
        return { ok: true, version };
      },
      args: [modelName]
    });
    if (result?.result?.ok) {
      return { ok: true, modelName, tabId, version: result.result.version || 'unknown' };
    }
    return { ok: false, modelName, tabId, error: result?.result?.error || 'active_version_failed' };
  } catch (err) {
    return { ok: false, modelName, tabId, error: err?.message || 'active_version_failed' };
  }
};

const fetchActiveUiVersions = async () => {
  const pairs = TabMapManager.entries();
  if (!pairs.length) return {};
  const results = await Promise.all(pairs.map(([modelName, tabId]) => detectActiveUiVersionOnTab(modelName, tabId)));
  const map = {};
  results.forEach((entry) => {
    if (entry?.ok) {
      map[entry.modelName] = { version: entry.version, tabId: entry.tabId };
    }
  });
  return map;
};

const buildSelectorHealthSummary = async ({ includeActiveVersions = false } = {}) => {
  const summaryMap = new Map();
  let latestOverrideTs = 0;
  let latestHealthCheckTs = 0;

  Array.from(selectorResolutionMetrics.entries()).forEach(([key, count]) => {
    const parsed = parseSelectorMetricKey(key);
    if (!parsed) return;
    const entry = ensureSelectorHealthEntry(summaryMap, parsed.modelName, parsed.elementType);
    if (['L1', 'L2', 'L3', 'L4'].includes(parsed.suffix)) {
      entry.counts[parsed.suffix] += Number(count || 0);
    }
  });

  Object.entries(selectorFailureMetrics).forEach(([key, count]) => {
    const parsed = parseSelectorMetricKey(key);
    if (!parsed) return;
    if (parsed.suffix !== 'fail' && parsed.suffix !== 'error') return;
    const entry = ensureSelectorHealthEntry(summaryMap, parsed.modelName, parsed.elementType);
    entry.counts[parsed.suffix] += Number(count || 0);
  });

  const overrides = await readSelectorOverrideAudit(SELECTOR_OVERRIDE_AUDIT_LIMIT);
  overrides.forEach((entry) => {
    const modelName = entry.modelName || 'unknown';
    const elementType = entry.elementType || 'unknown';
    const summaryEntry = ensureSelectorHealthEntry(summaryMap, modelName, elementType);
    if (!summaryEntry.lastOverride) {
      summaryEntry.lastOverride = {
        ts: entry.ts || null,
        reason: entry.reason || '',
        selector: entry.selector || ''
      };
    }
    if (entry.ts) latestOverrideTs = Math.max(latestOverrideTs, entry.ts);
  });

  Object.entries(selectorHealthChecks).forEach(([key, entry]) => {
    const parsed = parseSelectorHealthKey(key);
    const summaryEntry = ensureSelectorHealthEntry(summaryMap, parsed.modelName, parsed.elementType);
    summaryEntry.lastHealthCheck = {
      ts: entry?.ts || null,
      success: !!entry?.success,
      layer: entry?.layer || null,
      error: entry?.error || null
    };
    if (entry?.ts) latestHealthCheckTs = Math.max(latestHealthCheckTs, entry.ts);
  });

  const activeVersions = includeActiveVersions ? await fetchActiveUiVersions() : {};
  summaryMap.forEach((entry) => {
    const activeMeta = activeVersions[entry.modelName];
    if (activeMeta) {
      entry.activeUiVersion = activeMeta.version || 'unknown';
      entry.activeTabId = activeMeta.tabId || null;
    }
    const key = buildSelectorHealthKey(entry.modelName, entry.elementType);
    entry.lastUpdatedAt = selectorHealthMeta.perKey?.[key] || null;
    entry.counts.total = entry.counts.L1 + entry.counts.L2 + entry.counts.L3 + entry.counts.L4 + entry.counts.fail + entry.counts.error;
  });

  const rows = Array.from(summaryMap.values()).sort((a, b) => {
    const byModel = a.modelName.localeCompare(b.modelName);
    if (byModel !== 0) return byModel;
    const order = { composer: 1, sendButton: 2, response: 3 };
    return (order[a.elementType] || 99) - (order[b.elementType] || 99);
  });
  const totalSamples = rows.reduce((acc, row) => acc + (row.counts.total || 0), 0);
  const updatedAt = Math.max(selectorHealthMeta.updatedAt || 0, latestOverrideTs, latestHealthCheckTs) || null;
  return { updatedAt, totalSamples, rows };
};

const getStoredVersionStatus = async () => {
  try {
    const { selectors_version_status } = await chrome.storage.local.get('selectors_version_status');
    return selectors_version_status || null;
  } catch (err) {
    console.warn('[BACKGROUND] Failed to read version status snapshot', err);
    return null;
  }
};

const updateVersionStatusSnapshot = async () => {
  if (!self.SelectorConfig?.getAllVersionStatuses) {
    console.warn('[BACKGROUND] SelectorConfig not ready for version snapshot');
    return null;
  }
  const snapshot = {
    updatedAt: Date.now(),
    data: self.SelectorConfig.getAllVersionStatuses()
  };
  try {
    await chrome.storage.local.set({ selectors_version_status: snapshot });
  } catch (err) {
    console.warn('[BACKGROUND] Failed to persist version status snapshot', err);
  }
  return snapshot;
};

const primeVersionStatusAudit = async () => {
  await updateVersionStatusSnapshot();
  chrome.alarms.create(VERSION_STATUS_ALARM, { periodInMinutes: VERSION_STATUS_REFRESH_MINUTES });
};

const clearSelectorCache = async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith('selector_cache'));
    if (keys.length) {
      await chrome.storage.local.remove(keys);
    }
    return keys.length;
  } catch (err) {
    console.warn('[BACKGROUND] Failed to clear selector cache', err);
    throw err;
  }
};

const runSelectorHealthCheckForTab = async (llmName, tabId) => {
  try {
    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (model) => {
        if (!window.SelectorFinder || typeof window.SelectorFinder.healthCheck !== 'function') {
          return { ok: false, error: 'SelectorFinder.healthCheck unavailable' };
        }
        const report = await window.SelectorFinder.healthCheck({ modelName: model });
        return { ok: true, report };
      },
      args: [llmName]
    });
    return { llmName, tabId, ...(injectionResult?.result || { ok: false, error: 'No result' }) };
  } catch (err) {
    return { llmName, tabId, ok: false, error: err?.message || 'Execution failed' };
  }
};

const saveManualSelectorOverride = async (modelName, elementType, selector) => {
  if (!modelName || !elementType || !selector) {
    throw new Error('Invalid override payload');
  }
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    throw new Error('Selector is empty');
  }
  const { selectors_remote_override } = await chrome.storage.local.get('selectors_remote_override');
  const payload = selectors_remote_override || {};
  const manualOverrides = payload.manualOverrides || {};
  manualOverrides[modelName] = manualOverrides[modelName] || {};
  const bucket = Array.isArray(manualOverrides[modelName][elementType])
    ? manualOverrides[modelName][elementType]
    : [];
  if (!bucket.includes(trimmedSelector)) {
    bucket.unshift(trimmedSelector);
  }
  manualOverrides[modelName][elementType] = bucket.slice(0, 10);
  payload.manualOverrides = manualOverrides;
  await chrome.storage.local.set({ selectors_remote_override: payload });
  return manualOverrides;
};

const appendSelectorOverrideAudit = async (entry = {}) => {
  const payload = {
    ts: entry.ts || Date.now(),
    modelName: entry.modelName || 'unknown',
    elementType: entry.elementType || 'unknown',
    selector: entry.selector || '',
    reason: entry.reason || '',
    extVersion: entry.extVersion || chrome.runtime.getManifest()?.version || '',
    source: entry.source || 'devtools'
  };
  const res = await chrome.storage.local.get(SELECTOR_OVERRIDE_AUDIT_KEY);
  const list = Array.isArray(res?.[SELECTOR_OVERRIDE_AUDIT_KEY]) ? res[SELECTOR_OVERRIDE_AUDIT_KEY] : [];
  const next = [...list, payload].slice(-SELECTOR_OVERRIDE_AUDIT_LIMIT);
  await chrome.storage.local.set({ [SELECTOR_OVERRIDE_AUDIT_KEY]: next });
  return next;
};

const readSelectorOverrideAudit = async (limit = SELECTOR_OVERRIDE_AUDIT_LIMIT) => {
  const res = await chrome.storage.local.get(SELECTOR_OVERRIDE_AUDIT_KEY);
  const list = Array.isArray(res?.[SELECTOR_OVERRIDE_AUDIT_KEY]) ? res[SELECTOR_OVERRIDE_AUDIT_KEY] : [];
  if (limit && Number.isFinite(limit)) {
    return list.slice(-limit).reverse();
  }
  return list.slice().reverse();
};

const validateSelectorsOnTab = async (tabId, selectors = []) => {
  const list = Array.isArray(selectors) ? selectors.filter(Boolean) : [];
  if (!tabId || !list.length) return { ok: false, error: 'invalid_payload' };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (items) => {
        const safeText = (value, limit = 120) => {
          const text = String(value || '').replace(/\s+/g, ' ').trim();
          return text.length > limit ? `${text.slice(0, limit)}…` : text;
        };
        const results = (items || []).map((selector) => {
          if (!selector || typeof selector !== 'string') {
            return { selector, matches: 0, error: 'invalid_selector' };
          }
          try {
            const nodes = Array.from(document.querySelectorAll(selector));
            const sample = nodes[0];
            return {
              selector,
              matches: nodes.length,
              sample: sample
                ? { tag: sample.tagName || '', text: safeText(sample.textContent || sample.innerText || '') }
                : null
            };
          } catch (err) {
            return { selector, matches: 0, error: err?.message || 'query_failed' };
          }
        });
        return { ok: true, results };
      },
      args: [list]
    });
    return result?.result || { ok: false, error: 'no_result' };
  } catch (err) {
    return { ok: false, error: err?.message || 'execution_failed' };
  }
};

self.RESOLUTION_LAYER_MAP = RESOLUTION_LAYER_MAP;
self.VERSION_STATUS_ALARM = VERSION_STATUS_ALARM;
self.VERSION_STATUS_REFRESH_MINUTES = VERSION_STATUS_REFRESH_MINUTES;
self.SELECTOR_ELEMENT_TYPES = SELECTOR_ELEMENT_TYPES;
self.SELECTOR_OVERRIDE_AUDIT_KEY = SELECTOR_OVERRIDE_AUDIT_KEY;
self.SELECTOR_OVERRIDE_AUDIT_LIMIT = SELECTOR_OVERRIDE_AUDIT_LIMIT;
self.SELECTOR_HEALTH_FAILURES_KEY = SELECTOR_HEALTH_FAILURES_KEY;
self.SELECTOR_HEALTH_META_KEY = SELECTOR_HEALTH_META_KEY;
self.SELECTOR_HEALTH_CHECKS_KEY = SELECTOR_HEALTH_CHECKS_KEY;
self.SELECTOR_HEALTH_PROFILE_KEY = SELECTOR_HEALTH_PROFILE_KEY;
self.SELECTOR_METRICS_FLUSH_MS = SELECTOR_METRICS_FLUSH_MS;
self.loadResolutionMetrics = loadResolutionMetrics;
self.persistResolutionMetrics = persistResolutionMetrics;
self.scheduleSelectorMetricsFlush = scheduleSelectorMetricsFlush;
self.markSelectorMetricsDirty = markSelectorMetricsDirty;
self.flushSelectorMetrics = flushSelectorMetrics;
self.buildSelectorHealthKey = buildSelectorHealthKey;
self.touchSelectorHealthMeta = touchSelectorHealthMeta;
self.recordResolutionMetric = recordResolutionMetric;
self.recordSelectorFailureMetric = recordSelectorFailureMetric;
self.updateSelectorHealthChecks = updateSelectorHealthChecks;
self.parseSelectorMetricKey = parseSelectorMetricKey;
self.parseSelectorHealthKey = parseSelectorHealthKey;
self.ensureSelectorHealthEntry = ensureSelectorHealthEntry;
self.classifySelectorHealthStatus = classifySelectorHealthStatus;
self.buildSelectorHealthProfiles = buildSelectorHealthProfiles;
self.detectActiveUiVersionOnTab = detectActiveUiVersionOnTab;
self.fetchActiveUiVersions = fetchActiveUiVersions;
self.buildSelectorHealthSummary = buildSelectorHealthSummary;
self.getStoredVersionStatus = getStoredVersionStatus;
self.updateVersionStatusSnapshot = updateVersionStatusSnapshot;
self.primeVersionStatusAudit = primeVersionStatusAudit;
self.clearSelectorCache = clearSelectorCache;
self.runSelectorHealthCheckForTab = runSelectorHealthCheckForTab;
self.saveManualSelectorOverride = saveManualSelectorOverride;
self.appendSelectorOverrideAudit = appendSelectorOverrideAudit;
self.readSelectorOverrideAudit = readSelectorOverrideAudit;
self.validateSelectorsOnTab = validateSelectorsOnTab;

// background/remote-selectors.js
// Remote selectors override fetch + alarms.

'use strict';

const REMOTE_SELECTORS_URL = 'https://algold777.github.io/llm-selectors-override/selectors-override.json';
const REMOTE_SELECTORS_ENABLED = false; // защищаемся по умолчанию: только opt-in
const REMOTE_SELECTORS_FLAG_KEY = 'enable_remote_selectors_override';
const REMOTE_SELECTORS_REFRESH_MS = 6 * 60 * 60 * 1000;
const REMOTE_SELECTORS_ALARM = 'remote_selectors_refresh';
const REMOTE_SELECTORS_FETCH_TIMEOUT_MS = 15000;
// Public key for verifying selectors-override signatures (ECDSA P-256).
// The private key is kept OUTSIDE the repository; see scripts/sign-selectors.js.
const REMOTE_SELECTORS_PUBLIC_KEY_JWK = null; // TODO(release): paste JWK object before enabling the feature

var remoteSelectorsAllowed = REMOTE_SELECTORS_ENABLED;

chrome.storage.local.get(REMOTE_SELECTORS_FLAG_KEY, (data) => {
  if (typeof data?.[REMOTE_SELECTORS_FLAG_KEY] === 'boolean') {
    remoteSelectorsAllowed = data[REMOTE_SELECTORS_FLAG_KEY];
  }
  self.remoteSelectorsAllowed = remoteSelectorsAllowed;
  if (remoteSelectorsAllowed) {
    fetchRemoteSelectors().catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[REMOTE_SELECTORS_FLAG_KEY]) {
    remoteSelectorsAllowed = !!changes[REMOTE_SELECTORS_FLAG_KEY].newValue;
    self.remoteSelectorsAllowed = remoteSelectorsAllowed;
    if (remoteSelectorsAllowed) {
      fetchRemoteSelectors().catch(() => {});
    }
  }
});

async function fetchRemoteSelectors() {
  if (!remoteSelectorsAllowed) {
    globalThis.LLMLog?.info?.('[REMOTE-SELECTORS] Skipped: remote overrides disabled');
    return { success: false, error: 'remote_overrides_disabled' };
  }
  if (!REMOTE_SELECTORS_URL) {
    return { success: false, error: 'REMOTE_SELECTORS_URL not configured' };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REMOTE_SELECTORS_FETCH_TIMEOUT_MS);
    const response = await fetch(REMOTE_SELECTORS_URL, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payloadText = await response.text();
    const envelope = JSON.parse(payloadText);
    if (envelope?.format !== 'selectors-override.signed.v1' || !envelope.payloadB64 || !envelope.signatureB64) {
      throw new Error('Invalid signed override envelope');
    }
    const verdict = await verifySelectorsSignature(envelope.payloadB64, envelope.signatureB64);
    if (!verdict.ok) {
      console.error('[REMOTE-SELECTORS] Signature verification failed:', verdict.error);
      await chrome.storage.local.remove(['selectors_remote_override', 'selectors_remote_fetched_at', 'selectors_remote_override_hash']);
      throw new Error(`Override signature rejected (${verdict.error})`);
    }
    const decodedText = new TextDecoder().decode(base64ToBytes(envelope.payloadB64));
    const data = JSON.parse(decodedText);
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid selectors override payload');
    }
    await chrome.storage.local.set({
      selectors_remote_override: data,
      selectors_remote_fetched_at: Date.now()
    });
    globalThis.LLMLog?.info?.('[REMOTE-SELECTORS] Override stored successfully');
    return { success: true };
  } catch (error) {
    console.warn('[REMOTE-SELECTORS] Fetch failed:', error?.message || error);
    return { success: false, error: error?.message || 'fetch failed' };
  }
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifySelectorsSignature(payloadB64, signatureB64) {
  if (!REMOTE_SELECTORS_PUBLIC_KEY_JWK) return { ok: false, error: 'public_key_not_configured' };
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      REMOTE_SELECTORS_PUBLIC_KEY_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64ToBytes(signatureB64),
      base64ToBytes(payloadB64)
    );
    return valid ? { ok: true } : { ok: false, error: 'signature_invalid' };
  } catch (err) {
    return { ok: false, error: err?.message || 'verify_failed' };
  }
}

async function clearSelectorOverridesAndCache() {
  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((key) => {
    return key === 'selectors_remote_override' ||
      key === 'selectors_remote_fetched_at' ||
      key === 'selectors_remote_override_hash' ||
      key.startsWith('selector_cache_');
  });
  if (keysToRemove.length) {
    await chrome.storage.local.remove(keysToRemove);
  }
  globalThis.LLMLog?.info?.('[REMOTE-SELECTORS] Overrides/cache cleared:', keysToRemove);
  return { success: true, removed: keysToRemove };
}

if (remoteSelectorsAllowed) {
  fetchRemoteSelectors();
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    if (remoteSelectorsAllowed) {
      chrome.alarms.create(REMOTE_SELECTORS_ALARM, { periodInMinutes: REMOTE_SELECTORS_REFRESH_MS / 60000 });
      fetchRemoteSelectors();
    } else {
      chrome.alarms.clear(REMOTE_SELECTORS_ALARM);
    }
  }
});

chrome.runtime.onStartup.addListener(() => {
  if (remoteSelectorsAllowed) {
    chrome.alarms.create(REMOTE_SELECTORS_ALARM, { periodInMinutes: REMOTE_SELECTORS_REFRESH_MS / 60000 });
    fetchRemoteSelectors();
  } else {
    chrome.alarms.clear(REMOTE_SELECTORS_ALARM);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMOTE_SELECTORS_ALARM) {
    if (remoteSelectorsAllowed) {
      fetchRemoteSelectors();
    }
  }
});

self.REMOTE_SELECTORS_URL = REMOTE_SELECTORS_URL;
self.REMOTE_SELECTORS_ENABLED = REMOTE_SELECTORS_ENABLED;
self.REMOTE_SELECTORS_FLAG_KEY = REMOTE_SELECTORS_FLAG_KEY;
self.REMOTE_SELECTORS_PUBLIC_KEY_JWK = REMOTE_SELECTORS_PUBLIC_KEY_JWK;
self.REMOTE_SELECTORS_REFRESH_MS = REMOTE_SELECTORS_REFRESH_MS;
self.REMOTE_SELECTORS_ALARM = REMOTE_SELECTORS_ALARM;
self.REMOTE_SELECTORS_FETCH_TIMEOUT_MS = REMOTE_SELECTORS_FETCH_TIMEOUT_MS;
self.remoteSelectorsAllowed = remoteSelectorsAllowed;
self.fetchRemoteSelectors = fetchRemoteSelectors;
self.verifySelectorsSignature = verifySelectorsSignature;
self.clearSelectorOverridesAndCache = clearSelectorOverridesAndCache;

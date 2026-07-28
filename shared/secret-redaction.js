// shared/secret-redaction.js
// Defense-in-depth secret scrubbing for any data that leaves the extension
// (telemetry/JSON/markdown exports, copied diagnostics, logs).
//
// The codebase already *intends* not to log raw API keys (see README "Telemetry
// And Diagnostics" + utils/api-key-storage.js), but that was a convention with
// no enforcement. This module is the enforcement layer: a pure, deep redactor
// that masks (a) values stored under secret-looking field/storage-key names and
// (b) provider key/token shapes wherever they appear inside free-text strings.
//
// It is intentionally conservative about *structure* (never throws, returns a
// safe copy, preserves shape) and aggressive about *secrets* (better to mask a
// false positive in an export than to leak a key). Pure and dual-context so it
// is unit-testable and usable from background, content, and the results UI.

(function initSecretRedaction(root) {
  'use strict';

  const MASK = '[REDACTED]';

  // Field / storage-key names whose *entire value* must be masked, matched
  // case-insensitively as a substring (so `openaiApiKey`, `x-api-key`,
  // `__api_session__openai`, `authorization` all match).
  const SECRET_KEY_FRAGMENTS = [
    'apikey', 'api_key', 'api-key',
    'authorization', 'auth_token', 'authtoken',
    'accesstoken', 'access_token',
    'refreshtoken', 'refresh_token',
    'secret', 'password', 'passphrase',
    'cookie', 'set-cookie',
    'bearer',
    'client_secret', 'clientsecret',
    'private_key', 'privatekey',
    '__api_session__', '__api_enc__', '__api_plaintext_warned__',
    'session_token', 'sessiontoken', 'csrf'
  ];

  // Provider key/token shapes that must be masked anywhere inside free text.
  // Ordered longest/most-specific first so e.g. `sk-ant-` is masked as a whole.
  const SECRET_VALUE_PATTERNS = [
    /\bsk-ant-[A-Za-z0-9_-]{8,}/g,            // Anthropic
    /\bsk-proj-[A-Za-z0-9_-]{8,}/g,           // OpenAI project keys
    /\bsk-[A-Za-z0-9_-]{16,}/g,               // OpenAI / DeepSeek classic
    /\bxai-[A-Za-z0-9_-]{16,}/g,              // xAI / Grok
    /\bAIza[A-Za-z0-9_-]{20,}/g,              // Google API keys
    /\bgsk_[A-Za-z0-9_-]{16,}/g,              // misc provider style
    /\bpplx-[A-Za-z0-9_-]{16,}/g,             // Perplexity
    /\bds-[A-Za-z0-9_-]{20,}/g,               // DeepSeek alt
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/g, // JWT
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi    // Authorization: Bearer <token>
  ];

  const isSecretKeyName = (key) => {
    const lower = String(key || '').toLowerCase();
    if (!lower) return false;
    return SECRET_KEY_FRAGMENTS.some((frag) => lower.includes(frag));
  };

  const redactString = (value) => {
    let out = String(value);
    for (const pattern of SECRET_VALUE_PATTERNS) {
      out = out.replace(pattern, MASK);
    }
    return out;
  };

  // Deep-clone with redaction. Guards against cycles and runaway depth so it is
  // safe to call on arbitrary telemetry payloads right before serialization.
  const redactDeep = (input, options = {}) => {
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 12;
    const seen = new WeakSet();

    const walk = (value, depth) => {
      if (value == null) return value;
      const type = typeof value;
      if (type === 'string') return redactString(value);
      if (type === 'number' || type === 'boolean' || type === 'bigint') return value;
      if (type === 'function' || type === 'symbol') return undefined;
      if (depth >= maxDepth) return '[TRUNCATED]';

      if (Array.isArray(value)) {
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);
        return value.map((item) => walk(item, depth + 1));
      }

      if (type === 'object') {
        // Non-plain objects (Date, Map, etc.) — stringify defensively.
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          try { return redactString(JSON.stringify(value)); }
          catch (_) { return MASK; }
        }
        if (seen.has(value)) return '[CIRCULAR]';
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value)) {
          if (isSecretKeyName(key)) {
            out[key] = value[key] == null ? value[key] : MASK;
          } else {
            out[key] = walk(value[key], depth + 1);
          }
        }
        return out;
      }
      return value;
    };

    return walk(input, 0);
  };

  // Convenience: redact then JSON.stringify in one safe step.
  const stringifySafe = (input, space) => {
    try {
      return JSON.stringify(redactDeep(input), null, space);
    } catch (_) {
      try { return JSON.stringify({ error: 'serialization_failed' }, null, space); }
      catch (__) { return '{}'; }
    }
  };

  const api = Object.freeze({
    MASK,
    isSecretKeyName,
    redactString,
    redactDeep,
    stringifySafe,
    SECRET_KEY_FRAGMENTS: Object.freeze([...SECRET_KEY_FRAGMENTS]),
    SECRET_VALUE_PATTERNS: Object.freeze(SECRET_VALUE_PATTERNS.map((re) => re.source))
  });

  root.SecretRedaction = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

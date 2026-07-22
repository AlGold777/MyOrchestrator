// shared/transport-policy.js
// Explicit transport selection contract for API-first vs web-UI automation.

(function initTransportPolicy(root) {
  'use strict';

  const MODES = Object.freeze({
    API_FIRST: 'api_first',
    WEB_UI: 'web_ui',
    API_UNAVAILABLE: 'api_unavailable',
    BLOCKED: 'blocked'
  });

  function normalizeModelName(llmName = '') {
    if (root.ModelPolicy?.normalizeModelName) {
      return root.ModelPolicy.normalizeModelName(llmName);
    }
    const value = String(llmName || '').trim();
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower === 'lechat' || lower === 'le chat') return 'Le Chat';
    if (lower === 'chatgpt' || lower === 'openai') return 'GPT';
    if (lower === 'pplx') return 'Perplexity';
    return value;
  }

  function getPolicy(llmName) {
    return root.ModelPolicy?.getModelPolicy
      ? root.ModelPolicy.getModelPolicy(llmName)
      : {};
  }

  function decideTransport(input = {}) {
    const llmName = normalizeModelName(input.llmName);
    const policy = getPolicy(llmName);
    const apiModeEnabled = input.apiModeEnabled !== false;
    const hasApiConfig = input.hasApiConfig === true;
    const hasApiKey = input.hasApiKey === true;
    const hasWebUi = input.hasWebUi !== false;
    const attachmentsCount = Number(input.attachmentsCount || 0) || 0;
    const apiDirectAllowed = policy.apiDirectAllowed !== false;
    const apiSupportsAttachments = policy.apiSupportsAttachments === true;

    const base = {
      schemaVersion: 1,
      llmName,
      mode: MODES.WEB_UI,
      reason: 'web_ui_default',
      apiEligible: false,
      webUiEligible: hasWebUi,
      apiModeEnabled,
      hasApiConfig,
      hasApiKey,
      attachmentsCount,
      apiDirectAllowed,
      apiSupportsAttachments,
      preferredTransport: policy.preferredTransport || 'web_ui'
    };

    if (input.forceWebUi === true) {
      return { ...base, mode: MODES.WEB_UI, reason: 'force_web_ui' };
    }
    if (!hasWebUi && !hasApiConfig) {
      return { ...base, mode: MODES.BLOCKED, reason: 'no_transport_available', webUiEligible: false };
    }
    if (!apiModeEnabled) {
      return { ...base, mode: hasWebUi ? MODES.WEB_UI : MODES.BLOCKED, reason: hasWebUi ? 'api_mode_disabled' : 'api_disabled_no_web_ui' };
    }
    if (!hasApiConfig) {
      return { ...base, mode: hasWebUi ? MODES.WEB_UI : MODES.BLOCKED, reason: hasWebUi ? 'api_config_missing' : 'api_config_missing_no_web_ui' };
    }
    if (!apiDirectAllowed) {
      return { ...base, mode: hasWebUi ? MODES.WEB_UI : MODES.BLOCKED, reason: hasWebUi ? 'api_direct_disallowed_by_policy' : 'api_direct_disallowed_no_web_ui' };
    }
    if (attachmentsCount > 0 && !apiSupportsAttachments) {
      return { ...base, mode: hasWebUi ? MODES.WEB_UI : MODES.BLOCKED, reason: hasWebUi ? 'api_attachments_unsupported' : 'api_attachments_unsupported_no_web_ui' };
    }
    if (!hasApiKey) {
      return { ...base, mode: hasWebUi ? MODES.WEB_UI : MODES.API_UNAVAILABLE, reason: hasWebUi ? 'api_key_missing_use_web_ui' : 'api_key_missing' };
    }
    return {
      ...base,
      mode: MODES.API_FIRST,
      reason: 'api_key_available',
      apiEligible: true
    };
  }

  function isApiTransportEnabled(flagValue) {
    return flagValue === true;
  }

  // --- Per-model prompt map (Triad waves / graph-mode waves) -----------------
  // One batch can carry a model -> individual prompt map. Names are normalized
  // to stable uppercase keys; missing or blank entries fall back to the shared
  // prompt so callers never dispatch a model with empty text by accident.
  function sanitizePromptsByModel(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const map = {};
    Object.entries(raw).forEach(([name, text]) => {
      const key = String(name || '').trim().toUpperCase();
      const value = typeof text === 'string' ? text : '';
      if (key && value.trim()) map[key] = value;
    });
    return Object.keys(map).length ? map : null;
  }

  function resolvePromptForModel(promptsByModel, llmName, fallbackPrompt) {
    const key = String(llmName || '').trim().toUpperCase();
    const mapped = promptsByModel && typeof promptsByModel === 'object'
      ? promptsByModel[key]
      : '';
    return (typeof mapped === 'string' && mapped.trim()) ? mapped : fallbackPrompt;
  }

  const api = Object.freeze({
    MODES,
    normalizeModelName,
    decideTransport,
    isApiTransportEnabled,
    sanitizePromptsByModel,
    resolvePromptForModel
  });

  root.TransportPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

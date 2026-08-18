// shared/model-policy.js
// Minimal runtime policy for model-specific orchestration decisions.

(function initModelPolicy(root) {
  'use strict';

  const DEFAULT_POLICY = Object.freeze({
    stableTextMs: 1200,
    terminalFailureRequiresEvidenceMiss: true,
    extractionPriority: Object.freeze(['preserved', 'snapshot', 'inlineDom', 'contentScript']),
    requireAckReady: true,
    transportErrorsRecoverable: true,
    conservativeDispatch: false,
    promptSubmitTimeoutMs: 15000,
    preferredTransport: 'web_ui',
    apiDirectAllowed: true,
    apiSupportsAttachments: false,
    supportsSendOnlyRecovery: true
  });

  const MODEL_POLICIES = Object.freeze({
    GPT: Object.freeze({
      promptSubmitTimeoutMs: 15000
    }),
    Gemini: Object.freeze({
      stableTextMs: 1800,
      promptSubmitTimeoutMs: 20000
    }),
    Claude: Object.freeze({
      stableTextMs: 1800,
      promptSubmitTimeoutMs: 20000
    }),
    Grok: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000,
      supportsSendOnlyRecovery: true
    }),
    'Le Chat': Object.freeze({
      stableTextMs: 1600,
      promptSubmitTimeoutMs: 20000
    }),
    Qwen: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000
    }),
    DeepSeek: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 22000
    }),
    Perplexity: Object.freeze({
      stableTextMs: 1600,
      requireAckReady: false,
      // 8s was aggressive and produced false submit-retries on slow loads.
      promptSubmitTimeoutMs: 12000,
      supportsSendOnlyRecovery: true
    }),
    'Z.ai': Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000,
      apiDirectAllowed: false
    }),
    Kimi: Object.freeze({
      stableTextMs: 1800,
      conservativeDispatch: true,
      promptSubmitTimeoutMs: 20000,
      apiDirectAllowed: false
    })
  });

  function normalizeModelName(llmName = '') {
    const value = String(llmName || '').trim();
    if (!value) return '';
    const lower = value.toLowerCase();
    if (lower === 'lechat' || lower === 'le chat') return 'Le Chat';
    if (lower === 'chatgpt' || lower === 'openai') return 'GPT';
    if (lower === 'pplx') return 'Perplexity';
    if (lower === 'zai' || lower === 'z.ai') return 'Z.ai';
    if (lower === 'kimi' || lower === 'moonshot') return 'Kimi';
    return value;
  }

  function getModelPolicy(llmName = '') {
    const key = normalizeModelName(llmName);
    return Object.freeze({
      ...DEFAULT_POLICY,
      ...(MODEL_POLICIES[key] || {})
    });
  }

  function getModelPolicyValue(llmName, field, fallback = undefined) {
    const policy = getModelPolicy(llmName);
    return Object.prototype.hasOwnProperty.call(policy, field) ? policy[field] : fallback;
  }

  function modelRequiresAckReady(llmName) {
    return getModelPolicy(llmName).requireAckReady !== false;
  }

  function modelUsesConservativeDispatch(llmName) {
    return getModelPolicy(llmName).conservativeDispatch === true;
  }

  function getPromptSubmitTimeoutMs(llmName, fallback = 7000) {
    const value = Number(getModelPolicy(llmName).promptSubmitTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function modelSupportsSendOnlyRecovery(llmName) {
    return getModelPolicy(llmName).supportsSendOnlyRecovery === true;
  }

  const api = Object.freeze({
    DEFAULT_POLICY,
    MODEL_POLICIES,
    normalizeModelName,
    getModelPolicy,
    getModelPolicyValue,
    modelRequiresAckReady,
    modelUsesConservativeDispatch,
    getPromptSubmitTimeoutMs,
    modelSupportsSendOnlyRecovery
  });

  root.ModelPolicy = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

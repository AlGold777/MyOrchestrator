// Live B1 calibration collector. Runs only on an explicit UI request and
// returns privacy-validated, text-free assistant-turn DOM skeletons.
(function initB1SkeletonCollector(root) {
  'use strict';

  const TARGETS = Object.freeze([
    { platform: 'chatgpt', model: 'GPT', patterns: ['https://chat.openai.com/*', 'https://chatgpt.com/*'] },
    { platform: 'claude', model: 'Claude', patterns: ['https://claude.ai/*'] },
    { platform: 'gemini', model: 'Gemini', patterns: ['https://gemini.google.com/*', 'https://bard.google.com/*'] },
    { platform: 'grok', model: 'Grok', patterns: ['https://grok.com/*', 'https://grok.x.ai/*', 'https://x.com/*', 'https://x.ai/*'] },
    { platform: 'perplexity', model: 'Perplexity', patterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'] },
    { platform: 'qwen', model: 'Qwen', patterns: ['https://chat.qwen.ai/*'] },
    { platform: 'deepseek', model: 'DeepSeek', patterns: ['https://chat.deepseek.com/*'] },
    { platform: 'lechat', model: 'Le Chat', patterns: ['https://chat.mistral.ai/*'] },
    { platform: 'zai', model: 'Z.ai', patterns: ['https://chat.z.ai/*'] }
  ]);
  const CAPTURE_FILES = Object.freeze([
    'shared/secret-redaction.js',
    'content-scripts/answer-pipeline-selectors.js',
    'content-scripts/turn-resolver.js',
    'content-scripts/answer-structure.js',
    'content-scripts/dom-skeleton-capture.js'
  ]);
  const MAX_SKELETON_BYTES = 2 * 1024 * 1024;
  const TEXT_PLACEHOLDER_SEQUENCE = /^(?:⟦TEXT:\d+⟧\s*)+$/;
  const SAFE_DEEPSEEK_STRUCTURAL_IDENTIFIER = /\bds-(?:answer|assistant|avatar|button|chat|icon|loading|markdown|message|response|scroll|thinking)(?:[\w-]*)/gi;

  const queryTabs = (chromeApi, patterns) => new Promise((resolve) => {
    try {
      chromeApi.tabs.query({ url: patterns }, (tabs) => {
        if (chromeApi.runtime?.lastError) { resolve([]); return; }
        resolve(Array.isArray(tabs) ? tabs.filter((tab) => Number.isInteger(tab?.id)) : []);
      });
    } catch (_) { resolve([]); }
  });

  const injectCaptureRuntime = (chromeApi, tabId) => new Promise((resolve) => {
    try {
      chromeApi.scripting.executeScript({ target: { tabId }, files: CAPTURE_FILES.slice() }, () => {
        const error = chromeApi.runtime?.lastError?.message || null;
        resolve(error ? { ok: false, error: 'capture_runtime_injection_failed' } : { ok: true });
      });
    } catch (_) { resolve({ ok: false, error: 'capture_runtime_injection_failed' }); }
  });

  const requestCapture = (chromeApi, tabId) => new Promise((resolve) => {
    try {
      chromeApi.tabs.sendMessage(tabId, { type: 'CAPTURE_SANITIZED_ANSWER_SKELETON' }, (response) => {
        const error = chromeApi.runtime?.lastError?.message || null;
        resolve(error ? { ok: false, error: 'capture_message_failed' } : (response || { ok: false, error: 'empty_capture_response' }));
      });
    } catch (_) { resolve({ ok: false, error: 'capture_message_failed' }); }
  });

  function hasOnlyPlaceholders(html) {
    const textSegments = String(html || '')
      .replace(/<[^>]*>/g, '\n')
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    return textSegments.every((value) => TEXT_PLACEHOLDER_SEQUENCE.test(value));
  }

  function validateCapture(capture, expectedPlatform, redactor = root.SecretRedaction) {
    if (!capture?.ok || capture.privacyValidated !== true) return { ok: false, error: capture?.error || 'privacy_validation_missing' };
    if (capture.platform !== expectedPlatform) return { ok: false, error: 'platform_mismatch' };
    if (capture.textPolicy !== 'length_placeholders_only') return { ok: false, error: 'unsafe_text_policy' };
    const html = String(capture.html || '');
    if (!html || html.length > MAX_SKELETON_BYTES) return { ok: false, error: 'invalid_skeleton_size' };
    if (!hasOnlyPlaceholders(html)) return { ok: false, error: 'raw_text_detected' };
    if (/https?:\/\/|bearer\s+|api[_-]?key|access[_-]?token|refresh[_-]?token/i.test(html)) {
      return { ok: false, error: 'sensitive_shape_detected' };
    }
    if (redactor?.redactString) {
      const htmlProbe = html.replace(SAFE_DEEPSEEK_STRUCTURAL_IDENTIFIER, 'safe-deepseek-structural');
      if (redactor.redactString(htmlProbe) !== htmlProbe) return { ok: false, error: 'secret_redaction_changed_capture' };
    }
    if (redactor?.redactDeep) {
      const { html: _html, ...metadata } = capture;
      const redacted = redactor.redactDeep(metadata);
      if (JSON.stringify(redacted) !== JSON.stringify(metadata)) return { ok: false, error: 'secret_redaction_changed_capture' };
    }
    return { ok: true };
  }

  function captureRank(capture) {
    return (capture?.resolution === 'exact' ? 100000000 : 0)
      + (capture?.structuralComplete === true ? 10000000 : 0)
      + Math.min(9999999, Number(capture?.linearizedTextLength || 0));
  }

  async function collectTab(chromeApi, tab, target) {
    const injected = await injectCaptureRuntime(chromeApi, tab.id);
    if (!injected.ok) return injected;
    const capture = await requestCapture(chromeApi, tab.id);
    const validation = validateCapture(capture, target.platform);
    return validation.ok ? capture : { ok: false, error: validation.error, resolution: capture?.resolution || 'unresolved' };
  }

  async function collectTarget(chromeApi, target) {
    const tabs = await queryTabs(chromeApi, target.patterns);
    if (!tabs.length) {
      return { platform: target.platform, model: target.model, status: 'missing_tab', capture: null, attempts: [] };
    }
    const captures = await Promise.all(tabs.map((tab) => collectTab(chromeApi, tab, target)));
    const valid = captures.filter((capture) => capture?.ok).sort((a, b) => captureRank(b) - captureRank(a));
    const selected = valid[0] || null;
    return {
      platform: target.platform,
      model: target.model,
      status: selected ? 'captured' : 'capture_failed',
      capture: selected,
      attempts: captures.map((capture) => ({
        ok: capture?.ok === true,
        resolution: capture?.resolution || 'unresolved',
        reason: capture?.reason || null,
        error: capture?.ok ? null : (capture?.error || 'capture_failed')
      }))
    };
  }

  async function collectAll(options = {}) {
    const chromeApi = options.chromeApi || root.chrome;
    if (!chromeApi?.tabs?.query || !chromeApi?.tabs?.sendMessage || !chromeApi?.scripting?.executeScript) {
      return { success: false, error: 'chrome_capture_api_unavailable' };
    }
    const results = await Promise.all(TARGETS.map((target) => collectTarget(chromeApi, target)));
    const capturedCount = results.filter((entry) => entry.status === 'captured').length;
    const exactCount = results.filter((entry) => entry.capture?.resolution === 'exact').length;
    const ignoredRiskPlatforms = results
      .filter((entry) => entry.capture?.ignoredContentRisk === true)
      .map((entry) => entry.platform);
    return {
      success: true,
      schemaVersion: 1,
      extensionVersion: chromeApi.runtime?.getManifest?.()?.version || 'unknown',
      capturedAt: new Date().toISOString(),
      privacyPolicy: 'sanitized_dom_skeletons_without_conversation_text_or_session_identifiers',
      expectedCount: TARGETS.length,
      capturedCount,
      exactCount,
      complete: capturedCount === TARGETS.length,
      exactOnAllPlatforms: exactCount === TARGETS.length,
      ignoredRiskPlatforms,
      results
    };
  }

  const api = Object.freeze({ TARGETS, CAPTURE_FILES, hasOnlyPlaceholders, validateCapture, captureRank, collectTarget, collectAll });
  root.B1SkeletonCollector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);

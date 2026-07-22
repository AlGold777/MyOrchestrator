(function initDebateServiceRoles(root) {
  'use strict';
  function resolveServiceRoles({ preset = {}, synthesizer = '', auditor = '' } = {}) {
    const configured = preset.serviceRoles || {};
    // There is one model-facing service role: the synthesizer. It performs
    // final synthesis as well as round filters and registry checkpoints.
    // Older saved profiles may still contain serviceRoles.extractor. Ignore it:
    // a hidden legacy field must never select a synthesizer for the user.
    const configuredSynthesizer = String(synthesizer || '').trim();
    const resolvedSynthesizer = configuredSynthesizer.toLowerCase() === 'auto' ? '' : configuredSynthesizer;
    const configuredAuditor = String(auditor || configured.auditor || '').trim();
    const resolvedAuditor = configuredAuditor.toLowerCase() === 'auto' || configuredAuditor === resolvedSynthesizer
      ? ''
      : configuredAuditor;
    return { synthesizer: resolvedSynthesizer, auditor: resolvedAuditor };
  }
  const api = Object.freeze({ resolveServiceRoles }); root.DebateServiceRoles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// results/debate-ui.js
// Small pure helpers for Debate page UI decisions. Keep DOM mutation in results.js;
// this module owns mode/visibility decisions that are easy to test and reuse.

(function initResultsDebateUi(root) {
  'use strict';

  function getPresetDuration(presetMeta = {}) {
    return String(presetMeta?.duration || '').trim();
  }

  function shouldShowRoundLimitControl(presetMeta = {}) {
    return getPresetDuration(presetMeta) === 'open_ended';
  }

  function usesSynthesisStage({ scheme = '2', presetMeta = {}, roundLimit = '' } = {}) {
    const normalizedScheme = String(scheme || '2').trim();
    if (!['2', '3', 'many', 'free'].includes(normalizedScheme)) return false;
    const duration = getPresetDuration(presetMeta);
    if (duration !== 'open_ended') return true;
    return String(roundLimit || '').trim() !== 'infinite';
  }

  function getProtocolSynthesizer(protocol = {}) {
    const explicit = (value) => {
      const normalized = String(value || '').trim();
      return normalized.toLowerCase() === 'auto' ? '' : normalized;
    };
    const canonical = explicit(protocol.synthesizer);
    if (canonical) return canonical;
    // Compatibility for pipelines saved before the single-synthesizer model.
    const scheme = String(protocol?.scheme || (protocol?.type === 'multi' ? 'many' : protocol?.type === 'triad' ? '3' : '2')).trim();
    if (scheme === 'many' || scheme === 'free') return explicit(protocol.multiSynthesizer || protocol.serviceRoles?.extractor);
    if (scheme === '3' || scheme === '2') return explicit(protocol.triadSynthesizer || protocol.serviceRoles?.extractor);
    return explicit(protocol.serviceRoles?.extractor);
  }

  const api = Object.freeze({
    shouldShowRoundLimitControl,
    usesSynthesisStage,
    getProtocolSynthesizer
  });

  root.ResultsDebateUi = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

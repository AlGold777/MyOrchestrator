// results/debate-ui.js
// Small pure helpers for Debate page UI decisions. Keep DOM mutation in results.js;
// this module owns visibility decisions that are easy to test and reuse.

(function initResultsDebateUi(root) {
  'use strict';

  function getPresetDuration(presetMeta = {}) {
    return String(presetMeta?.duration || '').trim();
  }

  function shouldShowRoundLimitControl(presetMeta = {}) {
    return getPresetDuration(presetMeta) === 'open_ended';
  }

  function usesSynthesisStage({ presetMeta = {}, roundLimit = '' } = {}) {
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

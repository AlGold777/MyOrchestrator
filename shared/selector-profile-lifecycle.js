// shared/selector-profile-lifecycle.js
// Selector health profile lifecycle decisions used by resolver/runtime diagnostics.

(function initSelectorProfileLifecycle(root) {
  'use strict';

  function normalizeStatus(value) {
    const status = String(value || 'unknown').toLowerCase();
    if (status === 'ok') return 'healthy';
    if (status === 'failed') return 'broken';
    if (['healthy', 'degraded', 'broken', 'unknown'].includes(status)) return status;
    return 'unknown';
  }

  function getLastKnownGoodVersion(profile = {}) {
    const lkg = profile.lastKnownGood && typeof profile.lastKnownGood === 'object'
      ? profile.lastKnownGood
      : null;
    return profile.lastKnownGoodVersion
      || profile.lastKnownGoodUiVersion
      || profile.lastKnownGoodSelectorVersion
      || lkg?.version
      || lkg?.uiVersion
      || null;
  }

  function decide(profile = {}, options = {}) {
    const status = normalizeStatus(profile.profileStatus || profile.status);
    const activeVersion = profile.activeUiVersion || profile.activeVersion || options.activeVersion || null;
    const lastKnownGoodVersion = getLastKnownGoodVersion(profile);
    const base = {
      schemaVersion: 1,
      status,
      activeVersion,
      lastKnownGoodVersion,
      action: 'use_current',
      reason: 'profile_not_restrictive',
      exactEnabled: true,
      cacheEnabled: true,
      fallbackOnly: false,
      rollbackRequired: false,
      selectedVersion: activeVersion || null
    };

    if (status === 'degraded') {
      return Object.freeze(Object.assign(base, {
        action: 'monitor_degraded',
        reason: 'selector_profile_degraded'
      }));
    }

    if (status === 'broken' && lastKnownGoodVersion) {
      return Object.freeze(Object.assign(base, {
        action: 'rollback_to_last_known_good',
        reason: 'selector_profile_broken_last_known_good_available',
        exactEnabled: false,
        cacheEnabled: false,
        fallbackOnly: false,
        rollbackRequired: true,
        selectedVersion: lastKnownGoodVersion
      }));
    }

    if (status === 'broken') {
      return Object.freeze(Object.assign(base, {
        action: 'fallback_only',
        reason: 'selector_profile_broken_no_last_known_good',
        exactEnabled: false,
        cacheEnabled: false,
        fallbackOnly: true,
        rollbackRequired: false,
        selectedVersion: null
      }));
    }

    return Object.freeze(base);
  }

  const api = Object.freeze({
    decide,
    normalizeStatus
  });

  root.SelectorProfileLifecycle = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

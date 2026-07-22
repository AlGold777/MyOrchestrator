// Pure Debate UI view-model selectors. DOM rendering stays in the page adapter.
(function initDebateController(root) {
  'use strict';

  function deriveRunControls({ aggregate = null, approvalWaiting = false, protocolActive = false, autoMode = false } = {}) {
    const status = String(aggregate?.status || 'idle');
    const paused = ['paused', 'technical_pause', 'paused_by_moderator'].includes(status);
    const active = protocolActive || approvalWaiting || ['running', 'awaiting_approval', 'finalization_pending'].includes(status);
    if (paused) {
      return Object.freeze({ action: 'resume', icon: 'ti ti-send', title: autoMode ? 'Resume debate' : 'Запустить следующий раунд', active: true, stepEnabled: approvalWaiting });
    }
    if (active) {
      if (!autoMode) {
        return Object.freeze({ action: 'run', icon: 'ti ti-send', title: 'Запустить следующий раунд', active: false, stepEnabled: approvalWaiting });
      }
      return Object.freeze({ action: 'pause', icon: 'ti ti-player-pause', title: 'Pause after current turn', active: false, stepEnabled: approvalWaiting });
    }
    return Object.freeze({ action: 'run', icon: 'ti ti-send', title: 'Run debate', active: false, stepEnabled: false });
  }

  const api = Object.freeze({ deriveRunControls });
  root.DebateController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

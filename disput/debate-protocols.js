// Compatibility facade for persisted UI state. There is only one protocol.
(function initDebateProtocols(root) {
  'use strict';
  const topologyOf = () => 'universal';
  const protocol = Object.freeze({
    topology: 'universal',
    createState: (config = {}) => ({ active: false, status: 'idle', ...config, topology: 'universal' }),
    reduce(state = {}, event = {}) {
      const type = String(event.type || '');
      if (type === 'RUNNING') return { ...state, active: true, status: 'running' };
      if (type === 'PAUSED' || type === 'TECHNICAL_PAUSE') return { ...state, active: true, status: 'paused' };
      if (type === 'COMPLETED') return { ...state, active: false, status: 'completed' };
      if (type === 'FAILED') return { ...state, active: false, status: 'error' };
      if (type === 'CANCELLED') return { ...state, active: false, status: 'cancelled' };
      return state;
    },
    planNextEffects: () => [], buildPrompt: () => '',
    isTerminal: (state) => !state?.active && ['completed', 'error', 'cancelled'].includes(String(state?.status || ''))
  });
  const protocols = Object.freeze({ universal: protocol });
  const api = Object.freeze({ topologyOf, getProtocol: () => protocol, protocols });
  root.DebateProtocols = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

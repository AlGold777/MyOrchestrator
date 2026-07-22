(function initDebateDropoutRevalidation(root) {
  'use strict';
  function revalidate({ topology = '', stage = '', failedModels = [], remainingModels = [], roles = [], synthesizer = '', plan = {} } = {}) {
    const warnings = []; const degradation = {};
    if (!remainingModels.length) return { verdict: 'stop_required', warnings: ['no_participants_remain'], degradation };
    if ((failedModels || []).includes(synthesizer)) warnings.push('synthesizer_lost');
    if (topology === 'duel' && remainingModels.length === 1) { warnings.push('duel_to_monologue'); degradation.mode = 'duel_to_monologue'; }
    if (topology === 'triad' && remainingModels.length === 2) { warnings.push('triad_to_duel'); degradation.mode = 'triad_to_duel'; }
    if (topology === 'multi' && remainingModels.length < 3) warnings.push('low_diversity');
    const suffix = String(plan?.reasoningBudget?.comparableSuffix || plan?.comparableSuffix || '').toLowerCase();
    const configuredRoleMap = plan?.roles && typeof plan.roles === 'object' ? plan.roles : null;
    const roleFor = (model, index) => configuredRoleMap ? configuredRoleMap[model] : (Array.isArray(roles) ? roles[index] : roles?.[model]);
    if (suffix.includes('red') && !remainingModels.some((model, i) => String(roleFor(model, i) || '').includes('critical'))) warnings.push('no_critic_left');
    const degraded = warnings.some((item) => ['duel_to_monologue', 'triad_to_duel', 'low_diversity', 'no_critic_left'].includes(item));
    return { verdict: degraded ? 'continue_degraded' : 'continue_ok', warnings, degradation: degraded ? { ...degradation, reason: warnings.join(',') , stage, failedModels: failedModels.slice() } : degradation };
  }
  const api = Object.freeze({ revalidate }); root.DebateDropoutRevalidation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

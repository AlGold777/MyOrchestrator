// disput/pipeline-presets.js
// Config-only pipeline preset registry for Debate page runtime modes.

(function initPipelinePresets(root) {
  'use strict';

  const DEFAULT_PRESET_ID = 'DUEL_STANDARD';

  const CHECKPOINT_OUTPUTS = Object.freeze({
    DUEL_LONG: Object.freeze(['claim_ledger', 'open_issues', 'convergence_map', 'unresolved_objections']),
    TRIAD_LONG: Object.freeze(['claim_ledger', 'open_issues', 'positions_map', 'synthesis_delta'])
  });

  const REASONING_BUDGETS = Object.freeze({
    VERDICT_STANDARD: Object.freeze({
      class: 'standard',
      critiqueDepth: 1,
      synthesisPasses: 1,
      checkpointPasses: 0,
      finalVerdictPasses: 1,
      comparableSuffix: 'Verdict'
    }),
    RED_TEAM_MEDIUM: Object.freeze({
      class: 'medium',
      critiqueDepth: 2,
      synthesisPasses: 1,
      checkpointPasses: 0,
      finalVerdictPasses: 1,
      comparableSuffix: 'Red Team'
    }),
    LONG_INFINITE: Object.freeze({
      class: 'infinite',
      critiqueDepth: null,
      synthesisPasses: 1,
      checkpointPasses: null,
      finalVerdictPasses: 1,
      comparableSuffix: 'Long'
    })
  });

  const SAFETY_POLICY = Object.freeze({
    canPause: true,
    canRecover: true,
    canError: true,
    canCancel: true
  });

  const DISABLED_SAFETY_POLICY = Object.freeze({
    canPause: false,
    canRecover: false,
    canError: false,
    canCancel: false
  });

  const PIPELINE_PRESETS = Object.freeze([
    Object.freeze({
      id: 'DUEL_STANDARD',
      label: 'Duel',
      topology: 'duel',
      duration: 'fixed',
      terminationOwner: 'runtime',
      turnLimitMode: 'fixed',
      waveLimitMode: 'none',
      finalizationPolicy: 'auto_after_limit',
      contextPolicy: 'full_history',
      anonymizeParticipants: true,
      checkpointPolicy: Object.freeze({ enabled: false }),
      reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'DUEL_LONG',
      label: 'Duel Long',
      topology: 'duel',
      duration: 'open_ended',
      terminationOwner: 'moderator',
      turnLimitMode: 'none',
      waveLimitMode: 'none',
      finalizationPolicy: 'manual_only',
      contextPolicy: 'filtered',
      anonymizeParticipants: false,
      checkpointPolicy: Object.freeze({
        enabled: true,
        everyPublicTurns: 4,
        outputs: CHECKPOINT_OUTPUTS.DUEL_LONG
      }),
      reasoningBudget: REASONING_BUDGETS.LONG_INFINITE,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'TRIAD_STANDARD',
      label: 'Triad',
      topology: 'triad',
      duration: 'fixed',
      terminationOwner: 'runtime',
      turnLimitMode: 'none',
      waveLimitMode: 'fixed',
      finalizationPolicy: 'auto_after_limit',
      contextPolicy: 'full_history',
      anonymizeParticipants: true,
      checkpointPolicy: Object.freeze({
        enabled: true,
        everyWaves: 1,
        outputs: Object.freeze(['positions_map'])
      }),
      reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'TRIAD_LONG',
      label: 'Triad Long',
      topology: 'triad',
      duration: 'open_ended',
      terminationOwner: 'moderator',
      turnLimitMode: 'none',
      waveLimitMode: 'none',
      finalizationPolicy: 'manual_only',
      contextPolicy: 'filtered',
      anonymizeParticipants: false,
      checkpointPolicy: Object.freeze({
        enabled: true,
        everyWaves: 2,
        outputs: CHECKPOINT_OUTPUTS.TRIAD_LONG
      }),
      reasoningBudget: REASONING_BUDGETS.LONG_INFINITE,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'MULTI_STANDARD',
      label: 'Multi Verdict',
      topology: 'multi',
      duration: 'fixed',
      terminationOwner: 'runtime',
      turnLimitMode: 'none',
      waveLimitMode: 'fixed',
      finalizationPolicy: 'auto_after_limit',
      contextPolicy: 'full_history',
      anonymizeParticipants: true,
      checkpointPolicy: Object.freeze({ enabled: false }),
      reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'MULTI_RED_TEAM',
      label: 'Multi Red Team',
      topology: 'multi',
      duration: 'fixed',
      terminationOwner: 'runtime',
      turnLimitMode: 'none',
      waveLimitMode: 'fixed',
      finalizationPolicy: 'auto_after_limit',
      contextPolicy: 'full_history',
      anonymizeParticipants: true,
      checkpointPolicy: Object.freeze({ enabled: false }),
      reasoningBudget: REASONING_BUDGETS.RED_TEAM_MEDIUM,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    }),
    Object.freeze({
      id: 'MULTI_LONG',
      label: 'Multi Long',
      uiLabel: 'Multi Long — later',
      topology: 'multi',
      duration: 'open_ended',
      terminationOwner: 'moderator',
      turnLimitMode: 'none',
      waveLimitMode: 'none',
      finalizationPolicy: 'manual_only',
      contextPolicy: 'filtered',
      anonymizeParticipants: false,
      checkpointPolicy: Object.freeze({ enabled: false }),
      reasoningBudget: REASONING_BUDGETS.LONG_INFINITE,
      status: 'disabled_experimental',
      safetyPolicy: DISABLED_SAFETY_POLICY
    }),
    Object.freeze({
      id: 'FREE_TALK_MVP',
      label: 'FreeTalk',
      topology: 'free_talk',
      duration: 'trigger_driven',
      terminationOwner: 'runtime_and_moderator',
      turnLimitMode: 'none',
      waveLimitMode: 'none',
      finalizationPolicy: 'readiness_or_moderator',
      contextPolicy: 'filtered',
      anonymizeParticipants: false,
      profileId: 'FREE_TALK_MVP',
      checkpointPolicy: Object.freeze({ enabled: true, afterEveryAction: true }),
      resourceBudget: Object.freeze({ used: 0, limit: null, reserved: 1 }),
      reasoningBudget: REASONING_BUDGETS.LONG_INFINITE,
      status: 'enabled',
      safetyPolicy: SAFETY_POLICY
    })
  ]);

  // Complete built-in definitions. The UI supplies only model availability;
  // protocol policy, round plans and reasoning budgets live here.
  //
  // All fixed presets run `auto`: manual per-wave moderation is not yet a
  // complete end-to-end feature. Leaving a fixed Red Team preset in manual
  // makes the runtime stop after its opening wave, while the saved pipeline
  // promises a complete canonical round plan and mandatory synthesis.
  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
    Object.freeze({ name: 'Duel Verdict', scheme: '2', presetId: 'DUEL_STANDARD', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '3', reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD, roundPlan: [['positions_map'], ['claim_ledger', 'challenge_map'], ['resolution_map', 'final_verdict']], roles: ['critical', 'meta'] }),
    Object.freeze({ name: 'Duel Red Team', scheme: '2', presetId: 'DUEL_STANDARD', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '4', acceptSelfRetest: true, runNote: 'В Duel нет независимого третьего участника: self_retest проверяет патчи автором и должен отражаться в остаточных рисках.', reasoningBudget: REASONING_BUDGETS.RED_TEAM_MEDIUM, roundPlan: [['attack_surface_map'], ['evidence_gaps', 'hidden_assumptions'], ['counterexamples', 'failure_modes'], ['self_retest', 'red_team_verdict']], roles: ['critical', 'critical'] }),
    Object.freeze({ name: 'Duel Long', scheme: '2', presetId: 'DUEL_LONG', contextPolicy: 'filtered', runPolicy: 'auto', length: '1000', roundLimit: 'infinite', reasoningBudget: REASONING_BUDGETS.LONG_INFINITE, roundPlan: [], roles: ['critical', 'meta'] }),
    Object.freeze({ name: 'Triad Verdict', scheme: '3', presetId: 'TRIAD_STANDARD', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '3', synthesizer: 'Claude', reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD, roundPlan: [['positions_map'], ['cross_review_matrix', 'claim_ledger'], ['arbiter_synthesis', 'final_verdict']], roles: ['critical', 'meta', 'critical'] }),
    Object.freeze({ name: 'Triad Red Team', scheme: '3', presetId: 'TRIAD_STANDARD', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '4', synthesizer: 'Claude', stageRoles: { 1: ['meta', 'critical', 'critical'], 2: ['critical', 'critical'], 3: ['meta'], 4: ['critical'] }, reasoningBudget: REASONING_BUDGETS.RED_TEAM_MEDIUM, roundPlan: [['proposal', 'attack_surface_map'], ['counterexamples', 'failure_modes'], ['patch_map'], ['independent_retest', 'retest_report']], roles: ['critical', 'critical', 'meta'] }),
    Object.freeze({ name: 'Triad Long', scheme: '3', presetId: 'TRIAD_LONG', contextPolicy: 'filtered', runPolicy: 'auto', length: '1000', roundLimit: 'infinite', synthesizer: 'Claude', reasoningBudget: REASONING_BUDGETS.LONG_INFINITE, roundPlan: [], roles: ['critical', 'meta', 'critical'] }),
    Object.freeze({ name: 'Multi Verdict', scheme: 'many', presetId: 'MULTI_STANDARD', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '4', synthesizer: 'Claude', reasoningBudget: REASONING_BUDGETS.VERDICT_STANDARD, roundPlan: [['positions_cluster_map'], ['claim_ledger', 'evidence_weighting'], ['outlier_review', 'conflict_resolution'], ['weighted_synthesis', 'final_verdict']], roles: ['critical', 'meta'] }),
    Object.freeze({ name: 'Multi Red Team', scheme: 'many', presetId: 'MULTI_RED_TEAM', contextPolicy: 'full_history', runPolicy: 'auto', length: '700', roundLimit: '4', synthesizer: 'Claude', stageRoles: { 1: ['meta', 'critical', 'critical'], 2: ['critical', 'critical'], 3: ['meta'], 4: ['critical', 'critical'] }, reasoningBudget: REASONING_BUDGETS.RED_TEAM_MEDIUM, roundPlan: [['proposal', 'attack_surface_map'], ['counterexamples', 'failure_modes'], ['patch_map'], ['independent_retest', 'retest_report']], roles: ['critical', 'critical', 'meta'] }),
    Object.freeze({ name: 'Multi Long — later', scheme: 'many', presetId: 'MULTI_LONG', contextPolicy: 'filtered', runPolicy: 'auto', length: '1000', roundLimit: '3', reasoningBudget: REASONING_BUDGETS.LONG_INFINITE, roundPlan: [], roles: ['critical', 'meta'], disabled: true, selectAllModels: true }),
    Object.freeze({ name: 'FreeTalk', scheme: 'free', presetId: 'FREE_TALK_MVP', profileId: 'FREE_TALK_MVP', contextPolicy: 'filtered', runPolicy: 'auto', length: '1000', roundLimit: 'infinite', reasoningBudget: REASONING_BUDGETS.LONG_INFINITE, resourceBudget: { used: 0, limit: null, reserved: 1 }, roundPlan: [], roles: ['participant', 'critic', 'verifier', 'arbiter'], defaultModelCount: 1 })
  ]);

  const PRESET_BY_ID = PIPELINE_PRESETS.reduce((acc, preset) => {
    acc[preset.id] = preset;
    return acc;
  }, Object.create(null));

  const isFinitePositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  const cloneBudget = (budget) => Object.freeze(Object.assign({}, budget || REASONING_BUDGETS.VERDICT_STANDARD));
  const normalizeLimit = (value, fallback) => {
    if (isFinitePositiveNumber(value)) return Number(value);
    if (isFinitePositiveNumber(fallback)) return Number(fallback);
    return null;
  };

  function getPipelinePreset(presetId) {
    return PRESET_BY_ID[presetId] || PRESET_BY_ID[DEFAULT_PRESET_ID];
  }

  const isLongPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).duration === 'open_ended';
  const isOpenEndedPreset = isLongPreset;
  const isTriadPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).topology === 'triad';
  const isDuelPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).topology === 'duel';
  const isMultiPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).topology === 'multi';
  const isFreeTalkPreset = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).topology === 'free_talk';
  const isPresetEnabled = (presetOrId) => getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id).status !== 'disabled_experimental';

  function resolveRuntimeRoundLimits(presetOrId, input = {}) {
    const preset = getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id);
    const isOpenEnded = preset.duration === 'open_ended';
    const uiRoundLimit = input.uiRoundLimit;
    const planLength = Array.isArray(input.roundPlan) ? input.roundPlan.length : 0;
    const storedLimit = Number(input.storedRoundLimit);
    const canonical = planLength > 0
      ? planLength
      : (Number.isFinite(storedLimit) && storedLimit > 0 ? storedLimit : null);
    const uiIsInfinite = String(uiRoundLimit || '').trim() === 'infinite';
    let roundLimit;
    if (isOpenEnded) {
      roundLimit = uiIsInfinite ? 'infinite' : (normalizeLimit(uiRoundLimit, canonical) || 'infinite');
    } else {
      roundLimit = canonical != null ? canonical : (normalizeLimit(uiRoundLimit, 3) || 3);
    }
    if (roundLimit === 'infinite') {
      return Object.freeze({ roundLimit, turnLimit: null, waveLimit: null });
    }
    const rounds = Number(roundLimit);
    return Object.freeze({
      roundLimit: rounds,
      turnLimit: Math.max(0, (rounds - 1) * 2),
      waveLimit: rounds
    });
  }

  function normalizePipelinePreset(presetId, userOptions = {}) {
    const preset = getPipelinePreset(presetId);
    const currentUiLimits = userOptions.currentUiLimits || {};
    const roundLimit = String(currentUiLimits.roundLimit || '').trim();
    const infiniteOpenEnded = preset.duration === 'open_ended' && (!roundLimit || roundLimit === 'infinite');
    const turnLimit = infiniteOpenEnded
      ? null
      : (preset.topology === 'duel' ? normalizeLimit(currentUiLimits.turnLimit, currentUiLimits.maxTurns) : null);
    const waveLimit = infiniteOpenEnded
      ? null
      : (preset.topology === 'triad' || preset.topology === 'multi'
        ? normalizeLimit(currentUiLimits.waveLimit, currentUiLimits.maxWaves)
        : null);

    return Object.freeze({
      presetId: preset.id,
      topology: preset.topology,
      duration: preset.duration,
      terminationOwner: preset.terminationOwner,
      finalizationPolicy: preset.finalizationPolicy,
      contextPolicy: preset.contextPolicy || (preset.duration === 'open_ended' ? 'filtered' : 'full_history'),
      anonymizeParticipants: preset.anonymizeParticipants !== false,
      serviceRoles: { auditor: String(preset.serviceRoles?.auditor || '').toLowerCase() === 'auto' ? '' : String(preset.serviceRoles?.auditor || '') },
      stageRoles: preset.stageRoles || null,
      acceptSelfRetest: Boolean(preset.acceptSelfRetest),
      turnLimit,
      waveLimit,
      checkpointPolicy: preset.checkpointPolicy,
      reasoningBudget: cloneBudget(preset.reasoningBudget),
      safetyPolicy: preset.safetyPolicy
      ,profileId: preset.profileId || ''
      ,resourceBudget: preset.resourceBudget ? Object.freeze({ ...preset.resourceBudget }) : null
    });
  }

  const api = Object.freeze({
    PIPELINE_PRESETS,
    BUILTIN_PIPELINE_DEFINITIONS,
    REASONING_BUDGETS,
    DEFAULT_PRESET_ID,
    normalizePipelinePreset,
    resolveRuntimeRoundLimits,
    getPipelinePreset,
    isLongPreset,
    isOpenEndedPreset,
    isTriadPreset,
    isDuelPreset,
    isMultiPreset,
    isFreeTalkPreset,
    isPresetEnabled
  });

  root.PipelinePresets = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

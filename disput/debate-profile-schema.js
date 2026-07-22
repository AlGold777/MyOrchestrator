(function initDebateProfileSchema(root) {
  'use strict';

  const VERSION = 3;
  const STATUSES = Object.freeze(['draft', 'validated', 'deprecated']);
  const MODES = Object.freeze(['manual', 'auto', 'ask', 'assisted']);
  const RULE_MODES = Object.freeze(['control', 'shadow', 'disabled']);

  const ELEMENT_CATALOG = Object.freeze({
    positions: { purpose: 'Получить независимые позиции.', input: ['problem_spec'], output: ['claim'], trigger: 'run_started', failure: 'continue_degraded' },
    critique: { purpose: 'Проверить claims и создать objections.', input: ['claim'], output: ['objection', 'axis_verdict'], trigger: 'uncriticized_claim', failure: 'continue_degraded' },
    response: { purpose: 'Ответить на objection доказательством или revision.', input: ['claim', 'objection'], output: ['evidence', 'revision', 'closure_proposal'], trigger: 'open_objection', failure: 'keep_open' },
    verification: { purpose: 'Независимо проверить evidence и закрытие.', input: ['evidence', 'closure_proposal'], output: ['axis_verdict', 'human_decision'], trigger: 'weak_evidence_or_closure', failure: 'keep_open' },
    synthesis: { purpose: 'Собрать итог без потери dissent и limitations.', input: ['state_map'], output: ['synthesis'], trigger: 'readiness', failure: 'map_only' },
    synthesis_audit: { purpose: 'Проверить итог против карты.', input: ['state_map', 'synthesis'], output: ['audit'], trigger: 'synthesis_ready', failure: 'mark_unverified' },
    human_gate: { purpose: 'Запросить решение человека.', input: ['pending_action'], output: ['human_decision'], trigger: 'human_confirmation_required', failure: 'pause' }
  });

  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };

  const baseProfile = (input) => freeze({
    schemaVersion: VERSION,
    engineRange: '^1',
    promptPack: { id: 'disput-core', version: '3.0.0' },
    status: 'draft',
    parentProfileId: '',
    taskTypes: ['general'],
    roles: [],
    stages: [],
    triggers: [],
    rules: [],
    progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
    policies: {
      mode: 'ask',
      preserveDissent: true,
      mapAlwaysAvailable: true,
      modelSelfReportControlsFlow: false,
      reserveFinalizationBudget: true,
      modelSignals: 'disabled'
    },
    ...input
  });

  const BUILTIN_PROFILES = freeze({
    DUEL_STANDARD: baseProfile({ id: 'DUEL_STANDARD', version: '1.1.0', status: 'validated', title: 'Duel', topology: 'duel', roles: ['participant_a', 'participant_b', 'synthesizer'], stages: ['positions', 'critique', 'response', 'synthesis'], rules: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'ACTIVE_DISSENT', 'READY_FOR_SYNTHESIS'], policies: { mode: 'ask', ruleMode: 'shadow', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'disabled' } }),
    TRIAD_STANDARD: baseProfile({ id: 'TRIAD_STANDARD', version: '1.1.0', status: 'validated', title: 'Triad', topology: 'triad', roles: ['participant', 'critic', 'synthesizer'], stages: ['positions', 'critique', 'response', 'verification', 'synthesis'], rules: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'ACTIVE_DISSENT', 'READY_FOR_SYNTHESIS'], policies: { mode: 'ask', ruleMode: 'shadow', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'disabled' } }),
    MULTI_STANDARD: baseProfile({ id: 'MULTI_STANDARD', version: '1.1.0', status: 'draft', title: 'Multi', topology: 'multi', roles: ['participant', 'critic', 'synthesizer'], stages: ['positions', 'critique', 'response', 'verification', 'synthesis'], rules: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'CONTRADICTION', 'ACTIVE_DISSENT', 'READY_FOR_SYNTHESIS'], policies: { mode: 'ask', ruleMode: 'shadow', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'disabled' } }),
    FREE_TALK_MVP: baseProfile({
      id: 'FREE_TALK_MVP', version: '0.2.0', status: 'draft', title: 'FreeTalk', topology: 'free_talk',
      taskTypes: ['general', 'research', 'idea_development', 'decision'],
      roles: ['participant', 'critic', 'defender', 'verifier', 'arbiter', 'synthesizer', 'human'],
      stages: ['positions'],
      triggers: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'ACTIVE_DISSENT', 'STAGNATION', 'READY_FOR_SYNTHESIS'],
      rules: [
        { triggerId: 'UNCRITICIZED_CLAIM', priority: 70, cooldown: 2, maxExecutions: 3 },
        { triggerId: 'BLOCKING_OBJECTION', priority: 100, cooldown: 1, maxExecutions: 3 },
        { triggerId: 'WEAK_EVIDENCE', priority: 90, cooldown: 2, maxExecutions: 2 },
        { triggerId: 'REVISION_RECHECK', priority: 80, cooldown: 1, maxExecutions: 2 },
        { triggerId: 'ACTIVE_DISSENT', priority: 60, cooldown: 2, maxExecutions: 2 },
        { triggerId: 'STAGNATION', priority: 50, cooldown: 1, maxExecutions: 1 },
        { triggerId: 'READY_FOR_SYNTHESIS', priority: 40, cooldown: 1, maxExecutions: 1 }
      ],
      progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
      policies: { mode: 'assisted', ruleMode: 'control', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'shadow', fixedRoundLimit: null, fixedModelLimit: null }
    }),
    DEEP_RESEARCH_ALPHA: baseProfile({
      id: 'DEEP_RESEARCH_ALPHA', version: '0.2.0', status: 'draft', title: 'Deep Research', topology: 'free_talk', parentProfileId: 'FREE_TALK_MVP@0.2.0',
      taskTypes: ['research'], roles: ['researcher', 'critic', 'verifier', 'synthesizer', 'auditor', 'human'],
      stages: ['positions', 'critique', 'response', 'verification', 'synthesis', 'synthesis_audit'],
      triggers: ['UNCRITICIZED_CLAIM', 'FACT_DISPUTE', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'CONTRADICTION', 'CONTEXT_PRESSURE', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'],
      rules: ['UNCRITICIZED_CLAIM', 'FACT_DISPUTE', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'CONTRADICTION', 'CONTEXT_PRESSURE', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'],
      extensionContract: { artifactTypes: ['source', 'finding'], axes: ['source_quality', 'coverage'], tools: ['web_research'], mapSections: ['sources', 'findings'] },
      progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
      policies: { mode: 'assisted', ruleMode: 'control', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'shadow', fixedRoundLimit: null, fixedModelLimit: null }
    })
  });

  function validate(profile = {}) {
    const errors = [];
    if (Number(profile.schemaVersion) !== VERSION) errors.push('profile_schema_version_invalid');
    if (!String(profile.id || '').trim()) errors.push('profile_id_missing');
    if (!/^\d+\.\d+\.\d+$/.test(String(profile.version || ''))) errors.push('profile_version_invalid');
    if (!String(profile.engineRange || '').trim()) errors.push('profile_engine_range_missing');
    if (!String(profile.promptPack?.id || '').trim() || !/^\d+\.\d+\.\d+$/.test(String(profile.promptPack?.version || ''))) errors.push('profile_prompt_pack_invalid');
    if (!STATUSES.includes(profile.status)) errors.push('profile_status_invalid');
    if (!String(profile.title || '').trim()) errors.push('profile_title_missing');
    if (!Array.isArray(profile.roles) || !profile.roles.length) errors.push('profile_roles_missing');
    if (!Array.isArray(profile.stages) || !profile.stages.length) errors.push('profile_stages_missing');
    (profile.stages || []).forEach((id) => { if (!ELEMENT_CATALOG[id]) errors.push(`profile_stage_unknown:${id}`); });
    if (!MODES.includes(profile.policies?.mode)) errors.push('profile_mode_invalid');
    if (!RULE_MODES.includes(profile.policies?.ruleMode || (profile.topology === 'free_talk' ? 'control' : 'shadow'))) errors.push('profile_rule_mode_invalid');
    if (profile.policies?.mapAlwaysAvailable !== true) errors.push('profile_map_required');
    if (profile.policies?.modelSelfReportControlsFlow !== false) errors.push('profile_self_report_flow_forbidden');
    if (!['disabled', 'shadow'].includes(profile.policies?.modelSignals || 'disabled')) errors.push('profile_model_signals_invalid');
    if (!Array.isArray(profile.rules)) errors.push('profile_rules_invalid');
    if (Number(profile.progressPolicy?.windowSize || 0) < 1) errors.push('profile_progress_window_invalid');
    if (profile.extensionContract) {
      ['artifactTypes', 'axes', 'tools', 'mapSections'].forEach((key) => { if (!Array.isArray(profile.extensionContract[key])) errors.push(`profile_extension_${key}_invalid`); });
    }
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }

  function migrate(profile = {}) {
    if (Number(profile.schemaVersion) === VERSION && profile.promptPack?.version === '3.0.0') return freeze({ ...profile });
    const topology = String(profile.topology || 'duel');
    const policies = { ...(profile.policies || {}) };
    if (policies.mode === 'ask') policies.mode = 'assisted';
    policies.ruleMode = policies.ruleMode || (topology === 'free_talk' ? 'control' : 'shadow');
    policies.modelSignals = policies.modelSignals || 'disabled';
    return freeze({
      ...profile,
      schemaVersion: VERSION,
      promptPack: { id: 'disput-core', version: '3.0.0' },
      rules: Array.isArray(profile.rules) ? profile.rules : (profile.triggers || []),
      progressPolicy: profile.progressPolicy || { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
      policies,
      migration: { fromSchemaVersion: Number(profile.schemaVersion || 0), fromPromptPack: profile.promptPack || null, at: Date.now() }
    });
  }

  function compile(profile, input = {}) {
    const verdict = validate(profile);
    if (!verdict.ok) throw new Error(`Invalid Debate profile: ${verdict.errors.join(', ')}`);
    return freeze({
      schemaVersion: VERSION,
      profileId: profile.id,
      profileVersion: profile.version,
      engineRange: profile.engineRange,
      promptPack: profile.promptPack,
      fingerprint: `${profile.id}@${profile.version}:${profile.promptPack.id}@${profile.promptPack.version}`,
      problemSpec: input.problemSpec || {},
      assignments: input.assignments || {},
      budget: input.budget || {},
      policies: profile.policies,
      roles: profile.roles,
      stages: profile.stages.map((id, index) => ({ id: `profile:${index + 1}:${id}`, elementId: id, ...ELEMENT_CATALOG[id] })),
      triggers: profile.triggers || []
      ,rules: profile.rules || profile.triggers || []
      ,progressPolicy: profile.progressPolicy
      ,extensionContract: profile.extensionContract || null
    });
  }

  const api = Object.freeze({ VERSION, STATUSES, MODES, RULE_MODES, ELEMENT_CATALOG, BUILTIN_PROFILES, validate, migrate, compile });
  root.DebateProfileSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

(function initDebateProfileSchema(root) {
  'use strict';
  const VERSION = 4;
  const ELEMENT_CATALOG = Object.freeze({
    positions: { purpose: 'Collect independent positions.', output: ['claim'] },
    critique: { purpose: 'Challenge material claims.', output: ['objection'] },
    response: { purpose: 'Answer an objection with evidence or revision.', output: ['evidence', 'revision'] },
    verification: { purpose: 'Independently verify evidence and revisions.', output: ['evidence', 'axis_verdict'] },
    synthesis: { purpose: 'Produce a dissent-preserving synthesis.', output: ['synthesis_conclusion'] },
    synthesis_audit: { purpose: 'Audit the current synthesis against StateMap.', output: ['audit'] },
    human_gate: { purpose: 'Request an explicit human decision.', output: ['human_decision'] }
  });
  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze); return Object.freeze(value);
  };
  const base = (input) => freeze({
    schemaVersion: VERSION, engineRange: '^1', promptPack: { id: 'disput-core', version: '3.1.0' },
    version: '1.0.0', status: 'validated', taskTypes: ['general'],
    roles: ['participant', 'critic', 'verifier', 'synthesizer', 'auditor', 'human'],
    stages: ['positions', 'critique', 'response', 'verification', 'synthesis', 'synthesis_audit'],
    rules: [], progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
    policies: { mode: 'assisted', ruleMode: 'control', preserveDissent: true, mapAlwaysAvailable: true, modelSelfReportControlsFlow: false, reserveFinalizationBudget: true, modelSignals: 'shadow' },
    ...input
  });
  const BUILTIN_PROFILES = freeze({
    UNIVERSAL_STANDARD: base({ id: 'UNIVERSAL_STANDARD', title: 'Universal', rules: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'] }),
    UNIVERSAL_RESEARCH: base({ id: 'UNIVERSAL_RESEARCH', title: 'Research', taskTypes: ['research'], rules: ['UNCRITICIZED_CLAIM', 'FACT_DISPUTE', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'CONTRADICTION', 'CONTEXT_PRESSURE', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'], extensionContract: { artifactTypes: ['source', 'finding'], axes: ['source_quality', 'coverage'], tools: ['web_research'], mapSections: ['sources', 'findings'] } }),
    UNIVERSAL_RED_TEAM: base({ id: 'UNIVERSAL_RED_TEAM', title: 'Red Team', taskTypes: ['red_team'], rules: ['UNCRITICIZED_CLAIM', 'BLOCKING_OBJECTION', 'WEAK_EVIDENCE', 'REVISION_RECHECK', 'CONTRADICTION', 'ACTIVE_DISSENT', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'] }),
    DEEP_RESEARCH_ALPHA: base({ id: 'DEEP_RESEARCH_ALPHA', title: 'Deep Research', taskTypes: ['research'], parentProfileId: 'UNIVERSAL_RESEARCH@1.0.0', rules: ['FACT_DISPUTE', 'WEAK_EVIDENCE', 'CONTEXT_PRESSURE', 'READY_FOR_SYNTHESIS', 'SYNTHESIS_AUDIT'], extensionContract: { artifactTypes: ['source', 'finding'], axes: ['source_quality', 'coverage'], tools: ['web_research'], mapSections: ['sources', 'findings'] } })
  });
  function validate(profile = {}) {
    const errors = [];
    if (Number(profile.schemaVersion) !== VERSION) errors.push('profile_schema_version_invalid');
    if (!String(profile.id || '')) errors.push('profile_id_missing');
    if (!/^\d+\.\d+\.\d+$/.test(String(profile.version || ''))) errors.push('profile_version_invalid');
    if (!Array.isArray(profile.roles) || !profile.roles.length) errors.push('profile_roles_missing');
    if (!Array.isArray(profile.stages) || !profile.stages.length) errors.push('profile_stages_missing');
    (profile.stages || []).forEach((id) => { if (!ELEMENT_CATALOG[id]) errors.push(`profile_stage_unknown:${id}`); });
    if (profile.policies?.mapAlwaysAvailable !== true) errors.push('profile_map_required');
    if (profile.policies?.modelSelfReportControlsFlow !== false) errors.push('profile_self_report_flow_forbidden');
    return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
  }
  function migrate(profile = {}) {
    return freeze({ ...profile, schemaVersion: VERSION, promptPack: { id: 'disput-core', version: '3.1.0' }, policies: { ...base({}).policies, ...(profile.policies || {}) } });
  }
  function compile(profile, input = {}) {
    const verdict = validate(profile); if (!verdict.ok) throw new Error(`Invalid Debate profile: ${verdict.errors.join(', ')}`);
    return freeze({ schemaVersion: VERSION, profileId: profile.id, profileVersion: profile.version, promptPack: profile.promptPack, problemSpec: input.problemSpec || {}, assignments: input.assignments || {}, budget: input.budget || {}, policies: profile.policies, roles: profile.roles, stages: profile.stages.map((id, index) => ({ id: `profile:${index + 1}:${id}`, elementId: id, ...ELEMENT_CATALOG[id] })), rules: profile.rules || [], progressPolicy: profile.progressPolicy, extensionContract: profile.extensionContract || null });
  }
  const api = Object.freeze({ VERSION, ELEMENT_CATALOG, BUILTIN_PROFILES, validate, migrate, compile });
  root.DebateProfileSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

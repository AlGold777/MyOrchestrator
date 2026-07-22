// Structural validation for immutable Debate execution plans.
(function initDebatePlanValidator(root) {
  'use strict';

  const Types = root.DebateStageTypes || (typeof require === 'function' ? require('./debate-stage-types') : null);
  const allowedKinds = new Set(Object.values(Types?.KINDS || {}));
  const allowedTabs = new Set(Object.values(Types?.TAB_POLICIES || {}));
  const Catalog = root.DebatePromptCatalog || (typeof require === 'function' ? require('./debate-prompt-catalog') : null);
  const knownContracts = new Set(Catalog?.KNOWN_PROMPT_CONTRACTS || ['duel_openings','duel_public_turn','duel_final_words','duel_final_synthesis','round_filter','triad_openings','triad_wave','triad_final_words','triad_final_synthesis','multi_openings','multi_wave','multi_final_words','multi_final_synthesis','synthesis_audit']);
  const Artifacts = root.DebateArtifactDefinitions || (typeof require === 'function' ? require('./debate-artifact-definitions') : null);
  const Contracts = root.DebateContracts || (typeof require === 'function' ? require('./debate-contracts') : null);
  const completionPolicies = new Set(['all_required_answers', 'any_answer', 'quorum']);
  const failurePolicies = new Set(['fail_run', 'ask_user', 'skip_stage']);

  function validate(plan = {}) {
    const errors = []; const warnings = [];
    const stages = Array.isArray(plan.stages) ? plan.stages : [];
    if (!String(plan.planId || '').trim()) errors.push('plan_id_missing');
    if (!['duel', 'triad', 'multi', 'free_talk'].includes(String(plan.topology || ''))) errors.push('topology_invalid');
    if (!['auto', 'manual'].includes(String(plan.runPolicy || ''))) errors.push('run_policy_invalid');
    if (String(plan.synthesizer || '').trim().toLowerCase() === 'auto') errors.push('synthesizer_auto_forbidden');

    if (!stages.length) errors.push('stages_missing');
    if (Contracts && (!plan.taskContract || Contracts.validateTaskContract?.(plan.taskContract)?.ok !== true)) errors.push('task_contract_invalid');
    if (!String(plan.promptPack?.id || '').trim() || !String(plan.promptPack?.version || '').trim()) errors.push('plan_prompt_pack_missing');

    const ids = new Set();
    const produced = new Set();
    let synthesisCount = 0; const seenParticipants = new Set();
    stages.forEach((stage, index) => {
      const id = String(stage?.stageId || '');
      if (!id) errors.push(`stage_${index}_id_missing`);
      else if (ids.has(id)) errors.push(`stage_id_duplicate:${id}`);
      else ids.add(id);
      if (!allowedKinds.has(stage?.kind)) errors.push(`stage_kind_invalid:${id || index}`);
      if (!allowedTabs.has(stage?.tabPolicy)) errors.push(`tab_policy_invalid:${id || index}`);
      if (!String(stage?.purpose || '').trim()) errors.push(`purpose_missing:${id || index}`);
      if (Contracts && (!stage?.stageContract || Contracts.validateStageContract?.(stage.stageContract)?.ok !== true)) errors.push(`stage_contract_invalid:${id || index}`);
      if (!knownContracts.has(stage?.promptContract)) errors.push(`prompt_contract_invalid:${id || index}`);
      if (!completionPolicies.has(stage?.completionPolicy)) errors.push(`completion_policy_invalid:${id || index}`);
      if (!failurePolicies.has(stage?.failurePolicy)) errors.push(`failure_policy_invalid:${id || index}`);
      if (!Array.isArray(stage?.participants) || !stage.participants.length) errors.push(`participants_missing:${id || index}`);
      (stage?.participants || []).forEach((participant) => seenParticipants.add(participant));
      (stage?.inputs || []).forEach((artifactId) => {
        if (!produced.has(artifactId)) errors.push(`artifact_without_producer:${id}:${artifactId}`);
      });
      (stage?.outputs || []).forEach((artifactId) => produced.add(artifactId));
      if (stage?.kind === Types?.KINDS?.ROUND_FILTER) {
        const idsToCheck = (stage.outputs || []).map((value) => String(value).replace(/^r\d+:/, ''));
        (Artifacts?.listUndefined(idsToCheck) || []).filter((artifactId) => !String(artifactId).startsWith('artifact_')).forEach((artifactId) => errors.push(`artifact_undefined:${artifactId}`));
      }
      if (stage?.kind === Types?.KINDS?.FINAL_SYNTHESIS) synthesisCount += 1;
      if (index < stages.length - 1 && stage?.nextStageId !== stages[index + 1]?.stageId) {
        errors.push(`next_stage_mismatch:${id || index}`);
      }
      if (index === stages.length - 1 && stage?.nextStageId != null) errors.push(`terminal_next_stage_present:${id || index}`);
    });
    const expectsSynthesis = Boolean(String(plan.synthesizer || '').trim());
    if (synthesisCount !== (expectsSynthesis ? 1 : 0)) errors.push(`final_synthesis_count:${synthesisCount}`);
    const terminalKind = stages.at(-1)?.kind;
    if (expectsSynthesis && ![Types?.KINDS?.FINAL_SYNTHESIS, Types?.KINDS?.SYNTHESIS_AUDIT].includes(terminalKind)) errors.push('final_synthesis_not_terminal');
    const final = stages.at(-1);
    const synthesis = stages.find((stage) => stage?.kind === Types?.KINDS?.FINAL_SYNTHESIS);
    if (synthesis && !synthesis.inputs?.length) errors.push('synthesis_inputs_missing');
    if (terminalKind === Types?.KINDS?.SYNTHESIS_AUDIT && !final?.inputs?.length) errors.push('synthesis_audit_inputs_missing');
    (plan.participants || []).forEach((participant) => { if (!seenParticipants.has(participant)) errors.push(`participant_never_scheduled:${participant}`); });
    const suffix = String(plan.reasoningBudget?.comparableSuffix || '').toLowerCase();
    if (suffix.includes('red') && !Object.values(plan.roles || {}).some((role) => String(role).includes('critical'))) warnings.push('no_critic_assigned');
    if (plan.synthesizer && Object.values(plan.roles || {}).filter((role) => role === 'critical').length === 1 && plan.roles?.[plan.synthesizer] === 'critical') warnings.push('synthesizer_not_independent');
    const filters = stages.filter((stage) => stage.kind === Types?.KINDS?.ROUND_FILTER);
    if (filters.length === 0 && stages.some((stage) => stage.kind === Types?.KINDS?.OPENING_BATCH || stage.kind === Types?.KINDS?.WAVE_BATCH) && (plan.presetId || '').includes('STANDARD')) warnings.push('artifacts_without_filter');
    const defenceArtifactStage = stages.find((stage) => /defence|patch/i.test(`${stage.promptContract} ${stage.outputs?.join(' ')}`));
    const retestArtifactStage = stages.find((stage) => /retest/i.test(`${stage.promptContract} ${stage.outputs?.join(' ')}`));
    const participantStageFor = (artifactStage) => {
      if (!artifactStage) return null;
      if (artifactStage.kind !== Types?.KINDS?.ROUND_FILTER) return artifactStage;
      return stages.find((stage) => Number(stage.round) === Number(artifactStage.round)
        && [Types?.KINDS?.OPENING_BATCH, Types?.KINDS?.WAVE_BATCH, Types?.KINDS?.PUBLIC_TURN].includes(stage.kind)) || artifactStage;
    };
    const defence = participantStageFor(defenceArtifactStage);
    const retest = participantStageFor(retestArtifactStage);
    if (defence && retest && (defence.participants || []).some((participant) => (retest.participants || []).includes(participant)) && !plan.acceptSelfRetest) warnings.push('retest_not_independent');
    const result = { ok: errors.length === 0, errors: Object.freeze(errors) };
    if (warnings.length) result.warnings = Object.freeze(warnings);
    return Object.freeze(result);
  }

  function assertValid(plan) {
    const verdict = validate(plan);
    if (!verdict.ok) throw new Error(`Invalid Debate execution plan: ${verdict.errors.join(', ')}`);
    return plan;
  }

  const api = Object.freeze({ validate, assertValid });
  root.DebatePlanValidator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

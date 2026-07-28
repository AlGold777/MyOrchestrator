// Typed evidence-tier, finalization-policy and replay engine.
(function initProofTelemetryPolicy(root) {
  'use strict';

  const contracts = () => root.ProofTelemetryContracts || (typeof require === 'function' ? require('./proof-telemetry-contracts.js') : null);
  const AUTOMATIC_MINIMUM_EVIDENCE_TIER = 3;

  function sameScope(left, right) {
    return contracts()?.sameIncidentScope?.(left, right) === true;
  }

  function scopedEvents(events, target) {
    return (Array.isArray(events) ? events : []).filter((event) => sameScope(event, target));
  }

  function facts(events) {
    return events.map((event) => ({ event, fact: contracts()?.factOf?.(event) || { kind: 'unknown', state: 'unknown' } }));
  }

  function latestFact(entries, kind) {
    return [...entries].reverse().find((entry) => entry.fact.kind === kind) || null;
  }

  function observationReliable(events) {
    const threshold = Number(contracts()?.THRESHOLDS?.maximumSignalSkewMs ?? 250);
    return !events.some((event) => {
      const fact = contracts()?.factOf?.(event);
      if (fact?.kind === 'observation' && fact.state === 'degraded') return true;
      if (event.eventType !== 'OBSERVATION_FRAME_CAPTURED') return false;
      const meta = event?.payload?.metadata || {};
      if (meta.contentScriptAvailable === false || meta.contentScriptAvailable === 'unknown') return true;
      if (meta.tabDiscarded === true || meta.timerThrottlingSuspected === true) return true;
      return !Number.isFinite(Number(meta.maximumSignalSkewMs)) || Number(meta.maximumSignalSkewMs) > threshold;
    });
  }

  function evidenceTier(events, target = events[events.length - 1]) {
    if (!target) return 0;
    const scoped = scopedEvents(events, target);
    const entries = facts(scoped);
    if (entries.some(({ fact }) => fact.kind === 'provider_terminal' && fact.state === 'completed')) return 4;
    const strongTransition = entries.some(({ fact }) => fact.kind === 'generation_transition' && fact.strong === true);
    const currentIdentity = entries.some(({ fact }) => fact.kind === 'candidate_identity' && fact.state === 'current_dispatch');
    if (strongTransition && currentIdentity && observationReliable(scoped)) return 3;
    const stable = entries.some(({ fact }) => fact.kind === 'text' && fact.state === 'stable');
    const indirect = new Set(entries
      .filter(({ fact }) => fact.kind === 'completion_indirect' && fact.state === 'satisfied')
      .map(({ fact }) => fact.signal));
    if (stable && indirect.size >= 2 && observationReliable(scoped)) return 2;
    if (stable || entries.some(({ fact }) => ['completion_hypothesis', 'deadline', 'terminal_action'].includes(fact.kind))) return 1;
    return 0;
  }

  function deriveAxes(events, target = events[events.length - 1]) {
    if (!target) return root.ProofOrientedTelemetry?.deriveAxes?.([]) || {};
    const scoped = scopedEvents(events, target);
    const entries = facts(scoped);
    const latestSubmission = latestFact(entries, 'submission')?.fact;
    const latestIdentity = latestFact(entries, 'candidate_identity')?.fact;
    const latestGeneration = [...entries].reverse().find(({ fact }) => ['generation', 'generation_transition', 'terminal_action', 'text'].includes(fact.kind))?.fact;
    const latestVerification = latestFact(entries, 'verification')?.fact;
    const latestExtraction = latestFact(entries, 'extraction')?.fact;
    const deadline = entries.some(({ fact }) => fact.kind === 'deadline' && fact.state === 'reached');
    const terminal = latestFact(entries, 'terminal_action')?.fact;
    const tier = evidenceTier(scoped, target);
    const textFacts = entries.filter(({ fact }) => fact.kind === 'text').map(({ fact }) => fact);
    const completionHypothesis = latestFact(entries, 'completion_hypothesis')?.fact;
    const providerTerminal = latestFact(entries, 'provider_terminal')?.fact;
    const started = entries.some(({ fact }) => fact.kind === 'generation_start' && fact.state === 'started')
      || entries.some(({ fact }) => fact.kind === 'generation');
    return {
      submission: latestSubmission?.state === 'confirmed' ? 'confirmed' : latestSubmission?.state === 'failed' ? 'failed' : latestSubmission ? 'evidence_partial' : 'not_attempted',
      generationStart: started ? 'started' : latestSubmission?.state === 'confirmed' ? 'not_started' : 'not_evaluated',
      answerIdentity: latestIdentity?.state || (started ? 'candidate' : 'none'),
      observedGeneration: terminal ? 'inactive' : latestGeneration?.state === 'provider_ui_completed' ? 'inactive' : latestGeneration?.state === 'active' ? 'active' : latestGeneration?.state === 'stable' ? 'quiescent' : started ? 'unknown' : 'not_started',
      textEvolution: textFacts.some((fact) => fact.state === 'regressed') ? 'regressed' : latestGeneration?.state === 'active' ? 'changing' : textFacts.some((fact) => fact.state === 'stable') ? 'stable' : 'none',
      answerCompleteness: tier >= 3 ? 'probably_complete' : terminal ? 'unknown' : 'not_evaluated',
      extraction: latestExtraction?.state || (started ? 'candidate' : 'none'),
      verification: latestVerification?.state || (started ? 'pending' : 'none'),
      completionDetection: providerTerminal ? 'provider_complete' : tier >= 3 ? 'inferred_complete' : completionHypothesis ? 'probably_complete' : terminal ? 'inconclusive' : latestGeneration?.state === 'active' ? 'probably_active' : 'not_evaluated',
      completionEvidenceTier: tier,
      observationReliability: observationReliable(scoped) ? 'reliable' : 'degraded',
      finalization: terminal ? 'accepted' : deadline ? 'retry_scheduled' : 'not_evaluated',
      terminalMode: terminal ? (deadline ? 'forced' : 'automatic') : 'none',
      terminationCause: terminal ? (deadline ? 'policy_forced' : providerTerminal || tier >= 3 ? 'provider_completed' : 'unknown') : 'unknown'
    };
  }

  function evaluateFinalization(events, target) {
    const axes = deriveAxes(events, target);
    const contradictions = [];
    if (axes.observedGeneration === 'active') contradictions.push('generation_still_active');
    if (axes.answerCompleteness === 'probably_truncated') contradictions.push('answer_probably_truncated');
    if (axes.observationReliability !== 'reliable') contradictions.push('observation_degraded');
    const rules = [
      { ruleId: 'submission_confirmed', passed: axes.submission === 'confirmed', observed: axes.submission },
      { ruleId: 'answer_identity_current_dispatch', passed: axes.answerIdentity === 'current_dispatch', observed: axes.answerIdentity },
      { ruleId: 'observation_reliable', passed: axes.observationReliability === 'reliable', observed: axes.observationReliability },
      { ruleId: 'generation_not_active', passed: axes.observedGeneration !== 'active', observed: axes.observedGeneration },
      { ruleId: 'structural_verification', passed: axes.verification === 'verified', observed: axes.verification },
      { ruleId: 'minimum_evidence_tier', passed: axes.completionEvidenceTier >= AUTOMATIC_MINIMUM_EVIDENCE_TIER, observed: axes.completionEvidenceTier, expected: AUTOMATIC_MINIMUM_EVIDENCE_TIER },
      { ruleId: 'no_high_severity_contradiction', passed: contradictions.length === 0, observed: contradictions }
    ];
    return {
      allowed: rules.every((rule) => rule.passed),
      evidenceTier: axes.completionEvidenceTier,
      rules,
      blockers: rules.filter((rule) => !rule.passed).map((rule) => rule.ruleId),
      contradictions,
      stateAxes: axes
    };
  }

  function safeDecisionOutcome(event) {
    const metadata = event?.payload?.metadata || {};
    if (typeof metadata.decisionAccepted === 'boolean') return metadata.decisionAccepted;
    if (typeof metadata.accepted === 'boolean') return metadata.accepted;
    return null;
  }

  function planCompanions(sourceEvent, eventsIncludingSource) {
    const companions = [];
    const evidenceRefs = [sourceEvent.eventId];
    const axes = () => deriveAxes(eventsIncludingSource, sourceEvent);
    if (sourceEvent.eventType === 'SUBMISSION_EVIDENCE_CHANGED') companions.push({ eventType: 'SUBMISSION_INFERRED', layer: 'inference', evidenceRefs, payload: { submission: axes().submission } });
    if (sourceEvent.eventType === 'GENERATION_SIGNAL_CHANGED') companions.push({ eventType: 'GENERATION_STATE_INFERRED', layer: 'inference', evidenceRefs, payload: { observedGeneration: axes().observedGeneration } });
    if (sourceEvent.eventType === 'CANDIDATE_SET_CHANGED') companions.push({ eventType: 'CANDIDATE_IDENTITY_INFERRED', layer: 'inference', evidenceRefs, payload: { answerIdentity: axes().answerIdentity } });
    if (sourceEvent.eventType === 'COMPLETION_HYPOTHESIS_EVALUATED') companions.push({ eventType: 'ANSWER_COMPLETENESS_EVALUATED', layer: 'inference', evidenceRefs, payload: { answerCompleteness: axes().answerCompleteness, completionEvidenceTier: axes().completionEvidenceTier } });
    if (sourceEvent.eventType === 'TERMINAL_DEADLINE_REACHED') {
      const evaluation = evaluateFinalization(eventsIncludingSource, sourceEvent);
      companions.push({ eventType: 'POLICY_OVERRIDE_APPLIED', layer: 'decision', evidenceRefs, payload: { trigger: 'terminal_deadline', mode: 'forced', waivedRules: evaluation.blockers, residualRisk: 'completion_not_proven' } });
    }
    if (sourceEvent.eventType === 'FINALIZATION_POLICY_EVALUATED') {
      const evaluation = evaluateFinalization(eventsIncludingSource, sourceEvent);
      const explicit = safeDecisionOutcome(sourceEvent);
      const accepted = explicit === null ? evaluation.allowed : explicit;
      const forced = accepted && !evaluation.allowed;
      if (forced) companions.push({ eventType: 'POLICY_OVERRIDE_APPLIED', layer: 'decision', evidenceRefs, payload: { trigger: 'accepted_below_automatic_policy', mode: 'forced', waivedRules: evaluation.blockers, residualRisk: 'automatic_completion_not_proven' } });
      companions.push({ eventType: 'DECISION_RECORDED', layer: 'decision', evidenceRefs, payload: { accepted, mode: forced ? 'forced' : 'automatic', evidenceTier: evaluation.evidenceTier, blockers: evaluation.blockers, rules: evaluation.rules } });
    }
    return companions;
  }

  function normalizedDecision(event) {
    const payload = event?.payload?.decision || event?.payload?.metadata?.decision || event?.payload?.metadata || event?.payload || {};
    return { modelId: event.modelId, dispatchId: event.dispatchId || null, accepted: payload.accepted === true, mode: payload.mode || 'automatic', evidenceTier: Number(payload.evidenceTier || 0), blockers: Array.isArray(payload.blockers) ? payload.blockers.slice().sort() : [] };
  }

  function replay(events = []) {
    const ordered = (Array.isArray(events) ? events.slice() : []).sort((left, right) => Number(left.ingestSeq || left.seq) - Number(right.ingestSeq || right.seq));
    const models = {}, invariantViolations = [], recordedDecisions = [], recomputedDecisions = [];
    ordered.forEach((event, index) => {
      const through = ordered.slice(0, index + 1);
      if (!models[event.modelId]) models[event.modelId] = {};
      models[event.modelId].stateAxes = deriveAxes(through, event);
      models[event.modelId].throughSeq = event.seq;
      if (event.eventType === 'DECISION_RECORDED') {
        const recorded = normalizedDecision(event);
        recordedDecisions.push(recorded);
        const policyEvent = [...through].reverse().find((candidate) => candidate.eventType === 'FINALIZATION_POLICY_EVALUATED' && sameScope(candidate, event));
        if (!policyEvent) {
          recomputedDecisions.push(recorded);
          invariantViolations.push({ invariantId: 'S06', eventId: event.eventId, message: 'decision has no preceding policy evaluation' });
        } else {
          const evaluation = evaluateFinalization(through.filter((candidate) => Number(candidate.seq) <= Number(policyEvent.seq)), policyEvent);
          recomputedDecisions.push({ modelId: event.modelId, dispatchId: event.dispatchId || null, accepted: recorded.mode === 'forced' ? recorded.accepted : evaluation.allowed, mode: recorded.mode, evidenceTier: evaluation.evidenceTier, blockers: evaluation.blockers.slice().sort() });
        }
      }
      if (event.eventType === 'MODEL_TERMINAL_RECORDED') {
        const linked = [...through].reverse().find((candidate) => candidate.eventType === 'DECISION_RECORDED' && sameScope(candidate, event));
        if (!linked || !(event.evidenceRefs || []).includes(linked.eventId)) invariantViolations.push({ invariantId: 'S06', eventId: event.eventId, message: 'terminal does not reference its decision' });
        if (models[event.modelId].stateAxes.terminalMode === 'forced') {
          const override = [...through].reverse().find((candidate) => candidate.eventType === 'POLICY_OVERRIDE_APPLIED' && sameScope(candidate, event));
          if (!override) invariantViolations.push({ invariantId: 'S07', eventId: event.eventId, message: 'forced terminal has no policy override' });
        }
      }
    });
    return { models, recordedDecisions, recomputedDecisions, invariantViolations };
  }

  const api = Object.freeze({ AUTOMATIC_MINIMUM_EVIDENCE_TIER, sameScope, evidenceTier, deriveAxes, evaluateFinalization, planCompanions, replay });
  root.ProofTelemetryPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

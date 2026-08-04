// Typed evidence-tier, finalization-policy and replay engine.
(function initProofTelemetryPolicy(root) {
  'use strict';

  const contracts = () => root.ProofTelemetryContracts || (typeof require === 'function' ? require('./proof-telemetry-contracts.js') : null);
  const AUTOMATIC_MINIMUM_EVIDENCE_TIER = 3;
  const AXIS_PROVENANCE_VERSION = 'state-axes-provenance@1.1.0';

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

  function uniqueEventIds(entries = []) {
    return Array.from(new Set(entries.filter(Boolean).map((entry) => entry.event || entry)
      .map((event) => event?.eventId).filter(Boolean)));
  }

  function provenance(layer, ruleId, entries = []) {
    return {
      layer,
      basisEventIds: uniqueEventIds(entries),
      ruleId,
      derivationVersion: AXIS_PROVENANCE_VERSION
    };
  }

  function sourceLayer(entry, fallback = 'inference') {
    const layer = entry?.event?.layer;
    return ['fact', 'inference', 'decision', 'audit'].includes(layer) ? layer : fallback;
  }

  function observationReliability(events) {
    const threshold = Number(contracts()?.THRESHOLDS?.maximumSignalSkewMs ?? 250);
    const frames = events.filter((event) => event.eventType === 'OBSERVATION_FRAME_CAPTURED');
    const explicitlyUnavailable = events.some((event) => {
      const fact = contracts()?.factOf?.(event);
      const source = contracts()?.sourceType?.(event) || '';
      return fact?.state === 'unavailable' || /TAB_CLOSED|OBSERVER.*UNAVAILABLE/.test(source);
    });
    if (explicitlyUnavailable) return 'unavailable';
    const explicitlyStale = events.some((event) => {
      const fact = contracts()?.factOf?.(event);
      const source = contracts()?.sourceType?.(event) || '';
      return fact?.state === 'stale' || /OBSERVER.*STALE|STALE_OBSERVATION/.test(source);
    });
    if (explicitlyStale) return 'stale';
    const explicitlyDegraded = events.some((event) => {
      const fact = contracts()?.factOf?.(event);
      if (fact?.kind === 'observation' && fact.state === 'degraded') return true;
      if (event.eventType !== 'OBSERVATION_FRAME_CAPTURED') return false;
      const meta = event?.payload?.metadata || {};
      if (meta.contentScriptAvailable === false || meta.contentScriptAvailable === 'unknown') return true;
      if (meta.tabDiscarded === true || meta.timerThrottlingSuspected === true) return true;
      return !Number.isFinite(Number(meta.maximumSignalSkewMs)) || Number(meta.maximumSignalSkewMs) > threshold;
    });
    if (explicitlyDegraded) return 'degraded';
    if (!frames.length) return 'unknown';
    return 'reliable';
  }

  function evidenceTier(events, target = events[events.length - 1]) {
    if (!target) return 0;
    const scoped = scopedEvents(events, target);
    const entries = facts(scoped);
    if (entries.some(({ fact }) => fact.kind === 'provider_terminal' && fact.state === 'completed')) return 4;
    const strongTransition = entries.some(({ fact }) => fact.kind === 'generation_transition' && fact.strong === true);
    const currentIdentity = entries.some(({ fact }) => fact.kind === 'candidate_identity' && fact.state === 'current_dispatch');
    if (strongTransition && currentIdentity && observationReliability(scoped) === 'reliable') return 3;
    const stable = entries.some(({ fact }) => fact.kind === 'text' && fact.state === 'stable');
    const indirect = new Set(entries
      .filter(({ fact }) => fact.kind === 'completion_indirect' && fact.state === 'satisfied')
      .map(({ fact }) => fact.signal));
    if (stable && indirect.size >= 2 && observationReliability(scoped) === 'reliable') return 2;
    if (stable || entries.some(({ fact }) => ['completion_hypothesis', 'deadline', 'terminal_action'].includes(fact.kind))) return 1;
    return 0;
  }

  function evidenceTierDerivation(entries, scoped) {
    const providerTerminal = entries.find(({ fact }) => fact.kind === 'provider_terminal' && fact.state === 'completed');
    if (providerTerminal) return { value: 4, provenance: provenance(sourceLayer(providerTerminal, 'fact'), 'provider-terminal-completed', [providerTerminal]) };
    const strongTransition = entries.find(({ fact }) => fact.kind === 'generation_transition' && fact.strong === true);
    const currentIdentity = entries.find(({ fact }) => fact.kind === 'candidate_identity' && fact.state === 'current_dispatch');
    const reliability = observationReliabilityDerivation(entries, scoped);
    if (strongTransition && currentIdentity && reliability.value === 'reliable') {
      return { value: 3, provenance: provenance('inference', 'strong-transition-current-identity-reliable-observation', [strongTransition, currentIdentity, ...reliability.basis]) };
    }
    const stable = entries.find(({ fact }) => fact.kind === 'text' && fact.state === 'stable');
    const indirectBySignal = new Map();
    entries.forEach((entry) => {
      if (entry.fact.kind === 'completion_indirect' && entry.fact.state === 'satisfied' && !indirectBySignal.has(entry.fact.signal)) indirectBySignal.set(entry.fact.signal, entry);
    });
    if (stable && indirectBySignal.size >= 2 && reliability.value === 'reliable') {
      return { value: 2, provenance: provenance('inference', 'stable-text-two-indirect-signals-reliable-observation', [stable, ...indirectBySignal.values(), ...reliability.basis]) };
    }
    const weak = stable || entries.find(({ fact }) => ['completion_hypothesis', 'deadline', 'terminal_action'].includes(fact.kind));
    if (weak) return { value: 1, provenance: provenance('inference', 'weak-completion-evidence', [weak]) };
    return { value: 0, provenance: provenance('audit', 'no-completion-evidence', []) };
  }

  function observationReliabilityDerivation(entries, scoped) {
    const threshold = Number(contracts()?.THRESHOLDS?.maximumSignalSkewMs ?? 250);
    const unavailable = entries.find((entry) => entry.fact?.state === 'unavailable'
      || /TAB_CLOSED|OBSERVER.*UNAVAILABLE/.test(contracts()?.sourceType?.(entry.event) || ''));
    if (unavailable) return { value: 'unavailable', basis: [unavailable], provenance: provenance(sourceLayer(unavailable, 'fact'), 'observer-explicitly-unavailable', [unavailable]) };
    const stale = entries.find((entry) => entry.fact?.state === 'stale'
      || /OBSERVER.*STALE|STALE_OBSERVATION/.test(contracts()?.sourceType?.(entry.event) || ''));
    if (stale) return { value: 'stale', basis: [stale], provenance: provenance(sourceLayer(stale, 'fact'), 'observer-explicitly-stale', [stale]) };
    const degraded = entries.find((entry) => {
      if (entry.fact?.kind === 'observation' && entry.fact.state === 'degraded') return true;
      if (entry.event?.eventType !== 'OBSERVATION_FRAME_CAPTURED') return false;
      const meta = entry.event?.payload?.metadata || {};
      return meta.contentScriptAvailable === false || meta.contentScriptAvailable === 'unknown'
        || meta.tabDiscarded === true || meta.timerThrottlingSuspected === true
        || !Number.isFinite(Number(meta.maximumSignalSkewMs)) || Number(meta.maximumSignalSkewMs) > threshold;
    });
    if (degraded) return { value: 'degraded', basis: [degraded], provenance: provenance(sourceLayer(degraded, 'fact'), 'observer-frame-degraded', [degraded]) };
    const frames = entries.filter((entry) => entry.event?.eventType === 'OBSERVATION_FRAME_CAPTURED');
    if (!frames.length) return { value: 'unknown', basis: [], provenance: provenance('audit', 'no-observation-frame', []) };
    return { value: 'reliable', basis: frames, provenance: provenance('audit', 'all-observation-frames-within-policy', frames) };
  }

  function deriveAxesWithProvenance(events, target = events[events.length - 1]) {
    if (!target) {
      const stateAxes = root.ProofOrientedTelemetry?.deriveAxes?.([]) || {};
      return { stateAxes, stateAxesProvenance: Object.fromEntries(Object.keys(stateAxes).map((axis) => [axis, provenance('audit', `empty-scope-${axis}`, [])])) };
    }
    const scoped = scopedEvents(events, target);
    const entries = facts(scoped);
    const latestSubmission = latestFact(entries, 'submission');
    const latestIdentity = latestFact(entries, 'candidate_identity');
    const latestGeneration = [...entries].reverse().find(({ fact }) => ['generation', 'generation_transition', 'terminal_action', 'text'].includes(fact.kind)) || null;
    const latestVerification = latestFact(entries, 'verification');
    const latestExtraction = latestFact(entries, 'extraction');
    const deadline = entries.find(({ fact }) => fact.kind === 'deadline' && fact.state === 'reached') || null;
    const terminal = latestFact(entries, 'terminal_action');
    const tier = evidenceTierDerivation(entries, scoped);
    const regressed = entries.find(({ fact }) => fact.kind === 'text' && fact.state === 'regressed') || null;
    const stable = entries.find(({ fact }) => fact.kind === 'text' && fact.state === 'stable') || null;
    const completionHypothesis = latestFact(entries, 'completion_hypothesis');
    const providerTerminal = latestFact(entries, 'provider_terminal');
    const startFact = entries.find(({ fact }) => fact.kind === 'generation_start' && fact.state === 'started')
      || entries.find(({ fact }) => fact.kind === 'generation') || null;
    const started = Boolean(startFact);
    const reliability = observationReliabilityDerivation(entries, scoped);
    const stateAxes = {};
    const stateAxesProvenance = {};
    const set = (axis, value, layer, ruleId, basis = []) => {
      stateAxes[axis] = value;
      stateAxesProvenance[axis] = provenance(layer, ruleId, basis);
    };

    if (latestSubmission) set('submission', latestSubmission.fact.state === 'confirmed' ? 'confirmed' : latestSubmission.fact.state === 'failed' ? 'failed' : 'evidence_partial', sourceLayer(latestSubmission), 'latest-submission-evidence', [latestSubmission]);
    else set('submission', 'not_attempted', 'audit', 'no-submission-evidence', []);
    if (startFact) set('generationStart', 'started', sourceLayer(startFact, 'fact'), 'generation-start-observed', [startFact]);
    else if (latestSubmission?.fact.state === 'confirmed') set('generationStart', 'not_started', 'inference', 'submission-confirmed-without-generation-start', [latestSubmission]);
    else set('generationStart', 'not_evaluated', 'audit', 'generation-start-not-evaluable', latestSubmission ? [latestSubmission] : []);
    if (latestIdentity) set('answerIdentity', latestIdentity.fact.state, sourceLayer(latestIdentity), 'latest-candidate-identity', [latestIdentity]);
    else if (started) set('answerIdentity', 'candidate', 'inference', 'generation-start-implies-candidate', [startFact]);
    else set('answerIdentity', 'none', 'audit', 'no-candidate-evidence', []);
    if (terminal) set('observedGeneration', 'inactive', 'decision', 'terminal-action-closes-generation', [terminal]);
    else if (latestGeneration?.fact.state === 'provider_ui_completed') set('observedGeneration', 'inactive', sourceLayer(latestGeneration, 'fact'), 'provider-ui-completed', [latestGeneration]);
    else if (latestGeneration?.fact.state === 'active') set('observedGeneration', 'active', sourceLayer(latestGeneration, 'fact'), 'latest-generation-active', [latestGeneration]);
    else if (latestGeneration?.fact.state === 'stable') set('observedGeneration', 'quiescent', sourceLayer(latestGeneration, 'fact'), 'latest-generation-stable', [latestGeneration]);
    else if (started) set('observedGeneration', 'unknown', 'inference', 'generation-started-without-current-state', [startFact]);
    else set('observedGeneration', 'not_started', 'audit', 'generation-not-started', []);
    if (regressed) set('textEvolution', 'regressed', sourceLayer(regressed, 'fact'), 'text-regression-observed', [regressed]);
    else if (latestGeneration?.fact.state === 'active') set('textEvolution', 'changing', sourceLayer(latestGeneration, 'fact'), 'active-generation-implies-changing-text', [latestGeneration]);
    else if (stable) set('textEvolution', 'stable', sourceLayer(stable, 'fact'), 'stable-text-observed', [stable]);
    else set('textEvolution', 'none', 'audit', 'no-text-evolution-evidence', []);
    if (tier.value >= 3) set('answerCompleteness', 'probably_complete', 'inference', 'completion-evidence-tier-threshold', tier.provenance.basisEventIds.map((eventId) => scoped.find((event) => event.eventId === eventId)));
    else if (terminal) set('answerCompleteness', 'unknown', 'decision', 'terminal-without-completion-proof', [terminal, ...tier.provenance.basisEventIds.map((eventId) => scoped.find((event) => event.eventId === eventId))]);
    else set('answerCompleteness', 'not_evaluated', 'audit', 'completion-not-evaluable', tier.provenance.basisEventIds.map((eventId) => scoped.find((event) => event.eventId === eventId)));
    if (latestExtraction) set('extraction', latestExtraction.fact.state, sourceLayer(latestExtraction), 'latest-extraction-result', [latestExtraction]);
    else if (started) set('extraction', 'candidate', 'inference', 'generation-started-without-extraction', [startFact]);
    else set('extraction', 'none', 'audit', 'no-extraction-evidence', []);
    if (latestVerification) set('verification', latestVerification.fact.state, sourceLayer(latestVerification), 'latest-verification-result', [latestVerification]);
    else if (started) set('verification', 'pending', 'inference', 'generation-started-verification-pending', [startFact]);
    else set('verification', 'none', 'audit', 'no-verification-evidence', []);
    if (providerTerminal) set('completionDetection', 'provider_complete', sourceLayer(providerTerminal, 'fact'), 'provider-terminal-signal', [providerTerminal]);
    else if (tier.value >= 3) set('completionDetection', 'inferred_complete', 'inference', 'completion-evidence-tier-threshold', tier.provenance.basisEventIds.map((eventId) => scoped.find((event) => event.eventId === eventId)));
    else if (completionHypothesis) set('completionDetection', 'probably_complete', sourceLayer(completionHypothesis, 'inference'), 'completion-hypothesis', [completionHypothesis]);
    else if (terminal) set('completionDetection', 'inconclusive', 'decision', 'terminal-without-completion-detection', [terminal]);
    else if (latestGeneration?.fact.state === 'active') set('completionDetection', 'probably_active', 'inference', 'active-generation-without-completion', [latestGeneration]);
    else set('completionDetection', 'not_evaluated', 'audit', 'completion-detection-not-evaluable', []);
    stateAxes.completionEvidenceTier = tier.value;
    stateAxesProvenance.completionEvidenceTier = tier.provenance;
    stateAxes.observationReliability = reliability.value;
    stateAxesProvenance.observationReliability = reliability.provenance;
    if (terminal) set('finalization', 'accepted', 'decision', 'terminal-action-accepted', [terminal]);
    else if (deadline) set('finalization', 'retry_scheduled', 'decision', 'terminal-deadline-reached', [deadline]);
    else set('finalization', 'not_evaluated', 'audit', 'finalization-not-evaluated', []);
    if (terminal) set('terminalMode', deadline ? 'forced' : 'automatic', 'decision', deadline ? 'deadline-forced-terminal' : 'automatic-terminal', deadline ? [terminal, deadline] : [terminal]);
    else set('terminalMode', 'none', 'audit', 'no-terminal-action', []);
    if (!terminal) set('terminationCause', 'unknown', 'audit', 'no-terminal-action', []);
    else if (deadline) set('terminationCause', 'policy_forced', 'decision', 'deadline-forced-termination', [terminal, deadline]);
    else if (providerTerminal || tier.value >= 3) set('terminationCause', 'provider_completed', 'inference', providerTerminal ? 'provider-terminal-caused-termination' : 'completion-tier-caused-termination', [terminal, ...(providerTerminal ? [providerTerminal] : tier.provenance.basisEventIds.map((eventId) => scoped.find((event) => event.eventId === eventId)))]);
    else set('terminationCause', 'unknown', 'decision', 'terminal-cause-unproven', [terminal]);
    return { stateAxes, stateAxesProvenance };
  }

  function deriveAxes(events, target = events[events.length - 1]) {
    return deriveAxesWithProvenance(events, target).stateAxes;
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
    // Identity was only ever inferred when a candidate was *rejected* as stale or
    // ambiguous. A materialized answer carries the identity the extractor resolved
    // it to, so the positive resolution is stated too — otherwise
    // `answer_identity_current_dispatch` can never pass, however good the evidence.
    if (sourceEvent.eventType === 'ANSWER_SOURCE_MATERIALIZED') {
      const resolvedIdentity = sourceEvent?.payload?.metadata?.answerIdentity;
      if (resolvedIdentity) {
        companions.push({
          eventType: 'CANDIDATE_IDENTITY_INFERRED',
          layer: 'inference',
          evidenceRefs,
          payload: { answerIdentity: String(resolvedIdentity) }
        });
      }
    }
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

  const api = Object.freeze({ AUTOMATIC_MINIMUM_EVIDENCE_TIER, AXIS_PROVENANCE_VERSION, sameScope, evidenceTier, deriveAxes, deriveAxesWithProvenance, evaluateFinalization, planCompanions, replay });
  root.ProofTelemetryPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

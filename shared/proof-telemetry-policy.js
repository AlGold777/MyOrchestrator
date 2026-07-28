// shared/proof-telemetry-policy.js
// Pure evidence-tier, finalization-policy and replay engine for schema 5.

(function initProofTelemetryPolicy(root) {
  'use strict';

  const AUTOMATIC_MINIMUM_EVIDENCE_TIER = 3;

  function sourceType(event) {
    return String(event?.payload?.sourceEventType || '').toUpperCase();
  }

  function sameScope(left, right) {
    if (!left || !right) return false;
    if (String(left.runSessionId) !== String(right.runSessionId)) return false;
    if (String(left.modelId) !== String(right.modelId)) return false;
    if (left.dispatchId && right.dispatchId && String(left.dispatchId) !== String(right.dispatchId)) return false;
    return true;
  }

  function scopedEvents(events, target) {
    return (Array.isArray(events) ? events : []).filter((event) => sameScope(event, target));
  }

  function has(events, pattern) {
    return events.some((event) => pattern.test(`${event.eventType} ${sourceType(event)}`));
  }

  function evidenceTier(events, target = events[events.length - 1]) {
    const scoped = scopedEvents(events, target);
    const providerTerminal = has(scoped, /PROVIDER_COMPLETE|FINISH_REASON|PROVIDER_TERMINAL|TERMINAL_MARKER/);
    if (providerTerminal) return 4;
    const strongUiTransition = has(scoped, /STOP_(BUTTON_)?(PRESENT_TO_ABSENT|DISAPPEARED)|STREAMING_(TRUE_TO_FALSE|STOPPED)|COMPLETION_CONTROLS_APPEARED/);
    const identityVerified = has(scoped, /CANDIDATE_IDENTITY_INFERRED|TURN_RESOLUTION|ANSWER_VERIFICATION/);
    if (strongUiTransition && identityVerified) return 3;
    const completed = has(scoped, /ANSWER_COMPLETE_DETECTED|COMPLETION_HYPOTHESIS_EVALUATED/);
    const verified = has(scoped, /STRUCTURAL_VERIFICATION_EVALUATED|ANSWER_VERIFICATION_(RECORDED|RESULT)/)
      && !has(scoped, /VERIFICATION_(REJECTED|FAILED)|ANSWER_VERIFICATION.*(REJECT|FAIL)/);
    if (completed && verified) return 3;
    const stable = has(scoped, /ANSWER_TEXT_STABLE|STABILITY_INTERVAL_CLOSED/);
    const idle = has(scoped, /MUTATION_IDLE|GENERATION_INACTIVE|LOADING_ABSENT|COMPOSER_READY/);
    if (stable && (idle || has(scoped, /MODEL_TERMINAL_RECORDED|MODEL_FINAL/))) return 2;
    if (stable || completed || has(scoped, /TIMEOUT|MODEL_TERMINAL_RECORDED|MODEL_FINAL/)) return 1;
    return 0;
  }

  function deriveAxes(events, target = events[events.length - 1]) {
    const scoped = scopedEvents(events, target);
    const fallback = root.ProofOrientedTelemetry?.deriveAxes?.(scoped) || {};
    const latest = (pattern) => [...scoped].reverse().find((event) => pattern.test(`${event.eventType} ${sourceType(event)}`));
    const latestGeneration = latest(/GENERATION_SIGNAL_CHANGED|ANSWER_GENERATING|ANSWER_TEXT_STABLE|ANSWER_COMPLETE_DETECTED|MODEL_TERMINAL_RECORDED|MODEL_FINAL/);
    const generationSource = latestGeneration ? `${latestGeneration.eventType} ${sourceType(latestGeneration)}` : '';
    const observedGeneration = /MODEL_TERMINAL|MODEL_FINAL|ANSWER_COMPLETE/.test(generationSource) ? 'inactive'
      : /ANSWER_TEXT_STABLE/.test(generationSource) ? 'quiescent'
        : /ANSWER_GENERATING|GENERATION_SIGNAL_CHANGED/.test(generationSource) ? 'active'
          : fallback.observedGeneration;
    const identity = has(scoped, /CANDIDATE.*AMBIGUOUS|MULTIPLE_CANDIDATES/) ? 'ambiguous'
      : has(scoped, /STALE_BASELINE|CANDIDATE.*STALE/) ? 'stale'
        : has(scoped, /PROMPT_ECHO_REJECTED|CANDIDATE.*REJECTED/) ? 'rejected'
          : fallback.answerIdentity;
    const frames = scoped.filter((event) => event.eventType === 'OBSERVATION_FRAME_CAPTURED');
    const degradedFrame = frames.some((event) => {
      const meta = event?.payload?.metadata || {};
      return Number(meta.maximumSignalSkewMs || 0) > 1000
        || meta.timerThrottlingSuspected === true
        || meta.contentScriptAvailable === false
        || meta.tabDiscarded === true;
    });
    const observerFailure = has(scoped, /FOCUS_STUCK|SCRIPT_HEALTH_FAIL|OBSERVER.*(FAIL|UNAVAILABLE)|BACKGROUND_THROTTL|SELECTOR.*(FAIL|MISS)/);
    const textEvents = scoped.filter((event) => /TEXT_STATE_CHANGED|ANSWER_(GENERATING|TEXT_STABLE|LENGTH_DECREASED)|RESPONSE/.test(`${event.eventType} ${sourceType(event)}`));
    let textEvolution = fallback.textEvolution;
    if (textEvents.length >= 2) {
      const previousMeta = textEvents[textEvents.length - 2]?.payload?.metadata || {};
      const latestMeta = textEvents[textEvents.length - 1]?.payload?.metadata || {};
      const previousLength = Number(previousMeta.textLength || previousMeta.answerLength || 0);
      const latestLength = Number(latestMeta.textLength || latestMeta.answerLength || 0);
      const previousHash = previousMeta.textHash || previousMeta.answerHash || null;
      const latestHash = latestMeta.textHash || latestMeta.answerHash || null;
      if (latestLength < previousLength) textEvolution = 'regressed';
      else if (latestHash && previousHash && latestHash !== previousHash) textEvolution = 'changing';
    }
    return {
      ...fallback,
      answerIdentity: identity,
      observedGeneration,
      textEvolution,
      observationReliability: degradedFrame || observerFailure ? 'degraded' : fallback.observationReliability,
      completionEvidenceTier: evidenceTier(scoped, target)
    };
  }

  function evaluateFinalization(events, target) {
    const axes = deriveAxes(events, target);
    const tier = axes.completionEvidenceTier;
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
      { ruleId: 'minimum_evidence_tier', passed: tier >= AUTOMATIC_MINIMUM_EVIDENCE_TIER, observed: tier, expected: AUTOMATIC_MINIMUM_EVIDENCE_TIER },
      { ruleId: 'no_high_severity_contradiction', passed: contradictions.length === 0, observed: contradictions }
    ];
    const blockers = rules.filter((rule) => !rule.passed).map((rule) => rule.ruleId);
    return {
      allowed: blockers.length === 0,
      evidenceTier: tier,
      rules,
      blockers,
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
    if (sourceEvent.eventType === 'SUBMISSION_EVIDENCE_CHANGED') {
      companions.push({
        eventType: 'SUBMISSION_INFERRED',
        layer: 'inference',
        evidenceRefs,
        payload: { submission: deriveAxes(eventsIncludingSource, sourceEvent).submission }
      });
    }
    if (sourceEvent.eventType === 'GENERATION_SIGNAL_CHANGED') {
      companions.push({
        eventType: 'GENERATION_STATE_INFERRED',
        layer: 'inference',
        evidenceRefs,
        payload: { observedGeneration: deriveAxes(eventsIncludingSource, sourceEvent).observedGeneration }
      });
    }
    if (sourceEvent.eventType === 'COMPLETION_HYPOTHESIS_EVALUATED') {
      companions.push({
        eventType: 'ANSWER_COMPLETENESS_EVALUATED',
        layer: 'inference',
        evidenceRefs,
        payload: {
          answerCompleteness: deriveAxes(eventsIncludingSource, sourceEvent).answerCompleteness,
          completionEvidenceTier: evidenceTier(eventsIncludingSource, sourceEvent)
        }
      });
    }
    if (sourceEvent.eventType === 'TERMINAL_DEADLINE_REACHED') {
      companions.push({
        eventType: 'POLICY_OVERRIDE_APPLIED',
        layer: 'decision',
        evidenceRefs,
        payload: {
          trigger: sourceType(sourceEvent),
          mode: 'forced',
          waivedRules: evaluateFinalization(eventsIncludingSource, sourceEvent).blockers,
          residualRisk: 'completion_not_proven'
        }
      });
    }
    if (sourceEvent.eventType === 'FINALIZATION_POLICY_EVALUATED') {
      const evaluation = evaluateFinalization(eventsIncludingSource, sourceEvent);
      const explicitlyAccepted = safeDecisionOutcome(sourceEvent);
      const accepted = explicitlyAccepted === null ? evaluation.allowed : explicitlyAccepted;
      const forced = accepted && !evaluation.allowed;
      if (forced) {
        companions.push({
          eventType: 'POLICY_OVERRIDE_APPLIED',
          layer: 'decision',
          evidenceRefs,
          payload: {
            trigger: 'accepted_below_automatic_policy',
            mode: 'forced',
            waivedRules: evaluation.blockers,
            residualRisk: 'automatic_completion_not_proven'
          }
        });
      }
      companions.push({
        eventType: 'DECISION_RECORDED',
        layer: 'decision',
        evidenceRefs,
        payload: {
          accepted,
          mode: forced ? 'forced' : 'automatic',
          evidenceTier: evaluation.evidenceTier,
          blockers: evaluation.blockers,
          rules: evaluation.rules
        }
      });
    }
    return companions;
  }

  function normalizedDecision(event) {
    const payload = event?.payload?.decision || event?.payload?.metadata?.decision || event?.payload?.metadata || event?.payload || {};
    return {
      modelId: event.modelId,
      dispatchId: event.dispatchId || null,
      accepted: payload.accepted === true,
      mode: payload.mode || 'automatic',
      evidenceTier: Number(payload.evidenceTier || 0),
      blockers: Array.isArray(payload.blockers) ? payload.blockers.slice().sort() : []
    };
  }

  function replay(events = []) {
    const ordered = (Array.isArray(events) ? events.slice() : []).sort((left, right) => left.seq - right.seq);
    const models = {};
    const invariantViolations = [];
    const recordedDecisions = [];
    const recomputedDecisions = [];
    ordered.forEach((event, index) => {
      const through = ordered.slice(0, index + 1);
      if (!models[event.modelId]) models[event.modelId] = {};
      models[event.modelId].stateAxes = deriveAxes(through, event);
      models[event.modelId].throughSeq = event.seq;
      if (event.eventType === 'DECISION_RECORDED') {
        const recorded = normalizedDecision(event);
        recordedDecisions.push(recorded);
        const policyEvent = [...through].reverse().find((candidate) => candidate.eventType === 'FINALIZATION_POLICY_EVALUATED' && sameScope(candidate, event));
        if (policyEvent) {
          const evaluation = evaluateFinalization(through.filter((candidate) => candidate.seq <= policyEvent.seq), policyEvent);
          recomputedDecisions.push({
            modelId: event.modelId,
            dispatchId: event.dispatchId || null,
            accepted: recorded.mode === 'forced' ? recorded.accepted : evaluation.allowed,
            mode: recorded.mode,
            evidenceTier: evaluation.evidenceTier,
            blockers: evaluation.blockers.slice().sort()
          });
        } else {
          recomputedDecisions.push(recorded);
          invariantViolations.push({ invariantId: 'S06', eventId: event.eventId, message: 'decision has no preceding policy evaluation' });
        }
      }
      if (event.eventType === 'MODEL_TERMINAL_RECORDED') {
        const linkedDecision = [...through].reverse().find((candidate) => candidate.eventType === 'DECISION_RECORDED' && sameScope(candidate, event));
        if (!linkedDecision || !(event.evidenceRefs || []).includes(linkedDecision.eventId)) {
          invariantViolations.push({ invariantId: 'S06', eventId: event.eventId, message: 'terminal does not reference its decision' });
        }
        const axes = models[event.modelId].stateAxes;
        if (axes.terminalMode === 'forced') {
          const override = [...through].reverse().find((candidate) => candidate.eventType === 'POLICY_OVERRIDE_APPLIED' && sameScope(candidate, event));
          if (!override) invariantViolations.push({ invariantId: 'S07', eventId: event.eventId, message: 'forced terminal has no policy override' });
        }
      }
    });
    return { models, recordedDecisions, recomputedDecisions, invariantViolations };
  }

  const api = Object.freeze({
    AUTOMATIC_MINIMUM_EVIDENCE_TIER,
    sameScope,
    evidenceTier,
    deriveAxes,
    evaluateFinalization,
    planCompanions,
    replay
  });
  root.ProofTelemetryPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

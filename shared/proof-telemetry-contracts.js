// Executable schema 6 contracts for incident-oriented proof telemetry.
(function initProofTelemetryContracts(root) {
  'use strict';

  const EVENT_SCHEMA_VERSION = 6;
  const CLOCK_CONTRACT_VERSION = '1.0';
  const REGISTRY_VERSION = '6.1.0';
  const THRESHOLDS = Object.freeze({
    generationStartTimeoutMs: 15000,
    minimumExtractionCoveragePct: 98,
    postTerminalGrowthTolerancePct: 0.5,
    lateEndPolicyToleranceMs: 1000,
    automaticMinimumEvidenceTier: 3,
    maximumSignalSkewMs: 250
  });

  const LEGACY_EMPTY_CONTRACT = Object.freeze({
    question: 'Почему генерация была, но extraction вернул пусто или не тот узел?',
    refutationModel: 'complement',
    refutation: { any: [['$.derivedViews.extractionProblemEvidence', 'eq', false]] },
    applicability: {
      all: [
        ['$.derivedViews.generationTextObserved', 'eq', true],
        ['$.derivedViews.extractionProblemEvidence', 'eq', true]
      ]
    },
    slots: [
      ['generation_observed', 'critical', ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED']],
      ['extraction_result', 'critical', ['EXTRACTION_COMPLETED']],
      ['candidate_selection', 'critical', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED']],
      ['text_boundary', 'critical', ['TEXT_STATE_CHANGED', 'OBSERVATION_FRAME_CAPTURED']],
      ['structural_verification', 'required', ['STRUCTURAL_VERIFICATION_EVALUATED', 'ANSWER_COMPLETENESS_EVALUATED']],
      ['observer_context', 'conditional', ['PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED'], ['$.stateAxes.observationReliability', 'in', ['degraded', 'stale', 'unavailable']]]
    ]
  });
  const LEGACY_REPORT_CONTRACTS = Object.freeze({
    '5.6.0': Object.freeze({ empty: LEGACY_EMPTY_CONTRACT }),
    '5.7.0': Object.freeze({ empty: LEGACY_EMPTY_CONTRACT }),
    '5.8.0': Object.freeze({ empty: LEGACY_EMPTY_CONTRACT }),
    '5.9.0': Object.freeze({ empty: LEGACY_EMPTY_CONTRACT }),
    '6.0.0': Object.freeze({ empty: LEGACY_EMPTY_CONTRACT })
  });

  function contractFor(reportType, registryVersion = null) {
    if (REPORT_CONTRACTS[reportType]) return REPORT_CONTRACTS[reportType];
    if (registryVersion && LEGACY_REPORT_CONTRACTS[registryVersion]?.[reportType]) {
      return LEGACY_REPORT_CONTRACTS[registryVersion][reportType];
    }
    return reportType === 'empty' ? LEGACY_EMPTY_CONTRACT : null;
  }

  const REPORT_CONTRACTS = Object.freeze({
    cutted: {
      question: 'Почему зафиксирован SUCCESS, а текст явно неполный?',
      refutationModel: 'complement',
      refutation: {
        any: [
          ['$.derivedViews.incompleteCaptureEvidence', 'eq', false]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.terminalOutcome', 'eq', 'SUCCESS'],
          ['$.derivedViews.incompleteCaptureEvidence', 'eq', true]
        ]
      },
      slots: [
        ['success_terminal', 'critical', ['MODEL_TERMINAL_RECORDED']],
        ['text_evolution', 'critical', ['TEXT_STATE_CHANGED']],
        ['completeness', 'critical', ['ANSWER_COMPLETENESS_EVALUATED', 'POST_TERMINAL_AUDIT_COMPLETED']],
        ['extraction_boundary', 'required', ['EXTRACTION_COMPLETED', 'STRUCTURAL_VERIFICATION_EVALUATED']],
        ['candidate_identity', 'required', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED']],
        ['decision_lineage', 'required', ['DECISION_RECORDED']],
        ['finalization_policy', 'conditional', ['FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED'], ['$.stateAxes.terminalMode', 'in', ['forced', 'recovery']]],
        ['missing_evidence', 'conditional', ['MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'false-success': {
      question: 'Почему система решила «готово», а ответ продолжил расти?',
      refutationModel: 'complement',
      refutation: {
        any: [
          ['$.derivedViews.postTerminalGrowthProven', 'eq', false]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.terminalOutcome', 'eq', 'SUCCESS'],
          ['$.derivedViews.postTerminalGrowthProven', 'eq', true]
        ]
      },
      slots: [
        ['success_terminal', 'critical', ['MODEL_TERMINAL_RECORDED']],
        ['post_terminal_audit', 'critical', ['POST_TERMINAL_AUDIT_COMPLETED']],
        ['terminal_decision', 'required', ['DECISION_RECORDED']],
        ['generation_state', 'required', ['GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED']],
        ['post_terminal_mutation', 'required', ['TEXT_STATE_CHANGED']],
        ['completion_proof', 'conditional', ['COMPLETION_HYPOTHESIS_EVALUATED', 'ANSWER_COMPLETENESS_EVALUATED'], ['$.stateAxes.terminalMode', 'eq', 'automatic']],
        ['finalization_policy', 'conditional', ['TERMINAL_DEADLINE_REACHED', 'FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED'], ['$.stateAxes.terminalMode', 'in', ['forced', 'recovery']]],
        ['missing_evidence', 'conditional', ['MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'old-answer': {
      question: 'Почему принят текст от предыдущего запроса?',
      refutationModel: 'independent_terminal_outcome',
      refutation: {
        any: [
          ['$.derivedViews.terminalOutcome', 'ne', 'SUCCESS']
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.terminalOutcome', 'eq', 'SUCCESS'],
          ['$.derivedViews.oldAnswerEvidence', 'eq', true]
        ]
      },
      slots: [
        ['dispatch_baseline', 'critical', ['DISPATCH_BASELINE_CAPTURED']],
        ['prior_incident_evidence', 'required', ['MODEL_TERMINAL_RECORDED', 'EXTRACTION_COMPLETED']],
        ['candidate_identity', 'critical', ['CANDIDATE_IDENTITY_INFERRED']],
        ['extraction_result', 'critical', ['EXTRACTION_COMPLETED']],
        ['accepted_answer_boundary', 'critical', ['MODEL_TERMINAL_RECORDED']],
        ['candidate_lineage', 'required', ['CANDIDATE_SET_CHANGED']],
        ['turn_context', 'required', ['PAGE_CONTEXT_OBSERVED', 'OBSERVATION_FRAME_CAPTURED']],
        ['structural_verification', 'required', ['STRUCTURAL_VERIFICATION_EVALUATED']],
        ['text_boundary', 'conditional', ['TEXT_STATE_CHANGED']],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'no-delivery': {
      question: 'Почему материализованный ответ текущего запроса не оказался в правильной карточке?',
      refutationModel: 'independent_delivery_confirmation',
      refutation: {
        any: [
          ['$.derivedViews.noDeliveryEvidence', 'eq', false]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.noDeliveryEvidence', 'eq', true]
        ]
      },
      slots: [
        ['incident_identity', 'critical', ['ANSWER_SOURCE_MATERIALIZED']],
        ['source_answer_materialized', 'critical', ['ANSWER_SOURCE_MATERIALIZED']],
        ['expected_card_binding', 'critical', ['ANSWER_CARD_RENDER_EVALUATED']],
        ['card_delivery_outcome', 'critical', ['ANSWER_CARD_RENDER_EVALUATED']],
        ['source_to_card_comparison', 'critical', ['ANSWER_CARD_RENDER_EVALUATED']],
        ['delivery_boundary', 'required', ['ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_DELIVERY_REJECTED']],
        ['commit_boundary', 'required', ['ANSWER_COMMIT_EVALUATED']],
        ['extraction_boundary', 'conditional', ['EXTRACTION_ATTEMPTED', 'EXTRACTION_COMPLETED']],
        ['terminal_boundary', 'conditional', ['MODEL_TERMINAL_RECORDED']],
        ['observer_context', 'conditional', ['OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'prompt-not-inserted': {
      question: 'Почему prompt не вставился в поле ввода?',
      refutationModel: 'independent_positive_delivery_evidence',
      refutation: {
        any: [
          ['$.derivedViews.promptInsertedCounterEvidence', 'eq', true]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.promptNotInsertedEvidence', 'eq', true]
        ]
      },
      slots: [
        ['dispatch_baseline', 'critical', ['DISPATCH_BASELINE_CAPTURED']],
        ['insertion_outcome', 'critical', ['PROMPT_INSERTION_EVALUATED']],
        ['composer_context', 'required', ['PAGE_HEALTH_OBSERVED', 'OBSERVATION_FRAME_CAPTURED']],
        ['submit_counterevidence', 'conditional', ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED'], ['$.derivedViews.submitActionObserved', 'eq', true]],
        ['absence_observation_window', 'critical', ['OBSERVATION_INTERVAL_CLOSED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_FRAME_CAPTURED', 'PAGE_HEALTH_OBSERVED']],
        ['observer_context', 'conditional', ['OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_SLOT_DENIED'], ['$.stateAxes.observationReliability', 'in', ['degraded', 'stale', 'unavailable']]]
      ]
    },
    'prompt-not-sent': {
      question: 'Почему модель не получила запрос?',
      refutationModel: 'independent_positive_delivery_evidence',
      refutation: {
        any: [
          ['$.derivedViews.promptReceivedCounterEvidence', 'eq', true]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.promptNotSentEvidence', 'eq', true]
        ]
      },
      slots: [
        ['dispatch_baseline', 'critical', ['DISPATCH_BASELINE_CAPTURED']],
        ['submit_action', 'critical', ['SUBMIT_ACTION_OBSERVED']],
        ['acceptance_evidence', 'critical', ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED']],
        ['page_context', 'required', ['PAGE_CONTEXT_OBSERVED', 'PAGE_HEALTH_OBSERVED']],
        ['absence_observation_window', 'critical', ['OBSERVATION_INTERVAL_CLOSED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_FRAME_CAPTURED', 'PAGE_HEALTH_OBSERVED']],
        ['observer_context', 'conditional', ['OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_SLOT_DENIED'], ['$.stateAxes.observationReliability', 'in', ['degraded', 'stale', 'unavailable']]]
      ]
    },
    'late-end': {
      question: 'Текст давно стабилен — почему система ждала ещё N секунд?',
      refutationModel: 'complement',
      refutation: {
        any: [
          ['$.derivedViews.lateEndEvidence', 'eq', false]
        ]
      },
      applicability: {
        all: [
          ['$.derivedViews.lateEndEvidence', 'eq', true]
        ]
      },
      slots: [
        ['candidate_identity', 'critical', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED']],
        ['stable_boundary', 'critical', ['STABILITY_INTERVAL_CLOSED']],
        ['terminal_boundary', 'critical', ['MODEL_TERMINAL_RECORDED']],
        ['generation_state', 'critical', ['GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED']],
        ['text_evolution', 'critical', ['TEXT_STATE_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'OBSERVATION_INTERVAL_CLOSED']],
        ['completion_policy', 'required', ['COMPLETION_HYPOTHESIS_EVALUATED', 'FINALIZATION_POLICY_EVALUATED', 'TERMINAL_DEADLINE_REACHED']],
        ['decision_lineage', 'required', ['DECISION_RECORDED']],
        ['observer_context', 'conditional', ['OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_SLOT_DENIED'], ['$.stateAxes.observationReliability', 'in', ['degraded', 'stale', 'unavailable']]],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    }
  });

  const SLOT_MATCH_RULES = Object.freeze({
    'cutted.success_terminal': { fact: { kind: 'terminal_action', states: ['success'] } },
    'false-success.success_terminal': { fact: { kind: 'terminal_action', states: ['success'] } },
    'false-success.post_terminal_audit': {
      temporal: {
        afterEventType: 'MODEL_TERMINAL_RECORDED',
        requiresEvidenceRefTypes: ['MODEL_TERMINAL_RECORDED'],
        requiresPostBoundaryEvidenceRef: true
      }
    },
    'old-answer.candidate_identity': { fact: { kind: 'candidate_identity', states: ['previous', 'previous_dispatch', 'stale', 'stale_accepted'] } },
    'old-answer.extraction_result': { fact: { kind: 'extraction', states: ['completed'] } },
    'old-answer.accepted_answer_boundary': { fact: { kind: 'terminal_action', states: ['success'] } },
    'no-delivery.incident_identity': { fact: { kind: 'source_answer', states: ['materialized'] } },
    'no-delivery.source_answer_materialized': { fact: { kind: 'source_answer', states: ['materialized'] } },
    'no-delivery.expected_card_binding': { fact: { kind: 'render', states: ['matched', 'empty', 'mismatched', 'wrong_card', 'incomparable'] } },
    'no-delivery.card_delivery_outcome': { fact: { kind: 'render', states: ['matched', 'empty', 'mismatched', 'wrong_card', 'incomparable'] } },
    'no-delivery.source_to_card_comparison': { fact: { kind: 'render', states: ['matched', 'empty', 'mismatched', 'wrong_card', 'incomparable'] } },
    'prompt-not-inserted.insertion_outcome': { fact: { kind: 'prompt_insertion', states: ['failed', 'inserted', 'confirmed'] } },
    'prompt-not-sent.acceptance_evidence': { fact: { kind: 'submission', states: ['confirmed', 'failed'] } },
    'late-end.stable_boundary': { fact: { kind: 'text', states: ['stable'] }, temporal: { closestBeforeEventType: 'MODEL_TERMINAL_RECORDED' } },
    'late-end.terminal_boundary': { fact: { kind: 'terminal_action', states: ['success', 'failure', 'error', 'timeout'] } }
  });

  const REPORT_COUNTEREVIDENCE_TYPES = Object.freeze({
    cutted: ['TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED'],
    'false-success': ['MODEL_TERMINAL_RECORDED', 'TEXT_STATE_CHANGED', 'GENERATION_SIGNAL_CHANGED', 'POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED'],
    'old-answer': ['CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED', 'DECISION_RECORDED'],
    empty: ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'CANDIDATE_IDENTITY_INFERRED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'MISSING_EVIDENCE_RECORDED'],
    'no-delivery': ['ANSWER_SOURCE_MATERIALIZED', 'ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_DELIVERY_REJECTED', 'ANSWER_COMMIT_EVALUATED', 'ANSWER_CARD_RENDER_EVALUATED', 'MODEL_TERMINAL_RECORDED', 'MISSING_EVIDENCE_RECORDED'],
    'prompt-not-inserted': ['PROMPT_INSERTION_EVALUATED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    'prompt-not-sent': ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    'late-end': ['STABILITY_INTERVAL_CLOSED', 'TEXT_STATE_CHANGED', 'GENERATION_SIGNAL_CHANGED', 'DECISION_RECORDED', 'TERMINAL_DEADLINE_REACHED', 'FINALIZATION_POLICY_EVALUATED', 'MODEL_TERMINAL_RECORDED']
  });

  function sourceType(event) {
    return String(event?.payload?.sourceEventType || event?.payload?.metadata?.sourceEventType || '').toUpperCase();
  }

  // All legacy string interpretation is confined to this migration boundary.
  function adaptLegacyEvent(event) {
    const source = sourceType(event);
    const meta = event?.payload?.metadata || {};
    const typed = { kind: 'unknown', state: 'unknown' };
    const messageType = String(meta.messageType || '').toUpperCase();
    if (/SENDER_(?:WITHOUT_BINDING|TAB_MISMATCH)_REJECTED|LIFECYCLE_CORRELATION_REJECTED/.test(source)
      && /^(?:LLM_RESPONSE|FINAL_LLM_RESPONSE|ANSWER_SNAPSHOT)/.test(messageType)) {
      return { kind: 'delivery', state: 'rejected', outcome: 'rejected' };
    }
    if (/CANDIDATE.*AMBIGUOUS|MULTIPLE_CANDIDATES/.test(source)) return { kind: 'candidate_identity', state: 'ambiguous' };
    if (/STALE_BASELINE|CANDIDATE.*STALE/.test(source)) return { kind: 'candidate_identity', state: 'stale' };
    if (/PROMPT_ECHO_REJECTED|CANDIDATE.*REJECTED/.test(source)) return { kind: 'candidate_identity', state: 'rejected' };
    if (/TURN_RESOLUTION_ACCEPTED|CURRENT_DISPATCH/.test(source) || meta.answerIdentity === 'current_dispatch') return { kind: 'candidate_identity', state: 'current_dispatch' };
    if (/PROMPT_SUBMITTED_ACCEPTED|SUBMISSION_CONFIRMED/.test(source)) return { kind: 'submission', state: 'confirmed' };
    if (/PROMPT_SUBMITTED_REJECTED|DISPATCH_COMMAND_NOT_ACCEPTED|NO_SEND/.test(source)) return { kind: 'submission', state: 'failed' };
    if (/PROMPT_INSERTION_FAILED|PROMPT_INJECTION_FAILED|INJECTION_FAILED/.test(source)) return { kind: 'prompt_insertion', state: 'failed' };
    if (/PROMPT_INSERTION_(?:CONFIRMED|SUCCEEDED)|PROMPT_INSERTED/.test(source)) return { kind: 'prompt_insertion', state: 'inserted' };
    if (/^(?:DISPATCH_START|DISPATCH_SEND|ROUND2_REPAIR_DISPATCH_START)$/.test(source)) return { kind: 'submission', state: 'attempted' };
    if (/STOP_(BUTTON_)?(PRESENT_TO_ABSENT|DISAPPEARED)|STREAMING_(TRUE_TO_FALSE|STOPPED)|COMPLETION_CONTROLS_APPEARED/.test(source)) return { kind: 'generation_transition', state: 'provider_ui_completed', strong: true };
    if (/ANSWER_GENERATING|STREAMING_START|GENERATION_ACTIVE/.test(source)) return { kind: 'generation', state: 'active' };
    if (/ANSWER_TEXT_STABLE|STABILITY/.test(source)) return { kind: 'text', state: 'stable' };
    if (/ANSWER_START|LIFECYCLE.*GENERAT/.test(source)) return { kind: 'generation_start', state: 'started' };
    if (/ANSWER_COMPLETE_DETECTED/.test(source)) return { kind: 'completion_hypothesis', state: 'probably_complete' };
    if (/MUTATION_IDLE/.test(source)) return { kind: 'completion_indirect', signal: 'mutation_idle', state: 'satisfied' };
    if (/LOADING_ABSENT/.test(source)) return { kind: 'completion_indirect', signal: 'loading_absent', state: 'satisfied' };
    if (/COMPOSER_READY/.test(source)) return { kind: 'completion_indirect', signal: 'composer_ready', state: 'satisfied' };
    if (/GENERATION_INACTIVE/.test(source)) return { kind: 'completion_indirect', signal: 'generation_inactive', state: 'satisfied' };
    if (/PROVIDER_COMPLETE|FINISH_REASON|PROVIDER_TERMINAL|TERMINAL_MARKER/.test(source)) return { kind: 'provider_terminal', state: 'completed' };
    if (/ANSWER_VERIFICATION_(RECORDED|RESULT)|STRUCTURAL_VERIFICATION/.test(source)) return { kind: 'verification', state: meta.verified === false ? 'rejected' : 'verified' };
    if (/TIMEOUT|DEADLINE/.test(source)) return { kind: 'deadline', state: 'reached' };
    if (/MODEL_FINAL/.test(source)) return { kind: 'terminal_action', state: String(meta.finalStatus || meta.terminalStatus || 'unknown').toUpperCase() };
    if (/SCRIPT_HEALTH_FAIL|OBSERVER.*(FAIL|UNAVAILABLE)|BACKGROUND_THROTTL|SELECTOR.*(FAIL|MISS)|FOCUS_STUCK/.test(source)) return { kind: 'observation', state: 'degraded' };
    if (/^EXTRACTION_.*FAIL/.test(source)) return { kind: 'extraction', state: 'failed', outcome: 'failed' };
    if (/^DOM_FALLBACK_(?:START|JOINED)$/.test(source)) return { kind: 'extraction_attempt', state: source.endsWith('START') ? 'started' : 'joined', mode: 'fallback' };
    if (source === 'DOM_FALLBACK_SUCCESS') return { kind: 'extraction', state: 'completed', outcome: 'completed', mode: 'fallback' };
    if (source === 'DOM_FALLBACK_TIMEOUT') return { kind: 'extraction', state: 'failed', outcome: 'failed', mode: 'fallback' };
    return typed;
  }

  function factOf(event) {
    const typed = event?.payload?.typed;
    const canonical = canonicalFactOf(event);
    const typedKind = String(typed?.kind || '').trim().toLowerCase();
    const typedState = String(typed?.state || '').trim().toLowerCase();
    if (typed && typeof typed === 'object' && typedKind && typedKind !== 'unknown'
      && typedState && typedState !== 'unknown') return typed;
    return canonical || adaptLegacyEvent(event);
  }

  function canonicalFactOf(event) {
    const payload = event?.payload || {};
    return ({
      SUBMISSION_INFERRED: { kind: 'submission', state: payload.submission || 'unknown' },
      PROMPT_INSERTION_EVALUATED: { kind: 'prompt_insertion', state: payload.insertionState || payload.metadata?.insertionState || 'unknown' },
      GENERATION_STATE_INFERRED: { kind: 'generation', state: payload.observedGeneration || 'unknown' },
      CANDIDATE_IDENTITY_INFERRED: { kind: 'candidate_identity', state: payload.answerIdentity || 'unknown' },
      ANSWER_COMPLETENESS_EVALUATED: { kind: 'answer_completeness', state: payload.answerCompleteness || 'unknown' },
      STRUCTURAL_VERIFICATION_EVALUATED: { kind: 'verification', state: payload.verified === false ? 'rejected' : (payload.verification || 'verified') },
      COMPLETION_HYPOTHESIS_EVALUATED: { kind: 'completion_hypothesis', state: payload.completionDetection || 'evaluated' },
      EXTRACTION_ATTEMPTED: { kind: 'extraction_attempt', state: payload.status || payload.typed?.state || 'started' },
      EXTRACTION_COMPLETED: { kind: 'extraction', state: payload.status || 'completed' },
      ANSWER_DELIVERY_REJECTED: { kind: 'delivery', state: 'rejected' },
      ANSWER_DELIVERY_ACKNOWLEDGED: { kind: 'delivery', state: payload.outcome || payload.metadata?.outcome || 'accepted' },
      ANSWER_SOURCE_MATERIALIZED: { kind: 'source_answer', state: 'materialized' },
      ANSWER_COMMIT_EVALUATED: { kind: 'commit', state: payload.outcome || payload.metadata?.outcome || 'unknown' },
      ANSWER_CARD_RENDER_EVALUATED: { kind: 'render', state: payload.outcome || payload.metadata?.outcome || 'unknown' },
      TERMINAL_DEADLINE_REACHED: { kind: 'deadline', state: 'reached' },
      POLICY_OVERRIDE_APPLIED: { kind: 'policy_override', state: payload.mode || 'forced' },
      DECISION_RECORDED: { kind: 'decision', state: payload.accepted === true ? 'accepted' : 'rejected' },
      MODEL_TERMINAL_RECORDED: { kind: 'terminal_action', state: payload.metadata?.terminalStatus || payload.status || 'unknown' },
      PAGE_HEALTH_OBSERVED: { kind: 'observation', state: payload.pageHealth || payload.metadata?.pageHealth || payload.status || payload.metadata?.status || 'unknown' },
      OBSERVATION_FRAME_CAPTURED: { kind: 'observation', state: payload.observationCoverage === 'complete' || payload.metadata?.observationCoverage === 'complete' ? 'reliable' : (payload.observationCoverage || payload.metadata?.observationCoverage || 'unknown') },
      OBSERVER_HEALTH_INTERVAL_CLOSED: { kind: 'observation_interval', state: 'closed' },
      OBSERVATION_INTERVAL_CLOSED: { kind: 'observation_interval', state: 'closed' }
    })[event?.eventType];
  }

  function typedCanonicalConflict(event) {
    const typed = event?.payload?.typed;
    const canonical = canonicalFactOf(event);
    if (!typed || !canonical) return null;
    const typedKind = String(typed.kind || '').trim().toLowerCase();
    const typedState = String(typed.state || '').trim().toLowerCase();
    if (!typedKind || typedKind === 'unknown' || !typedState || typedState === 'unknown') return null;
    const canonicalKind = String(canonical.kind || '').trim().toLowerCase();
    const canonicalState = String(canonical.state || '').trim().toLowerCase();
    if (!canonicalKind || canonicalKind === 'unknown' || !canonicalState || canonicalState === 'unknown') return null;
    return typedKind !== canonicalKind || typedState !== canonicalState
      ? { typed: { kind: typedKind, state: typedState }, canonical: { kind: canonicalKind, state: canonicalState } }
      : null;
  }

  function sameIncidentScope(left, right, { allowSystem = false } = {}) {
    if (!left || !right) return false;
    if (String(left.runSessionId) !== String(right.runSessionId)) return false;
    const leftRunGenerationKnown = left.runGeneration !== undefined && left.runGeneration !== null;
    const rightRunGenerationKnown = right.runGeneration !== undefined && right.runGeneration !== null;
    if (leftRunGenerationKnown || rightRunGenerationKnown) {
      if (!leftRunGenerationKnown || !rightRunGenerationKnown) return false;
      if (Number(left.runGeneration) !== Number(right.runGeneration)) return false;
    }
    if (allowSystem && (left.modelId === 'SYSTEM' || right.modelId === 'SYSTEM')) return true;
    if (String(left.modelId) !== String(right.modelId)) return false;
    if (!left.dispatchId || !right.dispatchId || String(left.dispatchId) !== String(right.dispatchId)) return false;
    const leftGenerationKnown = left.generationEpoch !== undefined && left.generationEpoch !== null;
    const rightGenerationKnown = right.generationEpoch !== undefined && right.generationEpoch !== null;
    if (leftGenerationKnown || rightGenerationKnown) {
      if (!leftGenerationKnown || !rightGenerationKnown) return false;
      if (Number(left.generationEpoch) !== Number(right.generationEpoch)) return false;
    }
    return true;
  }

  function normalizeIdentityState(value) {
    const state = String(value || '').trim().toLowerCase();
    if (!state) return 'unknown';
    if (['current', 'current_dispatch', 'accepted_current', 'verified_current'].includes(state)) return 'current';
    if (['previous', 'previous_dispatch', 'stale', 'stale_accepted', 'prior_dispatch'].includes(state)) return 'previous';
    if (['ambiguous', 'multiple_candidates', 'unresolved'].includes(state)) return 'ambiguous';
    if (['rejected', 'invalid', 'wrong_node'].includes(state)) return 'rejected';
    return 'unknown';
  }

  function normalizedSlots(reportType, registryVersion = null) {
    return (contractFor(reportType, registryVersion)?.slots || []).map(([slotId, criticality, eventTypes, requiredIf]) => ({
      slotId,
      criticality,
      eventTypes: eventTypes.slice(),
      requiredIf: requiredIf ? { path: requiredIf[0], operator: requiredIf[1], value: requiredIf[2] } : null,
      matchRule: SLOT_MATCH_RULES[`${reportType}.${slotId}`] || null
    }));
  }

  function normalizedApplicability(reportType, registryVersion = null) {
    const contract = contractFor(reportType, registryVersion)?.applicability || { all: [] };
    return {
      all: (contract.all || []).map(([path, operator, value]) => ({ path, operator, value }))
    };
  }

  function normalizedRefutation(reportType, registryVersion = null) {
    const selected = contractFor(reportType, registryVersion);
    const contract = selected?.refutation || { any: [] };
    return {
      model: selected?.refutationModel || 'unspecified',
      any: (contract.any || []).map(([path, operator, value]) => ({ path, operator, value }))
    };
  }

  function counterEvidenceTypes(reportType) {
    return (REPORT_COUNTEREVIDENCE_TYPES[reportType] || []).slice();
  }

  const api = Object.freeze({
    EVENT_SCHEMA_VERSION,
    CLOCK_CONTRACT_VERSION,
    REGISTRY_VERSION,
    THRESHOLDS,
    REPORT_CONTRACTS,
    LEGACY_REPORT_CONTRACTS,
    contractFor,
    SLOT_MATCH_RULES,
    REPORT_COUNTEREVIDENCE_TYPES,
    sourceType,
    adaptLegacyEvent,
    factOf,
    canonicalFactOf,
    typedCanonicalConflict,
    sameIncidentScope,
    normalizeIdentityState,
    normalizedSlots,
    normalizedApplicability,
    normalizedRefutation,
    counterEvidenceTypes
  });
  root.ProofTelemetryContracts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

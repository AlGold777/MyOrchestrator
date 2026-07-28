// Executable schema 6 contracts for incident-oriented proof telemetry.
(function initProofTelemetryContracts(root) {
  'use strict';

  const EVENT_SCHEMA_VERSION = 6;
  const CLOCK_CONTRACT_VERSION = '1.0';
  const REGISTRY_VERSION = '2.0.0';
  const THRESHOLDS = Object.freeze({
    generationStartTimeoutMs: 15000,
    minimumExtractionCoveragePct: 98,
    postTerminalGrowthTolerancePct: 0.5,
    automaticMinimumEvidenceTier: 3,
    maximumSignalSkewMs: 250
  });

  const REPORT_CONTRACTS = Object.freeze({
    'request-not-sent': {
      question: 'Почему запрос не был принят платформой?',
      slots: [
        ['dispatch_baseline', 'critical', ['DISPATCH_BASELINE_CAPTURED']],
        ['submit_action', 'critical', ['SUBMIT_ACTION_OBSERVED']],
        ['acceptance_evidence', 'critical', ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED']],
        ['page_context', 'required', ['PAGE_CONTEXT_OBSERVED', 'PAGE_HEALTH_OBSERVED']],
        ['observer_context', 'conditional', ['OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_SLOT_DENIED']]
      ]
    },
    'generation-not-started': {
      question: 'Почему после dispatch не появились признаки начала генерации?',
      slots: [
        ['submission_proof', 'critical', ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED']],
        ['generation_start', 'critical', ['GENERATION_START_EVALUATED']],
        ['first_candidate_or_signal', 'required', ['CANDIDATE_SET_CHANGED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED']],
        ['observer_context', 'required', ['PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_SLOT_DENIED']]
      ]
    },
    truncation: {
      question: 'Почему сохранённый ответ короче фактически доступного текста?',
      slots: [
        ['terminal_boundary', 'critical', ['MODEL_TERMINAL_RECORDED']],
        ['text_evolution', 'critical', ['TEXT_STATE_CHANGED']],
        ['candidate_identity', 'critical', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED']],
        ['extraction_boundary', 'required', ['EXTRACTION_COMPLETED', 'STRUCTURAL_VERIFICATION_EVALUATED']],
        ['completion_proof', 'required', ['COMPLETION_HYPOTHESIS_EVALUATED', 'ANSWER_COMPLETENESS_EVALUATED']],
        ['decision_lineage', 'required', ['FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED']],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'true-completion': {
      question: 'Действительно ли генерация закончилась в terminal moment?',
      slots: [
        ['generation_transition', 'critical', ['GENERATION_SIGNAL_CHANGED']],
        ['candidate_identity', 'critical', ['CANDIDATE_IDENTITY_INFERRED']],
        ['observation_frame', 'critical', ['OBSERVATION_FRAME_CAPTURED']],
        ['completion_hypothesis', 'required', ['COMPLETION_HYPOTHESIS_EVALUATED']],
        ['terminal_lineage', 'required', ['DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED']],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'submission-proof': {
      question: 'Какие внешние признаки доказывают принятие запроса?',
      slots: [
        ['dispatch_baseline', 'critical', ['DISPATCH_BASELINE_CAPTURED']],
        ['submit_action', 'critical', ['SUBMIT_ACTION_OBSERVED']],
        ['acceptance_evidence', 'critical', ['SUBMISSION_EVIDENCE_CHANGED']],
        ['submission_inference', 'required', ['SUBMISSION_INFERRED']],
        ['navigation_context', 'conditional', ['PAGE_CONTEXT_OBSERVED']]
      ]
    },
    'extraction-integrity': {
      question: 'Захвачен ли весь релевантный текст?',
      slots: [
        ['candidate_lineage', 'critical', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED']],
        ['text_boundary', 'critical', ['TEXT_STATE_CHANGED']],
        ['extraction_result', 'critical', ['EXTRACTION_COMPLETED']],
        ['completeness', 'required', ['ANSWER_COMPLETENESS_EVALUATED']],
        ['structural_verification', 'required', ['STRUCTURAL_VERIFICATION_EVALUATED']]
      ]
    },
    'forced-success': {
      question: 'Почему SUCCESS выставлен без automatic completion proof?',
      slots: [
        ['completion_proof', 'critical', ['COMPLETION_HYPOTHESIS_EVALUATED']],
        ['policy_evaluation', 'critical', ['FINALIZATION_POLICY_EVALUATED']],
        ['override', 'critical', ['POLICY_OVERRIDE_APPLIED']],
        ['decision_terminal_lineage', 'critical', ['DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED']],
        ['accepted_extraction', 'required', ['EXTRACTION_COMPLETED', 'STRUCTURAL_VERIFICATION_EVALUATED']],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    },
    'forced-finalization': {
      question: 'Когда и почему расширение прекратило ожидание?',
      slots: [
        ['deadline', 'critical', ['TERMINAL_DEADLINE_REACHED']],
        ['last_generation_state', 'critical', ['GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED']],
        ['policy_evaluation', 'critical', ['FINALIZATION_POLICY_EVALUATED']],
        ['override', 'critical', ['POLICY_OVERRIDE_APPLIED']],
        ['decision_terminal_lineage', 'critical', ['DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED']],
        ['post_terminal_audit', 'conditional', ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
      ]
    }
  });

  function sourceType(event) {
    return String(event?.payload?.sourceEventType || event?.payload?.metadata?.sourceEventType || '').toUpperCase();
  }

  // All legacy string interpretation is confined to this migration boundary.
  function adaptLegacyEvent(event) {
    const source = sourceType(event);
    const meta = event?.payload?.metadata || {};
    const typed = { kind: 'unknown', state: 'unknown' };
    if (/CANDIDATE.*AMBIGUOUS|MULTIPLE_CANDIDATES/.test(source)) return { kind: 'candidate_identity', state: 'ambiguous' };
    if (/STALE_BASELINE|CANDIDATE.*STALE/.test(source)) return { kind: 'candidate_identity', state: 'stale' };
    if (/PROMPT_ECHO_REJECTED|CANDIDATE.*REJECTED/.test(source)) return { kind: 'candidate_identity', state: 'rejected' };
    if (/TURN_RESOLUTION_ACCEPTED|CURRENT_DISPATCH/.test(source) || meta.answerIdentity === 'current_dispatch') return { kind: 'candidate_identity', state: 'current_dispatch' };
    if (/PROMPT_SUBMITTED_ACCEPTED|SUBMISSION_CONFIRMED/.test(source)) return { kind: 'submission', state: 'confirmed' };
    if (/PROMPT_SUBMITTED_REJECTED|DISPATCH_COMMAND_NOT_ACCEPTED|NO_SEND/.test(source)) return { kind: 'submission', state: 'failed' };
    if (/DISPATCH|SUBMIT|SEND|PROMPT/.test(source)) return { kind: 'submission', state: 'attempted' };
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
    if (/EXTRACT.*FAIL/.test(source)) return { kind: 'extraction', state: 'failed' };
    if (/DOM_FALLBACK|MATERIALIZE_RECOVERY|FALLBACK_EXTRACTION/.test(source)) return { kind: 'extraction', state: 'fallback' };
    return typed;
  }

  function factOf(event) {
    const typed = event?.payload?.typed;
    if (typed && typeof typed === 'object') return typed;
    const payload = event?.payload || {};
    const canonical = ({
      SUBMISSION_INFERRED: { kind: 'submission', state: payload.submission || 'unknown' },
      GENERATION_STATE_INFERRED: { kind: 'generation', state: payload.observedGeneration || 'unknown' },
      CANDIDATE_IDENTITY_INFERRED: { kind: 'candidate_identity', state: payload.answerIdentity || 'unknown' },
      ANSWER_COMPLETENESS_EVALUATED: { kind: 'answer_completeness', state: payload.answerCompleteness || 'unknown' },
      STRUCTURAL_VERIFICATION_EVALUATED: { kind: 'verification', state: payload.verified === false ? 'rejected' : (payload.verification || 'verified') },
      COMPLETION_HYPOTHESIS_EVALUATED: { kind: 'completion_hypothesis', state: payload.completionDetection || 'evaluated' },
      EXTRACTION_COMPLETED: { kind: 'extraction', state: payload.status || 'completed' },
      TERMINAL_DEADLINE_REACHED: { kind: 'deadline', state: 'reached' },
      POLICY_OVERRIDE_APPLIED: { kind: 'policy_override', state: payload.mode || 'forced' },
      DECISION_RECORDED: { kind: 'decision', state: payload.accepted === true ? 'accepted' : 'rejected' },
      MODEL_TERMINAL_RECORDED: { kind: 'terminal_action', state: payload.metadata?.terminalStatus || payload.status || 'unknown' },
      OBSERVATION_INTERVAL_CLOSED: { kind: 'observation_interval', state: 'closed' }
    })[event?.eventType];
    return canonical || adaptLegacyEvent(event);
  }

  function sameIncidentScope(left, right, { allowSystem = false } = {}) {
    if (!left || !right) return false;
    if (String(left.runSessionId) !== String(right.runSessionId)) return false;
    if (allowSystem && (left.modelId === 'SYSTEM' || right.modelId === 'SYSTEM')) return true;
    if (String(left.modelId) !== String(right.modelId)) return false;
    if (!left.dispatchId || !right.dispatchId || String(left.dispatchId) !== String(right.dispatchId)) return false;
    if (left.generationEpoch !== undefined || right.generationEpoch !== undefined) {
      if (left.generationEpoch === undefined || right.generationEpoch === undefined) return false;
      if (Number(left.generationEpoch) !== Number(right.generationEpoch)) return false;
    }
    return true;
  }

  function normalizedSlots(reportType) {
    return (REPORT_CONTRACTS[reportType]?.slots || []).map(([slotId, criticality, eventTypes]) => ({
      slotId,
      criticality,
      eventTypes: eventTypes.slice()
    }));
  }

  const api = Object.freeze({
    EVENT_SCHEMA_VERSION,
    CLOCK_CONTRACT_VERSION,
    REGISTRY_VERSION,
    THRESHOLDS,
    REPORT_CONTRACTS,
    sourceType,
    adaptLegacyEvent,
    factOf,
    sameIncidentScope,
    normalizedSlots
  });
  root.ProofTelemetryContracts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

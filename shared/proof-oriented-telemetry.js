// shared/proof-oriented-telemetry.js
// Proof-oriented telemetry export builder (schema 5 container, schema 6 events).
//
// The runtime still emits the established diagnostic event shape. This module
// is the compatibility boundary: it freezes one run-scoped snapshot, converts
// it into an immutable decision ledger, derives state axes/reports, validates
// lineage invariants, and only then returns an All-presets container.

(function initProofOrientedTelemetry(root) {
  'use strict';

  const Contracts = root.ProofTelemetryContracts || (typeof require === 'function' ? require('./proof-telemetry-contracts.js') : null);
  const Incidents = root.ProofTelemetryIncidents || (typeof require === 'function' ? require('./proof-telemetry-incidents.js') : null);
  const Clock = root.ProofTelemetryClock || (typeof require === 'function' ? require('./proof-telemetry-clock.js') : null);
  const SCHEMA_VERSION = '5.0';
  const EVENT_SCHEMA_VERSION = Contracts?.EVENT_SCHEMA_VERSION || 6;
  const GENERATOR_VERSION = 'proof-export@1.2.0';
  const REPORT_VERSION = '2.1.0';
  const REPORT_TYPES = Object.freeze([
    'cutted',
    'false-success',
    'old-answer',
    'empty',
    'prompt-not-sent',
    'late-end'
  ]);

  const REPORT_INFO = Object.freeze({
    cutted: ['Почему зафиксирован SUCCESS, а текст явно неполный?', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'ANSWER_COMPLETENESS_EVALUATED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']],
    'false-success': ['Почему система решила «готово», а ответ продолжил расти?', ['GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED', 'ANSWER_COMPLETENESS_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED', 'TERMINAL_DEADLINE_REACHED', 'FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']],
    'old-answer': ['Почему принят текст от предыдущего запроса?', ['DISPATCH_BASELINE_CAPTURED', 'CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED', 'PAGE_CONTEXT_OBSERVED', 'OBSERVATION_FRAME_CAPTURED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'TEXT_STATE_CHANGED', 'POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']],
    empty: ['Почему генерация была, но extraction вернул пусто или не тот узел?', ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'ANSWER_COMPLETENESS_EVALUATED', 'PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED']],
    'prompt-not-sent': ['Почему модель не получила запрос?', ['DISPATCH_BASELINE_CAPTURED', 'SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'PAGE_CONTEXT_OBSERVED', 'PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED']],
    'late-end': ['Текст давно стабилен — почему система ждала ещё N секунд?', ['STABILITY_INTERVAL_CLOSED', 'GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED', 'COMPLETION_HYPOTHESIS_EVALUATED', 'FINALIZATION_POLICY_EVALUATED', 'TERMINAL_DEADLINE_REACHED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'OBSERVER_HEALTH_OBSERVED', 'POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED']]
  });
  const REPORT_EVENT_TYPES = Object.freeze(Object.fromEntries(
    Object.entries(REPORT_INFO).map(([reportType, [, eventTypes]]) => [
      reportType,
      Object.freeze(eventTypes.slice())
    ])
  ));

  const EVENT_MAP = Object.freeze({
    DISPATCH_BASELINE_CAPTURED: 'DISPATCH_BASELINE_CAPTURED',
    DISPATCH_START: 'SUBMIT_ACTION_OBSERVED',
    DISPATCH_SEND: 'SUBMIT_ACTION_OBSERVED',
    PROMPT_SUBMITTED_PENDING: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_ACCEPTED: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_REJECTED: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_TIMEOUT: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_INFERRED: 'SUBMISSION_INFERRED',
    ANSWER_START_DETECTED: 'GENERATION_START_EVALUATED',
    ANSWER_GENERATING: 'GENERATION_SIGNAL_CHANGED',
    STREAMING_TRUE_TO_FALSE: 'GENERATION_SIGNAL_CHANGED',
    STREAMING_STOPPED: 'GENERATION_SIGNAL_CHANGED',
    STOP_BUTTON_PRESENT_TO_ABSENT: 'GENERATION_SIGNAL_CHANGED',
    STOP_BUTTON_DISAPPEARED: 'GENERATION_SIGNAL_CHANGED',
    ANSWER_TEXT_STABLE: 'STABILITY_INTERVAL_CLOSED',
    ANSWER_LENGTH_DECREASED: 'TEXT_STATE_CHANGED',
    ANSWER_LENGTH_REGRESSION_RECOVERED: 'TEXT_STATE_CHANGED',
    ANSWER_NODE_REPLACED: 'CANDIDATE_SET_CHANGED',
    ANSWER_COMPLETE_DETECTED: 'COMPLETION_HYPOTHESIS_EVALUATED',
    ANSWER_COMPLETE_TIMEOUT: 'TERMINAL_DEADLINE_REACHED',
    ANSWER_PARTIAL_ON_TIMEOUT: 'ANSWER_COMPLETENESS_EVALUATED',
    ANSWER_VERIFICATION_RECORDED: 'STRUCTURAL_VERIFICATION_EVALUATED',
    ANSWER_VERIFICATION_RESULT: 'STRUCTURAL_VERIFICATION_EVALUATED',
    LIFECYCLE_SNAPSHOT_ACCEPTED: 'OBSERVATION_FRAME_CAPTURED',
    LIFECYCLE_SNAPSHOT_REJECTED: 'OBSERVER_HEALTH_OBSERVED',
    FINALIZATION_DECISION: 'FINALIZATION_POLICY_EVALUATED',
    ROUND4_FORCE_FINAL: 'POLICY_OVERRIDE_APPLIED',
    AUTOMATION_DEADLINE_REACHED: 'TERMINAL_DEADLINE_REACHED',
    MODEL_FINAL: 'MODEL_TERMINAL_RECORDED',
    TAB_CLOSED: 'PAGE_CONTEXT_OBSERVED',
    SPA_NAVIGATION: 'PAGE_CONTEXT_OBSERVED',
    PAGE_READY_STATE: 'PAGE_HEALTH_OBSERVED',
    SCRIPT_HEALTH_FAIL: 'OBSERVER_HEALTH_OBSERVED',
    FOCUS_STUCK: 'OBSERVER_HEALTH_OBSERVED',
    LEASE_GRANTED: 'OBSERVATION_SLOT_GRANTED',
    LEASE_DENIED: 'OBSERVATION_SLOT_DENIED',
    LEASE_RELEASED: 'OBSERVATION_SLOT_RELEASED',
    COMMAND_SEND_ERROR: 'SUBMISSION_EVIDENCE_CHANGED',
    SEND_DEFERRED_TRANSIENT_BLOCKER: 'SUBMISSION_EVIDENCE_CHANGED',
    SEND_DEGRADED_AFTER_SUBMIT: 'SUBMISSION_EVIDENCE_CHANGED',
    LLM_RESPONSE_READY: 'EXTRACTION_COMPLETED',
    GEMINI_STALE_BASELINE_REJECTED: 'CANDIDATE_SET_CHANGED',
    GROK_PROMPT_ECHO_REJECTED: 'CANDIDATE_SET_CHANGED',
    GROK_SENT_PROMPT_CONFIRMED: 'SUBMISSION_EVIDENCE_CHANGED',
    DOM_FALLBACK_START: 'EXTRACTION_COMPLETED',
    DOM_FALLBACK_JOINED: 'EXTRACTION_COMPLETED',
    DOM_FALLBACK_SUCCESS: 'EXTRACTION_COMPLETED',
    DOM_FALLBACK_TIMEOUT: 'EXTRACTION_COMPLETED',
    COMPOSER_NOT_FOUND: 'PAGE_HEALTH_OBSERVED'
  });

  const RUNTIME_TYPED_FACTS = Object.freeze({
    COMMAND_SEND_ERROR: { kind: 'submission', state: 'failed' },
    SEND_DEFERRED_TRANSIENT_BLOCKER: { kind: 'submission', state: 'deferred' },
    SEND_DEGRADED_AFTER_SUBMIT: { kind: 'submission', state: 'confirmed' },
    LLM_RESPONSE_READY: { kind: 'extraction', state: 'completed' },
    GEMINI_STALE_BASELINE_REJECTED: { kind: 'candidate_identity', state: 'stale' },
    GROK_PROMPT_ECHO_REJECTED: { kind: 'candidate_identity', state: 'rejected' },
    GROK_SENT_PROMPT_CONFIRMED: { kind: 'submission', state: 'confirmed' },
    DOM_FALLBACK_START: { kind: 'extraction', state: 'fallback' },
    DOM_FALLBACK_JOINED: { kind: 'extraction', state: 'fallback' },
    DOM_FALLBACK_SUCCESS: { kind: 'extraction', state: 'completed' },
    DOM_FALLBACK_TIMEOUT: { kind: 'extraction', state: 'failed' },
    COMPOSER_NOT_FOUND: { kind: 'observation', state: 'degraded' }
  });

  const OPERATIONAL_EVENT_PATTERN = /^(?:ADAPTIVE_PROBE_TICK|MANUAL_PING(?:_FAIL|_START|_RESULT)?|PING_(?:TRANSPORT_ERROR|RETRY|TICK)|ROUND4_GATE_WAIT|MODEL_RUN_TRANSITION|STATE_PROJECTION_COMMITTED|DETECTOR_TICK|SELECTOR_STATS|RECOVERY_BUDGET_(?:EXHAUSTED|CONSUMED|WAIT)|FOCUS_(?:WAIT|RETRY|CHECK)|LEASE_(?:WAIT|RETRY|CHECK)|POLL(?:ING)?_TICK|WATCHDOG_TICK)$/;

  function classifyRuntimeEvent(event = {}) {
    const label = normalizeLabel(event);
    if (event?.proofEventType || event?.meta?.proofEventType) {
      return { route: 'canonical', label, eventType: String(event.proofEventType || event.meta.proofEventType) };
    }
    if (EVENT_MAP[label]) return { route: 'canonical', label, eventType: EVENT_MAP[label], typed: RUNTIME_TYPED_FACTS[label] || null };
    if (OPERATIONAL_EVENT_PATTERN.test(label)) return { route: 'operational', label, eventType: 'OBSERVER_HEALTH_INTERVAL_CLOSED' };
    if (/PROVIDER_(?:FINISH_REASON|COMPLETE|TERMINAL)|TERMINAL_MARKER/.test(label)) return { route: 'canonical', label, eventType: 'COMPLETION_HYPOTHESIS_EVALUATED' };
    if (/EXTRACT|MATERIALIZE|RESPONSE_CAPTURE/.test(label)) return { route: 'canonical', label, eventType: 'EXTRACTION_COMPLETED' };
    if (/TURN_RESOLUTION|CANDIDATE|ANSWER_NODE/.test(label)) return { route: 'canonical', label, eventType: 'CANDIDATE_SET_CHANGED' };
    if (/PAGE_HEALTH|SCRIPT_HEALTH|SELECTOR_(?:FAIL|MISS)|OBSERVER_(?:FAIL|UNAVAILABLE)/.test(label)) return { route: 'canonical', label, eventType: 'OBSERVER_HEALTH_OBSERVED' };
    if (/SUBMISSION|PROMPT_SUBMITTED|DISPATCH_(?:BASELINE|SEND|START)/.test(label)) return { route: 'canonical', label, eventType: canonicalType(event) };
    return { route: 'debug', label, eventType: null };
  }

  const INFERENCE_TYPES = new Set(['SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'CANDIDATE_IDENTITY_INFERRED', 'GENERATION_STATE_INFERRED', 'ANSWER_COMPLETENESS_EVALUATED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED']);
  const DECISION_TYPES = new Set(['FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'DECISION_SUPERSEDED', 'MISSING_EVIDENCE_RECORDED']);
  const ACTION_TYPES = new Set(['MODEL_TERMINAL_RECORDED']);
  const AUDIT_TYPES = new Set(['POST_TERMINAL_AUDIT_COMPLETED', 'REPLAY_VALIDATION_RECORDED', 'EXPORT_AUDIT_RECORDED']);
  const SYSTEM_TYPES = new Set(['RUN_CONFIG_RECORDED', 'SELECTOR_CANARY_RESULT']);

  function normalizeLabel(event) {
    return String(event?.label || event?.meta?.event || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function canonicalType(event) {
    const explicitType = event?.proofEventType || event?.meta?.proofEventType;
    if (explicitType) return String(explicitType).trim().toUpperCase();
    const label = normalizeLabel(event);
    if (EVENT_MAP[label]) return EVENT_MAP[label];
    if (/FINAL|TERMINAL/.test(label)) return 'FINALIZATION_POLICY_EVALUATED';
    if (/EXTRACT|MATERIALIZE|RESPONSE/.test(label)) return 'EXTRACTION_COMPLETED';
    if (/ANSWER|TEXT|LIFECYCLE/.test(label)) return 'TEXT_STATE_CHANGED';
    if (/SUBMIT|DISPATCH|SEND|ACK|HANDSHAKE/.test(label)) return 'SUBMISSION_EVIDENCE_CHANGED';
    if (/SELECTOR|CANDIDATE|TURN_RESOLUTION/.test(label)) return 'CANDIDATE_SET_CHANGED';
    if (/PAGE|TAB|NAVIGATION/.test(label)) return 'PAGE_CONTEXT_OBSERVED';
    if (/LEASE|FOCUS|VISIT|SCHEDUL/.test(label)) return 'OBSERVER_HEALTH_OBSERVED';
    return 'OBSERVER_HEALTH_OBSERVED';
  }

  function layerFor(type) {
    if (INFERENCE_TYPES.has(type)) return 'inference';
    if (DECISION_TYPES.has(type)) return 'decision';
    if (ACTION_TYPES.has(type)) return 'action';
    if (AUDIT_TYPES.has(type)) return 'audit';
    if (SYSTEM_TYPES.has(type)) return 'system';
    return 'fact';
  }

  function platformOf(event) {
    return String(event?.platform || event?.llmName || event?.meta?.llmName || event?.meta?.platform || 'SYSTEM').trim() || 'SYSTEM';
  }

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase();
    if (/(hash|length|len|count|id|status|state|reason|source|mode|tier|timestamp|at$|ms$|version|visible|active|present|confirmed|coverage|outcome|phase|type|class|event|round|attempt|epoch|urlhash)/.test(normalized)) return false;
    return /(prompt|answer|text|html|content|body|message|token|cookie|secret|credential|authorization|api.?key|url)/.test(normalized);
  }

  function sanitizeValue(value, key = '', depth = 0) {
    if (depth > 5 || isSensitiveKey(key)) return undefined;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, key, depth + 1)).filter((item) => item !== undefined);
    if (typeof value !== 'object') return undefined;
    const result = {};
    Object.keys(value).sort().forEach((childKey) => {
      const sanitized = sanitizeValue(value[childKey], childKey, depth + 1);
      if (sanitized !== undefined) result[childKey] = sanitized;
    });
    return result;
  }

  function eventFingerprint(value) {
    let hash = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  async function sha256(value) {
    const input = typeof value === 'string' ? value : stableStringify(value);
    if (root.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return `sha256:${Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    if (typeof require === 'function') {
      const crypto = require('crypto');
      return `sha256:${crypto.createHash('sha256').update(input).digest('hex')}`;
    }
    // Non-cryptographic fallback is explicitly marked and makes integrity
    // degradation visible instead of silently claiming SHA-256.
    return `fnv1a:${eventFingerprint(input)}`;
  }

  function flattenGroups(groups) {
    const events = [];
    Object.entries(groups || {}).forEach(([group, groupEvents]) => {
      if (group === '<RUN_SUMMARY>' || !Array.isArray(groupEvents)) return;
      groupEvents.forEach((event) => events.push({ ...event, platform: event?.platform || group.replace(/^<|>$/g, '') }));
    });
    return events.sort((left, right) => Number(left?.ts || 0) - Number(right?.ts || 0));
  }

  function buildLedger(events, options = {}) {
    const source = Array.isArray(events) ? events.slice() : flattenGroups(events);
    const firstWallTs = Number(source[0]?.ts || options.exportedAt || Date.now());
    const runSessionId = options.runSessionId || source.find((event) => event?.meta?.runSessionId)?.meta?.runSessionId || `export-${firstWallTs}`;
    return source.map((legacy, index) => {
      const seq = index + 1;
      const wallTs = Number(legacy?.ts || firstWallTs);
      const modelId = platformOf(legacy);
      const type = canonicalType(legacy);
      const meta = sanitizeValue(legacy?.meta || {}, 'meta') || {};
      const dispatchId = meta.dispatchId || meta.requestId || undefined;
      const identityMaterial = `${runSessionId}|${modelId}|${dispatchId || ''}|${normalizeLabel(legacy)}|${wallTs}|${seq}`;
      const eventId = `event-${eventFingerprint(identityMaterial)}-${eventFingerprint(identityMaterial.split('').reverse().join(''))}`;
      const envelope = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId,
        eventType: type,
        layer: layerFor(type),
        seq,
        ingestSeq: seq,
        runGeneration: Number(options.runGeneration || 1),
        wallTs,
        runSessionId: String(runSessionId),
        modelId,
        producer: { component: 'legacy-telemetry-adapter', version: GENERATOR_VERSION },
        clock: {
          contractVersion: Contracts?.CLOCK_CONTRACT_VERSION || '1.0',
          producerEpochId: 'legacy-clockless',
          producerSequence: null,
          observedAtLocalMonoMs: null,
          sentAtLocalMonoMs: null,
          originKind: 'unknown',
          ingestEpochId: 'legacy-adapter',
          ingestMonoMs: seq
        },
        payload: {
          typed: Contracts?.adaptLegacyEvent?.({ payload: { sourceEventType: normalizeLabel(legacy) || 'UNKNOWN', metadata: meta } }) || { kind: 'unknown', state: 'unknown' },
          sourceEventType: normalizeLabel(legacy) || 'UNKNOWN',
          sourceLevel: String(legacy?.level || 'info'),
          detailsLength: String(legacy?.details || '').length,
          metadata: meta
        }
      };
      if (dispatchId) envelope.dispatchId = String(dispatchId);
      if (Number.isFinite(Number(meta.generationEpoch))) envelope.generationEpoch = Number(meta.generationEpoch);
      if (Number.isFinite(Number(meta.tabId))) envelope.tabId = Number(meta.tabId);
      if (meta.documentInstanceId) envelope.documentInstanceId = String(meta.documentInstanceId);
      if (Number.isFinite(Number(meta.navigationEpoch))) envelope.navigationEpoch = Number(meta.navigationEpoch);
      if (meta.conversationId !== undefined) envelope.conversationId = meta.conversationId === null ? null : String(meta.conversationId);
      if (meta.turnId) envelope.turnId = String(meta.turnId);
      if (meta.candidateId) envelope.candidateId = String(meta.candidateId);
      return envelope;
    });
  }

  function includesSource(events, matcher) {
    return events.some((event) => matcher.test(event.payload.sourceEventType));
  }

  function numericMeta(events, keys) {
    const values = [];
    events.forEach((event) => {
      keys.forEach((key) => {
        const raw = event?.payload?.[key] ?? event?.payload?.metadata?.[key];
        if (raw === null || raw === undefined || raw === '') return;
        const value = Number(raw);
        if (Number.isFinite(value) && value >= 0) values.push(value);
      });
    });
    return values;
  }

  function eventValue(event, keys) {
    for (const key of keys) {
      const value = event?.payload?.[key] ?? event?.payload?.metadata?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function exactEventDuration(left, right) {
    if (!left || !right) return { comparable: false, durationMs: null, basis: 'missing_boundary' };
    const producerComparison = Clock?.compareClockPoints?.(
      Clock.point(left.clock, 'observedAtLocalMonoMs'),
      Clock.point(right.clock, 'observedAtLocalMonoMs')
    );
    if (producerComparison?.kind === 'exact') {
      return { comparable: true, durationMs: producerComparison.durationMs, basis: 'producer_monotonic' };
    }
    const leftIngest = Number(left?.clock?.ingestMonoMs);
    const rightIngest = Number(right?.clock?.ingestMonoMs);
    if (left?.clock?.ingestEpochId && left.clock.ingestEpochId !== 'legacy-adapter'
      && left.clock.ingestEpochId === right?.clock?.ingestEpochId
      && Number.isFinite(leftIngest) && Number.isFinite(rightIngest)) {
      return { comparable: true, durationMs: rightIngest - leftIngest, basis: 'ingest_monotonic' };
    }
    return { comparable: false, durationMs: null, basis: producerComparison?.reason || 'clock_unavailable' };
  }

  function normalizeDispatchIdentity(value, modelId) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).trim();
    const prefix = `${String(modelId || '').trim()}:`;
    return prefix !== ':' && normalized.toLowerCase().startsWith(prefix.toLowerCase())
      ? normalized.slice(prefix.length)
      : normalized;
  }

  function eventBoolean(event, keys) {
    const value = eventValue(event, keys);
    if (value === true || value === false) return value;
    if (String(value).toLowerCase() === 'true') return true;
    if (String(value).toLowerCase() === 'false') return false;
    return null;
  }

  function resolveAcceptedExtraction(events, terminalEvent) {
    const terminalSeq = Number(terminalEvent?.seq ?? Infinity);
    const candidates = events.filter((event) => event.eventType === 'EXTRACTION_COMPLETED'
      && Number(event.seq) <= terminalSeq);
    if (!candidates.length) return { event: null, resolution: 'not_observed' };
    const byId = new Map(events.map((event) => [event.eventId, event]));
    const visited = new Set();
    const queue = [...(terminalEvent?.evidenceRefs || [])];
    while (queue.length) {
      const eventId = queue.shift();
      if (visited.has(eventId)) continue;
      visited.add(eventId);
      const linked = byId.get(eventId);
      if (!linked) continue;
      if (linked.eventType === 'EXTRACTION_COMPLETED') return { event: linked, resolution: 'terminal_evidence_ref' };
      queue.push(...(linked.evidenceRefs || []));
    }
    const explicitlyAccepted = candidates.filter((event) => eventBoolean(event, ['accepted', 'usedForTerminal']) === true
      || ['accepted', 'selected'].includes(String(eventValue(event, ['selectionStatus', 'acceptanceStatus']) || '').toLowerCase()));
    if (explicitlyAccepted.length === 1) return { event: explicitlyAccepted[0], resolution: 'explicit_acceptance' };
    const terminalEvidenceLength = eventValue(terminalEvent, ['answerEvidenceLength']);
    const terminalEvidenceSource = eventValue(terminalEvent, ['answerEvidenceSource']);
    const evidenceMatches = candidates.filter((event) => {
      const lengths = numericMeta([event], ['extractedTextLength', 'capturedTextLength', 'textLength', 'answerLength', 'answerLen', 'length']);
      const source = eventValue(event, ['source', 'answerEvidenceSource']);
      const lengthMatches = terminalEvidenceLength !== null && lengths.some((length) => length === Number(terminalEvidenceLength));
      const sourceMatches = terminalEvidenceSource !== null && source !== null && String(source) === String(terminalEvidenceSource);
      return lengthMatches && (terminalEvidenceSource === null || sourceMatches);
    });
    if (evidenceMatches.length === 1) return { event: evidenceMatches[0], resolution: 'terminal_evidence_match' };
    if (candidates.length === 1) return { event: candidates[0], resolution: 'unique_pre_terminal_extraction' };
    return { event: null, resolution: 'ambiguous_pre_terminal_extraction' };
  }

  function deriveAxes(events) {
    const submitted = includesSource(events, /PROMPT_SUBMITTED_(ACCEPTED|INFERRED)|SUBMISSION_CONFIRMED|DISPATCH_CONFIRMED/);
    const submitFailed = includesSource(events, /PROMPT_SUBMITTED_(REJECTED|TIMEOUT)|DISPATCH_COMMAND_NOT_ACCEPTED|NO_SEND/);
    const submitAttempted = includesSource(events, /DISPATCH|SUBMIT|SEND|PROMPT/);
    const started = includesSource(events, /ANSWER_START|ANSWER_GENERATING|LIFECYCLE.*GENERAT|STREAMING/);
    const active = includesSource(events, /ANSWER_GENERATING|STREAMING_START|GENERATION_ACTIVE/);
    const stable = includesSource(events, /ANSWER_TEXT_STABLE|STABILITY/);
    const regressed = includesSource(events, /LENGTH_DECREASED|REGRESSION/);
    const terminal = includesSource(events, /MODEL_FINAL/);
    const completion = includesSource(events, /ANSWER_COMPLETE_DETECTED|PROVIDER_COMPLETE|STREAMING.*FALSE|STOP.*ABSENT/);
    const structuralVerified = includesSource(events, /ANSWER_VERIFICATION_(RECORDED|RESULT)|STRUCTURAL_VERIFICATION/)
      && !includesSource(events, /ANSWER_VERIFICATION.*(REJECT|FAIL)/);
    const extractionFailed = includesSource(events, /EXTRACT_FAILED|EXTRACTION.*FAIL/);
    const extractionFallback = includesSource(events, /DOM_FALLBACK|MATERIALIZE_RECOVERY|FALLBACK_EXTRACTION/);
    const forced = includesSource(events, /ROUND4_FORCE_FINAL|FORCED_FINAL|AUTOMATION_DEADLINE|HARD_STOP|TIMEOUT/);
    const recovery = includesSource(events, /RECOVERY/);
    const observerBad = includesSource(events, /SCRIPT_HEALTH_FAIL|FOCUS_STUCK|OBSERVER.*UNAVAILABLE|TAB_CLOSED/);
    const providerComplete = includesSource(events, /PROVIDER_COMPLETE|FINISH_REASON|TERMINAL_MARKER/);
    const tier = providerComplete ? 4 : completion && structuralVerified ? 3 : completion || (stable && terminal) ? 2 : stable || terminal ? 1 : 0;
    return {
      submission: submitted ? 'confirmed' : submitFailed ? 'failed' : submitAttempted ? 'evidence_partial' : 'not_attempted',
      generationStart: started ? 'started' : submitted && terminal ? 'unknown' : submitted ? 'not_started' : 'not_evaluated',
      answerIdentity: (() => {
        const identities = events.map((event) => Contracts?.factOf?.(event))
          .filter((fact) => fact?.kind === 'candidate_identity' && fact.state && fact.state !== 'unknown');
        return identities.length ? identities[identities.length - 1].state : (started ? 'candidate' : 'none');
      })(),
      observedGeneration: active && !terminal ? 'active' : stable && !terminal ? 'quiescent' : terminal ? 'inactive' : started ? 'unknown' : 'not_started',
      textEvolution: regressed ? 'regressed' : active ? 'changing' : stable ? 'stable' : 'none',
      answerCompleteness: regressed ? 'probably_truncated' : tier >= 3 ? 'probably_complete' : terminal ? 'unknown' : 'not_evaluated',
      extraction: extractionFailed ? 'failed' : extractionFallback ? 'fallback' : structuralVerified ? 'exact' : started ? 'candidate' : 'none',
      verification: structuralVerified ? 'verified' : extractionFailed ? 'rejected' : started ? 'pending' : 'none',
      completionDetection: providerComplete ? 'provider_complete' : tier >= 3 ? 'inferred_complete' : completion ? 'probably_complete' : terminal ? 'inconclusive' : active ? 'probably_active' : 'not_evaluated',
      completionEvidenceTier: tier,
      observationReliability: observerBad ? 'degraded' : 'reliable',
      finalization: terminal ? 'accepted' : forced ? 'retry_scheduled' : 'not_evaluated',
      terminalMode: terminal ? (forced ? 'forced' : recovery ? 'recovery' : 'automatic') : 'none',
      terminationCause: terminal ? (forced ? 'policy_forced' : completion ? 'provider_completed' : 'unknown') : 'unknown'
    };
  }

  function deriveModelView(modelId, events) {
    const axes = deriveAxes(events);
    const terminalEvent = [...events].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    const terminalSeq = Number(terminalEvent?.seq ?? Infinity);
    const observedTextTypes = new Set(['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED', 'STABILITY_INTERVAL_CLOSED']);
    const observedTextEvents = events.filter((event) => observedTextTypes.has(event.eventType));
    const preTerminalObservedEvents = observedTextEvents.filter((event) => Number(event.seq) <= terminalSeq);
    const preTerminalLengths = numericMeta(preTerminalObservedEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const stableEvents = events.filter((event) => event.eventType === 'STABILITY_INTERVAL_CLOSED');
    const lastStableBeforeTerminal = terminalEvent
      ? stableEvents.filter((event) => Number(event.seq) <= Number(terminalEvent.seq)).slice(-1)[0]
      : stableEvents.slice(-1)[0];
    const postTerminalObservedEvents = terminalEvent
      ? observedTextEvents.filter((event) => Number(event.seq) > Number(terminalEvent.seq))
      : [];
    const postTerminalLengths = numericMeta(postTerminalObservedEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const terminalLengths = terminalEvent ? numericMeta([terminalEvent], ['textLength', 'answerLength', 'answerLen']) : [];
    const acceptedLength = terminalLengths.length ? terminalLengths[0] : null;
    const acceptedExtraction = resolveAcceptedExtraction(events, terminalEvent);
    const extractionEvent = acceptedExtraction.event;
    const extractionLengths = extractionEvent
      ? numericMeta([extractionEvent], ['extractedTextLength', 'capturedTextLength', 'textLength', 'answerLength', 'answerLen', 'length'])
      : [];
    const extractedTextLength = extractionLengths.length ? extractionLengths[extractionLengths.length - 1] : null;
    const maxObservedLength = preTerminalLengths.length ? Math.max(...preTerminalLengths) : null;
    const postTerminalMax = postTerminalLengths.length ? Math.max(...postTerminalLengths) : acceptedLength;
    const latestAudit = [...events].reverse().find((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    const pendingAudit = events.some((event) => event.eventType === 'MISSING_EVIDENCE_RECORDED'
      && eventValue(event, ['missingEvidence']) === 'post_terminal_observation'
      && String(eventValue(event, ['status']) || '').toLowerCase() === 'pending');
    const impossibleAudit = events.some((event) => event.eventType === 'MISSING_EVIDENCE_RECORDED'
      && ['post_terminal_observation', 'post_terminal_comparable_measurement'].includes(eventValue(event, ['missingEvidence']))
      && ['unavailable', 'impossible'].includes(String(eventValue(event, ['status']) || '').toLowerCase()));
    const auditGrowthCharsRaw = eventValue(latestAudit, ['growthChars']);
    const auditGrowthPctRaw = eventValue(latestAudit, ['growthPct']);
    const auditGrowthChars = auditGrowthCharsRaw === null ? null : Number(auditGrowthCharsRaw);
    const auditGrowthPct = auditGrowthPctRaw === null ? null : Number(auditGrowthPctRaw);
    const computedGrowthChars = acceptedLength !== null && postTerminalMax !== null
      ? Math.max(0, postTerminalMax - acceptedLength) : null;
    const computedGrowthPct = acceptedLength > 0 && computedGrowthChars !== null
      ? Math.max(0, (computedGrowthChars / acceptedLength) * 100) : (computedGrowthChars > 0 ? 100 : null);
    const postTerminalGrowthChars = Number.isFinite(auditGrowthChars) && auditGrowthChars >= 0 ? auditGrowthChars : computedGrowthChars;
    const postTerminalGrowthPct = Number.isFinite(auditGrowthPct) && auditGrowthPct >= 0 ? auditGrowthPct : computedGrowthPct;
    const auditConclusion = String(eventValue(latestAudit, ['conclusion']) || '').toLowerCase() || null;
    const auditPossible = latestAudit ? eventBoolean(latestAudit, ['auditPossible']) : null;
    const postTerminalGrowthProven = latestAudit && auditPossible !== false
      ? (auditConclusion === 'contradicted' && Number.isFinite(auditGrowthChars) && auditGrowthChars > 0
        ? true
        : (Number.isFinite(auditGrowthChars) && auditGrowthChars === 0 ? false : null))
      : null;
    const extractionFact = extractionEvent ? Contracts?.factOf?.(extractionEvent) : null;
    const extractionFailed = extractionFact?.state === 'failed';
    const generationEvents = events.filter((event) => ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED'].includes(event.eventType));
    const generationLengths = numericMeta(generationEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const generationTextObserved = generationLengths.length ? Math.max(...generationLengths) > 0 : null;
    const extractionIdentity = String(eventValue(extractionEvent, ['answerIdentity']) || '').toLowerCase() || null;
    const extractionVerified = eventBoolean(extractionEvent, ['verified', 'structuralVerified']);
    const extractionVerification = String(eventValue(extractionEvent, ['verification']) || '').toLowerCase() || null;
    const wrongNodeEvidence = extractionEvent && extractedTextLength > 0
      ? (extractionVerified === false
        || extractionVerification === 'rejected'
        || ['ambiguous', 'rejected', 'stale'].includes(extractionIdentity)
          ? true
          : (extractionVerified === true || extractionVerification === 'verified' || extractionIdentity === 'current_dispatch' ? false : null))
      : null;
    const emptyResultEvidence = extractionEvent
      ? (extractionFailed || extractedTextLength === 0
        ? true
        : (extractedTextLength > 0 && extractionFact?.state === 'completed' ? false : null))
      : null;
    const extractionProblemEvidence = generationTextObserved === true
      ? (emptyResultEvidence === true || wrongNodeEvidence === true
        ? true
        : (emptyResultEvidence === false && wrongNodeEvidence === false ? false : null))
      : null;
    const emptyExtractionBranch = emptyResultEvidence === true
      ? 'empty_result'
      : (wrongNodeEvidence === true ? 'wrong_node' : null);
    const terminalOutcomeRaw = eventValue(terminalEvent, ['terminalStatus', 'finalStatus', 'status']);
    const terminalOutcome = terminalOutcomeRaw ? String(terminalOutcomeRaw).toUpperCase() : null;
    const completenessStates = events
      .filter((event) => event.eventType === 'ANSWER_COMPLETENESS_EVALUATED')
      .map((event) => String(Contracts?.factOf?.(event)?.state || '').toLowerCase());
    const extractionCoveragePct = maxObservedLength > 0 && extractedTextLength !== null
      ? Math.min(100, (extractedTextLength / maxObservedLength) * 100) : null;
    const explicitIncomplete = completenessStates.some((state) => /truncat|partial|incomplete/.test(state));
    const explicitComplete = completenessStates.some((state) => /verified_complete|probably_complete/.test(state));
    const incompleteCaptureEvidence = explicitIncomplete
      || (extractionCoveragePct !== null && extractionCoveragePct < Number(Contracts?.THRESHOLDS?.minimumExtractionCoveragePct || 98))
      ? true
      : (extractionCoveragePct !== null && extractionCoveragePct >= Number(Contracts?.THRESHOLDS?.minimumExtractionCoveragePct || 98)
        ? false
        : (explicitComplete ? false : null));
    const terminalAnswerDispatchId = eventValue(terminalEvent, ['answerEvidenceDispatchId', 'acceptedAnswerDispatchId']);
    const explicitAnswerIdentity = String(eventValue(terminalEvent, ['answerIdentity']) || extractionIdentity || '').toLowerCase() || null;
    const currentDispatchIdentity = normalizeDispatchIdentity(terminalEvent?.dispatchId, modelId);
    const acceptedAnswerIdentity = normalizeDispatchIdentity(terminalAnswerDispatchId, modelId);
    const oldAnswerEvidence = explicitAnswerIdentity === 'current_dispatch'
      ? false
      : (['previous_dispatch', 'stale_accepted'].includes(explicitAnswerIdentity)
        ? true
        : (currentDispatchIdentity !== null && acceptedAnswerIdentity !== null
          ? currentDispatchIdentity !== acceptedAnswerIdentity
          : null));
    const submissionEntries = events.map((event) => ({ event, fact: Contracts?.factOf?.(event) }))
      .filter(({ fact }) => fact?.kind === 'submission');
    const submissionFailed = submissionEntries.some(({ fact }) => fact.state === 'failed');
    const submissionConfirmed = submissionEntries.some(({ fact }) => fact.state === 'confirmed');
    const promptReceivedCounterEvidence = submissionConfirmed
      || generationTextObserved === true
      || (extractedTextLength !== null && extractedTextLength > 0)
      || terminalOutcome === 'SUCCESS';
    const promptNotSentEvidence = promptReceivedCounterEvidence
      ? false
      : (submissionFailed ? true : null);
    const stableDelay = exactEventDuration(lastStableBeforeTerminal, terminalEvent);
    const lastStableSeq = Number(lastStableBeforeTerminal?.seq ?? -Infinity);
    const terminalBoundarySeq = Number(terminalEvent?.seq ?? Infinity);
    const blockingDecisions = events.filter((event) => event.eventType === 'DECISION_RECORDED'
      && Number(event.seq) >= lastStableSeq
      && Number(event.seq) <= terminalBoundarySeq
      && eventBoolean(event, ['accepted', 'decisionAccepted']) === false);
    const acceptingDecisions = events.filter((event) => event.eventType === 'DECISION_RECORDED'
      && Number(event.seq) >= lastStableSeq
      && Number(event.seq) <= terminalBoundarySeq
      && eventBoolean(event, ['accepted', 'decisionAccepted']) === true);
    const invalidatingAfterStable = events.some((event) => Number(event.seq) > lastStableSeq
      && Number(event.seq) < terminalBoundarySeq
      && (event.eventType === 'TEXT_STATE_CHANGED'
        || (event.eventType === 'GENERATION_SIGNAL_CHANGED' && Contracts?.factOf?.(event)?.state === 'active')));
    const policyWaitObserved = blockingDecisions.length ? true : (acceptingDecisions.length ? false : null);
    const lateEndEvidence = stableDelay.comparable && stableDelay.durationMs > 0 && policyWaitObserved === true
      ? (invalidatingAfterStable ? false : true)
      : (policyWaitObserved === false && stableDelay.comparable ? false : null);
    return {
      modelId,
      stateAxes: axes,
      eventSeqs: events.map((event) => event.seq),
      firstSeq: events[0]?.seq || null,
      lastSeq: events[events.length - 1]?.seq || null,
      submissionEvidenceCount: events.filter((event) => /SUBMISSION|SUBMIT_ACTION/.test(event.eventType)).length,
      completionEvidenceTier: axes.completionEvidenceTier,
      acceptedTextLength: acceptedLength,
      extractedTextLength,
      maxObservedTextLength: maxObservedLength,
      postTerminalGrowthChars,
      postTerminalGrowthPct,
      postTerminalGrowthProven,
      postTerminalAuditStatus: latestAudit
        ? (auditPossible === false || auditConclusion === 'unknown' ? 'impossible' : 'completed')
        : (impossibleAudit ? 'impossible' : (pendingAudit ? 'pending' : null)),
      postTerminalAuditConclusion: auditConclusion,
      extractionCoveragePct,
      incompleteCaptureEvidence,
      generationTextObserved,
      acceptedExtractionEventId: extractionEvent?.eventId || null,
      acceptedExtractionResolution: acceptedExtraction.resolution,
      emptyResultEvidence,
      wrongNodeEvidence,
      extractionProblemEvidence,
      emptyExtractionEvidence: extractionProblemEvidence,
      emptyExtractionBranch,
      oldAnswerEvidence,
      normalizedCurrentDispatchId: currentDispatchIdentity,
      normalizedAnswerEvidenceDispatchId: acceptedAnswerIdentity,
      submissionFailed,
      promptReceivedCounterEvidence,
      promptNotSentEvidence,
      hiddenRelevantTextLength: 0,
      candidateCount: new Set(events.map((event) => event.candidateId).filter(Boolean)).size,
      captureBeforeTerminal: false,
      terminalBeforeLastRelevantMutation: Boolean(terminalEvent && events.some((event) => event.seq > terminalEvent.seq && event.eventType === 'TEXT_STATE_CHANGED')),
      terminalOutcome,
      stableToTerminalMs: stableDelay.comparable ? stableDelay.durationMs : null,
      stableToTerminalComparable: stableDelay.comparable ? true : null,
      stableToTerminalClockBasis: stableDelay.basis,
      policyWaitObserved,
      postStabilityMutationObserved: invalidatingAfterStable,
      lateEndEvidence
    };
  }

  function getPath(value, path) {
    return String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
  }

  function evaluatePredicate(context, predicate) {
    const observedValue = getPath(context, predicate.path);
    const expected = predicate.value;
    const known = ['exists', 'missing'].includes(predicate.operator) || (observedValue !== undefined && observedValue !== null);
    const matched = known && ({
      eq: () => observedValue === expected,
      ne: () => observedValue !== expected,
      in: () => Array.isArray(expected) && expected.includes(observedValue),
      not_in: () => Array.isArray(expected) && !expected.includes(observedValue),
      lt: () => Number(observedValue) < Number(expected),
      lte: () => Number(observedValue) <= Number(expected),
      gt: () => Number(observedValue) > Number(expected),
      gte: () => Number(observedValue) >= Number(expected),
      exists: () => observedValue !== undefined,
      missing: () => observedValue === undefined
    }[predicate.operator] || (() => false))();
    return { predicate, observedValue: observedValue === undefined ? null : observedValue, known, matched };
  }

  function evaluateApplicability(reportType, context) {
    const predicates = (Contracts?.normalizedApplicability?.(reportType)?.all || [])
      .map((predicate) => evaluatePredicate(context, predicate));
    const status = predicates.some((result) => result.known && !result.matched)
      ? 'not_confirmed'
      : (predicates.some((result) => !result.known) ? 'unknown' : 'confirmed');
    return { status, mode: 'all', predicateResults: predicates };
  }

  function aggregateApplicability(results) {
    const statuses = (results || []).map((item) => item?.status).filter(Boolean);
    return statuses.includes('confirmed')
      ? 'confirmed'
      : (statuses.length && statuses.every((status) => status === 'not_confirmed') ? 'not_confirmed' : 'unknown');
  }

  function summarizeModelView(view) {
    return {
      incidentId: view.incidentId || null,
      incidentScope: view.incidentScope || null,
      stateAxes: view.stateAxes,
      completionEvidenceTier: view.completionEvidenceTier,
      acceptedTextLength: view.acceptedTextLength,
      extractedTextLength: view.extractedTextLength,
      maxObservedTextLength: view.maxObservedTextLength,
      extractionCoveragePct: view.extractionCoveragePct,
      postTerminalGrowthPct: view.postTerminalGrowthPct,
      postTerminalGrowthProven: view.postTerminalGrowthProven,
      postTerminalAuditStatus: view.postTerminalAuditStatus,
      incompleteCaptureEvidence: view.incompleteCaptureEvidence,
      generationTextObserved: view.generationTextObserved,
      emptyExtractionEvidence: view.emptyExtractionEvidence,
      emptyResultEvidence: view.emptyResultEvidence,
      wrongNodeEvidence: view.wrongNodeEvidence,
      extractionProblemEvidence: view.extractionProblemEvidence,
      emptyExtractionBranch: view.emptyExtractionBranch,
      oldAnswerEvidence: view.oldAnswerEvidence,
      promptReceivedCounterEvidence: view.promptReceivedCounterEvidence,
      promptNotSentEvidence: view.promptNotSentEvidence,
      terminalOutcome: view.terminalOutcome,
      stableToTerminalMs: view.stableToTerminalMs,
      stableToTerminalComparable: view.stableToTerminalComparable,
      stableToTerminalClockBasis: view.stableToTerminalClockBasis,
      policyWaitObserved: view.policyWaitObserved,
      postStabilityMutationObserved: view.postStabilityMutationObserved,
      lateEndEvidence: view.lateEndEvidence
    };
  }

  const SIBLING_RULES = Object.freeze({
    cutted: [['false-success', '$.derivedViews.postTerminalGrowthProven', 'eq', true], ['old-answer', '$.derivedViews.oldAnswerEvidence', 'eq', true], ['empty', '$.derivedViews.emptyExtractionEvidence', 'eq', true]],
    'false-success': [['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true], ['late-end', '$.derivedViews.stableToTerminalMs', 'gt', 0]],
    'old-answer': [['empty', '$.derivedViews.emptyExtractionEvidence', 'eq', true], ['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true]],
    empty: [['old-answer', '$.derivedViews.oldAnswerEvidence', 'eq', true], ['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true]],
    'prompt-not-sent': [],
    'late-end': [['false-success', '$.derivedViews.postTerminalGrowthProven', 'eq', true]]
  });

  function buildReports(ledger, modelViews, incidentViews, ledgerHash, registryHash) {
    const allViews = Object.values(incidentViews);
    return Object.fromEntries(REPORT_TYPES.map((reportType) => {
      const [primaryQuestion, relevantTypes] = REPORT_INFO[reportType];
      const relevant = ledger.filter((event) => relevantTypes.includes(event.eventType));
      const applicabilityByIncident = Object.fromEntries(allViews.map((view) => [view.incidentId, {
        modelId: view.modelId,
        incidentScope: view.incidentScope,
        ...evaluateApplicability(reportType, { stateAxes: view.stateAxes, derivedViews: view })
      }]));
      const applicabilityByModel = Object.fromEntries(Object.keys(modelViews).map((modelId) => {
        const incidentResults = Object.entries(applicabilityByIncident)
          .filter(([, result]) => result.modelId === modelId);
        return [modelId, {
          status: aggregateApplicability(incidentResults.map(([, result]) => result)),
          incidentIds: incidentResults.map(([incidentId]) => incidentId),
          confirmedIncidentIds: incidentResults.filter(([, result]) => result.status === 'confirmed').map(([incidentId]) => incidentId),
          unknownIncidentIds: incidentResults.filter(([, result]) => result.status === 'unknown').map(([incidentId]) => incidentId)
        }];
      }));
      const applicabilityStatus = aggregateApplicability(Object.values(applicabilityByIncident));
      const siblingEvaluations = (SIBLING_RULES[reportType] || []).map(([target, path, operator, value]) => {
        const perIncident = allViews.map((view) => {
          const result = evaluatePredicate({ stateAxes: view.stateAxes, derivedViews: view }, { path, operator, value });
          return { modelId: view.modelId, incidentId: view.incidentId, ...result };
        });
        return {
          reportType: target,
          relation: 'diagnostic-dependency',
          priority: 'required',
          requestIf: { any: [{ path, operator, value }] },
          evaluation: { matched: perIncident.some((result) => result.matched), predicateResults: perIncident }
        };
      });
      const evidenceCoveragePct = ledger.length ? Math.round((relevant.length / ledger.length) * 10000) / 100 : 0;
      return [reportType, {
          reportDescriptor: {
          reportId: `rpt-${reportType}-${eventFingerprint(ledgerHash)}`,
          reportType,
          reportVersion: REPORT_VERSION,
          title: primaryQuestion,
          primaryQuestion,
          applicability: { status: applicabilityStatus, byModel: applicabilityByModel, byIncident: applicabilityByIncident },
          canDiagnose: [],
          cannotDiagnoseAlone: [],
          completeness: {
            level: relevant.length ? 'partial' : 'insufficient',
            evidenceCoveragePct,
            missingCriticalEvidence: relevant.length === 0,
            missingItems: relevant.length ? [] : ['no relevant canonical events in export boundary'],
            safeConclusions: [],
            blockedConclusions: relevant.length ? [] : ['causal verdict']
          },
          reportMode: 'embedded-in-all-presets',
          dependencyRegistryVersion: Contracts?.REGISTRY_VERSION || '4.0.0',
          dependencyRegistryHash: registryHash
        },
        diagnosticSummary: {
          models: Object.fromEntries(Object.entries(modelViews).map(([modelId, view]) => [modelId, summarizeModelView(view)])),
          incidents: Object.fromEntries(allViews.map((view) => [view.incidentId, summarizeModelView(view)]))
        },
        stateAxes: Object.fromEntries(Object.entries(modelViews).map(([modelId, view]) => [modelId, view.stateAxes])),
        eventSeqs: relevant.map((event) => event.seq),
        derivedViewRef: 'model-timeline',
        siblings: siblingEvaluations,
        analysisInstructionsRef: 'sharedConfig.commonAnalysisInstructions'
      }];
    }));
  }

  function validateLedger(ledger) {
    const violations = [];
    const ids = new Set();
    let previousSeq = 0;
    ledger.forEach((event, index) => {
      if (!Number.isFinite(Number(event.seq)) || Number(event.seq) <= previousSeq) {
        violations.push({ invariantId: 'S01', eventId: event.eventId, message: 'seq is not strictly monotonic' });
      }
      previousSeq = Number(event.seq);
      if (ids.has(event.eventId)) violations.push({ invariantId: 'S01', eventId: event.eventId, message: 'duplicate eventId' });
      ids.add(event.eventId);
      (event.evidenceRefs || []).forEach((ref) => {
        if (!ids.has(ref) && !ledger.some((candidate) => candidate.eventId === ref)) violations.push({ invariantId: 'S02', eventId: event.eventId, message: `missing evidenceRef ${ref}` });
      });
      if (event.schemaVersion !== EVENT_SCHEMA_VERSION) violations.push({ invariantId: 'S01', eventId: event.eventId, message: 'event schema mismatch' });
    });
    return violations;
  }

  async function buildAllPresets(input, options = {}) {
    const exportedAt = Number(options.exportedAt || Date.now());
    const ledgerEvents = options.canonicalLedger === true
      ? (Array.isArray(input) ? input.slice() : []).sort((left, right) => Number(left?.seq || 0) - Number(right?.seq || 0))
      : buildLedger(input, { ...options, exportedAt });
    const ledgerHash = await sha256(ledgerEvents);
    const runSessionId = ledgerEvents[0]?.runSessionId || String(options.runSessionId || `export-${exportedAt}`);
    const replayResult = root.ProofTelemetryPolicy?.replay
      ? root.ProofTelemetryPolicy.replay(ledgerEvents)
      : null;
    const indexedIncidents = Incidents?.indexIncidents?.(ledgerEvents) || [];
    const incidentViews = Object.fromEntries(indexedIncidents.map((incident) => {
      const scopedEvents = ledgerEvents.filter((event) => Incidents.exactScope(event, incident.scope));
      const view = deriveModelView(incident.scope.modelId, scopedEvents);
      if (root.ProofTelemetryPolicy?.deriveAxes) {
        view.stateAxes = root.ProofTelemetryPolicy.deriveAxes(scopedEvents, scopedEvents[scopedEvents.length - 1]);
      }
      view.incidentId = incident.incidentId;
      view.incidentScope = incident.scope;
      return [incident.incidentId, view];
    }));
    const byModelIncidentViews = {};
    Object.values(incidentViews).forEach((view) => {
      if (!byModelIncidentViews[view.modelId]) byModelIncidentViews[view.modelId] = [];
      byModelIncidentViews[view.modelId].push(view);
    });
    const modelViews = Object.fromEntries(Object.entries(byModelIncidentViews).map(([modelId, views]) => {
      const ordered = views.slice().sort((left, right) => Number(left.lastSeq || 0) - Number(right.lastSeq || 0));
      const latest = { ...ordered[ordered.length - 1] };
      latest.incidentIds = ordered.map((view) => view.incidentId);
      latest.incidentCount = ordered.length;
      return [modelId, latest];
    }));
    const registrySnapshot = {
      version: Contracts?.REGISTRY_VERSION || '4.0.0',
      predicateLanguageVersion: '1.0.0',
      maxEscalationDepth: 2,
      applicability: Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType, Contracts?.normalizedApplicability?.(reportType) || { all: [] }])),
      rules: SIBLING_RULES
    };
    const registryHash = await sha256(registrySnapshot);
    const sharedConfig = {
      extensionVersion: String(options.extensionVersion || 'unknown'),
      generationWaitProfile: String(options.generationWaitProfile || 'unknown'),
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: GENERATOR_VERSION,
      policy: { policyId: 'proof-default-v1', automaticMinimumEvidenceTier: 3, maximumSignalSkewMs: 250 },
      privacy: { mode: 'metadata-only', rawPromptAnswerExported: false, urlMode: 'hash-only' },
      dependencyRegistry: registrySnapshot,
      commonAnalysisInstructions: [
        'Treat each report as a partial view.',
        'Missing signal is unknown, not absent.',
        'Separate FACT, INFERENCE, DECISION, ACTION and AUDIT.',
        'Cite eventId for technical conclusions.',
        'Evaluate sibling requestIf rules before a final causal verdict.'
      ]
    };
    const sharedConfigHash = await sha256(sharedConfig);
    const derivedViews = {
      'model-timeline': {
        viewType: 'model-timeline',
        derivedFromEventSeqs: ledgerEvents.map((event) => event.seq),
        generatorVersion: GENERATOR_VERSION,
        ledgerHash,
        data: modelViews
      },
      'incident-timeline': {
        viewType: 'incident-timeline',
        derivedFromEventSeqs: ledgerEvents.map((event) => event.seq),
        generatorVersion: GENERATOR_VERSION,
        ledgerHash,
        data: incidentViews
      }
    };
    const reports = buildReports(ledgerEvents, modelViews, incidentViews, ledgerHash, registryHash);
    const viewsHash = await sha256(derivedViews);
    const reportsHash = await sha256(reports);
    const invariantViolations = [
      ...validateLedger(ledgerEvents),
      ...(Array.isArray(replayResult?.invariantViolations) ? replayResult.invariantViolations : [])
    ];
    const recordedDecisionHash = replayResult ? await sha256(replayResult.recordedDecisions) : null;
    const recomputedDecisionHash = replayResult ? await sha256(replayResult.recomputedDecisions) : null;
    const exportId = `export-${runSessionId}-${exportedAt}`;
    const ledgerCompleteThroughSeq = ledgerEvents[ledgerEvents.length - 1]?.seq || 0;
    const attachments = { byId: {}, omissions: [] };
    for (const event of ledgerEvents.filter((candidate) => candidate.eventType === 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED')) {
      const payload = event.payload || {};
      if (payload.captureAvailable === false) {
        attachments.omissions.push({
          attachmentType: payload.attachmentType || 'unknown',
          reason: payload.omissionReason || 'capture unavailable',
          impact: payload.impact || 'forensic detail unavailable',
          eventRef: event.eventId,
          anomalyTrigger: payload.anomalyTrigger || null
        });
        continue;
      }
      const contentHash = await sha256(payload);
      const attachmentId = `att-${contentHash.replace(/^sha256:/, '').slice(0, 16)}`;
      attachments.byId[attachmentId] = {
        attachmentId,
        attachmentType: payload.attachmentType || 'unknown',
        contentHash,
        redacted: true,
        eventRef: event.eventId,
        data: payload.data || null
      };
    }
    const container = {
      schemaVersion: SCHEMA_VERSION,
      containerType: 'all-presets',
      exportId,
      manifest: {
        createdAt: new Date(exportedAt).toISOString(),
        encoding: 'inline-json',
        contentIndex: { reportTypes: REPORT_TYPES.slice(), modelIds: Object.keys(modelViews), eventCount: ledgerEvents.length },
        reportSchemas: Object.fromEntries(REPORT_TYPES.map((type) => [type, REPORT_VERSION])),
        deduplication: { canonicalEventsStoredOnce: true, embeddedReportsContainEventSeqsOnly: true },
        privacyMode: 'metadata-only',
        sizeBudgetBytes: 1000000,
        overflowPolicy: ['drop-rebuildable-derived-detail', 'externalize-optional-attachments', 'aggregate-repeated-checks', 'preserve-canonical-proof-events'],
        omissions: []
      },
      crossReportCompatibility: {
        mode: 'same_export',
        exactMatch: { runSessionId, ledgerHash, ledgerCompleteThroughSeq }
      },
      sharedConfig,
      ledger: {
        encoding: 'inline-json',
        firstSeq: ledgerEvents[0]?.seq || 0,
        lastSeq: ledgerEvents[ledgerEvents.length - 1]?.seq || 0,
        eventCount: ledgerEvents.length,
        ledgerHash,
        events: ledgerEvents
      },
      derivedViews,
      reports,
      attachments,
      exportAudit: {
        sampleData: options.sampleData === true,
        exportBoundary: { runSessionId, ledgerCompleteThroughSeq, frozenAt: exportedAt },
        hashes: { ledger: ledgerHash, sharedConfig: sharedConfigHash, derivedViews: viewsHash, reports: reportsHash, attachments: await sha256(attachments) },
        schemaValidation: { valid: invariantViolations.length === 0, schemaVersion: SCHEMA_VERSION },
        invariantViolations,
        replay: {
          valid: invariantViolations.length === 0 && (!replayResult || recordedDecisionHash === recomputedDecisionHash),
          recordedDecisionHash,
          recomputedDecisionHash
        },
        budget: { limitBytes: 1000000, measuredBytes: null, withinBudget: null },
        sourceCompatibility: options.canonicalLedger === true
          ? { mode: 'native-runtime-ledger', canonicalRuntimeEmissionPending: false }
          : { mode: 'legacy-runtime-adapter', canonicalRuntimeEmissionPending: true }
      }
    };
    // Stabilize the byte count with a fixed-width hash placeholder. The final
    // container hash covers every field except itself, including the final
    // measuredBytes/budget decision.
    container.exportAudit.hashes.container = `sha256:${'0'.repeat(64)}`;
    for (let pass = 0; pass < 3; pass += 1) {
      const serialized = JSON.stringify(container);
      const measuredBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(serialized).length
        : serialized.length;
      container.exportAudit.budget.measuredBytes = measuredBytes;
      container.exportAudit.budget.withinBudget = measuredBytes <= container.manifest.sizeBudgetBytes;
      container.exportAudit.budget.status = container.exportAudit.budget.withinBudget ? 'within_budget' : 'oversized_preserved_core';
    }
    const hashInput = JSON.parse(JSON.stringify(container));
    delete hashInput.exportAudit.hashes.container;
    container.exportAudit.hashes.container = await sha256(hashInput);
    return container;
  }

  async function buildStandaloneReport(input, options = {}) {
    const reportType = String(options.reportType || '');
    if (!REPORT_TYPES.includes(reportType)) throw new Error(`unsupported proof telemetry report: ${reportType}`);
    const modelId = String(options.modelId || '').trim();
    if (!modelId) throw new Error('standalone proof telemetry report requires modelId');
    const exportedAt = Number(options.exportedAt || Date.now());
    const sourceEvents = options.canonicalLedger === true
      ? (Array.isArray(input) ? input.slice() : [])
      : buildLedger(input, options);
    const selection = Incidents.selectIncident(sourceEvents, {
      platform: modelId,
      task: reportType,
      incidentId: options.incidentId || null
    });
    if (!selection.selected) throw new Error(`no ${reportType} incident found for ${modelId}`);
    const closure = Incidents.buildEvidenceClosure(sourceEvents, selection.selected, reportType);
    const materializedEvents = closure.events;
    const materializedHash = await sha256(materializedEvents);
    const sourceLedgerHash = await sha256(sourceEvents);
    const modelView = deriveModelView(modelId, materializedEvents.filter((event) => event.modelId === modelId));
    const axes = root.ProofTelemetryPolicy?.deriveAxes
      ? root.ProofTelemetryPolicy.deriveAxes(materializedEvents, materializedEvents.filter((event) => event.modelId === modelId).slice(-1)[0])
      : modelView.stateAxes;
    modelView.stateAxes = axes;
    const registrySnapshot = { version: Contracts?.REGISTRY_VERSION || '4.0.0', reports: Contracts?.REPORT_CONTRACTS || {} };
    const registryHash = await sha256(registrySnapshot);
    const context = { stateAxes: axes, derivedViews: modelView };
    const applicability = evaluateApplicability(reportType, context);
    const siblings = (SIBLING_RULES[reportType] || []).map(([target, path, operator, value]) => {
      const result = evaluatePredicate(context, { path, operator, value });
      return {
        reportType: target,
        relation: 'diagnostic-dependency',
        priority: 'required',
        requestIf: { any: [{ path, operator, value }] },
        evaluation: { matched: result.matched, predicateResults: [{ modelId, ...result }] },
        antiLoop: { sourceReportType: reportType, requestTargetOnlyOnce: true }
      };
    });
    const contributingIds = materializedEvents.filter((event) => event.modelId === modelId).map((event) => event.eventId);
    const fieldProvenance = Object.fromEntries(Object.keys(axes).map((field) => [field, {
      derivedFromEventIds: contributingIds,
      derivationVersion: `${GENERATOR_VERSION}:axes-v2`
    }]));
    const replayAxes = root.ProofTelemetryPolicy?.deriveAxes
      ? root.ProofTelemetryPolicy.deriveAxes(materializedEvents, materializedEvents.filter((event) => event.modelId === modelId).slice(-1)[0])
      : axes;
    const replayValid = stableStringify(replayAxes) === stableStringify(axes);
    const semanticEvents = materializedEvents.map((event) => {
      const copy = JSON.parse(JSON.stringify(event));
      delete copy.wallTs;
      if (copy.clock) delete copy.clock.ingestMonoMs;
      return copy;
    });
    const semanticHash = await sha256({ incident: selection.selected.scope, task: reportType, events: semanticEvents, axes });
    const completeness = {
      level: closure.sufficiency,
      evidenceCoveragePct: closure.slots.length ? Math.round((closure.slots.filter((slot) => slot.status === 'satisfied').length / closure.slots.length) * 10000) / 100 : 0,
      missingCriticalEvidence: closure.missingEvidence.some((item) => item.criticality === 'critical'),
      missingItems: closure.missingEvidence,
      safeConclusions: closure.sufficiency === 'complete' ? ['all required evidence slots are materialized'] : ['only conclusions supported by satisfied slots'],
      blockedConclusions: closure.sufficiency === 'complete' ? [] : closure.missingEvidence.map((item) => `blocked by ${item.slotId}`)
    };
    const report = {
      schemaVersion: SCHEMA_VERSION,
      fileKind: 'diagnostic-report',
      reportDescriptor: {
        reportId: `rpt-${reportType}-${modelId}-${eventFingerprint(sourceLedgerHash)}`,
        reportType,
        reportVersion: REPORT_VERSION,
        title: REPORT_INFO[reportType][0],
        primaryQuestion: REPORT_INFO[reportType][0],
        applicability,
        canDiagnose: completeness.safeConclusions.map((claim) => ({ claim })),
        cannotDiagnoseAlone: completeness.blockedConclusions.map((claim) => ({ claim })),
        completeness,
        reportMode: 'standalone',
        dependencyRegistryVersion: registrySnapshot.version,
        dependencyRegistryHash: registryHash
      },
      correlation: {
        incidentId: selection.selected.incidentId,
        ...selection.selected.scope,
        candidateIds: selection.selected.candidateIds,
        navigationLineage: selection.selected.navigationLineage,
        selectionReason: selection.selectionReason,
        matchingIncidentCount: selection.matchingIncidentCount,
        otherMatchingIncidents: selection.otherMatchingIncidents
      },
      reportCatalogSnapshot: REPORT_TYPES.map((type) => ({
        reportType: type,
        reportVersion: REPORT_VERSION,
        included: type === reportType
      })),
      runConfiguration: {
        extensionVersion: options.extensionVersion || 'unknown',
        policy: { automaticMinimumEvidenceTier: 3, thresholds: Contracts?.THRESHOLDS || {} },
        privacy: { mode: 'metadata-only' }
      },
      diagnosticSummary: {
        incidentId: selection.selected.incidentId,
        applicability,
        sufficiency: closure.sufficiency,
        evidenceSlots: closure.slots,
        safeConclusions: completeness.safeConclusions,
        blockedConclusions: completeness.blockedConclusions
      },
      stateAxes: axes,
      eventSelection: {
        includedEventTypes: Array.from(new Set(materializedEvents.map((event) => event.eventType))),
        eventRefs: materializedEvents.map((event) => event.eventId),
        materializedEvents
      },
      derivedViews: {
        modelTimeline: {
          viewType: reportType,
          generatorVersion: GENERATOR_VERSION,
          ledgerHash: materializedHash,
          data: modelView
        },
        fieldProvenance
      },
      contradictions: closure.violations,
      missingEvidence: closure.missingEvidence,
      siblings,
      analysisInstructions: {
        version: '1.0.0',
        instructions: [
          'Analyze only the identified incident and materialized evidence.',
          'Treat unavailable evidence and uncertain clocks as limits, not negative proof.',
          'Use includedFor and field provenance to verify every conclusion.'
        ]
      },
      crossReportCompatibility: {
        mode: 'same_incident',
        exactMatch: {
          runSessionId: selection.selected.scope.runSessionId,
          runGeneration: selection.selected.scope.runGeneration,
          modelId,
          dispatchId: selection.selected.scope.dispatchId,
          generationEpoch: selection.selected.scope.generationEpoch,
          sourceLedgerHash,
          materializedEventHash: materializedHash
        }
      },
      attachments: [],
      exportIntegrity: {
        generatorVersion: GENERATOR_VERSION,
        sampleData: options.sampleData === true,
        sourceLedgerHash,
        materializedEventHash: materializedHash,
        semanticHash,
        sourceLedgerEventCount: sourceEvents.length,
        materializedEventCount: materializedEvents.length,
        deduplication: {
          canonicalEventCopies: materializedEvents.length,
          duplicateEventIds: materializedEvents.length - new Set(materializedEvents.map((event) => event.eventId)).size
        },
        schemaValidation: {
          valid: closure.violations.length === 0 && materializedEvents.every((event) => Array.isArray(event.includedFor) && event.includedFor.length > 0),
          scope: 'materialized-events',
          status: 'validated',
          reason: closure.violations.length ? 'incident closure violations' : null
        },
        replay: {
          valid: replayValid,
          scope: 'materialized-events',
          status: 'validated',
          recordedStateHash: await sha256(axes),
          recomputedStateHash: await sha256(replayAxes),
          reason: replayValid ? null : 'materialized replay mismatch'
        },
        hashes: { artifact: null, semantic: semanticHash },
        size: { measuredBytes: null, category: null, measurementOnly: true }
      }
    };
    report.exportIntegrity.hashes.artifact = `sha256:${'0'.repeat(64)}`;
    for (let pass = 0; pass < 3; pass += 1) {
      const serialized = JSON.stringify(report);
      const measuredBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(serialized).length
        : serialized.length;
      report.exportIntegrity.size.measuredBytes = measuredBytes;
      report.exportIntegrity.size.category = measuredBytes < 20000 ? 'small' : (measuredBytes < 100000 ? 'medium' : 'large');
    }
    const hashInput = JSON.parse(JSON.stringify(report));
    delete hashInput.exportIntegrity.hashes.artifact;
    report.exportIntegrity.hashes.artifact = await sha256(hashInput);
    return report;
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION,
    GENERATOR_VERSION,
    REPORT_TYPES,
    REPORT_EVENT_TYPES,
    SIBLING_RULES,
    stableStringify,
    sha256,
    canonicalType,
    classifyRuntimeEvent,
    layerFor,
    sanitizeValue,
    eventFingerprint,
    buildLedger,
    deriveAxes,
    deriveModelView,
    evaluatePredicate,
    evaluateApplicability,
    validateLedger,
    buildAllPresets,
    buildStandaloneReport
  });

  root.ProofOrientedTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

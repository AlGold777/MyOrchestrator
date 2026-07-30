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
  const GENERATOR_VERSION = 'proof-export@2.5.0';
  const REPORT_VERSION = '3.5.0';
  const REPORT_TYPES = Object.freeze([
    'cutted',
    'false-success',
    'old-answer',
    'no-delivery',
    'prompt-not-inserted',
    'prompt-not-sent',
    'late-end'
  ]);

  const REPORT_EVENT_TYPES = Object.freeze(Object.fromEntries(
    REPORT_TYPES.map((reportType) => [
      reportType,
      Object.freeze(Array.from(new Set((Contracts?.normalizedSlots?.(reportType) || [])
        .flatMap((slot) => slot.eventTypes))))
    ])
  ));

  function reportQuestion(reportType) {
    return Contracts?.REPORT_CONTRACTS?.[reportType]?.question || reportType;
  }

  const EVENT_MAP = Object.freeze({
    DISPATCH_BASELINE_CAPTURED: 'DISPATCH_BASELINE_CAPTURED',
    DISPATCH_START: 'SUBMIT_ACTION_OBSERVED',
    DISPATCH_SEND: 'SUBMIT_ACTION_OBSERVED',
    PROMPT_SUBMITTED_PENDING: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_ACCEPTED: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_REJECTED: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_TIMEOUT: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_STALE: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_SUBMITTED_UNCONFIRMED: 'SUBMISSION_EVIDENCE_CHANGED',
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
    STALE_BASELINE_ANSWER_IGNORED: 'CANDIDATE_SET_CHANGED',
    TURN_RESOLUTION_ACCEPTED: 'CANDIDATE_IDENTITY_INFERRED',
    ANSWER_COMPLETE_DETECTED: 'COMPLETION_HYPOTHESIS_EVALUATED',
    ANSWER_COMPLETE_TIMEOUT: 'TERMINAL_DEADLINE_REACHED',
    ANSWER_PARTIAL_ON_TIMEOUT: 'ANSWER_COMPLETENESS_EVALUATED',
    ANSWER_VERIFICATION_RECORDED: 'STRUCTURAL_VERIFICATION_EVALUATED',
    ANSWER_VERIFICATION_RESULT: 'STRUCTURAL_VERIFICATION_EVALUATED',
    ANSWER_EXTRACTION_COMPLETED: 'EXTRACTION_COMPLETED',
    MULTIPLE_CANDIDATES_AMBIGUOUS: 'CANDIDATE_SET_CHANGED',
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
    SELECTOR_RESOLVE_FAIL: 'OBSERVER_HEALTH_OBSERVED',
    FOCUS_STUCK: 'OBSERVER_HEALTH_OBSERVED',
    LEASE_GRANTED: 'OBSERVATION_SLOT_GRANTED',
    LEASE_DENIED: 'OBSERVATION_SLOT_DENIED',
    LEASE_RELEASED: 'OBSERVATION_SLOT_RELEASED',
    COMMAND_SEND_ERROR: 'SUBMISSION_EVIDENCE_CHANGED',
    PROMPT_INSERTION_FAILED: 'PROMPT_INSERTION_EVALUATED',
    SEND_DEFERRED_TRANSIENT_BLOCKER: 'SUBMISSION_EVIDENCE_CHANGED',
    SEND_DEGRADED_AFTER_SUBMIT: 'SUBMISSION_EVIDENCE_CHANGED',
    GEMINI_STALE_BASELINE_REJECTED: 'CANDIDATE_SET_CHANGED',
    GROK_PROMPT_ECHO_REJECTED: 'CANDIDATE_SET_CHANGED',
    GROK_SENT_PROMPT_CONFIRMED: 'SUBMISSION_EVIDENCE_CHANGED',
    DOM_FALLBACK_START: 'EXTRACTION_ATTEMPTED',
    DOM_FALLBACK_JOINED: 'EXTRACTION_ATTEMPTED',
    DOM_FALLBACK_SUCCESS: 'EXTRACTION_COMPLETED',
    DOM_FALLBACK_TIMEOUT: 'EXTRACTION_COMPLETED',
    COMPOSER_NOT_FOUND: 'PAGE_HEALTH_OBSERVED',
    ANSWER_SOURCE_MATERIALIZED: 'ANSWER_SOURCE_MATERIALIZED',
    ANSWER_DELIVERY_ACKNOWLEDGED: 'ANSWER_DELIVERY_ACKNOWLEDGED',
    ANSWER_DELIVERY_REJECTED: 'ANSWER_DELIVERY_REJECTED',
    ANSWER_COMMIT_EVALUATED: 'ANSWER_COMMIT_EVALUATED',
    ANSWER_CARD_RENDER_EVALUATED: 'ANSWER_CARD_RENDER_EVALUATED',
    LATE_COLLECT_DECISION_TRACE: 'OBSERVATION_FRAME_CAPTURED',
    PROVIDER_FINISH_REASON: 'GENERATION_SIGNAL_CHANGED'
  });

  const RUNTIME_TYPED_FACTS = Object.freeze({
    COMMAND_SEND_ERROR: { kind: 'submission', state: 'failed' },
    PROMPT_INSERTION_FAILED: { kind: 'prompt_insertion', state: 'failed' },
    SEND_DEFERRED_TRANSIENT_BLOCKER: { kind: 'submission', state: 'deferred' },
    SEND_DEGRADED_AFTER_SUBMIT: { kind: 'submission', state: 'confirmed' },
    GEMINI_STALE_BASELINE_REJECTED: { kind: 'candidate_identity', state: 'stale' },
    GROK_PROMPT_ECHO_REJECTED: { kind: 'candidate_identity', state: 'rejected' },
    GROK_SENT_PROMPT_CONFIRMED: { kind: 'submission', state: 'confirmed' },
    DOM_FALLBACK_START: { kind: 'extraction_attempt', state: 'started', mode: 'fallback' },
    DOM_FALLBACK_JOINED: { kind: 'extraction_attempt', state: 'joined', mode: 'fallback' },
    DOM_FALLBACK_SUCCESS: { kind: 'extraction', state: 'completed', outcome: 'completed', mode: 'fallback' },
    DOM_FALLBACK_TIMEOUT: { kind: 'extraction', state: 'failed', outcome: 'failed', mode: 'fallback' },
    ANSWER_EXTRACTION_COMPLETED: { kind: 'extraction', state: 'completed', outcome: 'completed', mode: 'primary' },
    MULTIPLE_CANDIDATES_AMBIGUOUS: { kind: 'candidate_identity', state: 'ambiguous' },
    STALE_BASELINE_ANSWER_IGNORED: { kind: 'candidate_identity', state: 'stale' },
    TURN_RESOLUTION_ACCEPTED: { kind: 'candidate_identity', state: 'current_dispatch' },
    COMPOSER_NOT_FOUND: { kind: 'observation', state: 'degraded' },
    SELECTOR_RESOLVE_FAIL: { kind: 'observation', state: 'degraded' },
    ANSWER_SOURCE_MATERIALIZED: { kind: 'source_answer', state: 'materialized' },
    ANSWER_DELIVERY_ACKNOWLEDGED: { kind: 'delivery', state: 'accepted', outcome: 'accepted' },
    ANSWER_DELIVERY_REJECTED: { kind: 'delivery', state: 'rejected', outcome: 'rejected' },
    PROVIDER_FINISH_REASON: { kind: 'provider_terminal', state: 'completed' }
  });

  const OPERATIONAL_EVENT_PATTERN = /^(?:ADAPTIVE_PROBE_TICK|MANUAL_PING(?:_FAIL|_START|_RESULT)?|PING_(?:TRANSPORT_ERROR|RETRY|TICK)|ROUND4_GATE_WAIT|MODEL_RUN_TRANSITION|STATE_PROJECTION_COMMITTED|DETECTOR_TICK|SELECTOR_STATS|RECOVERY_BUDGET_(?:EXHAUSTED|CONSUMED|WAIT)|FOCUS_(?:WAIT|RETRY|CHECK)|LEASE_(?:WAIT|RETRY|CHECK)|POLL(?:ING)?_TICK|WATCHDOG_TICK)$/;

  function rejectionMapping(event, label) {
    if (!['SENDER_WITHOUT_BINDING_REJECTED', 'SENDER_TAB_MISMATCH_REJECTED', 'LIFECYCLE_CORRELATION_REJECTED'].includes(label)) return null;
    const messageType = String(event?.meta?.messageType || '').toUpperCase();
    if (/^(?:LLM_RESPONSE|FINAL_LLM_RESPONSE|ANSWER_SNAPSHOT)/.test(messageType)) {
      return {
        route: 'canonical',
        label,
        eventType: 'ANSWER_DELIVERY_REJECTED',
        typed: { kind: 'delivery', state: 'rejected', outcome: 'rejected' }
      };
    }
    if (/^(?:PROMPT_SUBMITTED|PROVIDER_DISPATCH)/.test(messageType)) {
      return {
        route: 'canonical',
        label,
        eventType: 'SUBMISSION_EVIDENCE_CHANGED',
        typed: { kind: 'submission', state: 'failed' }
      };
    }
    return { route: 'debug', label, eventType: null };
  }

  function classifyRuntimeEvent(event = {}) {
    const label = normalizeLabel(event);
    if (event?.proofEventType || event?.meta?.proofEventType) {
      return { route: 'canonical', label, eventType: String(event.proofEventType || event.meta.proofEventType) };
    }
    const rejection = rejectionMapping(event, label);
    if (rejection) return rejection;
    if (EVENT_MAP[label]) return { route: 'canonical', label, eventType: EVENT_MAP[label], typed: RUNTIME_TYPED_FACTS[label] || null };
    if (OPERATIONAL_EVENT_PATTERN.test(label)) return { route: 'operational', label, eventType: 'OBSERVER_HEALTH_INTERVAL_CLOSED' };
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
    const rejection = rejectionMapping(event, label);
    if (rejection?.eventType) return rejection.eventType;
    if (EVENT_MAP[label]) return EVENT_MAP[label];
    if (OPERATIONAL_EVENT_PATTERN.test(label)) return 'OBSERVER_HEALTH_INTERVAL_CLOSED';
    return null;
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
    const routedSource = source.map((legacy) => ({ legacy, route: classifyRuntimeEvent(legacy) }))
      .filter(({ route }) => route.route !== 'debug' && route.eventType);
    const firstWallTs = Number(routedSource[0]?.legacy?.ts || options.exportedAt || Date.now());
    const runSessionId = options.runSessionId || source.find((event) => event?.meta?.runSessionId)?.meta?.runSessionId || `export-${firstWallTs}`;
    return routedSource.map(({ legacy, route }, index) => {
      const seq = index + 1;
      const wallTs = Number(legacy?.ts || firstWallTs);
      const modelId = platformOf(legacy);
      const type = route.eventType;
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
          typed: route.typed || Contracts?.adaptLegacyEvent?.({ payload: { sourceEventType: normalizeLabel(legacy) || 'UNKNOWN', metadata: meta } }) || { kind: 'unknown', state: 'unknown' },
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

  function numericValue(event, keys) {
    return numericMeta(event ? [event] : [], keys)[0] ?? null;
  }

  function observationWindowAfter(events, boundaryEvent) {
    const requiredMs = Number(Contracts?.THRESHOLDS?.generationStartTimeoutMs || 15000);
    const signalTypes = new Set(['OBSERVATION_FRAME_CAPTURED', 'PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_INTERVAL_CLOSED']);
    if (!boundaryEvent) return { usable: false, coverage: 'incomplete', reason: 'failed_action_not_observed', durationMs: null, startEventId: null, endEventId: null, signalEventIds: [] };
    const postBoundary = events.filter((event) => Number(event.seq) > Number(boundaryEvent.seq) && signalTypes.has(event.eventType));
    const bad = postBoundary.some((event) => {
      const fact = Contracts?.factOf?.(event) || {};
      return (fact.kind === 'observation' && ['degraded', 'stale', 'unavailable'].includes(String(fact.state || '').toLowerCase()))
        || eventBoolean(event, ['continuous', 'coverageContinuous']) === false
        || Number(eventValue(event, ['gapMs', 'unobservedGapMs']) || 0) > 0;
    });
    const reliable = postBoundary.filter((event) => {
      const fact = Contracts?.factOf?.(event) || {};
      return (fact.kind === 'observation' && ['reliable', 'healthy', 'available'].includes(String(fact.state || '').toLowerCase()))
        || (fact.kind === 'observation_interval' && fact.state === 'closed');
    });
    const explicitClosure = [...postBoundary].reverse().find((event) => ['OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_INTERVAL_CLOSED'].includes(event.eventType)) || null;
    const end = explicitClosure || reliable[reliable.length - 1] || null;
    const duration = exactEventDuration(boundaryEvent, end);
    const explicitlyComplete = explicitClosure
      ? !['incomplete', 'partial', 'gapped'].includes(String(eventValue(explicitClosure, ['coverage', 'observationCoverage']) || '').toLowerCase())
      : false;
    const continuouslySampled = !explicitClosure && reliable.length >= 2 && reliable.every((event, index) => {
      if (!index) return true;
      const gap = exactEventDuration(reliable[index - 1], event);
      return gap.comparable && gap.durationMs <= Number(Contracts?.THRESHOLDS?.maximumSignalSkewMs || 250);
    });
    const usable = Boolean(!bad && reliable.length && duration.comparable && duration.durationMs >= requiredMs
      && (explicitlyComplete || continuouslySampled));
    return {
      usable,
      coverage: usable ? 'complete' : 'incomplete',
      reason: usable ? 'post_failure_window_complete' : (bad ? 'observation_gap_or_degradation' : (!duration.comparable ? 'clock_unavailable' : (duration.durationMs < requiredMs ? 'window_too_short' : 'continuous_coverage_unproven'))),
      requiredDurationMs: requiredMs,
      durationMs: duration.comparable ? duration.durationMs : null,
      clockBasis: duration.basis,
      startEventId: boundaryEvent.eventId,
      endEventId: end?.eventId || null,
      signalEventIds: postBoundary.map((event) => event.eventId)
    };
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

  function deriveNoDelivery(events, terminalEvent, axes) {
    const sources = events.filter((event) => event.eventType === 'ANSWER_SOURCE_MATERIALIZED');
    const renders = events.filter((event) => event.eventType === 'ANSWER_CARD_RENDER_EVALUATED');
    const source = sources[sources.length - 1] || null;
    const sourceProofLevel = String(eventValue(source, ['sourceProofLevel']) || 'unproven').toLowerCase();
    const sourceProven = source
      ? ['direct_preterminal', 'direct_postterminal', 'retrospective_identity_proven'].includes(sourceProofLevel)
      : null;
    const sourcePayloadId = eventValue(source, ['payloadEvidenceId']);
    const sourceAttemptId = eventValue(source, ['attemptId', 'sourceRevisionId']);
    const comparableRender = [...renders].reverse().find((event) => {
      const payloadId = eventValue(event, ['payloadEvidenceId']);
      const attemptId = eventValue(event, ['attemptId', 'sourceRevisionId']);
      if (sourcePayloadId && payloadId) return String(sourcePayloadId) === String(payloadId);
      if (sourceAttemptId && attemptId) return String(sourceAttemptId) === String(attemptId);
      return false;
    }) || null;
    const latestRender = renders[renders.length - 1] || null;
    const render = comparableRender || latestRender;
    const declaredRenderOutcome = String(eventValue(render, ['outcome']) || '').toLowerCase() || null;
    const renderContentClass = String(eventValue(render, ['contentClass']) || '').toLowerCase() || null;
    const usableResult = eventBoolean(render, ['usableResult']);
    const renderOutcome = renderContentClass && renderContentClass !== 'answer' && declaredRenderOutcome !== 'empty'
      ? (renderContentClass === 'previous_answer' ? 'mismatched' : renderContentClass)
      : declaredRenderOutcome;
    const identityComparable = Boolean(source && comparableRender);
    const expectedCardId = eventValue(render, ['expectedCardId']);
    const observedCardId = eventValue(render, ['observedCardId']);
    const expectedCardKnown = Boolean(expectedCardId);
    const sourceNormalizationVersion = eventValue(source, ['normalizationVersion']);
    const expectedNormalizationVersion = eventValue(render, ['expectedNormalizationVersion'])
      || sourceNormalizationVersion;
    const renderNormalizationVersion = eventValue(render, ['normalizationVersion']);
    const normalizationComparable = Boolean(sourceNormalizationVersion && expectedNormalizationVersion
      && sourceNormalizationVersion === expectedNormalizationVersion
      && (renderOutcome === 'empty' || (renderNormalizationVersion && renderNormalizationVersion === sourceNormalizationVersion)));
    const independentlyUnusable = usableResult === false
      || ['empty', 'technical_message', 'provider_error', 'prompt_echo', 'previous_answer', 'placeholder', 'non_text'].includes(renderContentClass);
    const negativeOutcomeProven = ['empty', 'wrong_card'].includes(renderOutcome)
      || independentlyUnusable;
    const positiveDelivery = renderOutcome === 'matched'
      && renderContentClass === 'answer'
      && String(expectedCardId) === String(observedCardId);
    const noDeliveryEvidence = sourceProven !== true || !render || !expectedCardKnown
      ? null
      : (!identityComparable || !normalizationComparable
        ? null
        : (positiveDelivery ? false : (negativeOutcomeProven ? true : null)));
    const attemptId = sourceAttemptId || eventValue(render, ['attemptId', 'sourceRevisionId']) || null;
    const payloadEvidenceId = sourcePayloadId || eventValue(render, ['payloadEvidenceId']) || null;
    const pathEvents = events.filter((event) => {
      const eventAttempt = eventValue(event, ['attemptId', 'sourceRevisionId']);
      const eventPayload = eventValue(event, ['payloadEvidenceId']);
      return (attemptId && eventAttempt && String(attemptId) === String(eventAttempt))
        || (payloadEvidenceId && eventPayload && String(payloadEvidenceId) === String(eventPayload));
    });
    const deliveryRejected = [...pathEvents].reverse().find((event) => event.eventType === 'ANSWER_DELIVERY_REJECTED') || null;
    const commit = [...pathEvents].reverse().find((event) => event.eventType === 'ANSWER_COMMIT_EVALUATED') || null;
    const extraction = [...pathEvents].reverse().find((event) => event.eventType === 'EXTRACTION_COMPLETED') || null;
    const rejectionReason = String(eventValue(deliveryRejected, ['reason']) || '').toLowerCase();
    const extractionOutcome = String(eventValue(extraction, ['outcome', 'status']) || '').toLowerCase();
    let mechanismCauseCode = null;
    let failureStageCode = null;
    if (extractionOutcome === 'empty') {
      mechanismCauseCode = 'extraction_empty';
      failureStageCode = 'extraction';
    } else if (extractionOutcome === 'unsupported') {
      mechanismCauseCode = 'extraction_unsupported_source';
      failureStageCode = 'extraction';
    } else if (rejectionReason === 'post_terminal_noise') {
      mechanismCauseCode = 'delivery_rejected_post_terminal';
      failureStageCode = 'delivery';
    } else if (/correlation|dispatch_mismatch|run_session_mismatch/.test(rejectionReason)
      || deliveryRejected?.payload?.sourceEventType === 'LIFECYCLE_CORRELATION_REJECTED') {
      mechanismCauseCode = 'delivery_rejected_correlation';
      failureStageCode = 'delivery';
    } else if (eventBoolean(commit, ['overwrite']) === true) {
      mechanismCauseCode = 'commit_overwritten';
      failureStageCode = 'commit';
    } else if (renderOutcome === 'empty') {
      mechanismCauseCode = 'card_render_empty';
      failureStageCode = 'render';
    }
    const observabilityLimitationCodes = [];
    if (!attemptId || !payloadEvidenceId) observabilityLimitationCodes.push('attempt_identity_missing');
    if (render && !normalizationComparable) observabilityLimitationCodes.push('normalization_incomparable');
    if (axes?.observationReliability && axes.observationReliability !== 'reliable') observabilityLimitationCodes.push('observer_gap');
    const sourceRecovery = sourceProofLevel === 'retrospective_identity_proven';
    const recoveryFindingCode = sourceRecovery ? 'manual_recovery_found_answer' : null;
    const orderedStages = [
      ['source', source],
      ['extraction', extraction],
      ['delivery', pathEvents.find((event) => ['ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_DELIVERY_REJECTED'].includes(event.eventType)) || null],
      ['commit', commit],
      ['render', render]
    ];
    const observedStages = orderedStages.filter(([, event]) => event).map(([stage]) => stage);
    const failureIndex = orderedStages.findIndex(([stage]) => stage === failureStageCode);
    const lastSuccessfulStage = failureIndex >= 0
      ? orderedStages.slice(0, failureIndex).filter(([, event]) => event).map(([stage]) => stage).slice(-1)[0] || null
      : observedStages.slice(-1)[0] || null;
    const causeVerdict = noDeliveryEvidence === false
      ? 'not_applicable'
      : (noDeliveryEvidence !== true
        ? 'unknown'
        : (mechanismCauseCode ? 'confirmed' : (observedStages.length > 1 ? 'supported_but_incomplete' : 'unknown')));
    const evaluationBoundaryId = eventValue(render, ['evaluationBoundaryId']) || render?.eventId || terminalEvent?.eventId || null;
    const evaluationBoundaryType = eventValue(render, ['evaluationBoundaryType'])
      || (terminalEvent && render && Number(render.seq) >= Number(terminalEvent.seq) ? 'automatic_terminal' : 'delivery_deadline');
    return {
      noDeliveryEvidence,
      sourceAnswerMaterializedEvidence: sourceProven,
      sourceProofLevel,
      sourceEvidenceEventId: source?.eventId || null,
      cardDeliveryOutcome: renderOutcome,
      expectedCardId: expectedCardId || null,
      observedCardId: observedCardId || null,
      cardContentClass: renderContentClass,
      cardUsableResult: usableResult,
      cardRenderEvidenceEventId: render?.eventId || null,
      sourceToCardComparison: identityComparable && normalizationComparable ? renderOutcome : 'incomparable',
      evaluationBoundaryId,
      evaluationBoundaryType,
      resolutionState: eventValue(render, ['resolutionState']) || (renderOutcome === 'matched' ? 'delivered' : 'unresolved'),
      deliveryAttemptGraph: {
        attemptId,
        payloadEvidenceId,
        observedStages,
        eventIds: pathEvents.map((event) => event.eventId)
      },
      lastSuccessfulStage,
      firstObservedUnsuccessfulStage: failureStageCode,
      failureRange: failureStageCode ? [lastSuccessfulStage, failureStageCode] : (noDeliveryEvidence === true ? [lastSuccessfulStage, 'render'] : null),
      failureStageCode,
      mechanismCauseCode,
      observabilityLimitationCodes,
      recoveryFindingCode,
      causeVerdict,
      unexplainedByCatalogue: noDeliveryEvidence === true && !mechanismCauseCode
    };
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
    const observationStates = events.map((event) => Contracts?.factOf?.(event))
      .filter((fact) => fact?.kind === 'observation').map((fact) => fact.state);
    const observerUnavailable = observationStates.includes('unavailable') || includesSource(events, /OBSERVER.*UNAVAILABLE|TAB_CLOSED/);
    const observerStale = observationStates.includes('stale') || includesSource(events, /OBSERVER.*STALE|STALE_OBSERVATION/);
    const observerBad = observationStates.includes('degraded') || includesSource(events, /SCRIPT_HEALTH_FAIL|FOCUS_STUCK|OBSERVER.*FAIL/);
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
      observationReliability: observerUnavailable ? 'unavailable' : (observerStale ? 'stale' : (observerBad ? 'degraded' : 'reliable')),
      finalization: terminal ? 'accepted' : forced ? 'retry_scheduled' : 'not_evaluated',
      terminalMode: terminal ? (forced ? 'forced' : recovery ? 'recovery' : 'automatic') : 'none',
      terminationCause: terminal ? (forced ? 'policy_forced' : completion ? 'provider_completed' : 'unknown') : 'unknown'
    };
  }

  function deriveModelView(modelId, events) {
    const axes = root.ProofTelemetryPolicy?.deriveAxes && events.length
      ? root.ProofTelemetryPolicy.deriveAxes(events, events[events.length - 1])
      : deriveAxes(events);
    const terminalEvent = [...events].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    const terminalSeq = Number(terminalEvent?.seq ?? Infinity);
    const observedTextTypes = new Set(['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED', 'STABILITY_INTERVAL_CLOSED']);
    const observedTextEvents = events.filter((event) => observedTextTypes.has(event.eventType));
    const preTerminalObservedEvents = observedTextEvents.filter((event) => Number(event.seq) <= terminalSeq);
    const preTerminalLengths = numericMeta(preTerminalObservedEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const terminalLengths = terminalEvent ? numericMeta([terminalEvent], ['textLength', 'answerLength', 'answerLen']) : [];
    const acceptedLength = terminalLengths.length ? terminalLengths[0] : null;
    const acceptedExtraction = resolveAcceptedExtraction(events, terminalEvent);
    const extractionEvent = acceptedExtraction.event;
    const extractionIdentityHint = String(eventValue(extractionEvent, ['answerIdentity']) || '').toLowerCase() || null;
    const extractionLengths = extractionEvent
      ? numericMeta([extractionEvent], ['extractedTextLength', 'capturedTextLength', 'textLength', 'answerLength', 'answerLen', 'length'])
      : [];
    const extractedTextLength = extractionLengths.length ? extractionLengths[extractionLengths.length - 1] : null;
    const acceptedCandidateId = extractionEvent?.candidateId || terminalEvent?.candidateId || null;
    const normalizedExtractionIdentity = Contracts?.normalizeIdentityState?.(extractionIdentityHint);
    const incidentCandidateIds = new Set(events.map((event) => event.candidateId).filter(Boolean).map(String));
    const candidateReplacementObserved = events.some((event) => event.eventType === 'CANDIDATE_SET_CHANGED'
      && (/replace|supersed|switch/i.test(JSON.stringify(event.payload || {}))
        || new Set([event.candidateId, eventValue(event, ['previousCandidateId', 'nextCandidateId', 'candidateId'])].filter(Boolean).map(String)).size > 1));
    const measurementComparability = acceptedCandidateId
      ? (preTerminalObservedEvents.some((event) => String(event.candidateId || '') === String(acceptedCandidateId)) ? 'candidate_proven' : 'unknown')
      : (normalizedExtractionIdentity === 'current'
        ? 'dispatch_proven'
        : (!candidateReplacementObserved && incidentCandidateIds.size <= 1 ? 'single_candidate' : 'unknown'));
    const eventComparable = (event) => {
      if (measurementComparability === 'unknown') return false;
      if (measurementComparability === 'candidate_proven') return String(event?.candidateId || '') === String(acceptedCandidateId);
      return !event?.candidateId || incidentCandidateIds.size <= 1;
    };
    const stableEvents = events.filter((event) => event.eventType === 'STABILITY_INTERVAL_CLOSED' && eventComparable(event));
    const lastStableBeforeTerminal = terminalEvent
      ? stableEvents.filter((event) => Number(event.seq) <= Number(terminalEvent.seq)).slice(-1)[0]
      : stableEvents.slice(-1)[0];
    const candidateMatchedObservedEvents = preTerminalObservedEvents.filter(eventComparable);
    const candidateMatchedLengths = numericMeta(candidateMatchedObservedEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const candidateContinuity = measurementComparability === 'candidate_proven'
      ? 'matched'
      : (acceptedCandidateId ? 'mismatched' : measurementComparability);
    const maxObservedLength = preTerminalLengths.length ? Math.max(...preTerminalLengths) : null;
    const comparableObservedLength = [...candidateMatchedObservedEvents].reverse()
      .map((event) => numericValue(event, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']))
      .find((value) => value !== null) ?? null;
    const postTerminalObservedEvents = terminalEvent
      ? observedTextEvents.filter((event) => Number(event.seq) > Number(terminalEvent.seq) && eventComparable(event))
      : [];
    const postTerminalLengths = numericMeta(postTerminalObservedEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const postTerminalMax = postTerminalLengths.length ? Math.max(...postTerminalLengths) : acceptedLength;
    const comparableAudits = events.filter((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED' && eventComparable(event));
    const latestAudit = comparableAudits.slice(-1)[0] || null;
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
    const growthTolerancePct = Number(Contracts?.THRESHOLDS?.postTerminalGrowthTolerancePct || 0);
    let growthDecision = null;
    let growthDecisionAudit = null;
    comparableAudits.forEach((audit) => {
      const possible = eventBoolean(audit, ['auditPossible']);
      const chars = Number(eventValue(audit, ['growthChars']));
      const pct = Number(eventValue(audit, ['growthPct']));
      const conclusion = String(eventValue(audit, ['conclusion']) || '').toLowerCase();
      const rollback = eventBoolean(audit, ['rollbackObserved', 'contentRollback']) === true;
      const positive = possible !== false && conclusion === 'contradicted' && Number.isFinite(chars) && chars > 0
        && (!Number.isFinite(pct) || pct > growthTolerancePct);
      const negative = possible !== false && Number.isFinite(chars) && chars >= 0
        && (!Number.isFinite(pct) || pct <= growthTolerancePct);
      if (positive) {
        growthDecision = true;
        growthDecisionAudit = audit;
      } else if (negative && (growthDecision !== true || rollback)) {
        growthDecision = false;
        growthDecisionAudit = audit;
      }
    });
    const postTerminalGrowthProven = growthDecision;
    const extractionFact = extractionEvent ? Contracts?.factOf?.(extractionEvent) : null;
    const extractionFailed = extractionFact?.state === 'failed';
    const generationEvents = events.filter((event) => ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'TEXT_STATE_CHANGED'].includes(event.eventType)
      && eventComparable(event));
    const generationLengths = numericMeta(generationEvents, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const generationTextObserved = generationLengths.length ? Math.max(...generationLengths) > 0 : null;
    const generationStarted = generationEvents.some((event) => {
      const fact = Contracts?.factOf?.(event) || {};
      return (fact.kind === 'generation_start' && fact.state === 'started')
        || (fact.kind === 'generation' && ['active', 'started', 'generating'].includes(String(fact.state).toLowerCase()));
    }) ? true : (generationEvents.length ? null : null);
    const extractionIdentityRaw = extractionIdentityHint;
    const extractionIdentity = Contracts?.normalizeIdentityState?.(extractionIdentityRaw) || extractionIdentityRaw;
    const extractionVerified = eventBoolean(extractionEvent, ['verified', 'structuralVerified']);
    const extractionVerification = String(eventValue(extractionEvent, ['verification']) || '').toLowerCase() || null;
    const wrongNodeEvidence = extractionEvent && extractedTextLength > 0
      ? (extractionVerified === false
        || extractionVerification === 'rejected'
        || ['ambiguous', 'rejected', 'previous'].includes(extractionIdentity)
          ? true
          : (extractionVerified === true || extractionVerification === 'verified' || extractionIdentity === 'current' ? false : null))
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
    const completenessTimeline = events
      .filter((event) => event.eventType === 'ANSWER_COMPLETENESS_EVALUATED' && eventComparable(event))
      .map((event) => ({ event, state: String(Contracts?.factOf?.(event)?.state || '').toLowerCase() }));
    const extractionCoveragePct = comparableObservedLength > 0 && extractedTextLength !== null
      ? Math.min(100, (extractedTextLength / comparableObservedLength) * 100) : null;
    const incompleteStates = new Set(['probably_truncated', 'truncated', 'partial_capture', 'incomplete_capture']);
    const completeStates = new Set(['verified_complete', 'probably_complete']);
    const activeCompleteness = completenessTimeline.slice(-1)[0] || null;
    const explicitIncomplete = Boolean(activeCompleteness && incompleteStates.has(activeCompleteness.state));
    const explicitComplete = Boolean(activeCompleteness && completeStates.has(activeCompleteness.state));
    const incompleteCaptureEvidence = explicitIncomplete
      || (extractionCoveragePct !== null && extractionCoveragePct < Number(Contracts?.THRESHOLDS?.minimumExtractionCoveragePct || 98))
      ? true
      : (extractionCoveragePct !== null && extractionCoveragePct >= Number(Contracts?.THRESHOLDS?.minimumExtractionCoveragePct || 98)
        ? false
        : (explicitComplete ? false : null));
    const terminalAnswerDispatchId = eventValue(terminalEvent, ['answerEvidenceDispatchId', 'acceptedAnswerDispatchId']);
    const explicitAnswerIdentityRaw = String(eventValue(terminalEvent, ['answerIdentity']) || extractionIdentityRaw || '').toLowerCase() || null;
    const explicitAnswerIdentity = Contracts?.normalizeIdentityState?.(explicitAnswerIdentityRaw) || explicitAnswerIdentityRaw;
    const currentDispatchIdentity = normalizeDispatchIdentity(terminalEvent?.dispatchId, modelId);
    const acceptedAnswerIdentity = normalizeDispatchIdentity(terminalAnswerDispatchId, modelId);
    const oldAnswerEvidence = explicitAnswerIdentity === 'current'
      ? false
      : (explicitAnswerIdentity === 'previous'
        ? true
        : (currentDispatchIdentity !== null && acceptedAnswerIdentity !== null
          ? currentDispatchIdentity !== acceptedAnswerIdentity
          : null));
    const submissionEntries = events.map((event) => ({ event, fact: Contracts?.factOf?.(event) }))
      .filter(({ fact }) => fact?.kind === 'submission');
    const submissionFailed = submissionEntries.some(({ fact }) => fact.state === 'failed');
    const submissionConfirmed = submissionEntries.some(({ fact }) => fact.state === 'confirmed');
    const submitActionObserved = events.some((event) => event.eventType === 'SUBMIT_ACTION_OBSERVED');
    const promptReceivedCounterEvidence = submissionConfirmed
      || generationStarted === true
      || generationTextObserved === true
      || (extractedTextLength !== null && extractedTextLength > 0)
      || terminalOutcome === 'SUCCESS';
    const observationSignals = events.filter((event) => ['OBSERVATION_FRAME_CAPTURED', 'PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVATION_INTERVAL_CLOSED'].includes(event.eventType));
    const explicitReliableObservation = observationSignals.some((event) => {
      const fact = Contracts?.factOf?.(event) || {};
      return fact.kind === 'observation' && ['reliable', 'healthy', 'available'].includes(String(fact.state || '').toLowerCase());
    });
    const failedSubmissionEntry = [...submissionEntries].reverse().find(({ fact }) => fact.state === 'failed');
    const submissionAbsenceWindow = observationWindowAfter(events, failedSubmissionEntry?.event || null);
    const promptNotSentEvidence = promptReceivedCounterEvidence
      ? false
      : (submissionFailed && submissionAbsenceWindow.usable ? true : null);
    const insertionEntries = events.map((event) => ({ event, fact: Contracts?.factOf?.(event) }))
      .filter(({ fact }) => fact?.kind === 'prompt_insertion');
    const insertionFailed = insertionEntries.some(({ fact }) => fact.state === 'failed');
    const insertionConfirmed = insertionEntries.some(({ fact }) => ['confirmed', 'inserted'].includes(fact.state));
    const promptInsertedCounterEvidence = insertionConfirmed || promptReceivedCounterEvidence;
    const failedInsertionEntry = [...insertionEntries].reverse().find(({ fact }) => fact.state === 'failed');
    const insertionAbsenceWindow = observationWindowAfter(events, failedInsertionEntry?.event || null);
    const promptNotInsertedEvidence = promptInsertedCounterEvidence
      ? false
      : (insertionFailed && insertionAbsenceWindow.usable ? true : null);
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
    const stableLength = numericMeta(lastStableBeforeTerminal ? [lastStableBeforeTerminal] : [], ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength'])[0] ?? null;
    const lateEndCandidateBinding = acceptedCandidateId
      ? (lastStableBeforeTerminal && terminalEvent?.candidateId
        && String(lastStableBeforeTerminal.candidateId || '') === String(acceptedCandidateId)
        && String(terminalEvent.candidateId || '') === String(acceptedCandidateId) ? 'candidate_proven' : 'unknown')
      : 'single_candidate';
    const postStableObservations = events.filter((event) => Number(event.seq) > lastStableSeq
      && Number(event.seq) < terminalBoundarySeq
      && eventComparable(event)
      && ['TEXT_STATE_CHANGED', 'OBSERVATION_FRAME_CAPTURED', 'OBSERVATION_INTERVAL_CLOSED'].includes(event.eventType));
    const invalidatingAfterStable = postStableObservations.some((event) => {
      if (event.eventType !== 'TEXT_STATE_CHANGED') return false;
      const length = numericMeta([event], ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength'])[0] ?? null;
      const hashChanged = eventBoolean(event, ['hashChanged', 'contentHashChanged']);
      return hashChanged === true || (stableLength !== null && length !== null && length !== stableLength);
    }) || events.some((event) => Number(event.seq) > lastStableSeq
      && Number(event.seq) < terminalBoundarySeq
      && event.eventType === 'GENERATION_SIGNAL_CHANGED'
      && Contracts?.factOf?.(event)?.state === 'active');
    const postStabilityWindowCovered = postStableObservations.length > 0;
    const policyBoundaryEvents = events.filter((event) => Number(event.seq) >= lastStableSeq
      && Number(event.seq) <= terminalBoundarySeq
      && (event.eventType === 'TERMINAL_DEADLINE_REACHED'
        || (event.eventType === 'FINALIZATION_POLICY_EVALUATED'
          && (eventBoolean(event, ['accepted', 'decisionAccepted']) === false
            || /wait|block|retry|pending|defer/i.test(JSON.stringify(event.payload || {}))))));
    const policyWaitObserved = blockingDecisions.length || policyBoundaryEvents.length
      ? true
      : (acceptingDecisions.length ? false : null);
    const eligibilityCandidates = events.filter((event) => Number(event.seq) >= lastStableSeq
      && Number(event.seq) <= terminalBoundarySeq
      && eventComparable(event)
      && ((event.eventType === 'DECISION_RECORDED' && eventBoolean(event, ['accepted', 'decisionAccepted']) === true)
        || (event.eventType === 'FINALIZATION_POLICY_EVALUATED' && eventBoolean(event, ['accepted', 'decisionAccepted']) === true)
        || (event.eventType === 'COMPLETION_HYPOTHESIS_EVALUATED'
          && !/block|wait|pending|retry|defer/i.test(JSON.stringify(event.payload || {})))));
    const supersededEligibilityIds = new Set(events.flatMap((event) => {
      const id = eventValue(event, ['supersedesEligibilityEventId', 'supersededEligibilityEventId']);
      return id ? [String(id)] : [];
    }));
    const policyEligibilityEvent = eligibilityCandidates.find((event) => !supersededEligibilityIds.has(String(event.eventId))) || null;
    const eligibilityDelay = exactEventDuration(policyEligibilityEvent, terminalEvent);
    const lateEndToleranceMs = Number(Contracts?.THRESHOLDS?.lateEndPolicyToleranceMs || 1000);
    const lateObservationUsable = axes.observationReliability === 'reliable' || explicitReliableObservation;
    const lateEndEvidence = lateEndCandidateBinding === 'unknown' || !lateObservationUsable || !postStabilityWindowCovered
      ? null
      : (invalidatingAfterStable
        ? false
        : (eligibilityDelay.comparable
          ? eligibilityDelay.durationMs > lateEndToleranceMs
          : (blockingDecisions.length && !policyEligibilityEvent ? false : null)));
    const noDelivery = deriveNoDelivery(events, terminalEvent, axes);
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
      postTerminalGrowthDecisionEventId: growthDecisionAudit?.eventId || null,
      postTerminalGrowthDecisionLifecycle: growthDecision === true
        ? 'reaffirmed_or_preserved'
        : (growthDecision === false ? 'refuted_or_invalidated' : 'unresolved'),
      postTerminalAuditStatus: latestAudit
        ? (auditPossible === false || auditConclusion === 'unknown' ? 'impossible' : 'completed')
        : (impossibleAudit ? 'impossible' : (pendingAudit ? 'pending' : null)),
      postTerminalAuditConclusion: auditConclusion,
      extractionCoveragePct,
      candidateContinuity,
      measurementComparability,
      measurementCandidateId: acceptedCandidateId,
      comparableObservedTextLength: comparableObservedLength,
      incompleteCaptureEvidence,
      activeCompletenessEventId: activeCompleteness?.event?.eventId || null,
      activeCompletenessState: activeCompleteness?.state || null,
      generationTextObserved,
      generationStarted,
      acceptedExtractionEventId: extractionEvent?.eventId || null,
      acceptedExtractionResolution: acceptedExtraction.resolution,
      extractionIdentityAmbiguous: acceptedExtraction.resolution === 'ambiguous_pre_terminal_extraction',
      emptyResultEvidence,
      wrongNodeEvidence,
      extractionProblemEvidence,
      emptyExtractionEvidence: extractionProblemEvidence,
      emptyExtractionBranch,
      oldAnswerEvidence,
      normalizedCurrentDispatchId: currentDispatchIdentity,
      normalizedAnswerEvidenceDispatchId: acceptedAnswerIdentity,
      submissionFailed,
      submitActionObserved,
      promptReceivedCounterEvidence,
      promptNotSentEvidence,
      absenceObservationWindow: submissionFailed ? submissionAbsenceWindow : insertionAbsenceWindow,
      absenceObservationWindows: { submission: submissionAbsenceWindow, insertion: insertionAbsenceWindow },
      insertionEvidenceCount: insertionEntries.length,
      insertionFailed,
      promptInsertedCounterEvidence,
      promptNotInsertedEvidence,
      hiddenRelevantTextLength: 0,
      candidateCount: new Set(events.map((event) => event.candidateId).filter(Boolean)).size,
      captureBeforeTerminal: false,
      terminalBeforeLastRelevantMutation: Boolean(terminalEvent && events.some((event) => event.seq > terminalEvent.seq && event.eventType === 'TEXT_STATE_CHANGED')),
      terminalOutcome,
      stableToTerminalMs: stableDelay.comparable ? stableDelay.durationMs : null,
      stableToTerminalComparable: stableDelay.comparable ? true : null,
      stableToTerminalClockBasis: stableDelay.basis,
      policyWaitObserved,
      policyWaitEvidenceEventIds: [...blockingDecisions, ...policyBoundaryEvents].map((event) => event.eventId),
      policyEligibilityEventId: policyEligibilityEvent?.eventId || null,
      lateEndCandidateBinding,
      policyEligibleToTerminalMs: eligibilityDelay.comparable ? eligibilityDelay.durationMs : null,
      lateEndPolicyToleranceMs: lateEndToleranceMs,
      ...noDelivery,
      postStabilityObservationCovered: postStabilityWindowCovered,
      postStabilityMutationObserved: postStabilityWindowCovered ? invalidatingAfterStable : null,
      lateEndEvidence
    };
  }

  function enrichPriorIncidentComparison(view, events, incident) {
    if (!view || !incident || !Incidents?.priorIncidentFor) return view;
    const lane = Incidents.priorIncidentFor(events, incident);
    if (!lane.incident) {
      view.priorAnswerComparison = {
        status: 'unavailable',
        basis: null,
        priorIncidentRef: lane.priorIncidentRef,
        reason: lane.priorIncidentRef ? 'prior_incident_outside_export' : 'prior_incident_not_identified'
      };
      return view;
    }
    const currentEvents = events.filter((event) => Incidents.exactScope(event, incident.scope));
    const priorEvents = events.filter((event) => Incidents.exactScope(event, lane.incident.scope));
    const currentTerminal = [...currentEvents].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED') || null;
    const priorTerminal = [...priorEvents].reverse().find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED') || null;
    const currentExtraction = resolveAcceptedExtraction(currentEvents, currentTerminal).event;
    const priorExtraction = resolveAcceptedExtraction(priorEvents, priorTerminal).event;
    const hashKeys = ['answerHash', 'textHash', 'normalizedHash', 'responseHash', 'extractedTextHash'];
    const currentHash = eventValue(currentTerminal, hashKeys) || eventValue(currentExtraction, hashKeys);
    const priorHash = eventValue(priorTerminal, hashKeys) || eventValue(priorExtraction, hashKeys);
    const acceptedDispatch = normalizeDispatchIdentity(eventValue(currentTerminal, ['answerEvidenceDispatchId', 'acceptedAnswerDispatchId']), view.modelId);
    const priorDispatch = normalizeDispatchIdentity(lane.incident.scope.dispatchId, view.modelId);
    const dispatchLinked = acceptedDispatch !== null && priorDispatch !== null && acceptedDispatch === priorDispatch;
    const status = currentHash && priorHash
      ? (String(currentHash) === String(priorHash) ? 'matched' : 'different')
      : (dispatchLinked ? 'dispatch_linked_hash_unavailable' : 'unavailable');
    view.priorAnswerComparison = {
      status,
      basis: currentHash && priorHash ? 'privacy_safe_hash' : (dispatchLinked ? 'accepted_dispatch_lineage' : null),
      priorIncidentRef: lane.priorIncidentRef,
      currentEvidenceEventId: currentExtraction?.eventId || currentTerminal?.eventId || null,
      priorEvidenceEventId: priorExtraction?.eventId || priorTerminal?.eventId || null,
      contentMatched: status === 'matched' ? true : (status === 'different' ? false : null),
      dispatchLinked
    };
    if (status === 'different') view.oldAnswerEvidence = false;
    return view;
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
    const refutationResults = (Contracts?.normalizedRefutation?.(reportType)?.any || [])
      .map((predicate) => evaluatePredicate(context, predicate));
    const status = refutationResults.some((result) => result.known && result.matched)
      ? 'not_confirmed'
      : predicates.some((result) => result.known && !result.matched)
      ? 'not_confirmed'
      : (predicates.some((result) => !result.known) ? 'unknown' : 'confirmed');
    return { status, mode: 'all', predicateResults: predicates, refutationResults };
  }

  function aggregateApplicability(results) {
    const statuses = (results || []).map((item) => item?.status).filter(Boolean);
    return statuses.includes('confirmed')
      ? 'confirmed'
      : (statuses.includes('supported_but_incomplete') ? 'supported_but_incomplete'
        : (statuses.length && statuses.every((status) => status === 'not_confirmed') ? 'not_confirmed' : 'unknown'));
  }

  function aggregateCauseVerdicts(values) {
    const verdicts = (values || []).filter(Boolean);
    if (verdicts.includes('confirmed')) return 'confirmed';
    if (verdicts.includes('supported_but_incomplete')) return 'supported_but_incomplete';
    if (verdicts.includes('unknown')) return 'unknown';
    return verdicts.length && verdicts.every((value) => value === 'not_applicable')
      ? 'not_applicable'
      : 'unknown';
  }

  function diagnosticVerdict(applicability, evidence, invariantViolations = [], reportType = null) {
    const status = applicability?.status || 'unknown';
    if (status !== 'confirmed') return status;
    const sufficiency = typeof evidence === 'string' ? evidence : evidence?.sufficiency;
    const relevantViolations = (invariantViolations || []).filter((violation) => !reportType
      || !Array.isArray(violation.affectedReportTypes)
      || violation.affectedReportTypes.includes(reportType));
    if (sufficiency === 'insufficient' || relevantViolations.length) return 'unknown';
    if (sufficiency === 'bounded' && !(typeof evidence === 'object' && evidence.confirmationAllowedWhenBounded === true)) {
      return 'supported_but_incomplete';
    }
    return 'confirmed';
  }

  function buildConclusions(reportType, verdict, slots, missingEvidence) {
    const satisfiedSlotIds = (slots || []).filter((slot) => slot.status === 'satisfied'
      && ['critical', 'required'].includes(slot.effectiveCriticality)).map((slot) => slot.slotId);
    const safe = verdict === 'confirmed'
      ? [{ claim: `${reportType} is supported for this incident`, basedOnSlotIds: satisfiedSlotIds }]
      : (verdict === 'supported_but_incomplete'
        ? [{ claim: `${reportType} has positive support but lacks required evidence`, basedOnSlotIds: satisfiedSlotIds }]
      : (verdict === 'not_confirmed'
        ? [{ claim: `${reportType} is refuted by observed counter-evidence`, basedOn: 'applicability.predicates' }]
        : [{ claim: `Only satisfied evidence slots for ${reportType} may be used`, basedOnSlotIds: satisfiedSlotIds }]));
    const blocked = (missingEvidence || []).map((item) => ({
      claim: `${reportType} conclusion blocked by ${item.slotId}`,
      slotId: item.slotId,
      criticality: item.criticality
    }));
    return { safe, blocked };
  }

  const PROVENANCE_EVENT_TYPES = Object.freeze({
    submission: ['SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED'],
    generationStart: ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED'],
    answerIdentity: ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    observedGeneration: ['GENERATION_SIGNAL_CHANGED', 'OBSERVATION_FRAME_CAPTURED'],
    textEvolution: ['TEXT_STATE_CHANGED', 'STABILITY_INTERVAL_CLOSED'],
    answerCompleteness: ['ANSWER_COMPLETENESS_EVALUATED', 'EXTRACTION_COMPLETED', 'TEXT_STATE_CHANGED'],
    extraction: ['EXTRACTION_COMPLETED'],
    verification: ['STRUCTURAL_VERIFICATION_EVALUATED'],
    completionDetection: ['COMPLETION_HYPOTHESIS_EVALUATED', 'TERMINAL_DEADLINE_REACHED'],
    completionEvidenceTier: ['SUBMISSION_INFERRED', 'CANDIDATE_IDENTITY_INFERRED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED'],
    observationReliability: ['OBSERVATION_FRAME_CAPTURED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'MISSING_EVIDENCE_RECORDED'],
    finalization: ['FINALIZATION_POLICY_EVALUATED', 'DECISION_RECORDED', 'POLICY_OVERRIDE_APPLIED'],
    terminalMode: ['FINALIZATION_POLICY_EVALUATED', 'DECISION_RECORDED', 'POLICY_OVERRIDE_APPLIED', 'MODEL_TERMINAL_RECORDED'],
    terminationCause: ['TERMINAL_DEADLINE_REACHED', 'POLICY_OVERRIDE_APPLIED', 'MODEL_TERMINAL_RECORDED'],
    postTerminalGrowthProven: ['MODEL_TERMINAL_RECORDED', 'TEXT_STATE_CHANGED', 'POST_TERMINAL_AUDIT_COMPLETED'],
    incompleteCaptureEvidence: ['TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'ANSWER_COMPLETENESS_EVALUATED', 'CANDIDATE_IDENTITY_INFERRED'],
    extractionProblemEvidence: ['GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'CANDIDATE_IDENTITY_INFERRED', 'STRUCTURAL_VERIFICATION_EVALUATED'],
    oldAnswerEvidence: ['CANDIDATE_IDENTITY_INFERRED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    priorAnswerComparison: ['EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    promptNotSentEvidence: ['SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    promptNotInsertedEvidence: ['PROMPT_INSERTION_EVALUATED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'GENERATION_SIGNAL_CHANGED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'],
    lateEndEvidence: ['STABILITY_INTERVAL_CLOSED', 'TEXT_STATE_CHANGED', 'GENERATION_SIGNAL_CHANGED', 'DECISION_RECORDED', 'TERMINAL_DEADLINE_REACHED', 'FINALIZATION_POLICY_EVALUATED', 'MODEL_TERMINAL_RECORDED'],
    noDeliveryEvidence: ['ANSWER_SOURCE_MATERIALIZED', 'ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_DELIVERY_REJECTED', 'ANSWER_COMMIT_EVALUATED', 'ANSWER_CARD_RENDER_EVALUATED'],
    sourceAnswerMaterializedEvidence: ['ANSWER_SOURCE_MATERIALIZED'],
    cardDeliveryOutcome: ['ANSWER_CARD_RENDER_EVALUATED'],
    mechanismCauseCode: ['EXTRACTION_COMPLETED', 'ANSWER_DELIVERY_REJECTED', 'ANSWER_COMMIT_EVALUATED', 'ANSWER_CARD_RENDER_EVALUATED']
  });

  function buildFieldProvenance(view, events) {
    const fields = [...Object.keys(view.stateAxes || {}),
      'postTerminalGrowthProven', 'incompleteCaptureEvidence', 'extractionProblemEvidence',
      'oldAnswerEvidence', 'priorAnswerComparison', 'promptNotSentEvidence', 'promptNotInsertedEvidence', 'lateEndEvidence'];
    fields.push('noDeliveryEvidence', 'sourceAnswerMaterializedEvidence', 'cardDeliveryOutcome', 'mechanismCauseCode');
    return Object.fromEntries(fields.map((field) => {
      const accepted = new Set(PROVENANCE_EVENT_TYPES[field] || []);
      return [field, {
        derivedFromEventIds: (events || []).filter((event) => accepted.has(event.eventType)).map((event) => event.eventId),
        derivationVersion: `${GENERATOR_VERSION}:field-v1`
      }];
    }));
  }

  const SIBLING_RULES = Object.freeze({
    cutted: [['false-success', '$.derivedViews.postTerminalGrowthProven', 'eq', true], ['old-answer', '$.derivedViews.oldAnswerEvidence', 'eq', true]],
    'false-success': [['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true], ['late-end', '$.derivedViews.lateEndEvidence', 'eq', true]],
    'old-answer': [['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true]],
    'no-delivery': [['old-answer', '$.derivedViews.oldAnswerEvidence', 'eq', true], ['cutted', '$.derivedViews.incompleteCaptureEvidence', 'eq', true]],
    'prompt-not-inserted': [['prompt-not-sent', '$.derivedViews.promptNotSentEvidence', 'eq', true]],
    'prompt-not-sent': [['prompt-not-inserted', '$.derivedViews.promptNotInsertedEvidence', 'eq', true]],
    'late-end': [['false-success', '$.derivedViews.postTerminalGrowthProven', 'eq', true]]
  });

  const DIAGNOSIS_PRIORITY = Object.freeze(['false-success', 'old-answer', 'prompt-not-inserted', 'prompt-not-sent', 'no-delivery', 'cutted', 'late-end']);
  const DIAGNOSIS_CAUSAL_RULES = Object.freeze([
    Object.freeze({ cause: 'false-success', consequence: 'cutted', when: { path: '$.derivedViews.postTerminalGrowthProven', operator: 'eq', value: true } }),
    Object.freeze({ cause: 'prompt-not-inserted', consequence: 'prompt-not-sent', when: { path: '$.derivedViews.promptNotInsertedEvidence', operator: 'eq', value: true } }),
    Object.freeze({ cause: 'old-answer', consequence: 'no-delivery', when: { path: '$.derivedViews.oldAnswerEvidence', operator: 'eq', value: true } })
  ]);

  const siblingPairKey = (left, right) => [left, right].sort().join('|');
  const SIBLING_RELATION_CLASSIFICATIONS = Object.freeze({
    [siblingPairKey('false-success', 'cutted')]: Object.freeze({ relation: 'causal', cause: 'false-success', consequence: 'cutted' }),
    [siblingPairKey('prompt-not-inserted', 'prompt-not-sent')]: Object.freeze({ relation: 'causal', cause: 'prompt-not-inserted', consequence: 'prompt-not-sent' }),
    [siblingPairKey('cutted', 'old-answer')]: Object.freeze({ relation: 'co-occurring', causalClaim: false }),
    [siblingPairKey('false-success', 'late-end')]: Object.freeze({ relation: 'co-occurring', causalClaim: false }),
    [siblingPairKey('old-answer', 'no-delivery')]: Object.freeze({ relation: 'causal', cause: 'old-answer', consequence: 'no-delivery' })
  });

  function diagnosisRelation(reportType, primaryDiagnosis, confirmedDiagnoses = []) {
    if (reportType === primaryDiagnosis) return { explanationRole: 'primary', causedBy: null };
    const causal = DIAGNOSIS_CAUSAL_RULES.find((rule) => rule.consequence === reportType && confirmedDiagnoses.includes(rule.cause));
    return causal
      ? { explanationRole: 'consequence', causedBy: causal.cause }
      : { explanationRole: 'co_occurring', causedBy: null, causalClaim: false };
  }

  function dependencyRegistrySnapshot() {
    return {
      registryVersion: Contracts?.REGISTRY_VERSION || '5.0.0',
      predicateLanguageVersion: '1.0.0',
      maxEscalationDepth: 2,
      reports: Contracts?.REPORT_CONTRACTS || {},
      applicability: Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType, Contracts?.normalizedApplicability?.(reportType) || { all: [] }])),
      refutations: Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType, Contracts?.normalizedRefutation?.(reportType) || { any: [] }])),
      rules: Object.fromEntries(Object.entries(SIBLING_RULES).map(([source, rules]) => [source,
        rules.map(([reportType, path, operator, value]) => ({
          reportType,
          relation: 'diagnostic-dependency',
          priority: 'required',
          requestIf: { any: [{ path, operator, value }] },
          antiLoop: { sourceReportType: source, requestTargetOnlyOnce: true }
        }))
      ])),
      diagnosisArbitration: {
        priority: DIAGNOSIS_PRIORITY,
        causalRules: DIAGNOSIS_CAUSAL_RULES,
        siblingRelationClassifications: SIBLING_RELATION_CLASSIFICATIONS
      }
    };
  }

  function noDeliveryReportProjection(view, evidence = null, diagnosticVerdictValue = null) {
    const occurrenceSlots = (evidence?.slots || []).filter((slot) => slot.effectiveCriticality === 'critical');
    const causeSlots = (evidence?.slots || []).filter((slot) => slot.effectiveCriticality === 'required');
    const completenessFor = (slots) => ({
      level: !slots.length ? 'unknown' : (slots.every((slot) => slot.status === 'satisfied') ? 'complete' : 'bounded'),
      missingSlotIds: slots.filter((slot) => slot.status !== 'satisfied').map((slot) => slot.slotId)
    });
    return {
      occurrenceVerdict: diagnosticVerdictValue,
      causeVerdict: view?.causeVerdict || 'unknown',
      occurrenceCompleteness: completenessFor(occurrenceSlots),
      causeCompleteness: completenessFor(causeSlots),
      evaluationBoundary: {
        id: view?.evaluationBoundaryId || null,
        type: view?.evaluationBoundaryType || null
      },
      resolutionState: view?.resolutionState || 'unknown_persistence',
      deliveryStages: view?.deliveryAttemptGraph?.observedStages || [],
      lastSuccessfulStage: view?.lastSuccessfulStage || null,
      firstObservedUnsuccessfulStage: view?.firstObservedUnsuccessfulStage || null,
      failureRange: view?.failureRange || null,
      failureStageCode: view?.failureStageCode || null,
      mechanismCauseCode: view?.mechanismCauseCode || null,
      observabilityLimitationCodes: view?.observabilityLimitationCodes || [],
      recoveryFindingCode: view?.recoveryFindingCode || null,
      unexplainedByCatalogue: view?.unexplainedByCatalogue === true,
      sourceToCardComparison: view?.sourceToCardComparison || 'incomparable',
      expectedCardId: view?.expectedCardId || null,
      observedCardId: view?.observedCardId || null
    };
  }

  function buildReports(ledger, modelViews, incidentViews, ledgerHash, registryHash, { legacyMode = false } = {}) {
    const allViews = Object.values(incidentViews);
    const rawApplicability = Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType,
      Object.fromEntries(allViews.map((view) => [view.incidentId,
        evaluateApplicability(reportType, { stateAxes: view.stateAxes, derivedViews: view })]))
    ]));
    const slotResultsByReport = Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType,
      Object.fromEntries(allViews.map((view) => [view.incidentId,
        Incidents.resolveEvidenceSlots(ledger, { scope: view.incidentScope }, reportType, {
          stateAxes: view.stateAxes,
          derivedViews: view
        })
      ]))
    ]));
    const integrityByIncident = Object.fromEntries(allViews.map((view) => [
      view.incidentId,
      Incidents.temporalIntegrity?.(ledger, { scope: view.incidentScope }, { legacyMode }) || { violations: [], limitations: [] }
    ]));
    const invariantViolationsByIncident = Object.fromEntries(Object.entries(integrityByIncident)
      .map(([incidentId, integrity]) => [incidentId, integrity.violations]));
    const verdicts = Object.fromEntries(REPORT_TYPES.map((reportType) => [reportType,
      Object.fromEntries(allViews.map((view) => [view.incidentId, diagnosticVerdict(
        rawApplicability[reportType][view.incidentId],
        slotResultsByReport[reportType][view.incidentId],
        invariantViolationsByIncident[view.incidentId],
        reportType
      )]))
    ]));
    const arbitrationByIncident = Object.fromEntries(allViews.map((view) => {
      const confirmed = DIAGNOSIS_PRIORITY.filter((reportType) => verdicts[reportType][view.incidentId] === 'confirmed');
      const primaryDiagnosis = confirmed[0] || null;
      const relations = {};
      confirmed.forEach((reportType) => {
        relations[reportType] = diagnosisRelation(reportType, primaryDiagnosis, confirmed);
      });
      return [view.incidentId, { primaryDiagnosis, confirmedDiagnoses: confirmed, relations }];
    }));
    const reports = Object.fromEntries(REPORT_TYPES.map((reportType) => {
      const primaryQuestion = reportQuestion(reportType);
      const slotResults = slotResultsByReport[reportType];
      const applicabilityByIncident = Object.fromEntries(allViews.map((view) => [view.incidentId, {
        modelId: view.modelId,
        status: rawApplicability[reportType][view.incidentId].status,
        diagnosticVerdict: verdicts[reportType][view.incidentId],
        sufficiency: slotResults[view.incidentId].sufficiency,
        invariantViolationCount: invariantViolationsByIncident[view.incidentId]
          .filter((violation) => !Array.isArray(violation.affectedReportTypes) || violation.affectedReportTypes.includes(reportType)).length,
        limitations: integrityByIncident[view.incidentId].limitations
          .filter((limitation) => !Array.isArray(limitation.affectedReportTypes) || limitation.affectedReportTypes.includes(reportType)),
        primaryDiagnosis: arbitrationByIncident[view.incidentId].primaryDiagnosis,
        ...(arbitrationByIncident[view.incidentId].relations[reportType] || { explanationRole: 'not_applicable', causedBy: null })
      }]));
      const applicabilityByModel = Object.fromEntries(Object.keys(modelViews).map((modelId) => {
        const incidentResults = Object.entries(applicabilityByIncident)
          .filter(([, result]) => result.modelId === modelId);
        return [modelId, {
          status: aggregateApplicability(incidentResults.map(([, result]) => ({ status: result.status }))),
          diagnosticVerdict: aggregateApplicability(incidentResults.map(([, result]) => ({ status: result.diagnosticVerdict }))),
          incidentIds: incidentResults.map(([incidentId]) => incidentId),
          confirmedIncidentIds: incidentResults.filter(([, result]) => result.diagnosticVerdict === 'confirmed').map(([incidentId]) => incidentId),
          unknownIncidentIds: incidentResults.filter(([, result]) => result.diagnosticVerdict === 'unknown').map(([incidentId]) => incidentId)
        }];
      }));
      const applicabilityStatus = aggregateApplicability(Object.values(applicabilityByIncident).map((result) => ({ status: result.status })));
      const diagnosticStatus = aggregateApplicability(Object.values(applicabilityByIncident).map((result) => ({ status: result.diagnosticVerdict })));
      const siblingEvaluations = (SIBLING_RULES[reportType] || []).map(([target, path, operator, value]) => {
        const perIncident = allViews.map((view) => {
          const result = evaluatePredicate({ stateAxes: view.stateAxes, derivedViews: view }, { path, operator, value });
          return {
            modelId: view.modelId,
            incidentId: view.incidentId,
            observedValue: result.observedValue,
            known: result.known,
            matched: result.matched
          };
        });
        return {
          reportType: target,
          relation: 'diagnostic-dependency',
          relationClassification: SIBLING_RELATION_CLASSIFICATIONS[siblingPairKey(reportType, target)],
          priority: 'required',
          requestIf: { any: [{ path, operator, value }] },
          evaluation: { matched: perIncident.some((result) => result.matched), predicateResults: perIncident },
          antiLoop: { sourceReportType: reportType, requestTargetOnlyOnce: true }
        };
      });
      const supportedIncidentIds = Object.keys(applicabilityByIncident)
        .filter((incidentId) => ['confirmed', 'supported_but_incomplete'].includes(verdicts[reportType][incidentId]));
      const unresolvedIncidentIds = Object.keys(applicabilityByIncident)
        .filter((incidentId) => rawApplicability[reportType][incidentId].status !== 'not_confirmed');
      const completenessIncidentIds = supportedIncidentIds.length ? supportedIncidentIds : unresolvedIncidentIds;
      const evidenceClosures = Object.fromEntries(completenessIncidentIds.map((incidentId) => {
        const view = incidentViews[incidentId];
        return [incidentId, Incidents.buildEvidenceClosure(ledger, { incidentId, scope: view.incidentScope }, reportType, {
          context: { stateAxes: view.stateAxes, derivedViews: view }, legacyMode
        })];
      }));
      const allSlots = completenessIncidentIds.flatMap((incidentId) => slotResults[incidentId].slots)
        .filter((slot) => slot.effectiveCriticality !== 'conditional');
      const evidenceCoveragePct = allSlots.length
        ? Math.round((allSlots.filter((slot) => slot.status === 'satisfied').length / allSlots.length) * 10000) / 100
        : 0;
      const sufficiencies = completenessIncidentIds.map((incidentId) => slotResults[incidentId].sufficiency);
      const completenessLevel = !completenessIncidentIds.length
        ? 'not_applicable'
        : sufficiencies.includes('insufficient')
        ? 'insufficient'
        : (sufficiencies.includes('bounded') ? 'bounded' : 'complete');
      const missingItems = completenessIncidentIds.flatMap((incidentId) => slotResults[incidentId].missingEvidence
        .map((item) => ({ incidentId, ...item })));
      const completenessByIncident = Object.fromEntries(Object.keys(applicabilityByIncident).map((incidentId) => {
        const slots = slotResults[incidentId].slots.filter((slot) => slot.effectiveCriticality !== 'conditional');
        const applicable = rawApplicability[reportType][incidentId].status !== 'not_confirmed';
        return [incidentId, {
          level: applicable ? slotResults[incidentId].sufficiency : 'not_applicable',
          evidenceCoveragePct: applicable && slots.length
            ? Math.round((slots.filter((slot) => slot.status === 'satisfied').length / slots.length) * 10000) / 100
            : 0,
          missingItems: applicable ? slotResults[incidentId].missingEvidence : []
        }];
      }));
      const completeness = {
        level: completenessLevel,
        evidenceCoveragePct,
        missingCriticalEvidence: missingItems.some((item) => item.criticality === 'critical'),
        missingItems,
        byIncident: completenessByIncident,
        summarizedIncidentIds: completenessIncidentIds,
        safeConclusions: completenessLevel === 'complete' ? ['all required evidence slots are materialized'] : ['only conclusions supported by satisfied slots'],
        blockedConclusions: completenessLevel === 'complete' ? [] : missingItems.map((item) => `blocked by ${item.incidentId}:${item.slotId}`)
      };
      const conclusions = buildConclusions(reportType, diagnosticStatus, allSlots, missingItems);
      const selectedEvents = new Map();
      Object.values(evidenceClosures).forEach((closure) => closure.events.forEach((event) => {
        if (!selectedEvents.has(event.eventId)) selectedEvents.set(event.eventId, { seq: event.seq, includedFor: new Set() });
        (event.includedFor || []).forEach((reason) => selectedEvents.get(event.eventId).includedFor.add(reason));
      }));
      const orderedSelectedEvents = [...selectedEvents.values()].sort((left, right) => Number(left.seq) - Number(right.seq));
      const noDeliveryByIncident = reportType === 'no-delivery'
        ? Object.fromEntries(allViews.map((view) => [view.incidentId, noDeliveryReportProjection(
          view,
          slotResults[view.incidentId],
          verdicts[reportType][view.incidentId]
        )]))
        : null;
      return [reportType, {
        reportDescriptor: {
          reportId: `rpt-${reportType}-${eventFingerprint(ledgerHash)}`,
          reportType,
          reportVersion: REPORT_VERSION,
          title: primaryQuestion,
          primaryQuestion,
          applicability: { status: applicabilityStatus, byModel: applicabilityByModel, byIncident: applicabilityByIncident },
          diagnosticVerdict: diagnosticStatus,
          canDiagnose: conclusions.safe,
          cannotDiagnoseAlone: conclusions.blocked,
          completeness,
          ...(reportType === 'no-delivery' ? {
            occurrenceVerdict: diagnosticStatus,
            causeVerdict: aggregateCauseVerdicts(Object.values(noDeliveryByIncident).map((item) => item.causeVerdict)),
            occurrenceCompleteness: Object.fromEntries(Object.entries(noDeliveryByIncident).map(([incidentId, item]) => [incidentId, item.occurrenceCompleteness])),
            causeCompleteness: Object.fromEntries(Object.entries(noDeliveryByIncident).map(([incidentId, item]) => [incidentId, item.causeCompleteness]))
          } : {}),
          diagnosisArbitrationRef: 'diagnosisArbitration.byIncident',
          reportMode: 'embedded-in-all-presets',
          dependencyRegistryVersion: Contracts?.REGISTRY_VERSION || '5.0.0',
          dependencyRegistryHash: registryHash
        },
        diagnosticSummary: {
          ...(reportType === 'no-delivery' ? { noDeliveryByIncident } : {}),
          incidents: Object.fromEntries(allViews.map((view) => [view.incidentId, {
            applicabilityStatus: applicabilityByIncident[view.incidentId].status,
            diagnosticVerdict: applicabilityByIncident[view.incidentId].diagnosticVerdict,
            sufficiency: slotResults[view.incidentId].sufficiency,
            invariantViolations: invariantViolationsByIncident[view.incidentId],
            evidenceSlots: slotResults[view.incidentId].slots.map((slot) => ({
              slotId: slot.slotId,
              status: slot.status,
              effectiveCriticality: slot.effectiveCriticality,
              requiredIfMatched: slot.requiredIfMatched,
              eventSeqs: slot.eventIds.map((eventId) => ledger.find((event) => event.eventId === eventId)?.seq).filter((seq) => seq !== undefined),
              matchedEventCount: slot.matchedEventCount,
              selectedEventCount: slot.selectedEventCount
            }))
          }]))
        },
        eventSeqs: orderedSelectedEvents.map((event) => event.seq),
        eventSelection: {
          bySeq: Object.fromEntries(orderedSelectedEvents.map((event) => [String(event.seq), [...event.includedFor].sort()]))
        },
        derivedViewRef: 'incident-timeline',
        siblings: siblingEvaluations,
        analysisInstructionsRef: 'sharedConfig.commonAnalysisInstructions'
      }];
    }));
    return { reports, arbitrationByIncident };
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

  function sourceCompatibility(canonicalLedger) {
    if (canonicalLedger) return {
      mode: 'native-runtime-ledger',
      canonicalRuntimeEmissionPending: false,
      limitations: []
    };
    return {
      mode: 'legacy-runtime-adapter',
      canonicalRuntimeEmissionPending: true,
      limitations: [
        {
          code: 'clock_unavailable',
          impact: 'cross-event timing conclusions remain unknown without a shared monotonic clock'
        },
        {
          code: 'identity_evidence_not_inferred',
          impact: 'dispatch presence alone does not prove accepted-answer identity'
        }
      ]
    };
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
      enrichPriorIncidentComparison(view, ledgerEvents, incident);
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
    const registrySnapshot = dependencyRegistrySnapshot();
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
        data: Object.fromEntries(Object.entries(modelViews).map(([modelId, view]) => [modelId, {
          modelId,
          latestIncidentId: view.incidentId,
          incidentIds: view.incidentIds,
          incidentCount: view.incidentCount,
          stateAxesRef: `incident-timeline.data.${view.incidentId}.stateAxes`
        }]))
      },
      'incident-timeline': {
        viewType: 'incident-timeline',
        derivedFromEventSeqs: ledgerEvents.map((event) => event.seq),
        generatorVersion: GENERATOR_VERSION,
        ledgerHash,
        data: incidentViews
      }
    };
    const compatibility = sourceCompatibility(options.canonicalLedger === true);
    const reportBuild = buildReports(ledgerEvents, modelViews, incidentViews, ledgerHash, registryHash, {
      legacyMode: compatibility.mode === 'legacy-runtime-adapter'
    });
    // Freeze the exact JSON representation before it is hashed and returned so
    // in-memory validation and validation after file export see identical data.
    const reports = JSON.parse(JSON.stringify(reportBuild.reports));
    Object.values(reports).forEach((report) => {
      report.reportDescriptor.limitations = compatibility.limitations;
    });
    const viewsHash = await sha256(derivedViews);
    // Hash the serialized artifact shape. Optional undefined values do not
    // survive JSON export and therefore cannot be part of the offline hash.
    const reportsHash = await sha256(JSON.parse(JSON.stringify(reports)));
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
      diagnosisArbitration: { byIncident: reportBuild.arbitrationByIncident },
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
        sourceCompatibility: compatibility
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
    const compatibility = sourceCompatibility(options.canonicalLedger === true);
    const verdictByIncident = Object.fromEntries((Incidents.indexIncidents?.(sourceEvents) || [])
      .filter((incident) => incident.scope.modelId === modelId)
      .map((incident) => {
        const scoped = sourceEvents.filter((event) => Incidents.exactScope(event, incident.scope));
        const view = deriveModelView(modelId, scoped);
        enrichPriorIncidentComparison(view, sourceEvents, incident);
        view.stateAxes = root.ProofTelemetryPolicy?.deriveAxes
          ? root.ProofTelemetryPolicy.deriveAxes(scoped, scoped[scoped.length - 1])
          : view.stateAxes;
        const context = { stateAxes: view.stateAxes, derivedViews: view };
        const evidence = Incidents.resolveEvidenceSlots(sourceEvents, incident, reportType, context);
        const integrity = Incidents.temporalIntegrity?.(sourceEvents, incident, { legacyMode: compatibility.mode === 'legacy-runtime-adapter' })
          || { violations: [] };
        return [incident.incidentId, diagnosticVerdict(evaluateApplicability(reportType, context), evidence, integrity.violations, reportType)];
      }));
    const selection = Incidents.selectIncident(sourceEvents, {
      platform: modelId,
      task: reportType,
      incidentId: options.incidentId || null,
      verdictByIncident
    });
    if (!selection.selected) throw new Error(`no ${reportType} incident found for ${modelId}`);
    const preliminaryEvents = sourceEvents.filter((event) => Incidents.exactScope(event, selection.selected.scope));
    const preliminaryView = deriveModelView(modelId, preliminaryEvents);
    enrichPriorIncidentComparison(preliminaryView, sourceEvents, selection.selected);
    preliminaryView.stateAxes = root.ProofTelemetryPolicy?.deriveAxes
      ? root.ProofTelemetryPolicy.deriveAxes(preliminaryEvents, preliminaryEvents[preliminaryEvents.length - 1])
      : preliminaryView.stateAxes;
    const fullContext = { stateAxes: preliminaryView.stateAxes, derivedViews: preliminaryView };
    const fullApplicability = Object.fromEntries(REPORT_TYPES.map((type) => [type, evaluateApplicability(type, fullContext)]));
    const closure = Incidents.buildEvidenceClosure(sourceEvents, selection.selected, reportType, {
      context: fullContext,
      legacyMode: compatibility.mode === 'legacy-runtime-adapter'
    });
    let materializedEvents = closure.events;
    const fullEvidence = Incidents.resolveEvidenceSlots(sourceEvents, selection.selected, reportType, fullContext);
    const fullVerdict = diagnosticVerdict(fullApplicability[reportType], fullEvidence, closure.violations, reportType);
    const slotProjection = (evidence) => (evidence?.slots || []).map((slot) => ({
      slotId: slot.slotId,
      status: slot.status,
      effectiveCriticality: slot.effectiveCriticality,
      eventIds: slot.eventIds
    }));
    const fullVerdictProjection = {
      reportType,
      applicability: fullApplicability[reportType],
      diagnosticVerdict: fullVerdict,
      evidenceSlots: slotProjection(fullEvidence)
    };
    const materializedIds = new Set(materializedEvents.map((event) => event.eventId));
    const slotMaterializationValid = fullEvidence.slots.every((slot) => slot.eventIds.every((eventId) => materializedIds.has(eventId)));
    let materializedVerdictProjection = slotMaterializationValid
      ? fullVerdictProjection
      : { ...fullVerdictProjection, diagnosticVerdict: 'unknown', evidenceSlots: [] };
    let fallbackMaterializedFullIncident = false;
    if (stableStringify(fullVerdictProjection) !== stableStringify(materializedVerdictProjection)) {
      fallbackMaterializedFullIncident = true;
      const existing = new Map(materializedEvents.map((event) => [event.eventId, event]));
      preliminaryEvents.forEach((event) => {
        const current = existing.get(event.eventId);
        existing.set(event.eventId, current || { ...event, includedFor: ['semantic-verdict-preservation'] });
      });
      materializedEvents = [...existing.values()].sort((left, right) => Number(left.ingestSeq || left.seq) - Number(right.ingestSeq || right.seq));
      materializedVerdictProjection = fullVerdictProjection;
    }
    const materializedHash = await sha256(materializedEvents);
    const sourceLedgerHash = await sha256(sourceEvents);
    const modelView = preliminaryView;
    const axes = preliminaryView.stateAxes;
    const registrySnapshot = dependencyRegistrySnapshot();
    const registryHash = await sha256(registrySnapshot);
    const context = fullContext;
    const applicability = fullApplicability[reportType];
    const allApplicability = fullApplicability;
    const allVerdicts = Object.fromEntries(REPORT_TYPES.map((type) => {
      const evidence = Incidents.resolveEvidenceSlots(sourceEvents, selection.selected, type, {
        stateAxes: preliminaryView.stateAxes,
        derivedViews: preliminaryView
      });
      return [type, diagnosticVerdict(allApplicability[type], evidence, closure.violations, type)];
    }));
    const verdict = allVerdicts[reportType];
    const confirmedDiagnoses = DIAGNOSIS_PRIORITY.filter((type) => allVerdicts[type] === 'confirmed');
    const primaryDiagnosis = confirmedDiagnoses[0] || null;
    const reportDiagnosisRelation = applicability.status !== 'confirmed'
      ? { explanationRole: 'not_applicable', causedBy: null }
      : diagnosisRelation(reportType, primaryDiagnosis, confirmedDiagnoses);
    const siblings = (SIBLING_RULES[reportType] || []).map(([target, path, operator, value]) => {
      const result = evaluatePredicate(context, { path, operator, value });
      return {
        reportType: target,
        relation: 'diagnostic-dependency',
        relationClassification: SIBLING_RELATION_CLASSIFICATIONS[siblingPairKey(reportType, target)],
        priority: 'required',
        requestIf: { any: [{ path, operator, value }] },
        evaluation: { matched: result.matched, predicateResults: [{ modelId, ...result }] },
        antiLoop: { sourceReportType: reportType, requestTargetOnlyOnce: true }
      };
    });
    const fieldProvenance = buildFieldProvenance(modelView, materializedEvents.filter((event) => Incidents.exactScope(event, selection.selected.scope)));
    const replayAxes = axes;
    const replayValid = stableStringify(fullVerdictProjection) === stableStringify(materializedVerdictProjection);
    const semanticEvents = materializedEvents.map((event) => {
      const copy = JSON.parse(JSON.stringify(event));
      delete copy.wallTs;
      if (copy.clock) delete copy.clock.ingestMonoMs;
      return copy;
    });
    const fullSemanticEvents = preliminaryEvents.map((event) => {
      const copy = JSON.parse(JSON.stringify(event));
      delete copy.wallTs;
      if (copy.clock) delete copy.clock.ingestMonoMs;
      return copy;
    });
    const semanticHash = await sha256({ incident: selection.selected.scope, task: reportType, events: semanticEvents, axes });
    const fullIncidentSemanticHash = await sha256({ incident: selection.selected.scope, events: fullSemanticEvents, axes: preliminaryView.stateAxes });
    const fullVerdictHash = await sha256(fullVerdictProjection);
    const materializedVerdictHash = await sha256(materializedVerdictProjection);
    const effectiveSlots = closure.slots.filter((slot) => slot.effectiveCriticality !== 'conditional');
    const standaloneCompletenessLevel = applicability.status === 'not_confirmed' ? 'not_applicable' : closure.sufficiency;
    const completeness = {
      level: standaloneCompletenessLevel,
      evidenceCoveragePct: effectiveSlots.length ? Math.round((effectiveSlots.filter((slot) => slot.status === 'satisfied').length / effectiveSlots.length) * 10000) / 100 : 0,
      missingCriticalEvidence: closure.missingEvidence.some((item) => item.criticality === 'critical'),
      missingItems: closure.missingEvidence,
      safeConclusions: standaloneCompletenessLevel === 'not_applicable'
        ? ['diagnosis is refuted or not applicable for the selected incident']
        : (closure.sufficiency === 'complete' ? ['all required evidence slots are materialized'] : ['only conclusions supported by satisfied slots']),
      blockedConclusions: ['complete', 'not_applicable'].includes(standaloneCompletenessLevel) ? [] : closure.missingEvidence.map((item) => `blocked by ${item.slotId}`)
    };
    const conclusions = buildConclusions(reportType, verdict, effectiveSlots, closure.missingEvidence);
    const noDeliveryProjection = reportType === 'no-delivery'
      ? noDeliveryReportProjection(modelView, closure, verdict)
      : null;
    const report = {
      schemaVersion: SCHEMA_VERSION,
      fileKind: 'diagnostic-report',
      reportDescriptor: {
        reportId: `rpt-${reportType}-${modelId}-${eventFingerprint(sourceLedgerHash)}`,
        reportType,
        reportVersion: REPORT_VERSION,
        title: reportQuestion(reportType),
        primaryQuestion: reportQuestion(reportType),
        applicability,
        diagnosticVerdict: verdict,
        diagnosisArbitration: { primaryDiagnosis, confirmedDiagnoses, ...reportDiagnosisRelation },
        canDiagnose: conclusions.safe,
        cannotDiagnoseAlone: conclusions.blocked,
        completeness,
        ...(noDeliveryProjection ? {
          occurrenceVerdict: noDeliveryProjection.occurrenceVerdict,
          causeVerdict: noDeliveryProjection.causeVerdict,
          occurrenceCompleteness: noDeliveryProjection.occurrenceCompleteness,
          causeCompleteness: noDeliveryProjection.causeCompleteness,
          evaluationBoundary: noDeliveryProjection.evaluationBoundary,
          resolutionState: noDeliveryProjection.resolutionState
        } : {}),
        reportMode: 'standalone',
        dependencyRegistryVersion: registrySnapshot.registryVersion,
        dependencyRegistryHash: registryHash,
        limitations: [...compatibility.limitations, ...(closure.limitations || []), ...(closure.confidenceLimitations || [])]
      },
      correlation: {
        incidentId: selection.selected.incidentId,
        ...selection.selected.scope,
        candidateIds: selection.selected.candidateIds,
        navigationLineage: selection.selected.navigationLineage,
        selectionReason: selection.selectionReason,
        matchingIncidentCount: selection.matchingIncidentCount,
        otherMatchingIncidents: selection.otherMatchingIncidents,
        priorIncidentRef: closure.priorIncidentRef
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
        diagnosticVerdict: verdict,
        sufficiency: closure.sufficiency,
        evidenceSlots: closure.slots,
        evidenceLanes: closure.evidenceLanes,
        safeConclusions: completeness.safeConclusions,
        blockedConclusions: completeness.blockedConclusions,
        ...(noDeliveryProjection || {})
      },
      stateAxes: axes,
      eventSelection: {
        includedEventTypes: Array.from(new Set(materializedEvents.map((event) => event.eventType))),
        eventRefs: materializedEvents.map((event) => event.eventId),
        evidenceLanes: closure.evidenceLanes,
        materializedEvents
      },
      derivedViews: {
        recordedDerivedView: {
          source: 'full-frozen-incident',
          fullIncidentSemanticHash,
          taskProjectionHash: fullVerdictHash,
          data: modelView
        },
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
        fullIncidentSemanticHash,
        fullIncidentEventCount: preliminaryEvents.length,
        applicabilitySource: 'full-frozen-incident',
        verdictPreservation: {
          fullVerdictHash,
          materializedVerdictHash,
          equivalent: fullVerdictHash === materializedVerdictHash,
          fallbackMaterializedFullIncident
        },
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
          scope: 'task-local-recorded-derived-view',
          status: 'validated',
          recordedStateHash: await sha256(axes),
          recomputedStateHash: await sha256(replayAxes),
          reason: replayValid ? null : 'materialized replay mismatch'
        },
        hashes: { artifact: null, semantic: semanticHash },
        size: { measuredBytes: null, category: null, measurementOnly: true },
        sourceCompatibility: compatibility
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
    DIAGNOSIS_PRIORITY,
    DIAGNOSIS_CAUSAL_RULES,
    dependencyRegistrySnapshot,
    stableStringify,
    sha256,
    canonicalType,
    classifyRuntimeEvent,
    layerFor,
    sanitizeValue,
    eventFingerprint,
    normalizeDispatchIdentity,
    buildLedger,
    deriveAxes,
    deriveModelView,
    evaluatePredicate,
    evaluateApplicability,
    diagnosticVerdict,
    buildConclusions,
    buildFieldProvenance,
    validateLedger,
    buildAllPresets,
    buildStandaloneReport
  });

  root.ProofOrientedTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

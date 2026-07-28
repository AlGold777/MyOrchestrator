// shared/proof-oriented-telemetry.js
// Proof-oriented telemetry export builder (canonical schema 5.0).
//
// The runtime still emits the established diagnostic event shape. This module
// is the compatibility boundary: it freezes one run-scoped snapshot, converts
// it into an immutable decision ledger, derives state axes/reports, validates
// lineage invariants, and only then returns an All-presets container.

(function initProofOrientedTelemetry(root) {
  'use strict';

  const SCHEMA_VERSION = '5.0';
  const EVENT_SCHEMA_VERSION = 5;
  const GENERATOR_VERSION = 'proof-export@1.0.0';
  const REPORT_VERSION = '1.0.0';
  const REPORT_TYPES = Object.freeze([
    'request-not-sent',
    'generation-not-started',
    'truncation',
    'true-completion',
    'submission-proof',
    'extraction-integrity',
    'forced-success',
    'forced-finalization'
  ]);

  const REPORT_INFO = Object.freeze({
    'request-not-sent': ['Почему запрос не был принят платформой?', ['DISPATCH_BASELINE_CAPTURED', 'SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'PAGE_CONTEXT_OBSERVED', 'PAGE_HEALTH_OBSERVED']],
    'generation-not-started': ['Почему после dispatch не появились признаки начала генерации?', ['SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'CANDIDATE_SET_CHANGED', 'GENERATION_SIGNAL_CHANGED', 'PAGE_HEALTH_OBSERVED', 'OBSERVER_HEALTH_OBSERVED']],
    truncation: ['Почему сохранённый ответ короче фактически сгенерированного или позднее доступного текста?', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'ANSWER_COMPLETENESS_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']],
    'true-completion': ['Действительно ли генерация закончилась в recorded terminal moment?', ['GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'STABILITY_INTERVAL_CLOSED', 'ANSWER_COMPLETENESS_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']],
    'submission-proof': ['Какие внешние признаки доказывают принятие запроса платформой?', ['DISPATCH_BASELINE_CAPTURED', 'SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'PAGE_CONTEXT_OBSERVED']],
    'extraction-integrity': ['Захвачен ли весь релевантный текст из DOM?', ['CANDIDATE_SET_CHANGED', 'CANDIDATE_IDENTITY_INFERRED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'ANSWER_COMPLETENESS_EVALUATED', 'STRUCTURAL_VERIFICATION_EVALUATED']],
    'forced-success': ['Почему система выставила SUCCESS без automatic completion proof?', ['COMPLETION_HYPOTHESIS_EVALUATED', 'FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']],
    'forced-finalization': ['Когда и почему расширение прекратило ожидание по timeout/forced policy?', ['GENERATION_SIGNAL_CHANGED', 'TERMINAL_DEADLINE_REACHED', 'FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'MODEL_TERMINAL_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED']]
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
    LEASE_RELEASED: 'OBSERVATION_SLOT_RELEASED'
  });

  const INFERENCE_TYPES = new Set(['SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED', 'CANDIDATE_IDENTITY_INFERRED', 'GENERATION_STATE_INFERRED', 'ANSWER_COMPLETENESS_EVALUATED', 'STRUCTURAL_VERIFICATION_EVALUATED', 'COMPLETION_HYPOTHESIS_EVALUATED']);
  const DECISION_TYPES = new Set(['FINALIZATION_POLICY_EVALUATED', 'POLICY_OVERRIDE_APPLIED', 'DECISION_RECORDED', 'DECISION_SUPERSEDED', 'MISSING_EVIDENCE_RECORDED']);
  const ACTION_TYPES = new Set(['MODEL_TERMINAL_RECORDED']);
  const AUDIT_TYPES = new Set(['POST_TERMINAL_AUDIT_COMPLETED', 'REPLAY_VALIDATION_RECORDED', 'EXPORT_AUDIT_RECORDED']);
  const SYSTEM_TYPES = new Set(['RUN_CONFIG_RECORDED', 'SELECTOR_CANARY_RESULT']);

  function normalizeLabel(event) {
    return String(event?.label || event?.meta?.event || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function canonicalType(event) {
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
      const eventId = `ev-${seq}-${eventFingerprint(`${runSessionId}|${modelId}|${dispatchId || ''}|${normalizeLabel(legacy)}|${wallTs}`)}`;
      const envelope = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId,
        eventType: type,
        layer: layerFor(type),
        seq,
        wallTs,
        monoMs: Math.max(0, wallTs - firstWallTs),
        runSessionId: String(runSessionId),
        modelId,
        producer: { component: 'legacy-telemetry-adapter', version: GENERATOR_VERSION },
        payload: {
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
        const value = Number(event?.payload?.metadata?.[key]);
        if (Number.isFinite(value) && value >= 0) values.push(value);
      });
    });
    return values;
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
      answerIdentity: started && events.some((event) => event.dispatchId) ? 'current_dispatch' : started ? 'candidate' : 'none',
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
    const lengths = numericMeta(events, ['textLength', 'answerLength', 'answerLen', 'latestObservedTextLength']);
    const terminalEvent = events.find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    const postTerminalLengths = terminalEvent ? numericMeta(events.filter((event) => event.seq > terminalEvent.seq), ['textLength', 'answerLength', 'answerLen']) : [];
    const acceptedLength = terminalEvent
      ? (numericMeta([terminalEvent], ['textLength', 'answerLength', 'answerLen'])[0] || 0)
      : (lengths.length ? lengths[lengths.length - 1] : 0);
    const maxObservedLength = lengths.length ? Math.max(...lengths) : 0;
    const postTerminalMax = postTerminalLengths.length ? Math.max(...postTerminalLengths) : acceptedLength;
    const latestAudit = [...events].reverse().find((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    const pendingAudit = events.some((event) => event.eventType === 'MISSING_EVIDENCE_RECORDED' && event?.payload?.missingEvidence === 'post_terminal_observation');
    return {
      modelId,
      stateAxes: axes,
      eventRefs: events.map((event) => event.eventId),
      firstSeq: events[0]?.seq || null,
      lastSeq: events[events.length - 1]?.seq || null,
      submissionEvidenceCount: events.filter((event) => /SUBMISSION|SUBMIT_ACTION/.test(event.eventType)).length,
      completionEvidenceTier: axes.completionEvidenceTier,
      acceptedTextLength: acceptedLength,
      maxObservedTextLength: maxObservedLength,
      postTerminalGrowthChars: Math.max(0, postTerminalMax - acceptedLength),
      postTerminalGrowthPct: acceptedLength > 0 ? Math.max(0, ((postTerminalMax - acceptedLength) / acceptedLength) * 100) : 0,
      postTerminalAuditStatus: latestAudit ? 'completed' : pendingAudit ? 'pending' : 'not_applicable',
      postTerminalAuditConclusion: latestAudit?.payload?.conclusion || null,
      extractionCoveragePct: maxObservedLength > 0 ? Math.min(100, (acceptedLength / maxObservedLength) * 100) : 0,
      hiddenRelevantTextLength: 0,
      candidateCount: new Set(events.map((event) => event.candidateId).filter(Boolean)).size,
      captureBeforeTerminal: false,
      terminalBeforeLastRelevantMutation: Boolean(terminalEvent && events.some((event) => event.seq > terminalEvent.seq && event.eventType === 'TEXT_STATE_CHANGED')),
      terminalOutcome: terminalEvent?.payload?.metadata?.finalStatus || terminalEvent?.payload?.metadata?.status || null
    };
  }

  function getPath(value, path) {
    return String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
  }

  function evaluatePredicate(context, predicate) {
    const observedValue = getPath(context, predicate.path);
    const expected = predicate.value;
    const matched = ({
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
    return { predicate, observedValue: observedValue === undefined ? null : observedValue, matched };
  }

  const SIBLING_RULES = Object.freeze({
    'request-not-sent': [['submission-proof', '$.stateAxes.submission', 'in', ['evidence_partial', 'unknown']], ['generation-not-started', '$.stateAxes.submission', 'eq', 'confirmed']],
    'generation-not-started': [['submission-proof', '$.stateAxes.submission', 'ne', 'confirmed'], ['request-not-sent', '$.stateAxes.submission', 'in', ['failed', 'evidence_partial', 'unknown']]],
    truncation: [['true-completion', '$.derivedViews.completionEvidenceTier', 'lt', 3], ['extraction-integrity', '$.derivedViews.extractionCoveragePct', 'lt', 98], ['forced-finalization', '$.stateAxes.terminalMode', 'eq', 'forced'], ['forced-success', '$.derivedViews.terminalOutcome', 'eq', 'SUCCESS']],
    'true-completion': [['truncation', '$.derivedViews.postTerminalGrowthPct', 'gt', 0.5], ['extraction-integrity', '$.derivedViews.extractionCoveragePct', 'lt', 98], ['forced-finalization', '$.stateAxes.terminalMode', 'eq', 'forced'], ['forced-success', '$.derivedViews.completionEvidenceTier', 'lt', 3]],
    'submission-proof': [['request-not-sent', '$.stateAxes.submission', 'eq', 'failed'], ['generation-not-started', '$.stateAxes.generationStart', 'eq', 'not_started']],
    'extraction-integrity': [['truncation', '$.derivedViews.extractionCoveragePct', 'lt', 98], ['true-completion', '$.derivedViews.completionEvidenceTier', 'lt', 3], ['forced-finalization', '$.stateAxes.terminalMode', 'eq', 'forced']],
    'forced-success': [['true-completion', '$.derivedViews.completionEvidenceTier', 'lt', 3], ['forced-finalization', '$.stateAxes.terminalMode', 'eq', 'forced'], ['extraction-integrity', '$.stateAxes.extraction', 'in', ['fallback', 'ambiguous']], ['truncation', '$.derivedViews.extractionCoveragePct', 'lt', 98]],
    'forced-finalization': [['forced-success', '$.derivedViews.terminalOutcome', 'eq', 'SUCCESS'], ['true-completion', '$.derivedViews.completionEvidenceTier', 'lt', 3], ['generation-not-started', '$.stateAxes.generationStart', 'eq', 'not_started'], ['truncation', '$.derivedViews.postTerminalGrowthPct', 'gt', 0.5]]
  });

  function buildReports(ledger, modelViews, ledgerHash, registryHash) {
    const allViews = Object.values(modelViews);
    return Object.fromEntries(REPORT_TYPES.map((reportType) => {
      const [primaryQuestion, relevantTypes] = REPORT_INFO[reportType];
      const relevant = ledger.filter((event) => relevantTypes.includes(event.eventType));
      const siblingEvaluations = (SIBLING_RULES[reportType] || []).map(([target, path, operator, value]) => {
        const perModel = allViews.map((view) => {
          const result = evaluatePredicate({ stateAxes: view.stateAxes, derivedViews: view }, { path, operator, value });
          return { modelId: view.modelId, ...result };
        });
        return {
          reportType: target,
          relation: 'diagnostic-dependency',
          priority: 'required',
          requestIf: { any: [{ path, operator, value }] },
          evaluation: { matched: perModel.some((result) => result.matched), predicateResults: perModel }
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
          dependencyRegistryVersion: '1.0.0',
          dependencyRegistryHash: registryHash
        },
        diagnosticSummary: {
          models: Object.fromEntries(allViews.map((view) => [view.modelId, {
            stateAxes: view.stateAxes,
            completionEvidenceTier: view.completionEvidenceTier,
            extractionCoveragePct: view.extractionCoveragePct,
            postTerminalGrowthPct: view.postTerminalGrowthPct
          }]))
        },
        stateAxes: Object.fromEntries(allViews.map((view) => [view.modelId, view.stateAxes])),
        eventRefs: relevant.map((event) => event.eventId),
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
    const byModel = {};
    ledgerEvents.forEach((event) => {
      if (!byModel[event.modelId]) byModel[event.modelId] = [];
      byModel[event.modelId].push(event);
    });
    const replayResult = root.ProofTelemetryPolicy?.replay
      ? root.ProofTelemetryPolicy.replay(ledgerEvents)
      : null;
    const modelViews = Object.fromEntries(Object.entries(byModel).map(([modelId, events]) => {
      const view = deriveModelView(modelId, events);
      if (replayResult?.models?.[modelId]?.stateAxes) view.stateAxes = replayResult.models[modelId].stateAxes;
      return [modelId, view];
    }));
    const registrySnapshot = { version: '1.0.0', predicateLanguageVersion: '1.0.0', maxEscalationDepth: 2, rules: SIBLING_RULES };
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
        derivedFromEventRefs: ledgerEvents.map((event) => event.eventId),
        generatorVersion: GENERATOR_VERSION,
        ledgerHash,
        data: modelViews
      }
    };
    const reports = buildReports(ledgerEvents, modelViews, ledgerHash, registryHash);
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
        deduplication: { canonicalEventsStoredOnce: true, embeddedReportsContainEventRefsOnly: true },
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
    }
    const hashInput = JSON.parse(JSON.stringify(container));
    delete hashInput.exportAudit.hashes.container;
    container.exportAudit.hashes.container = await sha256(hashInput);
    return container;
  }

  function materializeEventClosure(events, eventRefs) {
    const byId = new Map((Array.isArray(events) ? events : []).map((event) => [event.eventId, event]));
    const selected = new Set(eventRefs || []);
    (Array.isArray(events) ? events : []).forEach((event) => {
      if (event.eventType === 'RUN_CONFIG_RECORDED') selected.add(event.eventId);
    });
    let changed = true;
    while (changed) {
      changed = false;
      Array.from(selected).forEach((eventId) => {
        const event = byId.get(eventId);
        (event?.evidenceRefs || []).forEach((evidenceRef) => {
          if (!selected.has(evidenceRef) && byId.has(evidenceRef)) {
            selected.add(evidenceRef);
            changed = true;
          }
        });
      });
    }
    return (Array.isArray(events) ? events : []).filter((event) => selected.has(event.eventId));
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
    const modelEvents = sourceEvents.filter((event) => event.modelId === modelId || event.modelId === 'SYSTEM');
    const container = await buildAllPresets(modelEvents, {
      ...options,
      exportedAt,
      canonicalLedger: true
    });
    const embedded = container.reports[reportType];
    const materializedEvents = materializeEventClosure(modelEvents, embedded.eventRefs);
    const materializedHash = await sha256(materializedEvents);
    const modelView = container.derivedViews['model-timeline']?.data?.[modelId] || null;
    const report = {
      schemaVersion: SCHEMA_VERSION,
      fileKind: 'diagnostic-report',
      reportDescriptor: {
        ...embedded.reportDescriptor,
        reportId: `rpt-${reportType}-${modelId}-${eventFingerprint(container.ledger.ledgerHash)}`,
        reportMode: 'standalone'
      },
      correlation: {
        runSessionId: container.crossReportCompatibility.exactMatch.runSessionId,
        modelId,
        dispatchIds: Array.from(new Set(materializedEvents.map((event) => event.dispatchId).filter(Boolean))),
        generationEpochs: Array.from(new Set(materializedEvents.map((event) => event.generationEpoch).filter((value) => value !== undefined)))
      },
      reportCatalogSnapshot: REPORT_TYPES.map((type) => ({
        reportType: type,
        reportVersion: REPORT_VERSION,
        included: type === reportType
      })),
      runConfiguration: {
        extensionVersion: container.sharedConfig.extensionVersion,
        generationWaitProfile: container.sharedConfig.generationWaitProfile,
        policy: container.sharedConfig.policy,
        privacy: container.sharedConfig.privacy
      },
      diagnosticSummary: embedded.diagnosticSummary,
      stateAxes: modelView?.stateAxes || embedded.stateAxes?.[modelId] || {},
      eventSelection: {
        includedEventTypes: Array.from(new Set(materializedEvents.map((event) => event.eventType))),
        eventRefs: materializedEvents.map((event) => event.eventId),
        materializedEvents
      },
      derivedViews: {
        modelTimeline: modelView ? {
          viewType: reportType,
          generatorVersion: GENERATOR_VERSION,
          ledgerHash: container.ledger.ledgerHash,
          data: modelView
        } : null
      },
      contradictions: container.exportAudit.invariantViolations,
      missingEvidence: embedded.reportDescriptor.completeness.missingItems,
      siblings: embedded.siblings,
      analysisInstructions: {
        version: '1.0.0',
        instructions: container.sharedConfig.commonAnalysisInstructions
      },
      crossReportCompatibility: {
        mode: 'same_ledger',
        exactMatch: {
          runSessionId: container.crossReportCompatibility.exactMatch.runSessionId,
          modelId,
          ledgerHash: container.ledger.ledgerHash,
          ledgerCompleteThroughSeq: container.ledger.lastSeq
        }
      },
      attachments: [
        ...Object.values(container.attachments.byId || {}),
        ...(container.attachments.omissions || [])
      ].filter((attachment) => !attachment.eventRef || materializedEvents.some((event) => event.eventId === attachment.eventRef)),
      exportIntegrity: {
        generatorVersion: GENERATOR_VERSION,
        sampleData: false,
        sourceLedgerHash: container.ledger.ledgerHash,
        materializedEventHash: materializedHash,
        sourceLedgerEventCount: modelEvents.length,
        materializedEventCount: materializedEvents.length,
        deduplication: {
          canonicalEventCopies: materializedEvents.length,
          duplicateEventIds: materializedEvents.length - new Set(materializedEvents.map((event) => event.eventId)).size
        },
        schemaValidation: {
          valid: false,
          scope: 'materialized-events',
          status: 'provisional',
          reason: 'incident closure validation pending'
        },
        replay: {
          valid: false,
          scope: 'materialized-events',
          status: 'provisional',
          reason: 'derived state still depends on source-ledger context'
        },
        hashes: { report: null },
        budget: { limitBytes: 60000, measuredBytes: null, withinBudget: null }
      }
    };
    report.exportIntegrity.hashes.report = `sha256:${'0'.repeat(64)}`;
    for (let pass = 0; pass < 3; pass += 1) {
      const serialized = JSON.stringify(report);
      const measuredBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(serialized).length
        : serialized.length;
      report.exportIntegrity.budget.measuredBytes = measuredBytes;
      report.exportIntegrity.budget.withinBudget = measuredBytes <= report.exportIntegrity.budget.limitBytes;
    }
    const hashInput = JSON.parse(JSON.stringify(report));
    delete hashInput.exportIntegrity.hashes.report;
    report.exportIntegrity.hashes.report = await sha256(hashInput);
    return report;
  }

  const api = Object.freeze({
    SCHEMA_VERSION,
    EVENT_SCHEMA_VERSION,
    GENERATOR_VERSION,
    REPORT_TYPES,
    REPORT_EVENT_TYPES,
    stableStringify,
    sha256,
    canonicalType,
    layerFor,
    sanitizeValue,
    eventFingerprint,
    buildLedger,
    deriveAxes,
    deriveModelView,
    evaluatePredicate,
    validateLedger,
    buildAllPresets,
    buildStandaloneReport
  });

  root.ProofOrientedTelemetry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

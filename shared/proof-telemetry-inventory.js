// Machine-checkable inventory for proof telemetry producers, storage and consumers.
(function initProofTelemetryInventory(root) {
  'use strict';

  const contracts = root.ProofTelemetryContracts
    || (typeof require === 'function' ? require('./proof-telemetry-contracts.js') : null);

  const INVENTORY_VERSION = '1.0.0';
  const CAPABILITY_MATRIX_VERSION = '1.0.0';
  const EVENT_TYPES = Object.freeze([
    'ANSWER_CARD_RENDER_EVALUATED',
    'ANSWER_COMMIT_EVALUATED',
    'ANSWER_COMPLETENESS_EVALUATED',
    'ANSWER_DELIVERY_ACKNOWLEDGED',
    'ANSWER_DELIVERY_REJECTED',
    'ANSWER_SOURCE_MATERIALIZED',
    'CANDIDATE_IDENTITY_INFERRED',
    'CANDIDATE_SET_CHANGED',
    'COMPLETION_HYPOTHESIS_EVALUATED',
    'DECISION_RECORDED',
    'DECISION_SUPERSEDED',
    'DISPATCH_BASELINE_CAPTURED',
    'DISPATCH_STAGE_OBSERVED',
    'EXPORT_AUDIT_RECORDED',
    'EXTRACTION_ATTEMPTED',
    'EXTRACTION_COMPLETED',
    'FINALIZATION_POLICY_EVALUATED',
    'GENERATION_SIGNAL_CHANGED',
    'GENERATION_START_EVALUATED',
    'GENERATION_STATE_INFERRED',
    'MISSING_EVIDENCE_RECORDED',
    'MODEL_TERMINAL_RECORDED',
    'OBSERVATION_FRAME_CAPTURED',
    'OBSERVATION_INTERVAL_CLOSED',
    'OBSERVATION_SLOT_DENIED',
    'OBSERVATION_SLOT_GRANTED',
    'OBSERVATION_SLOT_RELEASED',
    'OBSERVER_HEALTH_INTERVAL_CLOSED',
    'OBSERVER_HEALTH_OBSERVED',
    'PAGE_CONTEXT_OBSERVED',
    'PAGE_HEALTH_OBSERVED',
    'POLICY_OVERRIDE_APPLIED',
    'POST_TERMINAL_AUDIT_COMPLETED',
    'PROMPT_INSERTION_EVALUATED',
    'REPLAY_VALIDATION_RECORDED',
    'RUN_CONFIG_RECORDED',
    'SELECTOR_CANARY_RESULT',
    'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED',
    'STABILITY_INTERVAL_CLOSED',
    'STRUCTURAL_VERIFICATION_EVALUATED',
    'SUBMISSION_EVIDENCE_CHANGED',
    'SUBMISSION_INFERRED',
    'SUBMIT_ACTION_OBSERVED',
    'TERMINAL_DEADLINE_REACHED',
    'TEXT_STATE_CHANGED',
    'USER_FOCUS_OBSERVED'
  ]);

  const INFERENCE_TYPES = new Set([
    'ANSWER_COMPLETENESS_EVALUATED', 'CANDIDATE_IDENTITY_INFERRED',
    'COMPLETION_HYPOTHESIS_EVALUATED', 'GENERATION_START_EVALUATED',
    'GENERATION_STATE_INFERRED', 'STRUCTURAL_VERIFICATION_EVALUATED',
    'SUBMISSION_INFERRED'
  ]);
  const DECISION_TYPES = new Set([
    'DECISION_RECORDED', 'DECISION_SUPERSEDED', 'FINALIZATION_POLICY_EVALUATED',
    'MISSING_EVIDENCE_RECORDED', 'POLICY_OVERRIDE_APPLIED'
  ]);
  const AUDIT_TYPES = new Set([
    'EXPORT_AUDIT_RECORDED', 'POST_TERMINAL_AUDIT_COMPLETED',
    'REPLAY_VALIDATION_RECORDED', 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED'
  ]);
  const SYSTEM_TYPES = new Set(['RUN_CONFIG_RECORDED', 'SELECTOR_CANARY_RESULT']);
  const ACTION_TYPES = new Set(['MODEL_TERMINAL_RECORDED']);
  const OBSERVATION_TYPES = new Set([
    'OBSERVATION_FRAME_CAPTURED', 'OBSERVATION_INTERVAL_CLOSED',
    'OBSERVATION_SLOT_DENIED', 'OBSERVATION_SLOT_GRANTED',
    'OBSERVATION_SLOT_RELEASED', 'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVER_HEALTH_OBSERVED',
    'PAGE_CONTEXT_OBSERVED', 'PAGE_HEALTH_OBSERVED', 'USER_FOCUS_OBSERVED'
  ]);
  const CRITICAL_TYPES = new Set([
    'ANSWER_CARD_RENDER_EVALUATED', 'ANSWER_COMMIT_EVALUATED',
    'ANSWER_DELIVERY_ACKNOWLEDGED', 'ANSWER_DELIVERY_REJECTED',
    'ANSWER_SOURCE_MATERIALIZED', 'DECISION_RECORDED',
    'DISPATCH_BASELINE_CAPTURED', 'DISPATCH_STAGE_OBSERVED', 'EXTRACTION_COMPLETED',
    'MODEL_TERMINAL_RECORDED', 'PROMPT_INSERTION_EVALUATED',
    'SUBMISSION_EVIDENCE_CHANGED', 'SUBMIT_ACTION_OBSERVED'
  ]);

  function layerFor(eventType) {
    if (INFERENCE_TYPES.has(eventType)) return 'inference';
    if (DECISION_TYPES.has(eventType)) return 'decision';
    if (ACTION_TYPES.has(eventType)) return 'action';
    if (AUDIT_TYPES.has(eventType)) return 'audit';
    if (SYSTEM_TYPES.has(eventType)) return 'system';
    return 'fact';
  }

  function producerFor(eventType) {
    if (INFERENCE_TYPES.has(eventType)) return ['proof-telemetry-policy', 'legacy-telemetry-adapter'];
    if (DECISION_TYPES.has(eventType)) return eventType === 'MISSING_EVIDENCE_RECORDED'
      ? ['proof-telemetry-audit', 'proof-telemetry-policy']
      : ['proof-telemetry-policy', 'runtime-finalization'];
    if (AUDIT_TYPES.has(eventType)) return ['proof-telemetry-audit', 'export-validator'];
    if (SYSTEM_TYPES.has(eventType)) return ['proof-telemetry-ledger'];
    if (ACTION_TYPES.has(eventType)) return ['proof-telemetry-ledger', 'runtime-finalization'];
    return ['runtime-observer', 'legacy-telemetry-adapter'];
  }

  function reportConsumers(eventType) {
    const result = [];
    Object.entries(contracts?.REPORT_CONTRACTS || {}).forEach(([reportType, contract]) => {
      const used = (contract.slots || []).some((slot) => (slot[2] || []).includes(eventType));
      if (used) result.push(`report:${reportType}`);
    });
    return result.sort();
  }

  function samplingFor(eventType) {
    if (eventType === 'OBSERVATION_FRAME_CAPTURED') return { mode: 'change_or_heartbeat', lossPolicy: 'preserve-boundaries' };
    if (eventType === 'OBSERVER_HEALTH_OBSERVED') return { mode: 'state_transition', lossPolicy: 'preserve-degradation' };
    if (eventType === 'OBSERVATION_INTERVAL_CLOSED') return { mode: 'interval_aggregate', lossPolicy: 'preserve-coverage' };
    if (eventType.startsWith('OBSERVATION_SLOT_')) return { mode: 'per_transition', lossPolicy: 'preserve-denials' };
    return { mode: 'none', lossPolicy: 'lossless' };
  }

  function buildEventDefinition(eventType) {
    const modelScoped = !SYSTEM_TYPES.has(eventType) && eventType !== 'EXPORT_AUDIT_RECORDED';
    const criticality = CRITICAL_TYPES.has(eventType) ? 'critical' : (OBSERVATION_TYPES.has(eventType) ? 'context' : 'required');
    return Object.freeze({
      eventType,
      contractVersion: INVENTORY_VERSION,
      layer: layerFor(eventType),
      producers: Object.freeze(producerFor(eventType)),
      requiredEnvelopeFields: Object.freeze([
        'schemaVersion', 'eventId', 'eventType', 'layer', 'seq', 'wallTs',
        'runSessionId', 'producer', 'payload'
      ]),
      identity: Object.freeze({
        modelScoped,
        requiredFields: Object.freeze(modelScoped ? ['runSessionId', 'modelId'] : ['runSessionId']),
        incidentDiscriminatorFields: Object.freeze(modelScoped
          ? ['dispatchId', 'generationEpoch', 'documentInstanceId', 'navigationEpoch']
          : [])
      }),
      recipients: Object.freeze([
        'proof-ledger', 'all-presets-json', 'standalone-report', 'canonical-evidence'
      ]),
      sampling: Object.freeze(samplingFor(eventType)),
      retention: Object.freeze({
        criticality,
        canonical: criticality === 'critical' ? 'lossless' : 'bounded-with-explicit-omission',
        legacyParallelStream: layerFor(eventType) === 'fact' ? 'runtime-dependent' : 'not-required'
      }),
      consumers: Object.freeze([
        'incident-timeline', 'model-timeline', 'telemetry-validator',
        ...reportConsumers(eventType)
      ])
    });
  }

  const EVENT_REGISTRY = Object.freeze(Object.fromEntries(
    EVENT_TYPES.map((eventType) => [eventType, buildEventDefinition(eventType)])
  ));

  const SUPPORT = Object.freeze({
    yes: 'supported',
    partial: 'partial',
    no: 'unsupported',
    unknown: 'unknown'
  });

  function capability(id, title, support, evidence) {
    return Object.freeze({ id, title, support: Object.freeze(support), evidence: Object.freeze(evidence) });
  }

  const CAPABILITY_MATRIX = Object.freeze([
    capability('model-without-terminal', 'Модель без terminal',
      { legacyExport: SUPPORT.yes, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.partial, timeline: SUPPORT.yes, digest: SUPPORT.partial },
      ['runCompleteness.pendingModels', 'incident terminal=false']),
    capability('active-run-export', 'Экспорт активного запуска',
      { legacyExport: SUPPORT.yes, schema6: SUPPORT.partial, json: SUPPORT.yes, markdown: SUPPORT.partial, timeline: SUPPORT.yes, digest: SUPPORT.partial },
      ['exportedDuringActiveRun', 'snapshotCompleteness', 'runCompleteness']),
    capability('tab-closed-during-generation', 'Вкладка закрыта во время генерации',
      { legacyExport: SUPPORT.yes, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.partial, timeline: SUPPORT.yes, digest: SUPPORT.partial },
      ['PAGE_CONTEXT_OBSERVED', 'generation state at boundary']),
    capability('success-with-error-reason', 'SUCCESS с ошибочной причиной',
      { legacyExport: SUPPORT.yes, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['MODEL_TERMINAL_RECORDED', 'DECISION_RECORDED']),
    capability('pending-persistence', 'Незавершённая persistence queue',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.partial, json: SUPPORT.yes, markdown: SUPPORT.no, timeline: SUPPORT.partial, digest: SUPPORT.no },
      ['snapshotCompleteness', 'snapshot boundary']),
    capability('old-answer', 'Старый ответ',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['DISPATCH_BASELINE_CAPTURED', 'CANDIDATE_IDENTITY_INFERRED']),
    capability('cutted-answer', 'Обрезанный ответ',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['TEXT_STATE_CHANGED', 'ANSWER_COMPLETENESS_EVALUATED']),
    capability('post-terminal-growth', 'Рост после terminal',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['POST_TERMINAL_AUDIT_COMPLETED']),
    capability('delivery-rejected', 'Отклонённая доставка',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['ANSWER_DELIVERY_REJECTED']),
    capability('submission-unconfirmed', 'Нет подтверждения отправки',
      { legacyExport: SUPPORT.partial, schema6: SUPPORT.yes, json: SUPPORT.yes, markdown: SUPPORT.yes, timeline: SUPPORT.yes, digest: SUPPORT.yes },
      ['SUBMISSION_EVIDENCE_CHANGED', 'observation window completeness'])
  ]);

  function validateInventory(knownEventTypes = EVENT_TYPES) {
    const errors = [];
    const known = new Set(knownEventTypes || []);
    const registered = new Set(Object.keys(EVENT_REGISTRY));
    known.forEach((eventType) => {
      if (!registered.has(eventType)) errors.push(`unregistered event type: ${eventType}`);
    });
    registered.forEach((eventType) => {
      if (!known.has(eventType)) errors.push(`orphan registry event type: ${eventType}`);
      const entry = EVENT_REGISTRY[eventType];
      ['producers', 'requiredEnvelopeFields', 'identity', 'recipients', 'sampling', 'retention', 'consumers']
        .forEach((field) => {
          if (entry[field] === undefined || entry[field] === null) errors.push(`${eventType}: missing ${field}`);
        });
    });
    Object.entries(contracts?.REPORT_CONTRACTS || {}).forEach(([reportType, contract]) => {
      (contract.slots || []).flatMap((slot) => slot[2] || []).forEach((eventType) => {
        if (!registered.has(eventType)) errors.push(`${reportType}: slot uses unregistered event type ${eventType}`);
      });
    });
    const allowedSupport = new Set(Object.values(SUPPORT));
    CAPABILITY_MATRIX.forEach((entry) => {
      ['legacyExport', 'schema6', 'json', 'markdown', 'timeline', 'digest'].forEach((surface) => {
        if (!allowedSupport.has(entry.support[surface])) errors.push(`${entry.id}: invalid or missing support for ${surface}`);
      });
    });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }

  const api = Object.freeze({
    INVENTORY_VERSION,
    CAPABILITY_MATRIX_VERSION,
    EVENT_TYPES,
    EVENT_REGISTRY,
    CAPABILITY_MATRIX,
    SUPPORT,
    validateInventory
  });
  root.ProofTelemetryInventory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

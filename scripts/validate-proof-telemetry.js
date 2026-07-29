#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Policy = require('../shared/proof-telemetry-policy.js');
const Contracts = require('../shared/proof-telemetry-contracts.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');

const REQUIRED_REPORTS = ProofTelemetry.REPORT_TYPES;
const SCHEMA_DIR = path.join(__dirname, '..', 'docs', 'proof_oriented_telemetry_spec_v1', 'schemas');

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));
}

function schemaErrors(schemaName, value) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(loadSchema(schemaName));
  validate(value);
  return (validate.errors || []).map((error) => ({ code: 'JSON_SCHEMA', message: `${schemaName}${error.instancePath}: ${error.message}` }));
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function reconstructAtSeq(events, seq) {
  const boundary = Number(seq);
  const subset = (Array.isArray(events) ? events : []).filter((event) => Number(event.seq) <= boundary);
  return Policy.replay(subset).models;
}

function privacyViolations(value, currentPath = '$', violations = []) {
  if (!value || typeof value !== 'object') return violations;
  Object.entries(value).forEach(([key, child]) => {
    const normalized = key.toLowerCase();
    const safeMetric = ProofTelemetry.REPORT_TYPES.includes(key)
      || /(hash|length|len|count|id|status|state|reason|source|mode|tier|version|type|ref|exported|policy|report|preset|task)/.test(normalized);
    if (!safeMetric && /(prompt|answertext|html|token|cookie|secret|credential|authorization|api.?key|rawdom|fulltext)/.test(normalized)) {
      violations.push({ code: 'PRIVACY_FORBIDDEN_KEY', path: `${currentPath}.${key}` });
    }
    privacyViolations(child, `${currentPath}.${key}`, violations);
  });
  return violations;
}

function semanticInvariantViolations(events, report = null) {
  const violations = [];
  const byId = new Map((events || []).map((event) => [event.eventId, event]));
  const facts = (events || []).map((event) => ({ event, fact: Contracts.factOf(event) }));
  const add = (invariantId, message, eventId = null) => violations.push({ invariantId, message, ...(eventId ? { eventId } : {}) });
  (events || []).forEach((event) => {
    (event.evidenceRefs || []).forEach((ref) => {
      const evidence = byId.get(ref);
      if (!evidence) return;
      if (event.modelId !== 'SYSTEM' && evidence.modelId !== 'SYSTEM' && !Incidents.exactScope(event, evidence)) add('S03', 'evidence chain crosses incident scope', event.eventId);
    });
    const expectedLayer = ProofTelemetry.layerFor(event.eventType);
    if (expectedLayer !== event.layer && !['CLOCK_EPOCH_STARTED', 'CLOCK_EPOCH_CLOSED', 'RUN_CONFIG_RECORDED'].includes(event.eventType)) add('S04', `event layer ${event.layer} does not match ${expectedLayer}`, event.eventId);
    if (event.eventType === 'CANDIDATE_IDENTITY_INFERRED' && Contracts.factOf(event).state === 'current_dispatch'
      && (!event.dispatchId || event.generationEpoch === undefined)) add('S11', 'accepted candidate lacks dispatch/generation identity', event.eventId);
    if (event.eventType === 'DECISION_SUPERSEDED' && !(event.evidenceRefs || []).some((ref) => byId.get(ref)?.eventType === 'DECISION_RECORDED')) add('S19', 'supersession does not reference an old decision', event.eventId);
  });
  const runConfigs = (events || []).filter((event) => event.eventType === 'RUN_CONFIG_RECORDED');
  if (runConfigs.length > 1) add('S17', 'static run configuration is duplicated');
  const submissionConfirmed = facts.some(({ fact }) => fact.kind === 'submission' && fact.state === 'confirmed');
  const currentDispatch = facts.some(({ fact }) => fact.kind === 'candidate_identity' && fact.state === 'current_dispatch');
  (events || []).filter((event) => event.eventType === 'DECISION_RECORDED' && event.payload?.accepted && event.payload?.mode === 'automatic').forEach((event) => {
    if (!submissionConfirmed || !currentDispatch) add('S12', 'automatic success lacks submission/current-dispatch proof', event.eventId);
  });
  const terminal = (events || []).find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
  if (terminal) {
    const tier = Policy.evidenceTier(events, terminal);
    const audit = (events || []).some((event) => ['POST_TERMINAL_AUDIT_COMPLETED', 'MISSING_EVIDENCE_RECORDED'].includes(event.eventType));
    if (tier < 4 && !audit) add('S15', 'accepted answer below T4 lacks audit or explicit audit omission', terminal.eventId);
  }
  if (report) {
    if (!report.reportDescriptor || !report.correlation || !Array.isArray(report.siblings)) add('S16', 'standalone self-description or evaluated siblings missing');
    const missingSlots = (report.diagnosticSummary?.evidenceSlots || []).filter((slot) => slot.status === 'unavailable');
    missingSlots.forEach((slot) => {
      if (!(report.missingEvidence || []).some((missing) => missing.slotId === slot.slotId)) add('S20', `missing slot ${slot.slotId} is not explicit`);
    });
  }
  return violations;
}

async function validateContainer(container, { verifyContainerHash = true } = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, message, details = null) => errors.push({ code, message, ...(details ? { details } : {}) });
  if (!container || typeof container !== 'object') return { valid: false, errors: [{ code: 'CONTAINER_INVALID', message: 'container must be an object' }], warnings };
  if (container.schemaVersion !== '5.0') addError('SCHEMA_VERSION', 'schemaVersion must equal 5.0');
  if (container.containerType !== 'all-presets') addError('CONTAINER_TYPE', 'containerType must equal all-presets');
  schemaErrors('all-presets.schema.json', container).forEach((error) => addError(error.code, error.message));
  const events = Array.isArray(container?.ledger?.events) ? container.ledger.events : [];
  events.forEach((event) => schemaErrors('telemetry-event-v6.schema.json', event).forEach((error) => addError(error.code, error.message)));
  ProofTelemetry.validateLedger(events).forEach((violation) => addError(violation.invariantId, violation.message, violation));
  semanticInvariantViolations(events).forEach((violation) => addError(violation.invariantId, violation.message, violation));
  const replay = Policy.replay(events);
  replay.invariantViolations.forEach((violation) => addError(violation.invariantId, violation.message, violation));

  const ids = new Set(events.map((event) => event.eventId));
  const seqs = new Set(events.map((event) => event.seq));
  REQUIRED_REPORTS.forEach((reportType) => {
    const report = container?.reports?.[reportType];
    if (!report) {
      addError('REPORT_MISSING', `missing report ${reportType}`);
      return;
    }
    if (report?.reportDescriptor?.reportMode !== 'embedded-in-all-presets') addError('REPORT_MODE', `${reportType} is not embedded`);
    if (Object.prototype.hasOwnProperty.call(report, 'materializedEvents')) addError('EVENT_DUPLICATION', `${reportType} materializes canonical events`);
    (report.eventSeqs || []).forEach((eventSeq) => {
      if (!seqs.has(eventSeq)) addError('REPORT_EVENT_REF', `${reportType} references missing event seq ${eventSeq}`);
    });
    (report.siblings || []).forEach((rule) => {
      (rule?.evaluation?.predicateResults || []).forEach((recorded) => {
        const model = report?.diagnosticSummary?.models?.[recorded.modelId];
        if (!model) return;
        const recomputed = ProofTelemetry.evaluatePredicate({ stateAxes: model.stateAxes, derivedViews: model }, recorded.predicate);
        if (recomputed.matched !== recorded.matched) addError('REQUEST_IF_MISMATCH', `${reportType} requestIf mismatch for ${recorded.modelId}`);
      });
    });
  });

  const expectedHashes = {
    ledger: await ProofTelemetry.sha256(events),
    sharedConfig: await ProofTelemetry.sha256(container.sharedConfig),
    derivedViews: await ProofTelemetry.sha256(container.derivedViews),
    reports: await ProofTelemetry.sha256(container.reports),
    attachments: await ProofTelemetry.sha256(container.attachments)
  };
  Object.entries(expectedHashes).forEach(([section, expected]) => {
    if (container?.exportAudit?.hashes?.[section] !== expected) addError('HASH_MISMATCH', `${section} hash mismatch`);
  });
  if (verifyContainerHash) {
    const hashInput = JSON.parse(JSON.stringify(container));
    if (hashInput?.exportAudit?.hashes) delete hashInput.exportAudit.hashes.container;
    const expected = await ProofTelemetry.sha256(hashInput);
    if (container?.exportAudit?.hashes?.container !== expected) addError('HASH_MISMATCH', 'container hash mismatch');
  }

  const recordedDecisionHash = await ProofTelemetry.sha256(replay.recordedDecisions);
  const recomputedDecisionHash = await ProofTelemetry.sha256(replay.recomputedDecisions);
  if (recordedDecisionHash !== recomputedDecisionHash) addError('REPLAY_MISMATCH', 'recorded and recomputed decisions differ');
  if (container?.exportAudit?.replay?.recordedDecisionHash !== recordedDecisionHash) addError('REPLAY_HASH', 'recorded decision hash is stale');
  if (container?.exportAudit?.replay?.recomputedDecisionHash !== recomputedDecisionHash) addError('REPLAY_HASH', 'recomputed decision hash is stale');

  const boundary = container?.exportAudit?.exportBoundary?.ledgerCompleteThroughSeq;
  if (Number(boundary || 0) !== Number(container?.ledger?.lastSeq || 0)) addError('EXPORT_BOUNDARY', 'ledger boundary differs from lastSeq');
  if (Number(container?.crossReportCompatibility?.exactMatch?.ledgerCompleteThroughSeq || 0) !== Number(boundary || 0)) addError('COMPATIBILITY_BOUNDARY', 'cross-report boundary mismatch');
  if (container?.crossReportCompatibility?.exactMatch?.ledgerHash !== container?.ledger?.ledgerHash) addError('COMPATIBILITY_HASH', 'cross-report ledger hash mismatch');

  const measuredBytes = byteLength(container);
  if (Number(container?.exportAudit?.budget?.measuredBytes || 0) !== measuredBytes) addError('SIZE_MISMATCH', 'recorded measuredBytes differs from serialized size');
  if (measuredBytes > Number(container?.manifest?.sizeBudgetBytes || 0)) warnings.push({ code: 'SIZE_BUDGET_EXCEEDED', measuredBytes });
  privacyViolations(container).forEach((violation) => addError(violation.code, `forbidden privacy key at ${violation.path}`));

  const reconstructedAxes = events.length ? reconstructAtSeq(events, events[events.length - 1].seq) : {};
  return { valid: errors.length === 0, errors, warnings, reconstructedAxes };
}

async function validateStandaloneReport(report) {
  const errors = [];
  const warnings = [];
  const addError = (code, message) => errors.push({ code, message });
  if (!report || typeof report !== 'object') return { valid: false, errors: [{ code: 'REPORT_INVALID', message: 'report must be an object' }], warnings };
  if (report.schemaVersion !== '5.0') addError('SCHEMA_VERSION', 'schemaVersion must equal 5.0');
  if (report.fileKind !== 'diagnostic-report') addError('FILE_KIND', 'fileKind must equal diagnostic-report');
  if (!REQUIRED_REPORTS.includes(report?.reportDescriptor?.reportType)) addError('REPORT_TYPE', 'unsupported reportType');
  if (report?.reportDescriptor?.reportMode !== 'standalone') addError('REPORT_MODE', 'reportMode must equal standalone');
  schemaErrors('diagnostic-report.schema.json', report).forEach((error) => addError(error.code, error.message));
  const events = Array.isArray(report?.eventSelection?.materializedEvents) ? report.eventSelection.materializedEvents : [];
  events.forEach((event) => schemaErrors('telemetry-event-v6.schema.json', event).forEach((error) => addError(error.code, error.message)));
  ProofTelemetry.validateLedger(events).forEach((violation) => addError(violation.invariantId, violation.message));
  semanticInvariantViolations(events, report).forEach((violation) => addError(violation.invariantId, violation.message));
  const ids = events.map((event) => event.eventId);
  if (new Set(ids).size !== ids.length) addError('EVENT_DUPLICATION', 'standalone report duplicates canonical events');
  const idSet = new Set(ids);
  (report?.eventSelection?.eventRefs || []).forEach((eventRef) => {
    if (!idSet.has(eventRef)) addError('REPORT_EVENT_REF', `missing materialized event ${eventRef}`);
  });
  events.forEach((event) => (event.evidenceRefs || []).forEach((evidenceRef) => {
    if (!idSet.has(evidenceRef)) addError('EVIDENCE_CLOSURE', `missing evidence dependency ${evidenceRef}`);
  }));
  const materializedHash = await ProofTelemetry.sha256(events);
  if (report?.exportIntegrity?.materializedEventHash !== materializedHash) addError('HASH_MISMATCH', 'materialized event hash mismatch');
  const hashInput = JSON.parse(JSON.stringify(report));
  if (hashInput?.exportIntegrity?.hashes) {
    if ('artifact' in hashInput.exportIntegrity.hashes) delete hashInput.exportIntegrity.hashes.artifact;
    else delete hashInput.exportIntegrity.hashes.report;
  }
  const reportHash = await ProofTelemetry.sha256(hashInput);
  const recordedArtifactHash = report?.exportIntegrity?.hashes?.artifact || report?.exportIntegrity?.hashes?.report;
  if (recordedArtifactHash !== reportHash) addError('HASH_MISMATCH', 'report hash mismatch');
  const measuredBytes = byteLength(report);
  const recordedSize = report?.exportIntegrity?.size?.measuredBytes ?? report?.exportIntegrity?.budget?.measuredBytes;
  if (Number(recordedSize || 0) !== measuredBytes) addError('SIZE_MISMATCH', 'recorded measuredBytes differs from serialized size');
  if (report?.exportIntegrity?.budget?.limitBytes && measuredBytes > Number(report.exportIntegrity.budget.limitBytes)) warnings.push({ code: 'SIZE_BUDGET_EXCEEDED', measuredBytes });
  events.forEach((event) => {
    if (!Array.isArray(event.includedFor) || event.includedFor.length === 0) addError('INCLUDED_FOR_MISSING', `event ${event.eventId} has no inclusion reason`);
  });
  const correlation = report?.correlation || {};
  events.filter((event) => event.modelId !== 'SYSTEM').forEach((event) => {
    if (String(event.runSessionId) !== String(correlation.runSessionId)
      || Number(event.runGeneration ?? -1) !== Number(correlation.runGeneration ?? -1)
      || String(event.modelId) !== String(correlation.modelId)
      || String(event.dispatchId) !== String(correlation.dispatchId)
      || Number(event.generationEpoch ?? -1) !== Number(correlation.generationEpoch ?? -1)) {
      addError('INCIDENT_SCOPE', `event ${event.eventId} is outside the declared incident`);
    }
  });
  let previousIngestSeq = 0;
  events.forEach((event) => {
    if (Number(event.ingestSeq) <= previousIngestSeq) addError('INGEST_ORDER', `event ${event.eventId} is not in canonical ingestion order`);
    previousIngestSeq = Number(event.ingestSeq);
  });
  Object.entries(report?.derivedViews?.fieldProvenance || {}).forEach(([field, provenance]) => {
    if (!provenance?.derivationVersion) addError('DERIVATION_VERSION', `${field} has no derivation version`);
    (provenance?.derivedFromEventIds || []).forEach((eventId) => {
      if (!idSet.has(eventId)) addError('DERIVED_REF', `${field} references absent event ${eventId}`);
    });
  });
  const replayTarget = events.filter((event) => event.modelId === correlation.modelId).slice(-1)[0];
  const replayAxes = replayTarget ? Policy.deriveAxes(events, replayTarget) : {};
  if (ProofTelemetry.stableStringify(replayAxes) !== ProofTelemetry.stableStringify(report.stateAxes || {})) {
    addError('REPLAY_MISMATCH', 'state axes cannot be rebuilt from materialized events');
  }
  const registrySnapshot = { version: Contracts.REGISTRY_VERSION, reports: Contracts.REPORT_CONTRACTS };
  const registryHash = await ProofTelemetry.sha256(registrySnapshot);
  if (report?.reportDescriptor?.dependencyRegistryVersion !== Contracts.REGISTRY_VERSION
    || report?.reportDescriptor?.dependencyRegistryHash !== registryHash) {
    addError('REGISTRY_MISMATCH', 'report dependency registry is stale');
  }
  const incident = { scope: Incidents.scopeOf(correlation) };
  const resolved = Incidents.resolveEvidenceSlots(events, incident, report?.reportDescriptor?.reportType);
  const recordedSlots = report?.diagnosticSummary?.evidenceSlots || [];
  if (ProofTelemetry.stableStringify(resolved.slots) !== ProofTelemetry.stableStringify(recordedSlots)) addError('EVIDENCE_SLOT_MISMATCH', 'evidence slots cannot be rebuilt');
  const semanticEvents = events.map((event) => {
    const copy = JSON.parse(JSON.stringify(event));
    delete copy.wallTs;
    if (copy.clock) delete copy.clock.ingestMonoMs;
    return copy;
  });
  const semanticHash = await ProofTelemetry.sha256({ incident: correlation && {
    runSessionId: correlation.runSessionId,
    runGeneration: correlation.runGeneration,
    modelId: correlation.modelId,
    dispatchId: correlation.dispatchId,
    generationEpoch: correlation.generationEpoch
  }, task: report?.reportDescriptor?.reportType, events: semanticEvents, axes: report.stateAxes });
  if (report?.exportIntegrity?.semanticHash !== semanticHash || report?.exportIntegrity?.hashes?.semantic !== semanticHash) {
    addError('SEMANTIC_HASH_MISMATCH', 'semantic hash mismatch');
  }
  (report?.siblings || []).forEach((rule) => {
    (rule?.evaluation?.predicateResults || []).forEach((recorded) => {
      const recomputed = ProofTelemetry.evaluatePredicate({ stateAxes: report.stateAxes, derivedViews: report.derivedViews?.modelTimeline?.data }, recorded.predicate);
      if (recomputed.matched !== recorded.matched) addError('REQUEST_IF_MISMATCH', `sibling ${rule.reportType} predicate mismatch`);
    });
    if (rule.reportType === report?.reportDescriptor?.reportType) addError('SIBLING_LOOP', 'report requests itself');
  });
  (report.attachments || []).forEach((attachment) => {
    if (attachment.eventRef && !idSet.has(attachment.eventRef)) addError('ATTACHMENT_REF', `attachment references absent event ${attachment.eventRef}`);
  });
  privacyViolations(report).forEach((violation) => addError(violation.code, `forbidden privacy key at ${violation.path}`));
  return { valid: errors.length === 0, errors, warnings, reconstructedAxes: reconstructAtSeq(events, events[events.length - 1]?.seq || 0) };
}

async function optimizeRepresentation(report, { transportLimitBytes = null, externalizeAttachments = true } = {}) {
  const optimized = JSON.parse(JSON.stringify(report));
  const beforeBytes = byteLength(optimized);
  optimized.exportIntegrity.optimization = {
    status: transportLimitBytes && beforeBytes > transportLimitBytes ? 'oversized' : 'not_required',
    beforeBytes,
    afterBytes: beforeBytes,
    coreEvidencePreserved: true,
    externalizedAttachmentCount: 0,
    removedRebuildableSections: []
  };
  if (transportLimitBytes && beforeBytes > transportLimitBytes && optimized.reportDescriptor?.completeness?.level !== 'insufficient') {
    if (optimized.derivedViews?.modelTimeline?.data) {
      delete optimized.derivedViews.modelTimeline.data;
      optimized.exportIntegrity.optimization.removedRebuildableSections.push('derivedViews.modelTimeline.data');
    }
    if (externalizeAttachments && Array.isArray(optimized.attachments) && optimized.attachments.length) {
      optimized.exportIntegrity.optimization.externalizedAttachmentCount = optimized.attachments.length;
      optimized.attachments = optimized.attachments.map((attachment) => ({ attachmentId: attachment.attachmentId, eventRef: attachment.eventRef, externalized: true }));
    }
    optimized.exportIntegrity.optimization.status = 'optimized_but_oversized';
  }
  optimized.exportIntegrity.optimization.afterBytes = byteLength(optimized);
  if (transportLimitBytes && optimized.exportIntegrity.optimization.afterBytes <= transportLimitBytes) optimized.exportIntegrity.optimization.status = 'optimized';
  if (transportLimitBytes && optimized.exportIntegrity.optimization.afterBytes > transportLimitBytes) optimized.exportIntegrity.optimization.status = 'oversized_preserved_core';
  return optimized;
}

async function validateArtifact(artifact, options = {}) {
  return artifact?.fileKind === 'diagnostic-report'
    ? validateStandaloneReport(artifact, options)
    : validateContainer(artifact, options);
}

async function main(argv = process.argv.slice(2)) {
  const filename = argv[0];
  if (!filename) {
    console.error('Usage: node scripts/validate-proof-telemetry.js <all-presets.json>');
    process.exitCode = 2;
    return;
  }
  const resolved = path.resolve(filename);
  const container = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const result = await validateArtifact(container);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

module.exports = { validateContainer, validateStandaloneReport, validateArtifact, reconstructAtSeq, privacyViolations, semanticInvariantViolations, optimizeRepresentation };
if (require.main === module) main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

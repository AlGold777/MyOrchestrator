#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Policy = require('../shared/proof-telemetry-policy.js');

const REQUIRED_REPORTS = ProofTelemetry.REPORT_TYPES;

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
    const safeMetric = /(hash|length|len|count|id|status|state|reason|source|mode|tier|version|type|ref|exported|policy)/.test(normalized);
    if (!safeMetric && /(prompt|answertext|html|token|cookie|secret|credential|authorization|api.?key|rawdom|fulltext)/.test(normalized)) {
      violations.push({ code: 'PRIVACY_FORBIDDEN_KEY', path: `${currentPath}.${key}` });
    }
    privacyViolations(child, `${currentPath}.${key}`, violations);
  });
  return violations;
}

async function validateContainer(container, { verifyContainerHash = true } = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, message, details = null) => errors.push({ code, message, ...(details ? { details } : {}) });
  if (!container || typeof container !== 'object') return { valid: false, errors: [{ code: 'CONTAINER_INVALID', message: 'container must be an object' }], warnings };
  if (container.schemaVersion !== '5.0') addError('SCHEMA_VERSION', 'schemaVersion must equal 5.0');
  if (container.containerType !== 'all-presets') addError('CONTAINER_TYPE', 'containerType must equal all-presets');
  const events = Array.isArray(container?.ledger?.events) ? container.ledger.events : [];
  ProofTelemetry.validateLedger(events).forEach((violation) => addError(violation.invariantId, violation.message, violation));
  const replay = Policy.replay(events);
  replay.invariantViolations.forEach((violation) => addError(violation.invariantId, violation.message, violation));

  const ids = new Set(events.map((event) => event.eventId));
  REQUIRED_REPORTS.forEach((reportType) => {
    const report = container?.reports?.[reportType];
    if (!report) {
      addError('REPORT_MISSING', `missing report ${reportType}`);
      return;
    }
    if (report?.reportDescriptor?.reportMode !== 'embedded-in-all-presets') addError('REPORT_MODE', `${reportType} is not embedded`);
    if (Object.prototype.hasOwnProperty.call(report, 'materializedEvents')) addError('EVENT_DUPLICATION', `${reportType} materializes canonical events`);
    (report.eventRefs || []).forEach((eventRef) => {
      if (!ids.has(eventRef)) addError('REPORT_EVENT_REF', `${reportType} references missing event ${eventRef}`);
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
  const events = Array.isArray(report?.eventSelection?.materializedEvents) ? report.eventSelection.materializedEvents : [];
  ProofTelemetry.validateLedger(events).forEach((violation) => addError(violation.invariantId, violation.message));
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
  if (hashInput?.exportIntegrity?.hashes) delete hashInput.exportIntegrity.hashes.report;
  const reportHash = await ProofTelemetry.sha256(hashInput);
  if (report?.exportIntegrity?.hashes?.report !== reportHash) addError('HASH_MISMATCH', 'report hash mismatch');
  const measuredBytes = byteLength(report);
  if (Number(report?.exportIntegrity?.budget?.measuredBytes || 0) !== measuredBytes) addError('SIZE_MISMATCH', 'recorded measuredBytes differs from serialized size');
  if (measuredBytes > Number(report?.exportIntegrity?.budget?.limitBytes || 0)) warnings.push({ code: 'SIZE_BUDGET_EXCEEDED', measuredBytes });
  privacyViolations(report).forEach((violation) => addError(violation.code, `forbidden privacy key at ${violation.path}`));
  return { valid: errors.length === 0, errors, warnings, reconstructedAxes: reconstructAtSeq(events, events[events.length - 1]?.seq || 0) };
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

module.exports = { validateContainer, validateStandaloneReport, validateArtifact, reconstructAtSeq, privacyViolations };
if (require.main === module) main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Comparator = require('../shared/proof-telemetry-semantic-comparator.js');
const { validateArtifact, validateCanonicalEvidence, validateContainer } = require('./validate-proof-telemetry.js');
const PROJECT_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).version;
const AXIS_NAMES = ProofTelemetry.STATE_AXIS_NAMES;

const sha256File = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function versionParts(value) {
  return String(value || '').split('.').map((item) => Number(item) || 0);
}

function versionBefore(value, boundary) {
  const left = versionParts(value);
  const right = versionParts(boundary);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) < (right[index] || 0);
  }
  return false;
}

const signatureOf = (item) => `${String(item?.code || 'UNKNOWN')}|${String(item?.message || '')}`;

function expectedMigrationFindings(extensionVersion, source = {}) {
  const expected = new Map();
  const add = (code, message, count, explanation) => expected.set(`${code}|${message}`, { count, explanation });
  const sourceSnapshot = source?.manifest?.sourceSnapshot || {};
  const exportAudit = source?.exportAudit || {};
  if (versionBefore(extensionVersion, '2.81.226')
    && !Object.prototype.hasOwnProperty.call(sourceSnapshot, 'snapshotCompleteness')
    && !Object.prototype.hasOwnProperty.call(exportAudit, 'completeness')) {
    const explanation = 'artifact predates active-run completeness contract (2.81.226)';
    add('JSON_SCHEMA', "all-presets.schema.json/manifest/sourceSnapshot: must have required property 'snapshotCompleteness'", 1, explanation);
    add('JSON_SCHEMA', "all-presets.schema.json/exportAudit: must have required property 'completeness'", 1, explanation);
    add('RUN_COMPLETENESS', 'exportedDuringActiveRun disagrees with runCompleteness', 1, explanation);
    add('SNAPSHOT_COMPLETENESS', 'snapshot completeness disagrees with the recorded boundary', 1, explanation);
  }
  const incidents = Object.values(source?.derivedViews?.['incident-timeline']?.data || {});
  const reportCount = Object.keys(source?.reports || {}).length;
  if (versionBefore(extensionVersion, '2.81.228')
    && incidents.length > 0
    && reportCount > 0
    && incidents.every((incident) => !Object.prototype.hasOwnProperty.call(incident, 'stateAxesProvenance'))) {
    const count = reportCount * incidents.length;
    const explanation = 'artifact predates exact stateAxesProvenance contract (2.81.228)';
    add('S22', 'stateAxesProvenance does not match the fourteen contracted axes', count, explanation);
    AXIS_NAMES.forEach((axis) => add('S22', `invalid provenance contract for state axis ${axis}`, count, explanation));
  }
  return expected;
}

function explainSourceError(error, extensionVersion, source = {}, observedCount = 1) {
  const expected = expectedMigrationFindings(extensionVersion, source).get(signatureOf(error));
  return expected && expected.count === observedCount ? expected.explanation : null;
}

function summarizeFindings(items, extensionVersion, source = {}) {
  const counts = new Map();
  (items || []).forEach((item) => counts.set(signatureOf(item), (counts.get(signatureOf(item)) || 0) + 1));
  const grouped = {};
  const unexplained = [];
  counts.forEach((count, signature) => {
    const separator = signature.indexOf('|');
    const code = signature.slice(0, separator);
    const message = signature.slice(separator + 1);
    const explanation = explainSourceError({ code, message }, extensionVersion, source, count);
    if (!grouped[code]) grouped[code] = { count: 0, explanations: new Set(), unexplainedCount: 0 };
    grouped[code].count += count;
    if (explanation) grouped[code].explanations.add(explanation);
    else {
      grouped[code].unexplainedCount += count;
      unexplained.push({ code, message, count });
    }
  });
  const findings = Object.fromEntries(Object.entries(grouped).map(([code, value]) => [code, {
    count: value.count,
    explanation: value.unexplainedCount === 0 ? [...value.explanations].join('; ') : null,
    unexplainedCount: value.unexplainedCount
  }]));
  return { findings, unexplained };
}

function analyzeDigestText(text, filename = 'digest.txt') {
  const header = String(text).match(/version\s+([^|\s]+)\s*\|\s*([^|\n]+)\s*\|\s*(\d+)\s+events/i);
  const runSessions = String(text).match(/^run sessions:\s*(.+)$/mi);
  return {
    file: path.basename(filename),
    bytes: Buffer.byteLength(String(text), 'utf8'),
    extensionVersion: header?.[1] || null,
    createdAt: header?.[2]?.trim() || null,
    eventCount: header ? Number(header[3]) : null,
    runSessions: runSessions?.[1]?.trim() || null,
    declaresOmittedEventTypes: /does NOT carry these event types/i.test(String(text)),
    missingSignalRulePresent: /do not infer the absence of anything/i.test(String(text)),
    role: 'triage-only',
    supportsIntegrityValidation: false,
    supportsOfflineReplay: false
  };
}

async function inspectJsonArtifact(source, metadata = {}) {
  const extensionVersion = String(source?.sharedConfig?.extensionVersion || 'unknown');
  const sourceValidationStartedAt = performance.now();
  const sourceValidation = await validateArtifact(source);
  const sourceValidationMs = performance.now() - sourceValidationStartedAt;
  const sourceFindings = summarizeFindings(sourceValidation.errors, extensionVersion, source);
  const unexplainedSourceErrorCodes = [...new Set(sourceFindings.unexplained.map((item) => item.code))].sort();
  const ledger = Array.isArray(source?.ledger?.events) ? source.ledger.events : [];
  const exportedAt = Number(Date.parse(source?.manifest?.createdAt || source?.createdAt) || Date.now());
  const options = {
    canonicalLedger: true,
    exportedAt,
    extensionVersion: metadata.currentExtensionVersion || 'field-validation',
    snapshotConsistency: source?.manifest?.sourceSnapshot?.consistency || source?.sourceSnapshot?.consistency || 'historical_reinterpretation'
  };

  const canonicalStartedAt = performance.now();
  const canonical = await ProofTelemetry.buildCanonicalEvidence(ledger, options);
  const canonicalBuildMs = performance.now() - canonicalStartedAt;
  const fullStartedAt = performance.now();
  const full = await ProofTelemetry.buildAllPresets(ledger, options);
  const fullBuildMs = performance.now() - fullStartedAt;
  const canonicalValidation = await validateCanonicalEvidence(canonical);
  const fullValidation = await validateContainer(full);
  const parityStartedAt = performance.now();
  const parity = await Comparator.compareContainer(full, { exportedAt });
  const parityMs = performance.now() - parityStartedAt;
  const sourceLedgerHash = source?.ledger?.ledgerHash || await ProofTelemetry.sha256(ledger);
  const ledgerHashPreserved = sourceLedgerHash === canonical?.ledger?.ledgerHash
    && sourceLedgerHash === full?.ledger?.ledgerHash;
  const currentRegistryHash = await ProofTelemetry.sha256(ProofTelemetry.dependencyRegistrySnapshot());
  const sourceRegistryHash = await ProofTelemetry.sha256(source?.sharedConfig?.dependencyRegistry || {});
  const sourceReportVersions = Array.from(new Set(ProofTelemetry.REPORT_TYPES
    .map((reportType) => source?.reports?.[reportType]?.reportDescriptor?.reportVersion)
    .filter(Boolean))).sort();
  const exactIdentityMatch = source?.sharedConfig?.generatorVersion === ProofTelemetry.GENERATOR_VERSION
    && sourceRegistryHash === currentRegistryHash
    && sourceReportVersions.length === 1
    && sourceReportVersions[0] === ProofTelemetry.REPORT_VERSION;
  const gatePassed = unexplainedSourceErrorCodes.length === 0
    && canonicalValidation.valid
    && fullValidation.valid
    && parity.equivalent
    && ledgerHashPreserved;

  return {
    file: metadata.file || null,
    bytes: Number(metadata.bytes || byteLength(source)),
    sha256: metadata.sha256 || null,
    source: {
      containerType: source?.containerType || null,
      schemaVersion: source?.schemaVersion || null,
      extensionVersion,
      generatorVersion: source?.sharedConfig?.generatorVersion || null,
      registryVersion: source?.sharedConfig?.dependencyRegistry?.registryVersion || null,
      eventCount: ledger.length,
      incidentCount: Object.keys(source?.derivedViews?.['incident-timeline']?.data || {}).length,
      validationValid: sourceValidation.valid,
      validationMs: Number(sourceValidationMs.toFixed(1)),
      errors: sourceFindings.findings,
      warningCodes: [...new Set((sourceValidation.warnings || []).map((item) => item.code))].sort(),
      unexplainedErrorCodes: unexplainedSourceErrorCodes,
      unexplainedFindings: sourceFindings.unexplained
    },
    reinterpretation: {
      mode: exactIdentityMatch
        ? 'exact-current-generator'
        : 'explicit-historical-reinterpretation',
      currentGeneratorVersion: ProofTelemetry.GENERATOR_VERSION,
      ledgerHashPreserved,
      canonical: {
        valid: canonicalValidation.valid,
        errorCodes: [...new Set(canonicalValidation.errors.map((item) => item.code))].sort(),
        bytes: byteLength(canonical),
        buildMs: Number(canonicalBuildMs.toFixed(1))
      },
      full: {
        valid: fullValidation.valid,
        errorCodes: [...new Set(fullValidation.errors.map((item) => item.code))].sort(),
        bytes: byteLength(full),
        buildMs: Number(fullBuildMs.toFixed(1))
      },
      semanticParity: {
        equivalent: parity.equivalent,
        comparisonCount: parity.comparisonCount,
        differenceCount: parity.results.reduce((count, item) => count + item.differences.length, 0),
        elapsedMs: Number(parityMs.toFixed(1))
      }
    },
    gatePassed
  };
}

async function inspectFile(filename) {
  const resolved = path.resolve(filename);
  const raw = fs.readFileSync(resolved);
  if (/digest\.txt$/i.test(resolved)) {
    return { kind: 'digest', sha256: sha256File(raw), ...analyzeDigestText(raw.toString('utf8'), resolved) };
  }
  const source = JSON.parse(raw.toString('utf8'));
  return {
    kind: 'json',
    ...(await inspectJsonArtifact(source, {
      file: path.basename(resolved),
      bytes: raw.length,
      sha256: sha256File(raw),
      currentExtensionVersion: PROJECT_VERSION
    }))
  };
}

async function runFieldValidation(filenames) {
  if (!filenames.length) throw new Error('provide at least one telemetry JSON or digest file');
  const results = [];
  for (const filename of filenames) results.push(await inspectFile(filename));
  const jsonResults = results.filter((item) => item.kind === 'json');
  return {
    validatorVersion: 'field-validation@1.0.0',
    projectVersion: PROJECT_VERSION,
    currentGeneratorVersion: ProofTelemetry.GENERATOR_VERSION,
    fileCount: results.length,
    jsonGatePassed: jsonResults.length > 0 && jsonResults.every((item) => item.gatePassed),
    results
  };
}

async function main(argv = process.argv.slice(2)) {
  const summary = await runFieldValidation(argv);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.jsonGatePassed) process.exitCode = 1;
}

module.exports = {
  versionBefore,
  expectedMigrationFindings,
  explainSourceError,
  summarizeFindings,
  analyzeDigestText,
  inspectJsonArtifact,
  inspectFile,
  runFieldValidation
};

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

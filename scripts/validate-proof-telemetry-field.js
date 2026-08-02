#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Comparator = require('../shared/proof-telemetry-semantic-comparator.js');
const { validateArtifact, validateCanonicalEvidence, validateContainer } = require('./validate-proof-telemetry.js');

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

function explainSourceError(error, extensionVersion) {
  const message = String(error?.message || '');
  if (versionBefore(extensionVersion, '2.81.226')
    && (['RUN_COMPLETENESS', 'SNAPSHOT_COMPLETENESS'].includes(error?.code)
      || (error?.code === 'JSON_SCHEMA' && /snapshotCompleteness|exportAudit.*completeness/.test(message)))) {
    return 'artifact predates active-run completeness contract (2.81.226)';
  }
  if (versionBefore(extensionVersion, '2.81.228') && error?.code === 'S22') {
    return 'artifact predates exact stateAxesProvenance contract (2.81.228)';
  }
  return null;
}

function summarizeFindings(items, extensionVersion) {
  const grouped = {};
  (items || []).forEach((item) => {
    const key = String(item.code || 'UNKNOWN');
    if (!grouped[key]) grouped[key] = { count: 0, explanation: explainSourceError(item, extensionVersion) };
    grouped[key].count += 1;
    if (!grouped[key].explanation) grouped[key].explanation = explainSourceError(item, extensionVersion);
  });
  return grouped;
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
  const explained = summarizeFindings(sourceValidation.errors, extensionVersion);
  const unexplainedSourceErrorCodes = Object.entries(explained)
    .filter(([, value]) => !value.explanation)
    .map(([code]) => code);
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
      errors: explained,
      warningCodes: [...new Set((sourceValidation.warnings || []).map((item) => item.code))].sort(),
      unexplainedErrorCodes: unexplainedSourceErrorCodes
    },
    reinterpretation: {
      mode: source?.sharedConfig?.generatorVersion === ProofTelemetry.GENERATOR_VERSION
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
      currentExtensionVersion: '2.81.235'
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

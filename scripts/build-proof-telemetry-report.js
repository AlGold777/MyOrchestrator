#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('../shared/proof-telemetry-policy.js');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');
const {
  validateArtifact,
  validateContainer,
  validateStandaloneReport
} = require('./validate-proof-telemetry.js');

function parseArgs(argv) {
  const options = {};
  argv.forEach((argument) => {
    if (!argument.startsWith('--')) {
      if (!options.filename) options.filename = argument;
      else throw new Error(`unexpected positional argument: ${argument}`);
      return;
    }
    const [key, ...parts] = argument.slice(2).split('=');
    const value = parts.length ? parts.join('=') : true;
    options[key] = value;
  });
  return options;
}

function inputDescriptor(artifact) {
  if (artifact?.containerType === 'canonical-evidence') {
    return {
      kind: 'canonical-evidence',
      events: artifact?.ledger?.events || [],
      exportId: artifact.exportId,
      artifactHash: artifact?.integrity?.hashes?.artifact || null,
      ledgerHash: artifact?.ledger?.ledgerHash || null,
      generatorVersion: artifact?.sharedConfig?.generatorVersion || null,
      registryHash: artifact?.integrity?.hashes?.registry || null,
      extensionVersion: artifact?.sharedConfig?.extensionVersion || 'unknown'
    };
  }
  if (artifact?.containerType === 'all-presets') {
    return {
      kind: 'all-presets',
      events: artifact?.ledger?.events || [],
      exportId: artifact.exportId,
      artifactHash: artifact?.exportAudit?.hashes?.container || null,
      ledgerHash: artifact?.ledger?.ledgerHash || null,
      generatorVersion: artifact?.sharedConfig?.generatorVersion || null,
      registryHash: artifact?.reports?.[ProofTelemetry.REPORT_TYPES[0]]?.reportDescriptor?.dependencyRegistryHash || null,
      extensionVersion: artifact?.sharedConfig?.extensionVersion || 'unknown'
    };
  }
  throw new Error('UNSUPPORTED_CONTAINER: expected canonical-evidence or all-presets');
}

function incidentList(events) {
  return Incidents.indexIncidents(events).map((incident) => {
    const scoped = events.filter((event) => Incidents.exactScope(event, incident.scope));
    return {
      incidentId: incident.incidentId,
      modelId: incident.scope.modelId,
      runSessionId: incident.scope.runSessionId,
      runGeneration: incident.scope.runGeneration,
      dispatchId: incident.scope.dispatchId,
      generationEpoch: incident.scope.generationEpoch,
      firstSeq: scoped[0]?.seq || 0,
      lastSeq: scoped[scoped.length - 1]?.seq || 0
    };
  });
}

function selectIncident(incidents, { incident, model }) {
  const matches = incidents.filter((item) => (!incident || item.incidentId === incident)
    && (!model || item.modelId.toLowerCase() === String(model).toLowerCase()));
  if (!matches.length) throw new Error('INCIDENT_NOT_FOUND: no incident matches the requested filters');
  if (matches.length > 1) throw new Error(`AMBIGUOUS_INCIDENT: ${matches.length} incidents match; pass --incident=<id>`);
  return matches[0];
}

function sourceProvenance(descriptor, reproductionMode, selection = null, reportType = null) {
  const provenance = {
    sourceContainerType: descriptor.kind,
    sourceExportId: descriptor.exportId,
    sourceArtifactHash: descriptor.artifactHash,
    sourceLedgerHash: descriptor.ledgerHash,
    registryHash: descriptor.registryHash,
    generatorVersion: descriptor.generatorVersion,
    reproductionMode
  };
  if (selection && reportType) {
    provenance.cacheKey = {
      sourceLedgerHash: descriptor.ledgerHash,
      registryHash: descriptor.registryHash,
      generatorVersion: descriptor.generatorVersion,
      reportVersion: ProofTelemetry.REPORT_VERSION,
      reportType,
      incidentId: selection.incidentId,
      modelId: selection.modelId,
      reproductionMode
    };
  }
  return provenance;
}

function writeOutput(filename, value, sourceFilename) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!filename) {
    process.stdout.write(serialized);
    return;
  }
  const resolved = path.resolve(filename);
  if (resolved === path.resolve(sourceFilename)) throw new Error('OUTPUT_OVERWRITES_SOURCE: choose a different --out path');
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, serialized, { flag: 'wx' });
  fs.renameSync(temporary, resolved);
}

function assertOutputValidation(validation) {
  const diagnosticLimitations = new Set(['S06', 'S15']);
  const blocking = (validation?.errors || []).filter((error) => !diagnosticLimitations.has(error.code));
  if (blocking.length) throw new Error(`OUTPUT_VALIDATION_FAILED: ${blocking.map((item) => item.code).join(',')}`);
  return validation;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.filename) throw new Error('usage: build-proof-telemetry-report.js <telemetry.json> --list-incidents | --task=<task> [--model=<model>|--incident=<id>] | --all');
  const sourceFilename = path.resolve(options.filename);
  const artifact = JSON.parse(fs.readFileSync(sourceFilename, 'utf8'));
  const descriptor = inputDescriptor(artifact);
  const validation = await validateArtifact(artifact);
  const requestedMode = String(options.reproduction || 'exact-reproduction');
  if (!['exact-reproduction', 'reinterpretation'].includes(requestedMode)) throw new Error(`unsupported reproduction mode: ${requestedMode}`);
  const compatibilityErrors = validation.errors.filter((error) => error.code === 'REPRODUCTION_UNSUPPORTED');
  const blockingErrors = validation.errors.filter((error) => error.code !== 'REPRODUCTION_UNSUPPORTED');
  if (blockingErrors.length || (compatibilityErrors.length && requestedMode !== 'reinterpretation')) {
    const error = new Error(`SOURCE_VALIDATION_FAILED: ${validation.errors.map((item) => `${item.code}:${item.message}`).join('; ')}`);
    error.validation = validation;
    throw error;
  }
  const reproductionMode = compatibilityErrors.length ? 'reinterpretation' : 'exact-reproduction';
  const incidents = incidentList(descriptor.events);
  if (options['list-incidents']) {
    return { kind: descriptor.kind, reproductionMode, incidentCount: incidents.length, incidents };
  }
  const exportedAt = Number(options['exported-at'] || Date.now());
  if (options.all) {
    const output = await ProofTelemetry.buildAllPresets(descriptor.events, {
      canonicalLedger: true,
      exportedAt,
      extensionVersion: descriptor.extensionVersion,
      sourceProvenance: sourceProvenance(descriptor, reproductionMode)
    });
    const outputValidation = await validateContainer(output);
    assertOutputValidation(outputValidation);
    return output;
  }
  const reportType = String(options.task || '');
  if (!ProofTelemetry.REPORT_TYPES.includes(reportType)) throw new Error(`unsupported or missing --task: ${reportType || '(empty)'}`);
  const selection = selectIncident(incidents, { incident: options.incident, model: options.model });
  const output = await ProofTelemetry.buildStandaloneReport(descriptor.events, {
    canonicalLedger: true,
    exportedAt,
    extensionVersion: descriptor.extensionVersion,
    reportType,
    modelId: selection.modelId,
    incidentId: selection.incidentId,
    sourceProvenance: sourceProvenance(descriptor, reproductionMode, selection, reportType)
  });
  const outputValidation = await validateStandaloneReport(output);
  assertOutputValidation(outputValidation);
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = await run(process.argv.slice(2));
  writeOutput(options.out === true ? null : options.out, output, options.filename);
}

module.exports = { parseArgs, inputDescriptor, incidentList, selectIncident, sourceProvenance, assertOutputValidation, run, writeOutput };
if (require.main === module) main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

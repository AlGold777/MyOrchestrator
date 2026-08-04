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

const NON_BLOCKING_DIAGNOSTIC_CODES = new Set(['S06', 'S15']);
const REQUESTABLE_REPRODUCTION_MODES = Object.freeze([
  'exact-reproduction',
  'legacy-reproduction',
  'reinterpretation'
]);
// A legacy mode is truthful only when its historical generator is still
// executable. Register adapters here; never route it through current policy.
const LEGACY_REPRODUCTION_ADAPTERS = Object.freeze([]);

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
      reportVersions: [artifact?.sharedConfig?.reportVersion].filter(Boolean),
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
      reportVersions: Array.from(new Set(ProofTelemetry.REPORT_TYPES
        .map((reportType) => artifact?.reports?.[reportType]?.reportDescriptor?.reportVersion)
        .filter(Boolean))).sort(),
      registryHash: artifact?.reports?.[ProofTelemetry.REPORT_TYPES[0]]?.reportDescriptor?.dependencyRegistryHash || null,
      extensionVersion: artifact?.sharedConfig?.extensionVersion || 'unknown'
    };
  }
  throw new Error('UNSUPPORTED_CONTAINER: expected canonical-evidence or all-presets');
}

async function reproductionCompatibility(descriptor) {
  const currentRegistryHash = await ProofTelemetry.sha256(ProofTelemetry.dependencyRegistrySnapshot());
  const reasons = [];
  if (descriptor.generatorVersion !== ProofTelemetry.GENERATOR_VERSION) {
    reasons.push(`generator ${descriptor.generatorVersion || 'missing'} != ${ProofTelemetry.GENERATOR_VERSION}`);
  }
  if (descriptor.registryHash !== currentRegistryHash) {
    reasons.push(`registry ${descriptor.registryHash || 'missing'} != ${currentRegistryHash}`);
  }
  if (descriptor.reportVersions.length !== 1 || descriptor.reportVersions[0] !== ProofTelemetry.REPORT_VERSION) {
    reasons.push(`report versions ${descriptor.reportVersions.join(',') || 'missing'} != ${ProofTelemetry.REPORT_VERSION}`);
  }
  const legacyAdapter = LEGACY_REPRODUCTION_ADAPTERS.find((adapter) => adapter.matches(descriptor)) || null;
  return {
    exactSupported: reasons.length === 0,
    legacySupported: Boolean(legacyAdapter),
    legacyAdapter,
    reasons,
    currentRegistryHash
  };
}

function reproductionError(message) {
  const error = new Error(`REPRODUCTION_UNSUPPORTED: ${message}`);
  error.code = 'REPRODUCTION_UNSUPPORTED';
  error.reproductionMode = 'unsupported';
  return error;
}

function resolveReproductionMode(requestedMode, compatibility, validationErrors = []) {
  if (!REQUESTABLE_REPRODUCTION_MODES.includes(requestedMode)) {
    throw reproductionError(`unknown requested mode ${requestedMode}`);
  }
  if (requestedMode === 'reinterpretation') return { mode: 'reinterpretation', adapter: null };
  if (requestedMode === 'legacy-reproduction') {
    if (compatibility.legacySupported) return { mode: 'legacy-reproduction', adapter: compatibility.legacyAdapter };
    throw reproductionError('no registered legacy adapter matches the source generator, report version and registry');
  }
  const compatibilityErrors = validationErrors.filter((error) => error.code === 'REPRODUCTION_UNSUPPORTED');
  if (!compatibility.exactSupported || compatibilityErrors.length) {
    const reasons = [...compatibility.reasons, ...compatibilityErrors.map((error) => error.message)].filter(Boolean);
    throw reproductionError(reasons.join('; ') || 'source toolchain identity does not match');
  }
  return { mode: 'exact-reproduction', adapter: null };
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

function sourceProvenance(descriptor, reproductionMode, selection = null, reportType = null, diagnosticLimitations = []) {
  const provenance = {
    sourceContainerType: descriptor.kind,
    sourceExportId: descriptor.exportId,
    sourceArtifactHash: descriptor.artifactHash,
    sourceLedgerHash: descriptor.ledgerHash,
    registryHash: descriptor.registryHash,
    generatorVersion: descriptor.generatorVersion,
    reproductionMode
  };
  if (diagnosticLimitations.length) provenance.diagnosticLimitations = diagnosticLimitations;
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
  const errors = validation?.errors || [];
  const blocking = errors.filter((error) => !NON_BLOCKING_DIAGNOSTIC_CODES.has(error.code));
  if (blocking.length) throw new Error(`OUTPUT_VALIDATION_FAILED: ${blocking.map((item) => item.code).join(',')}`);
  return errors.filter((error) => NON_BLOCKING_DIAGNOSTIC_CODES.has(error.code)).map((error) => ({
    code: error.code,
    eventId: error.eventId || null,
    message: error.message
  }));
}

function diagnosticLimitations(output) {
  return output?.manifest?.sourceArtifact?.diagnosticLimitations
    || output?.crossReportCompatibility?.sourceArtifact?.diagnosticLimitations
    || [];
}

function writeDiagnosticLimitations(output, stream = process.stderr) {
  diagnosticLimitations(output).forEach((limitation) => {
    stream.write(`[telemetry limitation] ${limitation.code}: ${limitation.message}\n`);
  });
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.filename) throw new Error('usage: build-proof-telemetry-report.js <telemetry.json> --list-incidents | --task=<task> [--model=<model>|--incident=<id>] | --all');
  const sourceFilename = path.resolve(options.filename);
  const artifact = JSON.parse(fs.readFileSync(sourceFilename, 'utf8'));
  const descriptor = inputDescriptor(artifact);
  const validation = await validateArtifact(artifact);
  const compatibility = await reproductionCompatibility(descriptor);
  const requestedMode = String(options.reproduction || 'exact-reproduction');
  const blockingErrors = validation.errors.filter((error) => error.code !== 'REPRODUCTION_UNSUPPORTED');
  if (blockingErrors.length) {
    const error = new Error(`SOURCE_VALIDATION_FAILED: ${blockingErrors.map((item) => `${item.code}:${item.message}`).join('; ')}`);
    error.validation = validation;
    throw error;
  }
  const resolution = resolveReproductionMode(requestedMode, compatibility, validation.errors);
  if (resolution.adapter) return resolution.adapter.run({ artifact, descriptor, options });
  const reproductionMode = resolution.mode;
  const incidents = incidentList(descriptor.events);
  if (options['list-incidents']) {
    return { kind: descriptor.kind, reproductionMode, incidentCount: incidents.length, incidents };
  }
  const exportedAt = Number(options['exported-at'] || Date.now());
  if (options.all) {
    const build = (limitations = []) => ProofTelemetry.buildAllPresets(descriptor.events, {
      canonicalLedger: true,
      exportedAt,
      extensionVersion: descriptor.extensionVersion,
      sourceProvenance: sourceProvenance(descriptor, reproductionMode, null, null, limitations)
    });
    let output = await build();
    let limitations = assertOutputValidation(await validateContainer(output));
    if (limitations.length) {
      output = await build(limitations);
      limitations = assertOutputValidation(await validateContainer(output));
    }
    return output;
  }
  const reportType = String(options.task || '');
  if (!ProofTelemetry.REPORT_TYPES.includes(reportType)) throw new Error(`unsupported or missing --task: ${reportType || '(empty)'}`);
  const selection = selectIncident(incidents, { incident: options.incident, model: options.model });
  const build = (limitations = []) => ProofTelemetry.buildStandaloneReport(descriptor.events, {
    canonicalLedger: true,
    exportedAt,
    extensionVersion: descriptor.extensionVersion,
    reportType,
    modelId: selection.modelId,
    incidentId: selection.incidentId,
    sourceProvenance: sourceProvenance(descriptor, reproductionMode, selection, reportType, limitations)
  });
  let output = await build();
  let limitations = assertOutputValidation(await validateStandaloneReport(output));
  if (limitations.length) {
    output = await build(limitations);
    limitations = assertOutputValidation(await validateStandaloneReport(output));
  }
  return output;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = await run(process.argv.slice(2));
  writeDiagnosticLimitations(output);
  writeOutput(options.out === true ? null : options.out, output, options.filename);
}

module.exports = { REQUESTABLE_REPRODUCTION_MODES, LEGACY_REPRODUCTION_ADAPTERS, parseArgs, inputDescriptor, reproductionCompatibility, resolveReproductionMode, incidentList, selectIncident, sourceProvenance, assertOutputValidation, diagnosticLimitations, writeDiagnosticLimitations, run, writeOutput };
if (require.main === module) main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';

const { performance } = require('perf_hooks');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { validateCanonicalEvidence } = require('./validate-proof-telemetry.js');

const EVENT_COUNTS = Object.freeze([500, 2000, 5000, 10000]);
const BUILD_DEADLINE_MS = 20000;
const MEMORY_DELTA_LIMIT_BYTES = 768 * 1024 * 1024;

const runtimeEvent = (label, ts, meta = {}) => ({
  ts,
  type: 'TELEMETRY',
  label,
  level: 'info',
  platform: 'GPT',
  meta: {
    llmName: 'GPT',
    runSessionId: 42,
    dispatchId: 'GPT:42:1',
    generationEpoch: 1,
    ...meta
  }
});

function buildStressLedger(eventCount) {
  const base = ProofTelemetry.buildLedger([
    runtimeEvent('ANSWER_GENERATING', 1000, { textLength: 1 })
  ], { runSessionId: 42, exportedAt: 20000 })[0];
  return Array.from({ length: eventCount }, (_, index) => ({
    ...base,
    eventId: `stress-event-${String(index + 1).padStart(5, '0')}`,
    seq: index + 1,
    ingestSeq: index + 1,
    wallTs: 1000 + index,
    clock: { ...base.clock, ingestMonoMs: index + 1 },
    payload: {
      ...base.payload,
      metadata: { ...base.payload.metadata, textLength: index + 1 }
    }
  }));
}

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

async function timedBuild(name, builder, ledger, exportedAt) {
  const stages = [];
  const startedAt = performance.now();
  const artifact = await builder(ledger, {
    canonicalLedger: true,
    runSessionId: 42,
    exportedAt,
    extensionVersion: 'stress-gate',
    snapshotConsistency: 'queue_drained',
    onProgress: (stage) => stages.push(stage)
  });
  const elapsedMs = performance.now() - startedAt;
  if (elapsedMs > BUILD_DEADLINE_MS) throw new Error(`${name} exceeded ${BUILD_DEADLINE_MS} ms: ${elapsedMs.toFixed(1)} ms`);
  if (artifact?.ledger?.events?.length !== ledger.length) throw new Error(`${name} did not preserve the complete ledger`);
  if (!stages.includes('incident-index') || !stages.includes('hashes') || !stages.includes('finalizing')) {
    throw new Error(`${name} did not report all mandatory progress stages`);
  }
  return { artifact, elapsedMs, bytes: byteLength(artifact), stages };
}

async function runStressGates({ eventCounts = EVENT_COUNTS } = {}) {
  const summary = {
    limits: { buildDeadlineMs: BUILD_DEADLINE_MS, memoryDeltaBytes: MEMORY_DELTA_LIMIT_BYTES },
    performance: [],
    recovery: {},
    concurrent: {},
    memoryPressure: {}
  };

  for (const eventCount of eventCounts) {
    const ledger = buildStressLedger(eventCount);
    const inputHashBefore = await ProofTelemetry.sha256(ledger);
    const canonical = await timedBuild(
      `canonical-evidence/${eventCount}`,
      ProofTelemetry.buildCanonicalEvidence,
      ledger,
      20000 + eventCount
    );
    const full = await timedBuild(
      `full-forensic/${eventCount}`,
      ProofTelemetry.buildAllPresets,
      ledger,
      30000 + eventCount
    );
    const inputHashAfter = await ProofTelemetry.sha256(ledger);
    if (inputHashAfter !== inputHashBefore) throw new Error(`builders mutated the ${eventCount}-event input ledger`);
    if (canonical.bytes >= full.bytes) throw new Error(`canonical evidence is not smaller than full forensic at ${eventCount} events`);
    summary.performance.push({
      eventCount,
      canonical: { elapsedMs: Number(canonical.elapsedMs.toFixed(1)), bytes: canonical.bytes },
      full: { elapsedMs: Number(full.elapsedMs.toFixed(1)), bytes: full.bytes },
      canonicalReductionPercent: Number(((1 - canonical.bytes / full.bytes) * 100).toFixed(1))
    });
  }

  const concurrentLedger = buildStressLedger(2000);
  const concurrentHashBefore = await ProofTelemetry.sha256(concurrentLedger);
  const concurrentStartedAt = performance.now();
  const concurrentArtifacts = await Promise.all(Array.from({ length: 3 }, () => ProofTelemetry.buildCanonicalEvidence(concurrentLedger, {
    canonicalLedger: true,
    runSessionId: 42,
    exportedAt: 42000,
    extensionVersion: 'stress-gate',
    snapshotConsistency: 'queue_drained'
  })));
  const concurrentHashes = concurrentArtifacts.map((artifact) => artifact.integrity.hashes.artifact);
  if (new Set(concurrentHashes).size !== 1) throw new Error('concurrent canonical exports are not deterministic');
  if (await ProofTelemetry.sha256(concurrentLedger) !== concurrentHashBefore) throw new Error('concurrent exports mutated their shared ledger');
  summary.concurrent = {
    exportCount: concurrentArtifacts.length,
    eventCount: concurrentLedger.length,
    elapsedMs: Number((performance.now() - concurrentStartedAt).toFixed(1)),
    deterministic: true
  };

  const malformed = buildStressLedger(4);
  malformed[2].seq = malformed[1].seq;
  let malformedRejected = false;
  try {
    await ProofTelemetry.buildCanonicalEvidence(malformed, { canonicalLedger: true, exportedAt: 50000 });
  } catch (error) {
    malformedRejected = /valid ledger/i.test(String(error?.message || error));
  }
  if (!malformedRejected) throw new Error('malformed canonical ledger was not rejected');

  const validSmall = await ProofTelemetry.buildCanonicalEvidence(buildStressLedger(8), {
    canonicalLedger: true,
    runSessionId: 42,
    exportedAt: 51000,
    extensionVersion: 'stress-gate',
    snapshotConsistency: 'queue_drained'
  });
  const missingRegistry = JSON.parse(JSON.stringify(validSmall));
  delete missingRegistry.dependencyRegistry;
  const missingRegistryValidation = await validateCanonicalEvidence(missingRegistry, { verifyArtifactHash: false });
  if (missingRegistryValidation.valid
    || !missingRegistryValidation.errors.some((error) => ['JSON_SCHEMA', 'HASH_MISMATCH', 'REPRODUCTION_UNSUPPORTED'].includes(error.code))) {
    throw new Error('missing dependency registry was not detected');
  }
  summary.recovery = {
    malformedLedgerRejected: true,
    missingRegistryRejected: true,
    missingRegistryErrorCodes: [...new Set(missingRegistryValidation.errors.map((error) => error.code))].sort()
  };

  const pressure = new Uint8Array(32 * 1024 * 1024);
  pressure[0] = 1;
  pressure[pressure.length - 1] = 1;
  const rssBefore = process.memoryUsage().rss;
  const pressureResult = await timedBuild(
    'canonical-evidence/memory-pressure',
    ProofTelemetry.buildCanonicalEvidence,
    buildStressLedger(5000),
    52000
  );
  const rssDelta = Math.max(0, process.memoryUsage().rss - rssBefore);
  if (rssDelta > MEMORY_DELTA_LIMIT_BYTES) throw new Error(`memory pressure gate exceeded ${MEMORY_DELTA_LIMIT_BYTES} bytes`);
  summary.memoryPressure = {
    reservedBytes: pressure.length,
    rssDeltaBytes: rssDelta,
    elapsedMs: Number(pressureResult.elapsedMs.toFixed(1)),
    artifactBytes: pressureResult.bytes,
    completeLedgerPreserved: pressureResult.artifact.ledger.eventCount === 5000
  };

  return summary;
}

if (require.main === module) {
  runStressGates()
    .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = { EVENT_COUNTS, BUILD_DEADLINE_MS, MEMORY_DELTA_LIMIT_BYTES, buildStressLedger, runStressGates };

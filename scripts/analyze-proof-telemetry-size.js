#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const stable = (value) => ProofTelemetry.stableStringify(value);

function increment(map, key, bytes = 0) {
  const current = map.get(key) || { count: 0, bytes: 0 };
  current.count += 1;
  current.bytes += bytes;
  map.set(key, current);
}

function duplicateSummary(events) {
  const exact = new Map();
  const semantic = new Map();
  (events || []).forEach((event) => {
    const payload = event?.payload || {};
    increment(exact, stable(payload), byteLength(payload));
    increment(semantic, stable({ eventType: event.eventType, modelId: event.modelId, payload }), byteLength(event));
  });
  const summarize = (map) => Array.from(map.entries())
    .filter(([, value]) => value.count > 1)
    .map(([fingerprint, value]) => ({
      fingerprint: `fnv1a:${ProofTelemetry.eventFingerprint(fingerprint)}`,
      copies: value.count,
      redundantCopies: value.count - 1,
      bytesAcrossCopies: value.bytes
    }))
    .sort((left, right) => right.bytesAcrossCopies - left.bytesAcrossCopies);
  const exactPayloadRepeats = summarize(exact);
  const semanticEventRepeats = summarize(semantic);
  return {
    exactPayloadRepeatGroups: exactPayloadRepeats.length,
    exactPayloadRedundantCopies: exactPayloadRepeats.reduce((sum, item) => sum + item.redundantCopies, 0),
    semanticEventRepeatGroups: semanticEventRepeats.length,
    semanticEventRedundantCopies: semanticEventRepeats.reduce((sum, item) => sum + item.redundantCopies, 0),
    exactPayloadRepeats,
    semanticEventRepeats
  };
}

function analyzeContainer(container) {
  const events = Array.isArray(container?.ledger?.events) ? container.ledger.events : [];
  const sections = Object.fromEntries(Object.entries(container || {}).map(([key, value]) => [key, byteLength(value)]));
  const byEventType = new Map();
  events.forEach((event) => increment(byEventType, event.eventType || 'UNKNOWN', byteLength(event)));
  const eventTypeBytes = Object.fromEntries(Array.from(byEventType.entries()).sort((left, right) => right[1].bytes - left[1].bytes));
  const payloadBytes = events.reduce((sum, event) => sum + byteLength(event?.payload || {}), 0);
  const totalEventBytes = events.reduce((sum, event) => sum + byteLength(event), 0);
  const reportRefs = Object.values(container?.reports || {}).flatMap((report) => report?.eventSeqs || []);
  const refCounts = new Map();
  reportRefs.forEach((seq) => increment(refCounts, String(seq)));
  const leaseEvents = events.filter((event) => /^OBSERVATION_SLOT_/.test(event.eventType || ''));
  const producerCounts = {};
  events.forEach((event) => {
    const producer = String(event?.producer?.component || 'unknown');
    producerCounts[producer] = (producerCounts[producer] || 0) + 1;
  });
  return {
    analysisVersion: '1.0.0',
    artifact: {
      containerType: container?.containerType || 'unknown',
      schemaVersion: container?.schemaVersion || null,
      totalBytes: byteLength(container),
      eventCount: events.length
    },
    byteClasses: {
      sourceEvidenceBytes: sections.ledger || 0,
      derivedBytes: (sections.reports || 0) + (sections.derivedViews || 0),
      staticRegistryAndConfigBytes: sections.sharedConfig || sections.dependencyRegistry || 0,
      attachmentBytes: sections.attachments || 0,
      eventEnvelopeBytes: Math.max(0, totalEventBytes - payloadBytes),
      eventPayloadBytes: payloadBytes
    },
    sectionBytes: sections,
    eventTypeBytes,
    repeatedStructures: {
      observerHealthIntervals: eventTypeBytes.OBSERVER_HEALTH_INTERVAL_CLOSED || { count: 0, bytes: 0 },
      observationFrames: eventTypeBytes.OBSERVATION_FRAME_CAPTURED || { count: 0, bytes: 0 },
      observationSlotEvents: { count: leaseEvents.length, bytes: leaseEvents.reduce((sum, event) => sum + byteLength(event), 0) },
      reportEventReferences: {
        total: reportRefs.length,
        multiplyReferencedEvents: Array.from(refCounts.values()).filter((item) => item.count > 1).length
      },
      ...duplicateSummary(events)
    },
    streamCoverage: {
      byProducer: producerCounts,
      legacyAdapterEvents: producerCounts['legacy-telemetry-adapter'] || 0,
      nativeProofEvents: events.length - (producerCounts['legacy-telemetry-adapter'] || 0)
    },
    measurementOnly: true
  };
}

function loadInput(filename) {
  const absolute = path.resolve(filename);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

async function main(argv = process.argv.slice(2)) {
  const filename = argv.find((arg) => !arg.startsWith('--'))
    || path.join(__dirname, '..', 'docs', 'proof_oriented_telemetry_spec_v1', 'all-presets.example.json');
  const result = analyzeContainer(loadInput(filename));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ analyzeContainer, duplicateSummary, byteLength });

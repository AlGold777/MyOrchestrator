const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { analyzeContainer } = require('../scripts/analyze-proof-telemetry-size.js');
const { SCENARIOS, ledgerFor } = require('./fixtures/proof-telemetry-scenario-matrix.js');

describe('proof telemetry shared fixtures and measurements', () => {
  test('contains all thirteen required reproducible scenarios', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'full-success', 'cutted', 'false-success', 'old-answer', 'no-delivery',
      'prompt-not-inserted', 'prompt-not-sent', 'late-end', 'multiple-incidents',
      'active-run-export', 'busy-persistence-queue', 'service-worker-restart',
      'post-terminal-growth-without-terminal'
    ]);
  });

  test.each(SCENARIOS)('$id fixture builds an immutable canonical ledger', (scenario) => {
    const ledger = ledgerFor(scenario);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((event, index) => event.seq === index + 1 && event.schemaVersion === 6)).toBe(true);
    expect(new Set(ledger.map((event) => event.eventId))).toHaveProperty('size', ledger.length);
  });

  test('measurement separates source, derived and static bytes without changing the artifact', async () => {
    const ledger = ledgerFor(SCENARIOS[0]);
    const container = await ProofTelemetry.buildAllPresets(ledger, {
      canonicalLedger: true,
      exportedAt: 20000,
      extensionVersion: 'test'
    });
    const before = JSON.stringify(container);
    const result = analyzeContainer(container);
    expect(JSON.stringify(container)).toBe(before);
    expect(result.artifact.totalBytes).toBe(Buffer.byteLength(before, 'utf8'));
    expect(result.byteClasses.sourceEvidenceBytes).toBeGreaterThan(0);
    expect(result.byteClasses.derivedBytes).toBeGreaterThan(0);
    expect(result.byteClasses.staticRegistryAndConfigBytes).toBeGreaterThan(0);
    expect(result.eventTypeBytes.MODEL_TERMINAL_RECORDED.count).toBe(1);
    expect(result.measurementOnly).toBe(true);
  });

  test('measurement exposes exact and semantic repeated structures', async () => {
    const ledger = ledgerFor(SCENARIOS[0]);
    const duplicate = { ...ledger[0], eventId: 'duplicate-event', seq: ledger.length + 1, ingestSeq: ledger.length + 1 };
    const container = await ProofTelemetry.buildAllPresets([...ledger, duplicate], {
      canonicalLedger: true,
      exportedAt: 20000
    });
    const result = analyzeContainer(container);
    expect(result.repeatedStructures.exactPayloadRedundantCopies).toBeGreaterThanOrEqual(1);
    expect(result.repeatedStructures.semanticEventRedundantCopies).toBeGreaterThanOrEqual(1);
    expect(result.repeatedStructures.exactPayloadRepeats.some((item) => item.redundantCopies >= 1)).toBe(true);
    expect(result.repeatedStructures.semanticEventRepeats.some((item) => item.redundantCopies >= 1)).toBe(true);
  });
});

const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { buildStressLedger, runStressGates } = require('../scripts/run-proof-telemetry-stress.js');

describe('proof telemetry stress gates', () => {
  test('builders expose progress without changing the observed ledger', async () => {
    const ledger = buildStressLedger(24);
    const before = await ProofTelemetry.sha256(ledger);
    const stages = [];
    await ProofTelemetry.buildAllPresets(ledger, {
      canonicalLedger: true,
      exportedAt: 20000,
      onProgress: (stage) => stages.push(stage)
    });
    expect(stages).toEqual([
      'incident-index',
      'derived-views',
      ...ProofTelemetry.REPORT_TYPES.map((type) => `report:${type}`),
      'hashes',
      'attachments',
      'finalizing'
    ]);
    expect(await ProofTelemetry.sha256(ledger)).toBe(before);
  });

  test('the executable gate covers a representative 500-event boundary', async () => {
    const summary = await runStressGates({ eventCounts: [500] });
    expect(summary.performance[0]).toEqual(expect.objectContaining({ eventCount: 500 }));
    expect(summary.concurrent).toEqual(expect.objectContaining({ exportCount: 3, deterministic: true }));
    expect(summary.recovery).toEqual(expect.objectContaining({
      malformedLedgerRejected: true,
      missingRegistryRejected: true
    }));
    expect(summary.memoryPressure.completeLedgerPreserved).toBe(true);
  }, 30000);
});

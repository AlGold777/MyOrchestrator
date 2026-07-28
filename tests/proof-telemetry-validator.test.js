const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const { validateContainer, validateStandaloneReport, reconstructAtSeq, privacyViolations } = require('../scripts/validate-proof-telemetry.js');

const evt = (label, ts, meta = {}) => ({
  ts,
  label,
  platform: 'GPT',
  meta: { runSessionId: 42, dispatchId: 'GPT:42:1', ...meta }
});

async function validContainer() {
  const ledger = ProofTelemetry.buildLedger([
    evt('DISPATCH_SEND', 1000),
    evt('PROMPT_SUBMITTED_ACCEPTED', 1100),
    evt('ANSWER_START_DETECTED', 1200, { textLength: 10 }),
    evt('ANSWER_GENERATING', 1300, { textLength: 100, textHash: 'hash:a' })
  ], { runSessionId: 42 });
  return ProofTelemetry.buildAllPresets(ledger, {
    canonicalLedger: true,
    runSessionId: 42,
    exportedAt: 2000,
    extensionVersion: 'test'
  });
}

describe('offline proof telemetry validator', () => {
  test('validates hashes, reports, boundary, privacy and replay', async () => {
    const container = await validContainer();
    const result = await validateContainer(container);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.reconstructedAxes.GPT.stateAxes.generationStart).toBe('started');
  });

  test('detects ledger tampering and stale container integrity', async () => {
    const container = await validContainer();
    container.ledger.events[0].payload.metadata.dispatchId = 'tampered';
    const result = await validateContainer(container);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HASH_MISMATCH' })
    ]));
  });

  test('reconstructs independent state at an arbitrary seq boundary', async () => {
    const container = await validContainer();
    const atSubmit = reconstructAtSeq(container.ledger.events, 2);
    const atGeneration = reconstructAtSeq(container.ledger.events, 4);
    expect(atSubmit.GPT.stateAxes.generationStart).toBe('not_started');
    expect(atGeneration.GPT.stateAxes.observedGeneration).toBe('active');
  });

  test('rejects forbidden raw content keys', () => {
    expect(privacyViolations({ payload: { rawDom: '<main>secret</main>' } }))
      .toEqual([expect.objectContaining({ code: 'PRIVACY_FORBIDDEN_KEY' })]);
  });

  test('rejects a recorded automatic decision that replay cannot reproduce', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('FINALIZATION_DECISION', 1000)
    ], { runSessionId: 42 });
    const policyEvent = ledger[0];
    ledger.push({
      schemaVersion: 5,
      eventId: 'ev-2-decision',
      eventType: 'DECISION_RECORDED',
      layer: 'decision',
      seq: 2,
      wallTs: 1000,
      monoMs: 0,
      runSessionId: '42',
      modelId: 'GPT',
      dispatchId: 'GPT:42:1',
      producer: { component: 'test', version: '1' },
      payload: { accepted: true, mode: 'automatic', evidenceTier: 0, blockers: [] },
      evidenceRefs: [policyEvent.eventId]
    });
    const container = await ProofTelemetry.buildAllPresets(ledger, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000
    });
    const result = await validateContainer(container);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REPLAY_MISMATCH' })
    ]));
  });

  test('validates a standalone task report independently', async () => {
    const container = await validContainer();
    const standalone = await ProofTelemetry.buildStandaloneReport(container.ledger.events, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000,
      modelId: 'GPT',
      reportType: 'generation-not-started'
    });
    const result = await validateStandaloneReport(standalone);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

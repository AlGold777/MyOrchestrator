const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Policy = require('../shared/proof-telemetry-policy.js');

const evt = (label, ts, meta = {}, details = '') => ({
  ts,
  label,
  details,
  platform: 'GPT',
  meta: { runSessionId: 42, dispatchId: 'GPT:42:1', llmName: 'GPT', ...meta }
});

describe('proof telemetry evidence and policy replay', () => {
  test('keeps timeout/forced terminal below automatic completion proof', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('DISPATCH_SEND', 1000),
      evt('PROMPT_SUBMITTED_ACCEPTED', 1100),
      evt('ANSWER_START_DETECTED', 1200, { textLength: 10 }),
      evt('ANSWER_GENERATING', 1300, { textLength: 100 }),
      evt('AUTOMATION_DEADLINE_REACHED', 2000, { answerLength: 100 })
    ], { runSessionId: 42 });
    const evaluation = Policy.evaluateFinalization(ledger, ledger[ledger.length - 1]);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.evidenceTier).toBeLessThan(3);
    expect(evaluation.blockers).toContain('minimum_evidence_tier');
    expect(evaluation.stateAxes.completionDetection).not.toBe('inferred_complete');
  });

  test('recognizes correlated provider terminal evidence as tier 4', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('DISPATCH_SEND', 1000),
      evt('PROMPT_SUBMITTED_ACCEPTED', 1100),
      evt('ANSWER_START_DETECTED', 1200),
      evt('PROVIDER_FINISH_REASON', 1300, { finishReason: 'stop' })
    ], { runSessionId: 42 });
    expect(Policy.evidenceTier(ledger, ledger[ledger.length - 1])).toBe(4);
  });

  test('does not promote generic completion and verification to tier 3', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('ANSWER_VERIFICATION_RECORDED', 1000, { verified: true }),
      evt('ANSWER_COMPLETE_DETECTED', 1100)
    ], { runSessionId: 42 });
    expect(Policy.evidenceTier(ledger, ledger[ledger.length - 1])).toBeLessThan(3);
  });

  test('requires current-dispatch identity for a strong UI transition', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('MULTIPLE_CANDIDATES_AMBIGUOUS', 1000, { answerIdentity: 'ambiguous' }),
      evt('STREAMING_TRUE_TO_FALSE', 1100)
    ], { runSessionId: 42 });
    expect(Policy.evidenceTier(ledger, ledger[ledger.length - 1])).toBeLessThan(3);
  });

  test('reports missing decision lineage on an unlinked terminal event', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('MODEL_FINAL', 1000, { finalStatus: 'SUCCESS' }, 'SUCCESS')
    ], { runSessionId: 42 });
    const replay = Policy.replay(ledger);
    expect(replay.invariantViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ invariantId: 'S06' })
    ]));
  });
});

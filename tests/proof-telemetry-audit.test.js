const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
require('../shared/proof-telemetry-policy.js');
const Audit = require('../shared/proof-telemetry-audit.js');

const canonical = (label, ts, meta = {}) => ProofTelemetry.buildLedger([{
  ts,
  label,
  platform: 'GPT',
  meta: { runSessionId: 42, dispatchId: 'GPT:42:1', ...meta }
}], { runSessionId: 42 })[0];

describe('proof telemetry post-terminal audit', () => {
  test('records pending audit evidence at terminal boundary', () => {
    const terminal = canonical('MODEL_FINAL', 1000, { answerLength: 100 });
    const plan = Audit.planAfterEvent(terminal, [terminal]);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'MISSING_EVIDENCE_RECORDED',
        payload: expect.objectContaining({ status: 'pending' })
      })
    ]));
  });

  test('creates forensic omission only on anomaly trigger', () => {
    const failure = canonical('SELECTOR_RESOLVE_FAIL', 1000, { selectorId: 'answer-root' });
    const plan = Audit.planAfterEvent(failure, [failure]);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED',
        payload: expect.objectContaining({
          attachmentType: 'selector-candidate-list',
          captureAvailable: false
        })
      })
    ]));
  });

  test('never audits a terminal against a later dispatch', () => {
    const terminal = canonical('MODEL_FINAL', 1000, { answerLength: 100 });
    const nextDispatch = canonical('ANSWER_GENERATING', 1100, {
      dispatchId: 'GPT:42:2',
      answerLength: 900
    });
    nextDispatch.seq = 2;
    nextDispatch.ingestSeq = 2;
    expect(Audit.planAfterEvent(nextDispatch, [terminal, nextDispatch])
      .some((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED')).toBe(false);
  });

  test('records unknown audit when neither length nor hash is comparable', () => {
    const terminal = canonical('MODEL_FINAL', 1000);
    const observation = canonical('ANSWER_GENERATING', 1100);
    observation.seq = 2;
    observation.ingestSeq = 2;
    const plan = Audit.planAfterEvent(observation, [terminal, observation]);
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'POST_TERMINAL_AUDIT_COMPLETED',
        payload: expect.objectContaining({
          acceptedLength: null,
          observedLength: null,
          growthChars: null,
          growthPct: null,
          conclusion: 'unknown',
          auditPossible: false
        })
      }),
      expect.objectContaining({
        eventType: 'MISSING_EVIDENCE_RECORDED',
        payload: expect.objectContaining({
          missingEvidence: 'post_terminal_comparable_measurement',
          status: 'unavailable'
        })
      })
    ]));
  });
});

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

  test('does not create an evidence-linked forensic event without incident identity', () => {
    const failure = canonical('SELECTOR_RESOLVE_FAIL', 1000, { selectorId: 'answer-root' });
    delete failure.dispatchId;
    expect(Audit.planAfterEvent(failure, [failure])
      .some((item) => item.eventType === 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED')).toBe(false);
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

  test('uses the configured post-terminal growth tolerance', () => {
    const terminal = canonical('MODEL_FINAL', 1000, { answerLength: 1000 });
    const below = canonical('ANSWER_GENERATING', 1100, { answerLength: 1004 });
    below.seq = 2;
    below.ingestSeq = 2;
    const belowAudit = Audit.planAfterEvent(below, [terminal, below])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(belowAudit.payload.growthPct).toBeCloseTo(0.4);
    expect(belowAudit.payload.conclusion).toBe('unknown');

    const above = canonical('ANSWER_GENERATING', 1200, { answerLength: 1006 });
    above.seq = 2;
    above.ingestSeq = 2;
    const aboveAudit = Audit.planAfterEvent(above, [terminal, above])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(aboveAudit.payload.growthPct).toBeCloseTo(0.6);
    expect(aboveAudit.payload.conclusion).toBe('contradicted');
  });

  test('refutes growth only after an explicit unchanged observation window closes', () => {
    const terminal = canonical('MODEL_FINAL', 1000, { answerLength: 100 });
    const openFrame = canonical('POST_TERMINAL_ANSWER_OBSERVED', 1100, {
      textLength: 100,
      observationWindowClosed: false
    });
    openFrame.seq = 2;
    openFrame.ingestSeq = 2;
    const pending = Audit.planAfterEvent(openFrame, [terminal, openFrame])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(pending.payload).toEqual(expect.objectContaining({ conclusion: 'unknown', auditPossible: true, growthChars: 0 }));

    const closed = canonical('POST_TERMINAL_ANSWER_WINDOW_CLOSED', 9000, {
      textLength: 100,
      observationWindowClosed: true,
      observationWindowOutcome: 'unchanged',
      observationCoverage: 'complete'
    });
    closed.seq = 3;
    closed.ingestSeq = 3;
    const complete = Audit.planAfterEvent(closed, [terminal, openFrame, closed])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(complete.payload).toEqual(expect.objectContaining({ conclusion: 'confirmed', auditPossible: true, growthChars: 0 }));
  });

  test('compares normalized recovery evidence only under the same normalization version', () => {
    const terminal = canonical('MODEL_FINAL', 1000, {
      normalizedLength: 100,
      normalizedHash: 'normalized:a',
      normalizationVersion: 'answer-proof-v1'
    });
    const recovered = canonical('ANSWER_SOURCE_MATERIALIZED', 1100, {
      normalizedLength: 150,
      normalizedHash: 'normalized:b',
      normalizationVersion: 'answer-proof-v1'
    });
    recovered.seq = 2;
    recovered.ingestSeq = 2;
    const audit = Audit.planAfterEvent(recovered, [terminal, recovered])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(audit.payload).toEqual(expect.objectContaining({
      conclusion: 'contradicted',
      growthChars: 50,
      measurementMode: 'normalized',
      normalizationVersion: 'answer-proof-v1',
      normalizationMismatch: false
    }));

    const incompatible = canonical('ANSWER_SOURCE_MATERIALIZED', 1200, {
      normalizedLength: 170,
      normalizedHash: 'normalized:c',
      normalizationVersion: 'answer-proof-v2'
    });
    incompatible.seq = 2;
    incompatible.ingestSeq = 2;
    const unknown = Audit.planAfterEvent(incompatible, [terminal, incompatible])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(unknown.payload).toEqual(expect.objectContaining({
      auditPossible: false,
      conclusion: 'unknown',
      normalizationMismatch: true
    }));
  });

  test('uses successful late collect evidence but ignores transport-only recovery visits', () => {
    const terminal = canonical('MODEL_FINAL', 1000, { answerLength: 100 });
    const lateCollect = canonical('LATE_COLLECT_DECISION_TRACE', 1100, { ok: true, textLength: 150, textHash: 'late:b' });
    lateCollect.seq = 2;
    lateCollect.ingestSeq = 2;
    expect(Audit.isRelevantPostTerminalObservation(lateCollect)).toBe(true);
    expect(Audit.planAfterEvent(lateCollect, [terminal, lateCollect])).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'POST_TERMINAL_AUDIT_COMPLETED', payload: expect.objectContaining({ growthChars: 50 }) })
    ]));

    const visit = {
      ...terminal,
      eventId: 'transport-only-recovery-visit',
      eventType: 'PAGE_CONTEXT_OBSERVED',
      seq: 2,
      ingestSeq: 2,
      payload: { sourceEventType: 'MATERIALIZE_RECOVERY_VISIT_RESULT', metadata: { didVisit: true } }
    };
    expect(Audit.isRelevantPostTerminalObservation(visit)).toBe(false);
    expect(Audit.planAfterEvent(visit, [terminal, visit]).some((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED')).toBe(false);
  });

  test('does not compare post-terminal evidence from another SPA navigation lineage', () => {
    const terminal = {
      ...canonical('MODEL_FINAL', 1000, { answerLength: 100 }),
      documentInstanceId: 'document-a',
      navigationEpoch: 1
    };
    const afterNavigation = {
      ...canonical('ANSWER_GENERATING', 1100, { answerLength: 180 }),
      seq: 2,
      ingestSeq: 2,
      documentInstanceId: 'document-a',
      navigationEpoch: 2
    };
    const audit = Audit.planAfterEvent(afterNavigation, [terminal, afterNavigation])
      .find((item) => item.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(audit.payload).toEqual(expect.objectContaining({
      auditPossible: false,
      conclusion: 'unknown',
      navigationLineage: 'mismatch',
      measurementMode: 'incomparable_navigation'
    }));
  });
});

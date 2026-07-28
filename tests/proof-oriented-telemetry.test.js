const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

const evt = (platform, label, ts, meta = {}, details = '') => ({
  ts,
  type: 'TELEMETRY',
  label,
  details,
  level: 'info',
  platform,
  meta: { llmName: platform, runSessionId: 42, dispatchId: `${platform}:42:1`, ...meta }
});

describe('Proof-oriented telemetry schema 5 export', () => {
  test('builds one immutable canonical ledger and all eight embedded reports', async () => {
    const container = await ProofTelemetry.buildAllPresets({
      '<GPT>': [
        evt('GPT', 'DISPATCH_BASELINE_CAPTURED', 1000),
        evt('GPT', 'DISPATCH_SEND', 1100),
        evt('GPT', 'PROMPT_SUBMITTED_ACCEPTED', 1200),
        evt('GPT', 'ANSWER_START_DETECTED', 1300, { textLength: 8 }),
        evt('GPT', 'ANSWER_GENERATING', 1400, { textLength: 80 }),
        evt('GPT', 'ANSWER_TEXT_STABLE', 1500, { textLength: 120 }),
        evt('GPT', 'ANSWER_VERIFICATION_RECORDED', 1600, { textLength: 120, verified: true }),
        evt('GPT', 'ANSWER_COMPLETE_DETECTED', 1700, { textLength: 120 }),
        evt('GPT', 'FINALIZATION_DECISION', 1800, { finalStatus: 'SUCCESS' }, 'SUCCESS:accepted'),
        evt('GPT', 'MODEL_FINAL', 1900, { finalStatus: 'SUCCESS', answerLen: 120 })
      ]
    }, { runSessionId: 42, exportedAt: 2000, extensionVersion: '2.81.124' });

    expect(container.schemaVersion).toBe('5.0');
    expect(container.containerType).toBe('all-presets');
    expect(Object.keys(container.reports)).toEqual(ProofTelemetry.REPORT_TYPES);
    expect(container.ledger.eventCount).toBe(10);
    expect(container.ledger.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(container.ledger.events.map((event) => event.eventId)).size).toBe(10);
    expect(container.ledger.events.every((event) => event.schemaVersion === 5)).toBe(true);
    expect(container.exportAudit.invariantViolations).toEqual([]);
    expect(container.exportAudit.hashes.ledger).toMatch(/^sha256:/);
    expect(container.reports['true-completion'].eventRefs.length).toBeGreaterThan(0);
    expect(container.reports['true-completion']).not.toHaveProperty('materializedEvents');
  });

  test('keeps completion, forced terminal and completeness as independent axes', async () => {
    const container = await ProofTelemetry.buildAllPresets({
      '<Grok>': [
        evt('Grok', 'DISPATCH_SEND', 1000),
        evt('Grok', 'PROMPT_SUBMITTED_ACCEPTED', 1100),
        evt('Grok', 'ANSWER_START_DETECTED', 1200, { textLength: 20 }),
        evt('Grok', 'ANSWER_GENERATING', 1300, { textLength: 100 }),
        evt('Grok', 'AUTOMATION_DEADLINE_REACHED', 2000, { answerLength: 100 }),
        evt('Grok', 'ROUND4_FORCE_FINAL', 2100, { answerLength: 100 }),
        evt('Grok', 'MODEL_FINAL', 2200, { finalStatus: 'SUCCESS', answerLen: 100 })
      ]
    }, { runSessionId: 42, exportedAt: 2300 });

    const axes = container.derivedViews['model-timeline'].data.Grok.stateAxes;
    expect(axes.terminalMode).toBe('forced');
    expect(axes.completionDetection).toBe('inconclusive');
    expect(axes.answerCompleteness).toBe('unknown');
    expect(axes.completionEvidenceTier).toBe(1);
    expect(container.reports['forced-success'].siblings.some((rule) => rule.evaluation.matched)).toBe(true);
  });

  test('does not serialize prompt, answer, token or arbitrary details', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('Claude', 'DISPATCH_SEND', 1000, {
        prompt: 'private prompt',
        answerText: 'private answer',
        apiToken: 'secret',
        answerLength: 14,
        promptHash: 'sha256:safe'
      }, 'also private')
    ], { runSessionId: 42 });
    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toContain('private prompt');
    expect(serialized).not.toContain('private answer');
    expect(serialized).not.toContain('also private');
    expect(serialized).not.toContain('secret');
    expect(serialized).toContain('answerLength');
    expect(serialized).toContain('promptHash');
    expect(ledger[0].payload.detailsLength).toBe(12);
  });

  test('evaluates requestIf predicates deterministically', () => {
    expect(ProofTelemetry.evaluatePredicate(
      { derivedViews: { completionEvidenceTier: 1 } },
      { path: '$.derivedViews.completionEvidenceTier', operator: 'lt', value: 3 }
    )).toEqual(expect.objectContaining({ observedValue: 1, matched: true }));
  });
});

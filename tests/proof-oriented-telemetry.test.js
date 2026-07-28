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

describe('Proof-oriented telemetry schema 6 event export', () => {
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
    expect(container.ledger.events.every((event) => event.schemaVersion === 6)).toBe(true);
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

  test('uses a native canonical ledger without legacy rematerialization', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'MODEL_FINAL', 1000, { finalStatus: 'SUCCESS' })
    ], { runSessionId: 42 });
    const container = await ProofTelemetry.buildAllPresets(ledger, {
      runSessionId: 42,
      exportedAt: 2000,
      canonicalLedger: true
    });
    expect(container.ledger.events).toEqual(ledger);
    expect(container.exportAudit.sourceCompatibility).toEqual({
      mode: 'native-runtime-ledger',
      canonicalRuntimeEmissionPending: false
    });
  });

  test('preserves monotonic source seq when a filtered native export has gaps', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'DISPATCH_SEND', 1000),
      evt('Claude', 'DISPATCH_SEND', 1100),
      evt('GPT', 'ANSWER_START_DETECTED', 1200)
    ], { runSessionId: 42 });
    const filtered = ledger.filter((event) => event.modelId === 'GPT');
    expect(filtered.map((event) => event.seq)).toEqual([1, 3]);
    expect(ProofTelemetry.validateLedger(filtered)).toEqual([]);
    const container = await ProofTelemetry.buildAllPresets(filtered, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000
    });
    expect(container.ledger.lastSeq).toBe(3);
    expect(container.exportAudit.exportBoundary.ledgerCompleteThroughSeq).toBe(3);
  });

  test('builds a bounded standalone task report with one materialized event copy', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'DISPATCH_BASELINE_CAPTURED', 1000),
      evt('GPT', 'DISPATCH_SEND', 1100),
      evt('GPT', 'PROMPT_SUBMITTED_ACCEPTED', 1200),
      evt('GPT', 'ANSWER_START_DETECTED', 1300),
      evt('GPT', 'ANSWER_GENERATING', 1400, { textLength: 80 }),
      evt('GPT', 'ANSWER_TEXT_STABLE', 1500, { textLength: 120 })
    ], { runSessionId: 42 });
    const allPresets = await ProofTelemetry.buildAllPresets(ledger, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000
    });
    const standalone = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000,
      modelId: 'GPT',
      reportType: 'submission-proof'
    });
    expect(standalone.fileKind).toBe('diagnostic-report');
    expect(standalone.reportDescriptor).toEqual(expect.objectContaining({
      reportType: 'submission-proof',
      reportMode: 'standalone'
    }));
    const ids = standalone.eventSelection.materializedEvents.map((event) => event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(standalone.exportIntegrity.deduplication.duplicateEventIds).toBe(0);
    expect(standalone.exportIntegrity.size).toEqual(expect.objectContaining({
      measuredBytes: expect.any(Number),
      measurementOnly: true
    }));
    expect(standalone.exportIntegrity.schemaValidation).toEqual(expect.objectContaining({
      valid: true,
      scope: 'materialized-events',
      status: 'validated'
    }));
    expect(standalone.correlation).toEqual(expect.objectContaining({
      dispatchId: 'GPT:42:1',
      matchingIncidentCount: 1
    }));
    expect(standalone.eventSelection.materializedEvents.every((event) => event.includedFor.length > 0)).toBe(true);
    expect(standalone.exportIntegrity.replay.valid).toBe(true);
    expect(standalone.analysisInstructions).toEqual(expect.objectContaining({
      version: '1.0.0',
      instructions: expect.any(Array)
    }));
    expect(standalone.exportIntegrity.size.measuredBytes).toBeLessThan(
      new TextEncoder().encode(JSON.stringify(allPresets)).length
    );
  });

  test('builds replay-equivalent isolated artifacts for all eight tasks', async () => {
    const labels = [
      'DISPATCH_BASELINE_CAPTURED', 'DISPATCH_SEND', 'PROMPT_SUBMITTED_ACCEPTED',
      'ANSWER_START_DETECTED', 'ANSWER_GENERATING', 'TURN_RESOLUTION_ACCEPTED',
      'ANSWER_NODE_REPLACED', 'ANSWER_TEXT_STABLE', 'ANSWER_VERIFICATION_RECORDED',
      'ANSWER_EXTRACTION_COMPLETED', 'ANSWER_COMPLETE_DETECTED',
      'AUTOMATION_DEADLINE_REACHED', 'ROUND4_FORCE_FINAL', 'FINALIZATION_DECISION',
      'MODEL_FINAL'
    ];
    const ledger = ProofTelemetry.buildLedger(labels.map((label, index) => evt('GPT', label, 1000 + index * 10, {
      generationEpoch: 1,
      answerIdentity: 'current_dispatch',
      verified: true,
      finalStatus: 'SUCCESS'
    }, label === 'MODEL_FINAL' ? 'SUCCESS' : '')), { runSessionId: 42 });
    for (const reportType of ProofTelemetry.REPORT_TYPES) {
      const report = await ProofTelemetry.buildStandaloneReport(ledger, {
        canonicalLedger: true,
        runSessionId: 42,
        exportedAt: 2000,
        modelId: 'GPT',
        reportType
      });
      expect(report.exportIntegrity.replay.valid).toBe(true);
      expect(report.exportIntegrity.hashes.semantic).toMatch(/^sha256:/);
      expect(report.eventSelection.materializedEvents.every((event) => event.includedFor.length)).toBe(true);
      expect(new Set(report.eventSelection.eventRefs).size).toBe(report.eventSelection.eventRefs.length);
    }
  });

  test('exports an insufficient task report instead of refusing a zero-match incident', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'ANSWER_GENERATING', 1000, { generationEpoch: 1, textLength: 20 })
    ], { runSessionId: 42 });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'request-not-sent'
    });
    expect(report.correlation.dispatchId).toBe('GPT:42:1');
    expect(report.reportDescriptor.completeness.level).toBe('insufficient');
    expect(report.missingEvidence.length).toBeGreaterThan(0);
    expect(report.eventSelection.materializedEvents).toHaveLength(1);
    expect(report.eventSelection.materializedEvents[0].includedFor).toEqual(['scope:incident-anchor']);
  });
});

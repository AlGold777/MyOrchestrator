const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

function event(eventType, seq, { metadata = {}, typed = { kind: 'unknown', state: 'unknown' }, payload = {}, clock = {} } = {}) {
  return {
    schemaVersion: 6,
    eventId: `event-${seq}`,
    eventType,
    layer: ProofTelemetry.layerFor(eventType),
    seq,
    ingestSeq: seq,
    runGeneration: 1,
    wallTs: 1000 + seq * 100,
    runSessionId: 'run-1',
    modelId: 'GPT',
    dispatchId: 'dispatch-current',
    generationEpoch: 1,
    producer: { component: 'semantic-test', version: '1' },
    clock: {
      contractVersion: '1.0',
      producerEpochId: 'document-1',
      observedAtLocalMonoMs: seq * 100,
      originKind: 'document',
      ingestEpochId: 'worker-1',
      ingestMonoMs: seq * 100,
      ...clock
    },
    payload: { typed, metadata, ...payload }
  };
}

function applicability(reportType, events) {
  const view = ProofTelemetry.deriveModelView('GPT', events);
  return {
    view,
    result: ProofTelemetry.evaluateApplicability(reportType, { stateAxes: view.stateAxes, derivedViews: view })
  };
}

describe('proof telemetry preset semantic applicability', () => {
  test('All tasks derives applicability independently for every incident', async () => {
    const firstTerminal = event('MODEL_TERMINAL_RECORDED', 1, {
      metadata: { terminalStatus: 'SUCCESS', answerLen: 100 },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    const nextText = event('TEXT_STATE_CHANGED', 2, { metadata: { textLength: 900 } });
    nextText.dispatchId = 'dispatch-next';
    nextText.generationEpoch = 2;
    const container = await ProofTelemetry.buildAllPresets([firstTerminal, nextText], {
      canonicalLedger: true,
      exportedAt: 2000
    });
    const incidents = container.derivedViews['incident-timeline'].data;
    expect(Object.keys(incidents)).toHaveLength(2);
    const first = Object.values(incidents).find((view) => view.incidentScope.dispatchId === 'dispatch-current');
    const next = Object.values(incidents).find((view) => view.incidentScope.dispatchId === 'dispatch-next');
    expect(first).toEqual(expect.objectContaining({
      acceptedTextLength: 100,
      maxObservedTextLength: 100,
      postTerminalGrowthChars: 0
    }));
    expect(next).toEqual(expect.objectContaining({
      acceptedTextLength: null,
      maxObservedTextLength: 900
    }));
    expect(Object.values(container.reports['false-success'].reportDescriptor.applicability.byIncident)
      .some((result) => result.status === 'confirmed')).toBe(false);
    expect(Object.values(container.reports.cutted.reportDescriptor.applicability.byIncident)
      .some((result) => result.status === 'confirmed')).toBe(false);
  });

  test('Cutted requires SUCCESS and positive incomplete-capture evidence', () => {
    const positive = applicability('cutted', [
      event('TEXT_STATE_CHANGED', 1, { metadata: { textLength: 120 } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 60 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('ANSWER_COMPLETENESS_EVALUATED', 3, { typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('MODEL_TERMINAL_RECORDED', 4, { metadata: { terminalStatus: 'SUCCESS', answerLen: 60 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]);
    expect(positive.result.status).toBe('confirmed');

    const normal = applicability('cutted', [
      event('TEXT_STATE_CHANGED', 1, { metadata: { textLength: 120 } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 120 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 3, { metadata: { terminalStatus: 'SUCCESS', answerLen: 120 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 4, { payload: { conclusion: 'confirmed', growthChars: 0, growthPct: 0, hashChanged: false } })
    ]);
    expect(normal.result.status).toBe('not_confirmed');
  });

  test('False success requires measured post-terminal growth after SUCCESS', () => {
    const positive = applicability('false-success', [
      event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } }),
      event('TEXT_STATE_CHANGED', 2, { metadata: { textLength: 130 } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 3, { payload: { conclusion: 'contradicted', growthChars: 30, growthPct: 30, hashChanged: true } })
    ]);
    expect(positive.result.status).toBe('confirmed');

    const normal = applicability('false-success', [
      event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 2, { payload: { conclusion: 'confirmed', growthChars: 0, growthPct: 0, hashChanged: false } })
    ]);
    expect(normal.result.status).toBe('not_confirmed');
    const hashOnlyMutation = applicability('false-success', [
      event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 2, { payload: { conclusion: 'contradicted', growthChars: 0, growthPct: 0, hashChanged: true } })
    ]);
    expect(hashOnlyMutation.result.status).toBe('not_confirmed');
    const unauditedGrowth = applicability('false-success', [
      event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } }),
      event('TEXT_STATE_CHANGED', 2, { metadata: { textLength: 130 } })
    ]);
    expect(unauditedGrowth.view.postTerminalGrowthChars).toBe(30);
    expect(unauditedGrowth.result.status).toBe('not_confirmed');
  });

  test('Old answer requires an accepted answer identity that conflicts with the current dispatch', () => {
    expect(applicability('old-answer', [
      event('EXTRACTION_COMPLETED', 1, { metadata: { length: 100, answerIdentity: 'previous_dispatch' }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 2, { metadata: { terminalStatus: 'SUCCESS', answerEvidenceDispatchId: 'dispatch-old' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]).result.status).toBe('confirmed');
    expect(applicability('old-answer', [
      event('EXTRACTION_COMPLETED', 1, { metadata: { length: 100, answerIdentity: 'current_dispatch' }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 2, { metadata: { terminalStatus: 'SUCCESS', answerEvidenceDispatchId: 'dispatch-current' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]).result.status).toBe('not_confirmed');
  });

  test('Empty requires observed generated text and an empty or failed extraction', () => {
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('EXTRACTION_COMPLETED', 2, { typed: { kind: 'extraction', state: 'failed' } })
    ]).result.status).toBe('confirmed');
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 100 }, typed: { kind: 'extraction', state: 'completed' } })
    ]).result.status).toBe('not_confirmed');
  });

  test('Prompt not sent requires explicit failed submission and treats absence as unknown', () => {
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'failed' } })
    ]).result.status).toBe('confirmed');
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'confirmed' } })
    ]).result.status).toBe('not_confirmed');
    expect(applicability('prompt-not-sent', []) .result.status).toBe('unknown');
  });

  test('Late end uses comparable monotonic clocks and preserves incomparable time as unknown', () => {
    const positive = applicability('late-end', [
      event('STABILITY_INTERVAL_CLOSED', 1, { clock: { observedAtLocalMonoMs: 1000 } }),
      event('MODEL_TERMINAL_RECORDED', 2, { metadata: { terminalStatus: 'SUCCESS' }, clock: { observedAtLocalMonoMs: 5000 } })
    ]);
    expect(positive.view.stableToTerminalMs).toBe(4000);
    expect(positive.result.status).toBe('confirmed');

    const incomparable = applicability('late-end', [
      event('STABILITY_INTERVAL_CLOSED', 1, { clock: { producerEpochId: 'document-a', ingestEpochId: 'worker-a' } }),
      event('MODEL_TERMINAL_RECORDED', 2, { clock: { producerEpochId: 'document-b', ingestEpochId: 'worker-b' } })
    ]);
    expect(incomparable.view.stableToTerminalMs).toBeNull();
    expect(incomparable.result.status).toBe('unknown');
  });

  test('unknown values cannot trigger negative sibling-style comparisons', () => {
    expect(ProofTelemetry.evaluatePredicate({}, { path: '$.missing', operator: 'ne', value: 'current_dispatch' }))
      .toEqual(expect.objectContaining({ known: false, matched: false }));
  });
});

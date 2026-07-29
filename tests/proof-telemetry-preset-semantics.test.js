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
      maxObservedTextLength: null,
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

  test('embedded reports compute slot sufficiency and preserve causal diagnosis roles', async () => {
    const events = [
      event('TEXT_STATE_CHANGED', 1, { metadata: { textLength: 130 } }),
      event('EXTRACTION_COMPLETED', 2, {
        metadata: { length: 100, verified: true, answerIdentity: 'current_dispatch' },
        typed: { kind: 'extraction', state: 'completed' }
      }),
      event('ANSWER_COMPLETENESS_EVALUATED', 3, { typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('MODEL_TERMINAL_RECORDED', 4, {
        metadata: { terminalStatus: 'SUCCESS', answerLen: 100 },
        typed: { kind: 'terminal_action', state: 'SUCCESS' }
      }),
      event('TEXT_STATE_CHANGED', 5, { metadata: { textLength: 150 } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 6, {
        payload: { conclusion: 'contradicted', growthChars: 50, growthPct: 50, auditPossible: true }
      })
    ];
    const container = await ProofTelemetry.buildAllPresets(events, { canonicalLedger: true, exportedAt: 2000 });
    const incidentId = Object.keys(container.derivedViews['incident-timeline'].data)[0];
    expect(container.reports.cutted.reportDescriptor.applicability.byIncident[incidentId]).toEqual(expect.objectContaining({
      status: 'confirmed',
      explanationRole: 'consequence',
      causedBy: 'false-success'
    }));
    expect(container.reports['false-success'].reportDescriptor.applicability.byIncident[incidentId]).toEqual(expect.objectContaining({
      status: 'confirmed',
      explanationRole: 'primary'
    }));
    expect(container.diagnosisArbitration.byIncident[incidentId].primaryDiagnosis).toBe('false-success');
    expect(container.reports.cutted.reportDescriptor.completeness).toEqual(expect.objectContaining({
      level: expect.stringMatching(/complete|bounded|insufficient/),
      evidenceCoveragePct: expect.any(Number),
      byIncident: expect.objectContaining({ [incidentId]: expect.any(Object) })
    }));
    expect(container.reports.cutted.diagnosticSummary.incidents[incidentId].evidenceSlots.length).toBeGreaterThan(0);
    expect(container.reports.cutted.siblings.every((sibling) => sibling.antiLoop?.requestTargetOnlyOnce)).toBe(true);
  });

  test('standalone compaction preserves applicability, extrema and replay', async () => {
    const repeated = Array.from({ length: 50 }, (_, index) => event('TEXT_STATE_CHANGED', index + 3, {
      metadata: { textLength: index === 24 ? 500 : 100 + index },
      typed: { kind: 'text', state: 'changing' }
    }));
    const events = [
      event('DISPATCH_BASELINE_CAPTURED', 1),
      event('CANDIDATE_IDENTITY_INFERRED', 2, { payload: { answerIdentity: 'current_dispatch' }, typed: { kind: 'candidate_identity', state: 'current_dispatch' } }),
      ...repeated,
      event('EXTRACTION_COMPLETED', 53, { metadata: { length: 100 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('ANSWER_COMPLETENESS_EVALUATED', 54, { typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('STRUCTURAL_VERIFICATION_EVALUATED', 55, { metadata: { verified: true }, typed: { kind: 'verification', state: 'verified' } }),
      event('DECISION_RECORDED', 56, { payload: { accepted: true }, typed: { kind: 'decision', state: 'accepted' } }),
      event('MODEL_TERMINAL_RECORDED', 57, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const direct = applicability('cutted', events);
    const standalone = await ProofTelemetry.buildStandaloneReport(events, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'cutted',
      exportedAt: 9000
    });
    expect(direct.result.status).toBe('confirmed');
    expect(standalone.reportDescriptor.applicability.status).toBe(direct.result.status);
    expect(standalone.derivedViews.modelTimeline.data.maxObservedTextLength).toBe(500);
    expect(standalone.eventSelection.materializedEvents.length).toBeLessThan(events.length);
    expect(standalone.exportIntegrity.replay.valid).toBe(true);
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
    expect(unauditedGrowth.result.status).toBe('unknown');
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
    expect(applicability('old-answer', [
      event('EXTRACTION_COMPLETED', 1, { metadata: { length: 100 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 2, { metadata: { terminalStatus: 'SUCCESS', answerEvidenceDispatchId: 'GPT:dispatch-current' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]).result.status).toBe('not_confirmed');
    const terminalWithoutDispatch = event('MODEL_TERMINAL_RECORDED', 2, {
      metadata: { terminalStatus: 'SUCCESS', answerEvidenceDispatchId: 'dispatch-old' },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    delete terminalWithoutDispatch.dispatchId;
    expect(applicability('old-answer', [terminalWithoutDispatch]).result.status).toBe('unknown');
  });

  test('Empty requires observed generated text and an empty or failed extraction', () => {
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('EXTRACTION_COMPLETED', 2, { typed: { kind: 'extraction', state: 'failed' } })
    ]).result.status).toBe('confirmed');
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 100, verified: true, answerIdentity: 'current_dispatch' }, typed: { kind: 'extraction', state: 'completed' } })
    ]).result.status).toBe('not_confirmed');
    const wrongNode = applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 30, verification: 'rejected' }, typed: { kind: 'extraction', state: 'completed' } })
    ]);
    expect(wrongNode.result.status).toBe('confirmed');
    expect(wrongNode.view.emptyExtractionBranch).toBe('wrong_node');
    const accepted = event('EXTRACTION_COMPLETED', 2, {
      metadata: { length: 100, verified: true, answerIdentity: 'current_dispatch' },
      typed: { kind: 'extraction', state: 'completed' }
    });
    const laterFailedAttempt = event('EXTRACTION_COMPLETED', 3, { typed: { kind: 'extraction', state: 'failed' } });
    const terminal = event('MODEL_TERMINAL_RECORDED', 4, {
      metadata: { terminalStatus: 'SUCCESS', answerLen: 100 },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    terminal.evidenceRefs = [accepted.eventId];
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      accepted,
      laterFailedAttempt,
      terminal
    ]).result.status).toBe('not_confirmed');
    expect(applicability('empty', [
      event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } })
    ]).result.status).toBe('unknown');
  });

  test('Prompt not sent requires explicit failed submission and treats absence as unknown', () => {
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'failed' } })
    ]).result.status).toBe('confirmed');
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'confirmed' } })
    ]).result.status).toBe('not_confirmed');
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'failed' } }),
      event('GENERATION_SIGNAL_CHANGED', 2, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
      event('MODEL_TERMINAL_RECORDED', 3, { metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]).result.status).toBe('not_confirmed');
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'confirmed' } }),
      event('SUBMISSION_INFERRED', 2, { typed: { kind: 'submission', state: 'failed' } })
    ]).result.status).toBe('not_confirmed');
    expect(applicability('prompt-not-sent', [
      event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'failed' } }),
      event('OBSERVER_HEALTH_OBSERVED', 2, { typed: { kind: 'observation', state: 'unavailable' } })
    ]).result.status).toBe('unknown');
    expect(applicability('prompt-not-sent', []) .result.status).toBe('unknown');
  });

  test('Late end uses comparable monotonic clocks and preserves incomparable time as unknown', () => {
    const positive = applicability('late-end', [
      event('STABILITY_INTERVAL_CLOSED', 1, { clock: { observedAtLocalMonoMs: 1000 } }),
      event('DECISION_RECORDED', 2, { payload: { accepted: false }, typed: { kind: 'decision', state: 'rejected' }, clock: { observedAtLocalMonoMs: 1100 } }),
      event('MODEL_TERMINAL_RECORDED', 3, { metadata: { terminalStatus: 'SUCCESS' }, clock: { observedAtLocalMonoMs: 5000 } })
    ]);
    expect(positive.view.stableToTerminalMs).toBe(4000);
    expect(positive.result.status).toBe('confirmed');

    const interrupted = applicability('late-end', [
      event('STABILITY_INTERVAL_CLOSED', 1, { clock: { observedAtLocalMonoMs: 1000 } }),
      event('DECISION_RECORDED', 2, { payload: { accepted: false }, typed: { kind: 'decision', state: 'rejected' } }),
      event('TEXT_STATE_CHANGED', 3, { metadata: { textLength: 200 } }),
      event('MODEL_TERMINAL_RECORDED', 4, { metadata: { terminalStatus: 'SUCCESS' }, clock: { observedAtLocalMonoMs: 5000 } })
    ]);
    expect(interrupted.view.postStabilityMutationObserved).toBe(true);
    expect(interrupted.result.status).toBe('not_confirmed');

    const incomparable = applicability('late-end', [
      event('STABILITY_INTERVAL_CLOSED', 1, { clock: { producerEpochId: 'document-a', ingestEpochId: 'worker-a' } }),
      event('DECISION_RECORDED', 2, { payload: { accepted: false }, typed: { kind: 'decision', state: 'rejected' } }),
      event('MODEL_TERMINAL_RECORDED', 3, { clock: { producerEpochId: 'document-b', ingestEpochId: 'worker-b' } })
    ]);
    expect(incomparable.view.stableToTerminalMs).toBeNull();
    expect(incomparable.result.status).toBe('unknown');
  });

  test('unknown values cannot trigger negative sibling-style comparisons', () => {
    expect(ProofTelemetry.evaluatePredicate({}, { path: '$.missing', operator: 'ne', value: 'current_dispatch' }))
      .toEqual(expect.objectContaining({ known: false, matched: false }));
  });
});

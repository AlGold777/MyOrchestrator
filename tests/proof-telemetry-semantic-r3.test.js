const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Contracts = require('../shared/proof-telemetry-contracts.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');

function event(eventType, seq, options = {}) {
  return {
    schemaVersion: 6,
    eventId: options.eventId || `r3-event-${seq}`,
    eventType,
    layer: ProofTelemetry.layerFor(eventType),
    seq,
    ingestSeq: seq,
    runGeneration: 1,
    runSessionId: 'r3-run',
    modelId: 'GPT',
    dispatchId: options.dispatchId || 'r3-current',
    generationEpoch: options.generationEpoch ?? 1,
    ...(options.candidateId ? { candidateId: options.candidateId } : {}),
    evidenceRefs: options.evidenceRefs || [],
    clock: {
      contractVersion: '1.0',
      producerEpochId: 'r3-document',
      observedAtLocalMonoMs: options.mono ?? seq * 1000,
      originKind: 'document',
      ingestEpochId: 'r3-worker',
      ingestMonoMs: options.mono ?? seq * 1000
    },
    payload: {
      typed: options.typed || { kind: 'unknown', state: 'unknown' },
      metadata: options.metadata || {},
      ...(options.payload || {})
    }
  };
}

function evaluate(reportType, events) {
  const view = ProofTelemetry.deriveModelView('GPT', events);
  return { view, applicability: ProofTelemetry.evaluateApplicability(reportType, { stateAxes: view.stateAxes, derivedViews: view }) };
}

function closedWindow(seq, mono, options = {}) {
  return event('OBSERVATION_INTERVAL_CLOSED', seq, {
    mono,
    typed: { kind: 'observation_interval', state: 'closed' },
    payload: { observationCoverage: 'complete', ...options }
  });
}

describe('telemetry preset semantic review iteration 3', () => {
  test('absence requires a complete post-failure window of generationStartTimeoutMs', () => {
    const before = event('PAGE_HEALTH_OBSERVED', 1, { mono: 0, typed: { kind: 'observation', state: 'reliable' } });
    const failed = event('SUBMISSION_INFERRED', 2, { mono: 1000, typed: { kind: 'submission', state: 'failed' } });
    expect(evaluate('prompt-not-sent', [before, failed]).applicability.status).toBe('unknown');
    const short = evaluate('prompt-not-sent', [failed, closedWindow(3, 10000)]);
    expect(short.view.absenceObservationWindow.reason).toBe('window_too_short');
    expect(short.applicability.status).toBe('unknown');
    const gapped = evaluate('prompt-not-sent', [failed, closedWindow(3, 17000, { gapMs: 1 })]);
    expect(gapped.applicability.status).toBe('unknown');
    const complete = evaluate('prompt-not-sent', [failed, closedWindow(3, 16000)]);
    expect(complete.view.absenceObservationWindow).toEqual(expect.objectContaining({ coverage: 'complete', durationMs: 15000, requiredDurationMs: 15000 }));
    expect(complete.applicability.status).toBe('confirmed');
  });

  test('Late end binds stability, observations, eligibility and terminal to one candidate', () => {
    const stableA = event('STABILITY_INTERVAL_CLOSED', 1, { mono: 1000, candidateId: 'A', metadata: { textLength: 100 }, typed: { kind: 'text', state: 'stable' } });
    const observedA = event('TEXT_STATE_CHANGED', 2, { mono: 2000, candidateId: 'A', metadata: { textLength: 100 } });
    const decisionB = event('DECISION_RECORDED', 3, { mono: 3000, candidateId: 'B', typed: { kind: 'decision', state: 'accepted' }, payload: { accepted: true } });
    const terminalB = event('MODEL_TERMINAL_RECORDED', 4, { mono: 9000, candidateId: 'B', metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } });
    expect(evaluate('late-end', [stableA, observedA, decisionB, terminalB]).applicability.status).toBe('unknown');
    const stableB = { ...stableA, candidateId: 'B' };
    const observedB = { ...observedA, candidateId: 'B' };
    const positive = evaluate('late-end', [stableB, observedB, event('PAGE_HEALTH_OBSERVED', 5, { mono: 2100, candidateId: 'B', typed: { kind: 'observation', state: 'reliable' } }), decisionB, terminalB]);
    expect(positive.view.lateEndCandidateBinding).toBe('candidate_proven');
    expect(positive.applicability.status).toBe('confirmed');
  });

  test('Late end uses the first active eligibility and never a deadline', () => {
    const base = [
      event('STABILITY_INTERVAL_CLOSED', 1, { mono: 1000, candidateId: 'A', metadata: { textLength: 100 }, typed: { kind: 'text', state: 'stable' } }),
      event('TEXT_STATE_CHANGED', 2, { mono: 2000, candidateId: 'A', metadata: { textLength: 100 } }),
      event('PAGE_HEALTH_OBSERVED', 3, { mono: 2100, candidateId: 'A', typed: { kind: 'observation', state: 'reliable' } })
    ];
    const first = event('DECISION_RECORDED', 4, { mono: 3000, candidateId: 'A', typed: { kind: 'decision', state: 'accepted' }, payload: { accepted: true } });
    const repeated = event('DECISION_RECORDED', 5, { mono: 7000, candidateId: 'A', typed: { kind: 'decision', state: 'accepted' }, payload: { accepted: true } });
    const deadline = event('TERMINAL_DEADLINE_REACHED', 6, { mono: 9000, candidateId: 'A' });
    const terminal = event('MODEL_TERMINAL_RECORDED', 7, { mono: 9500, candidateId: 'A', metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } });
    const result = evaluate('late-end', [...base, first, repeated, deadline, terminal]);
    expect(result.view.policyEligibilityEventId).toBe(first.eventId);
    expect(result.view.policyEligibleToTerminalMs).toBe(6500);
    expect(result.applicability.status).toBe('confirmed');
    const superseded = event('FINALIZATION_POLICY_EVALUATED', 8, { mono: 7200, candidateId: 'A', payload: { supersededEligibilityEventId: first.eventId } });
    expect(evaluate('late-end', [...base, first, repeated, superseded, deadline, terminal]).view.policyEligibilityEventId).toBe(repeated.eventId);
  });

  test('unknown typed fact falls back to canonical and contradictions are violations', () => {
    const fallback = event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'unknown' } });
    expect(Contracts.factOf(fallback)).toEqual({ kind: 'terminal_action', state: 'SUCCESS' });
    const incident = Incidents.indexIncidents([fallback])[0];
    expect(Incidents.resolveEvidenceSlots([fallback], incident, 'cutted').slots.find((slot) => slot.slotId === 'success_terminal').status).toBe('satisfied');
    const conflict = event('MODEL_TERMINAL_RECORDED', 2, { metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'FAILURE' } });
    expect(Incidents.validateTemporalInvariants([conflict], Incidents.indexIncidents([conflict])[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ invariantId: 'TYPED_CANONICAL_CONFLICT' })
    ]));
  });

  test('explicit completion typed state does not conflict with an absent canonical detail', () => {
    const completion = event('COMPLETION_HYPOTHESIS_EVALUATED', 1, {
      typed: { kind: 'completion_hypothesis', state: 'probably_complete' },
      payload: { sourceEventType: 'ANSWER_COMPLETE_DETECTED' }
    });
    expect(Contracts.factOf(completion)).toEqual({ kind: 'completion_hypothesis', state: 'probably_complete' });
    expect(Contracts.typedCanonicalConflict(completion)).toBeNull();

    const explicitConflict = event('COMPLETION_HYPOTHESIS_EVALUATED', 2, {
      typed: { kind: 'completion_hypothesis', state: 'probably_complete' },
      payload: { completionDetection: 'rejected' }
    });
    expect(Contracts.typedCanonicalConflict(explicitConflict)).toEqual(expect.objectContaining({
      typed: { kind: 'completion_hypothesis', state: 'probably_complete' },
      canonical: { kind: 'completion_hypothesis', state: 'rejected' }
    }));
  });

  test('False success confirms measured post-terminal growth without cause evidence', async () => {
    const before = event('GENERATION_SIGNAL_CHANGED', 1, {
      candidateId: 'candidate-a',
      typed: { kind: 'generation', state: 'active' },
      metadata: { textLength: 100 }
    });
    const decision = event('DECISION_RECORDED', 2, {
      candidateId: 'candidate-a',
      typed: { kind: 'decision', state: 'accepted' },
      payload: { accepted: true }
    });
    const terminal = event('MODEL_TERMINAL_RECORDED', 3, {
      candidateId: 'candidate-a',
      typed: { kind: 'terminal_action', state: 'SUCCESS' },
      metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }
    });
    const after = event('GENERATION_SIGNAL_CHANGED', 4, {
      candidateId: 'candidate-a',
      typed: { kind: 'generation', state: 'active' },
      metadata: { textLength: 150 }
    });
    const audit = event('POST_TERMINAL_AUDIT_COMPLETED', 5, {
      candidateId: 'candidate-a',
      evidenceRefs: [terminal.eventId, after.eventId],
      payload: { conclusion: 'contradicted', auditPossible: true, growthChars: 50, growthPct: 50 }
    });
    const events = [before, decision, terminal, after, audit];
    const report = await ProofTelemetry.buildStandaloneReport(events, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'false-success'
    });
    expect(report.reportDescriptor.diagnosticVerdict).toBe('confirmed');
    expect(report.diagnosticSummary.evidenceSlots.find((slot) => slot.slotId === 'completion_proof')).toEqual(
      expect.objectContaining({ effectiveCriticality: 'conditional', status: 'not_observed' })
    );

    const preTerminalOnly = Incidents.resolveEvidenceSlots([before, decision, terminal, audit], Incidents.indexIncidents(events)[0], 'false-success', {
      stateAxes: ProofTelemetry.deriveModelView('GPT', events).stateAxes,
      derivedViews: ProofTelemetry.deriveModelView('GPT', events)
    });
    expect(preTerminalOnly.slots.find((slot) => slot.slotId === 'post_terminal_mutation').status).toBe('unavailable');
  });

  test('embedded completeness and event selection are incident-scoped', async () => {
    const confirmed = [
      event('DISPATCH_BASELINE_CAPTURED', 1, { mono: 0 }),
      event('SUBMIT_ACTION_OBSERVED', 2, { mono: 500, typed: { kind: 'submission', state: 'attempted' } }),
      event('SUBMISSION_INFERRED', 3, { mono: 1000, typed: { kind: 'submission', state: 'failed' } }),
      event('PAGE_HEALTH_OBSERVED', 4, { mono: 1100, typed: { kind: 'observation', state: 'reliable' } }),
      closedWindow(5, 16000)
    ];
    const foreign = event('PAGE_CONTEXT_OBSERVED', 6, { dispatchId: 'foreign', generationEpoch: 2 });
    const report = (await ProofTelemetry.buildAllPresets([...confirmed, foreign], { canonicalLedger: true })).reports['prompt-not-sent'];
    const confirmedId = Object.entries(report.reportDescriptor.applicability.byIncident).find(([, item]) => item.diagnosticVerdict === 'confirmed')[0];
    expect(report.reportDescriptor.completeness.summarizedIncidentIds).toEqual([confirmedId]);
    expect(report.reportDescriptor.completeness.byIncident[confirmedId].level).toBe('complete');
    expect(report.eventSeqs).not.toContain(6);
    expect(report.eventSeqs.every((seq) => report.eventSelection.bySeq[String(seq)].length > 0)).toBe(true);
  });

  test('Prompt not inserted does not require submit evidence before submission', async () => {
    const events = [
      event('DISPATCH_BASELINE_CAPTURED', 1, { mono: 0 }),
      event('PROMPT_INSERTION_EVALUATED', 2, { mono: 1000, typed: { kind: 'prompt_insertion', state: 'failed' }, payload: { insertionState: 'failed' } }),
      event('PAGE_HEALTH_OBSERVED', 3, { mono: 1100, typed: { kind: 'observation', state: 'reliable' } }),
      closedWindow(4, 16000)
    ];
    const report = await ProofTelemetry.buildStandaloneReport(events, { canonicalLedger: true, modelId: 'GPT', reportType: 'prompt-not-inserted' });
    expect(report.reportDescriptor.diagnosticVerdict).toBe('confirmed');
    expect(report.diagnosticSummary.evidenceSlots.find((slot) => slot.slotId === 'submit_counterevidence').effectiveCriticality).toBe('conditional');
  });

  test('Cutted compares extraction with the final valid boundary, not historical maximum', () => {
    const common = [
      event('TEXT_STATE_CHANGED', 1, { candidateId: 'A', metadata: { textLength: 1000 } }),
      event('TEXT_STATE_CHANGED', 2, { candidateId: 'A', metadata: { textLength: 500 } }),
      event('EXTRACTION_COMPLETED', 3, { candidateId: 'A', metadata: { length: 500 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 4, { candidateId: 'A', metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const rollback = evaluate('cutted', common);
    expect(rollback.view.maxObservedTextLength).toBe(1000);
    expect(rollback.view.comparableObservedTextLength).toBe(500);
    expect(rollback.applicability.status).toBe('not_confirmed');
    expect(evaluate('cutted', [{ ...common[0] }, { ...common[2], payload: { ...common[2].payload, metadata: { length: 600 } } }, common[3]]).applicability.status).toBe('confirmed');
  });

  test('every preset declares complement or independent refutation semantics', () => {
    Object.keys(Contracts.REPORT_CONTRACTS).forEach((reportType) => {
      expect(Contracts.normalizedRefutation(reportType).model).toMatch(/^(complement|independent_)/);
    });
  });

  test('remaining presets have localized temporal invariants', () => {
    const scenarios = [
      [
        event('PROMPT_INSERTION_EVALUATED', 1),
        event('DISPATCH_BASELINE_CAPTURED', 2)
      ],
      [
        event('SUBMISSION_INFERRED', 1),
        event('SUBMIT_ACTION_OBSERVED', 2)
      ],
      [
        event('STABILITY_INTERVAL_CLOSED', 1),
        event('GENERATION_SIGNAL_CHANGED', 2, { typed: { kind: 'generation', state: 'active' } })
      ]
    ];
    const expected = ['TEMPORAL_PROMPT_INSERTION_ORDER', 'TEMPORAL_PROMPT_ACCEPTANCE_ORDER', 'TEMPORAL_LATE_END_STABILITY_ORDER'];
    scenarios.forEach((events, index) => {
      const violations = Incidents.validateTemporalInvariants(events, Incidents.indexIncidents(events)[0]);
      expect(violations).toEqual(expect.arrayContaining([expect.objectContaining({ invariantId: expected[index] })]));
    });
  });

  test('single-candidate Cutted evidence cannot confirm while candidate-proven can', () => {
    const events = [
      event('TEXT_STATE_CHANGED', 1, { metadata: { textLength: 1000 } }),
      event('EXTRACTION_COMPLETED', 2, { metadata: { length: 500 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('ANSWER_COMPLETENESS_EVALUATED', 3, { typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('CANDIDATE_IDENTITY_INFERRED', 4, { typed: { kind: 'candidate_identity', state: 'current_dispatch' } }),
      event('DECISION_RECORDED', 5, { typed: { kind: 'decision', state: 'accepted' }, payload: { accepted: true } }),
      event('MODEL_TERMINAL_RECORDED', 6, { metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const incident = Incidents.indexIncidents(events)[0];
    const view = ProofTelemetry.deriveModelView('GPT', events);
    const applicability = ProofTelemetry.evaluateApplicability('cutted', { stateAxes: view.stateAxes, derivedViews: view });
    const evidence = Incidents.resolveEvidenceSlots(events, incident, 'cutted', { stateAxes: view.stateAxes, derivedViews: view });
    expect(evidence).toEqual(expect.objectContaining({ sufficiency: 'bounded', confirmationAllowedWhenBounded: false }));
    expect(ProofTelemetry.diagnosticVerdict(applicability, evidence, [], 'cutted')).toBe('supported_but_incomplete');
    const candidateEvents = events.map((item) => ({ ...item, candidateId: 'A' }));
    const candidateView = ProofTelemetry.deriveModelView('GPT', candidateEvents);
    const candidateEvidence = Incidents.resolveEvidenceSlots(candidateEvents, Incidents.indexIncidents(candidateEvents)[0], 'cutted', { stateAxes: candidateView.stateAxes, derivedViews: candidateView });
    expect(candidateEvidence.confirmationAllowedWhenBounded).toBe(true);
  });

  test('Old answer cannot confirm from an unresolved priorIncidentRef', () => {
    const terminal = event('MODEL_TERMINAL_RECORDED', 1, {
      metadata: { terminalStatus: 'SUCCESS', answerIdentity: 'previous_dispatch', priorIncidentRef: 'incident:outside' },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    const events = [terminal];
    const incident = Incidents.indexIncidents(events)[0];
    const view = ProofTelemetry.deriveModelView('GPT', events);
    const context = { stateAxes: view.stateAxes, derivedViews: view };
    const evidence = Incidents.resolveEvidenceSlots(events, incident, 'old-answer', context);
    expect(evidence.confirmationAllowedWhenBounded).toBe(false);
    expect(ProofTelemetry.diagnosticVerdict(ProofTelemetry.evaluateApplicability('old-answer', context), evidence, [], 'old-answer')).not.toBe('confirmed');
  });
});

const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Incidents = require('../shared/proof-telemetry-incidents.js');

function event(eventType, seq, options = {}) {
  const metadata = options.metadata || {};
  return {
    schemaVersion: 6,
    eventId: options.eventId || `r2-event-${seq}`,
    eventType,
    layer: ProofTelemetry.layerFor(eventType),
    seq,
    ingestSeq: seq,
    runGeneration: 1,
    wallTs: 1000 + seq,
    runSessionId: 'r2-run',
    modelId: 'GPT',
    dispatchId: options.dispatchId || 'r2-current',
    generationEpoch: options.generationEpoch ?? 1,
    ...(options.candidateId ? { candidateId: options.candidateId } : {}),
    evidenceRefs: options.evidenceRefs || [],
    producer: { component: options.producer || 'r2-test', version: '1' },
    clock: {
      contractVersion: '1.0',
      producerEpochId: options.producerEpochId || 'r2-document',
      observedAtLocalMonoMs: options.mono ?? seq * 1000,
      originKind: 'document',
      ingestEpochId: 'r2-worker',
      ingestMonoMs: seq,
      ...(options.clock || {})
    },
    payload: {
      typed: options.typed || { kind: 'unknown', state: 'unknown' },
      metadata,
      ...(options.payload || {})
    }
  };
}

function evaluate(reportType, events) {
  const view = ProofTelemetry.deriveModelView('GPT', events);
  return {
    view,
    applicability: ProofTelemetry.evaluateApplicability(reportType, { stateAxes: view.stateAxes, derivedViews: view })
  };
}

function reliableWindow(startSeq = 1) {
  return [
    event('DISPATCH_BASELINE_CAPTURED', startSeq),
    event('PAGE_HEALTH_OBSERVED', startSeq + 1, { typed: { kind: 'observation', state: 'reliable' } })
  ];
}

describe('telemetry preset semantic review iteration 2', () => {
  test('required-slot omission yields supported_but_incomplete and cannot win arbitration', async () => {
    const incomplete = [
      ...reliableWindow(1),
      event('PROMPT_INSERTION_EVALUATED', 3, { typed: { kind: 'prompt_insertion', state: 'failed' }, payload: { insertionState: 'failed' } })
    ];
    const bounded = await ProofTelemetry.buildAllPresets(incomplete, { canonicalLedger: true, exportedAt: 5000 });
    const incidentId = Object.keys(bounded.diagnosisArbitration.byIncident)[0];
    expect(bounded.reports['prompt-not-inserted'].reportDescriptor.applicability.byIncident[incidentId])
      .toEqual(expect.objectContaining({ status: 'confirmed', diagnosticVerdict: 'supported_but_incomplete', sufficiency: 'bounded' }));
    expect(bounded.diagnosisArbitration.byIncident[incidentId].primaryDiagnosis).toBeNull();

    const complete = await ProofTelemetry.buildAllPresets([
      ...incomplete,
      event('SUBMISSION_INFERRED', 4, { typed: { kind: 'submission', state: 'attempted' } })
    ], { canonicalLedger: true, exportedAt: 5000 });
    const completeId = Object.keys(complete.diagnosisArbitration.byIncident)[0];
    expect(complete.reports['prompt-not-inserted'].reportDescriptor.applicability.byIncident[completeId].diagnosticVerdict).toBe('confirmed');
    expect(complete.diagnosisArbitration.byIncident[completeId].primaryDiagnosis).toBe('prompt-not-inserted');
  });

  test('impossible audit is unknown while a completed within-tolerance audit refutes growth', () => {
    const terminal = event('MODEL_TERMINAL_RECORDED', 1, {
      metadata: { terminalStatus: 'SUCCESS', answerLen: 1000 },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    const impossible = evaluate('false-success', [terminal, event('MISSING_EVIDENCE_RECORDED', 2, {
      payload: { missingEvidence: 'post_terminal_comparable_measurement', status: 'unavailable' }
    })]);
    expect(impossible.view.postTerminalAuditStatus).toBe('impossible');
    expect(impossible.applicability.status).toBe('unknown');

    const withinTolerance = evaluate('false-success', [terminal, event('POST_TERMINAL_AUDIT_COMPLETED', 2, {
      payload: { conclusion: 'confirmed', growthChars: 1, growthPct: 0.1, auditPossible: true }
    })]);
    expect(withinTolerance.view.postTerminalGrowthProven).toBe(false);
    expect(withinTolerance.applicability.status).toBe('not_confirmed');
  });

  test('candidate continuity gates post-terminal growth and Empty extraction', () => {
    const terminalA = event('MODEL_TERMINAL_RECORDED', 1, {
      candidateId: 'A', metadata: { terminalStatus: 'SUCCESS', answerLen: 100 },
      typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    const growthB = event('TEXT_STATE_CHANGED', 2, { candidateId: 'B', metadata: { textLength: 150 } });
    const auditB = event('POST_TERMINAL_AUDIT_COMPLETED', 3, {
      candidateId: 'B', payload: { conclusion: 'contradicted', growthChars: 50, growthPct: 50, auditPossible: true }
    });
    expect(evaluate('false-success', [terminalA, growthB, auditB]).applicability.status).toBe('unknown');

    const generationA = event('GENERATION_SIGNAL_CHANGED', 1, {
      candidateId: 'A', metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' }
    });
    const failedB = event('EXTRACTION_COMPLETED', 2, { candidateId: 'B', typed: { kind: 'extraction', state: 'failed' } });
    expect(evaluate('empty', [generationA, failedB]).applicability.status).toBe('unknown');
    expect(evaluate('empty', [generationA, { ...failedB, candidateId: 'A' }]).applicability.status).toBe('confirmed');
  });

  test('latest completeness supersedes an earlier hypothesis while proven growth persists until rollback', () => {
    const completeAfterTruncated = evaluate('cutted', [
      event('ANSWER_COMPLETENESS_EVALUATED', 1, { typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('ANSWER_COMPLETENESS_EVALUATED', 2, { typed: { kind: 'answer_completeness', state: 'probably_complete' } }),
      event('MODEL_TERMINAL_RECORDED', 3, { metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ]);
    expect(completeAfterTruncated.view.activeCompletenessState).toBe('probably_complete');
    expect(completeAfterTruncated.applicability.status).toBe('not_confirmed');

    const audit50 = event('POST_TERMINAL_AUDIT_COMPLETED', 3, { payload: { conclusion: 'contradicted', growthChars: 50, growthPct: 50, auditPossible: true } });
    const audit0 = event('POST_TERMINAL_AUDIT_COMPLETED', 4, { payload: { conclusion: 'confirmed', growthChars: 0, growthPct: 0, auditPossible: true } });
    const base = [event('MODEL_TERMINAL_RECORDED', 1, {
      metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' }
    }), event('TEXT_STATE_CHANGED', 2, { metadata: { textLength: 150 } })];
    expect(evaluate('false-success', [...base, audit50, audit0]).view.postTerminalGrowthProven).toBe(true);
    const rollbackAudit = { ...audit0, payload: { ...audit0.payload, rollbackObserved: true } };
    expect(evaluate('false-success', [...base, audit50, rollbackAudit]).view.postTerminalGrowthProven).toBe(false);
  });

  test('absence diagnoses require a reliable complete observation window', () => {
    const failed = event('SUBMISSION_INFERRED', 3, { typed: { kind: 'submission', state: 'failed' } });
    const degraded = evaluate('prompt-not-sent', [
      event('DISPATCH_BASELINE_CAPTURED', 1),
      event('PAGE_HEALTH_OBSERVED', 2, { typed: { kind: 'observation', state: 'degraded' } }),
      failed
    ]);
    expect(degraded.view.absenceObservationWindow.coverage).toBe('incomplete');
    expect(degraded.applicability.status).toBe('unknown');
    const reliable = evaluate('prompt-not-sent', [...reliableWindow(1), failed]);
    expect(reliable.view.absenceObservationWindow.coverage).toBe('complete');
    expect(reliable.applicability.status).toBe('confirmed');
  });

  test('Late end needs observation coverage and measures from policy eligibility', () => {
    const stable = event('STABILITY_INTERVAL_CLOSED', 1, { mono: 1000, metadata: { textLength: 100 }, typed: { kind: 'text', state: 'stable' } });
    const terminal = event('MODEL_TERMINAL_RECORDED', 5, { mono: 6000, metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } });
    expect(evaluate('late-end', [stable, event('DECISION_RECORDED', 4, { mono: 3000, payload: { accepted: true }, typed: { kind: 'decision', state: 'accepted' } }), terminal]).applicability.status).toBe('unknown');

    const observed = event('TEXT_STATE_CHANGED', 2, { mono: 2000, metadata: { textLength: 100 } });
    const health = event('PAGE_HEALTH_OBSERVED', 3, { mono: 2100, typed: { kind: 'observation', state: 'reliable' } });
    const eligible = event('DECISION_RECORDED', 4, { mono: 3000, payload: { accepted: true }, typed: { kind: 'decision', state: 'accepted' } });
    const positive = evaluate('late-end', [stable, observed, health, eligible, terminal]);
    expect(positive.view.postStabilityMutationObserved).toBe(false);
    expect(positive.view.policyEligibilityEventId).toBe(eligible.eventId);
    expect(positive.view.policyEligibleToTerminalMs).toBe(3000);
    expect(positive.applicability.status).toBe('confirmed');

    const blocked = event('DECISION_RECORDED', 4, { mono: 3000, payload: { accepted: false }, typed: { kind: 'decision', state: 'rejected' } });
    expect(evaluate('late-end', [stable, observed, health, blocked, terminal]).applicability.status).toBe('not_confirmed');
  });

  test('Late end stable slot selects the exact final stable boundary', () => {
    const events = [
      event('STABILITY_INTERVAL_CLOSED', 1, { typed: { kind: 'text', state: 'stable' } }),
      event('TEXT_STATE_CHANGED', 2, { metadata: { textLength: 100 } }),
      event('STABILITY_INTERVAL_CLOSED', 3, { typed: { kind: 'text', state: 'stable' } }),
      event('MODEL_TERMINAL_RECORDED', 4, { metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const incident = Incidents.indexIncidents(events)[0];
    const slot = Incidents.resolveEvidenceSlots(events, incident, 'late-end').slots.find((item) => item.slotId === 'stable_boundary');
    expect(slot.eventIds).toEqual(['r2-event-3']);
  });

  test('standalone compaction preserves a task-local verdict without full-incident fallback', async () => {
    const repeated = Array.from({ length: 313 }, (_, index) => event('TEXT_STATE_CHANGED', index + 1, {
      candidateId: 'candidate-current', metadata: { textLength: index + 100 }
    }));
    const tail = [
      event('CANDIDATE_SET_CHANGED', 314, { candidateId: 'candidate-current', typed: { kind: 'candidate_identity', state: 'current_dispatch' } }),
      event('CANDIDATE_IDENTITY_INFERRED', 315, { candidateId: 'candidate-current', typed: { kind: 'candidate_identity', state: 'current_dispatch' } }),
      event('EXTRACTION_COMPLETED', 316, { candidateId: 'candidate-current', metadata: { length: 100 }, typed: { kind: 'extraction', state: 'completed' } }),
      event('STRUCTURAL_VERIFICATION_EVALUATED', 317, { candidateId: 'candidate-current', metadata: { verified: true }, typed: { kind: 'verification', state: 'verified' } }),
      event('ANSWER_COMPLETENESS_EVALUATED', 318, { candidateId: 'candidate-current', typed: { kind: 'answer_completeness', state: 'probably_truncated' } }),
      event('DECISION_RECORDED', 319, { payload: { accepted: true }, typed: { kind: 'decision', state: 'accepted' } }),
      event('MODEL_TERMINAL_RECORDED', 320, { candidateId: 'candidate-current', metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const report = await ProofTelemetry.buildStandaloneReport([...repeated, ...tail], {
      canonicalLedger: true, modelId: 'GPT', reportType: 'cutted', exportedAt: 10000
    });
    expect(report.reportDescriptor.diagnosticVerdict).toBe('confirmed');
    expect(report.eventSelection.materializedEvents.length).toBeLessThanOrEqual(40);
    expect(report.exportIntegrity.verdictPreservation).toEqual(expect.objectContaining({ equivalent: true, fallbackMaterializedFullIncident: false }));
    expect(report.derivedViews.recordedDerivedView.source).toBe('full-frozen-incident');
  });

  test('a malformed audit only blocks False success, not an unrelated absence diagnosis', async () => {
    const events = [
      ...reliableWindow(1),
      event('SUBMIT_ACTION_OBSERVED', 3, { typed: { kind: 'submission', state: 'attempted' } }),
      event('SUBMISSION_INFERRED', 4, { typed: { kind: 'submission', state: 'failed' } }),
      event('POST_TERMINAL_AUDIT_COMPLETED', 5, { payload: { conclusion: 'contradicted', growthChars: 30, growthPct: 30, auditPossible: true } })
    ];
    const container = await ProofTelemetry.buildAllPresets(events, { canonicalLedger: true, exportedAt: 8000 });
    const incidentId = Object.keys(container.diagnosisArbitration.byIncident)[0];
    expect(container.reports['prompt-not-sent'].reportDescriptor.applicability.byIncident[incidentId].diagnosticVerdict).toBe('confirmed');
    expect(container.reports['false-success'].reportDescriptor.applicability.byIncident[incidentId].diagnosticVerdict).not.toBe('confirmed');
  });

  test('standalone incident selection prefers a confirmed verdict over a newer evidence-rich refutation', async () => {
    const confirmed = [
      ...reliableWindow(1),
      event('SUBMIT_ACTION_OBSERVED', 3, { typed: { kind: 'submission', state: 'attempted' } }),
      event('SUBMISSION_INFERRED', 4, { typed: { kind: 'submission', state: 'failed' } })
    ];
    const refuted = [
      event('DISPATCH_BASELINE_CAPTURED', 10, { dispatchId: 'r2-new', generationEpoch: 2 }),
      event('PAGE_HEALTH_OBSERVED', 11, { dispatchId: 'r2-new', generationEpoch: 2, typed: { kind: 'observation', state: 'reliable' } }),
      event('SUBMIT_ACTION_OBSERVED', 12, { dispatchId: 'r2-new', generationEpoch: 2, typed: { kind: 'submission', state: 'attempted' } }),
      event('SUBMISSION_INFERRED', 13, { dispatchId: 'r2-new', generationEpoch: 2, typed: { kind: 'submission', state: 'confirmed' } })
    ];
    const report = await ProofTelemetry.buildStandaloneReport([...confirmed, ...refuted], {
      canonicalLedger: true, modelId: 'GPT', reportType: 'prompt-not-sent'
    });
    expect(report.correlation.dispatchId).toBe('r2-current');
    expect(report.correlation.selectionReason).toBe('diagnostic_verdict_then_task_evidence_then_latest');
  });

  test('Old answer compares privacy-safe content hashes when the prior lane is available', async () => {
    const priorRef = 'incident:r2-run|1|GPT|r2-prior|0';
    const prior = [
      event('EXTRACTION_COMPLETED', 1, { dispatchId: 'r2-prior', generationEpoch: 0, metadata: { length: 100, answerHash: 'hash:prior' }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 2, { dispatchId: 'r2-prior', generationEpoch: 0, metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const current = [
      event('EXTRACTION_COMPLETED', 3, { metadata: { length: 100, answerHash: 'hash:different', answerIdentity: 'previous_dispatch' }, typed: { kind: 'extraction', state: 'completed' } }),
      event('MODEL_TERMINAL_RECORDED', 4, { metadata: { terminalStatus: 'SUCCESS', answerEvidenceDispatchId: 'r2-prior', priorIncidentRef: priorRef }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
    ];
    const report = await ProofTelemetry.buildStandaloneReport([...prior, ...current], {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'old-answer',
      incidentId: 'incident:r2-run|1|GPT|r2-current|1'
    });
    expect(report.derivedViews.modelTimeline.data.priorAnswerComparison).toEqual(expect.objectContaining({
      status: 'different', basis: 'privacy_safe_hash', contentMatched: false
    }));
    expect(report.reportDescriptor.applicability.status).toBe('not_confirmed');
  });

  test('normal refutation reports not_applicable completeness', async () => {
    const events = [
      ...reliableWindow(1),
      event('SUBMISSION_INFERRED', 3, { typed: { kind: 'submission', state: 'confirmed' } })
    ];
    const report = await ProofTelemetry.buildStandaloneReport(events, {
      canonicalLedger: true, modelId: 'GPT', reportType: 'prompt-not-sent'
    });
    expect(report.reportDescriptor.applicability.status).toBe('not_confirmed');
    expect(report.reportDescriptor.completeness.level).toBe('not_applicable');
  });

  test('every preset has executable refutation and every sibling pair is classified', () => {
    ProofTelemetry.REPORT_TYPES.forEach((reportType) => {
      const registry = ProofTelemetry.dependencyRegistrySnapshot();
      expect(registry.refutations[reportType].any.length).toBeGreaterThan(0);
    });
    Object.values(ProofTelemetry.SIBLING_RULES).flat().forEach(([target], index, rules) => {
      expect(target).toBeTruthy();
      expect(rules[index]).toBeTruthy();
    });
    expect(JSON.stringify(ProofTelemetry.dependencyRegistrySnapshot().diagnosisArbitration)).not.toContain('related');
  });

  test('all seven presets expose matched refutation evidence instead of predicate fall-through', () => {
    const success = event('MODEL_TERMINAL_RECORDED', 3, {
      metadata: { terminalStatus: 'SUCCESS', answerLen: 100 }, typed: { kind: 'terminal_action', state: 'SUCCESS' }
    });
    const scenarios = {
      cutted: [
        event('TEXT_STATE_CHANGED', 1, { metadata: { textLength: 100 } }),
        event('EXTRACTION_COMPLETED', 2, { metadata: { length: 100 }, typed: { kind: 'extraction', state: 'completed' } }),
        success
      ],
      'false-success': [success, event('POST_TERMINAL_AUDIT_COMPLETED', 4, { payload: { conclusion: 'confirmed', growthChars: 0, growthPct: 0, auditPossible: true } })],
      'old-answer': [event('MODEL_TERMINAL_RECORDED', 1, { metadata: { terminalStatus: 'FAILURE', answerIdentity: 'previous_dispatch' }, typed: { kind: 'terminal_action', state: 'FAILURE' } })],
      empty: [
        event('GENERATION_SIGNAL_CHANGED', 1, { metadata: { textLength: 100 }, typed: { kind: 'generation', state: 'active' } }),
        event('EXTRACTION_COMPLETED', 2, { metadata: { length: 100, verified: true, answerIdentity: 'current_dispatch' }, typed: { kind: 'extraction', state: 'completed' } })
      ],
      'prompt-not-inserted': [event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'confirmed' } })],
      'prompt-not-sent': [event('SUBMISSION_INFERRED', 1, { typed: { kind: 'submission', state: 'confirmed' } })],
      'late-end': [
        event('STABILITY_INTERVAL_CLOSED', 1, { mono: 1000, metadata: { textLength: 100 }, typed: { kind: 'text', state: 'stable' } }),
        event('TEXT_STATE_CHANGED', 2, { mono: 2000, metadata: { textLength: 200 } }),
        event('PAGE_HEALTH_OBSERVED', 3, { typed: { kind: 'observation', state: 'reliable' } }),
        event('DECISION_RECORDED', 4, { mono: 3000, payload: { accepted: true }, typed: { kind: 'decision', state: 'accepted' } }),
        event('MODEL_TERMINAL_RECORDED', 5, { mono: 5000, metadata: { terminalStatus: 'SUCCESS' }, typed: { kind: 'terminal_action', state: 'SUCCESS' } })
      ]
    };
    Object.entries(scenarios).forEach(([reportType, events]) => {
      const result = evaluate(reportType, events).applicability;
      expect(result.status).toBe('not_confirmed');
      expect(result.refutationResults.some((item) => item.known && item.matched)).toBe(true);
    });
  });
});

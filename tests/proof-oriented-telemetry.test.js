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
  const noDeliveryLedger = (renderOutcome, overrides = {}) => ProofTelemetry.buildLedger([
    evt('GPT', 'ANSWER_SOURCE_MATERIALIZED', 1000, {
      generationEpoch: 1,
      sourceProofLevel: 'direct_preterminal',
      attemptId: 'attempt-1',
      payloadEvidenceId: 'payload-1',
      normalizationVersion: 'answer-proof-normalization@1.0.0',
      normalizedHash: 'fnv1a:12345678',
      normalizedLength: 120,
      ...overrides.source
    }),
    ...(overrides.middle || [
      evt('GPT', 'ANSWER_DELIVERY_ACKNOWLEDGED', 1100, {
        generationEpoch: 1,
        attemptId: 'attempt-1',
        payloadEvidenceId: 'payload-1',
        outcome: 'accepted'
      }),
      evt('GPT', 'ANSWER_COMMIT_EVALUATED', 1200, {
        generationEpoch: 1,
        attemptId: 'attempt-1',
        payloadEvidenceId: 'payload-1',
        outcome: 'accepted',
        overwrite: false
      })
    ]),
    evt('GPT', 'ANSWER_CARD_RENDER_EVALUATED', 1300, {
      generationEpoch: 1,
      attemptId: 'attempt-1',
      payloadEvidenceId: 'payload-1',
      expectedCardId: 'panel-gpt',
      observedCardId: 'panel-gpt',
      outcome: renderOutcome,
      contentClass: renderOutcome === 'empty' ? 'empty' : 'answer',
      normalizationVersion: 'answer-proof-normalization@1.0.0',
      expectedNormalizationVersion: 'answer-proof-normalization@1.0.0',
      normalizedHash: renderOutcome === 'matched' ? 'fnv1a:12345678' : null,
      expectedNormalizedHash: 'fnv1a:12345678',
      evaluationBoundaryId: 'boundary-1',
      evaluationBoundaryType: 'automatic_terminal',
      resolutionState: renderOutcome === 'matched' ? 'delivered' : 'unresolved',
      ...overrides.render
    })
  ], { runSessionId: 42 });

  test('routes prompt insertion failure into a typed canonical proof event', () => {
    const runtime = evt('GPT', 'PROMPT_INSERTION_FAILED', 1000, {
      dispatchId: 'dispatch-insertion',
      generationEpoch: 1,
      insertionState: 'failed',
      errorType: 'prompt_injection_failed'
    });
    expect(ProofTelemetry.classifyRuntimeEvent(runtime)).toEqual(expect.objectContaining({
      route: 'canonical',
      eventType: 'PROMPT_INSERTION_EVALUATED',
      typed: { kind: 'prompt_insertion', state: 'failed' }
    }));
    const [proofEvent] = ProofTelemetry.buildLedger([runtime], { runSessionId: 42 });
    expect(proofEvent).toEqual(expect.objectContaining({
      eventType: 'PROMPT_INSERTION_EVALUATED',
      dispatchId: 'dispatch-insertion'
    }));
    expect(proofEvent.payload.typed).toEqual({ kind: 'prompt_insertion', state: 'failed' });
  });

  test('routes proof, operational and unknown legacy events to distinct stores', () => {
    expect(ProofTelemetry.classifyRuntimeEvent({ label: 'GROK_PROMPT_ECHO_REJECTED' })).toEqual(expect.objectContaining({
      route: 'canonical',
      eventType: 'CANDIDATE_SET_CHANGED',
      typed: { kind: 'candidate_identity', state: 'rejected' }
    }));
    expect(ProofTelemetry.classifyRuntimeEvent({ label: 'ADAPTIVE_PROBE_TICK' }).route).toBe('operational');
    expect(ProofTelemetry.classifyRuntimeEvent({ label: 'UNMAPPED_LEGACY_NOISE' }).route).toBe('debug');
    expect(ProofTelemetry.buildLedger([
      { ...evt('GPT', 'SYNTHETIC_STABILITY', 1000), proofEventType: 'STABILITY_INTERVAL_CLOSED' }
    ], { runSessionId: 42 })[0].eventType).toBe('STABILITY_INTERVAL_CLOSED');
  });

  test('never promotes unknown, recovery planning, file or attachment labels into proof slots', () => {
    const unsafeLabels = [
      'MATERIALIZE_RECOVERY_START',
      'MATERIALIZE_RECOVERY_MISS',
      'MATERIALIZE_LATEST_RETRY_WAIT',
      'GEMINI_CDP_FILES_MATERIALIZED',
      'ATTACH_CANDIDATE',
      'UNMAPPED_LEGACY_NOISE'
    ];
    unsafeLabels.forEach((label) => {
      expect(ProofTelemetry.classifyRuntimeEvent({ label }).route).toBe('debug');
      expect(ProofTelemetry.canonicalType({ label })).toBeNull();
    });
    expect(ProofTelemetry.buildLedger(
      unsafeLabels.map((label, index) => evt('GPT', label, 1000 + index)),
      { runSessionId: 42 }
    )).toEqual([]);
  });

  test('routes answer reception rejections by message semantics, not label substrings', () => {
    const senderRejected = evt('GPT', 'SENDER_TAB_MISMATCH_REJECTED', 1000, {
      messageType: 'LLM_RESPONSE_READY'
    });
    const correlationRejected = evt('GPT', 'LIFECYCLE_CORRELATION_REJECTED', 1010, {
      messageType: 'LLM_RESPONSE'
    });
    const ledger = ProofTelemetry.buildLedger([senderRejected, correlationRejected], { runSessionId: 42 });
    expect(ledger.map((event) => event.eventType)).toEqual([
      'ANSWER_DELIVERY_REJECTED',
      'ANSWER_DELIVERY_REJECTED'
    ]);
    expect(ledger.every((event) => event.payload.typed.kind === 'delivery')).toBe(true);
    expect(ledger.some((event) => ['SUBMISSION_EVIDENCE_CHANGED', 'TEXT_STATE_CHANGED'].includes(event.eventType))).toBe(false);
  });

  test('keeps fallback mode separate from extraction outcome', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'DOM_FALLBACK_START', 1000),
      evt('GPT', 'DOM_FALLBACK_SUCCESS', 1010),
      evt('GPT', 'DOM_FALLBACK_TIMEOUT', 1020)
    ], { runSessionId: 42 });
    expect(ledger.map((event) => event.eventType)).toEqual([
      'EXTRACTION_ATTEMPTED',
      'EXTRACTION_COMPLETED',
      'EXTRACTION_COMPLETED'
    ]);
    expect(ledger[0].payload.typed).toEqual(expect.objectContaining({ kind: 'extraction_attempt', mode: 'fallback' }));
    expect(ledger[1].payload.typed).toEqual(expect.objectContaining({ outcome: 'completed', mode: 'fallback' }));
    expect(ledger[2].payload.typed).toEqual(expect.objectContaining({ outcome: 'failed', mode: 'fallback' }));
  });

  test('builds one immutable canonical ledger and all seven embedded reports', async () => {
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
    expect(container.reports['false-success'].eventSeqs.length).toBeGreaterThan(0);
    expect(container.reports['false-success']).not.toHaveProperty('materializedEvents');
  });

  test.each([
    ['empty expected card', 'empty', true],
    ['matching expected card', 'matched', false]
  ])('derives No delivery occurrence from independent source/card proof: %s', (_name, outcome, expected) => {
    const view = ProofTelemetry.deriveModelView('GPT', noDeliveryLedger(outcome));
    expect(view.noDeliveryEvidence).toBe(expected);
    expect(view.evaluationBoundaryId).toBe('boundary-1');
    expect(view.sourceToCardComparison).toBe(outcome);
  });

  test.each([
    ['source proof missing', { source: { sourceProofLevel: 'unproven' } }],
    ['attempt identity differs', { render: { attemptId: 'attempt-2', payloadEvidenceId: 'payload-2' } }],
    ['normalization version differs', { render: { expectedNormalizationVersion: 'answer-proof-normalization@2.0.0' } }],
    ['expected card is unknown', { render: { expectedCardId: null } }]
  ])('keeps No delivery unknown when comparison is not provable: %s', (_name, overrides) => {
    const view = ProofTelemetry.deriveModelView('GPT', noDeliveryLedger('empty', overrides));
    expect(view.noDeliveryEvidence).toBeNull();
  });

  test('keeps occurrence confirmed when the failing stage cannot be localized', async () => {
    const ledger = noDeliveryLedger('mismatched', { middle: [] });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'no-delivery'
    });
    expect(report.reportDescriptor.occurrenceVerdict).toBe('confirmed');
    expect(report.reportDescriptor.causeVerdict).toBe('supported_but_incomplete');
    expect(report.reportDescriptor.occurrenceCompleteness.level).toBe('complete');
    expect(report.reportDescriptor.causeCompleteness.level).toBe('bounded');
    expect(report.diagnosticSummary.unexplainedByCatalogue).toBe(true);
  });

  test('localizes an empty-card cause on one attempt path and publishes all four cause axes', async () => {
    const report = await ProofTelemetry.buildStandaloneReport(noDeliveryLedger('empty'), {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'no-delivery'
    });
    expect(report.reportDescriptor.diagnosticVerdict).toBe('confirmed');
    expect(report.diagnosticSummary).toEqual(expect.objectContaining({
      failureStageCode: 'render',
      mechanismCauseCode: 'card_render_empty',
      observabilityLimitationCodes: expect.any(Array),
      recoveryFindingCode: null,
      lastSuccessfulStage: 'commit',
      firstObservedUnsuccessfulStage: 'render'
    }));
  });

  test('builds No delivery after cutover without Empty or duplicated canonical events', async () => {
    const ledger = noDeliveryLedger('empty');
    const container = await ProofTelemetry.buildAllPresets(ledger, { canonicalLedger: true, exportedAt: 2000 });
    expect(container.reports).not.toHaveProperty('empty');
    expect(container.reports).toHaveProperty('no-delivery');
    expect(container).not.toHaveProperty('migration');
    expect(container.ledger.eventCount).toBe(ledger.length);
    expect(new Set(container.ledger.events.map((event) => event.eventId)).size).toBe(ledger.length);
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

    const latestIncidentId = container.derivedViews['model-timeline'].data.Grok.latestIncidentId;
    const axes = container.derivedViews['incident-timeline'].data[latestIncidentId].stateAxes;
    expect(axes.terminalMode).toBe('forced');
    expect(axes.completionDetection).toBe('inconclusive');
    expect(axes.answerCompleteness).toBe('unknown');
    expect(axes.completionEvidenceTier).toBe(1);
    expect(container.reports['false-success'].eventSeqs.length).toBeGreaterThan(0);
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
    expect(container.exportAudit.sourceCompatibility).toEqual(expect.objectContaining({
      mode: 'native-runtime-ledger',
      canonicalRuntimeEmissionPending: false
    }));
  });

  test('records legacy clock/identity limitations without inventing current-answer identity', async () => {
    const container = await ProofTelemetry.buildAllPresets({
      '<GPT>': [
        evt('GPT', 'ANSWER_START_DETECTED', 1000, { textLength: 10 })
      ]
    }, { runSessionId: 42, exportedAt: 2000 });
    expect(container.exportAudit.sourceCompatibility).toEqual(expect.objectContaining({
      mode: 'legacy-runtime-adapter',
      limitations: expect.arrayContaining([
        expect.objectContaining({ code: 'clock_unavailable' }),
        expect.objectContaining({ code: 'identity_evidence_not_inferred' })
      ])
    }));
    const latestIncidentId = container.derivedViews['model-timeline'].data.GPT.latestIncidentId;
    expect(container.derivedViews['incident-timeline'].data[latestIncidentId].stateAxes.answerIdentity).toBe('candidate');
    expect(container.reports['late-end'].reportDescriptor.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'clock_unavailable' })
    ]));
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
      reportType: 'prompt-not-sent'
    });
    expect(standalone.fileKind).toBe('diagnostic-report');
    expect(standalone.reportDescriptor).toEqual(expect.objectContaining({
      reportType: 'prompt-not-sent',
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

  test('builds replay-equivalent isolated artifacts for all seven tasks', async () => {
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

  test('exports a not-applicable task report instead of refusing a zero-match incident', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'ANSWER_GENERATING', 1000, { generationEpoch: 1, textLength: 20 })
    ], { runSessionId: 42 });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'prompt-not-sent'
    });
    expect(report.correlation.dispatchId).toBe('GPT:42:1');
    expect(report.reportDescriptor.completeness.level).toBe('not_applicable');
    expect(report.missingEvidence.length).toBeGreaterThan(0);
    expect(report.eventSelection.materializedEvents).toHaveLength(1);
    expect(report.eventSelection.materializedEvents[0].includedFor).toEqual([
      'counterevidence:prompt-not-sent',
      'scope:incident-anchor'
    ]);
  });

  test('reports the measured stable-to-terminal delay for Late end', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('GPT', 'ANSWER_GENERATING', 1000, { generationEpoch: 1, textLength: 80 }),
      evt('GPT', 'ANSWER_TEXT_STABLE', 2000, { generationEpoch: 1, textLength: 120 }),
      evt('GPT', 'FINALIZATION_DECISION', 6800, { generationEpoch: 1, finalStatus: 'SUCCESS' }),
      evt('GPT', 'MODEL_FINAL', 7000, { generationEpoch: 1, finalStatus: 'SUCCESS', answerLen: 120 })
    ], { runSessionId: 42 }).map((event) => ({
      ...event,
      clock: {
        ...event.clock,
        producerEpochId: 'test-document-epoch',
        observedAtLocalMonoMs: event.wallTs - 1000
      }
    }));
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'late-end'
    });
    expect(report.derivedViews.modelTimeline.data.stableToTerminalMs).toBe(5000);
  });

  test('exports field-specific diagnostic provenance and slot-bound conclusions', async () => {
    const ledger = ProofTelemetry.buildLedger({
      '<GPT>': [
        evt('GPT', 'DISPATCH_BASELINE_CAPTURED', 1000),
        evt('GPT', 'DISPATCH_SEND', 1100),
        evt('GPT', 'PROMPT_SUBMITTED_REJECTED', 1200),
        evt('GPT', 'PAGE_CONTEXT_OBSERVED', 1300)
      ]
    }, { runSessionId: 42, exportedAt: 2000 });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true,
      modelId: 'GPT',
      reportType: 'prompt-not-sent'
    });
    const byId = new Map(report.eventSelection.materializedEvents.map((item) => [item.eventId, item]));
    const provenance = report.derivedViews.fieldProvenance.promptNotSentEvidence;
    expect(provenance.derivedFromEventIds.length).toBeGreaterThan(0);
    expect(provenance.derivedFromEventIds.every((id) => [
      'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED', 'GENERATION_START_EVALUATED',
      'GENERATION_SIGNAL_CHANGED', 'TEXT_STATE_CHANGED', 'EXTRACTION_COMPLETED', 'MODEL_TERMINAL_RECORDED'
    ].includes(byId.get(id).eventType))).toBe(true);
    expect(report.reportDescriptor.canDiagnose[0]).toEqual(expect.objectContaining({
      claim: expect.stringContaining('prompt-not-sent'),
      basedOnSlotIds: expect.any(Array)
    }));
    expect(report.reportDescriptor.cannotDiagnoseAlone.every((item) => item.slotId)).toBe(true);
    const effectiveSlots = report.diagnosticSummary.evidenceSlots.filter((slot) => slot.effectiveCriticality !== 'conditional');
    const expectedCoverage = Math.round((effectiveSlots.filter((slot) => slot.status === 'satisfied').length / effectiveSlots.length) * 10000) / 100;
    expect(report.reportDescriptor.completeness.evidenceCoveragePct).toBe(expectedCoverage);
  });
});

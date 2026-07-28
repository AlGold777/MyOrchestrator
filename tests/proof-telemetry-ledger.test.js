describe('native proof telemetry ledger', () => {
  let storage;

  beforeEach(() => {
    jest.resetModules();
    storage = {};
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async (keys) => Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]])
          )),
          set: jest.fn(async (value) => Object.assign(storage, value))
        }
      }
    };
    delete global.ProofOrientedTelemetry;
    delete global.ProofTelemetryLedger;
    require('../shared/proof-oriented-telemetry.js');
    require('../shared/proof-telemetry-policy.js');
    require('../shared/proof-telemetry-audit.js');
    require('../background/proof-telemetry-ledger.js');
  });

  afterEach(() => {
    delete global.chrome;
    delete global.ProofOrientedTelemetry;
    delete global.ProofTelemetryPolicy;
    delete global.ProofTelemetryAudit;
    delete global.ProofTelemetryLedger;
  });

  test('persists immutable schema 5 envelopes with monotonic seq', async () => {
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'DISPATCH_SEND',
      level: 'info',
      meta: { runSessionId: 42, dispatchId: 'GPT:42:1', llmName: 'GPT' }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1200,
      label: 'PROMPT_SUBMITTED_ACCEPTED',
      level: 'info',
      meta: { runSessionId: 42, dispatchId: 'GPT:42:1', llmName: 'GPT' }
    }, 'GPT');

    const snapshot = await global.ProofTelemetryLedger.snapshot({ runSessionId: 42 });
    expect(snapshot.eventCount).toBe(4);
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(snapshot.events.map((event) => event.eventType)).toEqual([
      'RUN_CONFIG_RECORDED',
      'SUBMIT_ACTION_OBSERVED',
      'SUBMISSION_EVIDENCE_CHANGED',
      'SUBMISSION_INFERRED'
    ]);
    expect(snapshot.events[3].monoMs).toBe(200);
    expect(snapshot.events.every((event) => event.schemaVersion === 5)).toBe(true);
  });

  test('does not persist sensitive text and suppresses exact consecutive no-ops', async () => {
    const source = {
      ts: 1000,
      label: 'ANSWER_GENERATING',
      details: 'private answer',
      meta: { runSessionId: 42, answerText: 'private answer', answerLength: 14 }
    };
    await global.ProofTelemetryLedger.record(source, 'Claude');
    await global.ProofTelemetryLedger.record(source, 'Claude');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.eventCount).toBe(3);
    expect(JSON.stringify(snapshot)).not.toContain('private answer');
    const sourceEvent = snapshot.events.find((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING');
    expect(sourceEvent.payload.metadata.answerLength).toBe(14);
  });

  test('starts a fresh ledger when the run identity changes', async () => {
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'RUN_START', meta: { runSessionId: 1 } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 2000, label: 'RUN_START', meta: { runSessionId: 2 } }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.runSessionId).toBe('2');
    expect(snapshot.eventCount).toBe(2);
    expect(snapshot.events[0].eventType).toBe('RUN_CONFIG_RECORDED');
    expect(snapshot.events[1].seq).toBe(2);
  });

  test('records policy, decision, override and terminal lineage explicitly', async () => {
    const meta = { runSessionId: 42, dispatchId: 'Grok:42:1', llmName: 'Grok' };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'DISPATCH_SEND', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'PROMPT_SUBMITTED_ACCEPTED', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 1200, label: 'ANSWER_START_DETECTED', meta: { ...meta, textLength: 10 } }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 2000, label: 'FINALIZATION_DECISION', details: 'SUCCESS:accepted', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 2100, label: 'MODEL_FINAL', details: 'SUCCESS', meta: { ...meta, finalStatus: 'SUCCESS' } }, 'Grok');

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const policy = snapshot.events.find((event) => event.eventType === 'FINALIZATION_POLICY_EVALUATED');
    const override = snapshot.events.find((event) => event.eventType === 'POLICY_OVERRIDE_APPLIED');
    const decision = snapshot.events.find((event) => event.eventType === 'DECISION_RECORDED');
    const terminal = snapshot.events.find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    expect(policy).toBeTruthy();
    expect(override.payload.mode).toBe('forced');
    expect(decision.payload).toEqual(expect.objectContaining({ accepted: true, mode: 'forced' }));
    expect(terminal.evidenceRefs).toContain(decision.eventId);
    expect(terminal.payload.metadata.decisionId).toBe(decision.eventId);
    expect(global.ProofTelemetryPolicy.replay(snapshot.events).invariantViolations).toEqual([]);
    const container = await global.ProofOrientedTelemetry.buildAllPresets(snapshot.events, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2200
    });
    expect(container.exportAudit.replay.valid).toBe(true);
    expect(container.exportAudit.replay.recordedDecisionHash)
      .toBe(container.exportAudit.replay.recomputedDecisionHash);
  });

  test('audits post-terminal growth and exports a privacy-safe forensic omission', async () => {
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', llmName: 'GPT' };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'FINALIZATION_DECISION', details: 'SUCCESS:accepted', meta }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1100,
      label: 'MODEL_FINAL',
      details: 'SUCCESS',
      meta: { ...meta, finalStatus: 'SUCCESS', answerLength: 100, answerHash: 'hash:a' }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1500,
      label: 'ANSWER_GENERATING',
      meta: { ...meta, answerLength: 125, answerHash: 'hash:b' }
    }, 'GPT');

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const audit = snapshot.events.find((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(audit.payload).toEqual(expect.objectContaining({
      conclusion: 'contradicted',
      growthChars: 25,
      growthPct: 25,
      hashChanged: true
    }));
    const forensic = snapshot.events.find((event) => event.eventType === 'SELECTOR_FORENSIC_SNAPSHOT_CAPTURED');
    expect(forensic.payload.captureAvailable).toBe(false);

    const container = await global.ProofOrientedTelemetry.buildAllPresets(snapshot.events, {
      canonicalLedger: true,
      runSessionId: 42,
      exportedAt: 2000
    });
    expect(container.attachments.omissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ anomalyTrigger: 'post_terminal_answer_change' })
    ]));
    expect(container.derivedViews['model-timeline'].data.GPT).toEqual(expect.objectContaining({
      postTerminalAuditStatus: 'completed',
      postTerminalAuditConclusion: 'contradicted',
      postTerminalGrowthChars: 25
    }));
  });

  test('materializes an atomic observation frame and candidate inference', async () => {
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', llmName: 'GPT' };
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'LIFECYCLE_SNAPSHOT_ACCEPTED',
      meta: { ...meta, maximumSignalSkewMs: 250, mutationCount: 3 }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1100,
      label: 'MULTIPLE_CANDIDATES_AMBIGUOUS',
      meta: { ...meta, candidateCount: 2 }
    }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const frame = snapshot.events.find((event) => event.eventType === 'OBSERVATION_FRAME_CAPTURED');
    expect(frame.payload.metadata).toEqual(expect.objectContaining({
      captureStartedMonoMs: 0,
      captureCompletedMonoMs: 0,
      maximumSignalSkewMs: 250,
      contentScriptAvailable: true,
      mutationCount: 3
    }));
    const identity = snapshot.events.find((event) => event.eventType === 'CANDIDATE_IDENTITY_INFERRED');
    expect(identity.payload.answerIdentity).toBe('ambiguous');
    expect(identity.evidenceRefs).toHaveLength(1);
  });
});

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
    require('../shared/proof-telemetry-contracts.js');
    require('../shared/proof-telemetry-clock.js');
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

  test('persists immutable schema 6 envelopes with monotonic global ingestion order', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
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
    expect(snapshot.eventCount).toBe(5);
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshot.events.map((event) => event.eventType)).toEqual([
      'RUN_CONFIG_RECORDED',
      'CLOCK_EPOCH_STARTED',
      'SUBMIT_ACTION_OBSERVED',
      'SUBMISSION_EVIDENCE_CHANGED',
      'SUBMISSION_INFERRED'
    ]);
    expect(snapshot.events.every((event) => event.schemaVersion === 6)).toBe(true);
    expect(snapshot.events.every((event) => event.ingestSeq > 0 && event.runGeneration === 1)).toBe(true);
    expect(snapshot.events.every((event) => event.clock?.ingestEpochId)).toBe(true);
  });

  test('batches a synchronous telemetry burst into one persistence transaction', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const writesAfterBegin = global.chrome.storage.local.set.mock.calls.length;

    await Promise.all(Array.from({ length: 50 }, (_, index) => (
      global.ProofTelemetryLedger.record({
        ts: 1000 + index,
        label: 'ANSWER_GENERATING',
        meta: {
          runSessionId: 42,
          dispatchId: 'GPT:42:1',
          generationEpoch: 1,
          answerLength: index + 1
        }
      }, 'GPT')
    )));

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.events.filter((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING')).toHaveLength(50);
    expect(global.chrome.storage.local.get).toHaveBeenCalledTimes(1);
    expect(global.chrome.storage.local.set.mock.calls.length - writesAfterBegin).toBe(1);
  });

  test('coalesces mutations that arrive while a persistence transaction is in flight', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const writesAfterBegin = global.chrome.storage.local.set.mock.calls.length;
    global.chrome.storage.local.set.mockImplementation(async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      Object.assign(storage, value);
    });

    const records = [];
    for (let index = 0; index < 100; index += 1) {
      records.push(global.ProofTelemetryLedger.record({
        ts: 1000 + index,
        label: 'ANSWER_GENERATING',
        meta: {
          runSessionId: 42,
          dispatchId: 'GPT:42:1',
          generationEpoch: 1,
          answerLength: index + 1
        }
      }, 'GPT'));
      await Promise.resolve();
    }
    await Promise.all(records);

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.events.filter((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING')).toHaveLength(100);
    expect(global.chrome.storage.local.set.mock.calls.length - writesAfterBegin).toBeLessThanOrEqual(3);
    expect(snapshot.queuedMutationCount).toBe(0);
  });

  test('preserves a complete dispatch-to-terminal proof chain under write pressure', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    global.chrome.storage.local.set.mockImplementation(async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      Object.assign(storage, value);
    });
    const identity = {
      runSessionId: 42,
      dispatchId: 'GPT:42:1',
      generationEpoch: 1,
      attemptId: 'GPT:42:1:generation:1'
    };
    const stream = [
      ['DISPATCH_BASELINE_CAPTURED', { anchorAnswerCount: 2 }],
      ['DISPATCH_SEND', { attempt: 1 }],
      ['PROMPT_SUBMITTED_ACCEPTED', { confirmed: true }],
      ['ANSWER_START_DETECTED', { textLength: 1 }],
      ['ANSWER_GENERATING', { textLength: 120, textHash: 'hash:growing' }],
      ['LIFECYCLE_SNAPSHOT_ACCEPTED', { textLength: 120, contentScriptAvailable: true }],
      ['ANSWER_EXTRACTION_COMPLETED', { extractedTextLength: 120, answerIdentity: 'current_dispatch' }],
      ['FINALIZATION_DECISION', { accepted: true }],
      ['MODEL_FINAL', { finalStatus: 'SUCCESS', acceptedTextLength: 120 }]
    ];
    const pending = [];
    stream.forEach(([label, metadata], index) => {
      pending.push(global.ProofTelemetryLedger.record({
        ts: 1000 + index,
        label,
        details: label === 'MODEL_FINAL' ? 'SUCCESS' : '',
        meta: { ...identity, ...metadata }
      }, 'GPT'));
    });
    await Promise.all(pending);

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const sourceTypes = snapshot.events.map((event) => event.payload?.sourceEventType).filter(Boolean);
    stream.forEach(([label]) => expect(sourceTypes).toContain(label));
    expect(snapshot.events.filter((event) => event.modelId === 'GPT').every((event) => (
      event.dispatchId === identity.dispatchId && event.generationEpoch === identity.generationEpoch
    ))).toBe(true);
    expect(snapshot.queuedMutationCount).toBe(0);
  });

  test('materializes unified pipeline steps as typed generation proof', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'PIPELINE_STEP', meta: { ...meta, step: 'streaming_start' } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'PIPELINE_STEP', meta: { ...meta, step: 'streaming_done' } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1200, label: 'PIPELINE_STEP', meta: { ...meta, step: 'finalization_done' } }, 'GPT');
    const events = (await global.ProofTelemetryLedger.snapshot()).events;
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'GENERATION_START_EVALUATED', payload: expect.objectContaining({ typed: { kind: 'generation_start', state: 'started' } }) }),
      expect.objectContaining({ eventType: 'GENERATION_SIGNAL_CHANGED', payload: expect.objectContaining({ typed: { kind: 'generation_transition', state: 'provider_ui_completed' } }) }),
      expect.objectContaining({ eventType: 'COMPLETION_HYPOTHESIS_EVALUATED', payload: expect.objectContaining({ typed: { kind: 'completion_hypothesis', state: 'probably_complete' } }) })
    ]));
  });

  test('records an accepted submit as confirmed, without contradicting its own payload', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'PROMPT_SUBMITTED_PENDING', meta }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'PROMPT_SUBMITTED_ACCEPTED', meta }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1200, label: 'SEND_DEGRADED_AFTER_SUBMIT', meta }, 'GPT');

    const events = (await global.ProofTelemetryLedger.snapshot()).events
      .filter((event) => event.eventType === 'SUBMISSION_EVIDENCE_CHANGED');
    const stateOf = (label) => events
      .find((event) => event.payload.sourceEventType === label)?.payload.typed;

    expect(stateOf('PROMPT_SUBMITTED_PENDING')).toEqual({ kind: 'submission', state: 'evidence_partial' });
    expect(stateOf('PROMPT_SUBMITTED_ACCEPTED')).toEqual({ kind: 'submission', state: 'confirmed' });
    expect(stateOf('SEND_DEGRADED_AFTER_SUBMIT')).toEqual({ kind: 'submission', state: 'confirmed' });
    events.forEach((event) => {
      expect(global.ProofTelemetryContracts.typedCanonicalConflict(event)).toBeNull();
    });
  });

  test('snapshot flushes records queued immediately before export', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const pendingRecord = global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'ANSWER_GENERATING',
      meta: { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, answerLength: 10 }
    }, 'GPT');

    const snapshot = await global.ProofTelemetryLedger.snapshot();
    await pendingRecord;

    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({ sourceEventType: 'ANSWER_GENERATING' })
      })
    ]));
  });

  test('closes a one-frame observation interval with unique evidence refs', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const identity = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 };
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'LIFECYCLE_SNAPSHOT_ACCEPTED',
      meta: { ...identity, textLength: 10 }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1100,
      label: 'SPA_NAVIGATION',
      meta: identity
    }, 'GPT');
    const closed = (await global.ProofTelemetryLedger.snapshot()).events
      .find((event) => event.eventType === 'OBSERVATION_INTERVAL_CLOSED');
    expect(closed.evidenceRefs).toHaveLength(1);
    expect(new Set(closed.evidenceRefs).size).toBe(closed.evidenceRefs.length);
  });

  test('preserves render outcome for canonical typed facts', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'ANSWER_CARD_RENDER_EVALUATED',
      meta: { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, outcome: 'matched' }
    }, 'GPT');
    const render = (await global.ProofTelemetryLedger.snapshot()).events
      .find((event) => event.eventType === 'ANSWER_CARD_RENDER_EVALUATED');
    expect(render.payload.metadata.outcome).toBe('matched');
    expect(render.payload.typed).toEqual({ kind: 'render', state: 'matched' });
  });

  test('committed snapshot remains available while a durable write is blocked', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    let releaseWrite;
    global.chrome.storage.local.set.mockImplementation((value) => new Promise((resolve) => {
      releaseWrite = () => {
        Object.assign(storage, value);
        resolve();
      };
    }));

    const pendingRecord = global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'ANSWER_GENERATING',
      meta: { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, answerLength: 10 }
    }, 'GPT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const committed = await global.ProofTelemetryLedger.snapshotCommitted();
    expect(committed.snapshotConsistency).toBe('committed_boundary');
    expect(committed.queuedMutationCount).toBeGreaterThan(0);
    expect(committed.events.some((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING')).toBe(false);

    releaseWrite();
    await pendingRecord;
  });

  test('does not persist sensitive text and suppresses exact consecutive no-ops', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const source = {
      ts: 1000,
      label: 'ANSWER_GENERATING',
      details: 'private answer',
      meta: { runSessionId: 42, answerText: 'private answer', answerLength: 14 }
    };
    await global.ProofTelemetryLedger.record(source, 'Claude');
    await global.ProofTelemetryLedger.record(source, 'Claude');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.eventCount).toBe(4);
    expect(JSON.stringify(snapshot)).not.toContain('private answer');
    const sourceEvent = snapshot.events.find((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING');
    expect(sourceEvent.payload.metadata.answerLength).toBe(14);
  });

  test('retains normalization version with privacy-safe measurements', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'ANSWER_SOURCE_MATERIALIZED',
      meta: {
        runSessionId: 42,
        dispatchId: 'GPT:42:1',
        normalizedLength: 140,
        normalizedHash: 'hash:privacy-safe',
        normalizationVersion: 'answer-proof-v1'
      }
    }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.events.find((event) => event.eventType === 'ANSWER_SOURCE_MATERIALIZED')?.payload?.metadata).toEqual(
      expect.objectContaining({ normalizationVersion: 'answer-proof-v1', normalizedLength: 140 })
    );
  });

  test('starts a fresh ledger when the run identity changes', async () => {
    await global.ProofTelemetryLedger.beginRun(1, { wallTs: 1000 });
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'RUN_START', meta: { runSessionId: 1 } }, 'GPT');
    await global.ProofTelemetryLedger.beginRun(2, { wallTs: 2000 });
    await global.ProofTelemetryLedger.record({ ts: 2000, label: 'RUN_START', meta: { runSessionId: 2 } }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.runSessionId).toBe('2');
    expect(snapshot.eventCount).toBe(2);
    expect(snapshot.events[0].eventType).toBe('RUN_CONFIG_RECORDED');
    expect(snapshot.events[1].seq).toBe(2);
    expect(snapshot.runGeneration).toBe(2);
    expect(snapshot.lifecycle.map((event) => event.eventType).slice(-2)).toEqual(['RUN_OPEN_INTENT', 'RUN_OPENED']);
  });

  test('quarantines a late event instead of resetting the active run', async () => {
    await global.ProofTelemetryLedger.beginRun(2, { wallTs: 2000 });
    await global.ProofTelemetryLedger.record({ ts: 2100, label: 'ANSWER_GENERATING', meta: { runSessionId: 2 } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 9999, label: 'LATE_OLD_RUN_EVENT', meta: { runSessionId: 1 } }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.runSessionId).toBe('2');
    expect(snapshot.events.some((event) => event.payload?.sourceEventType === 'LATE_OLD_RUN_EVENT')).toBe(false);
    expect(snapshot.quarantineEventCount).toBe(1);
  });

  test('bounds pending evidence and records detected loss', async () => {
    const limit = global.ProofTelemetryLedger.MAX_PENDING_EVENTS;
    for (let index = 0; index <= limit; index += 1) {
      await global.ProofTelemetryLedger.stagePending({ label: 'PRE_OPEN', meta: { index } }, 'GPT', 7);
    }
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.pendingEventCount).toBe(limit);
    expect(snapshot.stagingLosses).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'PENDING_EVIDENCE_DROPPED', buffer: 'pending' })
    ]));
  });

  test('promotes pre-open evidence in ingestion order after RUN_OPENED', async () => {
    await global.ProofTelemetryLedger.stagePending({ label: 'DISPATCH_SEND', meta: { order: 1 } }, 'GPT', 7);
    await global.ProofTelemetryLedger.stagePending({ label: 'PROMPT_SUBMITTED_ACCEPTED', meta: { order: 2 } }, 'GPT', 7);
    await global.ProofTelemetryLedger.beginRun(7, { wallTs: 1000 });
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const promoted = snapshot.events.filter((event) => event.payload?.metadata?.promotedFromPending);
    expect(promoted.map((event) => event.payload.metadata.promotedStagingIngestSeq)).toEqual([1, 2]);
    expect(snapshot.lifecycle.map((event) => event.eventType)).toEqual(['RUN_OPEN_INTENT', 'RUN_OPENED']);
  });

  test('serializes concurrent run intents with unique burned generations', async () => {
    await Promise.all([
      global.ProofTelemetryLedger.beginRun('a', { wallTs: 9000 }),
      global.ProofTelemetryLedger.beginRun('b', { wallTs: 1 })
    ]);
    // This assertion is about generation burning across two runs, so it needs
    // the full history explicitly: an unscoped snapshot now returns only the
    // active run session, which is what keeps an export from mixing sessions.
    const snapshot = await global.ProofTelemetryLedger.snapshot({ allRunSessions: true });
    const intents = snapshot.lifecycle.filter((event) => event.eventType === 'RUN_OPEN_INTENT');
    expect(intents.map((event) => event.runGeneration)).toEqual([1, 2]);
    expect(snapshot.status).toBe('active');
    const scoped = await global.ProofTelemetryLedger.snapshot();
    expect(scoped.runSessionId).toBe('b');
  });

  test('records producer reordering and closes observation coverage after worker restart', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 };
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'LIFECYCLE_SNAPSHOT_ACCEPTED',
      meta,
      clock: { producerEpochId: 'document-1', producerSequence: 2, observedAtLocalMonoMs: 10, sentAtLocalMonoMs: 12, originKind: 'document' }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1,
      label: 'ANSWER_GENERATING',
      meta,
      clock: { producerEpochId: 'document-1', producerSequence: 1, observedAtLocalMonoMs: 14, sentAtLocalMonoMs: 15, originKind: 'document' }
    }, 'GPT');
    expect((await global.ProofTelemetryLedger.snapshot()).events.some((event) => event.eventType === 'CLOCK_ORDER_ANOMALY_RECORDED')).toBe(true);

    jest.resetModules();
    delete global.ProofTelemetryLedger;
    require('../background/proof-telemetry-ledger.js');
    await global.ProofTelemetryLedger.recover();
    const recovered = await global.ProofTelemetryLedger.snapshot();
    expect(recovered.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'OBSERVATION_INTERVAL_CLOSED',
        payload: expect.objectContaining({ reason: 'observer_restart', coverage: 'degraded' })
      })
    ]));
  });

  test('suppresses per-signal no-ops across interleaved polling and closes on navigation', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1 };
    const generation = { ts: 1000, label: 'ANSWER_GENERATING', meta: { ...meta, textLength: 10 } };
    await global.ProofTelemetryLedger.record(generation, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1010, label: 'LIFECYCLE_SNAPSHOT_ACCEPTED', meta }, 'GPT');
    await global.ProofTelemetryLedger.record({ ...generation, ts: 1020 }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1030, label: 'SPA_NAVIGATION', meta: { ...meta, navigationEpoch: 2 } }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.events.filter((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING')).toHaveLength(1);
    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'OBSERVATION_INTERVAL_CLOSED',
        payload: expect.objectContaining({ reason: 'navigation', coverage: 'degraded' })
      })
    ]));
    const source = snapshot.events.find((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING');
    expect(source.payload.metadata).not.toHaveProperty('runSessionId');
    expect(source.payload.metadata).not.toHaveProperty('dispatchId');
    expect(source.payload.typed).toEqual(expect.objectContaining({ kind: 'generation', state: 'active' }));
  });

  test('deduplicates within one identity but preserves identical observations from different candidates', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const base = { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, textLength: 100 };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'ANSWER_GENERATING', meta: { ...base, candidateId: 'candidate-a' } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1010, label: 'ANSWER_GENERATING', meta: { ...base, candidateId: 'candidate-a' } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1020, label: 'ANSWER_GENERATING', meta: { ...base, candidateId: 'candidate-b' } }, 'GPT');
    const observations = (await global.ProofTelemetryLedger.snapshot()).events
      .filter((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING');
    expect(observations).toHaveLength(2);
    expect(observations.map((event) => event.candidateId)).toEqual(['candidate-a', 'candidate-b']);
  });

  test('companion events inherit source identity and ambiguous extraction is recorded explicitly', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const base = {
      runSessionId: 42,
      dispatchId: 'GPT:42:1',
      generationEpoch: 1,
      candidateId: 'candidate-a',
      documentInstanceId: 'document-a',
      turnId: 'turn-a',
      navigationEpoch: 7
    };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'PROMPT_SUBMITTED_ACCEPTED', meta: base }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'ANSWER_EXTRACTION_COMPLETED', meta: { ...base, candidateId: 'candidate-a', length: 10 } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1200, label: 'ANSWER_EXTRACTION_COMPLETED', meta: { ...base, candidateId: 'candidate-b', length: 11 } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 1300, label: 'MODEL_FINAL', details: 'SUCCESS', meta: { ...base, candidateId: null, finalStatus: 'SUCCESS' } }, 'GPT');
    const events = (await global.ProofTelemetryLedger.snapshot()).events;
    const companion = events.find((event) => event.eventType === 'SUBMISSION_INFERRED');
    expect(companion).toEqual(expect.objectContaining({
      candidateId: 'candidate-a',
      documentInstanceId: 'document-a',
      turnId: 'turn-a',
      navigationEpoch: 7
    }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'MISSING_EVIDENCE_RECORDED',
        payload: expect.objectContaining({ missingEvidence: 'extraction_identity_ambiguous', status: 'unavailable' })
      })
    ]));
  });

  test('stores canonical terminal facts and delivery proof identity fields', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const base = {
      runSessionId: 42,
      dispatchId: 'GPT:42:1',
      generationEpoch: 1,
      attemptId: 'attempt-1',
      payloadEvidenceId: 'payload-1'
    };
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'MODEL_FINAL',
      details: 'SUCCESS',
      meta: { ...base, finalStatus: 'SUCCESS', answerIdentity: 'current_dispatch' }
    }, 'GPT');
    const terminal = (await global.ProofTelemetryLedger.snapshot()).events
      .find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    expect(terminal.payload.typed).toEqual({ kind: 'terminal_action', state: 'SUCCESS' });
    expect(terminal.payload.metadata).toEqual(expect.objectContaining({
      attemptId: 'attempt-1',
      payloadEvidenceId: 'payload-1'
    }));
  });

  test('aggregates operational polling, quarantines unknown legacy noise and compacts metadata', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = {
      runSessionId: 42,
      dispatchId: 'GPT:42:1',
      generationEpoch: 1,
      telemetryTaxonomy: 'repeated-static-value',
      extVersion: '2.81.141',
      schemaVersion: 'legacy',
      legacyBefore: { huge: 'x'.repeat(500) },
      previousState: { huge: 'y'.repeat(500) },
      reason: 'content_script_unavailable'
    };
    for (let index = 0; index < 300; index += 1) {
      await global.ProofTelemetryLedger.record({ ts: 1000 + index, label: 'ADAPTIVE_PROBE_TICK', meta }, 'GPT');
    }
    for (let index = 0; index < 235; index += 1) {
      await global.ProofTelemetryLedger.record({ ts: 2000 + index, label: 'MANUAL_PING_FAIL', meta }, 'GPT');
    }
    for (let index = 0; index < 100; index += 1) {
      await global.ProofTelemetryLedger.record({ ts: 3000 + index, label: 'UNMAPPED_LEGACY_NOISE', meta }, 'GPT');
    }
    await global.ProofTelemetryLedger.record({
      ts: 4000,
      label: 'ANSWER_GENERATING',
      meta: { ...meta, answerLength: 123, answerHash: 'hash:safe' }
    }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.events.filter((event) => event.eventType === 'OBSERVER_HEALTH_INTERVAL_CLOSED')).toHaveLength(11);
    expect(snapshot.eventCount).toBeLessThan(20);
    expect(snapshot.legacyDebugRecordCount).toBe(1);
    expect(snapshot.events.some((event) => event.payload?.sourceEventType === 'UNMAPPED_LEGACY_NOISE')).toBe(false);
    const answer = snapshot.events.find((event) => event.payload?.sourceEventType === 'ANSWER_GENERATING');
    expect(answer.payload.metadata).toEqual(expect.objectContaining({ answerLength: 123, answerHash: 'hash:safe' }));
    expect(JSON.stringify(snapshot)).not.toContain('telemetryTaxonomy');
    expect(JSON.stringify(snapshot)).not.toContain('legacyBefore');
    expect(answer.clock).not.toHaveProperty('producerSequence');
    expect(answer.clock).not.toHaveProperty('observedAtLocalMonoMs');
    expect(answer.clock).not.toHaveProperty('sentAtLocalMonoMs');
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(100000);
  });

  test('records policy, decision, override and terminal lineage explicitly', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'Grok:42:1', llmName: 'Grok' };
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'DISPATCH_SEND', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'PROMPT_SUBMITTED_ACCEPTED', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 1200, label: 'ANSWER_START_DETECTED', meta: { ...meta, textLength: 10 } }, 'Grok');
    await global.ProofTelemetryLedger.record({ ts: 2000, label: 'FINALIZATION_DECISION', details: 'SUCCESS:accepted', meta }, 'Grok');
    await global.ProofTelemetryLedger.record({
      ts: 2100,
      label: 'MODEL_FINAL',
      details: 'SUCCESS',
      meta: {
        ...meta,
        finalStatus: 'SUCCESS',
        answerEvidenceDispatchId: 'Grok:previous',
        answerEvidenceLength: 120,
        answerIdentity: 'previous_dispatch'
      }
    }, 'Grok');

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
    expect(terminal.payload.metadata).toEqual(expect.objectContaining({
      answerEvidenceDispatchId: 'Grok:previous',
      answerEvidenceLength: 120,
      answerIdentity: 'previous_dispatch'
    }));
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
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
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
    const latestIncidentId = container.derivedViews['model-timeline'].data.GPT.latestIncidentId;
    expect(container.derivedViews['incident-timeline'].data[latestIncidentId]).toEqual(expect.objectContaining({
      postTerminalAuditStatus: 'completed',
      postTerminalAuditConclusion: 'contradicted',
      postTerminalGrowthChars: 25
    }));
  });

  test('links accepted prior-dispatch evidence to an existing prior incident', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'EXTRACTION_COMPLETED',
      proofEventType: 'EXTRACTION_COMPLETED',
      typed: { kind: 'extraction', state: 'completed' },
      meta: { runSessionId: 42, dispatchId: 'GPT:42:prior', generationEpoch: 1, length: 100 }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1100,
      label: 'MODEL_FINAL',
      details: 'SUCCESS',
      meta: {
        runSessionId: 42,
        dispatchId: 'GPT:42:current',
        generationEpoch: 2,
        finalStatus: 'SUCCESS',
        answerEvidenceDispatchId: 'GPT:42:prior'
      }
    }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const terminal = snapshot.events.find((item) => item.eventType === 'MODEL_TERMINAL_RECORDED');
    expect(terminal.payload.metadata.priorIncidentRef)
      .toBe('incident:42|1|GPT|GPT:42:prior|1');
  });

  test('links post-terminal recovery extraction to terminal and recovery decision', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
    const meta = { runSessionId: 42, dispatchId: 'GPT:42:recovery', generationEpoch: 1, llmName: 'GPT' };
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'FINALIZATION_DECISION',
      meta: { ...meta, finalReason: 'manual_recovery', source: 'manual_recovery' }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1100,
      label: 'MODEL_FINAL',
      details: 'SUCCESS',
      meta: { ...meta, finalStatus: 'SUCCESS' }
    }, 'GPT');
    await global.ProofTelemetryLedger.record({
      ts: 1200,
      label: 'ANSWER_EXTRACTION_COMPLETED',
      meta: { ...meta, source: 'terminal_extraction_auto_recovery_1', normalizedLength: 42 }
    }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    const extraction = snapshot.events.find((event) => event.eventType === 'EXTRACTION_COMPLETED');
    const terminal = snapshot.events.find((event) => event.eventType === 'MODEL_TERMINAL_RECORDED');
    const decision = snapshot.events.find((event) => event.eventType === 'FINALIZATION_POLICY_EVALUATED');
    expect(extraction.evidenceRefs).toEqual(expect.arrayContaining([terminal.eventId, decision.eventId]));
  });

  test('materializes an atomic observation frame and candidate inference', async () => {
    await global.ProofTelemetryLedger.beginRun(42, { wallTs: 900 });
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
      maximumSignalSkewMs: null,
      observationCoverage: 'unknown',
      contentScriptAvailable: 'unknown',
      mutationCount: 3
    }));
    const identity = snapshot.events.find((event) => event.eventType === 'CANDIDATE_IDENTITY_INFERRED');
    expect(identity.payload.answerIdentity).toBe('ambiguous');
    expect(identity.evidenceRefs).toHaveLength(1);
  });
});

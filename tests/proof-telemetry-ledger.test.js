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
    require('../background/proof-telemetry-ledger.js');
  });

  afterEach(() => {
    delete global.chrome;
    delete global.ProofOrientedTelemetry;
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
    expect(snapshot.eventCount).toBe(2);
    expect(snapshot.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(snapshot.events.map((event) => event.eventType)).toEqual([
      'SUBMIT_ACTION_OBSERVED',
      'SUBMISSION_EVIDENCE_CHANGED'
    ]);
    expect(snapshot.events[1].monoMs).toBe(200);
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
    expect(snapshot.eventCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('private answer');
    expect(snapshot.events[0].payload.metadata.answerLength).toBe(14);
  });

  test('starts a fresh ledger when the run identity changes', async () => {
    await global.ProofTelemetryLedger.record({ ts: 1000, label: 'RUN_START', meta: { runSessionId: 1 } }, 'GPT');
    await global.ProofTelemetryLedger.record({ ts: 2000, label: 'RUN_START', meta: { runSessionId: 2 } }, 'GPT');
    const snapshot = await global.ProofTelemetryLedger.snapshot();
    expect(snapshot.runSessionId).toBe('2');
    expect(snapshot.eventCount).toBe(1);
    expect(snapshot.events[0].seq).toBe(1);
  });
});

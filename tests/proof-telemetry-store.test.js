describe('segmented proof telemetry persistence', () => {
  let storage;

  beforeEach(() => {
    jest.resetModules();
    storage = {};
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]]))),
          set: jest.fn(async (value) => Object.assign(storage, value))
        }
      }
    };
    delete global.indexedDB;
    delete global.ProofTelemetryStore;
    delete global.ProofTelemetryLedger;
    delete global.ProofOrientedTelemetry;
    require('../shared/proof-telemetry-contracts.js');
    require('../shared/proof-telemetry-clock.js');
    require('../shared/proof-oriented-telemetry.js');
    require('../shared/proof-telemetry-policy.js');
    require('../shared/proof-telemetry-audit.js');
    require('../background/proof-telemetry-store.js');
  });

  afterEach(() => {
    delete global.chrome;
    delete global.ProofTelemetryStore;
    delete global.ProofTelemetryLedger;
  });

  test('uses named segmented stores and keeps a compact active pointer', async () => {
    expect(global.ProofTelemetryStore.STORE_NAMES).toEqual({
      lifecycle: 'lifecycle',
      events: 'canonicalEvents',
      incidents: 'incidents',
      quarantine: 'quarantine',
      attachments: 'attachments',
      meta: 'meta'
    });
    await global.ProofTelemetryStore.saveState({
      runSessionId: 'run', runGeneration: 1, status: 'active', nextRunGeneration: 2, nextIngestSeq: 2,
      events: [{ eventId: 'event-0000000001', ingestSeq: 1, runSessionId: 'run', runGeneration: 1, modelId: 'GPT', dispatchId: 'd1', generationEpoch: 1 }],
      lifecycle: [], quarantine: []
    });
    expect(storage[global.ProofTelemetryStore.POINTER_KEY]).toEqual(expect.objectContaining({
      runSessionId: 'run', runGeneration: 1, storageMode: 'fallback-test-only'
    }));
    expect(storage[global.ProofTelemetryStore.POINTER_KEY]).not.toHaveProperty('events');
    expect(await global.ProofTelemetryStore.readIncident({ runSessionId: 'run', runGeneration: 1, modelId: 'GPT', dispatchId: 'd1', generationEpoch: 1 })).toHaveLength(1);
    await global.ProofTelemetryStore.putAttachment({ attachmentId: 'sha256:safe', contentHash: 'sha256:safe', redacted: true });
    expect(await global.ProofTelemetryStore.getAttachment('sha256:safe')).toEqual(expect.objectContaining({ redacted: true }));
  });

  test('survives ledger module restart without reusing run or ingestion counters', async () => {
    require('../background/proof-telemetry-ledger.js');
    await global.ProofTelemetryLedger.beginRun('run-1', { wallTs: 1000 });
    await global.ProofTelemetryLedger.record({ ts: 1100, label: 'DISPATCH_SEND', meta: { runSessionId: 'run-1', dispatchId: 'd1', generationEpoch: 1 } }, 'GPT');
    const before = await global.ProofTelemetryLedger.snapshot();

    jest.resetModules();
    delete global.ProofTelemetryStore;
    delete global.ProofTelemetryLedger;
    require('../background/proof-telemetry-store.js');
    require('../background/proof-telemetry-ledger.js');
    const after = await global.ProofTelemetryLedger.snapshot();
    expect(after.events).toEqual(before.events);
    await global.ProofTelemetryLedger.beginRun('run-2', { wallTs: 1 });
    const next = await global.ProofTelemetryLedger.snapshot();
    expect(next.runGeneration).toBe(2);
    expect(next.lastIngestSeq).toBeGreaterThan(before.lastIngestSeq);
  });

  test('does not activate a run when the persistence transaction fails', async () => {
    global.ProofTelemetryStore = {
      loadState: jest.fn(async () => null),
      saveState: jest.fn(async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); })
    };
    require('../background/proof-telemetry-ledger.js');
    await expect(global.ProofTelemetryLedger.beginRun('run-quota')).rejects.toThrow('quota');
    expect(global.ProofTelemetryStore.saveState).toHaveBeenCalledTimes(1);
  });
});

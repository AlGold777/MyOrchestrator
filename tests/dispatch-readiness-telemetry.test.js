const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

const evt = (platform, label, ts, meta = {}, details = '') => ({
  ts,
  type: 'TELEMETRY',
  label,
  details,
  level: 'info',
  platform,
  meta: { llmName: platform, runSessionId: 77, dispatchId: `${platform}:77:1`, ...meta }
});

describe('dispatch readiness diagnostics reach the canonical ledger', () => {
  test('tab and handshake events are exported instead of being dropped as debug', () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('Qwen', 'TAB_DISCARDED_RELOAD', 1000),
      evt('Qwen', 'TAB_READY_WAIT_END', 1100, { waitMs: 7400, ok: true, phase: 'reload' }),
      evt('Qwen', 'READY_REANNOUNCE_REQUESTED', 1200, { tabId: 5, requested: true }),
      evt('Qwen', 'HANDSHAKE_TIMEOUT', 1300, { timeoutMs: 6000 })
    ], { runSessionId: 77 });

    const bySource = Object.fromEntries(ledger.map((event) => [event.payload.sourceEventType, event]));
    expect(Object.keys(bySource)).toHaveLength(4);
    expect(bySource.TAB_DISCARDED_RELOAD.eventType).toBe('PAGE_HEALTH_OBSERVED');
    expect(bySource.TAB_READY_WAIT_END.eventType).toBe('PAGE_HEALTH_OBSERVED');
    expect(bySource.READY_REANNOUNCE_REQUESTED.eventType).toBe('PAGE_HEALTH_OBSERVED');
    expect(bySource.HANDSHAKE_TIMEOUT.eventType).toBe('OBSERVER_HEALTH_OBSERVED');
    expect(bySource.TAB_DISCARDED_RELOAD.payload.typed).toEqual({ kind: 'observation', state: 'degraded' });
    expect(bySource.HANDSHAKE_TIMEOUT.payload.typed).toEqual({ kind: 'observation', state: 'degraded' });
  });
});

describe('pre-send phase breakdown in the runtime ledger', () => {
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

  test('DISPATCH_SEND keeps the phase split through metadata compaction', async () => {
    await global.ProofTelemetryLedger.beginRun(77, { wallTs: 900, expectedModels: ['Grok'] });
    await global.ProofTelemetryLedger.record({
      ts: 1000,
      label: 'DISPATCH_SEND',
      level: 'info',
      details: 'readyWaitMs=10547',
      meta: {
        runSessionId: 77,
        dispatchId: 'Grok:77:1',
        llmName: 'Grok',
        readyWaitMs: 10547,
        tabReadyMs: 8100,
        ackWaitMs: 2200,
        noFocusProbeMs: 240
      }
    }, 'Grok');

    const snapshot = await global.ProofTelemetryLedger.snapshot({ runSessionId: 77 });
    const sent = snapshot.events.find((event) => event.payload.sourceEventType === 'DISPATCH_SEND');
    expect(sent.payload.metadata).toEqual(expect.objectContaining({
      readyWaitMs: 10547,
      tabReadyMs: 8100,
      ackWaitMs: 2200,
      noFocusProbeMs: 240
    }));
  });
});

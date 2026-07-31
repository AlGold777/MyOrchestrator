// Field defect: a JSON telemetry export taken after a page reload carried events
// from an earlier run session while labelling the file with the current
// runSessionId, so one export silently described two sessions.
//
// Cause: the results page requests the snapshot with `runSessionId: null`
// (it does not track the active session), and the ledger read null as
// "every run ever recorded" rather than "the run I am looking at".
//
// An absent scope now resolves to the ledger's own current run session.
// `allRunSessions: true` remains as the explicit opt-in for the full history.
describe('proof telemetry snapshot run-session scope', () => {
  let storage;

  const seedTwoSessions = async () => {
    const ledger = global.ProofTelemetryLedger;
    await ledger.beginRun(1001, { wallTs: 900 });
    await ledger.record({
      ts: 1000,
      label: 'DISPATCH_SEND',
      level: 'info',
      meta: { runSessionId: 1001, dispatchId: 'Perplexity:1001:1', llmName: 'Perplexity' }
    }, 'Perplexity');
    await ledger.beginRun(2002, { wallTs: 5000 });
    await ledger.record({
      ts: 5100,
      label: 'DISPATCH_SEND',
      level: 'info',
      meta: { runSessionId: 2002, dispatchId: 'Perplexity:2002:1', llmName: 'Perplexity' }
    }, 'Perplexity');
  };

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

  test('a snapshot without an explicit scope carries only the current run session', async () => {
    await seedTwoSessions();
    // This is exactly the call the JSON export makes.
    const snap = await global.ProofTelemetryLedger.snapshot({ runSessionId: null });
    const sessions = new Set(snap.events.map((event) => String(event.runSessionId)));
    expect(sessions).toEqual(new Set(['2002']));
    expect(String(snap.runSessionId)).toBe('2002');
    expect(snap.runSessionScope).toBe('single_run_session');
  });

  test('the exported label and the exported events describe the same session', async () => {
    await seedTwoSessions();
    const snap = await global.ProofTelemetryLedger.snapshot({});
    for (const event of snap.events) {
      expect(String(event.runSessionId)).toBe(String(snap.runSessionId));
    }
  });

  // `beginRun` resets state.events but deliberately keeps state.lifecycle, so
  // the lifecycle stream is where earlier sessions actually survived into an
  // export. This is the leak the scope fix closes.
  test('lifecycle records of earlier sessions do not leak into an unscoped snapshot', async () => {
    await seedTwoSessions();
    const snap = await global.ProofTelemetryLedger.snapshot({ runSessionId: null });
    const sessions = new Set((snap.lifecycle || []).map((event) => String(event.runSessionId)));
    expect(sessions.has('1001')).toBe(false);
  });

  test('the whole history stays reachable, but only on an explicit opt-in', async () => {
    await seedTwoSessions();
    const snap = await global.ProofTelemetryLedger.snapshot({ allRunSessions: true });
    const sessions = new Set((snap.lifecycle || []).map((event) => String(event.runSessionId)));
    expect(sessions.has('1001')).toBe(true);
    expect(sessions.has('2002')).toBe(true);
    expect(snap.runSessionScope).toBe('all_run_sessions');
  });

  test('snapshotCommitted scopes identically, so the retry path cannot widen it', async () => {
    await seedTwoSessions();
    const committed = await global.ProofTelemetryLedger.snapshotCommitted({ runSessionId: null });
    const sessions = new Set(committed.events.map((event) => String(event.runSessionId)));
    expect(sessions).toEqual(new Set(['2002']));
    expect(committed.runSessionScope).toBe('single_run_session');
  });
});

describe('diagnostics buffer run-session scope', () => {
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
    delete global.ProofTelemetryLedger;
  });

  // The GET_DIAG_EVENTS scope filter reads this. Without it the optional call
  // resolves to undefined and the filter silently becomes a no-op, which would
  // look exactly like a fix while changing nothing.
  test('the ledger exposes the active run session synchronously', async () => {
    expect(typeof global.ProofTelemetryLedger.currentRunSessionId).toBe('function');
    expect(global.ProofTelemetryLedger.currentRunSessionId()).toBeNull();
    await global.ProofTelemetryLedger.beginRun(4242, { wallTs: 10 });
    expect(String(global.ProofTelemetryLedger.currentRunSessionId())).toBe('4242');
  });

  test('GET_DIAG_EVENTS scopes to the active run and keeps run-less system lines', () => {
    const router = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'background', 'message-router.js'), 'utf8'
    );
    const handler = router.slice(
      router.indexOf("case 'GET_DIAG_EVENTS'"),
      router.indexOf('sendResponse({ success: true, events: capped })')
    );
    expect(handler).toContain('ProofTelemetryLedger?.currentRunSessionId?.()');
    // Entries with no run identity must survive, or setup/system lines vanish.
    expect(handler).toContain('return true;');
    expect(handler).toContain('allRunSessions');
  });
});

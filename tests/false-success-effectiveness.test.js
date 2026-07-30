describe('False success runtime effectiveness matrix', () => {
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

  const baseMeta = (runSessionId, dispatchId = 'dispatch-1', extra = {}) => ({
    runSessionId,
    dispatchId,
    generationEpoch: 1,
    llmName: 'GPT',
    ...extra
  });

  async function record(label, ts, meta) {
    await global.ProofTelemetryLedger.record({ ts, label, meta }, 'GPT');
  }

  async function verdict(runSessionId, dispatchId = 'dispatch-1') {
    const snapshot = await global.ProofTelemetryLedger.snapshot({ runSessionId });
    const container = await global.ProofOrientedTelemetry.buildAllPresets(snapshot.events, {
      canonicalLedger: true,
      runSessionId,
      exportedAt: 20000
    });
    const entries = Object.entries(container.reports['false-success'].reportDescriptor.applicability.byIncident);
    const match = entries.find(([, value]) => value?.incidentScope?.dispatchId === dispatchId)
      || entries.find(([incidentId]) => incidentId.includes(`|${dispatchId}|`));
    return { verdict: match?.[1]?.diagnosticVerdict || 'unknown', snapshot, container };
  }

  async function terminalPrefix(runSessionId, terminalMeta = {}) {
    const meta = baseMeta(runSessionId, 'dispatch-1', terminalMeta);
    await record('ANSWER_GENERATING', 1000, { ...meta, textLength: 100 });
    await record('FINALIZATION_DECISION', 1100, { ...meta, accepted: true, status: 'SUCCESS' });
    await record('MODEL_FINAL', 1200, { ...meta, finalStatus: 'SUCCESS', answerLen: 100 });
    return meta;
  }

  test('normal closed window refutes the incident, while an open throttled frame stays unknown', async () => {
    await global.ProofTelemetryLedger.beginRun('normal', { wallTs: 900 });
    const meta = await terminalPrefix('normal');
    await record('POST_TERMINAL_ANSWER_OBSERVED', 2200, {
      ...meta,
      textLength: 100,
      observationWindowClosed: false,
      observationCoverage: 'partial'
    });
    expect((await verdict('normal')).verdict).toBe('unknown');
    await record('POST_TERMINAL_ANSWER_WINDOW_CLOSED', 9200, {
      ...meta,
      textLength: 100,
      observationWindowClosed: true,
      observationWindowOutcome: 'unchanged',
      observationCoverage: 'complete'
    });
    expect((await verdict('normal')).verdict).toBe('not_confirmed');
  });

  test('real post-terminal growth is confirmed', async () => {
    await global.ProofTelemetryLedger.beginRun('growth', { wallTs: 900 });
    const meta = await terminalPrefix('growth');
    await record('POST_TERMINAL_ANSWER_OBSERVED', 2200, { ...meta, textLength: 150 });
    expect((await verdict('growth')).verdict).toBe('confirmed');
  });

  test('normalized recovery after terminal is confirmed', async () => {
    await global.ProofTelemetryLedger.beginRun('recovery', { wallTs: 900 });
    const normalization = { normalizedLength: 100, normalizedHash: 'hash:a', normalizationVersion: 'answer-proof-v1' };
    const meta = await terminalPrefix('recovery', normalization);
    await record('ANSWER_SOURCE_MATERIALIZED', 2500, {
      ...meta,
      normalizedLength: 170,
      normalizedHash: 'hash:b',
      normalizationVersion: 'answer-proof-v1'
    });
    expect((await verdict('recovery')).verdict).toBe('confirmed');
  });

  test('repeat dispatch, attachments, SPA mismatch and tab close do not manufacture incidents', async () => {
    await global.ProofTelemetryLedger.beginRun('negative-controls', { wallTs: 900 });
    const meta = await terminalPrefix('negative-controls', { documentInstanceId: 'document-a', navigationEpoch: 1 });
    await record('ANSWER_GENERATING', 2000, {
      ...baseMeta('negative-controls', 'dispatch-2'),
      textLength: 900
    });
    await record('ATTACHMENT_CONFIRMED', 2100, { ...meta, attachmentCount: 1 });
    await record('POST_TERMINAL_ANSWER_OBSERVED', 2200, {
      ...meta,
      documentInstanceId: 'document-a',
      navigationEpoch: 2,
      textLength: 180
    });
    await record('TAB_CLOSED', 2300, meta);
    const result = await verdict('negative-controls');
    expect(result.verdict).toBe('unknown');
    expect(result.snapshot.events.filter((event) => event.eventType === 'POST_TERMINAL_AUDIT_COMPLETED')).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ conclusion: 'unknown', navigationLineage: 'mismatch' }) })
    ]));
  });
});

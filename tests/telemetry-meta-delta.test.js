const { compactTelemetryEvents, expandTelemetryEvents } = require('../shared/telemetry-meta-delta.js');

function makeEvent(platform, ts, metaOverrides = {}) {
  return {
    ts,
    type: 'TELEMETRY',
    label: 'SOME_LABEL',
    details: 'details text',
    level: 'info',
    platform,
    meta: {
      extVersion: '2.81.25',
      runSessionId: 1000,
      dispatchId: 'd-1',
      schemaVersion: 2,
      llmName: platform,
      tabId: 42,
      debateRunId: null,
      pipelineRunId: null,
      telemetryTaxonomy: { schemaVersion: 1, eventKey: 'X', domain: 'runtime', stage: 'runtime', outcome: 'info', eventClass: 'runtime_info' },
      ...metaOverrides
    }
  };
}

describe('telemetry meta delta compaction', () => {
  test('round-trips a run of identical-meta events for one platform', () => {
    const events = [
      makeEvent('GPT', 1),
      makeEvent('GPT', 2),
      makeEvent('GPT', 3)
    ];
    const compacted = compactTelemetryEvents(events);
    expect(compacted[0]).toEqual(events[0]);
    expect(Object.keys(compacted[1].meta)).toEqual(['__telemetryMetaDelta']);
    expect(Object.keys(compacted[2].meta)).toEqual(['__telemetryMetaDelta']);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('round-trips when a field changes between events (e.g. dispatchId)', () => {
    const events = [
      makeEvent('Claude', 1, { dispatchId: 'd-1' }),
      makeEvent('Claude', 2, { dispatchId: 'd-2' }),
      makeEvent('Claude', 3, { dispatchId: 'd-2' })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(compacted[1].meta.dispatchId).toBe('d-2');
    expect(compacted[1].meta.extVersion).toBeUndefined();
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('round-trips when a key is removed on a later event', () => {
    const events = [
      makeEvent('Grok', 1, { customFlag: true }),
      makeEvent('Grok', 2)
    ];
    delete events[1].meta.customFlag;
    const compacted = compactTelemetryEvents(events);
    expect(compacted[1].meta.__telemetryMetaRemovedKeys).toEqual(['customFlag']);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('interleaved platforms compact and expand independently', () => {
    const events = [
      makeEvent('GPT', 1),
      makeEvent('Gemini', 2),
      makeEvent('GPT', 3),
      makeEvent('Gemini', 4, { dispatchId: 'd-9' })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('nested telemetryTaxonomy changes are captured and restored', () => {
    const events = [
      makeEvent('Qwen', 1),
      makeEvent('Qwen', 2, { telemetryTaxonomy: { schemaVersion: 1, eventKey: 'Y', domain: 'dispatch', stage: 'dispatch', outcome: 'success', eventClass: 'dispatch_success' } })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('events without meta or non-object meta pass through unchanged', () => {
    const events = [
      { ts: 1, platform: 'GPT', label: 'A' },
      { ts: 2, platform: 'GPT', label: 'B', meta: null }
    ];
    const compacted = compactTelemetryEvents(events);
    expect(compacted).toEqual(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('single-model run compaction reduces serialized size substantially', () => {
    const events = Array.from({ length: 50 }, (_, i) => makeEvent('Claude', i));
    const compacted = compactTelemetryEvents(events);
    const originalBytes = JSON.stringify(events).length;
    const compactedBytes = JSON.stringify(compacted).length;
    expect(compactedBytes).toBeLessThan(originalBytes * 0.4);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('nested state snapshot emits only the changed leaf, not the whole object', () => {
    const baseState = {
      uiStatus: 'RECEIVING', liveStatus: 'RECEIVING', terminalStatus: null,
      terminalState: 'open', executionState: 'collecting', generationState: 'generating',
      extractionState: 'rejected', answerState: 'candidate', dispatchId: 'Z.ai:1:2',
      tabId: 315184672, answerLength: 1615, answerHash: '62e1438',
      postTerminalNoiseCount: 0, lastTransition: 'STATUS_UPDATE', lastTransitionAt: 1000
    };
    const events = [
      makeEvent('Z.ai', 1, { previousState: { ...baseState }, nextState: { ...baseState } }),
      makeEvent('Z.ai', 2, {
        previousState: { ...baseState },
        nextState: { ...baseState, lastTransitionAt: 2000 }
      })
    ];
    const compacted = compactTelemetryEvents(events);
    // Only the single changed leaf travels, not the 15-field snapshot.
    expect(compacted[1].meta.nextState).toEqual({ lastTransitionAt: 2000 });
    expect(compacted[1].meta.previousState).toBeUndefined();
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('nested key removal inside a state snapshot round-trips', () => {
    const events = [
      makeEvent('Grok', 1, { payload: { status: 'OK', probe: { deep: true }, extra: 1 } }),
      makeEvent('Grok', 2, { payload: { status: 'OK', extra: 1 } })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('object replaced by scalar and scalar replaced by object round-trip', () => {
    const events = [
      makeEvent('GPT', 1, { decisionSnapshot: { a: 1, b: { c: 2 } } }),
      makeEvent('GPT', 2, { decisionSnapshot: null }),
      makeEvent('GPT', 3, { decisionSnapshot: { a: 9 } })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('arrays are replaced atomically and round-trip', () => {
    const events = [
      makeEvent('Qwen', 1, { contradictions: [{ code: 'A' }] }),
      makeEvent('Qwen', 2, { contradictions: [{ code: 'A' }, { code: 'B' }] }),
      makeEvent('Qwen', 3, { contradictions: [] })
    ];
    const compacted = compactTelemetryEvents(events);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('a stuck-model loop of near-identical heavy events compacts far below top-level diffing', () => {
    const heavyState = (tick) => ({
      uiStatus: 'RECEIVING', liveStatus: 'RECEIVING', terminalStatus: null,
      terminalState: 'open', executionState: 'collecting', generationState: 'generating',
      extractionState: 'rejected', answerState: 'candidate', dispatchId: 'Z.ai:1:2',
      tabId: 315184672, answerLength: 1615, answerHash: '62e1438',
      postTerminalNoiseCount: 0, lastTransition: 'STATUS_UPDATE', lastTransitionAt: tick
    });
    const events = Array.from({ length: 100 }, (_, i) => makeEvent('Z.ai', i, {
      previousState: heavyState(1000 + i),
      nextState: heavyState(1001 + i),
      legacyBefore: { status: 'RECEIVING', finalStatus: null, answerLength: 0, pendingFinalAnswerLength: 1615 },
      legacyAfter: { status: 'RECEIVING', finalStatus: null, answerLength: 0, pendingFinalAnswerLength: 1615 },
      payload: { status: 'RECEIVING', reason: null, dispatchId: 'Z.ai:1:2', tabId: 315184672, runSessionId: 1, manualRecovery: false, allowTerminalUpgrade: false }
    }));
    const compacted = compactTelemetryEvents(events);
    const ratio = JSON.stringify(compacted).length / JSON.stringify(events).length;
    // Top-level-only diffing left these near-identical events at ~78% of the
    // original size because one changed leaf re-emitted a whole snapshot;
    // nested diffing must stay far below that.
    expect(ratio).toBeLessThan(0.2);
    expect(expandTelemetryEvents(compacted)).toEqual(events);
  });

  test('legacy format-1 deltas (marker === true) still expand with replace semantics', () => {
    // Written by the previous build: a nested object in the delta meant "replace
    // this key wholesale", not "merge". Such entries can still be in DIAG_KEY
    // storage, so expanding them must not silently resurrect dropped subkeys.
    const legacy = [
      {
        ts: 1, platform: 'GPT', label: 'A',
        meta: { extVersion: '1', payload: { a: 1, b: 2 }, keep: 'yes' }
      },
      {
        ts: 2, platform: 'GPT', label: 'B',
        meta: { __telemetryMetaDelta: true, payload: { a: 9 } }
      }
    ];
    const expanded = expandTelemetryEvents(legacy);
    expect(expanded[1].meta.payload).toEqual({ a: 9 });
    expect(expanded[1].meta.extVersion).toBe('1');
    expect(expanded[1].meta.keep).toBe('yes');
  });

  test('new compaction marks the nested format version', () => {
    const events = [makeEvent('GPT', 1), makeEvent('GPT', 2, { dispatchId: 'd-2' })];
    const compacted = compactTelemetryEvents(events);
    expect(compacted[1].meta.__telemetryMetaDelta).toBe(2);
  });

  test('empty and non-array input is handled safely', () => {
    expect(compactTelemetryEvents([])).toEqual([]);
    expect(compactTelemetryEvents(null)).toEqual([]);
    expect(expandTelemetryEvents(undefined)).toEqual([]);
  });
});

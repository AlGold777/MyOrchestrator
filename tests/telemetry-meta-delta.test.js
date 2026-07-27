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

  test('empty and non-array input is handled safely', () => {
    expect(compactTelemetryEvents([])).toEqual([]);
    expect(compactTelemetryEvents(null)).toEqual([]);
    expect(expandTelemetryEvents(undefined)).toEqual([]);
  });
});

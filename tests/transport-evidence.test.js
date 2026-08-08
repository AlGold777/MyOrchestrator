/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ProviderStreamSemantics = require('../shared/provider-stream-semantics');

const loadIntoWindow = (relPath) => {
  // The extension ships raw files into one shared window; mirror that here
  // rather than requiring the module, so the production wiring is exercised.
  window.eval(fs.readFileSync(path.join(ROOT, relPath), 'utf8'));
};

describe('ProviderStreamSemantics', () => {
  test('recognises the generation endpoint of a known provider', () => {
    expect(ProviderStreamSemantics.isGenerationRequest('chatgpt', 'https://chatgpt.com/backend-api/conversation').match).toBe(true);
    expect(ProviderStreamSemantics.isGenerationRequest('chatgpt', 'https://chatgpt.com/backend-api/models').match).toBe(false);
  });

  test('an unknown platform yields no opinion instead of a guess', () => {
    const verdict = ProviderStreamSemantics.isGenerationRequest('nosuchmodel', 'https://example.com/api/chat');
    expect(verdict.match).toBe(false);
    expect(verdict.reason).toBe('unknown_platform');
  });

  test('finish_reason is read as a terminal reason of its own', () => {
    expect(ProviderStreamSemantics.detectTerminal('{"finish_reason":"length"}')).toEqual(expect.objectContaining({
      kind: 'provider_finish_reason',
      terminalReason: 'LENGTH_LIMIT'
    }));
    expect(ProviderStreamSemantics.detectTerminal('{"stop_reason":"end_turn"}')).toEqual(expect.objectContaining({
      terminalReason: 'STOP'
    }));
  });

  test('the SSE done token is a terminal marker, ordinary deltas are not', () => {
    expect(ProviderStreamSemantics.detectTerminal('data: [DONE]\n')).toEqual(expect.objectContaining({
      kind: 'stream_done_token'
    }));
    expect(ProviderStreamSemantics.detectTerminal('data: {"delta":"hello"}\n')).toBeNull();
  });

  test('a null finish_reason is not treated as terminal', () => {
    expect(ProviderStreamSemantics.detectTerminal('{"finish_reason":null,"delta":"x"}')).toBeNull();
  });

  test('no provider is declared one-to-one before it has been measured', () => {
    Object.keys(ProviderStreamSemantics.PROVIDERS).forEach((platform) => {
      expect(ProviderStreamSemantics.isOneToOne(platform)).toBe(false);
    });
  });
});

describe('fetch-monitor injection', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
    delete window.setupHumanoidFetchMonitor;
    delete window.__humanoidFetchMonitorHandlers;
    delete window.__humanoidFetchBridge_GPT;
    global.chrome = { runtime: { getURL: (p) => `chrome-extension://test/${p}` } };
    window.ProviderStreamSemantics = ProviderStreamSemantics;
    loadIntoWindow('content-scripts/fetch-monitor.js');
  });

  test('the init payload reaches the main world on the script element, not on an isolated-world global', () => {
    window.setupHumanoidFetchMonitor('GPT', () => {}, { platform: 'chatgpt' });
    const script = document.querySelector('script[src*="fetch-monitor-bridge"]');
    expect(script).toBeTruthy();
    const payload = JSON.parse(script.dataset.hfmInit);
    expect(payload.channel).toBe('humanoid-fetch-monitor');
    expect(payload.model).toBe('GPT');
    expect(payload.hasGenerationContract).toBe(true);
    expect(payload.generationPatterns.length).toBeGreaterThan(0);
    expect(payload.terminalPatterns.length).toBeGreaterThan(0);
  });

  test('a platform with no stream contract is reported as such rather than silently assumed', () => {
    window.setupHumanoidFetchMonitor('Unknown', () => {}, { platform: 'nosuchmodel' });
    const script = document.querySelector('script[src*="fetch-monitor-bridge"]');
    const payload = JSON.parse(script.dataset.hfmInit);
    expect(payload.hasGenerationContract).toBe(false);
    expect(window.humanoidFetchMonitorState().hasGenerationContract).toBe(false);
  });

  test('registering the same model twice keeps exactly one failure handler', () => {
    const first = jest.fn();
    const second = jest.fn();
    window.setupHumanoidFetchMonitor('GPT', first, { platform: 'chatgpt' });
    window.setupHumanoidFetchMonitor('GPT', second, { platform: 'chatgpt' });
    expect(window.__humanoidFetchMonitorHandlers).toHaveLength(1);
    expect(window.__humanoidFetchMonitorHandlers[0].handler).toBe(first);
  });
});

describe('TransportEvidence', () => {
  let TransportEvidence;
  let emit;

  beforeEach(() => {
    const listeners = new Set();
    emit = (event) => listeners.forEach((listener) => listener(event));
    window.onHumanoidStreamEvent = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    window.humanoidFetchMonitorState = () => ({ injected: true, hasGenerationContract: true, platform: 'chatgpt' });
    jest.resetModules();
    TransportEvidence = require('../content-scripts/transport-evidence');
    TransportEvidence.reset();
  });

  test('an open stream for this run is a contradiction, not weak evidence', () => {
    const observer = TransportEvidence.forPlatform('chatgpt').beginRun({ startedAt: 1000 });
    emit({ kind: 'stream', phase: 'request', at: 1100, streamId: 's1', url: '/backend-api/conversation' });
    emit({ kind: 'stream', phase: 'start', at: 1150, streamId: 's1' });
    emit({ kind: 'stream', phase: 'first_chunk', at: 1200, streamId: 's1' });

    const snapshot = observer.snapshot();
    expect(snapshot.streamOpen).toBe(true);
    expect(snapshot.contradictions[0].kind).toBe('stream_open');
    expect(snapshot.signals).toHaveLength(0);
  });

  test('a terminal marker becomes a P0 signal carrying its finish reason', () => {
    const observer = TransportEvidence.forPlatform('chatgpt').beginRun({ startedAt: 1000 });
    emit({ kind: 'stream', phase: 'request', at: 1100, streamId: 's1' });
    emit({ kind: 'stream', phase: 'start', at: 1150, streamId: 's1' });
    emit({
      kind: 'stream', phase: 'terminal_marker', at: 1400, streamId: 's1',
      markerKind: 'provider_finish_reason', finishReason: 'length', terminalReason: 'LENGTH_LIMIT'
    });
    emit({ kind: 'stream', phase: 'end', at: 1450, streamId: 's1', bytes: 2048, chunkCount: 12 });

    const snapshot = observer.snapshot();
    expect(snapshot.streamOpen).toBe(false);
    expect(snapshot.terminalReason).toBe('LENGTH_LIMIT');
    expect(snapshot.signals.map((signal) => signal.kind)).toEqual(['provider_finish_reason', 'stream_closed']);
    expect(snapshot.signals[0].correlationMethod).toBe('causal_order');
    expect(snapshot.bytes).toBe(2048);
  });

  test('a stream that ended without a marker gives only P1 closure', () => {
    const observer = TransportEvidence.forPlatform('chatgpt').beginRun({ startedAt: 1000 });
    emit({ kind: 'stream', phase: 'request', at: 1100, streamId: 's1' });
    emit({ kind: 'stream', phase: 'end', at: 1300, streamId: 's1', bytes: 10, chunkCount: 1, terminalMarkerSeen: false });

    const snapshot = observer.snapshot();
    expect(snapshot.terminal).toBeNull();
    expect(snapshot.signals.map((signal) => signal.kind)).toEqual(['stream_closed']);
  });

  test('a stream from a previous turn is not counted as evidence for this one', () => {
    const observer = TransportEvidence.forPlatform('chatgpt');
    observer.beginRun({ startedAt: 1000 });
    emit({ kind: 'stream', phase: 'request', at: 500, streamId: 'old' });
    emit({ kind: 'stream', phase: 'end', at: 600, streamId: 'old', terminalMarkerSeen: true, markerKind: 'stream_done_token' });

    const snapshot = observer.snapshot();
    expect(snapshot.streamCount).toBe(0);
    expect(snapshot.signals).toHaveLength(0);
  });

  test('an unreadable stream degrades the observer instead of reporting an end', () => {
    const observer = TransportEvidence.forPlatform('chatgpt').beginRun({ startedAt: 1000 });
    emit({ kind: 'stream', phase: 'request', at: 1100, streamId: 's1' });
    emit({ kind: 'stream', phase: 'unobservable', at: 1200, streamId: 's1', reason: 'not_a_readable_stream' });

    const snapshot = observer.snapshot();
    expect(snapshot.unobservableCount).toBe(1);
    expect(snapshot.observerInput.schemaMismatch).toBe(true);
    expect(snapshot.signals).toHaveLength(0);
  });

  test('without the hook the observer declares itself unavailable rather than quiet', () => {
    window.humanoidFetchMonitorState = () => ({ injected: false, hasGenerationContract: false });
    jest.resetModules();
    const Fresh = require('../content-scripts/transport-evidence');
    Fresh.reset();
    const snapshot = Fresh.forPlatform('gemini').beginRun({ startedAt: 1000 }).snapshot();
    expect(snapshot.available).toBe(false);
    expect(snapshot.observerInput.installed).toBe(false);
  });
});

const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

// Drives the production watcher, not a pure function beside it: the gate under
// test is the one `waitForCompletion` actually runs.
const bootstrapWatcher = (streamEvents) => {
  ['AnswerPipeline', 'AnswerPipelineConfig', 'AnswerPipelineSelectors', 'TurnResolver',
    'UnifiedPipelineModules', 'SelectorCircuit', 'RunResultContract', 'ObserverHealth',
    'CompletionEvidenceLadder', 'ProviderStreamSemantics', 'TransportEvidence'
  ].forEach((key) => { delete window[key]; });
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = { shouldUse: jest.fn(() => true), report: jest.fn() };

  const listeners = new Set();
  window.onHumanoidStreamEvent = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  window.humanoidFetchMonitorState = () => ({ injected: true, hasGenerationContract: true, platform: 'chatgpt' });
  streamEvents.emit = (event) => listeners.forEach((listener) => listener(event));

  loadScript('shared/run-result-contract.js');
  loadScript('shared/observer-health.js');
  loadScript('shared/completion-evidence-ladder.js');
  loadScript('shared/provider-stream-semantics.js');
  loadScript('content-scripts/transport-evidence.js');
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/turn-resolver.js');
  loadScript('content-scripts/answer-structure.js');
  loadScript('content-scripts/generation-signal.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
  window.TransportEvidence.reset();
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 10, bottom: 42, left: 10, right: 130, x: 10, y: 10, toJSON() { return this; } };
    }
  });
};

const settledAnswerDom = () => {
  document.body.innerHTML = `
    <main>
      <article data-message-author-role="assistant">
        <div class="prose">${'Finished answer text. '.repeat(40)}</div>
      </article>
    </main>
  `;
};

const tick = async (times = 60, ms = 500) => {
  for (let i = 0; i < times; i += 1) {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  }
};

describe('watcher: transport evidence gates the commit', () => {
  const streamEvents = {};

  beforeEach(() => {
    bootstrapWatcher(streamEvents);
    setVisibleRects();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('an open provider stream vetoes a commit the DOM signals would have made', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    streamEvents.emit({ kind: 'stream', phase: 'request', at: Date.now(), streamId: 's1', url: '/backend-api/conversation' });
    streamEvents.emit({ kind: 'stream', phase: 'start', at: Date.now(), streamId: 's1' });
    streamEvents.emit({ kind: 'stream', phase: 'first_chunk', at: Date.now(), streamId: 's1' });

    await tick(40);
    // The DOM is quiet and stable, which alone used to be enough.
    expect(watcher.criteria.criteria.contentStable.met).toBe(true);
    expect(settled).toBeNull();
    expect(watcher.lastLadderVerdict.veto.kinds).toContain('stream_open');
  });

  test('a terminal marker correlated only by time does not commit the run', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    const now = Date.now();
    streamEvents.emit({ kind: 'stream', phase: 'request', at: now, streamId: 's1', url: '/backend-api/conversation' });
    streamEvents.emit({ kind: 'stream', phase: 'start', at: now, streamId: 's1' });
    streamEvents.emit({
      kind: 'stream', phase: 'terminal_marker', at: now, streamId: 's1',
      markerKind: 'stream_done_token', terminalReason: 'STOP'
    });
    streamEvents.emit({ kind: 'stream', phase: 'end', at: now, streamId: 's1', bytes: 900, chunkCount: 7, terminalMarkerSeen: true });

    await tick(20);

    // The marker is recorded as P0 and lifts the guarantee above DOM-only, but
    // causal ordering cannot say the stream was this run's, so the run does not
    // commit on it — it finishes through the DOM path, typed as suspicion.
    expect(settled).not.toBeNull();
    expect(settled.reason).not.toBe('transport_terminal');
    expect(settled.evidence.strongestClass).toBe('P0');
    expect(settled.evidence.transport.streamOpen).toBe(false);
    expect(settled.evidence.guarantee).toBe('DEGRADED');
    expect(settled.evidence.reasons).toContain('terminal_fact_not_attributed_to_this_run');
    expect(settled.runProof.type).toBe('SUSPECTED_COMPLETE');
  });

  test('the run proof names the dispatch it claims to be about', async () => {
    settledAnswerDom();
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    let settled = null;
    watcher.waitForCompletion({
      container: document.querySelector('main'),
      dispatchId: 'GPT:1781159284885:3'
    }).then((r) => { settled = r; });

    await tick(40);

    expect(settled).not.toBeNull();
    expect(settled.runProof.dispatchId).toBe('GPT:1781159284885:3');
  });

  test('a DOM-only completion is typed as suspected, never as a proven commit', async () => {
    settledAnswerDom();
    // No transport observer available at all: the DOM is the only witness.
    window.humanoidFetchMonitorState = () => ({ injected: false, hasGenerationContract: false });
    window.TransportEvidence.reset();

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    await tick(40);

    expect(settled).not.toBeNull();
    expect(settled.completed).toBe(true);
    expect(settled.runProof.type).toBe('SUSPECTED_COMPLETE');
    expect(settled.runProof.guarantee).toBe('HEURISTIC');
    expect(settled.runProof.reasons).toContain('terminality_not_proven');
  });

  test('text shorter than its own maximum vetoes the commit until it recovers', async () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Long answer body. '.repeat(60)}</div>
        </article>
      </main>
    `;
    window.humanoidFetchMonitorState = () => ({ injected: false, hasGenerationContract: false });
    window.TransportEvidence.reset();

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    await tick(2);
    // The turn re-renders and the visible answer collapses to a fragment.
    document.querySelector('.prose').textContent = 'Long answer body.';
    await tick(30);

    expect(settled).toBeNull();
    expect(watcher.lastLadderVerdict.veto.kinds).toContain('text_shrunk');
  });

  test('a hard timeout still ends the run, and is typed as unproven rather than done', async () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">short</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>
    `;
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });
    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') }).then((r) => { settled = r; });

    await tick(460);

    expect(settled).not.toBeNull();
    expect(settled.reason).toBe('hard_timeout');
    expect(settled.completed).toBe(false);
    expect(['UNKNOWN', 'SUSPECTED_COMPLETE']).toContain(settled.runProof.type);
    expect(settled.runProof.textReadable).toBe(false);
  });
});

const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

const bootstrapWatcher = () => {
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.TurnResolver;
  delete window.UnifiedPipelineModules;
  delete window.SelectorCircuit;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = { shouldUse: jest.fn(() => true), report: jest.fn() };
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/turn-resolver.js');
  loadScript('content-scripts/answer-structure.js');
  loadScript('content-scripts/generation-signal.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 10, bottom: 42, left: 10, right: 130, x: 10, y: 10, toJSON() { return this; } };
    }
  });
};

describe('false success: watcher completion guards', () => {
  beforeEach(() => { bootstrapWatcher(); setVisibleRects(); });

  test('visible Stop blocks success after soft deadline and ends only as hard timeout', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Partial answer text. '.repeat(30)}</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    expect(watcher.getStopVisible()).toBe(true);
    expect(window.GenerationSignal.inspect({
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt
    }).active).toBe(true);

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') })
      .then((r) => { settled = r; });

    for (let i = 0; i < 40; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
    const at20s = settled;

    for (let i = 0; i < 360; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
    const beforeHardDeadline = settled;

    for (let i = 0; i < 60; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
    const afterHardDeadline = settled;

    expect(document.querySelector('button[data-testid="stop-button"]')).not.toBeNull();
    expect(at20s).toBeNull();
    expect(beforeHardDeadline).toBeNull();
    expect(afterHardDeadline).not.toBeNull();
    expect(afterHardDeadline.reason).toBe('hard_timeout');
    expect(afterHardDeadline.completed).toBe(false);
    expect(watcher.getStopVisible()).toBe(true);
    jest.useRealTimers();
  });

  // F02. После этапа 3.2 ожидание меняется на 450000.
  test('adaptive soft/hard deadline ignores expected answer size', () => {
    document.body.innerHTML = `<main><article data-message-author-role="assistant"><div class="prose">x</div></article></main>`;
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'veryLong' });
    const t = watcher.timeoutManager.calculateTimeout(watcher.getCurrentContentLength());
    expect(t.soft).toBe(50000);
  });
});

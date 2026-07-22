const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  window.eval(content);
};

const bootstrapWatcher = () => {
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.UnifiedPipelineModules;
  delete window.SelectorCircuit;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = {
    shouldUse: jest.fn(() => true),
    report: jest.fn()
  };
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return {
        width: 120,
        height: 32,
        top: 10,
        bottom: 42,
        left: 10,
        right: 130,
        x: 10,
        y: 10,
        toJSON() { return this; }
      };
    }
  });
};

describe('copy button completion signal', () => {
  beforeEach(() => {
    bootstrapWatcher();
    setVisibleRects();
  });

  afterEach(() => {
    chrome.runtime.sendMessage.mockClear();
  });

  test('detects visible answer-level copy button near latest assistant answer', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Generated answer text. '.repeat(12)}</div>
          <button aria-label="Copy response">Copy</button>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', {
      llmName: 'GPT'
    });

    expect(watcher.detectCopyButtonNearLatestAnswer()).toBe(true);
    expect(watcher.lastCopyButtonMeta).toMatchObject({
      visible: true,
      selector: expect.stringContaining('Copy')
    });
  });

  test('ignores code-block copy button as generation completion evidence', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">
            ${'Generated answer text. '.repeat(12)}
            <pre><code>npm test</code><button aria-label="Copy code">Copy</button></pre>
          </div>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', {
      llmName: 'GPT'
    });

    expect(watcher.detectCopyButtonNearLatestAnswer()).toBe(false);
    expect(watcher.lastCopyButtonMeta).toMatchObject({
      found: true,
      valid: false,
      visible: true,
      copyType: 'code_block',
      reason: 'code_block_only'
    });
  });

  test('tracks present-but-hidden copy button without treating it as completion evidence', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Generated answer text. '.repeat(12)}</div>
          <button aria-label="Copy response" style="opacity: 0;">Copy</button>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', {
      llmName: 'GPT'
    });

    expect(watcher.detectCopyButtonNearLatestAnswer()).toBe(false);
    expect(watcher.lastCopyButtonMeta).toMatchObject({
      found: true,
      valid: false,
      present: true,
      visible: false,
      interactable: false,
      copyType: 'answer_scope'
    });
  });

  test('rejects copy button inside user-scope answer candidate', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="user">
          <div class="prose">${'Generated answer text. '.repeat(12)}</div>
          <button aria-label="Copy response">Copy</button>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('generic', {
      llmName: 'Generic'
    });
    watcher.selectors.lastMessage = '.prose';

    expect(watcher.detectCopyButtonNearLatestAnswer()).toBe(false);
    expect(watcher.lastCopyButtonMeta).toMatchObject({
      found: true,
      valid: false,
      copyType: 'rejected',
      reason: 'user_scope'
    });
  });

  test('exposes copy button criterion and result diagnostics', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Generated answer text. '.repeat(12)}</div>
          <button aria-label="Copy response">Copy</button>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', {
      llmName: 'GPT'
    });
    watcher.detectCopyButtonNearLatestAnswer();
    watcher.criteria.mark('copyButtonVisible', true);

    const result = watcher.buildResult('copy_button_stable', 0.92, false, 0, true);

    expect(result.metrics.criteriaSnapshot.copyButtonVisible).toMatchObject({ met: true, enabled: true });
    expect(result.metrics.completionSelectors.copyButton).toBeTruthy();
    expect(result.metrics.copyButton).toMatchObject({ valid: true, visible: true, interactable: true });
  });

  test('emits COPY_COMPLETION_SIGNAL telemetry with classification metadata', () => {
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Generated answer text. '.repeat(12)}</div>
          <button aria-label="Copy response">Copy</button>
        </article>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', {
      llmName: 'GPT'
    });

    watcher.detectCopyButtonNearLatestAnswer();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LLM_DIAGNOSTIC_EVENT',
      llmName: 'GPT',
      event: expect.objectContaining({
        label: 'COPY_COMPLETION_SIGNAL',
        meta: expect.objectContaining({
          valid: true,
          present: true,
          visible: true,
          interactable: true,
          copyType: 'message_toolbar'
        })
      })
    }));
  });
});

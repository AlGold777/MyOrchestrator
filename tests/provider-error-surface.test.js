const fs = require('fs');
const path = require('path');
const Classifier = require('../shared/answer-content-classifier');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const loadContentUtils = () => {
  delete window.ContentUtils;
  window.__LLMLateAnswerSnapshotObserverStarted = true;
  global.chrome = {
    runtime: {
      id: 'test-extension',
      onMessage: { addListener: jest.fn() },
      sendMessage: jest.fn()
    }
  };
  // eslint-disable-next-line no-eval
  eval(read('content-scripts', 'content-utils.js'));
};

describe('provider overload/error surfaces are not green answers', () => {
  afterEach(() => {
    delete global.chrome;
    delete window.ContentUtils;
    delete window.__LLMLateAnswerSnapshotObserverStarted;
  });

  test('classifier treats overload/system inability messages as provider errors', () => {
    for (const text of [
      'The model is overloaded right now. Please try again later.',
      'We are experiencing high demand and are unable to respond.',
      'Server is busy. Failed to generate a response.',
      'The service is temporarily unavailable and cannot answer.'
    ]) {
      const result = Classifier.classify(text, { prompt: 'Explain this topic.' });
      expect(result.contentClass).toBe(Classifier.CLASSES.PROVIDER_ERROR);
      expect(result.terminalEligible).toBe(false);
    }
  });

  test('classifier does not reject substantive answers that merely discuss provider capacity', () => {
    const answer = [
      'There are two practical paths when a model is at capacity: retry later or switch providers.',
      'For this workflow the important part is preserving the current request state, showing a visible warning, and allowing manual recovery after the provider starts answering.',
      'That makes the UI honest without losing a real answer that mentions the same failure mode.'
    ].join(' ');
    const result = Classifier.classify(answer, { prompt: 'Explain recovery behavior.' });
    expect(result.contentClass).toBe(Classifier.CLASSES.VALID);
    expect(result.terminalEligible).toBe(true);
  });

  test('visible provider dialog/toast is detected separately from old assistant text', () => {
    loadContentUtils();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">Previous valid answer that must not be reused.</article>
        <div role="dialog">The model is overloaded right now. Please try again later.</div>
      </main>
    `;
    document.querySelectorAll('*').forEach((node) => {
      node.getClientRects = () => [{ width: 100, height: 40 }];
      node.getBoundingClientRect = () => ({ width: 100, height: 40, top: 0, bottom: 40, left: 0, right: 100 });
    });

    const surface = window.ContentUtils.detectProviderErrorSurface();
    expect(surface.detected).toBe(true);
    expect(surface.text).toContain('overloaded');
    expect(surface.selector).toBe('[role="dialog"]');
  });

  test('pipeline and background reject provider-error surfaces before success', () => {
    const pipeline = read('content-scripts', 'unified-answer-pipeline.js');
    const orchestrator = read('background', 'job-orchestrator.js');
    const resultsShared = read('results-shared.js');

    expect(pipeline).toContain('detectProviderErrorSurface');
    expect(pipeline).toContain("error: 'provider_error_surface'");
    expect(orchestrator).toContain("['ui_noise', 'provider_error'].includes(answerContentClassification?.contentClass)");
    expect(orchestrator).toContain("type: `answer_${rejectedClass}`");
    expect(orchestrator).toContain('buildDontAnswerDisplayText(llmName)');
    expect(orchestrator).toContain('entry.providerErrorDisplay = true;');
    expect(resultsShared).toContain("don('|’)?t answer");
  });
});

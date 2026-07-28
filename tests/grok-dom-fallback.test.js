const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

describe('Grok DOM fallback single-flight guard', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    delete window.grokContentScriptLoaded;
    delete window.__grokAllCopyV6;
    window.scrollBy = jest.fn();
    window.setupHumanoidFetchMonitor = jest.fn();
    window.HumanoidCleanup = {
      createScope: () => ({
        trackInterval: (id) => id,
        trackTimeout: (id) => id,
        trackObserver: (observer) => observer,
        trackAbortController: (controller) => controller,
        register: () => () => {},
        addEventListener: () => () => {},
        cleanup: () => {},
        isCleaned: () => false,
        getReason: () => null
      })
    };
    window.ContentUtils = {
      buildInlineHtml: (node) => String(node?.innerHTML || '').trim()
    };
    window.SelectorFinder = {
      find: jest.fn(() => Promise.resolve(null)),
      findAll: jest.fn(() => Promise.resolve([]))
    };
    loadScript('content-scripts/content-grok.js');
  });

  test('concurrent waits for the same prompt share one in-flight loop', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;
    expect(typeof waitForDomAnswer).toBe('function');

    const first = waitForDomAnswer('test prompt', 150, 30);
    const second = waitForDomAnswer('test prompt', 150, 30);
    expect(second).toBe(first);

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult).toBeNull();
  });

  test('a new loop starts after the previous one settles', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;

    const first = waitForDomAnswer('test prompt', 100, 30);
    await first;

    const second = waitForDomAnswer('test prompt', 100, 30);
    expect(second).not.toBe(first);
    await second;
  });

  test('different prompts do not join the same loop', async () => {
    const { waitForDomAnswer } = window.__grokAllCopyV6;

    const first = waitForDomAnswer('prompt one', 100, 30);
    const second = waitForDomAnswer('prompt two', 100, 30);
    expect(second).not.toBe(first);
    await Promise.all([first, second]);
  });

  test('composer text is never extracted as an assistant answer', async () => {
    document.body.innerHTML = `
      <div data-testid="grok-editor">
        <div role="article" data-testid="message">Ссылайся на следующее содержимое:</div>
      </div>`;
    const result = await window.__grokAllCopyV6.waitForDomAnswer('real prompt', 80, 20);
    expect(result).toBeNull();
  });

  test('user messages are never extracted as assistant answers', async () => {
    document.body.innerHTML = `
      <div data-message-author-role="user">
        <div role="article" data-testid="message">A user prompt long enough to look like an answer.</div>
      </div>`;
    const result = await window.__grokAllCopyV6.waitForDomAnswer('real prompt', 80, 20);
    expect(result).toBeNull();
  });
});

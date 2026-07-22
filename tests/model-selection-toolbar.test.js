const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function installChromeStorageMock() {
  const store = new Map();
  chrome.runtime.getURL = jest.fn((value) => value);
  chrome.storage.local.get = jest.fn((key, callback) => {
    let result = {};
    if (Array.isArray(key)) {
      key.forEach((item) => { result[item] = store.get(item); });
    } else if (typeof key === 'string') {
      result = { [key]: store.get(key) };
    } else {
      Object.keys(key || {}).forEach((item) => {
        result[item] = store.has(item) ? store.get(item) : key[item];
      });
    }
    if (typeof callback === 'function') {
      callback(result);
      return undefined;
    }
    return Promise.resolve(result);
  });
  chrome.storage.local.set = jest.fn((obj, callback) => {
    Object.entries(obj || {}).forEach(([key, value]) => store.set(key, value));
    if (typeof callback === 'function') callback();
    return Promise.resolve();
  });
}

function installDomMocks() {
  window.__codexModelSelectionToolbarLoaded = false;
  window.AnswerPipelineSelectors = {
    detectPlatform: () => 'generic',
    PLATFORM_SELECTORS: {
      generic: {
        lastMessage: '.answer'
      }
    }
  };
  window.sanitizeHTML = (html = '') => String(html || '');
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  document.body.innerHTML = `
    <main>
      <article class="answer"><p id="answer-text">Selected text fragment</p></article>
    </main>
  `;
  Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 140,
      height: 20,
      top: 64,
      left: 32,
      right: 172,
      bottom: 84,
      x: 32,
      y: 64,
      toJSON() { return this; }
    })
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      right: 640,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON() { return this; }
    })
  });
}

async function loadToolbarScript() {
  installChromeStorageMock();
  installDomMocks();
  const sanitize = require('fs').readFileSync(require('path').join(__dirname, '..', 'utils', 'sanitize.js'), 'utf8');
  window.eval(sanitize);
  const toolbar = require('fs').readFileSync(require('path').join(__dirname, '..', 'content-scripts', 'model-selection-toolbar.js'), 'utf8');
  window.eval(toolbar);
  await delay(20);
}

async function selectText() {
  const textNode = document.getElementById('answer-text').firstChild;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 8);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await delay(20);
}

describe('Model selection toolbar', () => {
  beforeEach(async () => {
    await loadToolbarScript();
  });

  afterEach(() => {
    chrome.storage.local.set.mockClear();
    chrome.storage.local.get.mockClear();
  });

  test('shows toolbar on response selection and stores favourite fragment', async () => {
    await selectText();

    const toolbar = document.getElementById('codex-model-selection-toolbar');
    expect(toolbar.classList.contains('is-visible')).toBe(true);

    document.querySelector('#codex-model-selection-toolbar [data-fav]').click();
    await delay(20);

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const payload = chrome.storage.local.set.mock.calls.at(-1)[0];
    expect(payload.llmComparatorFavoriteEntries).toHaveLength(1);
    expect(payload.llmComparatorFavoriteEntries[0]).toMatchObject({
      sourceName: 'Model',
      modelKey: 'model',
      kind: 'fragment'
    });
    expect(payload.llmComparatorFavoriteEntries[0].text).toContain('Selected');
  });

  test('renders remove-highlight before yellow and clears an applied highlight', async () => {
    await selectText();
    const toolbar = document.getElementById('codex-model-selection-toolbar');
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons[0].hasAttribute('data-clear-highlight')).toBe(true);
    expect(buttons[1].dataset.color).toBe('#FFEB3B');

    toolbar.querySelector('[data-color="#FFEB3B"]').click();
    const highlight = document.querySelector('#answer-text span');
    expect(highlight.style.backgroundColor).toBeTruthy();

    const range = document.createRange();
    range.selectNodeContents(highlight);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await delay(20);
    toolbar.querySelector('[data-clear-highlight]').click();
    expect(highlight.style.backgroundColor).toBe('');
  });

  test('uses outline and filled favourite states and toggles the fragment', async () => {
    await selectText();
    const favorite = document.querySelector('#codex-model-selection-toolbar [data-fav]');
    expect(favorite.getAttribute('aria-pressed')).toBe('false');
    favorite.click();
    await delay(20);

    await selectText();
    expect(favorite.classList.contains('active')).toBe(true);
    expect(favorite.getAttribute('aria-pressed')).toBe('true');
    favorite.click();
    await delay(20);

    const payload = chrome.storage.local.set.mock.calls.at(-1)[0];
    expect(payload.llmComparatorFavoriteEntries).toHaveLength(0);
  });
});

const fs = require('fs');
const path = require('path');

const loadAdapter = () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts/content-kimi.js'), 'utf8');
  // eslint-disable-next-line no-eval
  eval(source);
};

const markVisible = () => {
  document.querySelectorAll('*').forEach((node) => {
    node.getClientRects = () => [{ width: 100, height: 40 }];
  });
};

describe('Kimi response extraction', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete window.kimiContentScriptLoaded;
    delete window.__kimiAdapter;
    window.BaseLLMAdapter = class {
      handleMessage() { return false; }
      _cleanup() {}
    };
    window.ContentUtils = {
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1))),
      buildInlineHtml: (node) => node.outerHTML
    };
    window.AnswerContentClassifier = require('../shared/answer-content-classifier');
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn()
      }
    };
    loadAdapter();
  });

  afterEach(() => {
    delete global.chrome;
    delete window.BaseLLMAdapter;
    delete window.ContentUtils;
    delete window.AnswerContentClassifier;
    delete window.__kimiAdapter;
    delete window.kimiContentScriptLoaded;
  });

  // The reasoning trace renders first and keeps changing longest, so a plain
  // "latest assistant text" rule lands on it. The answer must win instead.
  test('returns the answer, not the reasoning trace that precedes it', () => {
    document.body.innerHTML = `
      <div class="segment-user">Вопрос пользователя про интеграцию</div>
      <div class="segment-assistant">
        <div class="segment-thinking markdown-container">
          Размышления модели: сначала проверю условие, потом посчитаю остаток и сверю знаки.
        </div>
        <div class="markdown-container">
          Ответ Kimi, который должен попасть в карточку результатов расширения.
        </div>
      </div>
    `;
    markVisible();

    const result = window.__kimiAdapter.readLatestResponse();
    expect(result.text).toContain('Ответ Kimi, который должен попасть');
    expect(result.text).not.toContain('Размышления модели');
    expect(result.html).not.toContain('segment-thinking');
  });

  test('strips the trace even when the whole assistant turn is the only match', () => {
    document.body.innerHTML = `
      <div class="segment-assistant">
        <div class="reasoning-panel">Внутренний ход рассуждений, который нельзя показывать.</div>
        <p>Финальный ответ модели длиной достаточной для классификатора содержимого.</p>
      </div>
    `;
    markVisible();

    const result = window.__kimiAdapter.readLatestResponse();
    expect(result.text).toContain('Финальный ответ модели');
    expect(result.text).not.toContain('Внутренний ход рассуждений');
  });

  test('reports no answer while only the reasoning trace has rendered', () => {
    document.body.innerHTML = `
      <div class="segment-assistant">
        <div class="segment-thinking markdown-container">
          Размышления модели, пока финальный ответ ещё не начал печататься.
        </div>
      </div>
    `;
    markVisible();

    expect(window.__kimiAdapter.readLatestResponse().text).toBe('');
  });

  test('keeps a user turn out of the candidate set', () => {
    document.body.innerHTML = `
      <div class="segment-user"><div class="markdown-container">Текст пользовательского запроса целиком.</div></div>
      <div class="segment-assistant"><div class="markdown-container">Ответ ассистента на этот запрос целиком.</div></div>
    `;
    markVisible();

    const result = window.__kimiAdapter.readLatestResponse();
    expect(result.text).toContain('Ответ ассистента');
    expect(result.text).not.toContain('Текст пользовательского запроса');
  });
});

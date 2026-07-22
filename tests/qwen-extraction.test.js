const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

describe('Qwen response extraction', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    delete window.qwenContentScriptLoaded;
    delete window.__qwenAllCopyV6;
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
    loadScript('content-scripts/content-qwen.js');
  });

  test('extractMessageText ignores reasoning mode footer labels', () => {
    const assistant = document.createElement('div');
    assistant.className = 'qwen-chat-message qwen-chat-message-assistant';

    const content = document.createElement('div');
    content.className = 'response-message-content';

    const markdown = document.createElement('div');
    markdown.className = 'custom-qwen-markdown';

    const prose = document.createElement('div');
    prose.className = 'qwen-markdown qwen-markdown-loose';
    prose.textContent = 'Это основной ответ модели.';
    markdown.appendChild(prose);
    content.appendChild(markdown);

    const footer = document.createElement('div');
    footer.className = 'reasoning-mode-switch';
    const autoBtn = document.createElement('button');
    autoBtn.textContent = 'Автоматический';
    footer.appendChild(autoBtn);
    content.appendChild(footer);

    assistant.appendChild(content);
    document.body.appendChild(assistant);

    const text = window.__qwenAllCopyV6.extractMessageText(assistant);
    const html = window.__qwenAllCopyV6.extractMessageHtml(assistant);

    expect(text).toContain('Это основной ответ модели.');
    expect(text).not.toMatch(/Автоматический/i);
    expect(html).toContain('Это основной ответ модели.');
    expect(html).not.toMatch(/Автоматический/i);
  });

  test('answer candidate rejects prompt echo and accepts real answer', () => {
    const prompt = 'Составь короткий план запуска проекта';
    const predicate = window.__qwenAllCopyV6.isQwenAnswerCandidate;

    expect(predicate(prompt, prompt, '')).toBe(false);
    expect(predicate(` ${prompt} `, prompt, '')).toBe(false);
    expect(predicate('1. Определить цель.\n2. Назначить ответственных.\n3. Проверить риски.', prompt, '')).toBe(true);
  });

  test('send safety rejects attachment controls even when they look send-like', () => {
    const api = window.__qwenAllCopyV6;
    const attach = document.createElement('button');
    attach.setAttribute('aria-label', 'Add files');
    attach.className = 'composer-send';
    attach.innerHTML = '<svg class="paperclip-icon"></svg>';
    document.body.appendChild(attach);

    const genericSvg = document.createElement('button');
    genericSvg.innerHTML = '<svg class="arrow-up"></svg>';
    document.body.appendChild(genericSvg);

    const send = document.createElement('button');
    send.setAttribute('aria-label', 'Send message');
    document.body.appendChild(send);

    expect(api.isUnsafeQwenSendControl(attach)).toBe(true);
    expect(api.hasExplicitQwenSendIdentity(attach)).toBe(false);
    expect(api.hasExplicitQwenSendIdentity(genericSvg)).toBe(false);
    expect(api.hasExplicitQwenSendIdentity(send)).toBe(true);

    const localizedSend = document.createElement('button');
    localizedSend.setAttribute('aria-label', 'Отправить');
    expect(api.hasExplicitQwenSendIdentity(localizedSend)).toBe(true);
  });

});

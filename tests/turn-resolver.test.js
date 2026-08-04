/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const TurnResolver = require('../content-scripts/turn-resolver');

const SELECTOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8'
);

const PLATFORM_HTML = {
  chatgpt: '<div data-testid="conversation-turn" data-message-author-role="assistant">answer</div>',
  claude: '<div data-is-response="true"><div class="standard-markdown grid-cols-1">answer</div></div>',
  gemini: '<model-response>answer</model-response>',
  grok: '<div class="message-bubble"><div class="response-content-markdown">answer</div></div>',
  perplexity: '<div data-testid="answer-card">answer</div>',
  qwen: '<div class="qwen-chat-message qwen-chat-message-assistant"><div class="response-message-content"><div class="custom-qwen-markdown"><div class="qwen-markdown qwen-markdown-loose">answer</div></div></div></div>',
  deepseek: '<div class="message-item" data-role="assistant">answer</div>',
  lechat: '<div data-testid="lechat-response"><div class="prose">answer</div></div>',
  zai: '<div id="message-1-start" class="chat-assistant markdown-prose">answer</div>'
};

describe('authoritative turn resolver', () => {
  beforeAll(() => {
    delete window.AnswerPipelineSelectors;
    window.eval(SELECTOR_SOURCE);
  });

  test.each(Object.entries(PLATFORM_HTML))('%s resolves platform answer and message root exactly', (platform, html) => {
    document.body.innerHTML = html;
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
    const result = TurnResolver.resolveTurn({ platform, selectors, document });
    expect(result.resolution).toBe('exact');
    expect(result.answerNode).not.toBeNull();
    expect(result.messageRoot).not.toBeNull();
    expect(result.messageRoot.contains(result.answerNode)).toBe(true);
  });

  test('configured secondary candidate is explicit fallback and cannot masquerade as exact', () => {
    document.body.innerHTML = '<section data-role="assistant"><div class="secondary">answer</div></section>';
    const result = TurnResolver.resolveTurn({
      platform: 'test',
      selectors: { lastMessage: '.missing', messageRoot: '[data-role="assistant"]' },
      answerSelectors: ['.secondary'],
      document
    });
    expect(result.resolution).toBe('fallback');
    expect(result.selectorSource).toBe('secondary');
  });

  test('missing answer is unresolved rather than a successful fallback', () => {
    document.body.innerHTML = '<main></main>';
    const result = TurnResolver.resolveTurn({
      platform: 'test', selectors: { lastMessage: '.missing', messageRoot: '.root' }, document
    });
    expect(result.resolution).toBe('unresolved');
    expect(result.answerNode).toBeNull();
  });

  test('a trailing service-only candidate cannot become an exact empty answer', () => {
    document.body.innerHTML = `
      <section class="answer">Visible final answer</section>
      <section class="answer" role="status">Working</section>`;
    const result = TurnResolver.resolveTurn({
      platform: 'test',
      selectors: { lastMessage: '.answer', messageRoot: '.answer' },
      document,
      minimumTextLength: 5,
      readText: (node) => node.getAttribute('role') === 'status' ? '' : node.textContent
    });
    expect(result.resolution).toBe('exact');
    expect(result.answerNode.textContent).toBe('Visible final answer');
  });

  test('candidate policy skips trailing UI scaffolding and keeps the substantive answer', () => {
    document.body.innerHTML = `
      <section class="answer">Substantive generated answer</section>
      <section class="answer">Refer to the following content</section>`;
    const result = TurnResolver.resolveTurn({
      platform: 'test',
      selectors: { lastMessage: '.answer', messageRoot: '.answer' },
      document,
      minimumTextLength: 5,
      candidateEligible: ({ text }) => !text.startsWith('Refer to')
    });
    expect(result.answerNode.textContent).toBe('Substantive generated answer');
    expect(result.rejectedCandidates).toHaveLength(1);
  });

  test('candidate policy can exclude a trailing user node admitted by a broad selector', () => {
    document.body.innerHTML = `
      <section class="message assistant">Generated answer</section>
      <section class="message user">Later user prompt</section>`;
    const result = TurnResolver.resolveTurn({
      platform: 'test',
      selectors: { lastMessage: '.message', messageRoot: '.message' },
      document,
      candidateEligible: ({ node }) => !node.classList.contains('user')
    });
    expect(result.answerNode.textContent).toBe('Generated answer');
  });

  test('does not fall back to previous answers when candidate count equals the turn anchor', () => {
    document.body.innerHTML = `
      <article data-role="assistant">Old answer one</article>
      <article data-role="assistant">Old answer two</article>`;
    const result = TurnResolver.resolveTurn({
      platform: 'test',
      selectors: {
        lastMessage: '[data-role="assistant"]',
        messageRoot: '[data-role="assistant"]'
      },
      document,
      anchorAnswerCount: 2,
      minimumTextLength: 5
    });
    expect(result.candidatePool).toHaveLength(0);
    expect(result.answerNode).toBeNull();
    expect(result.resolution).toBe('unresolved');
    expect(result.reason).toBe('answer_node_unresolved');
  });

  test('discovers an exact answer inside nested open shadow roots', () => {
    document.body.innerHTML = '<div id="outer-host"></div>';
    const outer = document.getElementById('outer-host').attachShadow({ mode: 'open' });
    outer.innerHTML = '<section><div id="inner-host"></div></section>';
    const inner = outer.getElementById('inner-host').attachShadow({ mode: 'open' });
    inner.innerHTML = '<div id="markdown-content-shadow"><div class="prose">Shadow answer text</div></div>';
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS.perplexity;
    const result = TurnResolver.resolveTurn({ platform: 'perplexity', selectors, document });
    expect(result.resolution).toBe('exact');
    expect(result.answerNode.textContent).toContain('Shadow answer text');
    expect(result.messageRoot.id).toBe('markdown-content-shadow');
  });

  test('a generic shadow prose candidate remains fail-closed without a configured root', () => {
    document.body.innerHTML = '<div id="answer-host"></div>';
    const shadow = document.getElementById('answer-host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<section class="unknown-wrapper"><div class="prose">Visible manual answer</div></section>';
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS.perplexity;
    const result = TurnResolver.resolveTurn({ platform: 'perplexity', selectors, document });
    expect(result.answerNode).not.toBeNull();
    expect(result.resolution).toBe('fallback');
    expect(result.reason).toBe('message_root_unresolved');
  });

  test.each([
    ['claude live streaming wrapper', 'claude', '<div class="group group/message-row"><div data-is-streaming="false" class="group relative"><div class="font-claude-response relative"><div class="standard-markdown grid-cols-1">answer</div></div><div>footer</div></div></div>', '[data-is-streaming="false"]'],
    ['perplexity live markdown root', 'perplexity', '<div id="markdown-content-0"><div><div class="prose">answer</div></div><div>sources</div></div>', '#markdown-content-0'],
    ['deepseek live sanitized markdown root', 'deepseek', '<div class="ds-markdown [REDACTED]"><p class="ds-markdown-paragraph">⟦TEXT:42⟧</p></div>', '.ds-markdown'],
    ['zai direct audited response', 'zai', '<div id="message-a-start" class="chat-assistant markdown-prose">answer</div>', '#message-a-start'],
    ['zai wrapped audited response', 'zai', '<div id="message-a"><div class="chat-assistant markdown-prose">answer</div><div>footer</div></div>', '#message-a'],
    ['zai role response', 'zai', '<section data-role="assistant"><div class="markdown">answer</div></section>', '[data-role="assistant"]'],
    ['lechat named response', 'lechat', '<div data-testid="lechat-response"><div class="prose">answer</div><div>sources</div></div>', '[data-testid="lechat-response"]'],
    ['lechat assistant wrapper', 'lechat', '<section data-testid="assistant-message"><article><div class="prose">answer</div></article><div>sources</div></section>', '[data-testid="assistant-message"]'],
    ['lechat chat response', 'lechat', '<section class="chat-response"><div class="prose">answer</div><div>sources</div></section>', '.chat-response']
  ])('%s resolves exact with the confirmed outer message root', (_name, platform, html, expectedRoot) => {
    document.body.innerHTML = html;
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
    const result = TurnResolver.resolveTurn({ platform, selectors, document });
    expect(result.resolution).toBe('exact');
    expect(result.messageRoot).toBe(document.querySelector(expectedRoot));
    expect(result.messageRoot.contains(result.answerNode)).toBe(true);
  });
});

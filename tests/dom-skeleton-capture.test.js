/** @jest-environment jsdom */
require('../shared/secret-redaction');
require('../content-scripts/turn-resolver');
require('../content-scripts/answer-structure');
require('../content-scripts/generation-signal');
const DOMSkeletonCapture = require('../content-scripts/dom-skeleton-capture');

describe('privacy-preserving DOM skeleton capture', () => {
  test('replaces conversation text with length placeholders and strips unsafe attributes', () => {
    document.body.innerHTML = `
      <article id="message-1785002113835" data-testid="assistant-response"
        data-content="private answer" href="https://example.test/?token=secret">
        <p>Private prompt and answer</p>
        <button aria-label="Stop generating">Stop</button>
      </article>`;
    const result = DOMSkeletonCapture.captureNode(document.querySelector('article'), {
      platform: 'test', resolution: 'exact', document
    });
    expect(result.ok).toBe(true);
    expect(result.html).toContain('⟦TEXT:25⟧');
    expect(result.html).toContain('aria-label="Stop generating"');
    expect(result.html).not.toContain('Private prompt');
    expect(result.html).not.toContain('data-content');
    expect(result.html).not.toContain('href=');
    expect(result.html).not.toContain('1785002113835');
  });

  test('redacts provider keys in retained structural attributes', () => {
    document.body.innerHTML = '<div class="assistant sk-abcdefghijklmnopqrstuvwxyz123456">answer</div>';
    const result = DOMSkeletonCapture.captureNode(document.querySelector('div'), { document });
    expect(result.html).toContain('[REDACTED]');
    expect(result.html).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  test('preserves allowlisted DeepSeek structural classes but still redacts key-shaped ds values', () => {
    document.body.innerHTML = '<div class="ds-markdown ds-message-assistant ds-abcdefghijklmnopqrstuvwxyz123456">answer</div>';
    const result = DOMSkeletonCapture.captureNode(document.querySelector('div'), { document });
    expect(result.ok).toBe(true);
    expect(result.html).toContain('ds-markdown');
    expect(result.html).toContain('ds-message-assistant');
    expect(result.html).toContain('[REDACTED]');
    expect(result.html).not.toContain('ds-abcdefghijklmnopqrstuvwxyz123456');
  });

  test('non-control aria labels are replaced and open shadow content is sanitized', () => {
    const host = document.createElement('section');
    host.setAttribute('aria-label', 'Private conversation title');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Secret shadow answer</p>';
    document.body.appendChild(host);
    const result = DOMSkeletonCapture.captureNode(host, { document });
    expect(result.html).toContain('aria-label="⟦TEXT:26⟧"');
    expect(result.html).toContain('data-shadow-root="open"');
    expect(result.html).not.toContain('Secret shadow answer');
  });

  test('fails closed when redaction is unavailable', () => {
    const editor = global.SecretRedaction;
    delete global.SecretRedaction;
    const result = DOMSkeletonCapture.captureNode(document.createElement('div'), { document });
    global.SecretRedaction = editor;
    expect(result).toEqual({ ok: false, error: 'secret_redaction_unavailable' });
  });

  test('fails privacy validation when a raw text node survives sanitization', () => {
    const unsafe = document.createElement('article');
    unsafe.textContent = 'raw answer';
    expect(DOMSkeletonCapture.validateSkeleton(unsafe)).toEqual({
      ok: false,
      error: 'raw_text_node_detected'
    });
  });

  test('captures only numeric ignored-content measurements for B1 calibration', () => {
    document.body.innerHTML = `
      <article data-testid="assistant-response">
        <p class="answer">Visible final answer</p>
        <aside>Source details that the linearizer ignores</aside>
        <button>Copy</button>
      </article>`;
    const result = DOMSkeletonCapture.captureCurrentTurn({
      platform: 'test',
      document,
      selectors: {
        messageRoot: 'article[data-testid="assistant-response"]',
        lastMessage: '.answer'
      }
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      privacyValidated: true,
      resolution: 'exact',
      structuralComplete: true,
      rawTextLength: expect.any(Number),
      linearizedTextLength: expect.any(Number),
      selectedAnswerLength: expect.any(Number),
      ignoredTextDelta: expect.any(Number),
      ignoredTextRatio: expect.any(Number),
      generationActive: expect.any(Boolean)
    }));
    expect(result.rawTextLength).toBeGreaterThan(result.linearizedTextLength);
    expect(result.html).not.toContain('Visible final answer');
    expect(JSON.stringify(result)).not.toContain('Source details');
  });

  test('captures a sanitized diagnostic ancestor without upgrading a missing message root to exact', () => {
    document.body.innerHTML = `
      <main><section class="unknown-provider-turn"><div><p class="answer">Fallback answer text</p></div></section></main>`;
    const result = DOMSkeletonCapture.captureCurrentTurn({
      platform: 'test',
      document,
      selectors: { messageRoot: '.known-root-that-is-absent', lastMessage: '.answer', answerContainer: 'main' }
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      resolution: 'fallback',
      diagnosticContext: true,
      structuralComplete: false,
      structuralIssues: expect.arrayContaining(['message_root_missing']),
      privacyValidated: true
    }));
    expect(result.html).toContain('unknown-provider-turn');
    expect(result.html).not.toContain('Fallback answer text');
  });

  test('uses the last body child only as an unresolved sanitized diagnostic fallback', () => {
    document.body.innerHTML = '<div class="provider-shell"><section class="unknown-answer">Unresolved answer text</section></div>';
    const result = DOMSkeletonCapture.captureCurrentTurn({
      platform: 'test',
      document,
      selectors: { messageRoot: '.missing-root', lastMessage: '.missing-answer', answerContainer: '.missing-container' }
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      resolution: 'unresolved',
      diagnosticContext: true,
      structuralComplete: false
    }));
    expect(result.html).toContain('provider-shell');
    expect(result.html).not.toContain('Unresolved answer text');
  });

  test('fails closed when a matching answer node contains only ignored service text', () => {
    document.body.innerHTML = `
      <article data-testid="assistant-response"><div class="answer"><div class="thinking">Thinking only</div></div></article>`;
    const result = DOMSkeletonCapture.captureCurrentTurn({
      platform: 'test',
      document,
      selectors: {
        messageRoot: 'article[data-testid="assistant-response"]',
        lastMessage: '.answer'
      }
    });
    expect(result.resolution).toBe('unresolved');
    expect(result.selectedAnswerLength).toBe(0);
    expect(result.structuralComplete).toBe(false);
    expect(result.structuralIssues).toEqual(expect.arrayContaining([
      'message_root_missing',
      'selected_answer_text_empty'
    ]));
  });
});

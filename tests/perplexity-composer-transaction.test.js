/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'perplexity-composer-transaction.js'), 'utf8');
const setRect = (element, { top = 0, left = 0, width = 300, height = 40 } = {}) => {
  element.getBoundingClientRect = () => ({ top, left, width, height, right: left + width, bottom: top + height });
};

describe('Perplexity composer transaction', () => {
  beforeEach(() => {
    delete window.PerplexityComposerTransaction;
    document.head.replaceChildren();
    document.body.replaceChildren();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    window.eval(SOURCE);
  });

  test('selects the composer owned by the search form instead of an extension editor', () => {
    document.body.innerHTML = `
      <aside id="llm-notes-sidebar"><div contenteditable="true" role="textbox"></div></aside>
      <form role="search"><textarea data-testid="search-input"></textarea><button type="submit">Send</button></form>`;
    const notes = document.querySelector('aside [contenteditable]');
    const composer = document.querySelector('textarea');
    const send = document.querySelector('button');
    setRect(notes, { top: 100 });
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(send, { top: 660, left: 720, width: 40, height: 40 });

    const result = window.PerplexityComposerTransaction.resolveComposer(document);
    expect(result.element).toBe(composer);
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({ inSearch: true, hasSendControl: true }));
  });

  test('fragmented prompt evidence requires exactly one head and one tail', () => {
    const tx = window.PerplexityComposerTransaction;
    const prompt = 'A sufficiently long current prompt whose two ends identify one dispatch.';
    const normalized = tx.normalize(prompt);
    const width = Math.min(32, Math.max(12, Math.floor(normalized.length / 3)));
    const fragmented = `${normalized.slice(0, width)} attachment.pdf ${normalized.slice(-width)}`;
    expect(tx.promptMatches(fragmented, prompt)).toBe(true);
    expect(tx.promptMatches(`${fragmented} ${fragmented}`, prompt)).toBe(false);
  });

  test('rejects a page-sized promotion ancestor even when it contains upgrade text and an icon button', () => {
    const page = document.createElement('main');
    page.textContent = 'Upgrade your plan. Search and navigation content. '.repeat(80);
    const close = document.createElement('button');
    close.className = 'reset interactable select-none outline-none';
    close.innerHTML = '<svg></svg>';
    page.appendChild(close);
    document.body.appendChild(page);
    setRect(page, { top: 0, left: 0, width: 1200, height: 800 });
    setRect(close, { top: 10, left: 1150, width: 32, height: 32 });

    expect(window.PerplexityComposerTransaction.findOwnedPromotionClose(document)).toBeNull();
  });

  test('accepts a compact explicitly-owned promotion dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = 'Try Perplexity Pro';
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Close');
    dialog.appendChild(close);
    document.body.appendChild(dialog);
    setRect(dialog, { top: 120, left: 300, width: 500, height: 300 });
    setRect(close, { top: 130, left: 750, width: 32, height: 32 });

    expect(window.PerplexityComposerTransaction.findOwnedPromotionClose(document)).toEqual({ button: close, container: dialog });
  });

  test('reacquires a replaced composer and requires its scoped Send control', async () => {
    document.body.innerHTML = '<form role="search"><textarea data-testid="search-input"></textarea><button type="submit">Send</button></form>';
    let composer = document.querySelector('textarea');
    const send = document.querySelector('button');
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(send, { top: 660, left: 720, width: 40, height: 40 });
    const prompt = 'Explain why this draft belongs to the current transaction.';

    const result = await window.PerplexityComposerTransaction.prepare({
      doc: document,
      prompt,
      attempts: 1,
      settleMs: 0,
      sleep: () => Promise.resolve(),
      insertStrategy: async (oldComposer) => {
        const replacement = oldComposer.cloneNode();
        replacement.value = prompt;
        setRect(replacement, { top: 650, width: 700, height: 70 });
        oldComposer.replaceWith(replacement);
        composer = replacement;
        return { ok: true, method: 'framework_replacement' };
      }
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, composer, sendControl: send }));
    expect(result.history[0]).toEqual(expect.objectContaining({ nodeReplaced: true, sendControlReady: true }));
  });

  test('does not accept visible prompt text when the scoped Send control is absent', async () => {
    document.body.innerHTML = '<form role="search"><textarea data-testid="search-input"></textarea></form>';
    const composer = document.querySelector('textarea');
    setRect(composer, { top: 650, width: 700, height: 70 });

    const result = await window.PerplexityComposerTransaction.prepare({
      doc: document,
      prompt: 'Draft without application acknowledgement',
      attempts: 1,
      settleMs: 0,
      sleep: () => Promise.resolve()
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'send_control_not_ready' }));
  });

  test('rich editor insertion uses the editor transaction before any DOM fallback', async () => {
    document.body.innerHTML = '<form role="search"><div contenteditable="true" role="textbox"></div><button type="submit">Send</button></form>';
    const composer = document.querySelector('[contenteditable]');
    const prompt = 'Rich editor transaction payload';
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(document.querySelector('button'), { top: 660, left: 720, width: 40, height: 40 });
    const originalExecCommand = document.execCommand;
    document.execCommand = jest.fn((command, _ui, value) => {
      if (command === 'delete') composer.textContent = '';
      if (command === 'insertText') composer.textContent = String(value || '');
      return true;
    });

    const result = await window.PerplexityComposerTransaction.insert(composer, prompt, {
      sleep: () => Promise.resolve(), settleMs: 0
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, method: 'beforeinput_exec_command' }));
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, prompt);
    document.execCommand = originalExecCommand;
  });
});

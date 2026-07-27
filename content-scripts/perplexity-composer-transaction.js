// Perplexity composer ownership and draft-acceptance contract.
(function initPerplexityComposerTransaction(root) {
  'use strict';

  const DEFAULT_SELECTORS = [
    'textarea[data-testid="search-input"]',
    'form[role="search"] textarea',
    'form textarea[placeholder*="Ask" i]',
    '[data-testid*="composer" i] [contenteditable="true"]',
    'form [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"]',
    'textarea[placeholder*="question" i]',
    'textarea[placeholder*="вопрос" i]',
    'form textarea'
  ];
  const PROMOTION_PATTERN = /(upgrade|try pro|go pro|perplexity pro|pro plan|subscription|pricing|обновить тариф|подписк|тариф)/i;
  const EXCLUDED_OWNER_SELECTOR = [
    '#llm-notes-sidebar', '.notes-sidebar', '[data-llm-extension]',
    '[data-extension-owned]', '[id^="selectors-"]'
  ].join(',');

  const normalize = (value) => String(value || '').normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  const read = (element) => String(element?.value ?? element?.innerText ?? element?.textContent ?? '');

  const promptMatches = (value, prompt) => {
    const actual = normalize(value);
    const expected = normalize(prompt);
    if (!actual || !expected) return false;
    const first = actual.indexOf(expected);
    if (first >= 0) return actual.indexOf(expected, first + expected.length) < 0;
    const width = Math.min(32, Math.max(12, Math.floor(expected.length / 3)));
    const head = expected.slice(0, width);
    const tail = expected.slice(-width);
    const count = (needle) => {
      let hits = 0;
      let offset = 0;
      while (needle && offset <= actual.length - needle.length) {
        const found = actual.indexOf(needle, offset);
        if (found < 0) break;
        hits += 1;
        offset = found + needle.length;
        if (hits > 1) break;
      }
      return hits;
    };
    return count(head) === 1 && count(tail) === 1;
  };

  const rectOf = (element) => {
    try { return element?.getBoundingClientRect?.() || null; } catch (_) { return null; }
  };

  const isVisible = (element) => {
    if (!element?.isConnected || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    const rect = rectOf(element);
    let style = null;
    try { style = (element.ownerDocument?.defaultView || root).getComputedStyle(element); } catch (_) {}
    return Boolean(rect && rect.width > 0 && rect.height > 0
      && style?.display !== 'none' && style?.visibility !== 'hidden');
  };

  const resolveSendControl = (composer) => {
    const scope = composer?.closest?.('form,[role="search"],[data-testid*="composer" i]') || composer?.parentElement;
    if (!scope) return null;
    const buttons = Array.from(scope.querySelectorAll('button,[role="button"]'));
    return buttons.find((button) => {
      if (!isVisible(button)) return false;
      const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title'),
        button.getAttribute?.('data-testid'), button.textContent].filter(Boolean).join(' ');
      return /send|submit|ask|arrow-up|paper-plane|отправ|enviar/i.test(label)
        || String(button.getAttribute?.('type') || '').toLowerCase() === 'submit';
    }) || null;
  };

  const describe = (element, score = null) => {
    const rect = rectOf(element);
    return {
      tag: String(element?.tagName || '').toLowerCase(),
      role: element?.getAttribute?.('role') || null,
      testId: element?.getAttribute?.('data-testid') || null,
      contenteditable: element?.getAttribute?.('contenteditable') || null,
      inForm: !!element?.closest?.('form'),
      inSearch: !!element?.closest?.('[role="search"]'),
      hasSendControl: !!resolveSendControl(element),
      rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
      score
    };
  };

  const scoreComposer = (element) => {
    if (!isVisible(element) || element.closest?.(EXCLUDED_OWNER_SELECTOR)) return -Infinity;
    let score = 0;
    if (element.matches?.('textarea[data-testid="search-input"]')) score += 100;
    if (element.closest?.('form[role="search"]')) score += 70;
    if (element.closest?.('[data-testid*="composer" i]')) score += 60;
    if (element.closest?.('form')) score += 35;
    if (resolveSendControl(element)) score += 80;
    if (element.getAttribute?.('role') === 'textbox') score += 20;
    if (element.isContentEditable || element.matches?.('textarea')) score += 15;
    const rect = rectOf(element);
    const viewportHeight = Number(element.ownerDocument?.defaultView?.innerHeight || root.innerHeight || 0);
    if (rect && viewportHeight && rect.top >= viewportHeight * 0.45) score += 20;
    return score;
  };

  const collectCandidates = (doc = root.document, selectors = DEFAULT_SELECTORS) => {
    const unique = new Set();
    selectors.forEach((selector) => {
      try { doc.querySelectorAll(selector).forEach((node) => unique.add(node)); } catch (_) {}
    });
    return Array.from(unique).map((element) => ({ element, score: scoreComposer(element) }))
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score);
  };

  const resolveComposer = (doc = root.document, selectors = DEFAULT_SELECTORS) => {
    const candidates = collectCandidates(doc, selectors);
    const winner = candidates[0] || null;
    return {
      element: winner?.element || null,
      score: winner?.score ?? null,
      diagnostics: candidates.slice(0, 8).map(({ element, score }) => describe(element, score))
    };
  };

  const ownsPromotionClose = (container, button, doc = root.document) => {
    if (!container || !button || container === doc.body || container === doc.documentElement) return false;
    if (container.querySelector?.(DEFAULT_SELECTORS.join(','))) return false;
    const text = String(container.innerText || container.textContent || '').replace(/\s+/g, ' ').trim();
    if (!PROMOTION_PATTERN.test(text) || text.length > 1800) return false;
    const rect = rectOf(container);
    const buttonRect = rectOf(button);
    if (!rect || !buttonRect || !rect.width || !rect.height || !buttonRect.width || !buttonRect.height) return false;
    const view = doc.defaultView || root;
    const viewportArea = Math.max(1, Number(view.innerWidth || 0) * Number(view.innerHeight || 0));
    const explicitModal = container.matches?.('[role="dialog"],dialog[open],[aria-modal="true"],[data-testid*="modal" i]');
    if (!explicitModal && rect.width * rect.height > viewportArea * 0.6) return false;
    const label = [button.getAttribute?.('aria-label'), button.getAttribute?.('title'),
      button.getAttribute?.('data-testid'), button.innerText, button.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (/^(close|dismiss|not now|maybe later|закрыть|не сейчас|позже|×|✕)$/i.test(label)) return true;
    const smallIcon = buttonRect.width <= 64 && buttonRect.height <= 64 && !!button.querySelector?.('svg');
    const topRight = buttonRect.left >= rect.left + rect.width * 0.55
      && buttonRect.top <= rect.top + Math.min(110, rect.height * 0.35);
    return smallIcon && topRight;
  };

  const findOwnedPromotionClose = (doc = root.document) => {
    const buttons = Array.from(doc.querySelectorAll('button,[role="button"]'));
    for (const button of buttons) {
      let container = button.parentElement;
      for (let depth = 0; container && depth < 8; depth += 1, container = container.parentElement) {
        if (ownsPromotionClose(container, button, doc)) return { button, container };
      }
    }
    return null;
  };

  const clear = (element) => {
    try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
    if ('value' in element) {
      const proto = Object.getPrototypeOf(element);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement?.prototype || {}, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLInputElement?.prototype || {}, 'value')?.set;
      if (setter) setter.call(element, ''); else element.value = '';
    } else {
      try {
        const selection = element.ownerDocument?.getSelection?.();
        const range = element.ownerDocument?.createRange?.();
        range?.selectNodeContents(element);
        selection?.removeAllRanges?.();
        if (range) selection?.addRange?.(range);
        element.ownerDocument?.execCommand?.('delete', false, null);
      } catch (_) {}
      if (read(element).trim()) element.textContent = '';
    }
    try { element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null, composed: true })); } catch (_) {}
  };

  const insert = async (element, prompt, options = {}) => {
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (!element || !prompt) return { ok: false, reason: 'missing_composer_or_prompt' };
    clear(element);
    try { element.focus?.({ preventScroll: true }); } catch (_) { element.focus?.(); }
    let method = 'unknown';
    if ('value' in element) {
      const proto = Object.getPrototypeOf(element);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLTextAreaElement?.prototype || {}, 'value')?.set
        || Object.getOwnPropertyDescriptor(root.HTMLInputElement?.prototype || {}, 'value')?.set;
      if (setter) setter.call(element, prompt); else element.value = prompt;
      try { element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: prompt })); } catch (_) {}
      try { element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: prompt })); } catch (_) {}
      try { element.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (_) {}
      method = 'native_value';
    } else {
      try {
        const doc = element.ownerDocument || root.document;
        const selection = doc.getSelection?.();
        const range = doc.createRange?.();
        range?.selectNodeContents(element);
        range?.collapse(false);
        selection?.removeAllRanges?.();
        if (range) selection?.addRange?.(range);
        element.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: prompt
        }));
        const inserted = doc.execCommand?.('insertText', false, prompt) === true;
        if (!inserted && !promptMatches(read(element), prompt)) {
          const fallbackRange = doc.createRange?.();
          fallbackRange?.selectNodeContents(element);
          fallbackRange?.deleteContents?.();
          fallbackRange?.insertNode?.(doc.createTextNode(prompt));
        }
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true, composed: true, inputType: 'insertText', data: prompt
        }));
        method = inserted ? 'beforeinput_exec_command' : 'beforeinput_range';
      } catch (_) {
        element.textContent = prompt;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        method = 'dom_fallback';
      }
    }
    await sleep(Number(options.settleMs || 160));
    return promptMatches(read(element), prompt)
      ? { ok: true, method, value: read(element) }
      : { ok: false, method, reason: 'prompt_not_present', value: read(element) };
  };

  const prepare = async ({ doc = root.document, prompt = '', selectors = DEFAULT_SELECTORS,
    attempts = 3, settleMs = 180, sleep, insertStrategy } = {}) => {
    const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const history = [];
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
      const resolved = resolveComposer(doc, selectors);
      const composer = resolved.element;
      if (!composer) {
        history.push({ attempt, reason: 'composer_not_found', candidates: resolved.diagnostics });
        await wait(settleMs);
        continue;
      }
      const result = insertStrategy
        ? await insertStrategy(composer, prompt, { attempt, settleMs })
        : await insert(composer, prompt, { sleep: wait, settleMs });
      await wait(settleMs);
      const live = resolveComposer(doc, selectors);
      const acceptedComposer = promptMatches(read(live.element), prompt)
        ? live.element
        : (composer.isConnected && promptMatches(read(composer), prompt) ? composer : null);
      const sendControl = acceptedComposer ? resolveSendControl(acceptedComposer) : null;
      const accepted = Boolean(result?.ok && acceptedComposer && sendControl && isVisible(sendControl));
      history.push({
        attempt,
        insertMethod: result?.method || null,
        inserted: result?.ok === true,
        nodeReplaced: !!live.element && live.element !== composer,
        sendControlReady: !!sendControl && isVisible(sendControl),
        selected: describe(acceptedComposer || live.element || composer, live.score),
        candidates: live.diagnostics
      });
      if (accepted) {
        return { ok: true, method: result.method, composer: acceptedComposer, sendControl, history };
      }
      await wait(settleMs);
    }
    const last = history[history.length - 1] || {};
    return {
      ok: false,
      reason: last.inserted ? 'send_control_not_ready' : (last.reason || 'prompt_not_present'),
      history
    };
  };

  const api = Object.freeze({
    DEFAULT_SELECTORS,
    normalize,
    read,
    promptMatches,
    isVisible,
    resolveSendControl,
    describe,
    scoreComposer,
    collectCandidates,
    resolveComposer,
    ownsPromotionClose,
    findOwnedPromotionClose,
    insert,
    prepare
  });
  root.PerplexityComposerTransaction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

const setRect = (el, rect) => {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: rect.top,
      left: rect.left,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height
    })
  });
};

const flushAsync = async (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const resetChrome = () => {
  global.chrome = {
    runtime: {
      sendMessage: jest.fn(),
      lastError: null,
      onMessage: {
        addListener: jest.fn()
      },
      getManifest: jest.fn(() => ({ version: 'test-version' }))
    },
    storage: {
      local: {
        _store: new Map(),
        async get(key) {
          if (key === null) {
            const obj = {};
            this._store.forEach((value, k) => { obj[k] = value; });
            return obj;
          }
          if (typeof key === 'string') {
            return { [key]: this._store.get(key) };
          }
          const result = {};
          Object.keys(key || {}).forEach((k) => {
            result[k] = this._store.get(k) ?? key[k];
          });
          return result;
        },
        async set(obj) {
          Object.entries(obj || {}).forEach(([k, v]) => {
            this._store.set(k, v);
          });
        },
        async remove(keys) {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => this._store.delete(k));
        }
      },
      onChanged: {
        addListener: jest.fn()
      }
    }
  };
  global.chrome.runtime.__sendMessageMock = global.chrome.runtime.sendMessage;
  window.chrome = global.chrome;
};

const bootstrapModules = () => {
  resetChrome();
  delete window.LLMExtension;
  delete window.SelectorProfileLifecycle;
  delete window.SelectorResolverV2;
  delete window.ResponseLifecycleDetector;
  delete window.SelectorConfig;
  document.head.replaceChildren();
  document.body.replaceChildren();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  loadScript('shared/selector-profile-lifecycle.js');
  loadScript('content-utils/selector-resolver-v2.js');
  loadScript('content-utils/response-lifecycle-detector.js');
};

describe('SelectorResolverV2 and ResponseLifecycleDetector', () => {
  beforeEach(() => {
    bootstrapModules();
  });

  test('finds textarea composer in lower viewport', async () => {
    const composer = document.createElement('textarea');
    composer.placeholder = 'Write your message';
    setRect(composer, { top: 700, left: 120, width: 600, height: 80 });
    document.body.appendChild(composer);

    const result = await window.SelectorResolverV2.resolveComposer({ modelName: 'GPT' });
    expect(result.ok).toBe(true);
    expect(result.element).toBe(composer);
  });

  test('finds contenteditable composer', async () => {
    const composer = document.createElement('div');
    composer.setAttribute('contenteditable', 'true');
    composer.setAttribute('role', 'textbox');
    composer.setAttribute('aria-label', 'Message Claude');
    setRect(composer, { top: 640, left: 160, width: 620, height: 60 });
    document.body.appendChild(composer);

    const result = await window.SelectorResolverV2.resolveComposer({ modelName: 'Claude' });
    expect(result.ok).toBe(true);
    expect(result.element).toBe(composer);
  });

  test('broken selector health profile skips exact/cache and uses fallback strategy', async () => {
    await chrome.storage.local.set({
      selector_health_profile_v1: {
        updatedAt: Date.now(),
        profiles: {
          'GPT::composer': {
            profileStatus: 'broken',
            hits: 0,
            failures: 4,
            total: 4,
            lastKnownGoodVersion: 'stable-v1',
            updatedAt: Date.now()
          }
        }
      }
    });

    const exactCandidate = document.createElement('div');
    exactCandidate.id = 'bad-composer';
    exactCandidate.setAttribute('contenteditable', 'true');
    exactCandidate.setAttribute('role', 'textbox');
    exactCandidate.setAttribute('aria-label', 'Message');
    setRect(exactCandidate, { top: 30, left: 20, width: 500, height: 60 });
    document.body.appendChild(exactCandidate);

    const composer = document.createElement('textarea');
    composer.placeholder = 'Write your message';
    setRect(composer, { top: 700, left: 120, width: 600, height: 80 });
    document.body.appendChild(composer);

    const result = await window.SelectorResolverV2.resolveComposer({
      modelName: 'GPT',
      selectors: ['#bad-composer']
    });

    expect(result.ok).toBe(true);
    expect(result.method).not.toBe('exact');
    expect(result.diagnostics).toEqual(expect.objectContaining({
      selectorProfileStatus: 'broken',
      selectorProfileBroken: true,
      selectorProfileLifecycle: expect.objectContaining({
        action: 'rollback_to_last_known_good',
        rollbackRequired: true,
        selectedVersion: 'stable-v1'
      }),
      exactSkipped: true,
      cacheSkipped: true
    }));
  });

  test('rejects hidden composer and header search box', async () => {
    const header = document.createElement('header');
    const search = document.createElement('input');
    search.type = 'search';
    search.setAttribute('aria-label', 'Search');
    setRect(search, { top: 20, left: 20, width: 240, height: 40 });
    header.appendChild(search);
    document.body.appendChild(header);

    const hiddenComposer = document.createElement('textarea');
    hiddenComposer.placeholder = 'Write prompt';
    hiddenComposer.style.display = 'none';
    setRect(hiddenComposer, { top: 760, left: 80, width: 560, height: 60 });
    document.body.appendChild(hiddenComposer);

    const result = await window.SelectorResolverV2.resolveComposer({ modelName: 'GPT' });
    expect(result.ok).toBe(false);
  });

  test('finds send button near composer and rejects attach button', async () => {
    const form = document.createElement('form');
    const composer = document.createElement('textarea');
    composer.placeholder = 'Type a message';
    setRect(composer, { top: 720, left: 120, width: 540, height: 64 });
    form.appendChild(composer);

    const attach = document.createElement('button');
    attach.setAttribute('aria-label', 'Attach file');
    attach.textContent = 'Attach';
    setRect(attach, { top: 724, left: 70, width: 40, height: 40 });
    form.appendChild(attach);

    const send = document.createElement('button');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send message');
    setRect(send, { top: 724, left: 680, width: 44, height: 44 });
    form.appendChild(send);

    document.body.appendChild(form);

    const result = await window.SelectorResolverV2.resolveSendButton({
      modelName: 'GPT',
      composerEl: composer
    });
    expect(result.ok).toBe(true);
    expect(result.element).toBe(send);
  });

  test('buildStableSelector always returns object and can produce unique nth-of-type fallback', () => {
    const unique = document.createElement('button');
    unique.id = 'unique-send';
    document.body.appendChild(unique);

    const first = document.createElement('div');
    first.setAttribute('data-testid', 'dup');
    document.body.appendChild(first);

    const second = document.createElement('div');
    second.setAttribute('data-testid', 'dup');
    document.body.appendChild(second);

    const uniqueResult = window.SelectorResolverV2.buildStableSelector(unique);
    const dupResult = window.SelectorResolverV2.buildStableSelector(first);

    expect(typeof uniqueResult).toBe('object');
    expect(uniqueResult.unique).toBe(true);
    expect(typeof dupResult).toBe('object');
    expect(typeof dupResult.unique).toBe('boolean');
  });

  test('saveSuccessfulResolution does not persist non-unique selector', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const first = document.createElement('div');
    first.setAttribute('data-testid', 'composer-dup');
    first.setAttribute('contenteditable', 'true');
    setRect(first, { top: 660, left: 100, width: 500, height: 60 });
    shadow.appendChild(first);
    document.body.appendChild(host);

    const candidate = {
      el: first,
      fingerprint: window.SelectorResolverV2.buildElementFingerprint(first),
      score: 80,
      source: 'semantic'
    };
    await window.SelectorResolverV2.saveSuccessfulResolution({
      modelName: 'GPT',
      role: 'composer',
      candidate
    });
    const stored = await window.SelectorResolverV2.loadCachedResolution({ modelName: 'GPT', role: 'composer' });
    expect(stored.selector).toBe(null);
    expect(stored.selectorUnique).toBe(false);
  });

  test('validateCachedResolution rejects missing and non-unique selector', async () => {
    await chrome.storage.local.set({
      'selector_resolver_v2::GPT::composer': {
        version: '2.0.0',
        modelName: 'GPT',
        role: 'composer',
        selector: null,
        selectorUnique: false,
        failureCount: 0
      }
    });
    const result = await window.SelectorResolverV2.validateCachedResolution({
      modelName: 'GPT',
      role: 'composer'
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('cache_selector_missing_or_not_unique');
  });

  test('fingerprint similarity uses weighted algorithm', () => {
    const a = {
      tagName: 'button',
      role: 'button',
      type: 'submit',
      ariaLabel: 'Send',
      title: '',
      placeholder: '',
      dataTestId: 'send',
      parentTag: 'form',
      parentRole: '',
      textHash: 'aaa',
      nearbyTextHash: 'bbb',
      siblingButtonCount: 2,
      classTokens: ['send', 'primary'],
      parentClassTokens: ['composer'],
      rectBucket: { xBucket: 3, yBucket: 4, region: 'bottom-right' }
    };
    const b = Object.assign({}, a, { ariaLabel: 'Submit' });
    const similarity = window.SelectorResolverV2.calculateFingerprintSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.7);
    expect(similarity).toBeLessThan(1);
  });

  test('uiRevision mismatch increases threshold to 0.75', async () => {
    const button = document.createElement('button');
    button.id = 'cached-send';
    button.setAttribute('aria-label', 'Send message');
    setRect(button, { top: 760, left: 700, width: 40, height: 40 });
    document.body.appendChild(button);

    window.SelectorConfig = {
      detectUIVersion: jest.fn(() => 'v2')
    };

    await chrome.storage.local.set({
      'selector_resolver_v2::GPT::sendButton': {
        version: '2.0.0',
        modelName: 'GPT',
        role: 'sendButton',
        selector: '#cached-send',
        selectorUnique: true,
        fingerprint: {
          tagName: 'button',
          role: '',
          type: '',
          ariaLabel: 'Old Send',
          title: '',
          placeholder: '',
          dataTestId: '',
          parentTag: '',
          parentRole: '',
          textHash: 'old',
          nearbyTextHash: 'old2',
          siblingButtonCount: 0,
          classTokens: [],
          parentClassTokens: [],
          rectBucket: { xBucket: 3, yBucket: 4, region: 'bottom-right' }
        },
        uiRevision: 'v1',
        failureCount: 0,
        successCount: 0
      }
    });

    const result = await window.SelectorResolverV2.validateCachedResolution({
      modelName: 'GPT',
      role: 'sendButton'
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fingerprint_similarity_below_threshold');
    expect(result.requiredSimilarity).toBe(0.75);
  });

  test('queryAllDeep respects hasBudget and limits results', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    for (let i = 0; i < 350; i += 1) {
      const span = document.createElement('span');
      span.className = 'target';
      shadow.appendChild(span);
    }
    document.body.appendChild(host);

    let budget = 0;
    const limited = window.SelectorResolverV2.queryAllDeep(document, '.target', 2, () => {
      budget += 1;
      return budget < 3;
    });
    const full = window.SelectorResolverV2.queryAllDeep(document, '.target', 2, () => true);

    expect(limited.length).toBeLessThanOrEqual(full.length);
    expect(full.length).toBeLessThanOrEqual(300);
  });

  test('answer fallback only runs below length 80 via runtime patch', async () => {
    const transport = chrome.runtime.__sendMessageMock;
    const answerNode = document.createElement('article');
    answerNode.textContent = 'This is a sufficiently long fallback answer captured from the DOM to replace the short outgoing payload from the content script.';
    setRect(answerNode, { top: 500, left: 120, width: 700, height: 220 });
    document.body.appendChild(answerNode);

    chrome.runtime.sendMessage({
      type: 'LLM_RESPONSE',
      llmName: 'GPT',
      answer: 'short',
      meta: { dispatchId: 'd1' }
    });

    await flushAsync(20);
    expect(transport).toHaveBeenCalled();
    const sent = transport.mock.calls.find(([msg]) => msg?.type === 'LLM_RESPONSE');
    expect(sent[0].answer.length).toBeGreaterThanOrEqual(80);

    transport.mockClear();
    chrome.runtime.sendMessage({
      type: 'LLM_RESPONSE',
      llmName: 'GPT',
      answer: 'x'.repeat(100),
      meta: { dispatchId: 'd2' }
    });
    await flushAsync(20);
    const longPayload = transport.mock.calls.find(([msg]) => msg?.type === 'LLM_RESPONSE');
    expect(longPayload[0].answer).toBe('x'.repeat(100));
  });

  test('resolveLatestAssistantAnswer prefers the last DOM turn over a longer old answer', async () => {
    const oldAnswer = document.createElement('article');
    oldAnswer.setAttribute('data-message-author-role', 'assistant');
    oldAnswer.textContent = 'Old '.repeat(1000);
    setRect(oldAnswer, { top: 200, left: 120, width: 700, height: 220 });
    const newAnswer = document.createElement('article');
    newAnswer.setAttribute('data-message-author-role', 'assistant');
    newAnswer.textContent = 'This is the newer and intentionally shorter assistant answer.'.repeat(3);
    setRect(newAnswer, { top: 600, left: 120, width: 700, height: 220 });
    document.body.append(oldAnswer, newAnswer);

    const result = await window.SelectorResolverV2.resolveLatestAssistantAnswer({
      modelName: 'GPT',
      selectors: ['article[data-message-author-role="assistant"]'],
      preferCached: true
    });

    expect(result.ok).toBe(true);
    expect(result.element).toBe(newAnswer);
    expect(result.method).not.toBe('cache');
  });

  test('extractSafeVisibleText normalizes and caps fallback DOM text', () => {
    const answer = document.createElement('article');
    answer.textContent = '  alpha\n\n beta   gamma delta  ';
    setRect(answer, { top: 520, left: 120, width: 640, height: 120 });
    document.body.appendChild(answer);

    const text = window.SelectorResolverV2.extractSafeVisibleText(answer, 16);

    expect(text).toBe('alpha beta gamma');
    expect(text.length).toBeLessThanOrEqual(16);
  });

  test('lifecycle answer start is not equated with PROMPT_SUBMITTED', async () => {
    const detector = window.ResponseLifecycleDetector;
    detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-1',
      promptSubmittedAt: Date.now()
    });
    await flushAsync(10);
    const start = await detector.waitForAnswerStart({
      modelName: 'GPT',
      promptSubmittedAt: Date.now(),
      timeoutMs: 40,
      pollIntervalMs: 10
    });
    expect(start.ok).toBe(false);
    expect(start.reason).toBe('answer_start_timeout');
  });

  test('lifecycle completion requires text stability', async () => {
    loadScript('content-scripts/answer-pipeline-selectors.js');
    loadScript('content-scripts/turn-resolver.js');
    loadScript('content-scripts/answer-structure.js');
    loadScript('content-scripts/generation-signal.js');
    loadScript('shared/answer-verification.js');
    window.AnswerPipelineConfig = { finalization: { stabilityChecks: 2, stabilityRetryBudget: 1, stabilityInterval: 5 } };
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.setAttribute('data-message-author-role', 'assistant');
    oldAnswer.textContent = 'Old answer already present before dispatch.';
    setRect(oldAnswer, { top: 420, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: oldAnswer, observedAt: Date.now(), traceId: 'dispatch-2' });
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-2',
      runSessionId: 123,
      promptSubmittedAt: Date.now()
    });
    const answer = document.createElement('article');
    answer.setAttribute('data-message-author-role', 'assistant');
    answer.textContent = 'Initial stable answer text long enough to be considered content.';
    setRect(answer, { top: 640, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, observedAt: Date.now(), traceId: 'dispatch-2' });
    const start = await detector.waitForAnswerStart({ modelName: 'GPT', promptSubmittedAt: Date.now() - 10, timeoutMs: 150, pollIntervalMs: 10, traceId: 'dispatch-2' });
    expect(start.ok).toBe(true);
    const complete = await detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 400,
      stableMs: 80,
      pollIntervalMs: 20
    });
    expect(complete.ok).toBe(true);
    expect(complete.state).toBe('COMPLETE');
    expect(complete.confidence).toBeGreaterThanOrEqual(0.75);
  });

  test('stopResponseLifecycleTracking is idempotent and returns stable shape', async () => {
    const detector = window.ResponseLifecycleDetector;
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-stop',
      promptSubmittedAt: Date.now()
    });

    const first = detector.stopResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-stop',
      reason: 'test_cancel'
    });
    const second = detector.stopResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-stop',
      reason: 'test_cancel'
    });

    expect(first).toEqual({ ok: true, stopped: true, reason: 'test_cancel' });
    expect(second).toEqual({ ok: true, stopped: false, reason: 'no_active_tracker' });
  });

  test('cancelled lifecycle cannot emit ready or complete', async () => {
    const detector = window.ResponseLifecycleDetector;
    const answer = document.createElement('article');
    answer.textContent = 'Stable answer text long enough for completion after cancellation.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, observedAt: Date.now() });
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-cancel',
      promptSubmittedAt: Date.now()
    });

    const completePromise = detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 500,
      stableMs: 120,
      pollIntervalMs: 100
    });
    await flushAsync(20);
    detector.stopResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-cancel',
      reason: 'test_cancel'
    });

    const result = await completePromise;
    const readyCalls = chrome.runtime.__sendMessageMock.mock.calls
      .map(([msg]) => msg)
      .filter((msg) => msg?.type === 'LLM_RESPONSE_READY');

    expect(result.ok).toBe(false);
    expect(result.state).toBe('CANCELLED');
    expect(result.reason).toBe('test_cancel');
    expect(readyCalls).toHaveLength(0);
  });

  test('lifecycle defers heavy resolver readiness until text is stable', async () => {
    const detector = window.ResponseLifecycleDetector;
    const answer = document.createElement('article');
    answer.textContent = 'Answer text is still growing and should avoid heavy readiness checks.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, observedAt: Date.now() });

    const resolveComposer = jest.fn(async () => ({ ok: false, element: null }));
    const resolveSendButton = jest.fn(async () => ({ ok: false, element: null }));
    window.LLMExtension.SelectorResolverV2.resolveComposer = resolveComposer;
    window.LLMExtension.SelectorResolverV2.resolveSendButton = resolveSendButton;

    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-heavy',
      promptSubmittedAt: Date.now()
    });
    const timer = setInterval(() => {
      answer.textContent += ' growing';
    }, 20);
    const result = await detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 180,
      stableMs: 120,
      pollIntervalMs: 20
    });
    clearInterval(timer);

    expect(result.ok).toBe(false);
    expect(result.partial).toBe(true);
    expect(resolveComposer).not.toHaveBeenCalled();
    expect(resolveSendButton).not.toHaveBeenCalled();
  });

  test('lifecycle emits partial true on timeout', async () => {
    const detector = window.ResponseLifecycleDetector;
    const answer = document.createElement('article');
    answer.textContent = 'partial answer text that keeps changing';
    setRect(answer, { top: 560, left: 120, width: 700, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, observedAt: Date.now() });
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-3',
      promptSubmittedAt: Date.now()
    });
    const timer = setInterval(() => {
      answer.textContent += ' .';
    }, 20);
    const result = await detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 160,
      stableMs: 100,
      pollIntervalMs: 20
    });
    clearInterval(timer);
    expect(result.ok).toBe(false);
    expect(result.partial).toBe(true);
  });

  test('lifecycle telemetry does not store full answer', async () => {
    const detector = window.ResponseLifecycleDetector;
    const answer = document.createElement('article');
    answer.textContent = 'This is a long answer that should never be persisted inside lifecycle telemetry payloads.';
    setRect(answer, { top: 520, left: 160, width: 720, height: 160 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: answer, observedAt: Date.now() });
    await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'dispatch-4',
      promptSubmittedAt: Date.now()
    });
    await detector.waitForAnswerComplete({
      modelName: 'GPT',
      timeoutMs: 300,
      stableMs: 60,
      pollIntervalMs: 20
    });
    const diagCalls = chrome.runtime.__sendMessageMock.mock.calls
      .map(([msg]) => msg)
      .filter((msg) => msg?.type === 'LLM_DIAGNOSTIC_EVENT');
    expect(diagCalls.length).toBeGreaterThan(0);
    diagCalls.forEach((msg) => {
      expect(msg.event.meta.answer).toBeUndefined();
      expect(msg.event.meta.prompt).toBeUndefined();
    });
  });

  test('stop and regenerate resolvers are explicit stubs', async () => {
    const stop = await window.SelectorResolverV2.resolveStopButton({ modelName: 'GPT' });
    const regen = await window.SelectorResolverV2.resolveRegenerateButton({ modelName: 'GPT' });
    expect(stop.ok).toBe(false);
    expect(stop.diagnostics.reason).toContain('not_specified');
    expect(regen.ok).toBe(false);
    expect(regen.diagnostics.reason).toContain('not_specified');
  });
});

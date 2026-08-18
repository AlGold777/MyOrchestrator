const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

const setRect = (el, { top, left, width, height }) => {
  el.getBoundingClientRect = () => ({
    top, left, width, height,
    right: left + width, bottom: top + height, x: left, y: top
  });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
};

describe('lifecycle stuck-busy handling', () => {
  let sentMessages;

  beforeEach(() => {
    delete window.LLMExtension;
    delete window.ResponseLifecycleDetector;
    document.head.replaceChildren();
    document.body.replaceChildren();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    sentMessages = [];
    global.chrome.runtime.sendMessage = (message, callback) => {
      sentMessages.push(message);
      if (typeof callback === 'function') callback(message?.type === 'LLM_COMPLETION_ATTEMPT'
        ? { status: 'completion_attempt_recorded' }
        : {});
    };
    window.chrome = global.chrome;
    loadScript('content-utils/response-lifecycle-detector.js');
    const startLifecycle = window.ResponseLifecycleDetector.startResponseLifecycleTracking;
    window.ResponseLifecycleDetector.startResponseLifecycleTracking = (options) => startLifecycle({ ...options, activateObservation: true });
  });

  const readyEvents = () => sentMessages.filter((m) => m?.type === 'LLM_RESPONSE_READY');

  test('an invisible spinner does not register as a generating indicator', () => {
    const detector = window.ResponseLifecycleDetector;
    const spinner = document.createElement('div');
    spinner.className = 'chat-spinner';
    spinner.style.visibility = 'hidden';
    setRect(spinner, { top: 300, left: 300, width: 24, height: 24 });
    document.body.appendChild(spinner);

    const indicators = detector.detectGeneratingIndicators({ root: document });
    expect(indicators.hasLoadingIndicator).toBe(false);
    expect(indicators.stopButtonSignal).toBe(false);
  });

  test('a visible progressbar blocks completion even with stable text', async () => {
    const detector = window.ResponseLifecycleDetector;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'progressbar');
    setRect(bar, { top: 300, left: 300, width: 200, height: 8 });
    document.body.appendChild(bar);

    const answer = document.createElement('article');
    answer.textContent = 'Stable generated answer long enough to be treated as a real response by the detector.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);

    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName: 'DeepSeek', dispatchId: 'sb-1', runSessionId: 1, promptSubmittedAt: submittedAt, traceId: 'sb-1' });
    detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: answer, observedAt: Date.now(), traceId: 'sb-1' });
    const start = await detector.waitForAnswerStart({ modelName: 'DeepSeek', promptSubmittedAt: submittedAt, timeoutMs: 200, pollIntervalMs: 10, traceId: 'sb-1' });
    expect(start.ok).toBe(true);
    const result = await detector.waitForAnswerComplete({ modelName: 'DeepSeek', timeoutMs: 300, stableMs: 40, pollIntervalMs: 20, traceId: 'sb-1' });
    expect(result.ok).toBe(false);
    expect(readyEvents()).toHaveLength(0);
    detector.stopResponseLifecycleTracking({ modelName: 'DeepSeek', reason: 'test_done' });
  });

  test('a stale loading signal remains an active veto instead of timing into success', async () => {
    const detector = window.ResponseLifecycleDetector;
    const spinner = document.createElement('div');
    spinner.className = 'sidebar-loading-decor';
    setRect(spinner, { top: 60, left: 20, width: 24, height: 24 });
    document.body.appendChild(spinner);

    const answer = document.createElement('article');
    answer.textContent = 'Stable generated answer long enough to be treated as a real response by the detector.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);

    const composer = document.createElement('textarea');
    setRect(composer, { top: 700, left: 140, width: 720, height: 60 });
    document.body.appendChild(composer);

    const realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow.call(Date) + offset;
    try {
      const submittedAt = Date.now();
      await detector.startResponseLifecycleTracking({ modelName: 'DeepSeek', dispatchId: 'sb-2', runSessionId: 2, promptSubmittedAt: submittedAt, traceId: 'sb-2' });
      detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: answer, observedAt: Date.now(), traceId: 'sb-2' });
      const start = await detector.waitForAnswerStart({ modelName: 'DeepSeek', promptSubmittedAt: submittedAt, timeoutMs: 200, pollIntervalMs: 10, traceId: 'sb-2' });
      expect(start.ok).toBe(true);
      const jump = setInterval(() => { offset += 2000; }, 5);
      const result = await detector.waitForAnswerComplete({ modelName: 'DeepSeek', timeoutMs: 60000, stableMs: 40, pollIntervalMs: 10, traceId: 'sb-2' });
      clearInterval(jump);
      expect(result.ok).toBe(false);
      expect(result.terminalResult?.status).toBe('STALLED');
      expect(readyEvents()).toHaveLength(0);
    } finally {
      Date.now = realNow;
      detector.stopResponseLifecycleTracking({ modelName: 'DeepSeek', reason: 'test_done' });
    }
  });
});

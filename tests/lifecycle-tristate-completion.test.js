// Tri-state completion contract (review idea P0.2 + localized stop-button fix):
// completion is inferred only from a CONFIRMED-absent stop button. A present stop
// button — including localized labels (Arrêter/Останов) that the old /stop/i regex
// missed — must block completion. A clean page must still complete (no over-blocking).
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

describe('tri-state completion (stop-button)', () => {
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
      if (typeof callback === 'function') callback({});
    };
    window.chrome = global.chrome;
    loadScript('content-utils/response-lifecycle-detector.js');
  });

  const completeEvents = () => sentMessages.filter((m) =>
    m?.type === 'LLM_DIAGNOSTIC_EVENT' && m?.event?.label === 'ANSWER_COMPLETE_DETECTED');
  const readyEvents = () => sentMessages.filter((m) => m?.type === 'LLM_RESPONSE_READY');

  const runTracking = async (modelName) => {
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.textContent = 'Old response that existed before this dispatch and must not complete it.';
    setRect(oldAnswer, { top: 420, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName, element: oldAnswer, observedAt: Date.now(), traceId: `d-${modelName}` });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName, dispatchId: `d-${modelName}`, runSessionId: 77, promptSubmittedAt: submittedAt, traceId: `d-${modelName}` });
    const answer = document.createElement('article');
    answer.textContent = 'Stable generated answer long enough to be treated as a real response by the detector.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);
    detector.registerAnswerCandidate({ modelName, element: answer, observedAt: Date.now(), traceId: `d-${modelName}` });
    const start = await detector.waitForAnswerStart({ modelName, promptSubmittedAt: submittedAt, timeoutMs: 200, pollIntervalMs: 10, traceId: `d-${modelName}` });
    expect(start.ok).toBe(true);
    await detector.waitForAnswerComplete({ modelName, timeoutMs: 600, stableMs: 60, pollIntervalMs: 20 });
    detector.stopResponseLifecycleTracking({ modelName, reason: 'test_done' });
  };

  test('a present localized stop button (Arrêter) blocks completion', async () => {
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Arrêter la génération');
    setRect(stop, { top: 740, left: 140, width: 40, height: 40 });
    document.body.appendChild(stop);

    await runTracking('Grok');

    expect(completeEvents()).toHaveLength(0);
    expect(readyEvents()).toHaveLength(0);
  });

  test('a clean page (confirmed-absent stop) still completes', async () => {
    await runTracking('GPT');
    expect(completeEvents().length).toBeGreaterThanOrEqual(1);
  });

  test('an answer that existed before dispatch never starts or completes the new turn', async () => {
    const detector = window.ResponseLifecycleDetector;
    const oldAnswer = document.createElement('article');
    oldAnswer.textContent = 'Old stable response that must remain quarantined from the new dispatch.';
    setRect(oldAnswer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(oldAnswer);
    detector.registerAnswerCandidate({ modelName: 'GPT', element: oldAnswer, traceId: 'old-guard' });
    const submittedAt = Date.now();
    await detector.startResponseLifecycleTracking({ modelName: 'GPT', dispatchId: 'old-guard', runSessionId: 88, promptSubmittedAt: submittedAt, traceId: 'old-guard' });
    const start = await detector.waitForAnswerStart({ modelName: 'GPT', promptSubmittedAt: submittedAt, timeoutMs: 100, pollIntervalMs: 10, traceId: 'old-guard' });
    expect(start.ok).toBe(false);
    await detector.waitForAnswerComplete({ modelName: 'GPT', timeoutMs: 120, stableMs: 40, pollIntervalMs: 10, traceId: 'old-guard' });
    expect(completeEvents()).toHaveLength(0);
    expect(readyEvents()).toHaveLength(0);
  });
});

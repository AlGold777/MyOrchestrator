const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const content = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(content);
};

const setRect = (el, { top, left, width, height }) => {
  el.getBoundingClientRect = () => ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top
  });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
};

describe('lifecycle ANSWER_GENERATING telemetry throttle', () => {
  let sentMessages;

  // The detector patches chrome.runtime.sendMessage at load, so record messages
  // with a plain function installed before the script is evaluated.
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

  const generatingMessages = () => sentMessages.filter((message) => (
    message?.type === 'LLM_DIAGNOSTIC_EVENT' && message?.event?.label === 'ANSWER_GENERATING'
  ));

  test('stable text with a stuck loading indicator emits ANSWER_GENERATING once, not per tick', async () => {
    const detector = window.ResponseLifecycleDetector;

    const answer = document.createElement('article');
    answer.textContent = 'Stable answer text long enough to be treated as real generated content for the detector.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);

    // Stuck busy indicator: the DeepSeek failure mode from run 1781157526316 where
    // text stayed at the same length while a loading element never disappeared.
    const spinner = document.createElement('div');
    spinner.className = 'loading-indicator';
    setRect(spinner, { top: 740, left: 140, width: 32, height: 32 });
    document.body.appendChild(spinner);

    detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: answer, observedAt: Date.now() });
    await detector.startResponseLifecycleTracking({
      modelName: 'DeepSeek',
      dispatchId: 'dispatch-throttle',
      promptSubmittedAt: Date.now()
    });

    await detector.waitForAnswerComplete({
      modelName: 'DeepSeek',
      timeoutMs: 600,
      stableMs: 60,
      pollIntervalMs: 20
    });

    const generatingEvents = generatingMessages();

    // ~25 poll ticks happen in the window; without the throttle each tick emitted one event.
    expect(generatingEvents.length).toBeGreaterThanOrEqual(1);
    expect(generatingEvents.length).toBeLessThanOrEqual(2);

    detector.stopResponseLifecycleTracking({ modelName: 'DeepSeek', reason: 'test_done' });
  });

  test('text growth re-emits ANSWER_GENERATING despite the time throttle', async () => {
    const detector = window.ResponseLifecycleDetector;

    const answer = document.createElement('article');
    answer.textContent = 'First chunk of generated answer text that is long enough for tracking.';
    setRect(answer, { top: 540, left: 140, width: 720, height: 180 });
    document.body.appendChild(answer);

    const spinner = document.createElement('div');
    spinner.className = 'loading-indicator';
    setRect(spinner, { top: 740, left: 140, width: 32, height: 32 });
    document.body.appendChild(spinner);

    detector.registerAnswerCandidate({ modelName: 'DeepSeek', element: answer, observedAt: Date.now() });
    await detector.startResponseLifecycleTracking({
      modelName: 'DeepSeek',
      dispatchId: 'dispatch-throttle-2',
      promptSubmittedAt: Date.now()
    });

    const wait = detector.waitForAnswerComplete({
      modelName: 'DeepSeek',
      timeoutMs: 600,
      stableMs: 60,
      pollIntervalMs: 20
    });

    // Let the first stable window emit, then grow the text and let it stabilize again.
    await new Promise((resolve) => setTimeout(resolve, 250));
    answer.textContent += ' Second chunk appended after a pause, noticeably longer than before to change length.';
    await wait;

    const generatingEvents = generatingMessages();
    const lengths = [...new Set(generatingEvents.map((message) => message.event?.meta?.textLength))];
    expect(generatingEvents.length).toBeGreaterThanOrEqual(2);
    expect(lengths.length).toBeGreaterThanOrEqual(2);

    detector.stopResponseLifecycleTracking({ modelName: 'DeepSeek', reason: 'test_done' });
  });
});

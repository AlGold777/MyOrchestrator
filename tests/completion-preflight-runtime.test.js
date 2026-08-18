const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  // eslint-disable-next-line no-eval
  eval(source);
};

describe('Completion preflight runtime contract', () => {
  beforeEach(() => {
    jest.useRealTimers();
    delete window.ContentUtils;
    delete window.LLMExtension;
    delete window.ResponseLifecycleDetector;
    document.body.replaceChildren();
    global.chrome.runtime.id = 'test-extension';
    global.chrome.runtime.lastError = null;
    window.chrome = global.chrome;
  });

  test('a delayed baseline ACK does not become completion_runtime_unavailable', async () => {
    window.LLMExtension = {
      ResponseLifecycleDetector: {
        captureTurnAnchor: () => 0,
        startResponseLifecycleTracking: jest.fn(async () => ({
          ok: true,
          authorityAccepted: true,
          observationArmed: false
        }))
      }
    };
    global.chrome.runtime.sendMessage = jest.fn((message, callback) => {
      if (message.type === 'DISPATCH_BASELINE_CAPTURED') {
        setTimeout(() => callback?.({ status: 'dispatch_baseline_ack' }), 1800);
      } else {
        callback?.({});
      }
    });
    loadScript('content-scripts/content-utils.js');

    await expect(window.ContentUtils.reportDispatchBaseline(
      'GPT',
      { dispatchId: 'GPT:delayed-ack', runSessionId: 77 },
      'previous answer'
    )).resolves.toBe(true);
    expect(window.__LLMDispatchPreflight).toEqual(expect.objectContaining({
      ok: true,
      dispatchId: 'GPT:delayed-ack'
    }));
  });

  test('preflight requires correlated authority ACK and does not arm answer clocks', async () => {
    const sent = [];
    global.chrome.runtime.sendMessage = (message, callback) => {
      sent.push(message);
      callback?.(message.type === 'LLM_COMPLETION_ATTEMPT'
        ? { status: 'completion_attempt_recorded' }
        : {});
    };
    loadScript('content-utils/response-lifecycle-detector.js');
    const detector = window.ResponseLifecycleDetector;
    const result = await detector.startResponseLifecycleTracking({
      modelName: 'GPT',
      dispatchId: 'GPT:preflight',
      runSessionId: 77,
      baselineText: 'previous answer'
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      authorityAccepted: true,
      observationArmed: false
    }));
    expect(result.tracker.state).toBe('ATTEMPT_PREPARED');
    expect(result.tracker.completionSession).toBeNull();
    expect(result.tracker.observationPromise).toBeNull();
    expect(sent.some((message) => message.type === 'LLM_COMPLETION_ATTEMPT')).toBe(true);
    detector.stopResponseLifecycleTracking({ modelName: 'GPT', reason: 'test_done' });
  });

  test('authority rejection fails before any observation session exists', async () => {
    global.chrome.runtime.sendMessage = (message, callback) => {
      callback?.(message.type === 'LLM_COMPLETION_ATTEMPT'
        ? { status: 'completion_attempt_rejected', reason: 'dispatch_mismatch' }
        : {});
    };
    loadScript('content-utils/response-lifecycle-detector.js');
    const result = await window.ResponseLifecycleDetector.startResponseLifecycleTracking({
      modelName: 'Claude',
      dispatchId: 'Claude:rejected',
      runSessionId: 77
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'dispatch_mismatch' }));
    expect(window.ResponseLifecycleDetector.getCompletionSnapshot({ modelName: 'Claude' })).toBeNull();
  });

  test('send-only recovery submits the prepared draft without repeating attachment or insertion', async () => {
    global.chrome.runtime.sendMessage = jest.fn((_message, callback) => callback?.({}));
    loadScript('content-scripts/content-utils.js');
    const composer = document.createElement('textarea');
    composer.value = 'prepared prompt';
    composer.getBoundingClientRect = () => ({ top: 10, left: 10, right: 410, bottom: 90, width: 400, height: 80 });
    Object.defineProperty(composer, 'offsetWidth', { configurable: true, value: 400 });
    Object.defineProperty(composer, 'offsetHeight', { configurable: true, value: 80 });
    composer.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key === 'Enter') composer.value = '';
    });
    document.body.appendChild(composer);

    await expect(window.ContentUtils.recoverPreparedComposerSend(
      'Claude', 'prepared prompt', { dispatchId: 'Claude:send-only' }
    )).resolves.toEqual(expect.objectContaining({
      ok: true,
      status: 'send_only_confirmed',
      method: 'ctrl_enter'
    }));
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PROMPT_SUBMITTED',
      llmName: 'Claude'
    }), expect.any(Function));
  });

  test('send-only recovery refuses a composer that does not hold the exact current prompt', async () => {
    global.chrome.runtime.sendMessage = jest.fn((_message, callback) => callback?.({}));
    loadScript('content-scripts/content-utils.js');
    const composer = document.createElement('textarea');
    composer.value = 'different draft';
    document.body.appendChild(composer);
    await expect(window.ContentUtils.recoverPreparedComposerSend(
      'GPT', 'current prompt', { dispatchId: 'GPT:send-only' }
    )).resolves.toEqual(expect.objectContaining({
      ok: false,
      status: 'send_only_rejected'
    }));
  });
});

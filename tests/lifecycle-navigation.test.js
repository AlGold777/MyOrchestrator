/** @jest-environment-options {"url":"https://chatgpt.com/"} */
const fs = require('fs');
const path = require('path');
const load = (name) => { eval(fs.readFileSync(path.join(__dirname, '..', name), 'utf8')); };
let detector;
let runtimeListener;
beforeAll(() => {
  chrome.runtime.id = 'test-extension';
  chrome.runtime.sendMessage = (_message, callback) => {
    callback?.({ status: 'completion_attempt_recorded' });
    return Promise.resolve({ status: 'completion_attempt_recorded' });
  };
  chrome.runtime.onMessage.addListener = (listener) => { runtimeListener = listener; };
  load('content-utils/response-lifecycle-detector.js');
  detector = window.ResponseLifecycleDetector;
});
afterEach(() => { detector.dispose(); document.body.replaceChildren(); });

const routes = [
  ['GPT', 'https://chatgpt.com/', 'https://chatgpt.com/c/new-id'],
  ['Claude', 'https://claude.ai/new', 'https://claude.ai/chat/new-id'],
  ['Gemini', 'https://gemini.google.com/app', 'https://gemini.google.com/app/new-id'],
  ['Grok', 'https://grok.com/', 'https://grok.com/c/new-id?rid=response-id'],
  ['DeepSeek', 'https://chat.deepseek.com/', 'https://chat.deepseek.com/a/chat/s/new-id'],
  ['Le Chat', 'https://chat.mistral.ai/chat/', 'https://chat.mistral.ai/chat/new-id'],
  ['Qwen', 'https://chat.qwen.ai/', 'https://chat.qwen.ai/c/new-id'],
  ['Perplexity', 'https://www.perplexity.ai/', 'https://www.perplexity.ai/search/new-id'],
  ['Kimi', 'https://www.kimi.ai/', 'https://www.kimi.ai/chat/new-id?chat_enter_method=home'],
  ['Z.ai', 'https://chat.z.ai/', 'https://chat.z.ai/c/new-id']
];
const prepare = async (modelName, url, anchor = 0) => {
  const { tracker } = await detector.startResponseLifecycleTracking({
    modelName, dispatchId: 'dispatch', runSessionId: 77, generationEpoch: 1,
    turnAnchor: anchor, baselineText: ''
  });
  tracker.navigationUrl = url;
  return tracker;
};
const send = (modelName, meta = {}) => detector.notePromptSendAttempt({
  modelName, dispatchId: 'dispatch', runSessionId: 77, ...meta
});
const navigate = (detail) => window.dispatchEvent(new CustomEvent('LLM_CODEX_SPA_NAVIGATION', { detail }));

test.each(routes)('%s preserves its own first conversation and still cancels a later chat switch', async (llmName, previousUrl, nextUrl) => {
  const tracker = await prepare(llmName, previousUrl);
  const epoch = tracker.navigationEpoch;
  expect(send(llmName)).toBe(true);
  const detail = { llmName, previousUrl, nextUrl, reason: 'href_poll' };
  navigate(detail);
  // The provider cleanup listener runs after lifecycle and makes the same decision.
  expect(detector.shouldPreserveNavigation(detail)).toBe(true);
  runtimeListener({ type: 'SPA_NAVIGATION', llmName, oldUrl: previousUrl, newUrl: nextUrl });
  expect(detector.isTrackerActive(tracker)).toBe(true);
  expect(tracker.navigationEpoch).toBe(epoch);
  expect(tracker.completionTerminalResult).toBeNull();
  navigate({ llmName, previousUrl: nextUrl, nextUrl: nextUrl.replace('new-id', 'other-id') });
  expect(tracker.cancelReason).toBe('spa_navigation');
});

test.each(['before_send', 'wrong_dispatch', 'wrong_session', 'existing_answers', 'expired_send', 'history_back', 'cross_origin'])(
  'does not preserve an unrelated navigation: %s', async (scenario) => {
    const [llmName, previousUrl, route] = routes[0];
    const tracker = await prepare(llmName, previousUrl, scenario === 'existing_answers' ? 1 : 0);
    if (scenario !== 'before_send') send(llmName, {
      ...(scenario === 'wrong_dispatch' ? { dispatchId: 'other' } : {}),
      ...(scenario === 'wrong_session' ? { runSessionId: 78 } : {})
    });
    if (scenario === 'expired_send') tracker.sendActionAt -= 120001;
    navigate({ llmName, previousUrl,
      nextUrl: scenario === 'cross_origin' ? route.replace('chatgpt.com', 'example.com') : route,
      reason: scenario === 'history_back' ? 'popstate' : 'href_poll'
    });
    expect(tracker.cancelReason).toBe('spa_navigation');
  }
);

test('query updates retain ownership before and after chat creation', async () => {
  const tracker = await prepare('Grok', 'https://grok.com/');
  navigate({ llmName: 'Grok', previousUrl: 'https://grok.com/', nextUrl: 'https://grok.com/?model=fast' });
  send('Grok');
  navigate({ llmName: 'Grok', previousUrl: 'https://grok.com/?model=fast', nextUrl: 'https://grok.com/c/new-id' });
  navigate({ llmName: 'Grok', previousUrl: 'https://grok.com/c/new-id', nextUrl: 'https://grok.com/c/new-id?rid=1' });
  expect(detector.isTrackerActive(tracker)).toBe(true);
  expect(tracker.navigationUrl).toBe('https://grok.com/c/new-id?rid=1');
});

test('Send stage, provider cleanup and base adapter agree on the same navigation', async () => {
  load('content-scripts/content-utils.js');
  load('content-scripts/base-adapter.js');
  const tracker = await prepare('GPT', window.location.href);
  const adapter = new window.BaseLLMAdapter({ model: 'GPT' });
  const observer = { disconnect: jest.fn() };
  adapter.registerObserver(observer);
  window.__cleanup_chatgpt = jest.fn();
  window.ContentUtils.reportDispatchStage('GPT', { dispatchId: 'dispatch', runSessionId: 77 }, 'send_action_requested');
  expect(tracker.sendActionAt).not.toBeNull();
  const previousUrl = window.location.href;
  history.pushState({}, '', '/c/created');
  adapter._handleNavigation();
  navigate({ llmName: 'GPT', previousUrl, nextUrl: window.location.href });
  expect(observer.disconnect).not.toHaveBeenCalled();
  expect(window.__cleanup_chatgpt).not.toHaveBeenCalled();
  expect(detector.isTrackerActive(tracker)).toBe(true);
  const createdUrl = window.location.href;
  history.pushState({}, '', '/c/other');
  adapter._handleNavigation();
  navigate({ llmName: 'GPT', previousUrl: createdUrl, nextUrl: window.location.href });
  expect(observer.disconnect).toHaveBeenCalled();
  expect(window.__cleanup_chatgpt).toHaveBeenCalled();
  adapter._cleanup('test_done');
  history.replaceState({}, '', '/');
});

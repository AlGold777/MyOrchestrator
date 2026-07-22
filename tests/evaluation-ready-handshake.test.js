describe('evaluation ready handshake', () => {
  beforeEach(() => {
    jest.resetModules();
    global.self = global;
    global.jobState = { prompt: 'p', llms: { GPT: { answer: 'a' }, Claude: { answer: 'b' } } };
    global.evaluatorTabId = null;
    global.trackSessionTab = jest.fn();
    global.sendMessageToResultsTab = jest.fn();
    global.ReadySignalManager = { waitForReady: jest.fn(() => Promise.resolve({})) };
    global.JudgePromptBuilder = require('../shared/judge-prompt-builder');
    global.chrome = {
      runtime: { lastError: null },
      tabs: {
        create: jest.fn((_opts, cb) => cb({ id: 7 })),
        sendMessage: jest.fn((_tabId, _msg, cb) => cb({ ok: true })),
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      }
    };
  });

  test('sends evaluation prompt after ReadySignalManager resolves', async () => {
    require('../background/evaluation-manager');
    self.startEvaluation('prompt', 'Claude');
    const listener = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    listener(7, { status: 'complete' });
    await Promise.resolve();
    await Promise.resolve();
    expect(ReadySignalManager.waitForReady).toHaveBeenCalledWith(7, expect.any(Number));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
      type: 'GET_ANSWER',
      prompt: 'prompt'
    }), expect.any(Function));
  });
});

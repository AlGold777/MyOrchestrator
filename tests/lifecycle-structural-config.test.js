const fs = require('fs');
const path = require('path');

const loadDetector = () => {
  delete window.LLMExtension;
  delete window.ResponseLifecycleDetector;
  window.eval(fs.readFileSync(
    path.join(__dirname, '..', 'content-utils/response-lifecycle-detector.js'),
    'utf8'
  ));
  return window.ResponseLifecycleDetector;
};

describe('lifecycle structural verifier configuration', () => {
  let sentMessages;

  beforeEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    sentMessages = [];
    global.chrome.runtime.sendMessage = (message) => sentMessages.push(message);
    window.chrome = global.chrome;
    delete window.AnswerPipelineConfig;
    delete window.AnswerPipelineTiming;
    delete window.AnswerPipelineSelectors;
    delete window.TurnResolver;
    delete window.AnswerStructure;
    delete window.GenerationSignal;
    delete window.AnswerVerification;
    delete window.ContentUtils;
  });

  test('missing finalization config fails closed without a ready response', async () => {
    window.AnswerVerification = { verifySnapshotPair: jest.fn() };
    const detector = loadDetector();
    const tracker = detector.createTracker({ modelName: 'DeepSeek', dispatchId: 'missing-config' });

    await expect(detector.verifyStructuralCompletion(tracker)).resolves.toBeNull();
    expect(sentMessages.some((message) => message?.type === 'LLM_RESPONSE_READY')).toBe(false);
    expect(window.AnswerVerification.verifySnapshotPair).not.toHaveBeenCalled();
  });

  test('waits for the active Long profile and uses all five stability snapshots', async () => {
    const answer = document.createElement('article');
    answer.textContent = 'A stable answer with enough content for structural verification.';
    document.body.appendChild(answer);
    window.AnswerPipelineSelectors = { PLATFORM_SELECTORS: { deepseek: {} } };
    window.TurnResolver = {
      resolveTurn: jest.fn(() => ({
        answerNode: answer,
        messageRoot: answer,
        candidates: [answer],
        resolution: 'exact',
        reason: 'test'
      }))
    };
    window.AnswerStructure = {
      linearizeText: (node) => node.textContent,
      inspect: () => ({ complete: true, issues: [] })
    };
    window.GenerationSignal = { inspect: () => ({ active: false, checks: [] }) };
    window.AnswerVerification = {
      verifySnapshotPair: jest.fn(() => ({ verified: true, state: 'verified', reasons: [] }))
    };
    window.ContentUtils = { ensureDispatchMeta: (meta) => meta };
    window.AnswerPipelineTiming = {
      whenProfileReady: jest.fn(async () => {
        window.AnswerPipelineConfig = {
          finalization: { stabilityChecks: 5, stabilityRetryBudget: 0, stabilityInterval: 5 }
        };
      }),
      getEffectiveSnapshot: () => ({ profile: 'long', finalization: { stabilityChecks: 5 } })
    };
    const detector = loadDetector();
    const tracker = detector.createTracker({ modelName: 'DeepSeek', dispatchId: 'long-profile' });
    tracker.turnAnchor = 0;

    const result = await detector.verifyStructuralCompletion(tracker);

    expect(window.AnswerPipelineTiming.whenProfileReady).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({
      verified: true,
      requiredSnapshots: 5,
      snapshotsCompared: 5,
      effectiveConfig: expect.objectContaining({ profile: 'long' })
    }));
    expect(window.AnswerVerification.verifySnapshotPair).toHaveBeenCalledTimes(4);
  });
});

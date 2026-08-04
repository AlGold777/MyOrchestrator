/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
require('../shared/secret-redaction');
const B1SkeletonCollector = require('../background/b1-skeleton-collector');
const TurnResolver = require('../content-scripts/turn-resolver');
const AnswerStructure = require('../content-scripts/answer-structure');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'live-answer-skeletons');
const SELECTOR_SOURCE = fs.readFileSync(path.join(ROOT, 'content-scripts', 'answer-pipeline-selectors.js'), 'utf8');
const fixtureIndexPath = path.join(FIXTURE_DIR, 'index.json');
const fixturesAvailable = fs.existsSync(fixtureIndexPath);
const index = fixturesAvailable
  ? JSON.parse(fs.readFileSync(fixtureIndexPath, 'utf8'))
  : { platforms: [] };

(fixturesAvailable ? describe : describe.skip)('privacy-safe live answer skeleton matrix', () => {
  beforeAll(() => {
    delete window.AnswerPipelineSelectors;
    window.eval(SELECTOR_SOURCE);
  });

  // Every collector target must be accounted for: either it has a captured
  // real-page fixture, or it is listed in `pendingCapturePlatforms` because its
  // chat surface is not reachable without an account. A platform that appears in
  // neither list is a silent gap and fails here.
  test('accounts for every supported provider with a fixture or a declared pending capture', () => {
    const pending = index.pendingCapturePlatforms || [];
    expect([...index.platforms, ...pending].sort())
      .toEqual(B1SkeletonCollector.TARGETS.map((target) => target.platform).sort());
    expect(index.platforms.filter((platform) => pending.includes(platform))).toEqual([]);
    expect(index).toEqual(expect.objectContaining({
      platformCount: index.platforms.length,
      exactCount: index.platforms.length,
      structurallyCompleteCount: index.platforms.length,
      ignoredRiskPlatforms: []
    }));
  });

  test.each(index.platforms)('%s fixture remains private and resolves exactly through production selectors', (platform) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${platform}.json`), 'utf8'));
    const capture = fixture.capture;
    expect(B1SkeletonCollector.validateCapture(capture, platform)).toEqual({ ok: true });
    expect(capture).toEqual(expect.objectContaining({
      resolution: 'exact',
      diagnosticContext: false,
      structuralComplete: true,
      privacyValidated: true,
      ignoredContentRisk: false
    }));
    expect(capture.selectedAnswerLength).toBeGreaterThanOrEqual(5);

    document.body.innerHTML = capture.html;
    const selectors = window.AnswerPipelineSelectors.PLATFORM_SELECTORS[platform];
    const turn = TurnResolver.resolveTurn({ platform, selectors, document, minimumTextLength: 5 });
    expect(turn.resolution).toBe('exact');
    expect(turn.messageRoot).not.toBeNull();
    expect(turn.answerNode).not.toBeNull();
    expect(AnswerStructure.inspect(turn.messageRoot, turn.answerNode).complete).toBe(true);
  });

  test('missing answer root remains unresolved instead of inheriting fixture success', () => {
    document.body.innerHTML = '<main><div class="provider-shell"></div></main>';
    const turn = TurnResolver.resolveTurn({
      platform: 'generic',
      selectors: { lastMessage: '.missing-answer', messageRoot: '.missing-root' },
      document,
      minimumTextLength: 5
    });
    expect(turn.resolution).toBe('unresolved');
    expect(turn.messageRoot).toBeNull();
  });
});

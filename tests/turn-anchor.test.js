/**
 * @jest-environment jsdom
 */
// F6.2 positional turn anchor: extraction may only prefer answer nodes that
// appeared AFTER the dispatch started. This is the invariant behind the whole
// stale-answer family (run 1782945983672: a 13037-char answer several turns up
// was re-picked as the current run's answer; the signature baseline only
// guards the immediately-previous turn).
const fs = require('fs');
const path = require('path');

const PIPELINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'),
  'utf8'
);

function loadPipelineClass() {
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'trace-test'; } record() {} }
  window.UnifiedPipelineModules = {
    AdaptiveTimeoutManager: Dummy,
    coordinationModes: {},
    selectMode: () => ({}),
    IntelligentRetryManager: Dummy,
    ContinuousHumanActivity: Dummy,
    MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry,
    PerplexityStabilization: Dummy,
    HumanSessionController: Dummy
  };
  window.AnswerPipelineConfig = { streaming: {}, finalization: {} };
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: {
      testmodel: { lastMessage: ['.assistant-msg'] },
      generic: { lastMessage: ['.assistant-msg'] }
    },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = {
    UnifiedAnswerCompletionWatcher: Dummy,
    SanityCheck: Dummy
  };
  delete window.UnifiedAnswerPipeline;
  // eslint-disable-next-line no-eval
  window.eval(PIPELINE_SRC);
  return window.UnifiedAnswerPipeline;
}

const addAssistantMessage = (text) => {
  const el = document.createElement('div');
  el.className = 'assistant-msg';
  el.textContent = text;
  document.body.appendChild(el);
  return el;
};

describe('positional turn anchor (F6.2)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('old turns already on the page are never picked once a new node appears — even a SHORTER one', () => {
    addAssistantMessage('очень длинный ответ из прошлой сессии '.repeat(40)); // old turn 1
    addAssistantMessage('ответ прошлого хода '.repeat(30)); // old turn 2
    const Pipeline = loadPipelineClass();
    const pipeline = new Pipeline('testmodel');
    expect(pipeline.anchorAnswerCount).toBe(2);

    // Until the new answer renders, the legacy behaviour (signature-guarded) holds.
    const preAnswer = pipeline.getAnswerElement();
    expect(pipeline.lastAnswerPositionalFiltered).toBe(false);
    expect(preAnswer.textContent).toContain('прошлого хода');

    // The real (shorter) answer appears after the anchor: it must win.
    addAssistantMessage('короткий новый ответ этого запроса');
    const answer = pipeline.getAnswerElement();
    expect(pipeline.lastAnswerPositionalFiltered).toBe(true);
    expect(answer.textContent).toBe('короткий новый ответ этого запроса');
  });

  test('anchor is zero on a fresh page and does not filter anything', () => {
    const Pipeline = loadPipelineClass();
    const pipeline = new Pipeline('testmodel');
    expect(pipeline.anchorAnswerCount).toBe(0);
    addAssistantMessage('первый и единственный ответ');
    expect(pipeline.getAnswerElement().textContent).toBe('первый и единственный ответ');
  });

  test('anchor is exposed for the dispatch baseline report', () => {
    addAssistantMessage('старый ответ');
    const Pipeline = loadPipelineClass();
    // eslint-disable-next-line no-new
    new Pipeline('testmodel');
    expect(window.__UnifiedPipelineTurnAnchor).toEqual(
      expect.objectContaining({ platform: 'testmodel', anchorAnswerCount: 1 })
    );
  });
});

describe('turn anchor wiring (source contracts)', () => {
  test('baseline report carries anchorAnswerCount and the router stores it', () => {
    const utils = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-utils.js'), 'utf8');
    const router = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
    expect(utils).toContain('window.__UnifiedPipelineTurnAnchor');
    expect(utils).toContain('anchorAnswerCount');
    expect(router).toContain('entry.preDispatchAnswerNodeCount = anchorAnswerCount;');
  });

  test('inline scan applies the anchor best-effort and reports anchorApplied', () => {
    const orch = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    expect(orch).toContain('const anchorAnswerCount = Number(manualOptions.anchorAnswerCount || 0) || 0;');
    expect(orch).toContain('base.anchorAnswerCount = anchorCount;');
    expect(orch).toContain('anchorApplied');
  });
});

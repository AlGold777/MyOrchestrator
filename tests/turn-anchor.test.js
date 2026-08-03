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
const TURN_RESOLVER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'turn-resolver.js'),
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
      testmodel: { lastMessage: ['.assistant-msg'], messageRoot: '.assistant-msg' },
      generic: { lastMessage: ['.assistant-msg'], messageRoot: '.assistant-msg' }
    },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = {
    UnifiedAnswerCompletionWatcher: Dummy,
    SanityCheck: Dummy
  };
  delete window.UnifiedAnswerPipeline;
  delete window.TurnResolver;
  window.eval(TURN_RESOLVER_SRC);
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
    delete window.__LLMPreDispatchTurnAnchor;
  });

  test('old turns already on the page are never picked once a new node appears — even a SHORTER one', () => {
    addAssistantMessage('очень длинный ответ из прошлой сессии '.repeat(40)); // old turn 1
    addAssistantMessage('ответ прошлого хода '.repeat(30)); // old turn 2
    const Pipeline = loadPipelineClass();
    const pipeline = new Pipeline('testmodel');
    expect(pipeline.anchorAnswerCount).toBe(2);

    // Until the new answer renders, the anchored resolver must expose no answer.
    const preAnswer = pipeline.getAnswerElement();
    expect(pipeline.lastAnswerPositionalFiltered).toBe(true);
    expect(preAnswer).toBeNull();

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

  test('a pipeline created after answer insertion reuses the immutable pre-dispatch anchor', () => {
    addAssistantMessage('старый ответ');
    window.__LLMPreDispatchTurnAnchor = {
      llmName: 'testmodel',
      dispatchId: 'dispatch-1',
      anchorAnswerCount: 1,
      capturedAt: Date.now()
    };
    addAssistantMessage('новый ответ уже начал появляться');
    const Pipeline = loadPipelineClass();
    const pipeline = new Pipeline('testmodel');
    expect(pipeline.anchorAnswerCount).toBe(1);
    expect(pipeline.getAnswerElement().textContent).toBe('новый ответ уже начал появляться');
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
    expect(orch).toContain('const hasCapturedAnchor = manualOptions.anchorAnswerCount !== null');
    expect(orch).toContain('hasCapturedAnchor && baseCandidates.length > anchorAnswerCount');
    expect(orch).toContain('base.anchorAnswerCount = anchorCount;');
    expect(orch).toContain('anchorApplied');
  });
});

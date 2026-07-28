/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadPipeline() {
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'snapshot-gate'; } record() {} }
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
      testmodel: {
        lastMessage: '.answer',
        messageRoot: '.root',
        generatingIndicators: ['[data-generating="true"]']
      },
      generic: { lastMessage: '.answer', messageRoot: '.root' }
    },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = { UnifiedAnswerCompletionWatcher: Dummy, SanityCheck: Dummy };
  delete window.UnifiedAnswerPipeline;
  delete window.TurnResolver;
  delete window.AnswerStructure;
  delete window.GenerationSignal;
  window.eval(source('content-scripts/turn-resolver.js'));
  window.eval(source('content-scripts/answer-structure.js'));
  window.eval(source('content-scripts/generation-signal.js'));
  window.eval(source('content-scripts/unified-answer-pipeline.js'));
  return new window.UnifiedAnswerPipeline('testmodel');
}

describe('production answer snapshot gates', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('recursive omitted block reaches the production snapshot as incomplete', () => {
    const pipeline = loadPipeline();
    document.body.innerHTML = `
      <article class="root">
        <div class="answer">kept placeholder</div>
        <section><pre>x</pre></section>
      </article>`;
    const snapshot = pipeline.captureAnswerStructureSnapshot();
    expect(snapshot.resolution).toBe('exact');
    expect(snapshot.structuralComplete).toBe(false);
    expect(snapshot.structuralIssues).toContain('uncovered_message_blocks');
    expect(snapshot.uncoveredBlockCount).toBeGreaterThan(0);
  });

  test('present but hidden configured indicator is inactive in the production snapshot', () => {
    const pipeline = loadPipeline();
    document.body.innerHTML = `
      <article class="root"><div class="answer">complete placeholder</div></article>
      <div data-generating="true" style="display:none">busy</div>`;
    const snapshot = pipeline.captureAnswerStructureSnapshot();
    expect(snapshot.structuralComplete).toBe(true);
    expect(snapshot.generationActive).toBe(false);
  });

  test('visible configured indicator is active in the production snapshot', () => {
    const pipeline = loadPipeline();
    document.body.innerHTML = `
      <article class="root"><div class="answer">complete placeholder</div></article>
      <div data-generating="true">busy</div>`;
    const indicator = document.querySelector('[data-generating="true"]');
    indicator.getBoundingClientRect = () => ({ width: 20, height: 10, top: 0, left: 0, right: 20, bottom: 10 });
    const snapshot = pipeline.captureAnswerStructureSnapshot();
    expect(snapshot.generationActive).toBe(true);
    expect(snapshot.generationSignalKind).toBe('generating');
    expect(snapshot.generationSignalSelector).toBe('[data-generating="true"]');
  });
});

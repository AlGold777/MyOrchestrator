/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const load = (file) => window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

// Exercises the production method the finalization phase calls, with the same
// watcher proof shape the watcher actually produces.
function createPipeline() {
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'run-result-binding'; } record() {} logPhase() {} }
  window.UnifiedPipelineModules = {
    AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
  };
  window.AnswerPipelineConfig = { streaming: {}, finalization: {} };
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: { testmodel: { lastMessage: '.answer' }, generic: {} },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = { UnifiedAnswerCompletionWatcher: Dummy, SanityCheck: Dummy };
  delete window.UnifiedAnswerPipeline;
  load('shared/run-result-contract.js');
  load('shared/answer-verification.js');
  load('content-scripts/unified-answer-pipeline.js');
  const pipeline = new window.UnifiedAnswerPipeline('testmodel');
  pipeline.emitPipelineTelemetry = jest.fn();
  return pipeline;
}

const watcherProof = (overrides = {}) => Object.assign({
  contractVersion: 1,
  declaredType: 'COMMITTED',
  guarantee: 'STRICT',
  terminalReason: 'STOP',
  strongestEvidenceClass: 'P0',
  reasons: ['watcher:transport_terminal'],
  axes: {
    identity: 'proven',
    terminality: 'proven',
    integrity: 'unproven',
    semantic: 'unproven',
    observer: 'proven'
  }
}, overrides);

describe('pipeline: binding the answer to the proof behind it', () => {
  test('a proven run plus a verified extraction commits and exposes the text', () => {
    const pipeline = createPipeline();
    pipeline.state.answerResult = { runProof: watcherProof() };
    pipeline.lastAnswerVerification = { verified: true, structuralComplete: true };

    const result = pipeline.buildFinalRunResult('the extracted answer');

    expect(result.type).toBe('COMMITTED');
    expect(result.text).toBe('the extracted answer');
    expect(result.axes.integrity).toBe('proven');
    expect(result.axes.semantic).toBe('proven');
  });

  test('a structurally incomplete extraction becomes truncated, not committed', () => {
    const pipeline = createPipeline();
    pipeline.state.answerResult = { runProof: watcherProof() };
    pipeline.lastAnswerVerification = { verified: true, structuralComplete: false };

    const result = pipeline.buildFinalRunResult('half of the answer');

    expect(result.type).toBe('COMMITTED_TRUNCATED');
    expect(result.reasons).toContain('semantic_incomplete');
  });

  test('a DOM-only watcher proof keeps its heuristic guarantee after extraction', () => {
    const pipeline = createPipeline();
    pipeline.state.answerResult = {
      runProof: watcherProof({
        guarantee: 'HEURISTIC',
        strongestEvidenceClass: 'P3',
        terminalReason: 'UNKNOWN',
        axes: Object.assign(watcherProof().axes, { terminality: 'suspected' })
      })
    };
    pipeline.lastAnswerVerification = { verified: true, structuralComplete: true };

    const result = pipeline.buildFinalRunResult('a plausible answer');

    expect(result.type).toBe('SUSPECTED_COMPLETE');
    expect(() => result.text).toThrow(/run_result_text_unproven/);
    expect(result.readUncertainText('pipeline_finalization')).toBe('a plausible answer');
  });

  test('the dispatch identity reaches the watcher, so transport evidence is run-scoped', async () => {
    const pipeline = createPipeline();
    const seen = [];
    class RecordingWatcher {
      constructor() {}
      async waitForCompletion(params) { seen.push(params); return { success: true, reason: 'stub' }; }
    }
    pipeline.answerWatcherClass = RecordingWatcher;
    pipeline.runIdentity = { dispatchId: 'dispatch-77' };

    await pipeline.runAnswerCompletion({ element: null, type: 'window' });

    expect(seen).toHaveLength(1);
    expect(seen[0].dispatchId).toBe('dispatch-77');
  });

  test('without a watcher proof the pipeline claims nothing rather than assuming success', () => {
    const pipeline = createPipeline();
    pipeline.state.answerResult = {};
    expect(pipeline.buildFinalRunResult('text')).toBeNull();
  });
});

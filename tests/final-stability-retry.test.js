/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const load = (file) => window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

function createPipeline() {
  class Dummy { constructor() {} start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'stability-retry'; } record() {} logPhase() {} }
  window.UnifiedPipelineModules = {
    AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
  };
  window.AnswerPipelineConfig = {
    streaming: {},
    finalization: { stabilityChecks: 4, stabilityRetryBudget: 2, stabilityInterval: 1 }
  };
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: { testmodel: { lastMessage: '.answer', messageRoot: '.answer' }, generic: {} },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = { UnifiedAnswerCompletionWatcher: Dummy, SanityCheck: Dummy };
  delete window.UnifiedAnswerPipeline;
  load('shared/answer-verification.js');
  load('content-scripts/unified-answer-pipeline.js');
  const pipeline = new window.UnifiedAnswerPipeline('testmodel');
  pipeline.sleep = jest.fn(() => Promise.resolve());
  pipeline.emitPipelineTelemetry = jest.fn();
  return pipeline;
}

const snapshot = (hash, length = 120, nodeKey = 'answer-node-1') => ({
  selectedHash: hash,
  selectedLength: length,
  selectedNodeKey: nodeKey,
  candidateSetHash: `set-${hash}`,
  messageRootHash: `root-${hash}`,
  resolution: 'exact',
  structuralComplete: true,
  generationActive: false,
  runSessionId: 'run',
  dispatchId: 'dispatch',
  generationEpoch: 1,
  turnAnchor: 0,
  nodes: []
});

describe('final stability retry budget', () => {
  test('one divergent snapshot is tolerated when the following required series converges', async () => {
    const pipeline = createPipeline();
    const sequence = ['a', 'a', 'b', 'b', 'b', 'b'].map(snapshot);
    pipeline.captureAnswerStructureSnapshot = jest.fn(() => sequence.shift());

    await expect(pipeline.runFinalStabilityChecks()).resolves.toBe(true);
    expect(pipeline.captureAnswerStructureSnapshot).toHaveBeenCalledTimes(6);
    expect(pipeline.lastAnswerVerification).toEqual(expect.objectContaining({
      verified: true, snapshotsCompared: 6, requiredSnapshots: 4, retryBudget: 2, retriesUsed: 2
    }));
  });

  test('continuous divergence still fails at the bounded snapshot limit', async () => {
    const pipeline = createPipeline();
    let index = 0;
    pipeline.captureAnswerStructureSnapshot = jest.fn(() => snapshot(`change-${index += 1}`));

    await expect(pipeline.runFinalStabilityChecks()).resolves.toBe(false);
    expect(pipeline.captureAnswerStructureSnapshot).toHaveBeenCalledTimes(6);
    expect(pipeline.lastAnswerVerification).toEqual(expect.objectContaining({
      verified: false, snapshotsCompared: 6, retryBudget: 2, retriesUsed: 2
    }));
  });

  test('a text-length decrease blocks finalization on a smaller stable plateau', async () => {
    const pipeline = createPipeline();
    const sequence = [
      snapshot('long', 400), snapshot('short', 100),
      snapshot('short', 100), snapshot('short', 100), snapshot('short', 100), snapshot('short', 100)
    ];
    pipeline.captureAnswerStructureSnapshot = jest.fn(() => sequence.shift());

    await expect(pipeline.runFinalStabilityChecks()).resolves.toBe(false);
    expect(pipeline.lastAnswerVerification).toEqual(expect.objectContaining({
      verified: false,
      maxObservedTextLength: 400,
      lengthDecreaseCount: 1,
      lengthRegressionActive: true,
      lengthRegressionFloor: 400,
      reasons: expect.arrayContaining(['answer_length_regression_unrecovered']),
      lastLengthDecrease: expect.objectContaining({ from: 400, to: 100, delta: -300, recoveryFloor: 400 })
    }));
    expect(pipeline.emitPipelineTelemetry).toHaveBeenCalledWith(
      'ANSWER_LENGTH_DECREASED', expect.objectContaining({ level: 'warning' })
    );
  });

  test('finalization becomes possible only after the old maximum is recovered and stability is rebuilt', async () => {
    const pipeline = createPipeline();
    const sequence = [
      snapshot('long', 400), snapshot('short', 100),
      snapshot('long', 400), snapshot('long', 400), snapshot('long', 400), snapshot('long', 400)
    ];
    pipeline.captureAnswerStructureSnapshot = jest.fn(() => sequence.shift());

    await expect(pipeline.runFinalStabilityChecks()).resolves.toBe(true);
    expect(pipeline.lastAnswerVerification).toEqual(expect.objectContaining({
      verified: true,
      maxObservedTextLength: 400,
      lengthDecreaseCount: 1,
      lengthRegressionActive: false,
      lengthRegressionFloor: 400
    }));
    expect(pipeline.emitPipelineTelemetry).toHaveBeenCalledWith(
      'ANSWER_LENGTH_REGRESSION_RECOVERED', expect.objectContaining({ level: 'info' })
    );
  });
});

/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const CONFIG_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'pipeline-config.js'), 'utf8'
);
const PIPELINE_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'), 'utf8'
);

function loadPipelineClass() {
  class Dummy { constructor(config) { this.config = config; } start() {} stop() {} }
  class DummyTelemetry { constructor() { this.traceId = 'profile-readiness'; } record() {} logPhase() {} }
  window.UnifiedPipelineModules = {
    AdaptiveTimeoutManager: Dummy, coordinationModes: {}, selectMode: () => ({}),
    IntelligentRetryManager: Dummy, ContinuousHumanActivity: Dummy, MaintenanceScroll: Dummy,
    ComprehensiveTelemetry: DummyTelemetry, PerplexityStabilization: Dummy, HumanSessionController: Dummy
  };
  window.AnswerPipelineSelectors = {
    PLATFORM_SELECTORS: { testmodel: { lastMessage: '.answer', messageRoot: '.answer' }, generic: {} },
    detectPlatform: () => 'testmodel'
  };
  window.AnswerPipeline = { UnifiedAnswerCompletionWatcher: Dummy, SanityCheck: Dummy };
  delete window.UnifiedAnswerPipeline;
  window.eval(PIPELINE_SOURCE);
  return window.UnifiedAnswerPipeline;
}

describe('pipeline timing profile readiness', () => {
  let storageCallback;

  beforeEach(() => {
    delete window.AnswerPipelineConfig;
    delete window.AnswerPipelineTiming;
    storageCallback = null;
    global.chrome = {
      storage: {
        local: { get: jest.fn((_key, callback) => { storageCallback = callback; }) },
        onChanged: { addListener: jest.fn() }
      }
    };
    window.eval(CONFIG_SOURCE);
  });

  test('readiness waits for the asynchronous stored profile before resolving', async () => {
    let settled = false;
    const pending = window.AnswerPipelineTiming.whenProfileReady(500).then((snapshot) => {
      settled = true;
      return snapshot;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    storageCallback({ longGenerationMode: true });
    await expect(pending).resolves.toEqual(expect.objectContaining({ profile: 'long', profileLoaded: true }));
    expect(window.AnswerPipelineConfig.finalization.stabilityChecks).toBe(5);
    expect(window.AnswerPipelineConfig.streaming.adaptiveTimeout.hardMax).toBe(900000);
  });

  test('standard profile is marked loaded explicitly', async () => {
    storageCallback({ longGenerationMode: false });
    await expect(window.AnswerPipelineTiming.whenProfileReady(500)).resolves.toEqual(
      expect.objectContaining({ profile: 'standard', profileLoaded: true })
    );
    expect(window.AnswerPipelineConfig.finalization.stabilityChecks).toBe(4);
  });

  test('pipeline constructed before storage callback locks the loaded long values before execution', async () => {
    const Pipeline = loadPipelineClass();
    const pipeline = new Pipeline('testmodel');
    expect(pipeline.config.finalization.stabilityChecks).toBe(4);

    const locking = pipeline.lockEffectiveTimingConfig();
    storageCallback({ longGenerationMode: true });
    await locking;

    expect(pipeline.config.finalization.stabilityChecks).toBe(5);
    expect(pipeline.config.streaming.adaptiveTimeout.hardMax).toBe(900000);
    expect(pipeline.effectiveTimingSnapshot).toEqual(expect.objectContaining({
      profile: 'long', profileLoaded: true, stabilityChecks: 5, streamingHardMax: 900000
    }));
  });
});

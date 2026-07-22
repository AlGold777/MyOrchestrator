// Universal Production Wiring Contract v1.0 — hard-fail gate.
// When universalEngine is genuinely enabled (not a unit test with
// allowIncompleteWiring), a missing production port must throw
// UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE before any LLM call is made,
// instead of silently degrading to built-in fallbacks (empty artifacts,
// no-op state deltas reported as applied=true).
const Application = require('../disput/debate-application');
const ArtifactPipeline = require('../disput/debate-artifact-pipeline');

const FULL_PORTS = {
  runModelBatch: async ({ models }) => ({ responses: Object.fromEntries(models.map((m) => [m, `answer:${m}`])) }),
  acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()), reason: '' }),
  compilePrompt: ({ stage, participant }) => `${stage.purpose} for ${participant.participantId}`,
  extractArtifacts: ({ text }) => [{ type: 'position', text }],
  proposeStateDelta: ({ participant, artifacts }) => ({ by: participant.participantId, artifacts }),
  commitStateDelta: ({ state }) => ({ applied: true, stateMap: state.stateMap }),
  projectStateMap: (state) => state.stateMap
};

test('canonical artifact pipeline satisfies the semantic production ports', async () => {
  const app = Application.createApplication({
    universalEngine: true,
    deps: {
      ...FULL_PORTS,
      extractArtifacts: ArtifactPipeline.extractArtifacts,
      proposeStateDelta: ArtifactPipeline.proposeStateDelta,
      commitStateDelta: ArtifactPipeline.commitStateDelta,
      projectStateMap: ArtifactPipeline.projectStateMap
    },
    exposeInternals: true
  });
  const result = await app.start(config({ deferExecution: true }));
  expect(result.ok).toBe(true);
});

test('production-shaped universal run batches all participants and commits every artifact atomically', async () => {
  const runModelBatch = jest.fn(async ({ models }) => ({
    responses: Object.fromEntries(models.map((model) => [model, `Independent position from ${model}`])), failed: {}
  }));
  const app = Application.createApplication({
    universalEngine: true,
    deps: {
      runModelBatch,
      acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()), reason: '' }),
      compilePrompt: ({ stage, participant }) => `${stage.purpose}:${participant.participantId}`,
      extractArtifacts: ArtifactPipeline.extractArtifacts,
      proposeStateDelta: ArtifactPipeline.proposeStateDelta,
      commitStateDelta: ArtifactPipeline.commitStateDelta,
      projectStateMap: ArtifactPipeline.projectStateMap
    },
    exposeInternals: true
  });
  const result = await app.start(config({ models: ['alpha', 'beta', 'gamma', 'delta'], maxSteps: 2 }));
  expect(result.ok).toBe(true);
  expect(runModelBatch).toHaveBeenCalledTimes(2);
  expect(runModelBatch.mock.calls[0][0].models).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  const state = app.getOrchestrator().getState();
  expect(runModelBatch.mock.calls[1][0].models).toHaveLength(1);
  expect(state.caseVersion).toBe(3);
  expect(state.stateMap.claims).toHaveLength(4);
  expect(state.stateMap.synthesisArtifactId).toMatch(/^artifact-/);
  expect(state.events.filter((event) => event.type === 'STATE_DELTA_STALE')).toHaveLength(0);
});

const config = (overrides = {}) => ({
  runId: 'run-wiring-1',
  topic: 'Production wiring test',
  models: ['alpha', 'beta'],
  policies: { finalization: { mode: 'manual' } },
  ...overrides
});

describe('Universal Production Wiring Contract — hard-fail gate', () => {
  test('flag enabled + fully wired deps: no error, run starts', async () => {
    const app = Application.createApplication({
      universalEngine: true,
      deps: FULL_PORTS,
      exposeInternals: true
    });
    const result = await app.start(config({ deferExecution: true }));
    expect(result.ok).toBe(true);
  });

  test('flag enabled + missing commitStateDelta: throws UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE', async () => {
    const { commitStateDelta, ...partial } = FULL_PORTS;
    const app = Application.createApplication({
      universalEngine: true,
      deps: partial
    });
    await expect(app.start(config())).rejects.toMatchObject({
      code: 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE',
      missingPorts: expect.arrayContaining(['commitStateDelta'])
    });
  });

  test('flag enabled + missing runModelBatch/extractArtifacts: lists both missing ports', async () => {
    const { runModelBatch, extractArtifacts, ...partial } = FULL_PORTS;
    const app = Application.createApplication({
      universalEngine: true,
      deps: partial
    });
    await expect(app.start(config())).rejects.toMatchObject({
      code: 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE',
      missingPorts: expect.arrayContaining(['runModelBatch', 'extractArtifacts'])
    });
  });

  test('universal wiring remains mandatory even when an obsolete flag is false', async () => {
    const app = Application.createApplication({
      universalEngine: false,
      deps: { legacyStart: async () => 'legacy-started' }
    });
    await expect(app.start({ models: ['alpha'] })).rejects.toMatchObject({
      code: 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE'
    });
  });

  test('flag enabled + allowIncompleteWiring: bypasses the gate for isolated unit tests', async () => {
    const app = Application.createApplication({
      universalEngine: true,
      allowIncompleteWiring: true,
      deps: { runModelBatch: FULL_PORTS.runModelBatch, proposeStateDelta: FULL_PORTS.proposeStateDelta },
      exposeInternals: true
    });
    const result = await app.start(config({ deferExecution: true }));
    expect(result.ok).toBe(true);
  });

  test('a supplied custom stageExecutor exempts the per-stage-executor ports but still requires commitStateDelta/projectStateMap', async () => {
    const app = Application.createApplication({
      universalEngine: true,
      stageExecutor: { execute: async () => ({ executionStatus: 'completed', proposedStateDeltas: [] }) },
      deps: {}
    });
    await expect(app.start(config())).rejects.toMatchObject({
      code: 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE',
      missingPorts: ['commitStateDelta', 'projectStateMap']
    });
  });
});

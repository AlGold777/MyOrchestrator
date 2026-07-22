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

  test('flag disabled: incomplete deps do not throw (legacy path unaffected)', async () => {
    const app = Application.createApplication({
      deps: { legacyStart: async () => 'legacy-started' }
    });
    await expect(app.start({ topology: 'duel' })).resolves.toBe('legacy-started');
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

const Schema = require('../disput/debate-case-schema');
const CaseStore = require('../disput/debate-case-store');
const Pipeline = require('../disput/debate-artifact-pipeline');
const Orchestrator = require('../disput/debate-orchestrator');
const Persistence = require('../disput/debate-orchestrator-persistence');
const PlanRevision = require('../disput/debate-plan-revision');

const jsonStorage = () => {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
};

function createGateRun({ runId, persistence, semanticStore, emit } = {}) {
  const revisions = PlanRevision.createRevisionStore({});
  const planner = {
    ruleSetVersion: 'release-gate-v1',
    evaluate(input) {
      return {
        decisionId: `release-gate-${input.caseVersion}`,
        type: 'CREATE_STAGES', rationaleCode: 'RELEASE_GATE',
        inputCaseVersion: input.caseVersion,
        inputStateMapIdentity: {
          sourceCaseVersion: input.stateMap.sourceCaseVersion,
          projectorVersion: input.stateMap.projectorVersion
        },
        inputPlanRevisionId: input.activePlanRevisionId,
        proposedStages: [{
          proposedStageId: 'gate-stage', purpose: 'position',
          participantIds: ['alpha'], goalIds: []
        }]
      };
    }
  };
  const executor = {
    async execute(stage, context) {
      return {
        stageInstanceId: stage.stageInstanceId,
        executionStatus: 'completed', terminalFailures: [],
        proposedStateDeltas: [{
          deltaId: 'gate-delta', expectedCaseVersion: context.caseVersion,
          participantId: 'alpha',
          artifacts: [{
            id: 'gate-claim', type: 'claim', status: 'asserted',
            title: 'Persisted release evidence', provenance: { source: 'release-gate' }
          }]
        }]
      };
    }
  };
  return Orchestrator.createOrchestrator({
    planner, executor, revisionStore: revisions, persistence, semanticStore,
    projectStateMap: Pipeline.projectStateMap, ownerId: `${runId}-owner`,
    emit, exposeInternals: true
  });
}

describe('P0-R6 — event-log integrity and replay equivalence', () => {
  test('recovers an equivalent paused run from the event log when snapshots are absent', async () => {
    const runId = 'release-replay-no-snapshot';
    const storage = jsonStorage();
    const persistence = Persistence.createPersistence({ runId, storage });
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: runId,
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
    });
    const first = createGateRun({ runId, persistence, semanticStore });
    await first.startRun({ runId, debateCase: semanticStore.getState(), maxSteps: 1 });
    await first.requestPause({});
    const before = first.getState();
    storage.values.delete(`${Persistence.PREFIX}:${runId}:snapshots`);

    const second = createGateRun({
      runId,
      persistence: Persistence.createPersistence({ runId, storage }),
      semanticStore
    });
    const recovered = await second.recoverRun({ deferExecution: true });
    const after = second.getState();
    expect(recovered).toMatchObject({ ok: true, lifecycle: 'PAUSED' });
    expect(after.caseVersion).toBe(before.caseVersion);
    expect(after.stateMap.artifacts).toEqual(before.stateMap.artifacts);
    expect(after.stateMap.sourceCaseVersion).toBe(before.stateMap.sourceCaseVersion);
    expect(after.openGoals).toEqual(before.openGoals);
    expect(after.stages).toEqual(before.stages);
  });

  test('falls back to the event checkpoint when the latest snapshot is corrupted', async () => {
    const runId = 'release-replay-corrupt-snapshot';
    const storage = jsonStorage();
    const persistence = Persistence.createPersistence({ runId, storage });
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: runId,
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
    });
    const first = createGateRun({ runId, persistence, semanticStore });
    await first.startRun({ runId, debateCase: semanticStore.getState(), deferExecution: true });
    await first.requestPause({});
    storage.values.set(`${Persistence.PREFIX}:${runId}:snapshots`, JSON.stringify([{ broken: true }]));
    const second = createGateRun({
      runId,
      persistence: Persistence.createPersistence({ runId, storage }),
      semanticStore
    });
    expect(await second.recoverRun({ deferExecution: true })).toMatchObject({ ok: true, lifecycle: 'PAUSED' });
  });

  test('rejects a discontinuous event log instead of silently skipping the gap', async () => {
    const baseCase = Schema.createCase({ caseId: 'release-corrupt-events' });
    const snapshot = {
      runId: 'release-corrupt-events', eventSequence: 1, debateCase: baseCase,
      caseVersion: 0, stateMap: Pipeline.projectStateMap(baseCase),
      openGoals: [], stages: [], activeStages: [], revisions: [],
      runLifecycle: 'PAUSED'
    };
    const events = [{ eventId: 'gap:3', eventSequence: 3, type: 'BROKEN', payload: {} }];
    const persistence = {
      loadLatestSnapshot: () => snapshot,
      loadEvents: (after = 0) => events.filter((event) => event.eventSequence > after),
      appendEvent: jest.fn(), readLease: () => null, writeLease: () => true,
      readLastPublishedSequence: () => 99
    };
    const orchestrator = createGateRun({ runId: snapshot.runId, persistence });
    const recovered = await orchestrator.recoverRun({ deferExecution: true });
    expect(recovered).toMatchObject({ ok: false, fatal: true, reason: 'CORRUPTED_EVENT_SEQUENCE' });
  });

  test('publication cursor republishes only unacknowledged durable events', async () => {
    const runId = 'release-publication-cursor';
    const storage = jsonStorage();
    const persistence = Persistence.createPersistence({ runId, storage });
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: runId,
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
    });
    const first = createGateRun({ runId, persistence, semanticStore });
    await first.startRun({ runId, debateCase: semanticStore.getState(), deferExecution: true });
    await first.requestPause({});
    const events = persistence.loadEvents();
    const cursor = events.at(-2).eventSequence;
    storage.values.set(`${Persistence.PREFIX}:${runId}:published`, JSON.stringify(cursor));
    const published = [];
    const secondPersistence = Persistence.createPersistence({ runId, storage });
    const second = createGateRun({
      runId, persistence: secondPersistence, semanticStore,
      emit: (_type, event) => published.push(event.eventId)
    });
    await second.recoverRun({ deferExecution: true });
    expect(published.filter((id) => events.some((event) => event.eventId === id)))
      .toEqual(events.filter((event) => event.eventSequence > cursor).map((event) => event.eventId));
    expect(new Set(published).size).toBe(published.length);
    expect(secondPersistence.readLastPublishedSequence()).toBe(second.getState().events.at(-1).eventSequence);
  });
});

describe('P0-R7 — semantic commit/no-op/version integrity', () => {
  test('duplicate/no-op replay preserves caseVersion and returns the original receipt', async () => {
    const store = CaseStore.createStore();
    await store.create({ caseId: 'release-no-op' });
    const change = {
      kind: 'UPSERT_ARTIFACT', correlationId: 'release-no-op:c1',
      artifact: { id: 'c1', type: 'claim', status: 'asserted', title: 'A', provenance: { source: 'test' } }
    };
    const first = await store.commit({ expectedCaseVersion: 0, changes: [change] });
    const replay = await store.commit({ expectedCaseVersion: 1, changes: [change] });
    expect(first.caseVersion).toBe(1);
    expect(replay).toMatchObject({ ok: true, duplicate: true, caseVersion: 1 });
    expect(store.getState().caseVersion).toBe(1);
  });

  test('stale expected version and invalid atomic batch leave canonical state untouched', async () => {
    const store = CaseStore.createStore();
    await store.create({ caseId: 'release-atomic' });
    expect(await store.commit({
      expectedCaseVersion: 2,
      changes: [{ kind: 'SET_STATUS', technicalStatus: 'paused' }]
    })).toMatchObject({ ok: false, stale: true, code: 'CASE_VERSION_STALE' });
    const before = store.exportCase();
    const rejected = await store.commit({
      expectedCaseVersion: 0,
      changes: [
        { kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', status: 'asserted', title: 'A', provenance: { source: 'test' } } },
        { kind: 'UPSERT_ARTIFACT', artifact: { id: 'o1', type: 'objection', status: 'raised', targetId: 'missing', title: 'O', provenance: { source: 'test' } } }
      ]
    });
    expect(rejected.ok).toBe(false);
    expect(store.exportCase()).toBe(before);
  });

  test('finalization preserves terminal evidence and canonical projection identity', async () => {
    const runId = 'release-terminal-evidence';
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: runId,
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
    });
    const orchestrator = createGateRun({ runId, semanticStore });
    await orchestrator.startRun({ runId, debateCase: semanticStore.getState(), maxSteps: 1 });
    const finalized = await orchestrator.finalizeRun({ reason: 'MANUAL_STOP', finalizationMode: 'STATE_MAP' });
    expect(finalized.ok).toBe(true);
    expect(finalized.finalization.finalStateMap).toMatchObject({
      sourceCaseVersion: semanticStore.getState().caseVersion,
      projectorVersion: 4,
      artifacts: { 'gate-claim': expect.objectContaining({ id: 'gate-claim' }) }
    });
  });
});

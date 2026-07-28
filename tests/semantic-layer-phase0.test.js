const Schema = require('../disput/debate-case-schema');
const CaseStore = require('../disput/debate-case-store');
const Pipeline = require('../disput/debate-artifact-pipeline');
const StateMap = require('../disput/debate-state-map');
const Persistence = require('../disput/debate-orchestrator-persistence');
const Planner = require('../disput/debate-planner');
const Orchestrator = require('../disput/debate-orchestrator');
const PlanRevision = require('../disput/debate-plan-revision');

describe('semantic layer Phase 0 characterization and target contracts', () => {
  test('E-01/S-01: existing artifact is revised instead of appended or ignored', () => {
    const initial = Schema.createCase({ caseId: 'phase0-batch' });
    const result = Schema.applyBatch(initial, [
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', title: 'A', provenance: { source: 'test' } } },
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 'o1', type: 'objection', targetId: 'c1', title: 'O', provenance: { source: 'test' } } }
    ]);
    expect(result.ok).toBe(true);
    expect(result.state.caseVersion).toBe(2);
    expect(result.state.changes).toHaveLength(2);
    const rejected = Schema.applyBatch(result.state, [{ kind: 'UPSERT_ARTIFACT', artifact: { id: 'bad', type: 'objection', targetId: 'missing', provenance: { source: 'test' } } }]);
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(result.state);
    const revised = Schema.applyChange(result.state, {
      kind: 'UPSERT_ARTIFACT', expectedRevision: 0,
      artifact: { ...result.state.artifacts.c1, status: 'resolved', title: 'B' }
    });
    expect(revised.state.artifacts.c1).toMatchObject({ status: 'resolved', title: 'B', revision: 1 });
    expect(Object.keys(revised.state.artifacts)).toHaveLength(2);
  });

  test('E-02/S-01: same correlation is an idempotent receipt, not semantic stagnation', () => {
    const initial = Schema.createCase({ caseId: 'phase0-replay' });
    const first = Schema.applyChange(initial, { correlationId: 'corr-1', kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', title: 'A', provenance: { source: 'test' } } });
    const replay = Schema.applyChange(first.state, { correlationId: 'corr-1', kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', title: 'A', provenance: { source: 'test' } } });
    expect(replay).toMatchObject({ ok: true, duplicate: true, receipt: { sequence: 1 } });
    const conflict = Schema.applyChange(first.state, { correlationId: 'corr-1', kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', title: 'B', provenance: { source: 'test' } } });
    expect(conflict).toMatchObject({ ok: false, duplicate: true, conflict: true, code: 'CORRELATION_CONFLICT' });
  });

  test.each([
    ['E-03a', 'objection', 'raised', 'resolve_objection'],
    ['E-03b', 'contradiction', 'recorded', 'resolve_contradiction'],
    ['E-03c', 'dissent', 'recorded', 'examine_dissent']
  ])('%s/S-03: %s with extractor status derives %s', (_evidence, type, status, goalType) => {
    const map = Pipeline.projectStateMap({ caseId: `phase0-${type}`, artifacts: {
      c1: { id: 'c1', type: 'claim', status: 'asserted', title: 'A', provenance: { source: 'test' } },
      a1: { id: 'a1', type, status, severity: type === 'objection' ? 'blocking' : '', targetId: 'c1', title: type, provenance: { source: 'test' } }
    } });
    expect(Planner.deriveGoals({ stateMap: map, openGoals: [], policies: {}, currentTime: 'now' }).map((goal) => goal.type))
      .toContain(goalType);
  });

  test('E-04/S-06: open question is exposed under both names and derives a goal', () => {
    const map = Pipeline.projectStateMap({ caseId: 'phase0-question', artifacts: {
      q1: { id: 'q1', type: 'open_question', status: 'open', title: 'Q', provenance: { source: 'test' } }
    } });
    expect(map.openQuestions).toHaveLength(1);
    expect(map.questions).toHaveLength(1);
    expect(Planner.deriveGoals({ stateMap: map, openGoals: [], policies: {}, currentTime: 'now' }).map((goal) => goal.type))
      .toContain('answer_open_question');
  });

  test('E-05/S-07/S-09: projection exposes Planner fields and canonical identity', () => {
    const map = Pipeline.projectStateMap({ caseId: 'phase0-map', artifacts: {
      c1: { id: 'c1', type: 'claim', status: 'asserted', title: 'A', owner: 'alpha', provenance: { source: 'test' } },
      q1: { id: 'q1', type: 'open_question', status: 'open', title: 'Q', owner: 'beta', provenance: { source: 'test' } }
    } });
    expect(map.artifactAuthors).toEqual({ c1: 'alpha', q1: 'beta' });
    expect(map.actionableQuestions).toHaveLength(1);
    expect(map.questions).toHaveLength(1);
    expect(map.contextPressure).toBeGreaterThanOrEqual(0);
    expect(map).toMatchObject({ sourceCaseVersion: 0, projectorVersion: StateMap.VERSION });
  });

  test('E-06/S-05: stale delta event retains the rejected semantic content', async () => {
    const revisions = PlanRevision.createRevisionStore({});
    const planner = {
      ruleSetVersion: 'phase0',
      evaluate(input) {
        return {
          decisionId: 'phase0-stale-decision', type: 'CREATE_STAGES', rationaleCode: 'TEST',
          inputCaseVersion: input.caseVersion,
          inputStateMapIdentity: {
            sourceCaseVersion: input.stateMap.sourceCaseVersion,
            projectorVersion: input.stateMap.projectorVersion
          },
          inputPlanRevisionId: input.activePlanRevisionId,
          proposedStages: [{ proposedStageId: 'p1', purpose: 'position', participantIds: ['alpha'], goalIds: [] }]
        };
      }
    };
    const executor = { execute: async (stage) => ({
      stageInstanceId: stage.stageInstanceId, executionStatus: 'completed', terminalFailures: [],
      proposedStateDeltas: [{
        deltaId: 'stale-delta', expectedCaseVersion: 99,
        artifacts: [{ id: 'lost', type: 'claim', status: 'asserted', title: 'Retained in event', provenance: { source: 'test' } }]
      }]
    }) };
    const orchestrator = Orchestrator.createOrchestrator({
      planner, executor, revisionStore: revisions,
      projectStateMap: Pipeline.projectStateMap, exposeInternals: true
    });
    await orchestrator.startRun({
      debateCase: Schema.createCase({
        caseId: 'phase0-stale',
        participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
      }),
      maxSteps: 1
    });
    const stale = orchestrator.getState().events.find((event) => event.type === 'STATE_DELTA_STALE');
    expect(stale.payload.delta).toMatchObject({ deltaId: 'stale-delta', artifacts: [expect.objectContaining({ id: 'lost' })] });
  });

  test('E-07/S-02: canonical map is the shared UI/Planner projection source', async () => {
    const store = CaseStore.createStore();
    await store.create({ caseId: 'phase0-ui' });
    await store.commit({
      expectedCaseVersion: 0,
      changes: [{
        kind: 'UPSERT_ARTIFACT',
        artifact: { id: 'ui-claim', type: 'claim', status: 'asserted', title: 'Visible', provenance: { source: 'test' } }
      }]
    });
    const plannerMap = Pipeline.projectStateMap(store.getState());
    const uiMap = StateMap.project(store.getState());
    expect(plannerMap.claims.map((item) => item.id)).toEqual(['ui-claim']);
    expect(uiMap.claims.map((item) => item.id)).toEqual(['ui-claim']);
  });

  test('forward-version guard is explicit', async () => {
    const persistence = Persistence.createPersistence({ runId: 'phase0-persist' });
    persistence.appendEvent({ eventSequence: 1, type: 'TEST' });
    expect(persistence.loadEvents()).toHaveLength(1);
    const store = CaseStore.createStore();
    await store.create({ caseId: 'phase0-forward' });
    const exported = JSON.parse(store.exportCase());
    expect(() => Schema.migrate({ ...exported, schemaVersion: Schema.VERSION + 1 })).toThrow(/future/);
  });

  test('E-08/S-04: durable persistence survives adapter recreation and fences cross-context leases', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    };
    const first = Persistence.createPersistence({ runId: 'phase0-durable', storage });
    first.appendEvent({ eventId: 'e1', eventSequence: 1, type: 'STARTED' });
    first.saveSnapshot({ runId: 'phase0-durable', eventSequence: 1, runLifecycle: 'PAUSED' });
    expect(first.compareAndSetLease(0, { ownerId: 'owner-a', leaseRevision: 1, expiresAt: 100 })).toBe(true);

    const second = Persistence.createPersistence({ runId: 'phase0-durable', storage });
    expect(second.loadEvents()).toEqual([expect.objectContaining({ eventId: 'e1' })]);
    expect(second.loadLatestSnapshot()).toMatchObject({ eventSequence: 1, runLifecycle: 'PAUSED' });
    expect(second.compareAndSetLease(0, { ownerId: 'owner-b', leaseRevision: 1 })).toBe(false);
    expect(second.compareAndSetLease(1, { ownerId: 'owner-b', leaseRevision: 2, expiresAt: 200 })).toBe(true);
    expect(first.readLease()).toMatchObject({ ownerId: 'owner-b', leaseRevision: 2 });
  });

  test('E-09/S-14: discarded late response retains its semantic delta', async () => {
    const revisions = PlanRevision.createRevisionStore({});
    const orchestrator = Orchestrator.createOrchestrator({
      planner: Planner.createPlanner(),
      executor: { execute: jest.fn() },
      revisionStore: revisions,
      projectStateMap: Pipeline.projectStateMap,
      exposeInternals: true
    });
    await orchestrator.startRun({
      debateCase: Schema.createCase({ caseId: 'phase0-late', policies: {}, participants: [] }),
      deferExecution: true
    });
    orchestrator._internals.state.stages.push({
      stageInstanceId: 'late-stage', planRevisionId: 'superseded-revision',
      goalIds: [], status: 'completed'
    });
    orchestrator._internals.state.lateResponses.push({
      stageInstanceId: 'late-stage',
      result: { proposedStateDeltas: [{ deltaId: 'late-delta', artifacts: [{ id: 'late-artifact' }] }] }
    });
    await orchestrator._internals.reconcile();
    const discarded = orchestrator.getState().events.find((event) => event.type === 'LATE_RESPONSE_DISCARDED');
    expect(discarded.payload.delta).toEqual([{ deltaId: 'late-delta', artifacts: [{ id: 'late-artifact' }] }]);
  });
});

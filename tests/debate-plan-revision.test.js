const PlanRevision = require('../disput/debate-plan-revision');

const makeStore = (emit = () => {}) => {
  const store = PlanRevision.createRevisionStore({ emit });
  store.initialize({ runId: 'run-1', revisionId: 'rev-0' });
  return store;
};

const command = (commandType, payload = {}, overrides = {}) => ({
  commandId: `cmd-${Math.random().toString(36).slice(2, 8)}`,
  expectedRevisionId: 'rev-0',
  commandType,
  payload,
  createdBy: 'human',
  timestamp: new Date().toISOString(),
  ...overrides
});

describe('Plan Revision Specification v1.0', () => {
  test('active revision is immutable and frozen', () => {
    const store = makeStore();
    const active = store.getActive();
    expect(Object.isFrozen(active)).toBe(true);
    expect(active.status).toBe('ACTIVE');
    expect(active.revisionNumber).toBe(0);
  });

  test('INSERT_STAGE creates new active revision, supersedes parent, keeps lineage', () => {
    const events = [];
    const store = makeStore((type, payload) => events.push({ type, payload }));
    const result = store.submit(command('INSERT_STAGE', { stage: { purpose: 'synthesis', plannedStageId: 'ps-1' } }));
    expect(result.ok).toBe(true);
    expect(result.revision.revisionNumber).toBe(1);
    expect(result.revision.parentRevisionId).toBe('rev-0');
    expect(result.revision.plannedStages).toHaveLength(1);
    const lineage = store.getLineage();
    expect(lineage).toHaveLength(2);
    expect(lineage[0].status).toBe('SUPERSEDED');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining([
      'REVISION_CREATED', 'REVISION_VALIDATED', 'REVISION_SUPERSEDED', 'REVISION_ACTIVATED'
    ]));
  });

  test('stale expectedRevisionId is rejected with REVISION_STALE', () => {
    const store = makeStore();
    store.submit(command('INSERT_STAGE', { stage: { purpose: 'audit' } }));
    const stale = store.submit(command('INSERT_STAGE', { stage: { purpose: 'synthesis' } })); // still expects rev-0
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe('REVISION_STALE');
    // Retry semantics: re-read active revision, rebuild command.
    const retry = store.submit(command('INSERT_STAGE', { stage: { purpose: 'synthesis' } }, { expectedRevisionId: store.getActive().revisionId }));
    expect(retry.ok).toBe(true);
  });

  test('REMOVE_PENDING_STAGE only removes pending stages', () => {
    const store = makeStore();
    const inserted = store.submit(command('INSERT_STAGE', { stage: { purpose: 'critique', plannedStageId: 'ps-1' } }));
    const bad = store.submit(command('REMOVE_PENDING_STAGE', { plannedStageId: 'missing' }, { expectedRevisionId: inserted.revision.revisionId }));
    expect(bad.code).toBe('SEMANTIC_INVALID');
    const good = store.submit(command('REMOVE_PENDING_STAGE', { plannedStageId: 'ps-1' }, { expectedRevisionId: inserted.revision.revisionId }));
    expect(good.ok).toBe(true);
    expect(good.revision.plannedStages).toHaveLength(0);
  });

  test('conflicting commands in one batch are rejected atomically', () => {
    const store = makeStore();
    const setup = store.submit(command('INSERT_STAGE', { stage: { purpose: 'critique', plannedStageId: 'ps-1' } }));
    const revisionId = setup.revision.revisionId;
    const result = store.submit([
      command('CHANGE_PRIORITY', { plannedStageId: 'ps-1', priority: 10 }, { expectedRevisionId: revisionId }),
      command('REMOVE_PENDING_STAGE', { plannedStageId: 'ps-1' }, { expectedRevisionId: revisionId })
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('COMMAND_CONFLICT');
    expect(store.getActive().revisionId).toBe(revisionId); // nothing changed
  });

  test('dependency closure includes downstream stages transitively', () => {
    const revision = {
      plannedStages: [
        { plannedStageId: 'a', upstream: [], goalIds: ['g1'] },
        { plannedStageId: 'b', upstream: ['a'], goalIds: [] },
        { plannedStageId: 'c', upstream: ['b'], goalIds: [] },
        { plannedStageId: 'd', upstream: [], goalIds: [] }
      ]
    };
    expect(PlanRevision.dependencyClosure(revision, ['a']).sort()).toEqual(['a', 'b', 'c']);
    expect(PlanRevision.dependencyClosure(revision, [], ['g1']).sort()).toEqual(['a', 'b', 'c']);
  });

  test('stage invalidation classifies UNCHANGED / STALE / CANCELLED', () => {
    const newRevision = { plannedStages: [{ plannedStageId: 'kept' }] };
    const result = PlanRevision.invalidateStages([
      { stageInstanceId: 's1', plannedStageId: 'kept', status: 'pending' },
      { stageInstanceId: 's2', plannedStageId: 'removed', status: 'pending' },
      { stageInstanceId: 's3', plannedStageId: 'other', status: 'running' }
    ], newRevision, ['kept']);
    expect(result).toEqual([
      { stageInstanceId: 's1', invalidation: 'STALE' },
      { stageInstanceId: 's2', invalidation: 'CANCELLED' },
      { stageInstanceId: 's3', invalidation: 'UNCHANGED' }
    ]);
  });

  test('all 17 command types are supported and appliable', () => {
    expect(PlanRevision.COMMANDS).toHaveLength(17);
    const store = makeStore();
    let revisionId = 'rev-0';
    const apply = (type, payload) => {
      const result = store.submit(command(type, payload, { expectedRevisionId: revisionId }));
      expect(result.ok).toBe(true);
      revisionId = result.revision.revisionId;
      return result;
    };
    apply('INSERT_STAGE', { stage: { purpose: 'position', plannedStageId: 'p1' } });
    apply('INSERT_STAGE', { stage: { purpose: 'critique', plannedStageId: 'p2', upstream: ['p1'] } });
    apply('CHANGE_STAGE_ORDER', { order: ['p2', 'p1'] });
    apply('CHANGE_PARTICIPANT', { stageId: 'p1', fromParticipantId: 'x', toParticipantId: 'y' });
    apply('CHANGE_VISIBILITY', { visibility: 'private' });
    apply('CHANGE_EXECUTION_POLICY', { policyKey: 'execution', policyValue: 'parallel' });
    apply('CHANGE_COMPLETION_POLICY', { policyKey: 'completion', policyValue: { mode: 'quorum', quorumSize: 2 } });
    apply('REQUEST_SYNTHESIS', {});
    apply('REQUEST_AUDIT', {});
    apply('INSERT_HUMAN_STAGE', { stage: { purpose: 'human_judgment', plannedStageId: 'h1' } });
    apply('ADD_CONSTRAINT', { constraint: { constraintId: 'c1', text: 'stay factual' } });
    apply('REMOVE_CONSTRAINT', { constraintId: 'c1' });
    apply('CHANGE_PRIORITY', { plannedStageId: 'p1', priority: 99 });
    apply('SPLIT_STAGE', { plannedStageId: 'p2', parts: [{ purpose: 'critique' }, { purpose: 'response' }] });
    apply('MERGE_STAGES', { plannedStageIds: ['p2:part1', 'p2:part2'], mergedStageId: 'm1' });
    apply('CANCEL_GOAL', { goalId: 'g1' });
    apply('REOPEN_GOAL', { goalId: 'g1' });
    const active = store.getActive();
    expect(active.metadata.reopenedGoalIds).toContain('g1');
    expect(active.metadata.cancelledGoalIds).not.toContain('g1');
  });

  test('running stage policy is validated', () => {
    const store = makeStore();
    const bad = store.submit(command('INSERT_STAGE', { stage: { purpose: 'audit' }, runningStagePolicy: 'EXPLODE' }));
    expect(bad.ok).toBe(false);
    const good = store.submit(command('INSERT_STAGE', { stage: { purpose: 'audit' }, runningStagePolicy: 'CANCEL' }));
    expect(good.ok).toBe(true);
    expect(good.runningStagePolicy).toBe('CANCEL');
  });

  test('hydrate restores active revision and full lineage (§27 Recovery)', () => {
    const store = makeStore();
    store.submit(command('INSERT_STAGE', { stage: { purpose: 'synthesis' } }));
    const lineage = store.getLineage();
    const restored = PlanRevision.createRevisionStore({});
    const active = restored.hydrate({ revisions: lineage });
    expect(active.revisionId).toBe(store.getActive().revisionId);
    expect(restored.getLineage()).toHaveLength(2);
  });

  test('UI-only changes do not require a revision (§23)', () => {
    expect(PlanRevision.requiresRevision({ field: 'zoom' })).toBe(false);
    expect(PlanRevision.requiresRevision({ field: 'collapsed' })).toBe(false);
    expect(PlanRevision.requiresRevision({ field: 'participant' })).toBe(true);
  });

  test('archive works for non-active revisions only', () => {
    const store = makeStore();
    store.submit(command('INSERT_STAGE', { stage: { purpose: 'audit' } }));
    expect(store.archive(store.getActive().revisionId)).toBe(false);
    expect(store.archive('rev-0')).toBe(true);
    expect(store.getLineage()[0].status).toBe('ARCHIVED');
  });
});

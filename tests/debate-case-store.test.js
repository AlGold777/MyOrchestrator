const Schema = require('../disput/debate-case-schema');
const Store = require('../disput/debate-case-store');

describe('canonical Debate case', () => {
  test('keeps append-only changes, linked revisions and deterministic snapshots', () => {
    let state = Schema.createCase({ caseId: 'case-1', createdAt: 1, title: 'Decision' });
    const claim = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', at: 2, correlationId: 'r1:c1',
      artifact: { id: 'c1', type: 'claim', status: 'asserted', title: 'Option A is cheaper', provenance: { turnId: 't1' } }
    });
    expect(claim.ok).toBe(true); state = claim.state;
    const revision = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', at: 3, correlationId: 'r2:r1',
      artifact: { id: 'r1', type: 'revision', status: 'recorded', targetId: 'c1', title: 'Only in year one', provenance: { turnId: 't2' } }
    });
    expect(revision.ok).toBe(true); state = revision.state;
    expect(state.artifacts.c1.title).toBe('Option A is cheaper');
    expect(state.artifacts.r1.targetId).toBe('c1');
    expect(state.changes.map((change) => change.sequence)).toEqual([1, 2]);
    expect(state.snapshots).toHaveLength(2);
    expect(Schema.validateCase(state)).toEqual({ ok: true, errors: [] });
  });

  test('rejects orphan links and duplicate accepted correlations', () => {
    const state = Schema.createCase({ caseId: 'case-2', createdAt: 1 });
    expect(Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', correlationId: 'bad',
      artifact: { id: 'o1', type: 'objection', targetId: 'missing', provenance: { turnId: 't1' } }
    }).errors).toContain('artifact_target_missing:missing');
    const first = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', correlationId: 'same',
      artifact: { id: 'c1', type: 'claim', title: 'Claim', provenance: { turnId: 't1' } }
    });
    expect(Schema.applyChange(first.state, {
      kind: 'UPSERT_ARTIFACT', correlationId: 'same', artifact: { id: 'c2', type: 'claim', provenance: { turnId: 't2' } }
    }).duplicate).toBe(true);
    expect(Schema.applyChange(first.state, {
      kind: 'SET_STATUS', expectedSequence: 0, technicalStatus: 'paused'
    })).toMatchObject({ ok: false, stale: true, errors: ['case_sequence_stale:0:1'] });
  });

  test('deletes a human-created link artifact without leaving an orphan', () => {
    let state = Schema.createCase({ caseId: 'case-delete-link', createdAt: 1 });
    state = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', correlationId: 'claim',
      artifact: { id: 'c1', type: 'claim', status: 'asserted', title: 'Claim', provenance: { turnId: 't1' } }
    }).state;
    state = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT', correlationId: 'human-link',
      artifact: { id: 'human-1', type: 'human_decision', status: 'accepted', targetId: 'c1', title: 'assign', provenance: { source: 'state_map_drawer' } }
    }).state;
    const removed = Schema.applyChange(state, { kind: 'DELETE_ARTIFACT', artifactId: 'human-1', correlationId: 'delete-human-link' });
    expect(removed.ok).toBe(true);
    expect(removed.state.artifacts['human-1']).toBeUndefined();
    expect(removed.state.changes.at(-1).kind).toBe('DELETE_ARTIFACT');
    expect(Schema.validateCase(removed.state)).toEqual({ ok: true, errors: [] });
  });

  test('persists, restores, exports and removes a case', async () => {
    const store = Store.createStore();
    await store.create({ caseId: 'case-store', createdAt: 1 });
    await store.apply({ kind: 'UPSERT_ARTIFACT', correlationId: 'c1', artifact: { id: 'c1', type: 'claim', title: 'Stored', provenance: { turnId: 't1' } } });
    const restored = Store.createStore();
    expect((await restored.load('case-store')).artifacts.c1.title).toBe('Stored');
    expect(JSON.parse(restored.exportCase()).caseId).toBe('case-store');
    await restored.remove('case-store');
    expect(await restored.load('case-store')).toBeNull();
  });
});

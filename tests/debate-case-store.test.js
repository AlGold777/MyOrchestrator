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

  test('enforces one active synthesis conclusion using prospective batch validation', () => {
    const initial = Schema.createCase({ caseId: 'case-synthesis', createdAt: 1 });
    const invalid = Schema.applyBatch(initial, [
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 's1', type: 'synthesis_conclusion', status: 'accepted', title: 'First', provenance: { source: 'test' } } },
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 's2', type: 'synthesis_conclusion', status: 'accepted', title: 'Second', provenance: { source: 'test' } } }
    ]);
    expect(invalid).toMatchObject({ ok: false, code: 'SEMANTIC_INVALID', state: initial });
    expect(invalid.errors[0]).toMatch(/^multiple_active_synthesis_conclusions:/);

    const seeded = Schema.applyChange(initial, {
      kind: 'UPSERT_ARTIFACT',
      artifact: { id: 's1', type: 'synthesis_conclusion', status: 'accepted', title: 'First', provenance: { source: 'test' } }
    }).state;
    const replaced = Schema.applyBatch(seeded, [
      { kind: 'SUPERSEDE_ARTIFACT', artifactId: 's1', targetId: 's2', expectedRevision: 0 },
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 's2', type: 'synthesis_conclusion', status: 'accepted', title: 'Second', provenance: { source: 'test' } } }
    ]);
    expect(replaced.ok).toBe(true);
    expect(replaced.state.artifacts.s1).toMatchObject({ status: 'superseded', supersededBy: 's2' });
    expect(Schema.validateCase(replaced.state)).toEqual({ ok: true, errors: [] });
  });

  test('supersede and merge require active same-type targets and preserve history', () => {
    let state = Schema.applyBatch(Schema.createCase({ caseId: 'case-lifecycle', createdAt: 1 }), [
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 'c1', type: 'claim', status: 'asserted', title: 'A', provenance: { source: 'test' } } },
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 'c2', type: 'claim', status: 'asserted', title: 'B', provenance: { source: 'test' } } },
      { kind: 'UPSERT_ARTIFACT', artifact: { id: 'c3', type: 'claim', status: 'asserted', title: 'C', provenance: { source: 'test' } } }
    ]).state;
    const merged = Schema.applyChange(state, { kind: 'MERGE_ARTIFACT', artifactId: 'c1', targetId: 'c2', expectedRevision: 0 });
    expect(merged.state.artifacts.c1).toMatchObject({ status: 'merged', mergedInto: 'c2', revision: 1 });
    expect(merged.state.artifacts.c1.history).toHaveLength(1);
    state = merged.state;
    expect(Schema.applyChange(state, { kind: 'SUPERSEDE_ARTIFACT', artifactId: 'c1', targetId: 'c3' }).errors)
      .toContain('artifact_lifecycle_source_inactive');
    const wrongType = Schema.applyChange(state, {
      kind: 'UPSERT_ARTIFACT',
      artifact: { id: 'o1', type: 'objection', status: 'raised', targetId: 'c2', title: 'O', provenance: { source: 'test' } }
    }).state;
    expect(Schema.applyChange(wrongType, { kind: 'SUPERSEDE_ARTIFACT', artifactId: 'c3', targetId: 'o1' }).errors)
      .toContain('artifact_lifecycle_type_mismatch');
  });

  test('migrates legacy artifact arrays to maps and remains stable after repeated reload', async () => {
    const legacy = {
      schemaVersion: 2, caseId: 'legacy-array', createdAt: 1, changes: [], sourceEvents: [],
      artifacts: [
        { id: 'c1', type: 'claim', status: 'asserted', title: 'Claim', provenance: { source: 'legacy' } },
        { id: 'o1', type: 'objection', status: 'raised', targetId: 'c1', title: 'Objection', provenance: { source: 'legacy' } }
      ]
    };
    const first = Store.createStore();
    await first.importCase(legacy);
    expect(Array.isArray(first.getState().artifacts)).toBe(false);
    expect(Schema.validateCase(first.getState())).toEqual({ ok: true, errors: [] });
    const second = Store.createStore();
    const once = await second.load('legacy-array');
    const third = Store.createStore();
    const twice = await third.load('legacy-array');
    expect(twice.artifacts).toEqual(once.artifacts);
    expect(Schema.validateCase(twice)).toEqual({ ok: true, errors: [] });
  });
});

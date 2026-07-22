const Pipeline = require('../disput/debate-artifact-pipeline');

describe('DebateArtifactPipeline', () => {
  const stage = { runId: 'run-1', stageInstanceId: 'stage-1', purpose: 'position' };
  const participant = { participantId: 'alpha' };

  test('extracts deterministic provenance-bearing artifacts', () => {
    const first = Pipeline.extractArtifacts({ stage, participant, text: 'A supported position' });
    const second = Pipeline.extractArtifacts({ stage, participant, text: 'A supported position' });
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({ type: 'claim', status: 'asserted', owner: 'alpha' });
    expect(first[0].provenance).toMatchObject({ runId: 'run-1', stageInstanceId: 'stage-1', participantId: 'alpha' });
  });

  test('maps planner purposes to valid prompt operations', () => {
    expect(Pipeline.operationForPurpose('position')).toBe('opening');
    expect(Pipeline.operationForPurpose('evidence_review')).toBe('verification');
    expect(Pipeline.operationForPurpose('audit')).toBe('synthesis_audit');
  });

  test('commits a real semantic mutation and projects a non-empty StateMap', () => {
    const artifacts = Pipeline.extractArtifacts({ stage, participant, text: 'A supported position' });
    const delta = Pipeline.proposeStateDelta({ stage, participant, artifacts, context: { caseVersion: 1 } });
    const state = { runId: 'run-1', caseVersion: 1, lifecycle: 'RUNNING', debateCase: { caseId: 'run-1', topic: { title: 'T' }, artifacts: [] } };
    const result = Pipeline.commitStateDelta({ state, stage, delta });
    expect(result.applied).toBe(true);
    expect(state.debateCase.artifacts).toHaveLength(1);
    expect(result.stateMap.claims).toHaveLength(1);
  });

  test('duplicate artifact is an explicit no-op and stale delta is rejected', () => {
    const artifacts = Pipeline.extractArtifacts({ stage, participant, text: 'Same response' });
    const state = { runId: 'run-1', caseVersion: 1, debateCase: { caseId: 'run-1', artifacts: [] } };
    const delta = Pipeline.proposeStateDelta({ stage, participant, artifacts, context: { caseVersion: 1 } });
    expect(Pipeline.commitStateDelta({ state, delta }).applied).toBe(true);
    expect(Pipeline.commitStateDelta({ state, delta })).toMatchObject({ applied: false, reason: 'no_state_change' });
    expect(Pipeline.commitStateDelta({ state: { ...state, caseVersion: 2 }, delta })).toMatchObject({ applied: false, reason: 'case_version_stale' });
  });

  test('synthesis and audit artifacts expose finalization readiness IDs', () => {
    const state = { runId: 'r', debateCase: { caseId: 'r', artifacts: [
      ...Pipeline.extractArtifacts({ stage: { runId: 'r', stageInstanceId: 's1', purpose: 'synthesis' }, participant, text: 'Synthesis' }),
      ...Pipeline.extractArtifacts({ stage: { runId: 'r', stageInstanceId: 's2', purpose: 'audit' }, participant, text: 'Audit passed' })
    ] } };
    const map = Pipeline.projectStateMap(state);
    expect(map.synthesisArtifactId).toMatch(/^artifact-/);
    expect(map.validAuditArtifactId).toMatch(/^artifact-/);
  });
});

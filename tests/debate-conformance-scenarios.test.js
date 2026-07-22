const RunStore = require('../disput/debate-run-store');

function transition(state, type, payload = {}) {
  return RunStore.transition(state, { type, payload });
}

describe('Debate UI/runtime conformance scenarios', () => {
  const plan = { stages: [{ stageId: 'r1:open', kind: 'opening_batch', participants: ['A'] }, { stageId: 'final:synthesis', kind: 'final_synthesis', participants: ['A'] }] };
  const started = () => transition(RunStore.createState(), RunStore.EVENTS.START_REQUESTED, { runId: 'r1', topology: 'duel', executionPlan: plan });

  test('retry does not project a completed stage before completion event', () => {
    let state = transition(started(), RunStore.EVENTS.STAGE_STARTED, { stageId: 'r1:open' });
    state = transition(state, RunStore.EVENTS.STAGE_FAILED, { stageId: 'r1:open' });
    expect(state.currentStageId).toBe('r1:open');
    state = transition(state, RunStore.EVENTS.STAGE_COMPLETED, { stageId: 'r1:open' });
    expect(state.currentStageId).toBe('final:synthesis');
  });

  test('partial response remains a running stage after rejection', () => {
    let state = transition(started(), RunStore.EVENTS.STAGE_STARTED, { stageId: 'r1:open' });
    state = transition(state, RunStore.EVENTS.MODEL_RESPONSE_RECEIVED, { stageId: 'r1:open', participant: 'A', attemptId: 'r1:open:a1', text: 'partial' });
    expect(state.status).toBe('running');
    expect(state.execution.status).toBe('collecting');
  });

  test('serialized recovery keeps the same state', () => {
    const state = transition(started(), RunStore.EVENTS.STAGE_STARTED, { stageId: 'r1:open' });
    expect(RunStore.hydrate(RunStore.serialize(state))).toEqual(state);
  });

  test('terminal state rejects later finalization', () => {
    let state = transition(started(), RunStore.EVENTS.FINALIZATION_COMPLETED, { epistemicOutcome: 'resolved' });
    const before = state.status;
    state = transition(state, RunStore.EVENTS.FINALIZATION_COMPLETED, { epistemicOutcome: 'inconclusive' });
    expect(state.status).toBe(before);
    expect(state.epistemicOutcome).toBe('resolved');
    expect(state.events.at(-1).type).toBe(RunStore.EVENTS.DUPLICATE_FINAL_REJECTED);
  });

  test('degraded execution remains non-terminal and is persisted', () => {
    let state = transition(started(), RunStore.EVENTS.EXECUTION_STATE_CHANGED, { degradedMode: { reason: 'duel_to_monologue' } });
    expect(state.status).toBe('running');
    expect(RunStore.hydrate(RunStore.serialize(state)).degradedMode.reason).toBe('duel_to_monologue');
  });

  test('manual approval is represented by store state', () => {
    let state = transition(started(), RunStore.EVENTS.APPROVAL_REQUESTED, { model: 'A' });
    expect(state.status).toBe('awaiting_approval');
    state = transition(state, RunStore.EVENTS.APPROVAL_GRANTED, { model: 'A' });
    expect(state.status).toBe('running');
  });

  test('accepted ledger rejects a different attempt after reload', () => {
    let state = transition(started(), RunStore.EVENTS.MODEL_RESPONSE_RECEIVED, { stageId: 'r1:open', participant: 'A', attemptId: 'a1', text: 'answer', accepted: true });
    state = RunStore.hydrate(RunStore.serialize(state));
    const next = transition(state, RunStore.EVENTS.MODEL_RESPONSE_RECEIVED, { stageId: 'r1:open', participant: 'A', attemptId: 'a2', text: 'late answer', accepted: true });
    expect(next.acceptedLedger['r1:open:A'].attemptId).toBe('a1');
    expect(next.events.at(-1).type).toBe(RunStore.EVENTS.DUPLICATE_FINAL_REJECTED);
  });
});

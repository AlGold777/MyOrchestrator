const RunStore = require('../disput/debate-run-store');

describe('DebateRunStore', () => {
  test('reduces lifecycle events into one canonical status', () => {
    const store = RunStore.createStore();
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r1' } });
    store.dispatch({ type: RunStore.EVENTS.BATCH_DISPATCHED, payload: { batch: { id: 'b1' } } });
    store.dispatch({ type: RunStore.EVENTS.APPROVAL_REQUESTED, payload: { model: 'GPT' } });
    expect(store.getState()).toMatchObject({
      runId: 'r1',
      topology: 'universal',
      status: 'awaiting_approval',
      approval: { waiting: true, model: 'GPT' },
      execution: { status: 'dispatching', activeBatch: { id: 'b1' } }
    });
    store.dispatch({ type: RunStore.EVENTS.APPROVAL_GRANTED });
    store.dispatch({ type: RunStore.EVENTS.FINALIZATION_REQUESTED });
    store.dispatch({ type: RunStore.EVENTS.FINALIZATION_COMPLETED });
    expect(RunStore.isTerminal(store.getState())).toBe(true);
    expect(store.getState().events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('round-trips protocol Sets for persisted recovery', () => {
    const state = RunStore.createState({
      runId: 'r2',
      status: 'paused',
      protocolState: { routedTurnIds: new Set(['t1']), newPagesOpenedModels: new Set(['GPT']) }
    });
    const recovered = RunStore.hydrate(RunStore.serialize(state));
    expect(recovered.protocolState.routedTurnIds).toBeInstanceOf(Set);
    expect([...recovered.protocolState.routedTurnIds]).toEqual(['t1']);
    expect([...recovered.protocolState.newPagesOpenedModels]).toEqual(['GPT']);
  });

  test('round-trips Date, Map, Set and explicit undefined values', () => {
    const createdAt = new Date('2026-07-25T10:00:00.000Z');
    const state = RunStore.createState({
      runId: 'typed',
      config: {
        createdAt,
        routing: new Map([['alpha', { attempts: new Set([1, 2]) }]]),
        optionalValue: undefined
      }
    });
    const recovered = RunStore.hydrate(RunStore.serialize(state));
    expect(recovered.config.createdAt).toBeInstanceOf(Date);
    expect(recovered.config.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(recovered.config.routing).toBeInstanceOf(Map);
    expect(recovered.config.routing.get('alpha').attempts).toEqual(new Set([1, 2]));
    expect(Object.prototype.hasOwnProperty.call(recovered.config, 'optionalValue')).toBe(true);
    expect(recovered.config.optionalValue).toBeUndefined();
  });

  test('a new start replaces the previous run event stream', () => {
    const store = RunStore.createStore();
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r1' } });
    store.dispatch({ type: RunStore.EVENTS.RUN_FAILED, payload: { reason: 'x' } });
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r2' } });
    expect(store.getState().runId).toBe('r2');
    expect(store.getState().events).toHaveLength(1);
    expect(store.getState().events[0].seq).toBe(1);
  });

  test('protocol synchronization is explicit and revisioned', () => {
    const store = RunStore.createStore();
    const protocolState = { status: 'running', turn: 1 };
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r-sync', protocolState } });
    store.dispatch({
      type: RunStore.EVENTS.PROTOCOL_STATE_SYNCED,
      payload: { protocolState: { status: 'paused', turn: 2 }, reason: 'PIPELINE_PAUSED' }
    });
    expect(store.getState()).toMatchObject({
      protocolRevision: 1,
      protocolState: { status: 'paused', turn: 2 }
    });
    expect(store.getState().events.at(-1)).toMatchObject({
      type: RunStore.EVENTS.PROTOCOL_STATE_SYNCED,
      payload: { reason: 'PIPELINE_PAUSED' }
    });
  });

  test('protocol synchronization rejects a stale expected revision without changing state', () => {
    const store = RunStore.createStore();
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r-cas', protocolState: { status: 'running' } } });
    store.dispatch({
      type: RunStore.EVENTS.PROTOCOL_STATE_SYNCED,
      payload: { protocolState: { status: 'paused' }, expectedProtocolRevision: 0 }
    });
    const before = RunStore.serialize(store.getState());
    expect(() => store.dispatch({
      type: RunStore.EVENTS.PROTOCOL_STATE_SYNCED,
      payload: { protocolState: { status: 'completed' }, expectedProtocolRevision: 0 }
    })).toThrow('PROTOCOL_REVISION_STALE');
    expect(RunStore.serialize(store.getState())).toBe(before);
  });

  test('terminal protocol synchronization also terminates the aggregate run', () => {
    const store = RunStore.createStore();
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r-cancel' } });
    store.dispatch({
      type: RunStore.EVENTS.PROTOCOL_STATE_SYNCED,
      at: 1234,
      payload: {
        protocolState: { status: 'cancelled' },
        protocolStatus: 'cancelled',
        reason: 'participant_dropout:opening'
      }
    });
    expect(store.getState()).toMatchObject({
      status: 'cancelled',
      completedAt: 1234,
      terminalReason: 'participant_dropout:opening',
      execution: { status: 'cancelled', activeBatch: null },
      approval: { waiting: false }
    });
    expect(RunStore.isTerminal(store.getState())).toBe(true);
  });

  test('compiled stage events advance the canonical plan cursor', () => {
    const store = RunStore.createStore();
    const executionPlan = {
      planId: 'p1',
      stages: [{ stageId: 'r1:openings' }, { stageId: 'r1:filter' }, { stageId: 'final:synthesis' }]
    };
    store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r-plan', executionPlan } });
    expect(store.getState().currentStageId).toBe('r1:openings');
    store.dispatch({ type: RunStore.EVENTS.STAGE_COMPLETED, payload: { stageId: 'r1:openings' } });
    expect(store.getState().currentStageId).toBe('r1:filter');
    store.dispatch({ type: RunStore.EVENTS.STAGE_STARTED, payload: { stageId: 'r1:filter' } });
    expect(store.getState().execution.activeStageId).toBe('r1:filter');
  });

  test('accepted ledger ignores collected-but-unaccepted responses and survives hydration', () => {
    let state = RunStore.transition(RunStore.createState(), {
      type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'ledger' }
    });
    state = RunStore.transition(state, {
      type: RunStore.EVENTS.MODEL_RESPONSE_RECEIVED,
      payload: { stageId: 'r1:wave', participant: 'A', attemptId: 'r1:wave:a1', text: 'incomplete', accepted: false }
    });
    expect(state.acceptedLedger).toEqual({});
    state = RunStore.transition(state, {
      type: RunStore.EVENTS.MODEL_RESPONSE_RECEIVED,
      payload: { stageId: 'r1:wave', participant: 'A', attemptId: 'r1:wave:a2', text: 'complete', accepted: true }
    });
    const recovered = RunStore.hydrate(RunStore.serialize(state));
    expect(recovered.acceptedLedger['r1:wave:A'].attemptId).toBe('r1:wave:a2');
    const duplicate = RunStore.transition(recovered, {
      type: RunStore.EVENTS.MODEL_RESPONSE_RECEIVED,
      payload: { stageId: 'r1:wave', participant: 'A', attemptId: 'r1:wave:a3', text: 'late', accepted: true }
    });
    expect(duplicate.events.at(-1).type).toBe(RunStore.EVENTS.DUPLICATE_FINAL_REJECTED);
  });

  test('tracks typed decisions, rule traces, progress and model signals', () => {
    let state = RunStore.transition(RunStore.createState(), { type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r-new' } });
    state = RunStore.transition(state, { type: RunStore.EVENTS.DECISION_REQUESTED, payload: { requestId: 'd1', question: 'Continue?', options: [{ id: 'yes' }, { id: 'no' }] } });
    expect(state.status).toBe('awaiting_approval');
    state = RunStore.transition(state, { type: RunStore.EVENTS.DECISION_RESOLVED, payload: { requestId: 'd1', decisionId: 'answer1', optionId: 'yes', effect: 'execute_action' } });
    state = RunStore.transition(state, { type: RunStore.EVENTS.RULE_EVALUATED, payload: { ruleId: 'rule1', triggerId: 'STAGNATION', status: 'suppressed' } });
    state = RunStore.transition(state, { type: RunStore.EVENTS.PROGRESS_WINDOW_UPDATED, payload: { window: [{ stateChanged: false }] } });
    state = RunStore.transition(state, { type: RunStore.EVENTS.MODEL_SIGNAL_OBSERVED, payload: { model: 'A', signal: { type: 'ready' } } });
    expect(state.decisionRequests[0]).toMatchObject({ requestId: 'd1', status: 'resolved' });
    expect(state.humanDecisions[0]).toMatchObject({ decisionId: 'answer1' });
    expect(state.ruleEvaluations).toHaveLength(1);
    expect(state.progressWindow).toEqual([{ stateChanged: false }]);
    expect(state.modelSignals).toHaveLength(1);
  });

  test('keeps pause reason separate from terminal failure reason', () => {
    let state = RunStore.transition(RunStore.createState(), {
      type: RunStore.EVENTS.START_REQUESTED,
      payload: { runId: 'pause-reason' }
    });
    state = RunStore.transition(state, {
      type: RunStore.EVENTS.PAUSE_REQUESTED,
      payload: { reason: 'moderator_review' }
    });
    expect(state).toMatchObject({
      status: 'paused',
      pauseReason: 'moderator_review',
      terminalReason: ''
    });
    state = RunStore.transition(state, { type: RunStore.EVENTS.RESUME_REQUESTED });
    expect(state.pauseReason).toBe('');
  });

  test.each([
    'BATCH_DISPATCHED',
    'STAGE_STARTED',
    'APPROVAL_GRANTED',
    'RESUME_REQUESTED',
    'DECISION_RESOLVED',
    'EXECUTION_STATE_CHANGED'
  ])('terminal state absorbs late %s', (eventName) => {
    const terminal = RunStore.createState({
      runId: 'terminal',
      status: 'completed',
      completedAt: 123,
      execution: { status: 'completed', activeBatch: null }
    });
    const next = RunStore.transition(terminal, {
      type: RunStore.EVENTS[eventName],
      payload: { requestId: 'late', status: 'running' }
    });
    expect(next).toMatchObject({
      status: 'completed',
      completedAt: 123,
      execution: { status: 'completed', activeBatch: null }
    });
    expect(next.events.at(-1)).toMatchObject({
      type: RunStore.EVENTS.TERMINAL_EVENT_REJECTED,
      payload: { attemptedType: RunStore.EVENTS[eventName], originalStatus: 'completed' }
    });
  });

  test('one broken subscriber does not prevent state delivery to other subscribers', () => {
    const errors = [];
    const observed = [];
    const store = RunStore.createStore({}, { onListenerError: (error) => errors.push(error.message) });
    store.subscribe(() => { throw new Error('render_failed'); });
    store.subscribe((state, event) => observed.push([state.status, event.type]));
    expect(() => store.dispatch({
      type: RunStore.EVENTS.START_REQUESTED,
      payload: { runId: 'listener-isolation' }
    })).not.toThrow();
    expect(errors).toEqual(['render_failed']);
    expect(observed).toEqual([['running', RunStore.EVENTS.START_REQUESTED]]);
  });

  test('execution projection accepts only contract fields', () => {
    let state = RunStore.transition(RunStore.createState(), {
      type: RunStore.EVENTS.START_REQUESTED,
      payload: { runId: 'execution-contract' }
    });
    state = RunStore.transition(state, {
      type: RunStore.EVENTS.EXECUTION_STATE_CHANGED,
      payload: {
        status: 'collecting',
        retryCount: 2,
        activeStageId: 's1',
        runId: 'overwrite-attempt',
        arbitraryLargeObject: { secret: 'not-persisted' },
        degradedMode: { reason: 'limited' }
      }
    });
    expect(state.execution).toMatchObject({ status: 'collecting', retryCount: 2, activeStageId: 's1' });
    expect(state.execution).not.toHaveProperty('runId');
    expect(state.execution).not.toHaveProperty('arbitraryLargeObject');
    expect(state.degradedMode).toEqual({ reason: 'limited' });
  });

  test('event truncation is explicit and reports the retained sequence window', () => {
    let state = RunStore.transition(RunStore.createState(), {
      type: RunStore.EVENTS.START_REQUESTED,
      payload: { runId: 'long-run' }
    });
    for (let index = 0; index < RunStore.MAX_EVENTS + 5; index += 1) {
      state = RunStore.transition(state, {
        type: RunStore.EVENTS.RULE_EVALUATED,
        payload: { ruleId: `rule-${index}` }
      });
    }
    expect(state.events).toHaveLength(RunStore.MAX_EVENTS);
    expect(state.eventLog).toEqual({
      truncated: true,
      droppedCount: 6,
      firstRetainedSeq: 7
    });
    expect(state.events[0].seq).toBe(state.eventLog.firstRetainedSeq);
  });
});

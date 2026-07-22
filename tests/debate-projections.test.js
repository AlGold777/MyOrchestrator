const RunStore = require('../disput/debate-run-store');
global.DebateRunStore = RunStore;
const Projections = require('../disput/debate-projections');

test('feed, transcript and timeline are projections of one stream', () => {
  const store = RunStore.createStore();
  store.dispatch({ type: RunStore.EVENTS.START_REQUESTED, payload: { runId: 'r1' } });
  store.dispatch({ type: RunStore.EVENTS.MODERATOR_TURN_RECORDED, payload: { sessionId: '1', text: 'topic' } });
  store.dispatch({ type: RunStore.EVENTS.MODEL_TURN_RECORDED, payload: { sessionId: '1', model: 'GPT', text: 'answer' } });
  store.dispatch({ type: RunStore.EVENTS.TIMELINE_EVENT_RECORDED, payload: { type: 'Response', from: 'GPT' } });
  expect(Projections.projectTurns(store.getState())).toHaveLength(2);
  expect(Projections.projectSessions(store.getState())[0].turns[1].text).toBe('answer');
  expect(Projections.projectTimeline(store.getState())[0].from).toBe('GPT');
});

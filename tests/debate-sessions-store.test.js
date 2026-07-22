const Sessions = require('../results/debate-sessions-store');

test('session store owns active session and normalized collections', () => {
  const store = Sessions.create();
  store.setActive('2');
  expect(store.state.activeSessionId).toBe('2');
  expect(store.ensure('2')).toMatchObject({ id: '2', favoriteOnly: false, cards: [], messages: [] });
  store.remove('2');
  expect(store.state.activeSessionId).toBe('1');
});

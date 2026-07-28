const Protocols = require('../disput/debate-protocols');

test('protocol facade always resolves the universal lifecycle projection', () => {
  expect(Protocols.topologyOf('anything')).toBe('universal');
  expect(Object.keys(Protocols.protocols)).toEqual(['universal']);
  const state = Protocols.getProtocol().reduce({}, { type: 'RUNNING' });
  expect(state).toMatchObject({ active: true, status: 'running' });
});

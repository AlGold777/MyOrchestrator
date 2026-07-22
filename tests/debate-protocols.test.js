const Protocols = require('../disput/debate-protocols');

describe('DebateProtocols', () => {
  test.each([
    ['2', 'duel'],
    ['duel', 'duel'],
    ['3', 'triad'],
    ['triad', 'triad'],
    ['many', 'multi'],
    ['multi', 'multi']
  ])('normalizes %s to %s', (input, expected) => {
    expect(Protocols.topologyOf(input)).toBe(expected);
    expect(Protocols.getProtocol(input).topology).toBe(expected);
  });

  test('exposes one lifecycle contract for every topology', () => {
    for (const topology of ['duel', 'triad', 'multi']) {
      const protocol = Protocols.getProtocol(topology);
      const state = protocol.createState({ active: true });
      protocol.markCancelled(state, 'test');
      expect(protocol.isTerminal(state)).toBe(true);
    }
  });

  test('plans topology effects behind one contract', () => {
    const duel = Protocols.getProtocol('duel');
    expect(duel.planNextEffects(duel.createState({ active: true }))).toEqual([{ type: 'DISPATCH_OPENINGS' }]);
    const triad = Protocols.getProtocol('triad');
    expect(triad.planNextEffects(triad.createState({ active: true }))).toEqual([{ type: 'DISPATCH_TRIAD_INIT' }]);
    const multi = Protocols.getProtocol('multi');
    expect(multi.planNextEffects(multi.createState({ active: true, completedWaves: 0, waveLimit: 2 }))).toEqual([{ type: 'DISPATCH_MULTI_WAVE', wave: 1 }]);
  });
});

describe('Disput evolution flags', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
  });

  test('exposes independent rollback switches and records content-free audit', () => {
    const Flags = require('../disput/disput-evolution-flags');
    expect(Flags.read()).toMatchObject({ stateMapReadOnly: true, liveStateMap: true, pipelineProfiles: true, triggers: true, freeTalkMvp: true });
    Flags.set('triggers', false);
    expect(Flags.enabled('triggers')).toBe(false);
    expect(Flags.getAudit()).toEqual([expect.objectContaining({ event: 'feature_flag_changed', name: 'triggers', enabled: false })]);
    expect(JSON.stringify(Flags.getAudit())).not.toMatch(/prompt|answer|content/i);
  });

  test('rejects unknown switches', () => {
    const Flags = require('../disput/disput-evolution-flags');
    expect(() => Flags.set('unknown', false)).toThrow('Unknown Disput evolution flag');
  });
});

const Policies = require('../disput/debate-policies');

describe('DebatePolicies — single configuration validation contract', () => {
  test('default cardinality has no hidden maximum', () => {
    expect(Policies.DEFAULT_CARDINALITY.maximum).toBeNull();
    expect(Policies.DEFAULT_CARDINALITY.minimum).toBe(1);
  });

  test.each([2, 3, 4, 7])('accepts %i participants under default policy (Extraction Contract §17.4)', (count) => {
    const participants = Array.from({ length: count }, (_, i) => ({ participantId: `model-${i}` }));
    const result = Policies.validateConfiguration({ participants });
    expect(result.valid).toBe(true);
    expect(result.appliedPolicies).toContain('participant-cardinality.default.v1');
  });

  test('explicit maximum produces traceable refusal with policy ID, actual and allowed values', () => {
    const policies = Policies.resolve({ cardinality: { policyId: 'cardinality.custom.v1', maximum: 2, reason: 'test constraint' } });
    const result = Policies.validateConfiguration({ participants: [{ participantId: 'a' }, { participantId: 'b' }, { participantId: 'c' }] }, policies);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      policyId: 'cardinality.custom.v1',
      code: 'PARTICIPANTS_ABOVE_MAXIMUM',
      actual: 3,
      allowed: '<= 2'
    });
  });

  test('rejects below minimum, missing ids, duplicate ids', () => {
    expect(Policies.validateConfiguration({ participants: [] }).errors[0].code).toBe('PARTICIPANTS_BELOW_MINIMUM');
    expect(Policies.validateConfiguration({ participants: [{}, { participantId: 'a' }] }).errors[0].code).toBe('PARTICIPANT_ID_REQUIRED');
    expect(Policies.validateConfiguration({ participants: [{ participantId: 'a' }, { participantId: 'a' }] }).errors[0].code).toBe('PARTICIPANT_ID_DUPLICATE');
  });

  test('quorum completion policy is validated against participant count', () => {
    const policies = Policies.resolve({ completion: { mode: 'quorum', quorumSize: 5 } });
    const result = Policies.validateConfiguration({ participants: [{ participantId: 'a' }, { participantId: 'b' }] }, policies);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('QUORUM_INVALID');
  });

  test('resolve merges overrides without dropping defaults', () => {
    const resolved = Policies.resolve({ finalization: { synthesis: 'none' } });
    expect(resolved.finalization.synthesis).toBe('none');
    expect(resolved.finalization.audit).toBe('optional');
    expect(resolved.stagnation.noStateDeltaLimit).toBe(3);
  });
});

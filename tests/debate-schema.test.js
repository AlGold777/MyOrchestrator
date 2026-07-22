const Schema = require('../shared/debate-schema');

describe('generic debate schema', () => {
  test('validates participant and event invariants without cardinality assumptions', () => {
    expect(Schema.validateState({ participants: ['a'], events: [] }, { requireParticipants: true })).toBe(true);
    expect(Schema.validateState({ participants: ['a', 'b', 'c', 'd'], events: [] }, { requireParticipants: true })).toBe(true);
    expect(() => Schema.validateState({ participants: [] }, { requireParticipants: true })).toThrow(Schema.DebateSchemaError);
  });

  test('aggregate events must remain ordered', () => {
    expect(Schema.validateRunAggregate({ runId: 'r', status: 'running', events: [{ seq: 1 }, { seq: 2 }] })).toBe(true);
    expect(() => Schema.validateRunAggregate({ runId: 'r', status: 'running', events: [{ seq: 2 }, { seq: 1 }] })).toThrow(/events.seq/);
  });
});

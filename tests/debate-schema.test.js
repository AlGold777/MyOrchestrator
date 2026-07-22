const DebateSchema = require('../shared/debate-schema');
const DebateFSM = require('../disput/debate-runtime');

describe('DebateSchema log-only validators', () => {
  test('accepts a valid public serial state with participants', () => {
    const state = DebateFSM.createState({
      phase: DebateFSM.PHASES.PUBLIC,
      modelA: 'GPT',
      modelB: 'Claude'
    });
    expect(DebateSchema.validateSerialState(state, { requireParticipants: true })).toBe(true);
  });

  test('validates aggregate event ordering', () => {
    expect(() => DebateSchema.validateRunAggregate({ topology: 'duel', status: 'running', runId: 'r1', events: [{ seq: 1 }, { seq: 2 }] })).not.toThrow();
    expect(() => DebateSchema.validateRunAggregate({ topology: 'duel', status: 'running', runId: 'r1', events: [{ seq: 2 }, { seq: 1 }] })).toThrow(/events.seq/);
  });

  test('rejects invalid Set-backed fields', () => {
    const state = DebateFSM.createState({
      phase: DebateFSM.PHASES.PUBLIC,
      modelA: 'GPT',
      modelB: 'Claude',
      newPagesOpenedModels: []
    });
    expect(() => DebateSchema.validateSerialState(state, { requireParticipants: true }))
      .toThrow(DebateSchema.DebateSchemaError);
  });

  test('rejects missing participants only when requested', () => {
    const state = DebateFSM.createState({ phase: DebateFSM.PHASES.PUBLIC });
    expect(DebateSchema.validateSerialState(state)).toBe(true);
    expect(() => DebateSchema.validateSerialState(state, { requireParticipants: true }))
      .toThrow(/modelA/);
  });
});

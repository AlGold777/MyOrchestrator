const Registry = require('../disput/debate-participant-registry');

describe('DebateParticipantRegistry', () => {
  test('adapts legacy failed maps to canonical terminal failure records', () => {
    expect(Registry.terminalFailures({ failed: { B: 'TIMEOUT', C: 'ERROR' } }, {
      stageId: 'r2:wave', attemptId: 'r2:wave:a1'
    })).toEqual([
      { modelId: 'B', terminal: true, reasonCode: 'TIMEOUT', stageId: 'r2:wave', attemptId: 'r2:wave:a1' },
      { modelId: 'C', terminal: true, reasonCode: 'ERROR', stageId: 'r2:wave', attemptId: 'r2:wave:a1' }
    ]);
  });

  test('accepts canonical arrays and ignores explicitly non-terminal failures', () => {
    expect(Registry.terminalFailures({ failed: [
      { modelId: 'A', terminal: false, reasonCode: 'TRANSIENT' },
      { modelId: 'B', terminal: true, reasonCode: 'NO_SEND' }
    ] })).toEqual([{ modelId: 'B', terminal: true, reasonCode: 'NO_SEND', stageId: '', attemptId: '' }]);
  });

  test('preserves configured coverage while removing dropped models from routing', () => {
    const state = {};
    Registry.initialize(state, ['A', 'B', 'C', 'A']);
    Registry.markDropped(state, [{ modelId: 'B', terminal: true, reasonCode: 'ERROR', stageId: 'r1:wave', attemptId: 'a1' }]);
    expect(state.configuredParticipants).toEqual(['A', 'B', 'C']);
    expect(state.activeParticipants).toEqual(['A', 'C']);
    expect(state.droppedModels).toEqual(['B']);
    expect(state.droppedParticipants).toEqual([expect.objectContaining({ modelId: 'B', terminal: true })]);
    expect(Registry.filterActive(state, ['B', 'C', 'A'])).toEqual(['C', 'A']);
  });

  test('dropout is idempotent and later evidence enriches the canonical record', () => {
    const state = {};
    Registry.initialize(state, ['A', 'B']);
    Registry.markDropped(state, ['B'], { stageId: 'opening', reasonCode: 'ERROR' });
    Registry.markDropped(state, [{ modelId: 'B', reasonCode: 'TIMEOUT', attemptId: 'a2' }]);
    expect(state.droppedModels).toEqual(['B']);
    expect(state.droppedParticipants).toEqual([expect.objectContaining({ modelId: 'B', reasonCode: 'TIMEOUT', attemptId: 'a2' })]);
  });
});

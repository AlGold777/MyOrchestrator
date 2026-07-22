const MultiFSM = require('../disput/multi-runtime');

describe('MultiFSM', () => {
  test('owns the complete multi lifecycle', () => {
    const state = MultiFSM.createState({ models: ['GPT', 'Claude', 'Gemini'], waveLimit: 2 });
    MultiFSM.begin(state);
    MultiFSM.beginWave(state, 1);
    MultiFSM.recordWave(state, [{ model: 'GPT', text: 'A' }]);
    expect(state).toMatchObject({ active: true, phase: 'wave', wave: 1, completedWaves: 1 });
    expect(MultiFSM.hasReachedWaveLimit(state)).toBe(false);
    MultiFSM.beginWave(state, 2);
    MultiFSM.recordWave(state, [{ model: 'Claude', text: 'B' }]);
    expect(MultiFSM.hasReachedWaveLimit(state)).toBe(true);
    MultiFSM.beginSynthesis(state);
    MultiFSM.recordSynthesis(state, 'result');
    MultiFSM.markCompleted(state);
    expect(state).toMatchObject({ active: false, phase: 'final', status: 'completed', synthesisText: 'result' });
  });

  test('cancel is terminal', () => {
    const state = MultiFSM.createState({ active: true });
    MultiFSM.markCancelled(state, 'user_cancel');
    expect(state).toMatchObject({ active: false, status: 'cancelled', stopReason: 'user_cancel' });
  });
});

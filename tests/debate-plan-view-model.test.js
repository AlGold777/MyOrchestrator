const Compiler = require('../disput/debate-plan-compiler');
const ViewModel = require('../results/debate-plan-view-model');

test('projects system stages explicitly instead of hiding the synthesizer call', () => {
  const executionPlan = Compiler.compile({
    topology: 'duel', runPolicy: 'auto',
    scenario: { modelA: 'Le Chat', modelB: 'Perplexity' }, synthesizer: 'Claude',
    presetConfig: {
      presetId: 'DUEL_STANDARD', topology: 'duel', roundLimit: 1,
      roundPlan: [{ round: 1, outputs: ['positions_map'] }]
    }
  });
  const view = ViewModel.project({ executionPlan, currentStageId: 'r1:filter' });
  expect(view).toMatchObject({
    runPolicy: 'auto',
    current: { label: 'System round analysis', system: true, participants: ['Claude'] },
    next: { label: 'Final words' }
  });
  expect(view.statusText).toContain('2/4');
});

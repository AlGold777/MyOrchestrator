const ViewModel = require('../results/debate-plan-view-model');

test('projects universal stages including synthesis and its audit', () => {
  const executionPlan = {
    planId: 'plan-1',
    runPolicy: 'auto',
    stages: [
      { stageId: 'analysis-1', purpose: 'participant', participants: ['Le Chat', 'Perplexity'] },
      { stageId: 'synthesis-1', purpose: 'synthesis', visibility: 'system', participants: ['Claude'] },
      { stageId: 'audit-1', purpose: 'audit', visibility: 'system', participants: ['GPT'] }
    ]
  };
  const view = ViewModel.project({ executionPlan, currentStageId: 'synthesis-1' });
  expect(view).toMatchObject({
    runPolicy: 'auto',
    current: { label: 'Synthesis', system: true, participants: ['Claude'] },
    next: { label: 'Synthesis audit', system: true, participants: ['GPT'] }
  });
  expect(view.statusText).toContain('2/3');
});

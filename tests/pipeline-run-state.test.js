const State = require('../background/pipeline-run-state');

test('background run state is constructed in one module', () => {
  const state = State.create({ prompt: 'p', selectedModels: ['GPT'], pipelineContext: { pipelineRunId: 'r1' }, startedAt: 5 });
  expect(state).toMatchObject({ prompt: 'p', session: { startTime: 5, totalModels: 1, pipelineRunId: 'r1', pipelineState: 'STARTING' } });
  State.applyControl(state, { pipelineRunId: 'r1', state: 'PAUSED', stage: 'approval', round: 'r2' });
  expect(state.session).toMatchObject({ pipelineState: 'PAUSED', pipelineStage: 'approval', pipelineRoundId: 'r2' });
});

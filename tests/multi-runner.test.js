const MultiFSM = require('../disput/multi-runtime');
const MultiRunner = require('../disput/multi-runner');

describe('MultiRunner', () => {
  test('keeps an external selected synthesizer through every wave filter and final synthesis', async () => {
    const filterSynthesizers = [];
    const finalSynthesizers = [];
    let state;
    const runner = MultiRunner.createMultiRunner({
      protocol: { createState: MultiFSM.createState },
      setState: (current) => { state = current; },
      transition: (current, event) => {
        if (event.type === 'MULTI_BEGIN_WAVE') MultiFSM.beginWave(current, event.payload.wave);
        if (event.type === 'MULTI_WAVE_COMPLETED') MultiFSM.recordWave(current, event.payload.turns);
        if (event.type === 'MULTI_BEGIN_SYNTHESIS') MultiFSM.beginSynthesis(current);
        if (event.type === 'MULTI_SYNTHESIS_RECORDED') MultiFSM.recordSynthesis(current, event.payload.text);
        if (event.type === 'COMPLETED') MultiFSM.markCompleted(current);
        return current;
      },
      buildWavePrompt: ({ modelName }) => `wave for ${modelName}`,
      buildFinalSynthesisPrompt: () => 'synthesis prompt',
      runRoundFilter: async ({ synthesizer }) => { filterSynthesizers.push(synthesizer); return null; },
      runModelBatch: jest.fn(async ({ models, context }) => {
        if (context.pipelineRoundId === 'multi-synthesis') finalSynthesizers.push(...models);
        return { responses: Object.fromEntries(models.map((model) => [model, context.pipelineRoundId === 'multi-synthesis' ? 'synthesis' : `wave:${model}`])) };
      }),
      handleTerminalOutputs: jest.fn()
    });
    await expect(runner.start({
      selectedModels: ['A', 'B'], synthesizer: 'Judge', pipelineNameText: 'Topic',
      runContext: { pipelineRunId: 'r-external', sessionId: 's1' }, presetConfig: { waveLimit: 2 }
    })).resolves.toBe(true);
    expect(filterSynthesizers).toEqual(['Judge', 'Judge']);
    expect(finalSynthesizers).toEqual(['Judge']);
    expect(state.synthesizer).toBe('Judge');
  });

  test('runs waves and mandatory synthesis', async () => {
    const terminal = jest.fn();
    const setState = jest.fn();
    const runModelBatch = jest.fn(({ context, models }) => Promise.resolve({
      responses: Object.fromEntries(models.map((model) => [model, context.pipelineRoundId === 'multi-synthesis' ? 'synthesis' : `wave:${model}`]))
    }));
    const runner = MultiRunner.createMultiRunner({
      protocol: { createState: MultiFSM.createState },
      setState,
      transition: (state, event) => {
        if (event.type === 'MULTI_BEGIN_WAVE') MultiFSM.beginWave(state, event.payload.wave);
        if (event.type === 'MULTI_WAVE_COMPLETED') MultiFSM.recordWave(state, event.payload.turns);
        if (event.type === 'MULTI_BEGIN_SYNTHESIS') MultiFSM.beginSynthesis(state);
        if (event.type === 'MULTI_SYNTHESIS_RECORDED') MultiFSM.recordSynthesis(state, event.payload.text);
        if (event.type === 'COMPLETED') MultiFSM.markCompleted(state);
        return state;
      },
      buildWavePrompt: ({ modelName }) => `wave for ${modelName}`,
      buildFinalSynthesisPrompt: () => 'synthesis prompt',
      runModelBatch,
      runRoundFilter: async () => null,
      handleTerminalOutputs: terminal,
      now: () => 1
    });
    await expect(runner.start({
      selectedModels: ['GPT', 'Claude'], synthesizer: 'GPT', pipelineNameText: 'Topic',
      runContext: { pipelineRunId: 'r1', sessionId: 's1' }, presetConfig: { waveLimit: 1 }
    })).resolves.toBe(true);
    expect(setState).toHaveBeenCalled();
    expect(runModelBatch).toHaveBeenCalledTimes(2);
    expect(runModelBatch.mock.calls[0][0].forceNewTabs).toBeFalsy();
    expect(runModelBatch.mock.calls[1][0].forceNewTabs).toBe(false);
    expect(terminal).toHaveBeenCalledWith(expect.objectContaining({ synthesisText: 'synthesis' }), 'multi');
  });

  test('stops after a missing synthesis when continuation is rejected', async () => {
    const runner = MultiRunner.createMultiRunner({
      protocol: { createState: MultiFSM.createState },
      transition: (state, event) => {
        if (event.type === 'MULTI_BEGIN_WAVE') MultiFSM.beginWave(state, event.payload.wave);
        if (event.type === 'MULTI_WAVE_COMPLETED') MultiFSM.recordWave(state, event.payload.turns);
        if (event.type === 'MULTI_BEGIN_SYNTHESIS') MultiFSM.beginSynthesis(state);
        return state;
      },
      buildWavePrompt: () => 'wave',
      buildFinalSynthesisPrompt: () => 'synthesis',
      runModelBatch: async ({ context, models }) => ({ responses: { [models[0]]: context.pipelineRoundId === 'multi-synthesis' ? '' : 'wave' } }),
      runRoundFilter: async () => null,
      resolveParticipantDropout: async () => 'stop'
    });
    await expect(runner.start({
      selectedModels: ['A', 'B'], pipelineNameText: 'T', runContext: { pipelineRunId: 'r' }, presetConfig: { waveLimit: 1 }
    })).resolves.toBe(false);
  });

  test('continues later waves without a dropped participant', async () => {
    let state;
    const resolver = jest.fn().mockResolvedValue('continue');
    const runner = MultiRunner.createMultiRunner({
      protocol: { createState: MultiFSM.createState },
      setState: (current) => { state = current; },
      transition: (current, event) => {
        if (event.type === 'MULTI_BEGIN_WAVE') MultiFSM.beginWave(current, event.payload.wave);
        if (event.type === 'MULTI_WAVE_COMPLETED') MultiFSM.recordWave(current, event.payload.turns);
        if (event.type === 'MULTI_BEGIN_SYNTHESIS') MultiFSM.beginSynthesis(current);
        if (event.type === 'MULTI_SYNTHESIS_RECORDED') MultiFSM.recordSynthesis(current, event.payload.text);
        if (event.type === 'COMPLETED') MultiFSM.markCompleted(current);
        return current;
      },
      buildWavePrompt: ({ modelName }) => `wave:${modelName}`,
      buildFinalSynthesisPrompt: () => 'synth',
      runModelBatch: async ({ context, models }) => {
        if (context.pipelineRoundId === 'multi-synthesis') return { responses: { [models[0]]: 'synthesis' } };
        return { responses: Object.fromEntries(models.filter((model) => model !== 'B').map((model) => [model, `answer:${model}`])) };
      },
      isErrorOutput: () => false,
      resolveParticipantDropout: resolver,
      runRoundFilter: async () => null
    });
    await expect(runner.start({
      selectedModels: ['A', 'B', 'C'], synthesizer: 'A', pipelineNameText: 'T',
      runContext: { pipelineRunId: 'r' }, presetConfig: { waveLimit: 2 }
    })).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ failedModels: ['B'], remainingModels: ['A', 'C'] }));
    expect(state.droppedModels).toEqual(['B']);
    expect(state.models).toEqual(['A', 'C']);
  });

  test('retries the same wave after the dropout dialog returns retry', async () => {
    let waveAttempts = 0;
    const resolver = jest.fn().mockResolvedValueOnce('retry');
    const runModelBatch = jest.fn(async ({ context, models }) => {
      if (context.pipelineRoundId === 'multi-synthesis') return { responses: { [models[0]]: 'synthesis' } };
      waveAttempts += 1;
      const names = waveAttempts === 1 ? models.filter((model) => model !== 'B') : models;
      return { responses: Object.fromEntries(names.map((model) => [model, `answer:${model}`])) };
    });
    const runner = MultiRunner.createMultiRunner({
      protocol: { createState: MultiFSM.createState },
      transition: (state, event) => {
        if (event.type === 'MULTI_BEGIN_WAVE') MultiFSM.beginWave(state, event.payload.wave);
        if (event.type === 'MULTI_WAVE_COMPLETED') MultiFSM.recordWave(state, event.payload.turns);
        if (event.type === 'MULTI_BEGIN_SYNTHESIS') MultiFSM.beginSynthesis(state);
        if (event.type === 'MULTI_SYNTHESIS_RECORDED') MultiFSM.recordSynthesis(state, event.payload.text);
        if (event.type === 'COMPLETED') MultiFSM.markCompleted(state);
        return state;
      },
      buildWavePrompt: ({ modelName }) => `wave:${modelName}`,
      buildFinalSynthesisPrompt: () => 'synth',
      runModelBatch,
      runRoundFilter: async () => null,
      resolveParticipantDropout: resolver
    });
    await expect(runner.start({
      selectedModels: ['A', 'B'], synthesizer: 'A', pipelineNameText: 'T',
      runContext: { pipelineRunId: 'r' }, presetConfig: { waveLimit: 1 }
    })).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ stage: 'wave_1' }));
    expect(waveAttempts).toBe(2);
    expect(runModelBatch).toHaveBeenCalledTimes(3);
  });
});

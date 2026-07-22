const RunServices = require('../disput/debate-run-services');

describe('DebateRunServices', () => {
  test('builds and dispatches a correlated round filter', async () => {
    const runModelBatch = jest.fn().mockResolvedValue({ responses: { GPT: 'usable filter' } });
    const timeline = jest.fn();
    const services = RunServices.createRunServices({
      promptCatalog: { buildRoundFilter: jest.fn().mockReturnValue('filter prompt') },
      runModelBatch,
      timeline,
      now: () => 42
    });
    await expect(services.runRoundFilter({
      topic: 'T', topology: 'triad', round: 2, outputs: ['risks'], turns: [{ text: 'x' }],
      synthesizer: 'GPT', runId: 'run-1', context: { pipelineRunId: 'run-1' }
    })).resolves.toEqual({ round: 2, outputs: ['risks'], text: 'usable filter', synthesizer: 'GPT' });
    expect(runModelBatch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'filter prompt',
      models: ['GPT'],
      context: expect.objectContaining({ pipelineRoundId: 'triad-filter-r2', pipelineBatchId: 'run-1:triad:filter:r2:42' })
    }));
    expect(timeline).toHaveBeenCalledTimes(2);
  });

  test('rejects an unusable filter response', async () => {
    const services = RunServices.createRunServices({
      promptCatalog: { buildRoundFilter: () => 'prompt' },
      runModelBatch: async () => ({ responses: { GPT: 'ERROR' } }),
      isErrorOutput: (text) => text === 'ERROR'
    });
    await expect(services.runRoundFilter({
      topology: 'duel', round: 1, outputs: ['summary'], turns: [{}], synthesizer: 'GPT', runId: 'r'
    })).rejects.toThrow('returned no usable result');
  });

  test('runs terminal outputs once per run', async () => {
    const handleOutputs = jest.fn().mockResolvedValue(undefined);
    const services = RunServices.createRunServices({ handleOutputs });
    await expect(services.handleTerminalOutputs({ runId: 'r1', result: { ok: true } })).resolves.toBe(true);
    await expect(services.handleTerminalOutputs({ runId: 'r1', result: { ok: true } })).resolves.toBe(false);
    expect(handleOutputs).toHaveBeenCalledTimes(1);
  });

  test('routes checkpoint to the selected synthesizer and records a per-wave delta', async () => {
    const registryState = { lastCheckpointId: 'chk-1' };
    const registry = {
      appendEvent: jest.fn(),
      summarizeForCheckpoint: () => '',
      ingestCheckpoint: jest.fn((reg) => { reg.lastCheckpointId = 'chk-2'; return { applied: 1, rejected: 0, actions: 0 }; }),
      computeRoundDelta: jest.fn(() => ({ newClaims: [{}], newObjections: [], revisions: [], counts: { newClaims: 1 }, stagnation: { newContentRatio: 0.5 } }))
    };
    const runModelBatch = jest.fn().mockResolvedValue({ responses: { Synth: '{"ok":true}' } });
    const services = RunServices.createRunServices({
      triadTemplates: { buildTriadCheckpointPrompt: () => 'checkpoint', parseTriadCheckpointOutput: () => ({ ok: true, artifacts: [] }) },
      registry, runModelBatch
    });
    const state = { registry: registryState, synthesizer: 'Synth', roundDeltas: [] };
    await services.runCheckpoint(state, { waveNumber: 2, waveKey: 'w2', turns: [{ model: 'A', text: 'x' }, { model: 'B', text: 'y' }], synthesizer: 'Synth' });
    expect(runModelBatch).toHaveBeenCalledWith(expect.objectContaining({ models: ['Synth'], forceNewTabs: false }));
    expect(registry.computeRoundDelta).toHaveBeenCalledWith(registryState, { sinceCheckpointId: 'chk-1', participantCount: 2 });
    expect(state.roundDeltas).toHaveLength(1);
  });
});

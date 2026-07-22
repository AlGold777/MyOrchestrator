const TriadRunner = require('../disput/triad-runner');
const TriadFSM = require('../disput/triad-runtime');
const fs = require('fs');
const path = require('path');

describe('TriadRunner', () => {
  test('never uses an empty shared prompt for a promptsByModel wave', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'disput', 'triad-runner.js'), 'utf8');
    expect(source).not.toContain("prompt: '',\n          promptsByModel");
    expect(source).toContain('prompt: sanitizedMap[String(models[0]).trim().toUpperCase()]');
  });

  test('completes a wave barrier before dispatching the next wave', async () => {
    const transition = jest.fn();
    const dispatchWave = jest.fn().mockResolvedValue(true);
    const runner = TriadRunner.createTriadRunner({ transition, dispatchWave, hasReachedWaveLimit: () => false });
    const state = { active: true, currentWaveKind: 'wave', currentWaveKey: 'wave-1' };
    await expect(runner.completeBarrier(state)).resolves.toBe(true);
    expect(transition).toHaveBeenNthCalledWith(1, state, { type: 'TRIAD_WAVE_COMPLETED', payload: {} });
    expect(transition).toHaveBeenNthCalledWith(2, state, { type: 'RUNNING', payload: {} });
    expect(dispatchWave).toHaveBeenCalledWith('wave');
  });

  test('stops when mandatory synthesis is unavailable and continuation is rejected', async () => {
    const transition = jest.fn();
    const finalizeRuntime = jest.fn();
    const runner = TriadRunner.createTriadRunner({
      templates: {}, transition, finalizeRuntime, notifyControl: jest.fn(),
      resolveParticipantDropout: async () => 'stop'
    });
    const state = {
      active: true, models: ['A', 'B', 'C'], positions: {}, finalWords: {}, roundFilters: [], synthesizer: 'C'
    };
    await expect(runner.finalize(state)).resolves.toBe(false);
    expect(transition).toHaveBeenCalledWith(state, { type: 'CANCELLED', payload: { reason: 'participant_dropout:final_synthesis' } });
    expect(finalizeRuntime).toHaveBeenCalled();
  });

  test('continues an init wave after one participant drops out', async () => {
    const resolver = jest.fn().mockResolvedValue('continue');
    const runner = TriadRunner.createTriadRunner({
      templates: {
        buildTriadInitPrompt: ({ topic }) => `init:${topic}`,
        buildTriadWavePrompt: () => 'wave'
      },
      fsm: TriadFSM,
      transition: (state, event) => {
        if (event.type === 'TRIAD_INIT_ANSWER') TriadFSM.recordInitAnswer(state, event.payload.model, event.payload.text);
        return state;
      },
      runModelBatch: async () => ({ responses: { A: 'answer A', C: 'answer C' } }),
      isErrorOutput: () => false,
      resolveParticipantDropout: resolver,
      runRoundFilter: async () => null,
      sanitizePromptsByModel: (prompts) => prompts,
      syncState: jest.fn()
    });
    const state = TriadFSM.createState({
      active: true, models: ['A', 'B', 'C'], topic: 'T', presetConfigSnapshot: {},
      roundFilters: [], autoMode: false, role: '', currentWaveKind: ''
    });
    TriadFSM.beginInitWave(state);
    await expect(runner.dispatchWave(state, 'init', { auto: false })).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ failedModels: ['B'], remainingModels: ['A', 'C'] }));
    expect(state.models).toEqual(['A', 'C']);
    expect(state.phase).toBe(TriadFSM.PHASES.PUBLIC);
  });

  test('retries the same wave after the dropout dialog returns retry', async () => {
    let attempts = 0;
    const resolver = jest.fn().mockResolvedValueOnce('retry');
    const runner = TriadRunner.createTriadRunner({
      templates: {
        buildTriadWavePrompt: () => 'wave'
      },
      transition: jest.fn(),
      runModelBatch: async () => {
        attempts += 1;
        return { responses: attempts === 1 ? { A: 'a', C: 'c' } : { A: 'a', B: 'b', C: 'c' } };
      },
      acceptResponse: (text) => ({ ok: Boolean(text), reason: '' }),
      resolveParticipantDropout: resolver,
      sanitizePromptsByModel: (prompts) => prompts,
      runRoundFilter: async () => null,
      hasReachedWaveLimit: () => true
    });
    const state = TriadFSM.createState({
      active: true, models: ['A', 'B', 'C'], topic: 'T', wave: 1,
      positions: { A: 'old A', B: 'old B', C: 'old C' }, responsesByWave: [],
      presetConfigSnapshot: {}, roundFilters: [], autoMode: false
    });
    await expect(runner.dispatchWave(state, 'wave', { auto: false })).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ stage: 'wave_2' }));
    expect(attempts).toBe(2);
  });
});

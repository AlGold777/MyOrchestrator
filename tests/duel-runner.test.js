const DuelRunner = require('../disput/duel-runner');
const DebateFSM = require('../disput/debate-runtime');
const DebateProtocols = require('../disput/debate-protocols');

const makeState = () => ({
  active: true,
  runId: 'run-1',
  modelA: 'GPT',
  modelB: 'Claude',
  synthesizer: 'GPT'
});

describe('DuelRunner finalization', () => {
  test('collects final words and completes only after mandatory synthesis', async () => {
    const transition = jest.fn();
    const terminal = jest.fn();
    const runModelBatch = jest.fn(({ context, models }) => Promise.resolve({
      responses: { [models[0]]: context.pipelineRoundId === 'duel-final-synthesis' ? 'synthesis' : `final ${models[0]}` }
    }));
    const runner = DuelRunner.createDuelRunner({
      runModelBatch,
      buildFinalWordPrompt: (_, model) => `final for ${model}`,
      buildFinalSynthesisPrompt: () => 'synth prompt',
      transition,
      handleTerminalOutputs: terminal,
      getRoundLimit: () => 3,
      now: () => 10
    });
    const state = makeState();
    await expect(runner.requestFinalWords(state)).resolves.toBe(true);
    expect(state).toMatchObject({ finalWordA: 'final GPT', finalWordB: 'final Claude', synthesisText: 'synthesis' });
    expect(transition).toHaveBeenLastCalledWith(state, { type: 'COMPLETED', payload: { reason: 'final_synthesis_completed' } });
    expect(terminal).toHaveBeenCalledWith(state, 'duel');
  });

  test('stops when the user rejects continuation after a missing final response', async () => {
    const transition = jest.fn();
    const notifyControl = jest.fn();
    const runner = DuelRunner.createDuelRunner({
      runModelBatch: async ({ models }) => ({ responses: { [models[0]]: '' } }),
      buildFinalWordPrompt: () => 'final prompt',
      buildFinalSynthesisPrompt: () => 'synth prompt',
      transition,
      notifyControl,
      resolveParticipantDropout: async () => 'stop'
    });
    const state = makeState();
    await expect(runner.requestFinalWords(state)).resolves.toBe(false);
    expect(transition).toHaveBeenCalledWith(state, { type: 'CANCELLED', payload: { reason: 'participant_dropout:final_words' } });
    expect(notifyControl).toHaveBeenCalledWith('CANCELLED', expect.any(Object));
  });

  test('retries the failed final-word stage when the user selects retry', async () => {
    const resolver = jest.fn().mockResolvedValueOnce('retry');
    let finalWordAttempt = 0;
    const runner = DuelRunner.createDuelRunner({
      runModelBatch: async ({ context, models }) => {
        if (context.pipelineRoundId === 'duel-final-synthesis') return { responses: { [models[0]]: 'synthesis' } };
        if (context.pipelineRoundId === 'final') {
          finalWordAttempt += 1;
          return { responses: { [models[0]]: finalWordAttempt === 1 && models[0] === 'GPT' ? '' : `final ${models[0]}` } };
        }
        return { responses: { [models[0]]: 'answer' } };
      },
      buildFinalWordPrompt: () => 'final prompt',
      buildFinalSynthesisPrompt: () => 'synth prompt',
      resolveParticipantDropout: resolver,
      transition: jest.fn(),
      handleTerminalOutputs: jest.fn()
    });
    const state = makeState();
    await expect(runner.requestFinalWords(state)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ stage: 'final_words' }));
    expect(state.finalWordA).toBe('final GPT');
    expect(state.finalWordB).toBe('final Claude');
  });

  test('continues an opening without a dropped model and finalizes with the survivor', async () => {
    const protocol = DebateProtocols.getProtocol('duel');
    let state;
    const resolver = jest.fn().mockResolvedValue('continue');
    const runner = DuelRunner.createDuelRunner({
      protocol,
      fsm: DebateFSM,
      transition: (current, event) => protocol.reduce(current, event),
      replaceAggregateState: (current) => { state = current; },
      setState: (current) => { state = current; },
      getState: () => state,
      buildInitAPrompt: () => 'A init',
      buildInitBPrompt: () => 'B init',
      buildFinalWordPrompt: () => 'final',
      buildFinalSynthesisPrompt: () => 'synthesis prompt',
      resolveParticipantDropout: resolver,
      runModelBatch: async ({ context, models }) => {
        if (context.pipelineRoundId === 'duel-final-synthesis') return { responses: { [models[0]]: 'survivor synthesis' } };
        if (context.pipelineRoundId === 'final') return { responses: { [models[0]]: 'survivor final word' } };
        return { responses: { GPT: 'GPT opening' } };
      },
      isErrorOutput: () => false,
      handleTerminalOutputs: jest.fn(),
      notifyControl: jest.fn(),
      now: () => 10
    });
    await expect(runner.start({
      scenario: { ok: true, modelA: 'GPT', modelB: 'Perplexity', roleA: 'A', roleB: 'B' },
      synthesizer: 'GPT',
      pipelineNameText: 'Topic', runContext: { pipelineRunId: 'r', sessionId: 's' },
      presetConfig: { topology: 'duel', turnLimit: 3 }, executionPlan: { runPolicy: 'auto' }
    })).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ failedModels: ['Perplexity'], remainingModels: ['GPT'] }));
    expect(state).toMatchObject({ modelA: 'GPT', modelB: '', synthesisText: 'survivor synthesis', status: 'completed' });
  });

  test('does not silently replace an unavailable external synthesizer', async () => {
    const resolver = jest.fn().mockResolvedValue('continue');
    const runner = DuelRunner.createDuelRunner({
      runModelBatch: async ({ context, models }) => ({
        responses: {
          [models[0]]: context.pipelineRoundId === 'duel-final-synthesis'
            ? (models[0] === 'Judge' ? '' : 'fallback synthesis')
            : `final ${models[0]}`
        }
      }),
      buildFinalWordPrompt: (_, model) => `final for ${model}`,
      buildFinalSynthesisPrompt: () => 'synth prompt',
      resolveParticipantDropout: resolver,
      transition: jest.fn(),
      notifyControl: jest.fn(),
      handleTerminalOutputs: jest.fn(),
      recordFinalization: jest.fn(),
      now: () => 10
    });
    const state = { ...makeState(), synthesizer: 'Judge' };
    await expect(runner.requestFinalWords(state)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      failedModels: ['Judge'],
      remainingModels: ['GPT', 'Claude']
    }));
    expect(state).toMatchObject({
      modelA: 'GPT',
      modelB: 'Claude',
      synthesizer: '',
      droppedModels: ['Judge']
    });
  });

  test('AbortError bypasses retry and participant-dropout handling', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    const runModelBatch = jest.fn().mockRejectedValue(abort);
    const resolver = jest.fn();
    const runner = DuelRunner.createDuelRunner({
      runModelBatch,
      resolveParticipantDropout: resolver,
      autoRetryLimit: 3,
      transition: jest.fn()
    });
    const state = { ...makeState(), autoMode: true, round: 1, turns: { publicTurnsDispatched: 0 } };

    await expect(runner.runTurnWithRetry({ state, targetModel: 'Claude', prompt: 'next' })).rejects.toBe(abort);
    expect(runModelBatch).toHaveBeenCalledTimes(1);
    expect(resolver).not.toHaveBeenCalled();
  });

  test('AbortError from a routed turn is propagated instead of becoming dropout', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    const resolver = jest.fn();
    const state = {
      ...makeState(),
      autoMode: true,
      round: 1,
      waitingApprovalModel: 'GPT',
      turns: { publicTurnsDispatched: 0 },
      publicTurnsDispatched: 0,
      roundFilters: []
    };
    const runner = DuelRunner.createDuelRunner({
      getState: () => state,
      fsm: {
        canRoutePublic: () => true,
        hasReachedTurnLimit: () => false
      },
      prepareRoute: () => ({ targetModel: 'Claude', prompt: 'route', targetIsA: false, protocolRound: 1, contextParts: [] }),
      runModelBatch: jest.fn().mockRejectedValue(abort),
      resolveParticipantDropout: resolver,
      transition: jest.fn(),
      recordRoute: jest.fn(),
      renderCards: jest.fn(),
      syncVisualState: jest.fn()
    });

    await expect(runner.routeApprovedTurn({ llmName: 'GPT', text: 'approved' })).rejects.toBe(abort);
    expect(resolver).not.toHaveBeenCalled();
  });
});

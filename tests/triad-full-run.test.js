const TriadFSM = require('../disput/triad-runtime');
globalThis.TriadFSM = TriadFSM;
globalThis.DebateFSM = { createState: () => ({}) };
globalThis.MultiFSM = { createState: () => ({}) };
const templates = require('../disput/triad-massage');
const Protocols = require('../disput/debate-protocols');
const TriadRunner = require('../disput/triad-runner');

describe('Triad full run honours the canonical round count', () => {
  test('Triad Red Team dispatches four waves and one final synthesis', async () => {
    const protocol = Protocols.getProtocol('triad');
    const waveStageIds = [];
    const filterSynthesizers = [];
    const finalSynthesizers = [];
    let synthesisDispatches = 0;
    let currentState = null;
    const runner = TriadRunner.createTriadRunner({
      protocol,
      fsm: TriadFSM,
      templates,
      getDefaultFormat: () => 'free',
      getRoundOutputs: () => [],
      transition: (state, event) => protocol.reduce(state, event),
      runModelBatch: async ({ models, context }) => {
        const stageId = String(context?.pipelineStageId || '');
        if (stageId === 'final:synthesis') synthesisDispatches += 1;
        if (stageId === 'final:synthesis') finalSynthesizers.push(...models);
        else if (stageId.endsWith(':wave')) waveStageIds.push(stageId);
        return { responses: Object.fromEntries(models.map((model) => [model, `${stageId} answer from ${model}`])) };
      },
      isErrorOutput: () => false,
      sanitizePromptsByModel: (prompts) => Object.fromEntries(Object.entries(prompts).map(([key, value]) => [String(key).trim().toUpperCase(), value])),
      formatRoundFilters: () => '',
      makeBatchContext: () => ({}),
      makeTurnId: (waveKey, model) => `${waveKey}:${model}`,
      renderCards: () => {}, tagWaveCards: () => {}, markWaveCardsApproved: () => {},
      appendFeed: () => {}, appendVerdict: () => {}, appendModerator: () => {}, clearModerator: () => {},
      clearTimeline: () => {}, timeline: () => {}, notify: () => {}, notifyControl: async () => {},
      recordStageEvent: () => {}, handleTerminalOutputs: async () => {}, finalizeRuntime: () => {},
      syncVisualState: () => {}, syncState: () => {}, updateButtons: () => {}, setRunPresentation: () => {},
      replaceAggregateState: (state) => { currentState = state; },
      setState: (state) => { currentState = state; },
      hasReachedWaveLimit: (state) => TriadFSM.hasReachedWaveLimit(state),
      runRoundFilter: async ({ synthesizer }) => { filterSynthesizers.push(synthesizer); return null; },
      runCheckpoint: async () => {},
      getModeratorText: () => ''
    });

    await runner.start({
      selectedModels: ['GPT', 'Claude', 'Grok'],
      presetConfig: { presetId: 'TRIAD_STANDARD', topology: 'triad', waveLimit: 4, checkpointPolicy: { enabled: false } },
      runContext: { pipelineRunId: 'triad-red-team', sessionId: '1' },
      pipelineNameText: 'Topic', synthesizer: 'Judge', auto: true,
      moderatorEntryText: '', attachmentsPayload: []
    });

    expect(currentState?.status).toBe('completed');
    expect(waveStageIds).toEqual(['r1:wave', 'r2:wave', 'r3:wave', 'r4:wave']);
    expect(synthesisDispatches).toBe(1);
    expect(filterSynthesizers).toEqual(['Judge', 'Judge', 'Judge', 'Judge']);
    expect(finalSynthesizers).toEqual(['Judge']);
    expect(currentState?.synthesizer).toBe('Judge');
  });
});

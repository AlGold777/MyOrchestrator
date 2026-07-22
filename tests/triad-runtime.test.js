const TriadFSM = require('../disput/triad-runtime');

describe('TriadFSM — explicit 3-model wave state machine', () => {
  test('exposes a frozen pure API', () => {
    expect(Object.isFrozen(TriadFSM)).toBe(true);
    expect(TriadFSM.PHASES).toEqual({ INIT: 'init', PUBLIC: 'public', FINAL: 'final' });
    expect(TriadFSM.PARTICIPANT_COUNT).toBe(3);
  });

  describe('createState', () => {
    test('produces the canonical shape with fresh Sets', () => {
      const s = TriadFSM.createState();
      expect(s.active).toBe(false);
      expect(s.sessionId).toBe('1');
      expect(s.phase).toBe('init');
      expect(s.wave).toBe(0);
      expect(s.maxWaves).toBe(3);
      expect(s.models).toEqual([]);
      expect(s.positions).toEqual({});
      expect(s.initTexts).toEqual({});
      expect(s.finalWords).toEqual({});
      expect(s.newPagesOpenedModels).toBeInstanceOf(Set);
      expect(s.routedTurnIds).toBeInstanceOf(Set);
    });

    test('Sets are not shared between instances', () => {
      const a = TriadFSM.createState();
      const b = TriadFSM.createState();
      a.newPagesOpenedModels.add('GPT');
      a.routedTurnIds.add('turn-1');
      expect(b.newPagesOpenedModels.size).toBe(0);
      expect(b.routedTurnIds.size).toBe(0);
    });

    test('applies overrides', () => {
      const s = TriadFSM.createState({ active: true, models: ['GPT', 'Claude', 'Gemini'], maxWaves: 1 });
      expect(s.active).toBe(true);
      expect(s.models).toEqual(['GPT', 'Claude', 'Gemini']);
      expect(s.maxWaves).toBe(1);
    });
  });

  describe('init wave gate', () => {
    const state = () => TriadFSM.createState({ models: ['GPT', 'Claude', 'Gemini'] });

    test('does not route public waves until all three init answers are captured', () => {
      const s = state();
      TriadFSM.recordInitAnswer(s, 'GPT', 'A');
      TriadFSM.recordInitAnswer(s, 'Claude', 'B');
      expect(s.phase).toBe('init');
      expect(TriadFSM.canRouteWave(s)).toBe(false);

      TriadFSM.recordInitAnswer(s, 'Gemini', 'C');
      expect(s.phase).toBe('public');
      expect(TriadFSM.canRouteWave(s)).toBe(true);
      expect(TriadFSM.allInitCaptured(s)).toBe(true);
    });

    test('blank init text is not captured as usable', () => {
      const s = state();
      TriadFSM.recordInitAnswer(s, 'GPT', 'A');
      TriadFSM.recordInitAnswer(s, 'Claude', '   ');
      TriadFSM.recordInitAnswer(s, 'Gemini', 'C');
      expect(s.phase).toBe('init');
      expect(TriadFSM.allInitCaptured(s)).toBe(false);
    });

    test('beginInitWave resets positions and wave counter', () => {
      const s = TriadFSM.createState({
        phase: 'public',
        wave: 2,
        positions: { GPT: 'old' },
        initTexts: { GPT: 'old' }
      });
      TriadFSM.beginInitWave(s);
      expect(s.phase).toBe('init');
      expect(s.wave).toBe(0);
      expect(s.positions).toEqual({});
      expect(s.initTexts).toEqual({});
    });
  });

  test('recordWaveAnswer does not overwrite a position with blank text', () => {
    const s = TriadFSM.createState({ positions: { GPT: 'previous' } });
    TriadFSM.recordWaveAnswer(s, 'GPT', '   ');
    expect(s.positions.GPT).toBe('previous');
    TriadFSM.recordWaveAnswer(s, 'GPT', 'updated');
    expect(s.positions.GPT).toBe('updated');
  });

  test('keeps an external synthesizer when public participants are reduced', () => {
    const external = TriadFSM.createState({
      models: ['A', 'B', 'C'],
      synthesizer: 'Judge'
    });
    TriadFSM.retainParticipants(external, ['A', 'C']);
    expect(external.synthesizer).toBe('Judge');

    const participantSynth = TriadFSM.createState({
      models: ['A', 'B', 'C'],
      synthesizer: 'B'
    });
    TriadFSM.retainParticipants(participantSynth, ['A', 'C']);
    expect(participantSynth.synthesizer).toBe('A');
  });

  test('opponentsFor returns other models in participant order and skips blank positions', () => {
    const s = TriadFSM.createState({
      models: ['GPT', 'Claude', 'Gemini'],
      positions: {
        GPT: 'gpt position',
        Claude: '',
        Gemini: 'gemini position'
      }
    });
    expect(TriadFSM.opponentsFor(s, 'GPT')).toEqual([
      { model: 'Gemini', text: 'gemini position', wave: 0, stale: false }
    ]);
    expect(TriadFSM.opponentsFor(s, 'Gemini')).toEqual([
      { model: 'GPT', text: 'gpt position', wave: 0, stale: false }
    ]);
  });

  test('usablePositions returns nonblank positions in participant order', () => {
    const s = TriadFSM.createState({
      models: ['GPT', 'Claude', 'Gemini'],
      positions: { GPT: 'A', Claude: ' ', Gemini: 'C' }
    });
    expect(TriadFSM.usablePositions(s)).toEqual([
      { model: 'GPT', text: 'A', wave: 0, stale: false },
      { model: 'Gemini', text: 'C', wave: 0, stale: false }
    ]);
  });

  test('completeWave, hasReachedWaveLimit, and shouldAutoContinue enforce wave limits', () => {
    const s = TriadFSM.createState({ active: true, wave: 0, maxWaves: 1, waitingWaveApproval: true });
    expect(TriadFSM.hasReachedWaveLimit(s)).toBe(false);
    expect(TriadFSM.shouldAutoContinue(s, { auto: true })).toBe(true);
    expect(TriadFSM.shouldAutoContinue(s, { auto: false })).toBe(false);

    TriadFSM.completeWave(s);
    expect(s.wave).toBe(1);
    expect(s.waitingWaveApproval).toBe(false);
    expect(TriadFSM.hasReachedWaveLimit(s)).toBe(true);
    expect(TriadFSM.shouldAutoContinue(s, { auto: true })).toBe(false);

    s.active = false;
    s.wave = 0;
    expect(TriadFSM.shouldAutoContinue(s, { auto: true })).toBe(false);
  });

  test('run-status lifecycle transitions', () => {
    const live = TriadFSM.createState({ active: true });
    TriadFSM.markRunning(live);
    expect(live.status).toBe('running');
    expect(live.active).toBe(true);
    TriadFSM.markPaused(live);
    expect(live.status).toBe('paused');
    expect(live.active).toBe(true);

    for (const [fn, status] of [['markCompleted', 'completed'], ['markError', 'error'], ['markCancelled', 'cancelled']]) {
      const s = TriadFSM.createState({ active: true, status: 'running' });
      TriadFSM[fn](s);
      expect(s.active).toBe(false);
      expect(s.status).toBe(status);
    }
  });

  describe('stale position tracking', () => {
    const makePublicState = () => {
      const s = TriadFSM.createState({ models: ['GPT', 'Claude', 'Gemini'] });
      TriadFSM.beginInitWave(s);
      TriadFSM.recordInitAnswer(s, 'GPT', 'init-gpt');
      TriadFSM.recordInitAnswer(s, 'Claude', 'init-claude');
      TriadFSM.recordInitAnswer(s, 'Gemini', 'init-gemini');
      return s;
    };

    test('init positions carry wave 0 and are not stale before the first wave', () => {
      const s = makePublicState();
      expect(TriadFSM.positionWaveFor(s, 'GPT')).toBe(0);
      expect(TriadFSM.isPositionStale(s, 'GPT')).toBe(false);
      expect(TriadFSM.opponentsFor(s, 'GPT').every((entry) => entry.stale === false)).toBe(true);
    });

    test('silent model in a completed wave is flagged stale, responders are not', () => {
      const s = makePublicState();
      TriadFSM.recordWaveAnswer(s, 'GPT', 'wave1-gpt', 1);
      TriadFSM.recordWaveAnswer(s, 'Claude', 'wave1-claude', 1);
      // Gemini stays silent in wave 1.
      TriadFSM.completeWave(s);

      const opponents = TriadFSM.opponentsFor(s, 'GPT');
      const gemini = opponents.find((entry) => entry.model === 'Gemini');
      const claude = opponents.find((entry) => entry.model === 'Claude');
      expect(gemini.stale).toBe(true);
      expect(gemini.wave).toBe(0);
      expect(gemini.text).toBe('init-gemini');
      expect(claude.stale).toBe(false);
      expect(claude.wave).toBe(1);

      const usable = TriadFSM.usablePositions(s);
      expect(usable.find((entry) => entry.model === 'Gemini').stale).toBe(true);
    });

    test('stale flag clears once the model answers again', () => {
      const s = makePublicState();
      TriadFSM.recordWaveAnswer(s, 'GPT', 'wave1-gpt', 1);
      TriadFSM.recordWaveAnswer(s, 'Claude', 'wave1-claude', 1);
      TriadFSM.completeWave(s);
      expect(TriadFSM.isPositionStale(s, 'Gemini')).toBe(true);

      TriadFSM.recordWaveAnswer(s, 'Gemini', 'wave2-gemini', 2);
      TriadFSM.recordWaveAnswer(s, 'GPT', 'wave2-gpt', 2);
      TriadFSM.recordWaveAnswer(s, 'Claude', 'wave2-claude', 2);
      TriadFSM.completeWave(s);
      expect(TriadFSM.isPositionStale(s, 'Gemini')).toBe(false);
      expect(TriadFSM.positionWaveFor(s, 'Gemini')).toBe(2);
    });

    test('recordWaveAnswer without explicit wave defaults to the wave in flight', () => {
      const s = makePublicState();
      TriadFSM.recordWaveAnswer(s, 'GPT', 'wave1-gpt');
      expect(TriadFSM.positionWaveFor(s, 'GPT')).toBe(1);
    });

    test('empty answer does not overwrite position or its wave', () => {
      const s = makePublicState();
      TriadFSM.recordWaveAnswer(s, 'GPT', '   ', 1);
      expect(s.positions.GPT).toBe('init-gpt');
      expect(TriadFSM.positionWaveFor(s, 'GPT')).toBe(0);
    });
  });
});

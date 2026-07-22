const DebateFSM = require('../disput/debate-runtime');

describe('DebateFSM — explicit serial debate state machine', () => {
  test('exposes a frozen pure API', () => {
    expect(Object.isFrozen(DebateFSM)).toBe(true);
    expect(DebateFSM.PHASES).toEqual({ INIT: 'init', PUBLIC: 'public' });
    expect(DebateFSM.SPEAKERS).toEqual({ A: 'A', B: 'B' });
  });

  describe('createState', () => {
    test('produces the canonical shape with fresh Sets', () => {
      const s = DebateFSM.createState();
      expect(s.active).toBe(false);
      expect(s.sessionId).toBe('1');
      expect(s.phase).toBe('init');
      expect(s.currentSpeaker).toBe('A');
      expect(s.nextTarget).toBe('B');
      expect(s.round).toBe(1);
      expect(s.turnLimit).toBe(3);
      expect(s.dispatchedTurns).toBe(0);
      expect(s.participants.A).toMatchObject({ slot: 'A', model: '', role: '' });
      expect(s.turns).toMatchObject({
        openingTurnsDispatched: 0,
        publicTurnsDispatched: 0,
        publicRound: 1,
        publicTurnLimit: 3
      });
      expect(s.eventLog).toEqual([]);
      expect(s.newPagesOpenedModels).toBeInstanceOf(Set);
    });

    test('Sets are not shared between instances', () => {
      const a = DebateFSM.createState();
      const b = DebateFSM.createState();
      a.newPagesOpenedModels.add('GPT');
      expect(b.newPagesOpenedModels.size).toBe(0);
    });

    test('applies overrides', () => {
      const s = DebateFSM.createState({ modelA: 'GPT', modelB: 'Claude', active: true });
      expect(s.modelA).toBe('GPT');
      expect(s.modelB).toBe('Claude');
      expect(s.active).toBe(true);
    });
  });

  describe('A0/B0 phase gate', () => {
    test('no public turn routes until both openings are captured', () => {
      const s = DebateFSM.createState();
      expect(DebateFSM.canRoutePublic(s)).toBe(false); // init

      DebateFSM.recordOpeningA(s, 'A opening');
      expect(s.openingStatementA).toBe('A opening');
      expect(s.phase).toBe('init');
      expect(DebateFSM.canRoutePublic(s)).toBe(false); // only A captured

      DebateFSM.recordOpeningB(s, 'B opening');
      expect(s.openingStatementB).toBe('B opening');
      expect(s.phase).toBe('public');
      expect(DebateFSM.canRoutePublic(s)).toBe(true); // both captured
    });

    test('recordOpeningB alone does not enter PUBLIC', () => {
      const s = DebateFSM.createState();
      DebateFSM.recordOpeningB(s, 'B opening');
      expect(s.openingStatementB).toBe('B opening');
      expect(s.phase).toBe('init');
      expect(DebateFSM.canRoutePublic(s)).toBe(false);
    });

    test('recordOpeningA alone does not enter PUBLIC', () => {
      const s = DebateFSM.createState();
      DebateFSM.recordOpeningA(s, 'A opening');
      expect(s.phase).toBe('init');
      expect(DebateFSM.allOpeningsCaptured(s)).toBe(false);
    });

    test('beginOpenings resets the gate', () => {
      const s = DebateFSM.createState({
        phase: 'public',
        openingStatementA: 'x',
        openingStatementB: 'y',
        firstPublicBTurnDispatched: true
      });
      DebateFSM.beginOpenings(s);
      expect(s.phase).toBe('init');
      expect(s.openingStatementA).toBe('');
      expect(s.openingStatementB).toBe('');
      expect(s.firstPublicBTurnDispatched).toBe(false);
      expect(s.turns.publicTurnsDispatched).toBe(0);
      expect(DebateFSM.canRoutePublic(s)).toBe(false);
    });

    test('canRoutePublic is null-safe', () => {
      expect(DebateFSM.canRoutePublic(null)).toBe(false);
      expect(DebateFSM.canRoutePublic(undefined)).toBe(false);
    });
  });

  describe('participant dropout', () => {
    test('promotes a surviving B participant without silently replacing a dropped synthesizer', () => {
      const state = DebateFSM.createState({
        modelA: 'GPT', modelB: 'Claude', roleA: 'pro', roleB: 'con',
        openingStatementA: 'A0', openingStatementB: 'B0',
        finalWordA: 'AF', finalWordB: 'BF', synthesizer: 'GPT',
        waitingApprovalModel: 'Claude', pendingAutoContinuation: { llmName: 'Claude' }
      });
      DebateFSM.retainParticipant(state, 'Claude');
      expect(state).toMatchObject({
        modelA: 'Claude', modelB: '', roleA: 'con', roleB: '',
        openingStatementA: 'B0', openingStatementB: '',
        finalWordA: 'BF', finalWordB: '', synthesizer: '',
        waitingApprovalModel: '', pendingAutoContinuation: null,
        droppedModels: ['GPT']
      });
      expect(state.participants.A).toMatchObject({ slot: 'A', model: 'Claude', role: 'con' });
    });

    test('keeps a healthy external synthesizer when the other participant drops', () => {
      const state = DebateFSM.createState({ modelA: 'GPT', modelB: 'Claude', synthesizer: 'Judge' });
      DebateFSM.retainParticipant(state, 'GPT');
      expect(state.synthesizer).toBe('Judge');
      expect(state.droppedModels).toEqual(['Claude']);
    });
  });

  describe('applyApprovedRoutingTargets (A/B routing)', () => {
    const base = () => DebateFSM.createState({ modelA: 'GPT', modelB: 'Claude', waitingApprovalModel: 'GPT' });

    test('routing GPT -> Claude (A speaks, B is target)', () => {
      const s = base();
      DebateFSM.applyApprovedRoutingTargets(s, { llmName: 'GPT', targetModel: 'Claude' });
      // target is B -> firstPublicBTurnDispatched flips true
      expect(s.firstPublicBTurnDispatched).toBe(true);
      expect(s.waitingApprovalModel).toBe('');
      expect(s.currentSpeaker).toBe('B'); // target Claude == B
      expect(s.nextTarget).toBe('B');     // llmName GPT == A -> next 'B'
      expect(s.turns.publicTurnsDispatched).toBe(1);
      expect(s.turns.publicRound).toBe(1);
    });

    test('routing Claude -> GPT (target is A, B flag untouched)', () => {
      const s = DebateFSM.createState({ modelA: 'GPT', modelB: 'Claude', firstPublicBTurnDispatched: false });
      DebateFSM.applyApprovedRoutingTargets(s, { llmName: 'Claude', targetModel: 'GPT' });
      expect(s.firstPublicBTurnDispatched).toBe(false); // target is A
      expect(s.currentSpeaker).toBe('A'); // target GPT == A
      expect(s.nextTarget).toBe('A');     // llmName Claude != A -> 'A'
    });

    test('manual routing target selection does not mutate participants', () => {
      const s = DebateFSM.createState({ modelA: 'GPT', modelB: 'Claude', roleA: 'A role', roleB: 'B role' });
      const before = JSON.parse(JSON.stringify(s.participants));
      DebateFSM.applyApprovedRoutingTargets(s, { llmName: 'GPT', targetModel: 'Gemini' });
      expect(s.participants).toEqual(before);
      expect(s.modelA).toBe('GPT');
      expect(s.modelB).toBe('Claude');
    });
  });

  describe('run-status lifecycle transitions', () => {
    test('markRunning / markPaused keep the run live', () => {
      const s = DebateFSM.createState({ active: true });
      DebateFSM.markRunning(s);
      expect(s.status).toBe('running');
      expect(s.active).toBe(true);
      DebateFSM.markPaused(s);
      expect(s.status).toBe('paused');
      expect(s.active).toBe(true);
    });

    test('terminal transitions clear active', () => {
      for (const [fn, status] of [['markCompleted', 'completed'], ['markError', 'error'], ['markCancelled', 'cancelled']]) {
        const s = DebateFSM.createState({ active: true, status: 'running' });
        DebateFSM[fn](s);
        expect(s.active).toBe(false);
        expect(s.status).toBe(status);
      }
    });

    test('transitions are null-safe', () => {
      expect(() => DebateFSM.markError(null)).not.toThrow();
      expect(() => DebateFSM.markCompleted(undefined)).not.toThrow();
    });

    test('STATUSES enum is exposed', () => {
      expect(DebateFSM.STATUSES).toMatchObject({
        RUNNING: 'running',
        PAUSED: 'paused',
        PAUSED_BY_MODERATOR: 'paused_by_moderator',
        STOPPED_BY_MODERATOR: 'stopped_by_moderator',
        FINALIZATION_PENDING: 'finalization_pending',
        TECHNICAL_PAUSE: 'technical_pause',
        COMPLETED: 'completed',
        ERROR: 'error',
        CANCELLED: 'cancelled'
      });
    });
  });

  describe('computeRound (parity with the old inline formula)', () => {
    test('two turns per round, 1-based, capped at max', () => {
      const max = 6;
      expect(DebateFSM.computeRound(1, max)).toBe(1);
      expect(DebateFSM.computeRound(2, max)).toBe(1);
      expect(DebateFSM.computeRound(3, max)).toBe(2);
      expect(DebateFSM.computeRound(4, max)).toBe(2);
      expect(DebateFSM.computeRound(5, max)).toBe(3);
      // capped
      expect(DebateFSM.computeRound(999, max)).toBe(max);
      // floored at 1
      expect(DebateFSM.computeRound(0, max)).toBe(1);
    });
  });

  describe('turn-progression guards', () => {
    test('hasReachedTurnLimit', () => {
      expect(DebateFSM.hasReachedTurnLimit(DebateFSM.createState({ turns: { publicTurnsDispatched: 5, publicTurnLimit: 6 } }), 6)).toBe(false);
      expect(DebateFSM.hasReachedTurnLimit(DebateFSM.createState({ turns: { publicTurnsDispatched: 6, publicTurnLimit: 6 } }), 6)).toBe(true);
      expect(DebateFSM.hasReachedTurnLimit(DebateFSM.createState({ turns: { publicTurnsDispatched: 7, publicTurnLimit: 6 } }), 6)).toBe(true);
      expect(DebateFSM.hasReachedTurnLimit(null, 6)).toBe(false);
    });

    test('null publicTurnLimit remains open-ended', () => {
      const state = DebateFSM.createState({
        turnLimit: null,
        turns: { openingTurnsDispatched: 2, publicTurnsDispatched: 0, publicTurnLimit: null }
      });
      expect(state.turns.publicTurnLimit).toBeNull();
      expect(DebateFSM.hasReachedTurnLimit(state)).toBe(false);
      expect(DebateFSM.shouldAutoContinue(state, { auto: true })).toBe(true);
    });

    test('shouldAutoContinue requires auto AND turns under the cap', () => {
      const s = DebateFSM.createState({ turns: { publicTurnsDispatched: 2, publicTurnLimit: 6 } });
      expect(DebateFSM.shouldAutoContinue(s, { auto: true, maxTurns: 6 })).toBe(true);
      expect(DebateFSM.shouldAutoContinue(s, { auto: false, maxTurns: 6 })).toBe(false);
      const atCap = DebateFSM.createState({ turns: { publicTurnsDispatched: 6, publicTurnLimit: 6 } });
      expect(DebateFSM.shouldAutoContinue(atCap, { auto: true, maxTurns: 6 })).toBe(false);
      expect(DebateFSM.shouldAutoContinue(null, { auto: true, maxTurns: 6 })).toBe(false);
    });

    test('public turn accounting excludes A0/B0 and computes publicRound', () => {
      const s = DebateFSM.createState({ turnLimit: 6 });
      DebateFSM.recordOpeningA(s, 'A0');
      DebateFSM.recordOpeningB(s, 'B0');
      expect(s.turns.openingTurnsDispatched).toBe(2);
      expect(s.turns.publicTurnsDispatched).toBe(0);
      DebateFSM.incrementPublicTurn(s);
      expect(s.turns.publicTurnsDispatched).toBe(1);
      expect(s.turns.publicRound).toBe(1);
      DebateFSM.incrementPublicTurn(s);
      expect(s.turns.publicTurnsDispatched).toBe(2);
      expect(s.turns.publicRound).toBe(1);
      DebateFSM.incrementPublicTurn(s);
      expect(s.turns.publicRound).toBe(2);
    });
  });

  describe('event log', () => {
    test('appendEvent stores immutable turn ids', () => {
      const s = DebateFSM.createState();
      DebateFSM.appendEvent(s, { turnId: 't1', phase: 'opening', slot: 'A', model: 'GPT', text: 'first' });
      DebateFSM.appendEvent(s, { turnId: 't1', phase: 'opening', slot: 'A', model: 'GPT', text: 'second' });
      expect(s.eventLog).toHaveLength(1);
      expect(s.eventLog[0]).toMatchObject({ turnId: 't1', seq: 1, text: 'first' });
    });
  });

  describe('pure mappers (parity with the old results.js helpers)', () => {
    test('mapMessageStatusToTurnStatus', () => {
      expect(DebateFSM.mapMessageStatusToTurnStatus({ kind: 'moderator' })).toBe('approved');
      expect(DebateFSM.mapMessageStatusToTurnStatus({ status: 'printing' })).toBe('streaming');
      expect(DebateFSM.mapMessageStatusToTurnStatus({ status: 'approved' })).toBe('approved');
      expect(DebateFSM.mapMessageStatusToTurnStatus({ status: 'rejected' })).toBe('rejected');
      expect(DebateFSM.mapMessageStatusToTurnStatus({ status: 'pending' })).toBe('awaiting_approval');
      expect(DebateFSM.mapMessageStatusToTurnStatus({})).toBe('pending');
    });

    test('turnKind', () => {
      expect(DebateFSM.turnKind({ authorType: 'moderator' })).toBe('moderator');
      expect(DebateFSM.turnKind({ author: 'Moderator' })).toBe('moderator');
      expect(DebateFSM.turnKind({ authorType: 'system' })).toBe('system');
      expect(DebateFSM.turnKind({ author: 'GPT' })).toBe('model');
    });

    test('turnStatus', () => {
      expect(DebateFSM.turnStatus({ status: 'streaming' })).toBe('printing');
      expect(DebateFSM.turnStatus({ status: 'approved' })).toBe('approved');
      expect(DebateFSM.turnStatus({ authorType: 'moderator' })).toBe('approved');
      expect(DebateFSM.turnStatus({ status: 'rejected' })).toBe('rejected');
      expect(DebateFSM.turnStatus({ status: 'completed' })).toBe('pending');
      expect(DebateFSM.turnStatus({ status: 'awaiting_approval' })).toBe('pending');
      expect(DebateFSM.turnStatus({ status: 'custom' })).toBe('custom');
      expect(DebateFSM.turnStatus({})).toBe('pending');
    });

    test('normalizeBoolean / normalizeKind', () => {
      expect(DebateFSM.normalizeBoolean(true)).toBe(true);
      expect(DebateFSM.normalizeBoolean('true')).toBe(true);
      expect(DebateFSM.normalizeBoolean('false')).toBe(false);
      expect(DebateFSM.normalizeBoolean(1)).toBe(false);
      expect(DebateFSM.normalizeKind('  ')).toBe('answer');
      expect(DebateFSM.normalizeKind('moderator')).toBe('moderator');
      expect(DebateFSM.normalizeKind('', 'fallbackKind')).toBe('fallbackKind');
    });
  });
});

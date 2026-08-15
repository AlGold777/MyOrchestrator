const Protocol = require('../shared/completion-protocol.js');

const completeFacts = () => ({
  generationObserved: true,
  producerState: 'TERMINAL',
  contentTerminal: true,
  ownership: 'CONFIRMED',
  activeVetoes: []
});

describe('CompletionPolicy deterministic terminal contract', () => {
  test('requires the full success conjunction', () => {
    expect(Protocol.CompletionPolicy.canSucceed(completeFacts())).toBe(true);
    for (const mutation of [
      { generationObserved: false }, { producerState: 'ACTIVE' },
      { contentTerminal: false }, { ownership: 'UNKNOWN' },
      { activeVetoes: ['ACTIVE_STOP'] }
    ]) {
      expect(Protocol.CompletionPolicy.canSucceed({ ...completeFacts(), ...mutation })).toBe(false);
    }
  });

  test.each([
    [{ contextLost: true }, 'CONTEXT_LOST'],
    [{ interrupted: true }, 'INTERRUPTED'],
    [{ providerError: true }, 'PROVIDER_ERROR'],
    [{ continueRequired: true }, 'CONTINUE_REQUIRED'],
    [{ ownership: 'CONFLICT' }, 'AMBIGUOUS'],
    [{ timeoutState: 'PROGRESS' }, 'STALLED']
  ])('classifies non-success facts %#', (patch, status) => {
    const result = Protocol.CompletionPolicy.evaluate({ ...completeFacts(), ...patch }, { attemptId: 'a' });
    expect(result.status).toBe(status);
    expect(result.reason).toBeTruthy();
    expect(Array.isArray(result.evidenceRefs)).toBe(true);
  });
});

describe('Completion protocol components', () => {
  test('ledger is ordered, immutable and append-only', () => {
    const ledger = new Protocol.EvidenceLedger();
    const first = ledger.append({ type: 'GENERATION_ACTIVE', source: 'test', observedAt: 1, payload: {} });
    const second = ledger.append({ type: 'STOP_ABSENT', source: 'test', observedAt: 2 });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(ledger.getLatest('STOP_ABSENT')).toBe(second);
  });

  test('producer signals become candidates and hysteresis can be revoked', () => {
    const gate = new Protocol.ProducerGate({ confirmationWindowMs: 100 });
    expect(gate.observe('COPY_VISIBLE', 0)).toBe('CANDIDATE');
    expect(gate.evaluate(99)).toBe('CANDIDATE');
    expect(gate.observe('CONTENT_PROGRESS', 100)).toBe('ACTIVE');
    expect(gate.observe('STOP_ABSENT', 200)).toBe('CANDIDATE');
    expect(gate.evaluate(300)).toBe('TERMINAL');
  });

  test('cosmetic churn is not substantive progress', () => {
    const root = document.createElement('div');
    const cursor = document.createElement('span');
    root.append(cursor);
    const [result] = new Protocol.MutationClassifier().classify([
      { type: 'attributes', attributeName: 'class', target: cursor }
    ], { responseRoot: root, normalizedBefore: 'answer', normalizedAfter: 'answer' });
    expect(result).toMatchObject({ kind: 'COSMETIC', substantive: false });
  });

  test('structural-only response changes are substantive', () => {
    const root = document.createElement('div');
    const code = document.createElement('code');
    root.append(code);
    const [result] = new Protocol.MutationClassifier().classify([
      { type: 'childList', target: code }
    ], {
      responseRoot: root,
      normalizedBefore: 'same-text',
      normalizedAfter: 'same-text',
      structuralBefore: 'before',
      structuralAfter: 'after'
    });
    expect(result).toMatchObject({ kind: 'RESPONSE_STRUCTURE', substantive: true });
  });

  test('content progress keeps producer-stuck timeout armed', () => {
    const session = new Protocol.CompletionSession(
      { dispatchId: 'd', promptSubmittedAt: 0 },
      { timeouts: { progressTimeoutMs: 1000, producerStuckTimeoutMs: 20, hardAttemptTimeoutMs: 1000 } }
    );
    session.observe({ type: 'CONTENT_PROGRESS', source: 'test', observedAt: 10 });
    expect(session.timeouts.producerActiveSince).toBe(10);
    expect(session.timeouts.evaluate(30)).toBe('PRODUCER_STUCK');
  });

  test('materialization change prevents content terminal', async () => {
    const captures = [{ text: 'a' }, { text: 'ab' }];
    const materialization = await new Protocol.MaterializationHydrationGate().materialize({
      provider: 'test', capture: async () => captures.shift()
    });
    expect(materialization.changed).toBe(true);
    const session = new Protocol.CompletionSession({ dispatchId: 'd', promptSubmittedAt: 0 });
    expect(session.setContentVerification({ stable: true, structurallyComplete: true, lengthRegressionRecovered: true }, materialization, { text: 'ab' })).toBe(false);
  });

  test('session creates atomic extraction only after success', () => {
    const session = new Protocol.CompletionSession(
      { dispatchId: 'd', promptSubmittedAt: 1 },
      { confirmationWindowMs: 0, timeouts: { progressTimeoutMs: 99999, producerStuckTimeoutMs: 99999, hardAttemptTimeoutMs: 99999 } }
    );
    session.observe({ type: 'FRESH_RESPONSE_OBSERVED', source: 'test', observedAt: 2 });
    session.observe({ type: 'STOP_ABSENT', source: 'test', observedAt: 3 });
    session.confirmOwnership({ status: 'CONFIRMED', responseIdentity: { nodeKey: 'n1' }, reasons: [], verifiedAt: 3 });
    session.setContentVerification(
      { stable: true, structurallyComplete: true, lengthRegressionRecovered: true },
      { changed: false },
      { text: 'verified', html: '<p>verified</p>', responseIdentity: { nodeKey: 'n1' }, observedAt: 3 }
    );
    const terminal = session.evaluate(4);
    expect(terminal.status).toBe('SUCCESS_TERMINAL');
    expect(session.extractionSnapshot.text).toBe('verified');
    expect(Object.isFrozen(session.extractionSnapshot)).toBe(true);
  });

  test('timeouts are independent and never succeed', () => {
    const policy = new Protocol.TimeoutPolicy({ promptSubmittedAt: 0, progressTimeoutMs: 10, producerStuckTimeoutMs: 20, hardAttemptTimeoutMs: 30 });
    expect(policy.evaluate(10)).toBe('PROGRESS');
    policy.progress(15);
    policy.producerActive(true, 15);
    expect(policy.evaluate(30)).toBe('HARD');
  });

  test('recovery fails closed on identity mismatch', () => {
    expect(Protocol.RecoveryReconciler.reconcile({ dispatchId: 'a' }, { dispatchId: 'b' })).toBe('AMBIGUOUS');
    expect(Protocol.RecoveryReconciler.reconcile({ dispatchId: 'a' }, { dispatchId: 'a' })).toBe('RESUME');
    expect(Protocol.RecoveryReconciler.reconcile({ dispatchId: 'a' }, { contextValid: false })).toBe('CONTEXT_LOST');
  });

  test('typed results map into existing FinalizationController statuses', () => {
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'SUCCESS_TERMINAL' })).toBe('COMPLETE');
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'CONTINUE_REQUIRED' })).toBe('USER_ACTION_REQUIRED');
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'STALLED' })).toBe('STREAM_TIMEOUT');
    expect(Protocol.FinalizationAdapter.toFinalStatus({ status: 'AMBIGUOUS' })).toBe('UNCERTAIN');
  });

  test('shadow rollout reports false-completion deltas without changing policy', () => {
    const comparison = Protocol.CompletionRollout.compare({
      legacySuccess: true,
      legacyCompletionReason: 'copy_button_stable',
      terminalResult: { status: 'STALLED', evidenceRefs: [2, 4] },
      responseLength: 42,
      contentHash: 'h'
    });
    expect(comparison).toEqual(expect.objectContaining({
      v2TerminalStatus: 'STALLED',
      decisionDelta: 'legacy_success_v2_STALLED',
      v2Evidence: [2, 4]
    }));
  });
});

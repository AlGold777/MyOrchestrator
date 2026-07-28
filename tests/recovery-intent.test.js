const RecoveryIntent = require('../shared/recovery-intent');

describe('RecoveryIntent', () => {
  test('allows observe-only recovery after answer evidence', () => {
    const decision = RecoveryIntent.authorize({
      answer: 'valid recovered answer '.repeat(20),
      promptSubmittedAt: Date.now(),
      submitSource: 'content'
    }, {
      intent: 'observe_only'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      intent: 'observe_only',
      evidenceHit: true,
      mutatesPage: false
    }));
  });

  test('denies resend after fresh answer evidence from a confirmed submit', () => {
    const decision = RecoveryIntent.authorize({
      pendingFinalAnswer: 'valid pending answer '.repeat(20),
      promptSubmittedAt: Date.now(),
      submitSource: 'content',
      confirmedDispatchId: 'Z.ai:run:1',
      lastDispatchMeta: { dispatchId: 'Z.ai:run:1' }
    }, {
      intent: 'resend_prompt',
      dispatchId: 'Z.ai:run:1'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      intent: 'resend_prompt',
      reason: 'no_resend_after_answer_evidence',
      evidenceHit: true,
      mutatesPage: true
    }));
  });

  test('allows resend when the only long text is the pre-dispatch baseline', () => {
    const oldAnswer = 'old Z.ai answer '.repeat(30);
    const decision = RecoveryIntent.authorize({
      pendingFinalAnswer: oldAnswer,
      preDispatchAnswerSignature: oldAnswer.replace(/\s+/g, ' ').trim().toLowerCase(),
      preDispatchAnswerDispatchId: 'Z.ai:run:1',
      lastDispatchMeta: { dispatchId: 'Z.ai:run:1' }
    }, {
      intent: 'resend_prompt',
      dispatchId: 'Z.ai:run:1'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      evidenceHit: false,
      reason: 'allowed_no_answer_evidence'
    }));
  });

  test('does not use submission inferred from the same answer as freshness proof', () => {
    const decision = RecoveryIntent.evaluateFreshEvidence({
      pendingFinalAnswer: 'candidate answer '.repeat(30),
      promptSubmittedAt: Date.now(),
      submitSource: 'inferred_answer_evidence',
      confirmedDispatchId: 'Qwen:run:1',
      lastDispatchMeta: { dispatchId: 'Qwen:run:1' }
    }, { dispatchId: 'Qwen:run:1' });

    expect(decision).toEqual(expect.objectContaining({
      fresh: false,
      submissionConfirmed: false,
      reason: 'freshness_unproven'
    }));
  });

  test('allows resend when no answer evidence exists', () => {
    const decision = RecoveryIntent.authorize({}, {
      intent: 'manual_resend'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      intent: 'resend_prompt',
      evidenceHit: false,
      mutatesPage: true
    }));
  });

  test('unverified lifecycle activity on an old answer cannot block a needed resend', () => {
    const entry = {
      lifecycleReadyAt: Date.now(),
      lifecycleReadyMeta: { dispatchId: 'Qwen:run:1' },
      answerVerification: {
        verified: false,
        resolution: 'unresolved',
        structuralComplete: false,
        generationActive: false,
        dispatchId: 'Qwen:run:1'
      },
      lastDispatchMeta: { dispatchId: 'Qwen:run:1' }
    };
    const decision = RecoveryIntent.authorize(entry, {
      intent: 'resend_prompt',
      dispatchId: 'Qwen:run:1'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      evidenceHit: false,
      reason: 'allowed_no_answer_evidence'
    }));
    expect(RecoveryIntent.evaluateFreshEvidence(entry, {
      dispatchId: 'Qwen:run:1'
    }).reason).toBe('lifecycle_without_verified_answer');
  });
});

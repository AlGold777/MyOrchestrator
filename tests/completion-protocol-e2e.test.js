const Protocol = require('../shared/completion-protocol.js');

const createSession = (overrides = {}) => new Protocol.CompletionSession(
  {
    runSessionId: 'run-1',
    dispatchId: 'GPT:run-1:1',
    generationEpoch: 1,
    promptSubmittedAt: 0,
    provider: 'chatgpt'
  },
  {
    confirmationWindowMs: 10,
    timeouts: {
      progressTimeoutMs: 1000,
      producerStuckTimeoutMs: 1000,
      hardAttemptTimeoutMs: 5000
    },
    ...overrides
  }
);

const observe = (session, type, observedAt, payload = null) => session.observe({
  type, observedAt, payload, source: 'e2e-fixture'
});

const confirmOwnership = (session, status = 'CONFIRMED') => session.confirmOwnership({
  status,
  responseIdentity: { dispatchId: 'GPT:run-1:1', nodeKey: 'answer-1' },
  reasons: status === 'CONFIRMED' ? [] : ['fixture_conflict'],
  verifiedAt: 30
});

const verifyContent = (session, { changed = false, recovered = true, text = 'OK' } = {}) => session.setContentVerification(
  { stable: true, structurallyComplete: true, lengthRegressionRecovered: recovered },
  { changed },
  {
    text,
    html: `<p>${text}</p>`,
    contentHash: `content:${text}`,
    structuralHash: `structure:${text}`,
    responseIdentity: { dispatchId: 'GPT:run-1:1', nodeKey: 'answer-1' },
    observedAt: 30
  }
);

const makeSuccessReady = (session, text = 'OK') => {
  observe(session, 'GENERATION_ACTIVE', 1);
  observe(session, 'FRESH_RESPONSE_OBSERVED', 2);
  observe(session, 'CONTENT_PROGRESS', 3, { textLength: text.length });
  observe(session, 'GENERATION_INACTIVE', 20);
  confirmOwnership(session);
  verifyContent(session, { text });
};

describe('Completion Protocol end-to-end failure scenarios', () => {
  test('normal short response reaches SUCCESS_TERMINAL through the full conjunction', () => {
    const session = createSession();
    makeSuccessReady(session, '42');
    expect(session.evaluate(31)).toEqual(expect.objectContaining({ status: 'SUCCESS_TERMINAL' }));
    expect(session.extractionSnapshot.text).toBe('42');
  });

  test('long streaming response cannot complete while producer is active', () => {
    const session = createSession();
    observe(session, 'GENERATION_ACTIVE', 1);
    observe(session, 'CONTENT_PROGRESS', 20, { textLength: 1000 });
    observe(session, 'CONTENT_PROGRESS', 40, { textLength: 5000 });
    confirmOwnership(session);
    verifyContent(session, { text: 'long answer' });
    expect(session.evaluate(45)).toBeNull();
    observe(session, 'GENERATION_INACTIVE', 50);
    expect(session.evaluate(61)?.status).toBe('SUCCESS_TERMINAL');
  });

  test('stable partial response ends STALLED, never SUCCESS', () => {
    const session = createSession({
      timeouts: { progressTimeoutMs: 50, producerStuckTimeoutMs: 50, hardAttemptTimeoutMs: 500 }
    });
    observe(session, 'GENERATION_ACTIVE', 1);
    observe(session, 'CONTENT_PROGRESS', 10, { textLength: 30 });
    expect(session.evaluate(60)).toEqual(expect.objectContaining({ status: 'STALLED' }));
  });

  test.each(['COPY_VISIBLE', 'REGENERATE_VISIBLE', 'COMPLETION_MARKER_VISIBLE'])(
    'early %s is only a producer candidate',
    (witness) => {
      const session = createSession();
      observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
      observe(session, witness, 2);
      expect(session.evaluate(20)).toBeNull();
      expect(session.facts.producerState).toBe('TERMINAL');
      expect(session.facts.contentTerminal).toBe(false);
    }
  );

  test('temporary Stop disappearance is revoked when Stop returns', () => {
    const session = createSession();
    observe(session, 'GENERATION_ACTIVE', 1);
    observe(session, 'STOP_ABSENT', 2);
    expect(session.producer.state).toBe('CANDIDATE');
    observe(session, 'STOP_VISIBLE', 5);
    expect(session.producer.state).toBe('ACTIVE');
    expect(session.evaluate(20)).toBeNull();
  });

  test('delayed hydration prevents terminal content until a stable second pass', () => {
    const session = createSession();
    observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
    observe(session, 'GENERATION_INACTIVE', 2);
    confirmOwnership(session);
    expect(verifyContent(session, { changed: true, text: 'before hydration' })).toBe(false);
    expect(session.evaluate(20)).toBeNull();
    expect(verifyContent(session, { changed: false, text: 'after hydration' })).toBe(true);
    expect(session.evaluate(21)?.status).toBe('SUCCESS_TERMINAL');
  });

  test('structural/code rendering after stability revokes content terminal before commit', () => {
    const session = createSession();
    observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
    observe(session, 'GENERATION_INACTIVE', 2);
    confirmOwnership(session);
    verifyContent(session, { text: 'code' });
    expect(session.facts.contentTerminal).toBe(true);
    observe(session, 'RESPONSE_STRUCTURE_CHANGED', 5, { structuralHash: 'new' });
    expect(session.facts.contentTerminal).toBe(false);
    expect(session.facts.producerState).toBe('ACTIVE');
    expect(session.evaluate(20)).toBeNull();
  });

  test('unrecovered length regression blocks content terminal', () => {
    const session = createSession();
    observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
    observe(session, 'GENERATION_INACTIVE', 2);
    confirmOwnership(session);
    expect(verifyContent(session, { recovered: false, text: 'shorter' })).toBe(false);
    expect(session.evaluate(20)).toBeNull();
  });

  test('node replacement fails closed as AMBIGUOUS', () => {
    const session = createSession();
    observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
    observe(session, 'NODE_REPLACED', 2);
    expect(session.evaluate(3)).toEqual(expect.objectContaining({ status: 'AMBIGUOUS' }));
  });

  test('Continue and provider error veto partial text with typed results', () => {
    const continueSession = createSession();
    observe(continueSession, 'CONTENT_PROGRESS', 1, { textLength: 200 });
    observe(continueSession, 'CONTINUE_VISIBLE', 2);
    expect(continueSession.evaluate(3)?.status).toBe('CONTINUE_REQUIRED');

    const errorSession = createSession();
    observe(errorSession, 'CONTENT_PROGRESS', 1, { textLength: 200 });
    observe(errorSession, 'PROVIDER_ERROR_VISIBLE', 2);
    expect(errorSession.evaluate(3)?.status).toBe('PROVIDER_ERROR');
  });

  test('SPA navigation produces CONTEXT_LOST', () => {
    const session = createSession();
    observe(session, 'GENERATION_ACTIVE', 1);
    observe(session, 'CONTEXT_INVALIDATED', 2, { reason: 'spa_navigation' });
    expect(session.evaluate(3)?.status).toBe('CONTEXT_LOST');
  });

  test('cosmetic churn does not reset verified content', () => {
    const session = createSession();
    observe(session, 'FRESH_RESPONSE_OBSERVED', 1);
    observe(session, 'GENERATION_INACTIVE', 2);
    confirmOwnership(session);
    verifyContent(session, { text: 'stable' });
    observe(session, 'COSMETIC_MUTATION', 4, { cursor: true });
    expect(session.facts.contentTerminal).toBe(true);
    expect(session.evaluate(20)?.status).toBe('SUCCESS_TERMINAL');
  });

  test('immutable extraction is not changed by later live snapshot mutation', () => {
    const source = { text: 'verified', html: '<p>verified</p>' };
    const session = createSession();
    makeSuccessReady(session, source.text);
    session.verifiedSnapshot = { ...session.verifiedSnapshot, ...source };
    session.evaluate(31);
    source.text = 'later live DOM text';
    source.html = '<p>later live DOM text</p>';
    expect(session.extractionSnapshot).toEqual(expect.objectContaining({
      text: 'verified', html: '<p>verified</p>'
    }));
    expect(Object.isFrozen(session.extractionSnapshot)).toBe(true);
  });
});

const RunIdentity = require('../shared/run-identity');

describe('RunIdentity', () => {
  test('builds stable run identity with prompt hash', () => {
    const identity = RunIdentity.build({
      runSessionId: 123,
      dispatchId: 'GPT:123:1',
      tabId: 42,
      prompt: 'hello'
    });

    expect(identity).toEqual(expect.objectContaining({
      schemaVersion: 1,
      runSessionId: 123,
      dispatchId: 'GPT:123:1',
      tabId: 42,
      promptHash: RunIdentity.hashText('hello')
    }));
  });

  test('rejects stale run session', () => {
    const decision = RunIdentity.validateEvent({}, {
      runSessionId: 2
    }, {
      runSessionId: 1
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      reason: 'stale_run_session',
      expectedRunSessionId: 1,
      incomingRunSessionId: 2
    }));
  });

  test('rejects any dispatch id that is not the current dispatch', () => {
    const decision = RunIdentity.validateEvent({
      recentDispatchIds: ['dispatch-old', 'dispatch-current'],
      lastDispatchMeta: { dispatchId: 'dispatch-current' }
    }, {
      dispatchId: 'dispatch-old'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      reason: 'stale_dispatch',
      incomingDispatchId: 'dispatch-old'
    }));
  });

  test('rejects missing dispatch identity when the event contract requires it', () => {
    const decision = RunIdentity.validateEvent({
      lastDispatchMeta: { dispatchId: 'dispatch-current' }
    }, {}, {
      dispatchId: 'dispatch-current',
      requireDispatchId: true
    });
    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      reason: 'missing_dispatch_identity'
    }));
  });
});

const RunGuard = require('../shared/run-guard');

describe('RunGuard.canStartNewRun', () => {
  test('allows a run when no session exists', () => {
    expect(RunGuard.canStartNewRun(null)).toEqual({ ok: true });
  });

  test('allows a run when session is not active', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: false })).toEqual({ ok: true });
  });

  test('blocks a second run while rounds are in progress', () => {
    expect(RunGuard.canStartNewRun({
      roundsInProgress: true,
      sessionId: 'session-1'
    })).toEqual({
      ok: false,
      errorCode: 'RUN_ALREADY_ACTIVE',
      activeSessionId: 'session-1'
    });
  });

  test('allows an explicit forced run', () => {
    expect(RunGuard.canStartNewRun({ roundsInProgress: true }, { force: true })).toEqual({ ok: true });
  });
});

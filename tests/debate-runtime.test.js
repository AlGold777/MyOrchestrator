const Runtime = require('../disput/debate-runtime');

describe('generic debate UI runtime projection', () => {
  test('contains no execution sequencing and projects lifecycle only', () => {
    const state = Runtime.createState({ participants: ['alpha', 'beta', 'gamma'] });
    Runtime.markRunning(state);
    expect(state).toMatchObject({ active: true, status: 'running', participants: ['alpha', 'beta', 'gamma'] });
    Runtime.markCompleted(state);
    expect(state).toMatchObject({ active: false, status: 'completed' });
  });

  test('normalizes transport status for UI cards', () => {
    expect(Runtime.mapMessageStatusToTurnStatus({ status: 'SUCCESS' })).toBe('accepted');
    expect(Runtime.mapMessageStatusToTurnStatus({ failed: true })).toBe('failed');
  });
});

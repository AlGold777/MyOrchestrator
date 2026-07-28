const VisitPolicy = require('../shared/visit-policy');

describe('VisitPolicy', () => {
  test('classifies interrupted short foreground visit as retryable', () => {
    const summary = VisitPolicy.classifyVisit({
      durationMs: 420,
      minUsefulMs: 1500,
      source: 'automation_focus',
      reason: 'tab_switch'
    });

    expect(summary).toEqual(expect.objectContaining({
      shortVisit: true,
      usefulVisit: false,
      retryable: true,
      durationMs: 420,
      minUsefulMs: 1500
    }));
    expect(VisitPolicy.shouldRetryVisit(summary, { attempt: 0, maxShortRetries: 1 })).toBe(true);
    expect(VisitPolicy.shouldRetryVisit(summary, { attempt: 1, maxShortRetries: 1 })).toBe(false);
  });

  test('does not retry terminal short visits', () => {
    const summary = VisitPolicy.classifyVisit({
      durationMs: 100,
      minUsefulMs: 1500,
      source: 'automation_focus',
      reason: 'automation_terminal_success'
    });

    expect(summary.shortVisit).toBe(false);
    expect(summary.usefulVisit).toBe(true);
    expect(summary.retryable).toBe(false);
    expect(VisitPolicy.shouldRetryVisit(summary, { attempt: 0, maxShortRetries: 1 })).toBe(false);
  });
});

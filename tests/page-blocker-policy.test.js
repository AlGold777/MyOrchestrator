const PageBlockerPolicy = require('../shared/page-blocker-policy');

describe('PageBlockerPolicy', () => {
  test('normalizes auth and captcha blockers to user-action terminal policy', () => {
    expect(PageBlockerPolicy.classify({
      status: 'login_required',
      blockers: ['captcha_required']
    })).toEqual(expect.objectContaining({
      blocker: 'auth_required',
      action: 'terminal_user_action_required',
      terminal: true,
      retryable: false
    }));
  });

  test('keeps page readiness as retryable wait policy', () => {
    expect(PageBlockerPolicy.classify({
      reason: 'page_not_ready'
    })).toEqual(expect.objectContaining({
      blocker: 'page_not_ready',
      action: 'wait_retry',
      terminal: false,
      retryable: true
    }));
  });
});

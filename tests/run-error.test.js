const RunError = require('../shared/run-error');

describe('RunError', () => {
  test('normalizes unknown codes', () => {
    expect(RunError.makeRunError('bad_code', 'x')).toEqual(expect.objectContaining({
      ok: false,
      type: 'unknown',
      errorCode: 'unknown',
      message: 'x'
    }));
  });

  test('keeps type and errorCode aligned', () => {
    const err = RunError.makeRunError(RunError.CODES.RATE_LIMIT, 'rate limited');
    expect(err.type).toBe(err.errorCode);
  });

  test('marks only configured codes as recoverable', () => {
    expect(RunError.makeRunError(RunError.CODES.RATE_LIMIT).recoverable).toBe(true);
    expect(RunError.makeRunError(RunError.CODES.CAPTCHA).recoverable).toBe(false);
  });
});

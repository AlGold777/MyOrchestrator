describe('LLMLog leveled logger', () => {
  let LLMLog;
  let spies;

  beforeEach(() => {
    jest.resetModules();
    delete globalThis.LLMLog;
    delete globalThis.__LLM_DEBUG__;
    spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {})
    };
    LLMLog = require('../shared/logger');
  });

  afterEach(() => {
    Object.values(spies).forEach((s) => s.mockRestore());
  });

  test('installs itself on the global', () => {
    expect(globalThis.LLMLog).toBe(LLMLog);
    expect(typeof LLMLog.debug).toBe('function');
  });

  test('debug/info/log are silent by default (gate off)', () => {
    LLMLog.debug('hidden');
    LLMLog.info('hidden');
    LLMLog.log('hidden');
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.info).not.toHaveBeenCalled();
  });

  test('warn/error are always emitted regardless of the gate', () => {
    LLMLog.warn('boom');
    LLMLog.error('bang');
    expect(spies.warn).toHaveBeenCalledWith('boom');
    expect(spies.error).toHaveBeenCalledWith('bang');
  });

  test('enabling the gate lets debug/info through', () => {
    expect(LLMLog.isEnabled()).toBe(false);
    LLMLog.setEnabled(true);
    expect(LLMLog.isEnabled()).toBe(true);
    LLMLog.debug('now visible', 1);
    LLMLog.info('also visible');
    expect(spies.log).toHaveBeenCalledWith('now visible', 1);
    expect(spies.info).toHaveBeenCalledWith('also visible');
  });

  test('the converted call-site pattern is a safe no-op when the logger is absent', () => {
    delete globalThis.LLMLog;
    // This is exactly how background call-sites reference the logger.
    expect(() => globalThis.LLMLog?.debug?.('nope')).not.toThrow();
    expect(globalThis.LLMLog?.debug?.('nope')).toBeUndefined();
  });
});

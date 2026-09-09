/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/attachment-handler.js'), 'utf8');

test('an exhausted upload budget stops further file dispatches and reports failure to the queue', async () => {
  jest.useFakeTimers().setSystemTime(1000);
  try {
    const dispatches = [];
    const reportDispatchStage = jest.fn();
    const c = {
      Date, setTimeout, console,
      atob: value => Buffer.from(value, 'base64').toString('binary'),
      File: class { constructor(parts, name) { this.name = name; } },
      CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
      ContentUtils: { ensureMainWorldBridge: async () => true, getMainBridgeToken: () => 'test', reportDispatchStage },
      document: { body: { innerText: '' }, querySelectorAll: () => [], querySelector: () => null },
      chrome: { runtime: { sendMessage() {} } },
      dispatchEvent: event => dispatches.push(event.detail.mode)
    };
    c.window = c; c.self = c;
    vm.runInNewContext(source, c);
    const pending = c.AttachmentHandler.attach('DeepSeek', [
      { name: 'evidence.txt', type: 'text/plain', base64: 'data:text/plain;base64,eA==' }
    ], { timeoutMs: 300, pollMs: 50 });
    await jest.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.reason).toBe('TIMEOUT');
    expect(dispatches).toEqual(['drop']);
    expect(reportDispatchStage).toHaveBeenLastCalledWith('DeepSeek', {}, 'attachment_upload_failed', {
      outcome: 'failed', reason: 'TIMEOUT'
    });
  } finally {
    jest.useRealTimers();
  }
});

/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
test.each(['get', 'window'])('silent %s callback releases focus and late callbacks cannot steal it', async stage => {
  jest.useFakeTimers();
  try {
    let late;
    const c = { setTimeout, clearTimeout, isValidTabId: Number.isInteger, self: {}, chrome: {
      runtime: { lastError: null },
      tabs: { get: (_id, cb) => { if (stage === 'get') late = cb; else cb({windowId:1}); }, update: jest.fn() },
      windows: { update: jest.fn((_id, _options, cb) => { late = cb; }) }
    } };
    vm.createContext(c);
    const source = fs.readFileSync(require.resolve('../background/tab-manager'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('function activateTabForDispatch'), source.indexOf('\nfunction probeReadyContentScript')), c);
    const focused = c.activateTabForDispatch(42);
    await jest.advanceTimersByTimeAsync(1500);
    expect(await focused).toBe(false);
    late({windowId:1});
    expect(c.chrome.tabs.update).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

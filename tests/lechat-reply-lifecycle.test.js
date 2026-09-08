/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-lechat'), 'utf8');
const start = source.indexOf('  async function waitForLeChatReply(');
const end = source.indexOf('  // -------------------- Отправка результата', start);
if (start < 0 || end <= start) throw new Error('Le Chat waiter boundaries changed');
function setup() {
  let callback;
  let generating = false;
  const stop = jest.fn();
  const capture = jest.fn(() => ({ text: 'A complete answer with enough text.', html: '<p>answer</p>' }));
  const c = { Date, Promise, console, setInterval, clearInterval, setTimeout, clearTimeout,
    getProseNodes: () => [{}], extractResponseText: capture,
    document: { body: {}, querySelector: () => generating ? {} : null },
    cleanupScope: { trackInterval: x => x, trackTimeout: x => x },
    window: { ContentUtils: { observeMutations: (_, __, cb) => { callback = cb; return stop; } } }
  };
  vm.createContext(c);
  vm.runInContext(source.slice(start, end), c);
  return { wait: c.waitForLeChatReply, mutate: () => callback(), stop, capture,
    setGenerating: value => { generating = value; } };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('mutation bursts do not replace elapsed stability and cleanup removes only this subscription', async () => {
  const h = setup();
  const done = jest.fn();
  const pending = h.wait('question', 5000).then(done);
  for (let i = 0; i < 10; i++) h.mutate();
  await jest.advanceTimersByTimeAsync(1200);
  expect(done).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(600);
  await pending;
  expect(h.stop).toHaveBeenCalledTimes(1);
  const count = h.capture.mock.calls.length;
  h.mutate();
  expect(h.capture).toHaveBeenCalledTimes(count);
  expect(jest.getTimerCount()).toBe(0);
});
test('active generation resets the stability window', async () => {
  const h = setup();
  const done = jest.fn();
  const pending = h.wait('question', 10000).then(done);
  await jest.advanceTimersByTimeAsync(1200);
  h.setGenerating(true); h.mutate();
  await jest.advanceTimersByTimeAsync(1200);
  h.setGenerating(false); h.mutate();
  await jest.advanceTimersByTimeAsync(1200);
  expect(done).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(600);
  await pending;
  expect(h.stop).toHaveBeenCalledTimes(1);
});
test('timeout also releases the mutation subscription', async () => {
  const h = setup(); h.setGenerating(true);
  const pending = h.wait('question', 100);
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../background/telemetry-logs.js'), 'utf8');

function sandbox() {
  let stored = [];
  const c = {
    readDiagnosticsEvents: jest.fn(async () => structuredClone(stored)),
    writeDiagnosticsEvents: jest.fn(async (rows) => { stored = structuredClone(rows); })
  };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('let diagnosticsMutationChain'), source.indexOf('function ensureLogBuffer')), c);
  return c;
}

test('200 concurrent provider events retain order with one expensive storage rewrite', async () => {
  const c = sandbox();
  const writes = Array.from({ length: 200 }, (_, seq) => c.mutateDiagnosticsEventsConsistent(rows => [...rows, { seq }]));
  await Promise.all(writes);
  const rows = await vm.runInContext('readDiagnosticsEventsConsistent()', c);
  expect(rows.map(row => row.seq)).toEqual(Array.from({ length: 200 }, (_, i) => i));
  expect(c.writeDiagnosticsEvents).toHaveBeenCalledTimes(1);
});

test('clear ordered between old and new events cannot resurrect an old run', async () => {
  const c = sandbox();
  await Promise.all([
    c.mutateDiagnosticsEventsConsistent(rows => [...rows, { run: 'old' }]),
    vm.runInContext('replaceDiagnosticsEventsConsistent([])', c),
    c.mutateDiagnosticsEventsConsistent(rows => [...rows, { run: 'new' }])
  ]);
  expect(await vm.runInContext('readDiagnosticsEventsConsistent()', c)).toEqual([{ run: 'new' }]);
});

test('a failed storage write rejects the burst and the next burst can recover', async () => {
  const c = sandbox();
  c.writeDiagnosticsEvents.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(c.mutateDiagnosticsEventsConsistent(() => [1])).rejects.toThrow('disk unavailable');
  await c.mutateDiagnosticsEventsConsistent(() => [2]);
  expect(await vm.runInContext('readDiagnosticsEventsConsistent()', c)).toEqual([2]);
});

test('events arriving during a write are persisted in the next batch', async () => {
  const c = sandbox();
  let release;
  const originalWrite = c.writeDiagnosticsEvents.getMockImplementation();
  c.writeDiagnosticsEvents.mockImplementationOnce(async rows => {
    await new Promise(resolve => { release = resolve; });
    await originalWrite(rows);
  });
  const first = c.mutateDiagnosticsEventsConsistent(() => [1]);
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
  const second = c.mutateDiagnosticsEventsConsistent(rows => [...rows, 2]);
  release();
  await Promise.all([first, second]);
  expect(await vm.runInContext('readDiagnosticsEventsConsistent()', c)).toEqual([1, 2]);
  expect(c.writeDiagnosticsEvents).toHaveBeenCalledTimes(2);
});

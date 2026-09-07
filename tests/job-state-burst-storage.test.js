/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../background/job-orchestrator.js'), 'utf8');

function sandbox() {
  const c = { console, CompressedStorage: { set: jest.fn(async () => {}) }, updateMv3SurvivalAlarm: jest.fn() };
  c.self = c;
  c.PipelineFSM = { compactJobStateForStorage: jest.fn(state => structuredClone(state)) };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('let jobStateSaveFlight'), source.indexOf('async function loadJobState')), c);
  return c;
}

test('frequent state updates compress only the latest snapshot of a synchronous burst', async () => {
  const c = sandbox();
  const writes = Array.from({ length: 100 }, (_, seq) => c.saveJobState({ seq }));
  expect(c.PipelineFSM.compactJobStateForStorage).not.toHaveBeenCalled();
  await Promise.all(writes);
  expect(c.CompressedStorage.set).toHaveBeenCalledTimes(1);
  expect(c.CompressedStorage.set).toHaveBeenCalledWith('jobState', { seq: 99 });
});

test('command intent awaiting storage cannot finish while its durable write is pending', async () => {
  const c = sandbox();
  let release;
  c.CompressedStorage.set.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = c.saveJobState({ phase: 'preparing' });
  await Promise.resolve();
  const intent = c.saveJobState({ phase: 'command_intent' });
  let settled = false;
  intent.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await Promise.all([old, intent]);
  expect(c.CompressedStorage.set.mock.calls.map(call => call[1].phase)).toEqual(['preparing', 'command_intent']);
  expect(settled).toBe(true);
  await c.saveJobState({ phase: 'next_run' });
  expect(c.CompressedStorage.set).toHaveBeenLastCalledWith('jobState', { phase: 'next_run' });
});

test('a saved dispatch checkpoint releases focus while newer generation writes continue', async () => {
  const c = sandbox();
  const releases = [];
  c.CompressedStorage.set.mockImplementation(() => new Promise(resolve => releases.push(resolve)));
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let checkpointSaved = false;
  const checkpoint = c.saveJobState({ phase: 'command_intent' }).then(() => { checkpointSaved = true; });
  await flush();
  const progress = c.saveJobState({ phase: 'generation_progress' });
  releases[0]();
  await flush();
  const releasedBeforeProgress = checkpointSaved;
  releases[1]();
  await Promise.all([checkpoint, progress]);
  expect(releasedBeforeProgress).toBe(true);
});

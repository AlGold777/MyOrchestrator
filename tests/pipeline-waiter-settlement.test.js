// Barrier settlement contract of pipelineWaiter: a terminal failure settles the
// participant; SUCCESS+FAILED batches resolve immediately instead of hanging
// until the global timeout.
const fs = require('fs');
const path = require('path');

function loadPipelineWaiter() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  const start = source.indexOf('const PIPELINE_TERMINAL_STATUSES');
  const end = source.indexOf('let appendModeratorNoneNoteFromComposer');
  if (start < 0 || end < 0 || end <= start) throw new Error('pipelineWaiter block not found in results.js');
  const block = source.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return pipelineWaiter;`)();
}

describe('pipelineWaiter — terminal failure settlement', () => {
  test('2 SUCCESS + 1 terminal FAILED (empty answer) resolves without timeout', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B', 'C'], { timeoutMs: 60000 });
    waiter.handleFinal({ llmName: 'A', answer: 'answer A', metadata: { terminal: true } });
    waiter.handleFinal({ llmName: 'B', answer: 'answer B', metadata: { terminal: true } });
    waiter.handleFinal({ llmName: 'C', answer: '', status: 'ERROR', metadata: { terminal: true } });
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(Object.keys(result.responses).sort()).toEqual(['A', 'B']);
    expect(result.missing).toEqual(['C']);
    expect(result.failed).toEqual({ C: 'ERROR' });
  });

  test('terminal failure first, successes after — still settles', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000 });
    waiter.handleFinal({ llmName: 'B', answer: '', status: 'EXTRACT_FAILED', metadata: { terminal: true } });
    waiter.handleFinal({ llmName: 'A', answer: 'ok', metadata: { terminal: true } });
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.failed).toEqual({ B: 'EXTRACT_FAILED' });
  });

  test('late usable answer overrides an earlier failure settlement before finalize', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000 });
    waiter.handleFinal({ llmName: 'A', answer: '', status: 'STREAM_TIMEOUT', metadata: { terminal: true } });
    waiter.handleFinal({ llmName: 'A', answer: 'recovered answer', metadata: { terminal: true } });
    waiter.handleFinal({ llmName: 'B', answer: 'ok', metadata: { terminal: true } });
    const result = await promise;
    expect(result.responses.A).toBe('recovered answer');
    expect(result.failed).toEqual({});
  });

  test('non-terminal empty message does not settle (still waits, then timeout)', async () => {
    jest.useFakeTimers();
    try {
      const waiter = loadPipelineWaiter();
      const promise = waiter.waitForModels(['A'], { timeoutMs: 5000 });
      waiter.handleFinal({ llmName: 'A', answer: '', metadata: {} }); // partial, not terminal
      jest.advanceTimersByTime(5001);
      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(result.missing).toEqual(['A']);
    } finally {
      jest.useRealTimers();
    }
  });
});

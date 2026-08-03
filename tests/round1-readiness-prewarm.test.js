const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);

describe('Round 1 readiness prewarm', () => {
  test('prewarms every model concurrently before sequential dispatch starts', () => {
    const prewarmStart = SOURCE.indexOf('async function prewarmRound1Readiness');
    const prewarmEnd = SOURCE.indexOf('async function recoverRound1TabReadiness');
    const prewarm = SOURCE.slice(prewarmStart, prewarmEnd);
    expect(prewarmStart).toBeGreaterThan(0);
    expect(prewarm).toContain('const tasks = modelNames.map(async (llmName) =>');
    expect(prewarm).toContain('await Promise.allSettled(tasks)');
    expect(prewarm).toContain("reason: 'round0_ready_prewarm'");
    expect(prewarm).toContain('await waitForScriptReady(tabId, llmName');
  });

  test('Round 0 awaits prewarm before Round 1', () => {
    const rounds = SOURCE.slice(
      SOURCE.indexOf('async function runDispatchRounds'),
      SOURCE.length
    );
    const prewarmIndex = rounds.indexOf('await prewarmRound1Readiness(selectedLLMs, sessionId)');
    const round1Index = rounds.indexOf('await dispatchRound1Sequentially');
    expect(prewarmIndex).toBeGreaterThan(0);
    expect(round1Index).toBeGreaterThan(prewarmIndex);
  });

  test('keeps the normal Round 1 readiness gate as a fallback', () => {
    const dispatch = fs.readFileSync(
      path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
      'utf8'
    );
    expect(dispatch).toContain('readyOk = await waitForScriptReady(tabId, llmName');
  });
});

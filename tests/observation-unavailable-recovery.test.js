const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);

describe('provider-independent completion observation recovery', () => {
  test('serializes browser script observations so simultaneous model checks cannot starve each other', () => {
    expect(SOURCE).toContain('var lateCollectExecutionMutex = Promise.resolve()');
    expect(SOURCE).toMatch(/classifyLateCollectState[\s\S]*?withLateCollectExecutionLock/);
    expect(SOURCE).toMatch(/runInlineLateExtract[\s\S]*?withLateCollectExecutionLock/);
  });

  test('an existing eligible tab with an unavailable observer is not classified as dead', () => {
    const classifier = SOURCE.slice(
      SOURCE.indexOf('async function classifyLateCollectState'),
      SOURCE.indexOf('async function runInlineLateExtract')
    );
    expect(classifier).toContain("state: 'UNAVAILABLE'");
    expect(classifier).toContain("reason: 'execute_script_temporarily_unavailable'");
    expect(classifier).not.toMatch(/state: 'DEAD',[\s\S]{0,100}reason: 'execute_script_unavailable'/);
  });

  test('schedules bounded retries for every provider without reloading the page', () => {
    expect(SOURCE).toContain('UNAVAILABLE_OBSERVATION_RETRY_DELAYS_MS');
    expect(SOURCE).toContain('scheduleUnavailableObservationRetry(llmName, tabId, runSessionId, dispatchId, reason)');
    const retry = SOURCE.slice(
      SOURCE.indexOf('function scheduleUnavailableObservationRetry'),
      SOURCE.indexOf('const clearAdaptiveCollectTimer')
    );
    expect(retry).toContain("'observation_unavailable_retry'");
    expect(retry).toContain('allowRecovery: false');
    expect(retry).not.toContain('reload');
    expect(retry).not.toContain('llmName ===');
  });
});

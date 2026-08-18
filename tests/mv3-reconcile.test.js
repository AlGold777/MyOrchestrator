// MV3 P0: an interrupted run must be re-armed after SW suspension / browser restart.
// This is handled by the survival alarm (periodic) + an onStartup reconcile, both
// calling loadJobState() -> rehydrateActiveJobRuntime(), which re-arms collection
// pings and the dispatch supervisor for non-terminal entries. Locks that wiring.
const fs = require('fs');
const path = require('path');

const ORCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

describe('MV3 reconcile wiring', () => {
  test('survival alarm reconciles via loadJobState', () => {
    expect(ORCH_SRC).toContain("alarm?.name !== MV3_SURVIVAL_ALARM");
    expect(ORCH_SRC).toMatch(/MV3_SURVIVAL_ALARM[\s\S]{0,500}loadJobState\(\)/);
    expect(ORCH_SRC).toContain('self.__dispatchRoundsRuntimeActive === true');
    expect(ORCH_SRC).toContain('jobState?.session?.roundsInProgress === true && hasOpenModelRuns(jobState)');
  });

  test('onStartup triggers an immediate reconcile (no up-to-30s gap on cold start)', () => {
    expect(ORCH_SRC).toContain('chrome?.runtime?.onStartup?.addListener');
    expect(ORCH_SRC).toMatch(/onStartup\.addListener\(\(\) => \{[\s\S]{0,120}loadJobState\(\)/);
  });

  test('loadJobState rehydrates and re-arms collection for non-terminal entries', () => {
    expect(ORCH_SRC).toContain("rehydrateActiveJobRuntime('load_job_state')");
    expect(ORCH_SRC).toContain("'mv3_rehydration_collect'");
    // Survival alarm is armed only while a run has open models.
    expect(ORCH_SRC).toContain('hasOpenModelRuns(state)');
  });

  test('rehydration clears a persisted roundsInProgress lock', () => {
    expect(ORCH_SRC).toMatch(/jobState\.session\.roundsInProgress === true[\s\S]{0,180}jobState\.session\.roundsInProgress = false/);
    expect(ORCH_SRC).toContain('roundsRecoveredFromStuckAt');
  });

  test('live Round 1 cannot be overwritten by an alarm storage reload', () => {
    expect(ORCH_SRC).toMatch(/async function loadJobState\(\) \{[\s\S]{0,100}if \(self\.__dispatchRoundsRuntimeActive === true\) return/);
    expect(ORCH_SRC).toMatch(/async function runDispatchRounds[\s\S]{0,180}self\.__dispatchRoundsRuntimeActive = true/);
    expect(ORCH_SRC).toMatch(/finally \{[\s\S]{0,100}self\.__dispatchRoundsRuntimeActive = false/);
  });

  test('rehydration re-arms script runtime hard-stops for submitted open models', () => {
    expect(ORCH_SRC).toMatch(/entry\.promptSubmittedAt && isValidTabId\(tabId\)[\s\S]{0,260}armScriptRuntimeHardStopForConfirmedPrompt/);
  });
});

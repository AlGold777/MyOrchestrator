const fs = require('fs');
const path = require('path');

const ORCHESTRATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);
const PipelineRunState = require('../background/pipeline-run-state.js');
const PipelineFSM = require('../shared/pipeline-fsm.js');

describe('existing-page dispatch bootstrap recovery', () => {
  test('persists the page mode and round recovery cursor', () => {
    const state = PipelineRunState.create({
      selectedModels: ['GPT', 'Claude'],
      forceNewTabs: false,
      startedAt: 123
    });

    expect(state.session.forceNewTabs).toBe(false);
    expect(state.session.roundsInProgress).toBe(false);
    expect(state.session.roundPhase).toBeNull();

    state.session.roundsInProgress = true;
    state.session.roundPhase = 'round1';
    const compacted = PipelineFSM.compactJobStateForStorage(state);
    expect(compacted.session.forceNewTabs).toBe(false);
    expect(compacted.session.roundsInProgress).toBe(true);
    expect(compacted.session.roundPhase).toBe('round1');
  });

  test('a new run drops per-model chains and dispatch locks from older runs', () => {
    const startProcessSource = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('async function startProcess'),
      ORCHESTRATOR_SOURCE.indexOf('function resolvePromptForDispatch')
    );

    expect(startProcessSource).toContain('delete llmStartChains[llmName]');
    expect(startProcessSource).toContain('dispatchMutexManager.clear(llmName)');
    expect(startProcessSource).toContain('promptSubmitWaiters.delete(llmName)');
  });

  test('existing tabs are acquired concurrently while new tabs remain sequential', () => {
    const round0Source = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('async function openTabsSequentially'),
      ORCHESTRATOR_SOURCE.indexOf('async function recoverRound1TabReadiness')
    );

    expect(round0Source).toContain('if (!forceNewTabs)');
    expect(round0Source).toContain('selectedLLMs.map(async (llmName, index)');
    expect(round0Source).toContain('await Promise.allSettled(acquisitions)');
    expect(round0Source).toContain("acquisitionMode: 'parallel_reuse'");
  });

  test('the results-page message remains open through reusable-tab bootstrap', () => {
    const startProcessSource = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('async function startProcess'),
      ORCHESTRATOR_SOURCE.indexOf('function resolvePromptForDispatch')
    );

    expect(startProcessSource).toContain('onBootstrapComplete: resolveBootstrap');
    expect(startProcessSource).toMatch(/if \(!forceNewTabs\)[\s\S]{0,180}bootstrapReady/);
  });

  test('MV3 rehydration resumes an interrupted reusable-tab bootstrap', () => {
    const rehydrateSource = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('function rehydrateActiveJobRuntime'),
      ORCHESTRATOR_SOURCE.indexOf("if (typeof chrome !== 'undefined' && chrome?.alarms")
    );

    expect(rehydrateSource).toContain('shouldResumeBootstrap');
    expect(rehydrateSource).toContain("['round0', 'round1'].includes(interruptedRoundPhase)");
    expect(rehydrateSource).toContain("{ resume: true }");
    expect(rehydrateSource).toContain('MV3_DISPATCH_BOOTSTRAP_RESUME');
  });

  test('resume does not repeat a dispatch command already attempted before suspension', () => {
    const round1Source = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('async function dispatchRound1Sequentially'),
      ORCHESTRATOR_SOURCE.indexOf('async function focusTabForVerification')
    );

    expect(round1Source).toContain('options.resume === true');
    expect(round1Source).toContain('entry.lastDispatchMeta?.dispatchId');
    expect(round1Source).toContain("reason: 'resume_previous_attempt'");
  });

  test('round failure resumes untouched initial dispatches inside Round 1', () => {
    const roundsSource = ORCHESTRATOR_SOURCE.slice(
      ORCHESTRATOR_SOURCE.indexOf('async function runDispatchRounds'),
      ORCHESTRATOR_SOURCE.indexOf('function collectResponses')
    );

    expect(roundsSource).toContain('const untouchedModels =');
    expect(roundsSource).toContain('Number(entry.dispatchAttempts || 0) === 0');
    expect(roundsSource).toContain('await dispatchRound1Sequentially(');
    expect(roundsSource).toContain('ROUND1_RECOVERY_RESUME');
  });
});

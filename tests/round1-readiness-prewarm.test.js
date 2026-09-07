const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'job-orchestrator.js'),
  'utf8'
);

describe('Round 1 readiness isolation', () => {
  test('Round 0 never waits for an all-model readiness barrier', () => {
    const rounds = SOURCE.slice(
      SOURCE.indexOf('async function runDispatchRounds'),
      SOURCE.length
    );
    expect(rounds).not.toContain('await prewarmRound1Readiness');
    expect(rounds).toContain("readinessMode: 'per_model_dispatch_gate'");
    expect(rounds).toContain('await dispatchRound1Sequentially');
  });

  test('each model probes Completion and provider health without a replayed handshake delay', () => {
    const dispatch = fs.readFileSync(
      path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
      'utf8'
    );
    expect(dispatch).toContain('await ensureTabReadyForDispatch(tabId, llmName, { reason })');
    expect(dispatch).toContain('await self.ensureCompletionRuntimeInTab(tabId, llmName)');
    expect(dispatch).toContain('await self.checkScriptHealth(tabId, llmName, { silent: true, timeoutMs: READY_ACK_TIMEOUT_MS })');
    expect(dispatch).toContain('if (!readyOk && runtimeGate == null)');
    const tabManager = fs.readFileSync(
      path.join(__dirname, '..', 'background', 'tab-manager.js'),
      'utf8'
    );
    expect(tabManager).toContain('const acceptsContentScriptReadiness = true');
  });

  test('first pass uses configured order without provider priorities', () => {
    expect(SOURCE).toContain('return [...new Set(source)]');
    expect(SOURCE).toContain('simpleFirstPass: true');
    expect(SOURCE).not.toContain('async function prewarmRound1Readiness');
  });

  test('focus observation leases are outside the provider Send critical section', () => {
    const dispatch = fs.readFileSync(
      path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'),
      'utf8'
    );
    expect(dispatch).not.toContain('startAutomationVisit(tabId, llmName)');
    expect(dispatch).not.toContain('endAutomationVisit(llmName)');
  });
});

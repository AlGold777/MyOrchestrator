const View = require('../results/debate-telemetry-view');

describe('Disput telemetry view', () => {
  test('renders health, plan/fact, diagnoses, participants and raw trace from one report', () => {
    document.body.innerHTML = `
      <div id="disput-health-summary"></div><div id="disput-problems"></div>
      <div id="disput-plan-actual"></div><div id="disput-participants"></div>
      <div id="disput-critical-path"></div><div id="disput-raw-events"></div>
      <span id="disput-trace-status"></span>`;
    const report = {
      metadata: { topology: 'triad', presetId: 'TRIAD_RED_TEAM', dataCompleteness: 'complete' },
      health: { classification: 'degraded_success', terminalOutcome: 'completed', severity: 'warning', manualRecoveryCount: 1, forcedCompletionCount: 0, stateDivergenceCount: 1 },
      runOutcome: { durationMs: 10000 },
      diagnoses: [{ severity: 'high', code: 'STATE_DIVERGENCE', affectedStageId: 'r1:wave', affectedParticipant: 'DeepSeek', summary: 'status mismatch' }],
      stageExecutions: [{ stageId: 'r1:wave', kind: 'opening_batch', expected: { participants: ['Qwen'] }, actual: { participants: ['Qwen'] }, durationMs: 5000, status: 'success', deviations: [] }],
      participantExecutions: [{ participantId: 'Qwen', completedStages: 1, expectedStages: 1, submitStatus: 'confirmed', completionStatus: 'detected', recoveries: 0, finalStatus: 'SUCCESS' }],
      criticalPath: { stageId: 'r1:wave', durationMs: 5000 }, barriers: [],
      events: [{ receivedSeq: 1, sourceTimestamp: Date.now(), eventType: 'RUN_STARTED', source: 'application', severity: 'info', correlation: { stageId: '' }, reasonCode: '' }],
      integrity: { eventsTotal: 1 }
    };
    expect(View.render(report, document)).toBe(true);
    expect(document.getElementById('disput-health-summary').textContent).toContain('degraded_success');
    expect(document.getElementById('disput-problems').textContent).toContain('STATE_DIVERGENCE');
    expect(document.getElementById('disput-plan-actual').textContent).toContain('r1:wave');
    expect(document.getElementById('disput-participants').textContent).toContain('Qwen');
    expect(document.getElementById('disput-raw-events').textContent).toContain('RUN_STARTED');
  });
});

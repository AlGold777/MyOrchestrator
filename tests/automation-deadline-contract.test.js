const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('automation deadline wiring', () => {
  test('budget exhaustion is an actionable terminal boundary', () => {
    const orchestrator = read('background', 'job-orchestrator.js');

    expect(orchestrator).toContain('finalizeAutomationDeadline(llmName, normalizedPhase');
    expect(orchestrator).toContain("entry.skipHumanLoop = true");
    expect(orchestrator).toContain("providerGenerationLeftRunning: true");
    expect(orchestrator).toContain('stopContentAutomationAtDeadline(');
    expect(orchestrator).toContain("type: 'HUMANOID_FORCE_STOP'");
    expect(orchestrator).toContain("type: 'STOP_AND_CLEANUP'");
    expect(orchestrator).toContain('extensionRuntimeStopDispatched');
    expect(orchestrator).toContain("manualRecoveryAvailable: true");
    expect(orchestrator).toContain("type === 'stream_start_timeout' || type === 'automation_deadline'");
    expect(orchestrator).toContain("if (!isSuccess && !metaObj?.automationDeadline)");
    expect(orchestrator).toContain("normalizedPhase === 'generation'");
    expect(orchestrator).toContain('resumedExistingDeadline: true');
    expect(orchestrator).toContain('GENERATION_BUDGET_SHORT_MS = 450000');
    expect(orchestrator).toContain('GENERATION_BUDGET_LONG_MS = 900000');
    expect(orchestrator).toContain('AUTOMATION_DEADLINE_SIGNAL_DEFERRED');
  });

  test('active foreground automation ends before passive generation waiting', () => {
    const shared = read('background', 'shared-state.js');
    const presence = read('background', 'human-presence.js');

    expect(shared).toContain('ACTIVE_FOCUS_WINDOW_STANDARD_MS = 60000');
    expect(shared).toContain('ACTIVE_FOCUS_WINDOW_LONG_MS = 90000');
    expect(shared).toContain('isActiveFocusAllowedForEntry');
    expect(presence).toContain('ACTIVE_FOCUS_WINDOW_EXHAUSTED');
    expect(presence).toContain('passiveGenerationContinues: true');
  });

  test('lifecycle timeout signals the same background deadline owner', () => {
    const detector = read('content-utils', 'response-lifecycle-detector.js');
    const router = read('background', 'message-router.js');

    expect(detector).toContain("type: 'AUTOMATION_DEADLINE_SIGNAL'");
    expect(router).toContain("case 'AUTOMATION_DEADLINE_SIGNAL':");
    expect(router).toContain("self.finalizeAutomationDeadline");
    expect(router).toContain('reportedBudgetMs: Number(message.budgetMs || 0)');
    expect(router).toContain("validateLifecycleCorrelation(message.llmName, message, 'AUTOMATION_DEADLINE_SIGNAL')");
  });

  test('MV3 rehydration restores deadline timestamps instead of trusting persisted timer ids', () => {
    const orchestrator = read('background', 'job-orchestrator.js');

    expect(orchestrator).toContain('record.timerId = null;');
    expect(orchestrator).toContain('record.deadlineAt = Number(record?.deadlineAt || (startedAt + budgetMs));');
    expect(orchestrator).toContain('scheduleBudgetTimer(llmName, normalizedPhase, record');
    expect(orchestrator).toContain('runtimeBudgetTimerIds.has(existing.timerId)');
  });
});

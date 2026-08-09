const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SOURCES = [
  'shared/status-contract.js',
  'shared/answer-length-policy.js',
  'shared/answer-evidence.js',
  'shared/finalization-controller.js',
  'shared/recovery-intent.js',
  'background/job-orchestrator.js'
];

// Regression for run 1786280638177: Z.ai delivered 16 characters, the decision
// recorded `evidence_policy:text_too_short` and `no_accepted_answer` among its
// own blockers, and then accepted the answer as SUCCESS because a manual ping
// waives every contradiction.
function createSandbox() {
  const telemetryEvents = [];
  const context = {
    console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean,
    RegExp, JSON, URL, AbortController, setTimeout, clearTimeout,
    SUCCESS_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'],
    FAILURE_STATUSES: ['ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT'],
    jobState: {
      prompt: 'test prompt',
      attachments: [],
      responsesCollected: 0,
      session: { startTime: 1786280638177, totalModels: 1, selectedModels: ['Z.ai'], completed: 0, failed: 0 },
      llms: {
        'Z.ai': {
          tabId: 77,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 274236,
          lastDispatchMeta: { dispatchId: 'Z.ai:1786280638177:1' }
        }
      }
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn(() => 77), entries: jest.fn(() => []), removeByName: jest.fn() },
    appendLogEntry: jest.fn(),
    updateModelState: jest.fn(),
    sendMessageToResultsTab: jest.fn(),
    getLogSnapshot: jest.fn(() => []),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveJobState: jest.fn(),
    emitTelemetry: jest.fn((llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload })),
    broadcastDiagnostic: jest.fn(),
    clearDeferredAnswerTimer: jest.fn(),
    clearPostSuccessScrollAudit: jest.fn(),
    clearClaudeRetryTimers: jest.fn(),
    resolvePromptSubmitted: jest.fn(),
    executeApiFallback: jest.fn(() => Promise.resolve(false)),
    setRateLimit: jest.fn(),
    getRecentPipelineErrorReason: jest.fn(() => ''),
    scheduleClaudeHardTimeoutRetry: jest.fn(() => false),
    clearBudgetPhases: jest.fn(),
    clearAdaptiveCollectTimer: jest.fn(),
    resolveModelFinalStatus: jest.fn(() => 'SUCCESS'),
    resolveModelDoneReason: jest.fn(() => 'ok'),
    completeHumanPresenceForModel: jest.fn(),
    downgradePipelineHardTimeoutLogs: jest.fn(),
    downgradePipelineHardTimeoutStorage: jest.fn(),
    closePingWindowForLLM: jest.fn(),
    extendPingWindowForLLM: jest.fn(),
    // A blocked success re-pings the page for a better answer; stubbed so the
    // harness exercises that branch instead of dying inside it.
    sendPassiveMessageWithRetries: jest.fn(() => Promise.resolve({ ok: true })),
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  SOURCES.forEach((rel) => vm.runInContext(read(rel), context, { filename: rel }));
  return { context, telemetryEvents };
}

const evidenceFor = (context, answer, extra = {}) => context.buildFinalizationEvidence(
  'Z.ai',
  context.jobState.llms['Z.ai'],
  Object.assign({
    trimmedAnswer: answer,
    finalStatus: 'SUCCESS',
    finalReason: 'generation_inactive',
    completionReason: 'generation_inactive',
    sendConfirmed: true,
    manualRecovery: true,
    responseMeta: { source: 'manual_ping', manualRecovery: true }
  }, extra)
);

describe('a manual ping cannot waive the absence of an answer', () => {
  test('16 characters are refused as a terminal success', () => {
    const { context } = createSandbox();
    const evidence = evidenceFor(context, 'Ответ: 16 симв.');

    expect(evidence.contradictions).toContain('answer_below_terminal_minimum');
    expect(evidence.unwaivableContradictions).toContain('answer_below_terminal_minimum');
    expect(evidence.accepted).toBe(false);
  });

  test('the same manual ping still waives verification strictness on a real answer', () => {
    const { context } = createSandbox();
    const evidence = evidenceFor(context, 'Настоящий ответ модели. '.repeat(40));

    expect(evidence.contradictions).not.toContain('answer_below_terminal_minimum');
    expect(evidence.accepted).toBe(true);
  });

  test('the automatic path refuses the short answer too, for the same reason', () => {
    const { context } = createSandbox();
    const evidence = evidenceFor(context, 'Ответ: 16 симв.', {
      manualRecovery: false,
      responseMeta: { source: 'pipeline' }
    });

    expect(evidence.contradictions).toContain('answer_below_terminal_minimum');
    expect(evidence.accepted).toBe(false);
  });

  test('a terminal failure is not re-blocked by the answer floor', () => {
    const { context } = createSandbox();
    const evidence = evidenceFor(context, '', {
      finalStatus: 'EXTRACT_FAILED',
      finalReason: 'answer_prompt_echo'
    });

    expect(evidence.contradictions).not.toContain('answer_below_terminal_minimum');
  });

  test('the refused answer is kept rather than destroyed', async () => {
    const { context } = createSandbox();
    context.handleLLMResponse('Z.ai', 'Ответ: 16 симв.', null, {
      dispatchId: 'Z.ai:1786280638177:1',
      sessionId: 1786280638177,
      runSessionId: 1786280638177,
      manualRecovery: true,
      responseMeta: {
        source: 'manual_ping',
        completionReason: 'generation_inactive',
        sendConfirmed: true,
        generationActive: false,
        manualRecovery: true
      }
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const entry = context.jobState.llms['Z.ai'];
    expect(entry.finalStatus).not.toBe('SUCCESS');
    expect(entry.pendingFinalAnswer).toBe('Ответ: 16 симв.');
  });
});

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

// Drives the real handleLLMResponse. The point of the test is that the typed
// run result changes the *status the run lands on*, not merely what a pure
// helper returns about it.
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
      session: { startTime: 1781134505984, totalModels: 1, selectedModels: ['Claude'], completed: 0, failed: 0 },
      llms: {
        Claude: {
          tabId: 101,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 30000,
          lastDispatchMeta: { dispatchId: 'Claude:1781134505984:1' }
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
    TabMapManager: { get: jest.fn(() => 101), entries: jest.fn(() => []), removeByName: jest.fn() },
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
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    getBoundTabId: (llmName, entry) => entry?.tabId || context.jobState.llms?.[llmName]?.tabId || null,
    self: null
  };
  context.self = context;
  vm.createContext(context);
  SOURCES.forEach((rel) => vm.runInContext(read(rel), context, { filename: rel }));
  return { context, telemetryEvents };
}

const ANSWER = 'Полный по виду ответ, которого никто не доказал. '.repeat(40);

const deliver = async (context, runResult, extraMeta = {}) => {
  context.handleLLMResponse('Claude', ANSWER, null, {
    dispatchId: 'Claude:1781134505984:1',
    sessionId: 1781134505984,
    runSessionId: 1781134505984,
    manualRecovery: true,
    responseMeta: Object.assign({
      source: 'pipeline',
      completionReason: 'generation_inactive',
      sendConfirmed: true,
      generationActive: false,
      manualRecovery: true,
      runResult
    }, extraMeta)
  }, '');
  await new Promise((resolve) => setTimeout(resolve, 300));
  return context.jobState.llms.Claude;
};

describe('the typed run result gates the background success path', () => {
  test('background manual recovery cannot bypass missing Completion authority', async () => {
    const { context, telemetryEvents } = createSandbox();
    context.CompletionAuthorityRegistry = {
      validateDelivery: jest.fn(() => ({ ok: false, reason: 'missing_success_terminal_authority' }))
    };
    const entry = await deliver(context, {
      type: 'COMMITTED', guarantee: 'STRICT', strongestEvidenceClass: 'P0'
    });
    expect(entry.finalStatus).not.toBe('SUCCESS');
    expect(telemetryEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'ANSWER_DELIVERY_REJECTED' })
    ]));
  });

  test('an UNKNOWN run does not land as SUCCESS', async () => {
    const { context } = createSandbox();
    const entry = await deliver(context, {
      type: 'UNKNOWN', guarantee: 'BLIND', strongestEvidenceClass: 'P4'
    });

    expect(entry.finalStatus).toBeTruthy();
    expect(entry.finalStatus).not.toBe('SUCCESS');
  });

  test('an OBSERVER_LOST run does not land as SUCCESS either', async () => {
    const { context } = createSandbox();
    const entry = await deliver(context, {
      type: 'OBSERVER_LOST', guarantee: 'BLIND', strongestEvidenceClass: 'P3'
    });

    expect(entry.finalStatus).not.toBe('SUCCESS');
  });

  test('the refusal is recorded as a contradiction naming the run result', async () => {
    const { context } = createSandbox();
    const entry = await deliver(context, {
      type: 'UNKNOWN', guarantee: 'BLIND', strongestEvidenceClass: 'P4'
    });

    const contradictions = entry.finalizationEvidence?.contradictions || [];
    expect(contradictions).toContain('unproven_run_result_unknown');
  });

  test('the same answer with a committed run result is accepted as SUCCESS', async () => {
    const { context } = createSandbox();
    const entry = await deliver(context, {
      type: 'COMMITTED', guarantee: 'STRICT', strongestEvidenceClass: 'P0'
    });

    expect(entry.finalStatus).toBe('SUCCESS');
    expect(entry.doneReason).not.toBe('error');
  });

  test('a run with no typed result at all keeps the previous behaviour', async () => {
    const { context } = createSandbox();
    const entry = await deliver(context, null);

    expect(entry.finalStatus).toBe('SUCCESS');
  });
});

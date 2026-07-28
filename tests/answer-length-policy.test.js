const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AnswerLengthPolicy = require('../shared/answer-length-policy.js');
const AnswerEvidence = require('../shared/answer-evidence.js');

const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-length-policy.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');

describe('AnswerLengthPolicy module', () => {
  test('default policy exposes explicit thresholds', () => {
    const policy = AnswerLengthPolicy.getPolicy('GPT');
    expect(policy.minTerminalChars).toBe(80);
    expect(policy.stableForceMinChars).toBe(1200);
    expect(policy.snapshotTerminalMinChars).toBe(2400);
    expect(policy.shortSuccessSuspectMaxChars).toBe(800);
  });

  test('describePolicy carries a stable policyRef', () => {
    const described = AnswerLengthPolicy.describePolicy('Claude');
    expect(described.policyRef).toBe('answer-length-policy@2');
    expect(described.hasModelOverride).toBe(false);
  });

  test('evaluateTerminalAnswerLength flags suspect short SUCCESS (Claude len=233 case)', () => {
    const evaluation = AnswerLengthPolicy.evaluateTerminalAnswerLength('Claude', 233, { finalStatus: 'SUCCESS' });
    expect(evaluation.meetsTerminalMin).toBe(true);
    expect(evaluation.suspectShortSuccess).toBe(true);
    expect(evaluation.policyRef).toBe('answer-length-policy@2');
  });

  test('long SUCCESS and short PARTIAL are not flagged as suspect success', () => {
    expect(AnswerLengthPolicy.evaluateTerminalAnswerLength('GPT', 3861, { finalStatus: 'SUCCESS' }).suspectShortSuccess).toBe(false);
    expect(AnswerLengthPolicy.evaluateTerminalAnswerLength('Gemini', 184, { finalStatus: 'PARTIAL' }).suspectShortSuccess).toBe(false);
  });

  test('text below minTerminalChars never meets terminal minimum', () => {
    const evaluation = AnswerLengthPolicy.evaluateTerminalAnswerLength('Qwen', 42, { finalStatus: 'SUCCESS' });
    expect(evaluation.meetsTerminalMin).toBe(false);
  });

  test('answer-evidence defaults match the policy single source of truth', () => {
    expect(AnswerEvidence.DEFAULT_MIN_CHARS).toBe(AnswerLengthPolicy.DEFAULTS.minTerminalChars);
    expect(AnswerEvidence.DEFAULT_STABLE_MIN_CHARS).toBe(AnswerLengthPolicy.DEFAULTS.stableForceMinChars);
    expect(AnswerEvidence.DEFAULT_SNAPSHOT_TERMINAL_MIN_CHARS).toBe(AnswerLengthPolicy.DEFAULTS.snapshotTerminalMinChars);
  });
});

describe('finalization evidence references the answer length policy', () => {
  function createSandbox() {
    const telemetryEvents = [];
    const context = {
      console,
      Promise,
      Map,
      Set,
      Date,
      Math,
      Array,
      Object,
      Number,
      String,
      Boolean,
      RegExp,
      JSON,
      URL,
      AbortController,
      setTimeout,
      clearTimeout,
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
    vm.runInContext(STATUS_CONTRACT_SOURCE, context, { filename: 'shared/status-contract.js' });
    vm.runInContext(ANSWER_LENGTH_POLICY_SOURCE, context, { filename: 'shared/answer-length-policy.js' });
    vm.runInContext(ANSWER_EVIDENCE_SOURCE, context, { filename: 'shared/answer-evidence.js' });
    vm.runInContext(FINALIZATION_CONTROLLER_SOURCE, context, { filename: 'shared/finalization-controller.js' });
    vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });

    return { context, telemetryEvents };
  }

  test('terminal SUCCESS evidence carries the lengthPolicy reference', () => {
    const { context } = createSandbox();
    const evidence = context.buildFinalizationEvidence('Claude', context.jobState.llms.Claude, {
      trimmedAnswer: 'a'.repeat(3000),
      finalStatus: 'SUCCESS',
      finalReason: 'stable_text',
      sendConfirmed: true
    });
    expect(evidence.lengthPolicy).toBeTruthy();
    expect(evidence.lengthPolicy.policyRef).toBe('answer-length-policy@2');
    expect(evidence.lengthPolicy.meetsTerminalMin).toBe(true);
    expect(evidence.lengthPolicy.suspectShortSuccess).toBe(false);
  });

  test('short SUCCESS evidence (233 chars, Claude case from run 1781134505984) is flagged as suspect', () => {
    const { context } = createSandbox();
    const evidence = context.buildFinalizationEvidence('Claude', context.jobState.llms.Claude, {
      trimmedAnswer: 'к'.repeat(233),
      finalStatus: 'SUCCESS',
      finalReason: 'generation_inactive',
      sendConfirmed: true
    });
    expect(evidence.lengthPolicy.policyRef).toBe('answer-length-policy@2');
    expect(evidence.lengthPolicy.meetsTerminalMin).toBe(true);
    expect(evidence.lengthPolicy.suspectShortSuccess).toBe(true);
  });

  test('accepted short SUCCESS emits ANSWER_LENGTH_SUSPECT telemetry', async () => {
    const { context, telemetryEvents } = createSandbox();
    const shortAnswer = 'к'.repeat(233);
    context.handleLLMResponse('Claude', shortAnswer, null, {
      dispatchId: 'Claude:1781134505984:1',
      sessionId: 1781134505984,
      runSessionId: 1781134505984,
      manualRecovery: true,
      responseMeta: {
        source: 'manual_recovery',
        completionReason: 'generation_inactive',
        sendConfirmed: true,
        generationActive: false,
        manualRecovery: true
      }
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const entry = context.jobState.llms.Claude;
    expect(entry.finalStatus).toBe('SUCCESS');
    expect(entry.finalizationEvidence?.lengthPolicy?.policyRef).toBe('answer-length-policy@2');

    const suspectEvents = telemetryEvents.filter((evt) => evt.event === 'ANSWER_LENGTH_SUSPECT');
    expect(suspectEvents.length).toBeGreaterThanOrEqual(1);
    expect(suspectEvents[0].payload?.meta?.suspectShortSuccess).toBe(true);
  });

  test('failure terminal does not emit ANSWER_LENGTH_SUSPECT', async () => {
    const { context, telemetryEvents } = createSandbox();
    context.handleLLMResponse('Claude', 'Error: extract_failed_round4_gate_timeout', {
      type: 'extract_failed',
      message: 'gate timeout'
    }, {
      dispatchId: 'Claude:1781134505984:1',
      sessionId: 1781134505984,
      runSessionId: 1781134505984
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(telemetryEvents.filter((evt) => evt.event === 'ANSWER_LENGTH_SUSPECT')).toHaveLength(0);
  });
});

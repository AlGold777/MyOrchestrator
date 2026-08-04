const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-length-policy.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');
const RECOVERY_INTENT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'recovery-intent.js'), 'utf8');
const ANSWER_VERIFICATION_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-verification.js'), 'utf8');

function createSandbox({ llms } = {}) {
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
      session: { startTime: 1781159284885, totalModels: 1, selectedModels: Object.keys(llms || {}), completed: 0, failed: 0 },
      llms: llms || {}
    },
    chrome: {
      tabs: { sendMessage: jest.fn(() => Promise.resolve()) },
      scripting: { executeScript: jest.fn(() => Promise.resolve([])) },
      storage: { local: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve({})) } },
      runtime: { lastError: null }
    },
    CompressedStorage: { set: jest.fn(() => Promise.resolve()), get: jest.fn(() => Promise.resolve(null)) },
    TabMapManager: { get: jest.fn(() => 404), entries: jest.fn(() => []), removeByName: jest.fn() },
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
  vm.runInContext(RECOVERY_INTENT_SOURCE, context, { filename: 'shared/recovery-intent.js' });
  vm.runInContext(ANSWER_VERIFICATION_SOURCE, context, { filename: 'shared/answer-verification.js' });
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return { context, telemetryEvents };
}


const RUN_SESSION_ID = 1781159284885;
const DISPATCH_ID = 'Perplexity:1781159284885:1';
// Long enough to clear the stable-evidence minimum (answer-length policy).
const LONG_ANSWER = 'Полный ответ провайдера. '.repeat(120);

function openEntry(overrides = {}) {
  return {
    tabId: 404,
    status: 'GENERATING',
    dispatchAttempts: 1,
    generationEpoch: 1,
    anchorAnswerCount: 3,
    lastDispatchAt: Date.now() - 20000,
    lastDispatchMeta: { dispatchId: DISPATCH_ID, generationEpoch: 1 },
    ...overrides
  };
}

describe('pre-insertion failure deferral', () => {
  test('an attachment failure before insertion is deferred instead of finalized', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry() } });
    const entry = context.jobState.llms.Grok;

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', entry, {
      isSuccess: false,
      answerText: '',
      error: { type: 'attachment_failed', message: 'Grok attachment upload not confirmed' },
      finalStatus: 'USER_ACTION_REQUIRED',
      failureClassification: { class: 'dispatch', type: 'attachment_failed' },
      dispatchId: DISPATCH_ID
    });

    expect(decision.defer).toBe(true);
    expect(decision.attempt).toBe(1);
  });

  test('deferral keeps the model dispatchable and reports itself', () => {
    const { context, telemetryEvents } = createSandbox({ llms: { Grok: openEntry({ dispatchInFlight: true, messageSent: true, dispatchState: 'SUBMITTING', csBusyUntil: Date.now() + 60000 }) } });
    const entry = context.jobState.llms.Grok;

    context.applyPreInsertionFailureDeferral('Grok', entry, {
      reason: 'attachment_failed',
      failureClass: 'dispatch',
      finalStatus: 'USER_ACTION_REQUIRED',
      dispatchId: DISPATCH_ID,
      attempt: 1
    });

    expect(entry.preInsertionDeferralCount).toBe(1);
    expect(entry.dispatchInFlight).toBe(false);
    expect(entry.messageSent).toBe(false);
    expect(entry.dispatchState).toBe('IDLE');
    expect(entry.csBusyUntil).toBe(0);
    expect(entry.finalStatusRecorded).toBeFalsy();
    expect(telemetryEvents.map((event) => event.event)).toContain('PRE_INSERTION_FAILURE_DEFERRED');
  });

  test('a prompt that reached the composer is never deferred', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry({ promptInsertedAt: Date.now(), promptInsertedDispatchId: DISPATCH_ID }) } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: '',
      error: { type: 'generic_error', message: 'adapter failed' },
      finalStatus: 'UNCERTAIN',
      failureClassification: { class: 'unknown', type: 'generic_error' },
      dispatchId: DISPATCH_ID
    });

    expect(decision).toEqual({ defer: false, reason: 'prompt_already_inserted' });
  });

  test('a blocker that needs a human terminates immediately', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry() } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: '',
      error: { type: 'auth_required', message: 'login required' },
      finalStatus: 'USER_ACTION_REQUIRED',
      failureClassification: { class: 'page_readiness', type: 'auth_required' },
      dispatchId: DISPATCH_ID
    });

    expect(decision).toEqual({ defer: false, reason: 'user_action_required' });
  });

  test('the budget is one deferral per model', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry({ preInsertionDeferralCount: 1 }) } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: '',
      error: { type: 'attachment_failed', message: 'attachment upload not confirmed' },
      finalStatus: 'USER_ACTION_REQUIRED',
      failureClassification: { class: 'dispatch', type: 'attachment_failed' },
      dispatchId: DISPATCH_ID
    });

    expect(decision).toEqual({ defer: false, reason: 'deferral_budget_exhausted' });
  });

  test('a last-resort terminal is never deferred', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry() } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: '',
      error: { type: 'automation_deadline', message: 'deadline' },
      finalStatus: 'STREAM_TIMEOUT',
      failureClassification: { class: 'generation', type: 'automation_deadline' },
      dispatchId: DISPATCH_ID,
      lastResortTerminal: true
    });

    expect(decision).toEqual({ defer: false, reason: 'last_resort_terminal' });
  });

  test('a failure from an earlier dispatch never touches the live one', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry() } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: '',
      error: { type: 'generic_error', message: 'adapter failed' },
      finalStatus: 'UNCERTAIN',
      failureClassification: { class: 'unknown', type: 'generic_error' },
      dispatchId: 'Grok:1781159284885:0'
    });

    expect(decision).toEqual({ defer: false, reason: 'foreign_dispatch' });
  });

  test('an answer that arrived is not a bare failure', () => {
    const { context } = createSandbox({ llms: { Grok: openEntry() } });

    const decision = context.evaluatePreInsertionFailureDeferral('Grok', context.jobState.llms.Grok, {
      isSuccess: false,
      answerText: LONG_ANSWER,
      error: { type: 'generic_error', message: 'partial' },
      finalStatus: 'PARTIAL',
      failureClassification: { class: 'extraction', type: 'generic_error' },
      dispatchId: DISPATCH_ID
    });

    expect(decision).toEqual({ defer: false, reason: 'not_a_bare_failure' });
  });
});

describe('submission inferred from answer evidence', () => {
  const inferredEntry = (overrides = {}) => openEntry({
    promptSubmittedAt: Date.now() - 5000,
    confirmedDispatchId: DISPATCH_ID,
    submitSource: 'inferred_answer_evidence',
    answer: LONG_ANSWER,
    answerFreshness: { fresh: true, dispatchId: DISPATCH_ID },
    ...overrides
  });

  const evidenceFor = (context, entry) => context.buildFinalizationEvidence('Perplexity', entry, {
    trimmedAnswer: LONG_ANSWER,
    finalStatus: 'SUCCESS',
    finalReason: 'ok',
    dispatchId: DISPATCH_ID,
    responseMeta: { source: 'content_script' },
    metaObj: { dispatchId: DISPATCH_ID }
  });

  test('a fresh inferred submission counts as confirmation', () => {
    const { context } = createSandbox({ llms: { Perplexity: inferredEntry() } });
    const evidence = evidenceFor(context, context.jobState.llms.Perplexity);

    expect(evidence.automaticSubmissionConfirmed).toBe(true);
    expect(evidence.contradictions).not.toContain('automatic_finalization_before_submit_confirmation');
  });

  test('an inferred submission over the pre-dispatch baseline stays unconfirmed', () => {
    const baselineText = LONG_ANSWER;
    const { context } = createSandbox({
      llms: {
        Perplexity: inferredEntry({
          preDispatchAnswerSignature: baselineText.replace(/\s+/g, ' ').trim().toLowerCase(),
          preDispatchAnswerCapturedAt: Date.now() - 1000,
          preDispatchAnswerDispatchId: DISPATCH_ID
        })
      }
    });
    const evidence = evidenceFor(context, context.jobState.llms.Perplexity);

    expect(evidence.staleBaseline).toBe(true);
    expect(evidence.automaticSubmissionConfirmed).toBe(false);
    expect(evidence.contradictions).toContain('automatic_finalization_before_submit_confirmation');
    expect(evidence.accepted).toBe(false);
  });
});

describe('acceptance on stable evidence', () => {
  const verification = (overrides = {}) => ({
    verified: false,
    state: 'candidate',
    resolution: 'heuristic',
    structuralComplete: true,
    generationActive: false,
    lengthRegressionActive: false,
    selectedLength: LONG_ANSWER.length,
    runSessionId: RUN_SESSION_ID,
    dispatchId: DISPATCH_ID,
    generationEpoch: 1,
    turnAnchor: 3,
    ...overrides
  });

  const confirmedEntry = (overrides = {}) => openEntry({
    promptSubmittedAt: Date.now() - 30000,
    confirmedDispatchId: DISPATCH_ID,
    submitSource: 'content',
    answer: LONG_ANSWER,
    answerFreshness: { fresh: true, dispatchId: DISPATCH_ID },
    ...overrides
  });

  const evidenceFor = (context, entry, verificationOverrides = {}) => context.buildFinalizationEvidence('DeepSeek', entry, {
    trimmedAnswer: LONG_ANSWER,
    finalStatus: 'SUCCESS',
    finalReason: 'generation_inactive',
    dispatchId: DISPATCH_ID,
    completionReason: 'generation_inactive',
    // Mirrors run 1785853347152: the answer materialized through deferred
    // finalization with generation observed inactive.
    responseMeta: {
      source: 'deferred_finalization',
      completionReason: 'generation_inactive',
      answerVerification: verification(verificationOverrides)
    },
    metaObj: { dispatchId: DISPATCH_ID }
  });

  test('a complete answer blocked only by verifier strictness is accepted', () => {
    const { context } = createSandbox({ llms: { DeepSeek: confirmedEntry() } });
    const evidence = evidenceFor(context, context.jobState.llms.DeepSeek);

    expect(evidence.accepted).toBe(true);
    expect(evidence.acceptedOnStableEvidence).toBe(true);
    expect(evidence.liftedContradictions).toEqual(['answer_not_verified']);
    expect(evidence.contradictions).toEqual([]);
  });

  test('a generation still running is not stable evidence', () => {
    const { context } = createSandbox({ llms: { DeepSeek: confirmedEntry() } });
    const evidence = evidenceFor(context, context.jobState.llms.DeepSeek, { generationActive: true });

    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toContain('answer_not_verified');
    expect(evidence.liftedContradictions).toEqual([]);
  });

  test('an identity mismatch is never lifted', () => {
    const { context } = createSandbox({ llms: { DeepSeek: confirmedEntry() } });
    const evidence = evidenceFor(context, context.jobState.llms.DeepSeek, { dispatchId: 'DeepSeek:other:9' });

    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toContain('answer_not_verified');
    expect(evidence.liftedContradictions).toEqual([]);
  });

  test('the pre-dispatch baseline is never lifted', () => {
    const { context } = createSandbox({
      llms: {
        DeepSeek: confirmedEntry({
          preDispatchAnswerSignature: LONG_ANSWER.replace(/\s+/g, ' ').trim().toLowerCase(),
          preDispatchAnswerCapturedAt: Date.now() - 1000,
          preDispatchAnswerDispatchId: DISPATCH_ID
        })
      }
    });
    const evidence = evidenceFor(context, context.jobState.llms.DeepSeek);

    expect(evidence.accepted).toBe(false);
    expect(evidence.contradictions).toContain('stale_baseline_candidate');
    expect(evidence.liftedContradictions).toEqual([]);
  });

  test('the blocked reasons reach telemetry', () => {
    const { context, telemetryEvents } = createSandbox({ llms: { DeepSeek: confirmedEntry() } });
    const evidence = evidenceFor(context, context.jobState.llms.DeepSeek, { generationActive: true });

    context.emitFinalizationDecision('DeepSeek', evidence);
    const decision = telemetryEvents.find((event) => event.event === 'FINALIZATION_DECISION');

    expect(decision.payload.meta.decisionReasons).toContain('answer_not_verified');
    expect(decision.payload.meta.decisionAccepted).toBe(false);
  });
});

describe('round 2 repair is provider-independent', () => {
  test('no model allowlist gates the repair dispatch', () => {
    expect(JOB_ORCHESTRATOR_SOURCE).not.toContain('ROUND2_REPAIR_MODELS');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('const ROUND2_REPAIR_OPT_OUT_MODELS = new Set();');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('canRepairDispatchInRound2(llmName)');
  });
});

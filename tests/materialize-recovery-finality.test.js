const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB_ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
const STATUS_CONTRACT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8');
const ANSWER_LENGTH_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-length-policy.js'), 'utf8');
const ANSWER_EVIDENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-evidence.js'), 'utf8');
const FINALIZATION_CONTROLLER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'finalization-controller.js'), 'utf8');
const RECOVERY_INTENT_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'recovery-intent.js'), 'utf8');

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
  vm.runInContext(JOB_ORCHESTRATOR_SOURCE, context, { filename: 'background/job-orchestrator.js' });
  return { context, telemetryEvents };
}

describe('classifyMaterializeRecoveryFinality', () => {
  const grokEntry = () => ({
    tabId: 404,
    dispatchAttempts: 1,
    promptSubmittedAt: Date.now() - 200000,
    lastDispatchMeta: { dispatchId: 'Grok:1781159284885:1' }
  });

  test('hard stop without completion evidence is PARTIAL (Grok run 1781159284885)', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const finality = context.classifyMaterializeRecoveryFinality(
      'script_runtime_hard_stop',
      context.jobState.llms.Grok,
      'ok'
    );
    expect(finality.partial).toBe(true);
    expect(finality.completionReason).toBe('hard_stop_recovered_partial');
  });

  test('hard stop WITH completion evidence keeps success finality', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const entry = context.jobState.llms.Grok;
    entry.answerCompleteDetectedAt = Date.now() - 30000;
    const finality = context.classifyMaterializeRecoveryFinality('script_runtime_hard_stop', entry, 'ok');
    expect(finality.partial).toBe(false);
    expect(finality.completionReason).toBe('materialize_recovery');
  });

  test('no_send recovery without completion evidence stays PARTIAL', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const finality = context.classifyMaterializeRecoveryFinality('no_send', context.jobState.llms.Grok, 'ok');
    expect(finality.partial).toBe(true);
    expect(finality.completionReason).toBe('materialize_recovered_unconfirmed_complete');
  });

  test('partial_from_snapshot stays partial regardless of context', () => {
    const { context } = createSandbox({ llms: { Grok: grokEntry() } });
    const entry = context.jobState.llms.Grok;
    entry.answerCompleteDetectedAt = Date.now();
    const finality = context.classifyMaterializeRecoveryFinality('no_send', entry, 'partial_from_snapshot');
    expect(finality.partial).toBe(true);
    expect(finality.completionReason).toBe('soft_timeout');
  });
});

describe('provider-independent unconfirmed-send recovery', () => {
  test('a future model receives the common recovery policy without an allowlist entry', () => {
    const { context } = createSandbox({
      llms: {
        FutureProvider: {
          tabId: 404,
          lastDispatchMeta: { dispatchId: 'FutureProvider:run:1' }
        }
      }
    });

    expect(context.isUnconfirmedSendFailure(
      'NO_SEND',
      'FutureProvider send was not confirmed',
      { type: 'send_failed', message: 'FutureProvider send was not confirmed' }
    )).toBe(true);
    expect(context.shouldMaterializeBeforeTerminal(
      'FutureProvider',
      'NO_SEND',
      'FutureProvider send was not confirmed',
      { type: 'send_failed', message: 'FutureProvider send was not confirmed' },
      {}
    )).toBe(true);
    expect(context.shouldMaterializeBeforeTerminal(
      'FutureProvider',
      'ERROR',
      'FutureProvider submission failed',
      { type: 'send_failed', message: 'FutureProvider submission failed' },
      {}
    )).toBe(true);
    expect(JOB_ORCHESTRATOR_SOURCE).not.toContain('PRE_TERMINAL_MATERIALIZE_MODELS');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('UNCONFIRMED_SEND_OBSERVATION_OFFSETS_MS');
  });

  test('attachment failures do not enter send recovery', () => {
    const { context } = createSandbox({ llms: { FutureProvider: { tabId: 404 } } });
    expect(context.shouldMaterializeBeforeTerminal(
      'FutureProvider',
      'NO_SEND',
      'attachment upload not confirmed',
      { type: 'attachment_failed', message: 'attachment upload not confirmed' },
      {}
    )).toBe(false);
  });

  test('inline recovery forwards positional freshness, including a captured zero anchor', () => {
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('hasCapturedAnchor && baseCandidates.length > anchorAnswerCount');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('base.anchorAnswerCount = anchorCount');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('anchorApplied: inline.anchorApplied === true');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('freshTurnEvidence: inline.anchorApplied === true');
  });
});

describe('materialize recovery freshness gate', () => {
  const dispatchId = 'Z.ai:1783967821737:1';
  const oldAnswer = 'старый ответ Z.ai '.repeat(160);

  test('rejects the telemetry incident: no submit, no lifecycle, result equals baseline', () => {
    const { context } = createSandbox({
      llms: {
        'Z.ai': {
          tabId: 404,
          pendingFinalAnswer: oldAnswer,
          preDispatchAnswerSignature: oldAnswer.replace(/\s+/g, ' ').trim().toLowerCase(),
          preDispatchAnswerDispatchId: dispatchId,
          preDispatchAnswerCapturedAt: Date.now(),
          lastDispatchMeta: { dispatchId }
        }
      }
    });
    const entry = context.jobState.llms['Z.ai'];
    const validation = context.validateMaterializedAnswerEvidence('Z.ai', oldAnswer, {
      source: 'preserved_pending', entry, dispatchId
    });
    const gate = context.shouldAcceptMaterializeRecoveryResult('Z.ai', entry, {
      text: oldAnswer,
      source: 'preserved_pending'
    }, { text: oldAnswer, source: 'preserved_pending', dispatchId });

    expect(validation).toEqual(expect.objectContaining({ valid: false, rejectReason: 'stale_baseline_answer' }));
    expect(gate).toEqual(expect.objectContaining({ ok: false, reason: 'stale_baseline_answer' }));
  });

  test('rejects non-baseline preserved text when current-run freshness is still unproven', () => {
    const { context } = createSandbox({
      llms: {
        Qwen: {
          tabId: 404,
          pendingFinalAnswer: 'different candidate '.repeat(100),
          lastDispatchMeta: { dispatchId: 'Qwen:run:1' }
        }
      }
    });
    const entry = context.jobState.llms.Qwen;
    const gate = context.shouldAcceptMaterializeRecoveryResult('Qwen', entry, {
      text: entry.pendingFinalAnswer,
      source: 'preserved_pending'
    }, { text: entry.pendingFinalAnswer, source: 'preserved_pending', dispatchId: 'Qwen:run:1' });

    expect(gate).toEqual(expect.objectContaining({
      ok: false,
      reason: 'materialize_recovery_freshness_unproven',
      attributionState: 'unproven'
    }));
  });

  test('delivers complete content with unproven attribution as a non-terminal marked artifact', () => {
    const answer = 'complete but ownership-unproven answer '.repeat(100);
    const { context, telemetryEvents } = createSandbox({
      llms: {
        Qwen: {
          tabId: 404,
          status: 'NO_SEND',
          lastDispatchMeta: { dispatchId: 'Qwen:run:2' },
          answerVerification: {
            verified: true,
            resolution: 'exact',
            structuralComplete: true,
            generationActive: false,
            selectedLength: answer.trim().length,
            lengthRegressionActive: false
          }
        }
      }
    });
    const entry = context.jobState.llms.Qwen;
    const gate = context.shouldAcceptMaterializeRecoveryResult('Qwen', entry, {
      text: answer,
      source: 'late_collect'
    }, { text: answer, source: 'late_collect', dispatchId: 'Qwen:run:2' });

    expect(context.preserveUnprovenMaterializeArtifact('Qwen', entry, {
      text: answer,
      html: '<p>answer</p>',
      source: 'late_collect'
    }, { text: answer, source: 'late_collect', dispatchId: 'Qwen:run:2' }, gate)).toBe(true);
    expect(entry).toEqual(expect.objectContaining({
      status: 'RECEIVING',
      pendingFinalAnswer: answer.trim(),
      attributionState: 'unproven',
      answerState: 'candidate',
      unverifiedArtifact: expect.objectContaining({
        text: answer.trim(),
        completenessState: 'complete',
        attributionState: 'unproven'
      })
    }));
    expect(entry.finalStatusRecorded).not.toBe(true);
    expect(context.sendMessageToResultsTab).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'Qwen',
      answer: answer.trim(),
      metadata: expect.objectContaining({
        status: 'RECEIVING',
        terminal: false,
        attributionState: 'unproven',
        attributionLabel: 'Attribution unverified'
      })
    }));
    expect(telemetryEvents).toContainEqual(expect.objectContaining({
      llmName: 'Qwen',
      event: 'MATERIALIZE_RECOVERY_CONTENT_UNVERIFIED'
    }));
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('preserveUnprovenMaterializeArtifact(llmName, afterVisit, result, evidence.summary, materializeGate)');
    expect(JOB_ORCHESTRATOR_SOURCE).toContain('delete entry.unverifiedArtifact;');
  });

  test('allows a non-baseline candidate after content-confirmed submission', () => {
    const { context } = createSandbox({
      llms: {
        DeepSeek: {
          tabId: 404,
          pendingFinalAnswer: 'fresh DeepSeek answer '.repeat(100),
          promptSubmittedAt: Date.now() - 10000,
          submitSource: 'content',
          confirmedDispatchId: 'DeepSeek:run:1',
          lastDispatchMeta: { dispatchId: 'DeepSeek:run:1' }
        }
      }
    });
    const entry = context.jobState.llms.DeepSeek;
    const gate = context.shouldAcceptMaterializeRecoveryResult('DeepSeek', entry, {
      text: entry.pendingFinalAnswer,
      source: 'preserved_pending'
    }, { text: entry.pendingFinalAnswer, source: 'preserved_pending', dispatchId: 'DeepSeek:run:1' });

    expect(gate.ok).toBe(true);
  });

  test('Qwen cannot infer submit from an unproven preserved candidate', () => {
    const { context } = createSandbox({
      llms: {
        Qwen: {
          tabId: 404,
          status: 'RECOVERABLE_ERROR',
          lastDispatchMeta: { dispatchId: 'Qwen:run:1' }
        }
      }
    });
    const entry = context.jobState.llms.Qwen;
    const allowed = context.shouldInferSubmitFromAnswerEvidence('Qwen', entry, {
      trimmedAnswer: 'candidate answer '.repeat(100),
      metaObj: { dispatchId: 'Qwen:run:1', preTerminalMaterialize: true },
      responseMeta: { source: 'preserved_pending', recovered: true }
    });

    expect(allowed).toBe(false);
  });
});

describe('hard-stop recovered answer finalizes as PARTIAL end-to-end', () => {
  test('acceptLateCollectResult with hard-stop partial meta produces PARTIAL terminal', async () => {
    const { context } = createSandbox({
      llms: {
        Grok: {
          tabId: 404,
          dispatchAttempts: 1,
          promptSubmittedAt: Date.now() - 200000,
          lastDispatchMeta: { dispatchId: 'Grok:1781159284885:1' }
        }
      }
    });
    const entry = context.jobState.llms.Grok;
    const recoveredText = 'к'.repeat(550);
    const finality = context.classifyMaterializeRecoveryFinality('script_runtime_hard_stop', entry, 'ok');

    const accepted = context.acceptLateCollectResult('Grok', {
      ok: true,
      text: recoveredText,
      html: '',
      source: 'preserved_pending',
      status: 'ok'
    }, {
      dispatchId: 'Grok:1781159284885:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885,
      preTerminalMaterialize: true,
      materializeLatestEvidence: true,
      responseMeta: {
        source: 'preserved_pending',
        completionReason: finality.completionReason,
        sanityConfidence: finality.partial ? 0.72 : 0.86,
        partial: finality.partial,
        recovered: true
      }
    });
    expect(accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(entry.finalStatus).toBe('PARTIAL');
    expect(entry.finalizationEvidence?.lengthPolicy?.policyRef).toBe('answer-length-policy@2');
  });
});

describe('recovered final upgrade requires confirmed dispatch (run 1782940321214 Le Chat case)', () => {
  const lockedUncertainEntry = () => ({
    tabId: 505,
    dispatchAttempts: 1,
    finalStatusRecorded: true,
    finalStatus: 'UNCERTAIN',
    status: 'UNCERTAIN',
    lastDispatchMeta: { dispatchId: 'Le Chat:1782940321214:1' }
  });

  test('stale snapshot answer cannot upgrade locked UNCERTAIN when the prompt was never submitted', async () => {
    const { context, telemetryEvents } = createSandbox({ llms: { 'Le Chat': lockedUncertainEntry() } });
    const entry = context.jobState.llms['Le Chat'];
    context.handleLLMResponse('Le Chat', 'с'.repeat(2037), null, {
      dispatchId: 'Le Chat:1782940321214:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885,
      responseMeta: { source: 'snapshot_cache', recovered: true }
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(entry.finalStatus).toBe('UNCERTAIN');
    expect(telemetryEvents.some((e) => e.event === 'RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND')).toBe(true);
  });

  test('confirmed dispatch alone cannot upgrade a locked failure without structural proof', async () => {
    const llms = { 'Le Chat': lockedUncertainEntry() };
    llms['Le Chat'].promptSubmittedAt = Date.now() - 60000;
    const { context } = createSandbox({ llms });
    const entry = context.jobState.llms['Le Chat'];
    context.handleLLMResponse('Le Chat', 'с'.repeat(2037), null, {
      dispatchId: 'Le Chat:1782940321214:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885,
      responseMeta: { source: 'snapshot_cache', recovered: true }
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(entry.finalStatus).toBe('UNCERTAIN');
  });

  test('manual recovery keeps its existing bypass even without submit confirmation', async () => {
    const { context, telemetryEvents } = createSandbox({ llms: { 'Le Chat': lockedUncertainEntry() } });
    context.handleLLMResponse('Le Chat', 'с'.repeat(2037), null, {
      dispatchId: 'Le Chat:1782940321214:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885,
      manualRecovery: true,
      responseMeta: { source: 'manual_latest_recovery', manualRecovery: true }
    }, '');
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(telemetryEvents.some((e) => e.event === 'RECOVERED_FINAL_UPGRADE_BLOCKED_UNCONFIRMED_SEND')).toBe(false);
  });
});

describe('manual latest recovery replaces a stale terminal answer (run 1782945983672 Grok case)', () => {
  const staleText = 'старый ответ из прошлой сессии '.repeat(420); // ~13k chars
  const freshText = 'настоящий последний ответ модели '.repeat(70); // ~2.3k chars, shorter
  const grokEntryWithStaleSuccess = () => ({
    tabId: 606,
    dispatchAttempts: 1,
    promptSubmittedAt: Date.now() - 120000,
    finalStatusRecorded: true,
    finalStatus: 'SUCCESS',
    status: 'SUCCESS',
    answer: staleText,
    lastDispatchMeta: { dispatchId: 'Grok:1782945983672:1' }
  });
  const manualLatestMeta = () => ({
    dispatchId: 'Grok:1782945983672:1',
    sessionId: 1781159284885,
    runSessionId: 1781159284885,
    manualLatestRecovery: true,
    manualRecovery: { manualRecovery: true, manualLatestRecovery: true },
    responseMeta: {
      manualRecovery: true,
      manualOverride: true,
      manualLatestRecovery: true,
      source: 'manual_latest_recovery',
      completionReason: 'manual_latest_recovery'
    }
  });

  test('explicit dblclick recovery replaces the terminal answer with a shorter different candidate', async () => {
    const { context } = createSandbox({ llms: { Grok: grokEntryWithStaleSuccess() } });
    const entry = context.jobState.llms.Grok;
    const accepted = context.acceptLateCollectResult('Grok', {
      ok: true,
      text: freshText,
      html: '',
      source: 'inline_executeScript',
      status: 'ok'
    }, manualLatestMeta());
    expect(accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(entry.answer.trim()).toBe(freshText.trim());
    expect(context.appendLogEntry).toHaveBeenCalledWith('Grok', expect.objectContaining({
      label: 'Terminal answer replaced by manual latest recovery'
    }));
  });

  test('automated late collect still refuses to shrink a terminal answer', async () => {
    const { context } = createSandbox({ llms: { Grok: grokEntryWithStaleSuccess() } });
    const entry = context.jobState.llms.Grok;
    context.acceptLateCollectResult('Grok', {
      ok: true,
      text: freshText,
      html: '',
      source: 'inline_executeScript',
      status: 'ok'
    }, {
      dispatchId: 'Grok:1782945983672:1',
      sessionId: 1781159284885,
      runSessionId: 1781159284885
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(entry.answer).toBe(staleText);
  });

  test('replacement is refused when the candidate equals the pre-dispatch baseline answer', async () => {
    const llms = { Grok: grokEntryWithStaleSuccess() };
    llms.Grok.preDispatchAnswerSignature = freshText.replace(/\s+/g, ' ').trim().toLowerCase();
    llms.Grok.preDispatchAnswerCapturedAt = Date.now() - 60000;
    llms.Grok.preDispatchAnswerDispatchId = 'Grok:1782945983672:1';
    const { context } = createSandbox({ llms });
    const entry = context.jobState.llms.Grok;
    context.acceptLateCollectResult('Grok', {
      ok: true,
      text: freshText,
      html: '',
      source: 'inline_executeScript',
      status: 'ok'
    }, manualLatestMeta());
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(entry.answer).toBe(staleText);
  });
});

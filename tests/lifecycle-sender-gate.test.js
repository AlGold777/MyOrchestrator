// Trust boundary between provider tabs (review finding P0, 2026-07-02):
// the content script runs in EVERY tab of a provider, including the user's own
// manual chats. Lifecycle messages (PROMPT_SUBMITTED, LLM_RESPONSE,
// LLM_RESPONSE_READY, ANSWER_SNAPSHOT) must only mutate a model's run state
// when they come from that model's bound tab.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MESSAGE_ROUTER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'message-router.js'),
  'utf8'
);

function createRouterSandbox() {
  let onMessageListener = null;
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
    setTimeout,
    clearTimeout,
    TERMINAL_STATUSES: ['SUCCESS', 'PARTIAL', 'ERROR', 'NO_SEND', 'EXTRACT_FAILED', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    jobState: {
      session: { startTime: 12345 },
      llms: {
        GPT: {
          status: 'GENERATING',
          tabId: 101,
          lastDispatchMeta: { dispatchId: 'GPT:12345:1' },
          recentDispatchIds: ['GPT:12345:1']
        }
      }
    },
    CompressedStorage: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      migrate: jest.fn(() => Promise.resolve()),
      pruneIfNeeded: jest.fn(() => Promise.resolve())
    },
    clearDiagnosticsRuntimeLogs: jest.fn(() => false),
    saveJobState: jest.fn(),
    loadJobState: jest.fn(() => Promise.resolve()),
    loadResolutionMetrics: jest.fn(() => Promise.resolve()),
    loadCircuitBreakerState: jest.fn(() => Promise.resolve()),
    startProcess: jest.fn(() => Promise.resolve()),
    stopAllProcesses: jest.fn(),
    writeDiagnosticsEventsToStorage: jest.fn(() => Promise.resolve()),
    handleLLMResponse: jest.fn(),
    updateModelState: jest.fn(),
    resolvePromptSubmitted: jest.fn(),
    emitTelemetry: jest.fn((llmName, event, payload = {}) => telemetryEvents.push({ llmName, event, payload })),
    broadcastDiagnostic: jest.fn(),
    broadcastGlobalState: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    saveAnswerSnapshotFromContent: jest.fn(() => Promise.resolve({ status: 'snapshot_saved' })),
    TabMapManager: {
      load: jest.fn(() => Promise.resolve()),
      get: jest.fn((llmName) => (llmName === 'GPT' ? 101 : null)),
      getNameByTabId: jest.fn((tabId) => (tabId === 101 ? 'GPT' : null)),
      entries: jest.fn(() => []),
      removeByName: jest.fn()
    },
    activateTabForDispatch: jest.fn(),
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener: (fn) => { onMessageListener = fn; } },
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        getManifest: () => ({ version: 'test' })
      },
      storage: {
        local: {
          get: jest.fn((key, callback) => {
            if (typeof callback === 'function') callback({});
            return Promise.resolve({});
          }),
          set: jest.fn(() => Promise.resolve())
        },
        session: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onActivated: { addListener: () => {} },
        sendMessage: jest.fn(() => Promise.resolve()),
        update: jest.fn((tabId, _update, callback) => { if (typeof callback === 'function') callback(); }),
        query: jest.fn(() => Promise.resolve([]))
      },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: { create: () => {}, clear: () => {}, onAlarm: { addListener: () => {} } },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  return {
    context,
    telemetryEvents,
    sendMessage(message, sender) {
      return new Promise((resolve) => {
        const handled = onMessageListener(message, sender, resolve);
        if (handled !== true) resolve(undefined);
      });
    }
  };
}

const BOUND_SENDER = { tab: { id: 101 } };
const FOREIGN_SENDER = { tab: { id: 202 } };
const PAGE_SENDER = {}; // extension pages have no sender.tab
const META = { dispatchId: 'GPT:12345:1', runSessionId: 12345, sessionId: 12345 };

const PPLX_META_1 = { dispatchId: 'Perplexity:12345:1', runSessionId: 12345, sessionId: 12345 };
const PPLX_CHAT_SENDER = {
  tab: { id: 303, url: 'https://www.perplexity.ai/search/test' },
  url: 'https://www.perplexity.ai/search/test',
  documentId: 'pplx-chat-doc',
  frameId: 0
};
const PPLX_PAYMENT_SENDER = {
  tab: { id: 303, url: 'https://www.perplexity.ai/pro/payment?plan=yearly&origin=fileUpload' },
  url: 'https://www.perplexity.ai/pro/payment?plan=yearly&origin=fileUpload',
  documentId: 'pplx-payment-doc',
  frameId: 0
};

function configurePerplexityHandshake(context, { deferProbe = false } = {}) {
  const transitions = [];
  let machineState = 'SUBMITTING';
  let releaseProbe = null;
  context.jobState.prompt = 'global prompt';
  context.jobState.attachments = [{ name: 'report.pdf', base64: 'data:application/pdf;base64,AA==' }];
  context.jobState.session.promptsByModel = { Perplexity: 'per-model prompt' };
  context.jobState.llms.Perplexity = {
    llmName: 'Perplexity',
    status: 'GENERATING',
    tabId: 303,
    dispatchAttempts: 1,
    lastDispatchMeta: { dispatchId: PPLX_META_1.dispatchId },
    recentDispatchIds: [PPLX_META_1.dispatchId],
    providerPipelineActive: true
  };
  context.TabMapManager.get.mockImplementation((name) => (name === 'GPT' ? 101 : (name === 'Perplexity' ? 303 : null)));
  context.TabMapManager.getNameByTabId.mockImplementation((tabId) => (tabId === 101 ? 'GPT' : (tabId === 303 ? 'Perplexity' : null)));
  const machine = {
    get state() { return machineState; },
    isInProgress: jest.fn(() => ['QUEUED', 'ACTIVATING', 'TYPING', 'SUBMITTING', 'WAITING', 'STREAMING'].includes(machineState)),
    is: jest.fn((state) => machineState === state),
    canQueue: jest.fn(() => machineState === 'IDLE'),
    error: jest.fn(() => {
      transitions.push([machineState, 'ERROR']);
      machineState = 'ERROR';
      return true;
    }),
    reset: jest.fn(() => {
      transitions.push([machineState, 'IDLE']);
      machineState = 'IDLE';
      return true;
    })
  };
  context.DISPATCH_STATES = { IDLE: 'IDLE', ERROR: 'ERROR', DONE: 'DONE' };
  context.DispatchStateManager = { get: jest.fn(() => machine) };
  context.ReadySignalManager = { handleReadySignal: jest.fn() };
  context.TransportPolicy = {
    resolvePromptForModel: jest.fn((map, name, fallback) => map?.[name] || fallback)
  };
  context.dispatchPromptToTab = jest.fn(async (_name, _tabId, prompt) => {
    expect(machineState).toBe('IDLE');
    expect(prompt).toBe('per-model prompt');
    const entry = context.jobState.llms.Perplexity;
    entry.dispatchAttempts += 1;
    const dispatchId = `Perplexity:12345:${entry.dispatchAttempts}`;
    entry.lastDispatchMeta = { dispatchId };
    return { ok: true, accepted: true, dispatchId };
  });
  context.chrome.tabs.sendMessage.mockImplementation((_tabId, message, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (message?.type !== 'PROVIDER_TRANSIENT_BLOCKER_RESUME_PROBE') {
      cb?.({ ok: true });
      return Promise.resolve({ ok: true });
    }
    const response = {
      ok: true,
      ready: true,
      composerReady: true,
      token: message.token,
      dispatchId: message.meta.dispatchId,
      tabSessionId: 'pplx-session-2'
    };
    if (deferProbe) {
      releaseProbe = () => cb?.(response);
    } else {
      cb?.(response);
    }
    return undefined;
  });
  return { machine, transitions, releaseProbe: () => releaseProbe?.() };
}

describe('lifecycle sender gate', () => {
  test('PROMPT_SUBMITTED from a foreign provider tab is rejected and does not confirm the dispatch', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'PROMPT_SUBMITTED', llmName: 'GPT' }, FOREIGN_SENDER);

    expect(response?.status).toBe('prompt_submitted_rejected');
    expect(context.jobState.llms.GPT.promptSubmittedAt).toBeFalsy();
    expect(telemetryEvents.some((e) => e.event === 'SENDER_TAB_MISMATCH_REJECTED')).toBe(true);
  });

  test('PROMPT_SUBMITTED from the bound tab is accepted', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'PROMPT_SUBMITTED', llmName: 'GPT', meta: META }, BOUND_SENDER);

    expect(response?.status).not.toBe('prompt_submitted_rejected');
    expect(context.jobState.llms.GPT.promptSubmittedAt).toBeTruthy();
  });

  test('LLM_RESPONSE from a foreign tab never reaches handleLLMResponse', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'stale text' }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('response_rejected');
    expect(context.handleLLMResponse).not.toHaveBeenCalled();

    const accepted = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'real text', meta: META }, BOUND_SENDER);
    expect(accepted?.status).toBe('response_handled');
    expect(context.handleLLMResponse).toHaveBeenCalledWith('GPT', 'real text', null, META, '');
  });

  test('LLM_RESPONSE_READY from a foreign tab cannot set completion evidence', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'LLM_RESPONSE_READY', llmName: 'GPT' }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('response_ready_rejected');
    expect(context.jobState.llms.GPT.lifecycleReadyAt).toBeFalsy();

    await sendMessage({ type: 'LLM_RESPONSE_READY', llmName: 'GPT', meta: META }, BOUND_SENDER);
    expect(context.jobState.llms.GPT.lifecycleReadyAt).toBeTruthy();
  });

  test('ANSWER_SNAPSHOT from a foreign tab is ignored', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const rejected = await sendMessage({ type: 'ANSWER_SNAPSHOT', llmName: 'GPT', text: 'x'.repeat(200) }, FOREIGN_SENDER);
    expect(rejected?.status).toBe('snapshot_ignored');
    expect(context.saveAnswerSnapshotFromContent).not.toHaveBeenCalled();
  });

  test('non-tab senders still need current run correlation', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const response = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'GPT', answer: 'ui text', meta: META }, PAGE_SENDER);
    expect(response?.status).toBe('response_handled');
    expect(context.handleLLMResponse).toHaveBeenCalled();
  });

  test('models without an active binding reject provider-tab lifecycle events', async () => {
    const { context, sendMessage } = createRouterSandbox();
    context.jobState.llms.Claude = { status: 'GENERATING' };
    context.TabMapManager.get.mockImplementation(() => null);
    const response = await sendMessage({ type: 'LLM_RESPONSE', llmName: 'Claude', answer: 'text' }, { tab: { id: 303 } });
    expect(response?.status).toBe('response_rejected');
  });
});

describe('Perplexity transient blocker router handshake', () => {
  const blockerMessage = (type, token, phase, meta = PPLX_META_1) => ({
    type,
    llmName: 'Perplexity',
    blocker: 'file_upload_paywall',
    token,
    phase,
    meta
  });

  test('first START→CLEAR performs valid FSM cancellation and accepts exactly one resume dispatch', async () => {
    const { context, telemetryEvents, sendMessage } = createRouterSandbox();
    const { transitions } = configurePerplexityHandshake(context);
    const token = 'pplx-token-0001';

    expect(await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER))
      .toEqual(expect.objectContaining({ ok: true, status: 'blocker_armed' }));
    expect(await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER))
      .toEqual(expect.objectContaining({ ok: true, status: 'blocker_started' }));

    const cleared = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(cleared).toEqual(expect.objectContaining({
      ok: true,
      status: 'resume_accepted',
      dispatchId: 'Perplexity:12345:2',
      previousDispatchId: PPLX_META_1.dispatchId
    }));
    expect(transitions).toEqual([
      ['SUBMITTING', 'ERROR'],
      ['ERROR', 'IDLE']
    ]);
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
    expect(context.jobState.llms.Perplexity.perplexityPaywallResumeCount).toBe(1);
    expect(context.handleLLMResponse).not.toHaveBeenCalled();
    expect(telemetryEvents.some((event) => event.event === 'PROVIDER_TRANSIENT_BLOCKER_RESUME')).toBe(true);

    const duplicate = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(duplicate).toEqual(expect.objectContaining({ ok: true, status: 'already_cleared' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);

    const secondToken = 'pplx-token-0002';
    const meta2 = { dispatchId: 'Perplexity:12345:2', runSessionId: 12345, sessionId: 12345 };
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', secondToken, 'armed', meta2), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', secondToken, 'active', meta2), PPLX_PAYMENT_SENDER);
    const repeated = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', secondToken, 'resume_ready', meta2),
      PPLX_CHAT_SENDER
    );
    expect(repeated).toEqual(expect.objectContaining({ ok: true, status: 'repeated_blocker_terminal' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
    expect(context.handleLLMResponse).toHaveBeenCalledWith(
      'Perplexity',
      expect.stringContaining('repeated'),
      expect.objectContaining({ type: 'attachment_unavailable' }),
      expect.anything(),
      ''
    );
    expect(context.jobState.llms.Perplexity).toEqual(expect.objectContaining({
      transientBlocker: null,
      transientBlockerRunSessionId: null,
      transientBlockerDispatchId: null,
      transientBlockerTabId: null,
      providerPipelineActive: false
    }));
  });

  test('claims ACTIVE as PROBING before await so concurrent CLEAR cannot dispatch twice', async () => {
    const { context, sendMessage } = createRouterSandbox();
    const handshake = configurePerplexityHandshake(context, { deferProbe: true });
    const token = 'pplx-token-race';
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER);

    const firstClear = sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    await Promise.resolve();
    expect(context.jobState.llms.Perplexity.transientBlocker.phase).toBe('PROBING');
    const concurrent = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(concurrent).toEqual(expect.objectContaining({
      ok: false,
      reason: 'transient_blocker_resume_in_progress'
    }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();

    handshake.releaseProbe();
    expect(await firstClear).toEqual(expect.objectContaining({ ok: true, status: 'resume_accepted' }));
    expect(context.dispatchPromptToTab).toHaveBeenCalledTimes(1);
  });

  test('rejects stale CLEAR and quarantines original lifecycle while ACTIVE owns dispatch :1', async () => {
    const { context, sendMessage } = createRouterSandbox();
    configurePerplexityHandshake(context);
    const token = 'pplx-token-stale';
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'armed'), PPLX_CHAT_SENDER);
    await sendMessage(blockerMessage('PROVIDER_TRANSIENT_BLOCKER_STARTED', token, 'active'), PPLX_PAYMENT_SENDER);

    const pipelineState = await sendMessage({
      type: 'PROVIDER_DISPATCH_PIPELINE_STATE',
      llmName: 'Perplexity',
      active: false,
      meta: PPLX_META_1
    }, PPLX_CHAT_SENDER);
    expect(pipelineState).toEqual(expect.objectContaining({
      ok: true,
      status: 'pipeline_state_deferred_for_transient_blocker'
    }));
    expect(context.jobState.llms.Perplexity.providerPipelineActive).toBe(true);

    const response = await sendMessage({
      type: 'LLM_RESPONSE',
      llmName: 'Perplexity',
      answer: 'Error: provider navigation',
      error: { type: 'attachment_failed', message: 'provider navigation' },
      meta: PPLX_META_1
    }, PPLX_CHAT_SENDER);
    expect(response).toEqual(expect.objectContaining({
      status: 'response_deferred',
      reason: 'transient_blocker_active'
    }));
    expect(context.handleLLMResponse).not.toHaveBeenCalled();

    context.jobState.llms.Perplexity.lastDispatchMeta = { dispatchId: 'Perplexity:12345:99' };
    const staleClear = await sendMessage(
      blockerMessage('PROVIDER_TRANSIENT_BLOCKER_CLEARED', token, 'resume_ready'),
      PPLX_CHAT_SENDER
    );
    expect(staleClear).toEqual(expect.objectContaining({
      ok: false,
      reason: 'transient_blocker_not_active'
    }));
    expect(context.dispatchPromptToTab).not.toHaveBeenCalled();
  });
});

describe('tabs.create failure handling', () => {
  test('tab-manager handles lastError / undefined tab instead of throwing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'background', 'tab-manager.js'), 'utf8');
    expect(src).toContain("if (chrome.runtime.lastError || !tab?.id) {");
    expect(src).toContain("'TAB_CREATE_FAILED'");
    expect(src).toContain("type: 'tab_create_failed'");
  });
});

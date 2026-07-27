const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MESSAGE_ROUTER_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');

function createSandbox({ jobState } = {}) {
  let onMessageListener = null;
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
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TERMINAL_STATUSES: ['COPY_SUCCESS', 'SUCCESS', 'DONE', 'COMPLETE', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'CRITICAL_ERROR', 'RECOVERABLE_ERROR', 'UNRESPONSIVE', 'CIRCUIT_OPEN', 'API_FAILED', 'NO_SEND', 'EXTRACT_FAILED', 'STREAM_TIMEOUT', 'EXTERNAL_LLM_FAILURE', 'USER_ACTION_REQUIRED', 'UNCERTAIN'],
    jobState: jobState || { session: null, llms: {} },
    CompressedStorage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      migrate: () => Promise.resolve(),
      pruneIfNeeded: () => Promise.resolve()
    },
    loadJobState: () => Promise.resolve(),
    saveJobState: () => {},
    loadResolutionMetrics: () => Promise.resolve(),
    loadCircuitBreakerState: () => Promise.resolve(),
    TabMapManager: {
      load: () => Promise.resolve(),
      get: () => null,
      entries: () => [],
      removeByName: () => {}
    },
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
          get: () => Promise.resolve({}),
          set: () => Promise.resolve()
        },
        session: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve()
        },
        onChanged: { addListener: () => {} }
      },
      tabs: {
        onRemoved: { addListener: () => {} },
        onUpdated: { addListener: () => {} },
        onActivated: { addListener: () => {} },
        sendMessage: () => Promise.resolve(),
        query: () => Promise.resolve([])
      },
      windows: { onFocusChanged: { addListener: () => {} } },
      alarms: {
        create: () => {},
        clear: () => {},
        onAlarm: { addListener: () => {} }
      },
      action: { onClicked: { addListener: () => {} } }
    },
    self: null
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(MESSAGE_ROUTER_SOURCE, context, { filename: 'background/message-router.js' });
  return {
    context,
    sendMessage: (message) => new Promise((resolve) => {
      const handled = onMessageListener(message, { tab: null }, resolve);
      if (handled !== true) resolve(undefined);
    })
  };
}

describe('GET_RUN_OUTCOME_SUMMARY contract', () => {
  test('returns per-model terminal outcomes from background jobState', async () => {
    const { sendMessage } = createSandbox({
      jobState: {
        session: { startTime: 1781157526316 },
        llms: {
          GPT: {
            finalStatus: 'SUCCESS',
            finalStatusRecorded: true,
            finalizedAt: 1781157700000,
            answerLength: 3861,
            responseMeta: { source: 'stable_text' },
            lastDispatchMeta: { dispatchId: 'GPT:1781157526316:1' },
            generationEpoch: 3,
            preDispatchAnswerNodeCount: 6,
            preDispatchAnswerNodeCountDispatchId: 'GPT:1781157526316:1',
            promptSubmittedAt: 1781157540000,
            submitSource: 'content',
            submitConfirmedBy: 'composer_cleared',
            finalizationEvidence: {
              accepted: true,
              contradictions: [],
              calibrationEndMarker: 'B2-S2-LONG-END-91AC7F',
              calibrationEndMarkerPresent: true,
              decisionSnapshot: { selectedLength: 3861, generationActive: false },
              lengthPolicy: { policyRef: 'answer-length-policy@2', suspectShortSuccess: false }
            }
          },
          Claude: {
            finalStatus: 'SUCCESS',
            finalStatusRecorded: true,
            answerLength: 233,
            finalizationEvidence: { lengthPolicy: { policyRef: 'answer-length-policy@2', suspectShortSuccess: true } }
          },
          Grok: {
            status: 'RECEIVING',
            answer: 'partial text',
            lastDispatchMeta: { dispatchId: 'Grok:1781157526316:1' }
          }
        }
      }
    });

    const resp = await sendMessage({ type: 'GET_RUN_OUTCOME_SUMMARY' });
    expect(resp.success).toBe(true);
    expect(resp.runSessionId).toBe(1781157526316);
    expect(resp.complete).toBe(false);

    const byName = Object.fromEntries(resp.models.map((m) => [m.llmName, m]));
    expect(byName.GPT.terminal).toBe(true);
    expect(byName.GPT.finalStatus).toBe('SUCCESS');
    expect(byName.GPT.answerLength).toBe(3861);
    expect(byName.GPT.lengthPolicyRef).toBe('answer-length-policy@2');
    expect(byName.GPT).toEqual(expect.objectContaining({
      submitSource: 'content',
      submitConfirmedBy: 'composer_cleared',
      generationEpoch: 3,
      turnAnchor: 6,
      turnAnchorDispatchId: 'GPT:1781157526316:1',
      finalizationAccepted: true,
      calibrationEndMarkerPresent: true,
      decisionSnapshot: { selectedLength: 3861, generationActive: false }
    }));

    expect(byName.Claude.suspectShortSuccess).toBe(true);

    expect(byName.Grok.terminal).toBe(false);
    expect(byName.Grok.finalStatus).toBeNull();
    expect(byName.Grok.answerLength).toBe('partial text'.length);
  });

  test('reports complete=true when every model is terminal', async () => {
    const { sendMessage } = createSandbox({
      jobState: {
        session: { startTime: 7 },
        llms: {
          GPT: { finalStatus: 'SUCCESS', finalStatusRecorded: true, answerLength: 1000 },
          Gemini: { finalStatus: 'EXTRACT_FAILED', finalStatusRecorded: true, answerLength: 0 }
        }
      }
    });
    const resp = await sendMessage({ type: 'GET_RUN_OUTCOME_SUMMARY' });
    expect(resp.success).toBe(true);
    expect(resp.complete).toBe(true);
  });

  test('treats release failure outcomes as terminal in run summary', async () => {
    const { sendMessage } = createSandbox({
      jobState: {
        session: { startTime: 8 },
        llms: {
          Gemini: { finalStatus: 'USER_ACTION_REQUIRED', finalStatusRecorded: true, answerLength: 0 },
          Grok: { finalStatus: 'EXTERNAL_LLM_FAILURE', finalStatusRecorded: true, answerLength: 0 },
          Qwen: { finalStatus: 'UNCERTAIN', finalStatusRecorded: true, answerLength: 0 }
        }
      }
    });
    const resp = await sendMessage({ type: 'GET_RUN_OUTCOME_SUMMARY' });
    expect(resp.complete).toBe(true);
    expect(Object.fromEntries(resp.models.map((model) => [model.llmName, model.finalStatus]))).toEqual({
      Gemini: 'USER_ACTION_REQUIRED',
      Grok: 'EXTERNAL_LLM_FAILURE',
      Qwen: 'UNCERTAIN'
    });
  });

  test('handles missing jobState without throwing', async () => {
    const { sendMessage, context } = createSandbox();
    context.jobState = null;
    const resp = await sendMessage({ type: 'GET_RUN_OUTCOME_SUMMARY' });
    expect(resp.success).toBe(true);
    expect(resp.models).toEqual([]);
    expect(resp.complete).toBe(false);
  });
});

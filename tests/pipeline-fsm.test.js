const { JSDOM } = require('jsdom');

describe('PipelineFSM lifecycle guard', () => {
  let PipelineFSM;
  let storage;

  beforeEach(() => {
    storage = {};
    global.chrome = {
      storage: {
        session: {
          get: jest.fn(async (key) => {
            if (typeof key === 'string') {
              return { [key]: storage[key] };
            }
            if (Array.isArray(key)) {
              return key.reduce((acc, item) => ({ ...acc, [item]: storage[item] }), {});
            }
            return { ...storage };
          }),
          set: jest.fn(async (value) => {
            Object.assign(storage, value || {});
          })
        }
      }
    };
    jest.resetModules();
    PipelineFSM = require('../shared/pipeline-fsm');
  });

  test('persists and restores control state through chrome.storage.session', async () => {
    const control = PipelineFSM.startRun({
      pipelineRunId: 'run-1',
      sessionId: 1001,
      stage: 'dispatch',
      payload: { selectedModels: ['GPT', 'Claude'] }
    });
    PipelineFSM.registerDispatch(control, {
      llmName: 'GPT',
      dispatchId: 'dispatch-1',
      tabId: 42,
      tabSessionId: 'tab-session-a',
      pipelineRunId: 'run-1',
      sessionId: 1001
    });

    await PipelineFSM.persistControlState(control);
    const restored = await PipelineFSM.loadControlState();

    expect(restored.pipelineRunId).toBe('run-1');
    expect(restored.state).toBe('STARTING');
    expect(restored.activeDispatches.GPT.dispatchId).toBe('dispatch-1');
    expect(storage[PipelineFSM.STORAGE_KEY]).toMatchObject({
      pipelineRunId: 'run-1',
      sessionId: 1001
    });
  });

  test('accepts current finals, rejects duplicate finals, stale tabs and cancelled runs', () => {
    const control = PipelineFSM.startRun({
      pipelineRunId: 'run-2',
      sessionId: 2002,
      stage: 'awaiting_final'
    });
    PipelineFSM.registerDispatch(control, {
      llmName: 'GPT',
      dispatchId: 'dispatch-2',
      tabId: 7,
      tabSessionId: 'tab-session-b',
      pipelineRunId: 'run-2',
      sessionId: 2002
    });

    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-2',
      llmName: 'GPT',
      dispatchId: 'dispatch-2',
      tabSessionId: 'tab-session-b',
      kind: 'ready'
    }).ok).toBe(true);

    const firstFinal = PipelineFSM.markFinal(control, {
      llmName: 'GPT',
      dispatchId: 'dispatch-2',
      tabSessionId: 'tab-session-b',
      pipelineRunId: 'run-2',
      finalStatus: 'SUCCESS',
      reason: 'ok'
    });
    expect(firstFinal.ok).toBe(true);
    expect(control.state).toBe('COMPLETED');

    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-2',
      llmName: 'GPT',
      dispatchId: 'dispatch-2',
      tabSessionId: 'stale-tab-session',
      kind: 'ready'
    }).reason).toBe('tab_session_mismatch');

    const cancelled = PipelineFSM.cancelRun(control, {
      pipelineRunId: 'run-2',
      reason: 'user_cancel'
    });
    expect(cancelled.state).toBe('CANCELLED');
    expect(PipelineFSM.shouldAcceptEvent(cancelled, {
      pipelineRunId: 'run-2',
      llmName: 'GPT',
      dispatchId: 'dispatch-2',
      tabSessionId: 'tab-session-b',
      kind: 'final'
    }).reason).toBe('pipeline_cancelled');
  });

  test('cancelled runs cannot transition back to completed', () => {
    const control = PipelineFSM.startRun({
      pipelineRunId: 'run-3',
      sessionId: 3003,
      stage: 'awaiting_final'
    });
    const cancelled = PipelineFSM.cancelRun(control, {
      pipelineRunId: 'run-3',
      reason: 'user_cancel'
    });
    const result = PipelineFSM.markFinal(cancelled, {
      llmName: 'GPT',
      dispatchId: 'dispatch-3',
      tabSessionId: 'tab-session-c',
      pipelineRunId: 'run-3',
      finalStatus: 'SUCCESS',
      reason: 'late_final'
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pipeline_terminal_cancelled');
    expect(cancelled.state).toBe('CANCELLED');
  });

  test('allows recovered success to override a recoverable failure final', () => {
    const control = PipelineFSM.startRun({
      pipelineRunId: 'run-recovery',
      sessionId: 4004,
      stage: 'awaiting_final'
    });
    PipelineFSM.registerDispatch(control, {
      llmName: 'Qwen',
      dispatchId: 'dispatch-recovery',
      tabId: 9,
      tabSessionId: 'tab-session-recovery',
      pipelineRunId: 'run-recovery',
      sessionId: 4004
    });
    expect(PipelineFSM.markFinal(control, {
      llmName: 'Qwen',
      dispatchId: 'dispatch-recovery',
      tabSessionId: 'tab-session-recovery',
      pipelineRunId: 'run-recovery',
      finalStatus: 'NO_SEND',
      reason: 'prompt_not_confirmed'
    }).ok).toBe(true);

    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-recovery',
      llmName: 'Qwen',
      dispatchId: 'dispatch-recovery',
      tabSessionId: 'tab-session-recovery',
      kind: 'final',
      finalStatus: 'SUCCESS'
    }).reason).toBe('duplicate_final');

    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-recovery',
      llmName: 'Qwen',
      dispatchId: 'dispatch-recovery',
      tabSessionId: 'tab-session-recovery',
      kind: 'final',
      finalStatus: 'SUCCESS',
      allowRecoveredFinal: true
    }).reason).toBe('recovered_final_override');
  });

  test('allows recovered full success to upgrade a locked PARTIAL of the same dispatch (run 1782944449199 Perplexity dblclick)', () => {
    const control = PipelineFSM.startRun({
      pipelineRunId: 'run-partial-upgrade',
      sessionId: 5005,
      stage: 'awaiting_final'
    });
    PipelineFSM.registerDispatch(control, {
      llmName: 'Perplexity',
      dispatchId: 'dispatch-partial',
      tabId: 11,
      tabSessionId: 'tab-session-partial',
      pipelineRunId: 'run-partial-upgrade',
      sessionId: 5005
    });
    expect(PipelineFSM.markFinal(control, {
      llmName: 'Perplexity',
      dispatchId: 'dispatch-partial',
      tabSessionId: 'tab-session-partial',
      pipelineRunId: 'run-partial-upgrade',
      finalStatus: 'PARTIAL',
      reason: 'soft_timeout'
    }).ok).toBe(true);

    // Without the recovered flag the duplicate guard still holds.
    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-partial-upgrade',
      llmName: 'Perplexity',
      dispatchId: 'dispatch-partial',
      tabSessionId: 'tab-session-partial',
      kind: 'final',
      finalStatus: 'SUCCESS'
    }).reason).toBe('duplicate_final');

    // Manual latest recovery found the full answer: PARTIAL -> SUCCESS is allowed.
    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-partial-upgrade',
      llmName: 'Perplexity',
      dispatchId: 'dispatch-partial',
      tabSessionId: 'tab-session-partial',
      kind: 'final',
      finalStatus: 'SUCCESS',
      allowRecoveredFinal: true
    }).reason).toBe('recovered_partial_upgrade');

    // A repeated PARTIAL never re-enters even with the recovered flag.
    expect(PipelineFSM.shouldAcceptEvent(control, {
      pipelineRunId: 'run-partial-upgrade',
      llmName: 'Perplexity',
      dispatchId: 'dispatch-partial',
      tabSessionId: 'tab-session-partial',
      kind: 'final',
      finalStatus: 'PARTIAL',
      allowRecoveredFinal: true
    }).reason).toBe('duplicate_final');
  });

  test('compacts large jobState payloads before persistence', () => {
    const compacted = PipelineFSM.compactJobStateForStorage({
      prompt: 'prompt',
      session: {
        startTime: 3003,
        selectedModels: ['GPT'],
        pipelineRunId: 'run-3',
        pipelineState: 'DISPATCHING',
        roundHistory: Array.from({ length: 20 }, (_, index) => ({ round: index + 1 })),
        roundSnapshots: Array.from({ length: 20 }, (_, index) => ({ round: index + 1 }))
      },
      llms: {
        GPT: {
          answer: 'A'.repeat(20000),
          answerHtml: '<p>' + 'B'.repeat(20000) + '</p>',
          pendingFinalAnswer: 'C'.repeat(20000),
          pendingFinalAnswerHtml: 'D'.repeat(20000),
          finalStatusRecorded: true,
          recoveryBudgets: {
            'dispatch-1::materialize_latest::no_send': {
              inlineDomAttempts: 2,
              controlledVisitAttempts: 1
            }
          },
          snapshots: Array.from({ length: 20 }, (_, index) => ({ id: index + 1 })),
          logs: Array.from({ length: 80 }, (_, index) => ({ label: `L${index}`, details: 'x'.repeat(5000) }))
        }
      }
    }, {
      maxAnswerChars: 100,
      maxHtmlChars: 120,
      maxLogEntries: 8
    });

    expect(compacted.llms.GPT.answer).toHaveLength(100);
    expect(compacted.llms.GPT.answerHtml).toHaveLength(120);
    expect(compacted.llms.GPT.pendingFinalAnswer).toBeUndefined();
    expect(compacted.llms.GPT.pendingFinalAnswerHtml).toBeUndefined();
    expect(compacted.llms.GPT.logs).toHaveLength(8);
    expect(compacted.llms.GPT.recoveryBudgets).toEqual(expect.objectContaining({
      'dispatch-1::materialize_latest::no_send': expect.objectContaining({ inlineDomAttempts: 2 })
    }));
    expect(compacted.session.pipelineRunId).toBe('run-3');
    expect(compacted.session.roundHistory).toHaveLength(6);
    expect(compacted.session.roundSnapshots).toHaveLength(6);
    expect(compacted.llms.GPT.snapshots).toHaveLength(6);
    expect(PipelineFSM.DEFAULT_LIMITS.maxPayloadBytes).toBeGreaterThan(0);
    expect(PipelineFSM.DEFAULT_LIMITS.maxSnapshotsPerModel).toBeGreaterThan(0);
    expect(PipelineFSM.DEFAULT_LIMITS.maxRoundsRetained).toBeGreaterThan(0);
  });
});

describe('Main-world bridge guard', () => {
  test('ignores fake CustomEvent payloads without the bridge token', () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><head>
    </head><body></body></html>`, {
      url: 'https://example.com'
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    global.CustomEvent = dom.window.CustomEvent;
    global.Event = dom.window.Event;
    global.DataTransfer = dom.window.DataTransfer;
    global.DragEvent = dom.window.DragEvent;
    global.ClipboardEvent = dom.window.ClipboardEvent;
    global.File = dom.window.File;
    global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
    global.HTMLInputElement = dom.window.HTMLInputElement;

    const script = require('fs').readFileSync(require('path').join(__dirname, '..', 'content-scripts', 'content-bridge.js'), 'utf8')
      .replace('__LLM_BRIDGE_TOKEN__', 'bridge_123');
    window.__RESULTS_TEST_DEBUG__ = true;
    window.eval(script);

    const hooks = window.__ExtMainBridgeTestHooks;
    expect(hooks).toBeTruthy();
    expect(document.querySelector('[data-bridge-token]')).toBeNull();
    expect(hooks.isTrustedBridgeEvent({
      detail: {
        bridgeSource: 'host-page'
      }
    })).toBe(false);
    expect(hooks.isTrustedBridgeEvent({
      detail: {
        bridgeSource: 'content-script'
      }
    })).toBe(false);
    expect(hooks.isTrustedBridgeEvent({
      detail: {
        bridgeSource: 'content-script',
        bridgeToken: 'bridge_123'
      }
    })).toBe(true);
  });
});

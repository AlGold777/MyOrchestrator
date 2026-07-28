(async function runTransportRaceFixture() {
  'use strict';
  const resultNode = document.getElementById('result');
  const baseStage = (id, participants, extra = {}) => ({
    runId: 'browser-transport-races',
    stageInstanceId: id,
    purpose: 'position',
    participants: participants.map((participantId) => ({ participantId, type: 'llm' })),
    dispatchMode: participants.length > 1 ? 'parallel' : 'single',
    completionMode: 'all',
    ...extra
  });
  const registry = (adapter) => DebateStageExecutor.createAdapterRegistry({ llm: adapter });
  const executor = (adapter, options = {}) => DebateStageExecutor.createStageExecutor({
    adapters: registry(adapter),
    retryPolicy: { maxAttempts: 1, delayMs: 0 },
    ...options
  });

  try {
    let delayedDispatches = 0;
    const delayedExecutor = executor({
      async dispatch() {
        delayedDispatches += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { status: 'received', text: 'delayed final' };
      }
    });
    const delayedStage = baseStage('delayed-duplicate', ['alpha']);
    const delayedFirst = await delayedExecutor.execute(delayedStage);
    const delayedReplay = await delayedExecutor.execute(delayedStage);

    let timeoutDispatches = 0;
    const timeoutExecutor = executor({
      async dispatch() {
        timeoutDispatches += 1;
        if (timeoutDispatches === 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return { status: 'received', text: 'late ignored final' };
        }
        return { status: 'received', text: 'retry success' };
      }
    }, { timeoutMs: 5, retryPolicy: { maxAttempts: 2, delayMs: 0 } });
    const timeoutResult = await timeoutExecutor.execute(baseStage('timeout-late', ['alpha']));

    let abortedDispatches = 0;
    const abortedExecutor = executor({
      async dispatch() {
        abortedDispatches += 1;
        return { status: 'received', text: 'must not dispatch' };
      }
    });
    const preAborted = new AbortController();
    preAborted.abort();
    const abortBatchResult = await abortedExecutor.execute(
      baseStage('abort-batch', ['alpha', 'beta']),
      { signal: preAborted.signal }
    );

    const tabLossExecutor = executor({
      async dispatch() {
        return {
          status: 'terminal_failure',
          failure: {
            terminal: true,
            reasonCode: 'TAB_LOST',
            stageId: 'tab-loss',
            attemptId: 'tab-loss:a1'
          }
        };
      }
    });
    const tabLossResult = await tabLossExecutor.execute(baseStage('tab-loss', ['alpha']));

    const partialExecutor = executor({
      async dispatch({ participant }) {
        return participant.participantId === 'alpha'
          ? { status: 'received', text: 'usable response' }
          : {
              status: 'terminal_failure',
              failure: {
                terminal: true,
                reasonCode: 'PORT_DISCONNECTED',
                stageId: 'partial',
                attemptId: 'partial:a1'
              }
            };
      }
    });
    const partialResult = await partialExecutor.execute(baseStage('partial', ['alpha', 'beta']));

    let synthesisCommitted = false;
    const synthesisExecutor = executor({
      async dispatch({ signal }) {
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            synthesisCommitted = true;
            resolve({ status: 'received', text: 'too late' });
          }, 30);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve({ status: 'cancelled' });
          }, { once: true });
        });
      }
    });
    const synthesisAbort = new AbortController();
    const synthesisPromise = synthesisExecutor.execute(
      baseStage('cancel-synthesis', ['alpha'], { purpose: 'synthesis' }),
      { signal: synthesisAbort.signal }
    );
    setTimeout(() => synthesisAbort.abort(), 5);
    const synthesisResult = await synthesisPromise;

    const checks = {
      delayedFinalAcceptedOnce: delayedFirst.executionStatus === 'completed'
        && delayedReplay.executionStatus === 'failed' && delayedDispatches === 1,
      timeoutLateSuccess: timeoutResult.executionStatus === 'completed'
        && timeoutResult.attempts[0].attempts === 2 && timeoutDispatches === 2,
      abortBatch: abortBatchResult.executionStatus === 'cancelled' && abortedDispatches === 0,
      tabLoss: tabLossResult.executionStatus === 'failed'
        && tabLossResult.terminalFailures[0]?.reasonCode === 'TAB_LOST',
      partialFailure: partialResult.executionStatus === 'partial'
        && partialResult.acceptedResponses.length === 1
        && partialResult.terminalFailures.length === 1,
      cancelDuringSynthesis: synthesisResult.executionStatus === 'cancelled'
        && synthesisCommitted === false
    };
    const value = { ok: Object.values(checks).every(Boolean), checks };
    resultNode.textContent = JSON.stringify(value);
    resultNode.dataset.status = value.ok ? 'ok' : 'error';
  } catch (error) {
    resultNode.textContent = JSON.stringify({ ok: false, error: String(error?.stack || error) });
    resultNode.dataset.status = 'error';
  }
})();

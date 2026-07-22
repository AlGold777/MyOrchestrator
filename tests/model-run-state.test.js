const ModelRunState = require('../shared/model-run-state');
const StatusContract = require('../shared/status-contract');

describe('ModelRunState architecture contract', () => {
  test('uses the shared status contract as the status classification source', () => {
    expect(ModelRunState.SUCCESS_STATUSES).toEqual(StatusContract.SUCCESS_STATUSES);
    expect(ModelRunState.FAILURE_STATUSES).toEqual(StatusContract.FAILURE_STATUSES);
    expect(ModelRunState.TERMINAL_STATUSES).toEqual(StatusContract.TERMINAL_STATUSES);
    expect(ModelRunState.isTerminalStatus('SUCCESS')).toBe(StatusContract.isTerminalStatus('SUCCESS'));
  });

  test('derives terminal success as authoritative UI status', () => {
    const entry = {
      llmName: 'Gemini',
      status: 'GENERATING',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: 1779916480462,
      answer: 'Final answer text'
    };

    const state = ModelRunState.deriveModelRunState(entry);

    expect(state.uiStatus).toBe('SUCCESS');
    expect(state.terminalState).toBe('success');
    expect(state.executionState).toBe('terminal_success');
    expect(state.answerState).toBe('accepted');
  });

  test('terminal state blocks later non-terminal lifecycle transitions', () => {
    const entry = {
      status: 'SUCCESS',
      finalStatus: 'SUCCESS',
      finalStatusRecorded: true,
      finalizedAt: Date.now(),
      answer: 'done'
    };
    entry.modelRunState = ModelRunState.deriveModelRunState(entry);

    const result = ModelRunState.applyModelRunTransition(entry, 'LIFECYCLE_READY', { status: 'RECEIVING' });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('terminal_quarantine');
    expect(entry.modelRunState.uiStatus).toBe('SUCCESS');
    expect(entry.modelRunState.postTerminalNoiseCount).toBe(1);
  });

  test('accepted answer candidate closes the run and records answer evidence', () => {
    const entry = { llmName: 'Perplexity', status: 'RECEIVING', answer: 'Answer '.repeat(40) };

    const result = ModelRunState.applyModelRunTransition(entry, 'ANSWER_CANDIDATE_ACCEPTED', {
      status: 'SUCCESS',
      reason: 'ok',
      answerLength: entry.answer.length,
      answerHash: ModelRunState.hashText(entry.answer),
      dispatchId: 'dispatch-1',
      tabId: 42,
      runSessionId: 1779916480462
    });

    expect(result.applied).toBe(true);
    expect(entry.modelRunState).toEqual(expect.objectContaining({
      uiStatus: 'SUCCESS',
      terminalState: 'success',
      answerState: 'accepted',
      answerLength: entry.answer.length,
      dispatchId: 'dispatch-1',
      tabId: 42,
      runSessionId: 1779916480462
    }));
  });

  test('does not close the run on RECOVERABLE_ERROR', () => {
    const entry = { llmName: 'Qwen', status: 'RECOVERABLE_ERROR' };
    entry.modelRunState = ModelRunState.deriveModelRunState(entry);

    expect(ModelRunState.isFailureStatus('RECOVERABLE_ERROR')).toBe(true);
    expect(ModelRunState.isTerminalRunState(entry)).toBe(false);
    expect(entry.modelRunState.terminalState).toBe('open');
    expect(entry.modelRunState.uiStatus).toBe('RECOVERABLE_ERROR');
  });

  test('accepted terminal failure does not masquerade as accepted answer', () => {
    const entry = { llmName: 'Le Chat', status: 'RECOVERABLE_ERROR' };

    ModelRunState.applyModelRunTransition(entry, 'TERMINAL_FAILURE', {
      status: 'NO_SEND',
      reason: 'no_send'
    });

    expect(entry.modelRunState.terminalState).toBe('failure');
    expect(entry.modelRunState.executionState).toBe('terminal_failure');
    expect(entry.modelRunState.answerState).toBe('failed');
  });

  test('run metrics summarize terminal/open state without reading diagnostics', () => {
    const success = { status: 'SUCCESS', finalStatus: 'SUCCESS', finalStatusRecorded: true, answer: 'ok' };
    const running = { status: 'GENERATING', messageSent: true };
    success.modelRunState = ModelRunState.deriveModelRunState(success);
    running.modelRunState = ModelRunState.deriveModelRunState(running);

    const metrics = ModelRunState.buildRunMetrics({ llms: { Gemini: success, Qwen: running } });

    expect(metrics.total).toBe(2);
    expect(metrics.terminalSuccess).toBe(1);
    expect(metrics.running).toBe(1);
    expect(metrics.completedPercent).toBe(50);
    expect(metrics.statuses.SUCCESS).toBe(1);
    expect(metrics.statuses.GENERATING).toBe(1);
  });
});

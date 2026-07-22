const StatusContract = require('../shared/status-contract');

describe('shared status contract', () => {
  test('blocks terminal downgrade from SUCCESS to PARTIAL', () => {
    const decision = StatusContract.shouldApplyStatusUpdate('SUCCESS', 'PARTIAL');
    expect(decision.apply).toBe(false);
    expect(decision.reason).toBe('terminal_rank_downgrade');
  });

  test('allows terminal upgrade from EXTRACT_FAILED to SUCCESS', () => {
    const decision = StatusContract.shouldApplyStatusUpdate('EXTRACT_FAILED', 'SUCCESS');
    expect(decision.apply).toBe(true);
  });

  test('blocks non-terminal status after terminal status', () => {
    const decision = StatusContract.shouldApplyStatusUpdate('SUCCESS', 'RECEIVING');
    expect(decision.apply).toBe(false);
    expect(decision.reason).toBe('terminal_blocks_non_terminal');
  });

  test('treats RECOVERABLE_ERROR as non-terminal failure', () => {
    expect(StatusContract.isFailureStatus('RECOVERABLE_ERROR')).toBe(true);
    expect(StatusContract.isTerminalStatus('RECOVERABLE_ERROR')).toBe(false);
    const decision = StatusContract.shouldApplyStatusUpdate('RECOVERABLE_ERROR', 'GENERATING');
    expect(decision.apply).toBe(true);
  });

  test('derives separated execution, answer and UI status', () => {
    const state = StatusContract.deriveStatusContract({
      status: 'RECEIVING',
      finalStatusRecorded: true,
      finalStatus: 'SUCCESS',
      answer: 'done'
    });
    expect(state.executionState).toBe('finalized');
    expect(state.answerState).toBe('complete');
    expect(state.uiStatus).toBe('SUCCESS');
    expect(state.rank).toBe(4);
  });

  test('derives compact ResultMeta phases for UI facade', () => {
    expect(StatusContract.deriveResultMeta({ status: 'GENERATING' })).toEqual(expect.objectContaining({
      phase: 'pending',
      label: 'Pending'
    }));
    expect(StatusContract.deriveResultMeta({ status: 'SUCCESS', answer: 'done' })).toEqual(expect.objectContaining({
      phase: 'success',
      label: 'Success'
    }));
    expect(StatusContract.deriveResultMeta({ status: 'PARTIAL', answer: 'chunk' })).toEqual(expect.objectContaining({
      phase: 'partial',
      label: 'Partial'
    }));
    expect(StatusContract.deriveResultMeta({ status: 'NO_SEND' })).toEqual(expect.objectContaining({
      phase: 'error',
      label: 'Error'
    }));
    expect(StatusContract.deriveResultMeta({ status: 'USER_ACTION_REQUIRED' })).toEqual(expect.objectContaining({
      phase: 'action_required',
      label: 'Action required',
      terminal: true
    }));
    expect(StatusContract.deriveResultMeta({ status: 'UNCERTAIN' })).toEqual(expect.objectContaining({
      phase: 'unknown',
      label: 'Uncertain',
      terminal: true
    }));
  });

  test('exposes release terminal outcome taxonomy', () => {
    expect(StatusContract.isTerminalStatus('EXTERNAL_LLM_FAILURE')).toBe(true);
    expect(StatusContract.isTerminalStatus('USER_ACTION_REQUIRED')).toBe(true);
    expect(StatusContract.isTerminalStatus('UNCERTAIN')).toBe(true);
    expect(StatusContract.isFailureStatus('EXTERNAL_LLM_FAILURE')).toBe(true);
    expect(StatusContract.isFailureStatus('USER_ACTION_REQUIRED')).toBe(true);
    expect(StatusContract.isFailureStatus('UNCERTAIN')).toBe(true);
  });
});

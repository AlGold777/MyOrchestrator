const ExecutionContext = require('../disput/debate-execution-context');

describe('DebateExecutionContext', () => {
  test('owns approval waiters and volatile locks for one run', () => {
    const context = ExecutionContext.createExecutionContext();
    const resolved = jest.fn();
    context.begin('run-1');
    context.setApprovalWaiter({ resolve: resolved });
    expect(context.lock('routing')).toBe(true);
    expect(context.lock('routing')).toBe(false);
    expect(context.resolveApproval({ id: 'turn-1' })).toBe(true);
    expect(resolved).toHaveBeenCalledWith({ id: 'turn-1' });
    expect(context.unlock('routing')).toBe(true);
  });

  test('disposing aborts and rejects pending approval', () => {
    const context = ExecutionContext.createExecutionContext();
    const rejected = jest.fn();
    context.begin('run-1');
    context.setApprovalWaiter({ reject: rejected });
    const signal = context.signal();
    context.dispose('closed');
    expect(signal.aborted).toBe(true);
    expect(rejected).toHaveBeenCalledWith('closed');
    expect(context.get()).toBeNull();
  });
});

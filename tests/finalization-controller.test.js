const FinalizationController = require('../shared/finalization-controller');

describe('FinalizationController', () => {
  test('accepts first terminal candidate for an open model run', () => {
    const decision = FinalizationController.tryFinalize({}, {
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-1',
      trimmedAnswer: 'answer'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      action: 'accept',
      reason: 'open_terminal_slot',
      incomingStatus: 'SUCCESS',
      dispatchId: 'dispatch-1'
    }));
  });

  test('blocks failure after locked success', () => {
    const decision = FinalizationController.tryFinalize({
      finalStatusRecorded: true,
      finalStatus: 'SUCCESS',
      answer: 'accepted answer',
      lastDispatchMeta: { dispatchId: 'dispatch-1' }
    }, {
      finalStatus: 'NO_SEND',
      dispatchId: 'dispatch-1',
      trimmedAnswer: 'Error: no send'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      action: 'ignore',
      reason: 'terminal_success_locked'
    }));
  });

  test('allows recovered answer to upgrade locked terminal failure', () => {
    const decision = FinalizationController.tryFinalize({
      finalStatusRecorded: true,
      finalStatus: 'NO_SEND',
      lastDispatchMeta: { dispatchId: 'dispatch-1' }
    }, {
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-1',
      trimmedAnswer: 'recovered answer',
      allowRecoveredFinalOverride: true
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      action: 'accept',
      reason: 'terminal_failure_upgraded_by_recovered_answer',
      allowTerminalUpgrade: true
    }));
  });

  test('ignores duplicate terminal with same dispatch and same answer', () => {
    const decision = FinalizationController.tryFinalize({
      finalStatusRecorded: true,
      finalStatus: 'SUCCESS',
      answer: 'accepted answer',
      lastDispatchMeta: { dispatchId: 'dispatch-1' }
    }, {
      finalStatus: 'SUCCESS',
      dispatchId: 'dispatch-1',
      trimmedAnswer: 'accepted answer'
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: false,
      action: 'ignore',
      reason: 'duplicate_terminal',
      dispatchId: 'dispatch-1'
    }));
  });

  test('keeps locked higher-rank status for manual lower-rank recovery', () => {
    const decision = FinalizationController.tryFinalize({
      finalStatusRecorded: true,
      finalStatus: 'SUCCESS',
      answer: 'accepted answer'
    }, {
      finalStatus: 'PARTIAL',
      trimmedAnswer: 'manual partial',
      allowManualTerminalOverride: true
    });

    expect(decision).toEqual(expect.objectContaining({
      ok: true,
      action: 'keep_locked_status',
      reason: 'manual_recovery_kept_locked_status',
      finalStatusOverride: 'SUCCESS'
    }));
  });
});

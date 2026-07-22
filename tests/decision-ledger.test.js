const DecisionLedger = require('../shared/decision-ledger');

describe('DecisionLedger', () => {
  test('appends compact decision records and preserves last record', () => {
    const entry = {};
    const record = DecisionLedger.append(entry, {
      decision: 'accept_success',
      reason: 'open_terminal_slot',
      source: 'test',
      inputs: { status: 'SUCCESS' },
      resultingState: 'SUCCESS'
    });

    expect(record).toEqual(expect.objectContaining({
      schemaVersion: 1,
      decision: 'accept_success',
      reason: 'open_terminal_slot',
      source: 'test',
      resultingState: 'SUCCESS'
    }));
    expect(entry.lastDecisionRecord).toBe(record);
    expect(DecisionLedger.get(entry)).toEqual([record]);
  });

  test('trims ledger to configured limit', () => {
    const entry = {};
    DecisionLedger.append(entry, { decision: 'one' }, { limit: 2 });
    DecisionLedger.append(entry, { decision: 'two' }, { limit: 2 });
    DecisionLedger.append(entry, { decision: 'three' }, { limit: 2 });

    expect(DecisionLedger.get(entry).map((item) => item.decision)).toEqual(['two', 'three']);
  });
});

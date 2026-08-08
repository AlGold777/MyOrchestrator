const ObserverHealth = require('../shared/observer-health');
const RunResultContract = require('../shared/run-result-contract');

const { STATES } = ObserverHealth;
const { GUARANTEE, AXIS_STATES } = RunResultContract;

describe('ObserverHealth', () => {
  test('a healthy transport observer lifts the ceiling to STRICT', () => {
    const witness = ObserverHealth.buildWitnessSet({
      transport: { installed: true, lastSignalAt: Date.now() },
      dom: { installed: true, lastSignalAt: Date.now() }
    });

    expect(witness.ceiling).toBe(GUARANTEE.STRICT);
    expect(witness.ceilingChannel).toBe('transport');
    expect(ObserverHealth.observerAxisState(witness)).toBe(AXIS_STATES.PROVEN);
  });

  test('DOM alone caps the ceiling at HEURISTIC however healthy it is', () => {
    const witness = ObserverHealth.buildWitnessSet({
      transport: { installed: false },
      dom: { installed: true, lastSignalAt: Date.now() }
    });

    expect(witness.ceiling).toBe(GUARANTEE.HEURISTIC);
    expect(witness.observers.transport.state).toBe(STATES.BLIND);
  });

  test('losing the transport observer lowers the ceiling rather than removing a vote', () => {
    const now = Date.now();
    const before = ObserverHealth.buildWitnessSet({
      transport: { installed: true, lastSignalAt: now },
      dom: { installed: true, lastSignalAt: now }
    }, { now });
    const after = ObserverHealth.buildWitnessSet({
      transport: { installed: true, detached: true, lastSignalAt: now },
      dom: { installed: true, lastSignalAt: now }
    }, { now });

    expect(before.ceiling).toBe(GUARANTEE.STRICT);
    expect(after.ceiling).toBe(GUARANTEE.HEURISTIC);
    expect(after.degradedReasons).toContain('transport:blind');
  });

  test('an installed but silent observer is SUSPECT while output is expected', () => {
    const now = Date.now();
    const observer = ObserverHealth.assessObserver('transport', {
      installed: true,
      expectSignals: true,
      lastSignalAt: now - 60000,
      silenceLimitMs: 15000,
      now
    });

    expect(observer.state).toBe(STATES.SUSPECT);
    expect(observer.reasons).toContain('silent_while_output_expected');
  });

  test('a changed document epoch blinds the observer instead of leaving it quiet', () => {
    const observer = ObserverHealth.assessObserver('dom', {
      installed: true,
      documentEpochChanged: true,
      lastSignalAt: Date.now()
    });

    expect(observer.state).toBe(STATES.BLIND);
    expect(observer.reasons).toContain('document_epoch_changed');
  });

  test('a discarded tab is blindness reported from outside, not silence', () => {
    const observer = ObserverHealth.assessObserver('lifecycle', {
      installed: true,
      discarded: true
    });
    expect(observer.state).toBe(STATES.BLIND);
    expect(observer.reasons).toContain('tab_discarded');
  });

  test('with a blind DOM observer, silence stops being evidence and the axis is contradicted', () => {
    const witness = ObserverHealth.buildWitnessSet({
      transport: { installed: false },
      dom: { installed: true, contextInvalidated: true }
    });

    expect(witness.silenceIsEvidence).toBe(false);
    expect(witness.ceiling).toBe(GUARANTEE.BLIND);
    expect(ObserverHealth.observerAxisState(witness)).toBe(AXIS_STATES.CONTRADICTED);
  });

  test('schema mismatch degrades the observer without blinding it', () => {
    const observer = ObserverHealth.assessObserver('transport', {
      installed: true,
      schemaMismatch: true,
      lastSignalAt: Date.now()
    });
    expect(observer.state).toBe(STATES.DEGRADED);
    expect(observer.reasons).toContain('schema_mismatch');
  });

  test('a degraded channel is only suspected, and no longer sets a strict ceiling', () => {
    const witness = ObserverHealth.buildWitnessSet({
      transport: { installed: true, parseFailures: 3, lastSignalAt: Date.now() },
      dom: { installed: true, lastSignalAt: Date.now() }
    });

    expect(witness.observers.transport.state).toBe(STATES.DEGRADED);
    expect(witness.ceiling).toBe(GUARANTEE.HEURISTIC);
    expect(ObserverHealth.observerAxisState(witness)).toBe(AXIS_STATES.SUSPECTED);
  });

  test('an undeclared channel is blind, not assumed healthy', () => {
    const witness = ObserverHealth.buildWitnessSet({});
    expect(witness.observers.transport.reasons).toContain('not_declared');
    expect(witness.anyHealthy).toBe(false);
    expect(witness.ceiling).toBe(GUARANTEE.BLIND);
  });
});

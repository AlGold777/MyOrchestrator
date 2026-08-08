const Ladder = require('../shared/completion-evidence-ladder');
const ObserverHealth = require('../shared/observer-health');
const RunResultContract = require('../shared/run-result-contract');

const { CLASSES } = Ladder;
const { GUARANTEE, AXIS_STATES } = RunResultContract;

const healthyTransportWitness = () => ObserverHealth.buildWitnessSet({
  transport: { installed: true, lastSignalAt: Date.now() },
  application: { installed: true, lastSignalAt: Date.now() },
  dom: { installed: true, lastSignalAt: Date.now() },
  lifecycle: { installed: true, lastSignalAt: Date.now() }
});

const domOnlyWitness = () => ObserverHealth.buildWitnessSet({
  transport: { installed: false },
  dom: { installed: true, lastSignalAt: Date.now() }
});

describe('CompletionEvidenceLadder', () => {
  test('a provider terminal token proves terminality and allows a commit', () => {
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'stream_done_token', correlationMethod: 'provider_id' }],
      witnessSet: healthyTransportWitness()
    });

    expect(verdict.strongestClass).toBe(CLASSES.P0);
    expect(verdict.terminality).toBe(AXIS_STATES.PROVEN);
    expect(verdict.guarantee).toBe(GUARANTEE.STRICT);
    expect(verdict.canCommit).toBe(true);
  });

  test('any number of agreeing DOM signals stays suspicion, never a commit', () => {
    const verdict = Ladder.evaluate({
      signals: [
        { kind: 'stop_button_gone' },
        { kind: 'regenerate_visible' },
        { kind: 'copy_button_stable' },
        { kind: 'content_mutation_stable' },
        { kind: 'completion_indicator' }
      ],
      witnessSet: domOnlyWitness()
    });

    expect(verdict.strongestClass).toBe(CLASSES.P3);
    expect(verdict.terminality).toBe(AXIS_STATES.SUSPECTED);
    expect(verdict.guarantee).toBe(GUARANTEE.HEURISTIC);
    expect(verdict.canCommit).toBe(false);
    expect(verdict.reasons).toContain('weak_agreement_does_not_promote_class');
  });

  test('one contradiction vetoes a commit that every other signal supports', () => {
    const verdict = Ladder.evaluate({
      signals: [
        { kind: 'stream_done_token', correlationMethod: 'provider_id' },
        { kind: 'stop_button_gone' },
        { kind: 'content_mutation_stable' }
      ],
      contradictions: ['stream_open'],
      witnessSet: healthyTransportWitness()
    });

    expect(verdict.veto.active).toBe(true);
    expect(verdict.veto.kinds).toContain('stream_open');
    expect(verdict.terminality).toBe(AXIS_STATES.CONTRADICTED);
    expect(verdict.canCommit).toBe(false);
  });

  test('a visible stop control vetoes the DOM completion signals beside it', () => {
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'content_mutation_stable' }, { kind: 'score_threshold' }],
      contradictions: [{ kind: 'stop_button_visible' }],
      witnessSet: domOnlyWitness()
    });

    expect(verdict.canCommit).toBe(false);
    expect(verdict.reasons.some((reason) => reason.startsWith('veto:'))).toBe(true);
  });

  test('stream closure alone is suspicion until the 1:1 contract is proven', () => {
    const suspected = Ladder.evaluate({
      signals: [{ kind: 'stream_closed', correlationMethod: 'provider_id' }],
      witnessSet: healthyTransportWitness()
    });
    expect(suspected.terminality).toBe(AXIS_STATES.SUSPECTED);
    expect(suspected.canCommit).toBe(false);
    expect(suspected.reasons).toContain('transport_contract_not_proven_one_to_one');

    const proven = Ladder.evaluate({
      signals: [{ kind: 'stream_closed', correlationMethod: 'provider_id' }],
      transportOneToOne: true,
      witnessSet: healthyTransportWitness()
    });
    expect(proven.terminality).toBe(AXIS_STATES.PROVEN);
    expect(proven.canCommit).toBe(true);
  });

  test('uncorrelated evidence is dropped, not discounted', () => {
    const verdict = Ladder.evaluate({
      signals: [
        { kind: 'stream_done_token', correlated: false },
        { kind: 'stop_button_gone' }
      ],
      witnessSet: healthyTransportWitness()
    });

    expect(verdict.strongestClass).toBe(CLASSES.P3);
    expect(verdict.rejectedSignals[0]).toEqual(expect.objectContaining({
      kind: 'stream_done_token',
      rejectReason: 'uncorrelated_signal'
    }));
  });

  test('a terminal fact correlated only by causal ordering stays suspicion', () => {
    // The fact is real; its attribution is not. A service request on the same
    // endpoint satisfies "started after this run did" just as well.
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'stream_done_token', correlationMethod: 'causal_order' }],
      witnessSet: healthyTransportWitness()
    });

    expect(verdict.strongestClass).toBe(CLASSES.P0);
    expect(verdict.terminality).toBe(AXIS_STATES.SUSPECTED);
    expect(verdict.guarantee).toBe(GUARANTEE.DEGRADED);
    expect(verdict.reasons).toContain('correlation_without_provider_id');
    expect(verdict.reasons).toContain('terminal_fact_not_attributed_to_this_run');
    expect(verdict.canCommit).toBe(false);
  });

  test('the same fact with a provider-issued identity does commit', () => {
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'stream_done_token', correlationMethod: 'provider_id' }],
      witnessSet: healthyTransportWitness()
    });

    expect(verdict.terminality).toBe(AXIS_STATES.PROVEN);
    expect(verdict.canCommit).toBe(true);
    expect(verdict.reasons).not.toContain('terminal_fact_not_attributed_to_this_run');
  });

  test('a blind witness set turns into a veto of its own', () => {
    const witnessSet = ObserverHealth.buildWitnessSet({
      transport: { installed: false },
      dom: { installed: true, contextInvalidated: true }
    });
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'silence_window' }],
      witnessSet
    });

    expect(verdict.veto.kinds).toContain('observer_blind');
    expect(verdict.canCommit).toBe(false);
  });

  test('a timeout is P4 and never proves terminality', () => {
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'hard_timeout' }],
      witnessSet: domOnlyWitness()
    });

    expect(Ladder.classOf('hard_timeout')).toBe(CLASSES.P4);
    expect(verdict.terminality).toBe(AXIS_STATES.SUSPECTED);
    expect(verdict.canCommit).toBe(false);
  });

  test('with no evidence at all the verdict is unproven, not negative', () => {
    const verdict = Ladder.evaluate({ signals: [], witnessSet: domOnlyWitness() });
    expect(verdict.terminality).toBe(AXIS_STATES.UNPROVEN);
    expect(verdict.reasons).toContain('no_terminal_evidence');
    expect(verdict.canCommit).toBe(false);
  });

  test('a strong signal seen by a DOM-only witness set is still capped by the observers', () => {
    const verdict = Ladder.evaluate({
      signals: [{ kind: 'provider_finish_reason', correlationMethod: 'provider_id' }],
      witnessSet: domOnlyWitness()
    });

    expect(verdict.terminality).toBe(AXIS_STATES.PROVEN);
    expect(verdict.guarantee).toBe(GUARANTEE.HEURISTIC);
  });
});

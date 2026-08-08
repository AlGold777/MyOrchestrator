const RunResultContract = require('../shared/run-result-contract');

const { RESULT_TYPES, GUARANTEE, AXIS_STATES, TERMINAL_REASONS } = RunResultContract;

const provenAxes = (overrides = {}) => Object.assign({
  identity: AXIS_STATES.PROVEN,
  terminality: AXIS_STATES.PROVEN,
  integrity: AXIS_STATES.PROVEN,
  semantic: AXIS_STATES.PROVEN,
  observer: AXIS_STATES.PROVEN
}, overrides);

describe('RunResultContract', () => {
  test('a fully proven run commits and exposes its text', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      terminalReason: TERMINAL_REASONS.STOP,
      axes: provenAxes(),
      text: 'proven answer'
    });

    expect(result.type).toBe(RESULT_TYPES.COMMITTED);
    expect(result.status).toBe('SUCCESS');
    expect(result.text).toBe('proven answer');
    expect(result.textReadable).toBe(true);
  });

  test('unproven terminality downgrades a commit claim to SUSPECTED_COMPLETE', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      axes: provenAxes({ terminality: AXIS_STATES.SUSPECTED }),
      text: 'maybe finished'
    });

    expect(result.type).toBe(RESULT_TYPES.SUSPECTED_COMPLETE);
    expect(result.reasons).toContain('terminality_not_proven');
    expect(result.status).toBe('PARTIAL');
  });

  test('reading text below COMMITTED throws until the caller acknowledges it', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.SUSPECTED_COMPLETE,
      guarantee: GUARANTEE.HEURISTIC,
      axes: provenAxes({ terminality: AXIS_STATES.SUSPECTED }),
      text: 'unproven answer'
    });

    expect(() => result.text).toThrow(/run_result_text_unproven:SUSPECTED_COMPLETE/);
    expect(result.readUncertainText('latency_mode_downstream')).toBe('unproven answer');
    expect(result.acknowledgedReads()[0]).toEqual(expect.objectContaining({
      acknowledgement: 'latency_mode_downstream'
    }));
  });

  test('an unnamed acknowledgement is refused', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.UNKNOWN,
      axes: provenAxes({ terminality: AXIS_STATES.UNPROVEN }),
      text: 'text'
    });
    expect(() => result.readUncertainText('')).toThrow('run_result_acknowledgement_required');
  });

  test('unproven identity makes the result UNKNOWN however strong the guarantee', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      axes: provenAxes({ identity: AXIS_STATES.UNPROVEN }),
      text: 'answer of some run'
    });

    expect(result.type).toBe(RESULT_TYPES.UNKNOWN);
    expect(result.reasons).toContain('identity_not_proven');
    expect(result.guarantee).toBe(GUARANTEE.HEURISTIC);
  });

  test('a heuristic guarantee cannot produce a strict commit', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.HEURISTIC,
      axes: provenAxes(),
      text: 'dom-only answer'
    });

    expect(result.type).toBe(RESULT_TYPES.SUSPECTED_COMPLETE);
    expect(result.reasons).toContain('heuristic_guarantee');
  });

  test('a blind witness set can never commit', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.BLIND,
      axes: provenAxes(),
      text: 'answer nobody watched'
    });
    expect(result.type).toBe(RESULT_TYPES.UNKNOWN);
    expect(result.reasons).toContain('blind_guarantee');
  });

  test('contradicted observer health becomes OBSERVER_LOST, not a completion', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      axes: provenAxes({ observer: AXIS_STATES.CONTRADICTED }),
      text: 'silence is not completion'
    });

    expect(result.type).toBe(RESULT_TYPES.OBSERVER_LOST);
    expect(result.status).toBe('UNCERTAIN');
    expect(() => result.text).toThrow();
  });

  test('length limit is terminal but is typed as truncated', () => {
    const result = RunResultContract.buildRunResult({
      guarantee: GUARANTEE.STRICT,
      terminalReason: TERMINAL_REASONS.LENGTH_LIMIT,
      axes: provenAxes(),
      text: 'cut off at the limit'
    });

    expect(result.type).toBe(RESULT_TYPES.COMMITTED_TRUNCATED);
    expect(result.text).toBe('cut off at the limit');
    expect(result.status).toBe('PARTIAL');
  });

  test('contradicted semantic completeness truncates an otherwise proven commit', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      terminalReason: TERMINAL_REASONS.STOP,
      axes: provenAxes({ semantic: AXIS_STATES.CONTRADICTED }),
      text: 'ends mid-sen'
    });

    expect(result.type).toBe(RESULT_TYPES.COMMITTED_TRUNCATED);
    expect(result.reasons).toContain('semantic_incomplete');
  });

  test('serialization carries the proof but never the text', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.COMMITTED,
      guarantee: GUARANTEE.STRICT,
      axes: provenAxes(),
      text: 'secret answer body',
      llmName: 'GPT'
    });

    const serialized = JSON.parse(JSON.stringify(result));
    expect(serialized).toEqual(expect.objectContaining({
      type: 'COMMITTED',
      guarantee: 'STRICT',
      length: 'secret answer body'.length,
      llmName: 'GPT'
    }));
    expect(JSON.stringify(result)).not.toContain('secret answer body');
  });

  test('spreading or logging the result does not trip the text guard', () => {
    const result = RunResultContract.buildRunResult({
      type: RESULT_TYPES.UNKNOWN,
      axes: provenAxes({ terminality: AXIS_STATES.UNPROVEN }),
      text: 'hidden'
    });
    expect(() => ({ ...result })).not.toThrow();
    expect(Object.keys(result)).not.toContain('text');
  });

  test('guarantee comparison orders the levels', () => {
    expect(RunResultContract.minGuarantee(GUARANTEE.STRICT, GUARANTEE.DEGRADED)).toBe(GUARANTEE.DEGRADED);
    expect(RunResultContract.compareGuarantee(GUARANTEE.HEURISTIC, GUARANTEE.BLIND)).toBeGreaterThan(0);
  });
});

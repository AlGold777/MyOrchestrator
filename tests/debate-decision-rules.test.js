const Decisions = require('../disput/debate-decision-request');
const Rules = require('../disput/debate-rule-engine');
const History = require('../disput/debate-rule-history');
const Signals = require('../disput/debate-model-signal');

describe('typed moderator decisions', () => {
  test('creates contextual options and resolves the selected effect', () => {
    const request = Decisions.forTask({ id: 't1', targetId: 'e1', triggerId: 'FACT_DISPUTE', action: 'verify_fact', reason: 'Fact is disputed' }, { runId: 'r1', mode: 'assisted' });
    expect(Decisions.validate(request)).toEqual({ ok: true, errors: [] });
    expect(request.options.map((option) => option.id)).toEqual(['execute', 'limitation', 'synthesize']);
    expect(Decisions.resolve(request, 'limitation', 'human')).toMatchObject({ requestId: request.requestId, effect: 'accept_as_limitation', actor: 'human' });
  });

  test('stagnation offers synthesis, one extra step, or stop', () => {
    const request = Decisions.forStagnation({ runId: 'r1' });
    expect(request.recommendedOptionId).toBe('synthesize');
    expect(request.options.map((option) => option.effect)).toEqual(['synthesize_now', 'continue_one_step', 'stop_run']);
  });
});

describe('profile-driven rule engine', () => {
  const map = { runId: 'r1', claims: [{ id: 'c1' }], objections: [], blockers: [], revisions: [], dissent: [], contradictions: [], evidence: [{ id: 'e1', tier: 'model_argument' }], readiness: { id: 'not_ready' } };

  test('uses priority, parameters and produces an explainable trace', () => {
    const result = Rules.evaluate(map, {}, [
      { ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', priority: 120, parameters: { tiers: ['model_argument'] } },
      { ruleId: 'claims', triggerId: 'UNCRITICIZED_CLAIM', priority: 10 }
    ]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => task.ruleId)).toEqual(expect.arrayContaining(['weak', 'claims']));
    expect(result.traces.every((trace) => trace.status === 'fired')).toBe(true);
    expect(Rules.utility(result.tasks.find((task) => task.ruleId === 'weak'), map)).toBeGreaterThan(Rules.utility(result.tasks.find((task) => task.ruleId === 'claims'), map));
  });

  test('suppresses a rule at its execution ceiling', () => {
    const result = Rules.evaluate(map, { loopCounts: { 'WEAK_EVIDENCE:e1': 2 } }, [{ ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', maxExecutions: 2 }]);
    expect(result.tasks).toHaveLength(0);
    expect(result.traces[0]).toMatchObject({ status: 'suppressed', reasonCode: 'execution_ceiling' });
  });
});

describe('cross-run rule history', () => {
  test('calculates firing and post-action progress rates', () => {
    const result = History.summarize([{
      runId: 'r1',
      ruleEvaluations: [
        { eventType: 'RULE_EVALUATED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'fired' },
        { eventType: 'RULE_FIRED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'fired' },
        { eventType: 'RULE_EVALUATED', ruleId: 'weak', triggerId: 'WEAK_EVIDENCE', status: 'suppressed' }
      ],
      progressWindow: [{ triggerId: 'WEAK_EVIDENCE', stateChanged: true }]
    }]);
    expect(result.byRule.weak).toMatchObject({ evaluated: 2, fired: 1, suppressed: 1, completed: 1, changed: 1, fireRate: 0.5, progressRate: 1 });
  });
});

describe('diagnostic-only model signal', () => {
  test('strips a valid signal from the visible answer', () => {
    const parsed = Signals.extract('Useful answer.\n<disput-signal>{"type":"evidence","confidence":0.8,"targetId":"c1","reason":"new source"}</disput-signal>');
    expect(parsed.text).toBe('Useful answer.');
    expect(parsed.signal).toMatchObject({ type: 'evidence', confidence: 0.8, targetId: 'c1' });
  });

  test('rejects malformed signals without rejecting the answer', () => {
    const parsed = Signals.extract('Useful answer.\n<disput-signal>{bad}</disput-signal>');
    expect(parsed.text).toBe('Useful answer.');
    expect(parsed.signal).toBeNull();
    expect(parsed.errors).toContain('model_signal_json_invalid');
  });
});

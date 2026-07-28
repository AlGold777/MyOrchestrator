const ProblemContextFilter = require('../shared/problem-context-filter');

describe('problem context filter', () => {
  test('classifies severity and failure tokens consistently', () => {
    expect(ProblemContextFilter.isProblem({ severity: 'high', eventType: 'NOTICE' })).toBe(true);
    expect(ProblemContextFilter.isProblem({ level: 'info', label: 'ANSWER_TIMEOUT' })).toBe(true);
    expect(ProblemContextFilter.isProblem({ level: 'info', label: 'ANSWER_COMPLETE' })).toBe(false);
  });

  test('keeps the problem and preceding context only from the same causal scope', () => {
    const events = [
      { id: 'a1', scope: 'a', label: 'START', level: 'info' },
      { id: 'b1', scope: 'b', label: 'START', level: 'info' },
      { id: 'a2', scope: 'a', label: 'PROGRESS', level: 'info' },
      { id: 'b2', scope: 'b', label: 'PROGRESS', level: 'info' },
      { id: 'a3', scope: 'a', label: 'ANSWER_TIMEOUT', level: 'warning' }
    ];

    const filtered = ProblemContextFilter.filterWithContext(events, {
      contextBefore: 2,
      getContextKey: (event) => event.scope
    });

    expect(filtered.map((event) => event.id)).toEqual(['a1', 'a2', 'a3']);
  });

  test('returns an empty list when no problems are present', () => {
    expect(ProblemContextFilter.filterWithContext([
      { label: 'START', level: 'info' },
      { label: 'COMPLETE', level: 'success' }
    ])).toEqual([]);
  });
});

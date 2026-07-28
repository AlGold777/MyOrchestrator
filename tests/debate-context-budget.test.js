const Budget = require('../disput/debate-context-budget');

describe('DebateContextBudget', () => {
  test('compacts old filtered history before current wave and never edits last_wave', () => {
    const old = 'old '.repeat(100);
    const latest = 'latest '.repeat(40);
    const prompt = `Instructions\n${old}\n${latest}`;
    const result = Budget.compactPrompt(prompt, [
      { id: 'full_history', label: 'old waves', text: old, priority: 'low', wave: 1 },
      { id: 'last_wave', label: 'latest wave', text: latest, priority: 'high', wave: 4 }
    ], { promptChars: 500, currentWave: 4 });
    expect(result.compacted).toBe(true);
    expect(result.text).toContain('см. filtered state');
    expect(result.text).toContain(latest);
    expect(result.text.length).toBeLessThanOrEqual(500);
  });

  test('terminates for a limit smaller than the truncation marker', () => {
    const result = Budget.compactPrompt('x'.repeat(200), [], { promptChars: 10 });
    expect(result.text.length).toBeLessThanOrEqual(10);
  });
});

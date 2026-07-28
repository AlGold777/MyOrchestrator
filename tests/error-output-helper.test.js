const ResultsShared = require('../results-shared');

describe('ResultsShared.isErrorOutput', () => {
  test('recognizes empty outputs as errors', () => {
    expect(ResultsShared.isErrorOutput(null)).toBe(true);
    expect(ResultsShared.isErrorOutput('')).toBe(true);
    expect(ResultsShared.isErrorOutput('  ')).toBe(true);
  });

  test('recognizes legacy error strings', () => {
    expect(ResultsShared.isErrorOutput('Error: x')).toBe(true);
    expect(ResultsShared.isErrorOutput('error : x')).toBe(true);
    expect(ResultsShared.isErrorOutput('Error codes are documented')).toBe(false);
  });

  test('recognizes structured run errors', () => {
    expect(ResultsShared.isErrorOutput({ ok: false })).toBe(true);
    expect(ResultsShared.isErrorOutput({ ok: true, text: 'hi' })).toBe(false);
    expect(ResultsShared.isErrorOutput('Normal answer')).toBe(false);
  });

  test('recognizes provider did-not-answer display text as an error output', () => {
    expect(ResultsShared.isErrorOutput("GPT don't answer")).toBe(true);
    expect(ResultsShared.isErrorOutput("Z.ai don't answer")).toBe(true);
    expect(ResultsShared.isErrorOutput("Le Chat don't answer")).toBe(true);
  });
});

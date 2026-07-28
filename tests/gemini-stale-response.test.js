const fs = require('fs');
const path = require('path');

const GEMINI_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-gemini.js'),
  'utf8'
);
const TELEMETRY_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'background', 'telemetry-logs.js'),
  'utf8'
);

describe('Gemini latest-response freshness guard', () => {
  test('response candidates are merged and ordered by actual DOM position', () => {
    expect(GEMINI_SRC).toContain('const seen = new Set();');
    expect(GEMINI_SRC).toContain('a.compareDocumentPosition?.(b)');
    expect(GEMINI_SRC).toContain('Node.DOCUMENT_POSITION_FOLLOWING');
    expect(GEMINI_SRC).toContain('/\\b(user|human)\\b/.test(role)');
  });

  test('pipeline and DOM fallback reject the pre-dispatch baseline', () => {
    expect(GEMINI_SRC).toContain('const preDispatchBaseline = buildGeminiAnswerBaseline');
    expect(GEMINI_SRC).toContain('isGeminiBaselineCandidate({ text: cleanedResponse');
    expect(GEMINI_SRC).toContain('await waitForFreshGeminiAnswer(preDispatchBaseline');
    expect(GEMINI_SRC).toContain("!isGeminiBaselineCandidate({ text: cleanedFinder, node: null }, preDispatchBaseline)");
    expect(GEMINI_SRC).toContain("label: 'GEMINI_STALE_BASELINE_REJECTED'");
    expect(TELEMETRY_SRC).toContain("'GEMINI_STALE_BASELINE_REJECTED'");
  });
});

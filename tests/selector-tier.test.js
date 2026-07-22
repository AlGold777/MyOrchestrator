// Review P1.1: the answer's selector is tagged with a trust tier so a final coming
// from a generic/last-resort selector is observable (a leading signal of selector
// drift). The protective "low-tier needs confirmation" rule is already satisfied by
// the content-classifier gate in finalize; this locks the tagging + telemetry.
const fs = require('fs');
const path = require('path');

const PIPELINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'),
  'utf8'
);

describe('selector tier tagging (P1.1)', () => {
  test('pipeline classifies + records the answer selector tier', () => {
    expect(PIPELINE_SRC).toContain('classifySelectorTier(');
    expect(PIPELINE_SRC).toContain('this.lastAnswerSelectorTier');
    expect(PIPELINE_SRC).toContain("selectorTier");
    expect(PIPELINE_SRC).toContain('finalization_low_tier_selector');
  });

  test('selector-health circuit is consulted (skip) and fed (report) at finalize', () => {
    expect(PIPELINE_SRC).toContain('window.SelectorCircuit');
    expect(PIPELINE_SRC).toContain("circuit.shouldUse(selector, this.platform, 'answer') !== false");
    // success for the winning selector; drift failure for higher-priority misses.
    expect(PIPELINE_SRC).toContain("circuit.report(selector, this.platform, 'answer', true)");
    expect(PIPELINE_SRC).toContain("circuit.report(selector, this.platform, 'answer', false)");
    expect(PIPELINE_SRC).toContain('getAnswerElement({ reportHealth: true })');
  });

  test('tier contract: generic selectors are last_resort, specific ones are higher', () => {
    // Mirror of classifySelectorTier.
    const classify = (selector, index, total) => {
      if (!selector) return 'unknown';
      const s = String(selector).toLowerCase();
      if (/\.prose|^article$|\barticle\b|\[class\*="markdown"\]|(^|\s)main(\s|$)|generic/.test(s)) return 'last_resort_generic';
      if (index === 0) return 'primary_assistant';
      if (typeof total === 'number' && total > 0 && index >= total - 2) return 'generic_markdown';
      return 'secondary_platform_specific';
    };
    expect(classify('div[data-message-author-role="assistant"]', 0, 6)).toBe('primary_assistant');
    expect(classify('.prose, article', 5, 6)).toBe('last_resort_generic');
    expect(classify('article', 2, 6)).toBe('last_resort_generic');
    expect(classify('[data-testid="msg"]', 4, 6)).toBe('generic_markdown'); // near the end
    expect(classify('[data-testid="msg"]', 2, 6)).toBe('secondary_platform_specific');
    expect(classify(null, 0, 6)).toBe('unknown');
  });
});

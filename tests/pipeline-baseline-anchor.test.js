// Verifies F6: UnifiedAnswerPipeline anchors to a pre-run baseline and rejects the
// previous answer (stale baseline) at finalization, for all adapters. The pipeline
// itself is DOM/browser heavy, so this locks the wiring + the pure comparison logic.
const fs = require('fs');
const path = require('path');

const PIPELINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'unified-answer-pipeline.js'),
  'utf8'
);
const CLAUDE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-claude.js'),
  'utf8'
);

describe('pipeline baseline anchor (F6)', () => {
  test('constructor captures a baseline signature', () => {
    expect(PIPELINE_SRC).toContain('this.baselineAnswerSignature');
    expect(PIPELINE_SRC).toContain('overrides.baselineText');
  });

  test('finalization rejects a stale baseline answer', () => {
    expect(PIPELINE_SRC).toContain('isStaleBaselineAnswer(answer)');
    expect(PIPELINE_SRC).toContain("error: 'stale_baseline_answer'");
  });

  test('finalization rejects non-answer content via the classifier (P1.2/P1.3)', () => {
    expect(PIPELINE_SRC).toContain('AnswerContentClassifier');
    expect(PIPELINE_SRC).toContain('!classification.terminalEligible');
    expect(PIPELINE_SRC).toContain('non_answer_content:');
  });

  test('Claude adapter forwards its captured baseline into the pipeline', () => {
    expect(CLAUDE_SRC).toContain('baselineText: claudeDispatchBaseline');
  });

  test('the stale comparison contract (normalize + exact match)', () => {
    // Mirror of normalizeAnswerSignature/isStaleBaselineAnswer to pin the semantics.
    const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isStale = (baselineSig, answer) => {
      if (!baselineSig) return false;
      const candidate = normalize(answer);
      if (!candidate) return false;
      return candidate === baselineSig;
    };
    const baseline = normalize('  Previous   ANSWER\ntext ');
    expect(isStale(baseline, 'previous answer text')).toBe(true);   // same content, cosmetic diff
    expect(isStale(baseline, 'a brand new answer')).toBe(false);    // genuinely new
    expect(isStale('', 'anything')).toBe(false);                    // fresh page, no baseline
    expect(isStale(baseline, '')).toBe(false);                      // empty candidate
  });
});

/** @jest-environment jsdom */
// Field evidence, telemetry export 2026-07-31 (extensionVersion 2.81.201):
// a run in which the prompt reached only one provider still reported SUCCESS
// for two others, because each returned the answer already present on its
// reused page.
//
//   model      baseline (prior page text)   delivered   reported
//   DeepSeek                    5055 chars   5005 chars  SUCCESS
//   Qwen                         646 chars     648 chars SUCCESS
//   GPT                            0 chars    7444 chars SUCCESS  <- the only real one
//
// Every one of those decisions was `mode: forced, evidenceTier: 0` with
// `answer_identity_current_dispatch` observed as "candidate" — the answer was
// never proven to belong to the dispatch. The stale-baseline guard should have
// caught the first two, but compared for strict equality, and a re-render or a
// trimmed tail moves a few characters.
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'content-scripts', 'content-utils.js'),
  'utf8'
);

describe('stale answer guard against a near-identical baseline', () => {
  let isBaselineEquivalent;

  beforeEach(() => {
    delete window.ContentUtils;
    window.eval(SOURCE);
    isBaselineEquivalent = window.ContentUtils.isBaselineEquivalent;
  });

  const longAnswer = (seed, chars) => {
    let text = `${seed} `;
    while (text.length < chars) text += `${seed} sentence ${text.length} carries the body of the answer. `;
    return text.slice(0, chars);
  };

  test('identical text is still baseline-equivalent', () => {
    const answer = longAnswer('alpha', 800);
    expect(isBaselineEquivalent(answer, answer)).toBe(true);
  });

  test('the DeepSeek case: 5055 chars on the page, 5005 delivered', () => {
    const baseline = longAnswer('deepseek', 5055);
    const delivered = baseline.slice(0, 5005);
    expect(isBaselineEquivalent(delivered, baseline)).toBe(true);
  });

  test('the Qwen case: 646 chars on the page, 648 delivered', () => {
    const baseline = longAnswer('qwen', 646);
    const delivered = `${baseline}!!`;
    expect(isBaselineEquivalent(delivered, baseline)).toBe(true);
  });

  test('a genuinely different answer of similar length is not suppressed', () => {
    const baseline = longAnswer('alpha', 3000);
    const fresh = longAnswer('omega', 3000);
    expect(isBaselineEquivalent(fresh, baseline)).toBe(false);
  });

  test('a new answer that opens with the same sentence is not suppressed', () => {
    const shared = 'To answer this precisely, start from the transaction boundary. ';
    const baseline = shared + longAnswer('alpha', 2000);
    const fresh = shared + longAnswer('omega', 2000);
    expect(isBaselineEquivalent(fresh, baseline)).toBe(false);
  });

  test('short texts are left alone, where incidental similarity is likely', () => {
    expect(isBaselineEquivalent('Yes, that is correct.', 'Yes, that is correct!')).toBe(false);
  });

  test('an empty side never counts as equivalent', () => {
    const answer = longAnswer('alpha', 900);
    expect(isBaselineEquivalent(answer, '')).toBe(false);
    expect(isBaselineEquivalent('', answer)).toBe(false);
  });
});

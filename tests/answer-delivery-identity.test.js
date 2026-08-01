// Field evidence, full telemetry report 2026-08-01 (run 1785580394378):
// two answers that had actually been generated were discarded by the
// background's lifecycle correlation, for two different reasons.
//
//   Grok      LLM_RESPONSE:dispatch_mismatch      (detailsLength 30)
//   DeepSeek  LLM_RESPONSE:run_session_mismatch   (detailsLength 33)
//
// Grok's main delivery path called sendResult without the dispatch meta that
// was already in scope, so the answer arrived with a null dispatchId. DeepSeek's
// sendResult forwarded whatever meta the caller passed, and the manual-ping path
// passes `msg?.meta` — a manual ping carries no dispatch identity — so the
// delivery went out under a leftover session.
//
// Both answers existed. Neither reached the user.
const fs = require('fs');
const path = require('path');

const GROK = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-grok.js'), 'utf8');
const DEEPSEEK = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-deepseek.js'), 'utf8');

describe('an answer is delivered with the identity of its own dispatch', () => {
  test('Grok delivers the answer with the dispatch meta in scope', () => {
    const deliver = GROK.slice(
      GROK.indexOf('const deliverAnswer = (answerPayload'),
      GROK.indexOf('activity.stop({ status: \'success\'', GROK.indexOf('const deliverAnswer = (answerPayload'))
    );
    expect(deliver).toContain('sendResult(payload, true, dispatchMeta)');
    // A bare two-argument call in this path is the defect itself.
    expect(deliver).not.toMatch(/sendResult\(payload,\s*true\)\s*;/);
  });

  test('Grok computes that dispatch meta before it can be used', () => {
    const inject = GROK.slice(GROK.indexOf('async function injectAndGetResponse'));
    const metaAt = inject.indexOf('const dispatchMeta');
    const useAt = inject.indexOf('sendResult(payload, true, dispatchMeta)');
    expect(metaAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(metaAt);
  });

  test('DeepSeek normalises delivery identity in one place, covering every path', () => {
    const send = DEEPSEEK.slice(
      DEEPSEEK.indexOf('function sendResult(resp, ok = true'),
      DEEPSEEK.indexOf('// ---- Attachment helpers ---- //')
    );
    expect(send).toContain('ContentUtils?.ensureDispatchMeta');
    // The raw caller-supplied meta must no longer be forwarded unnormalised.
    expect(send).not.toContain("(meta && typeof meta === 'object' ? meta : null)\n    });");
    expect(send).toContain('meta: responseMeta');
    expect(send).toContain('identity');
  });

  test('the manual-ping path is the one that carried no identity', () => {
    // Kept as documentation of the trigger: a manual ping forwards msg?.meta,
    // which is absent, so normalisation inside sendResult is what fixes it.
    expect(DEEPSEEK).toContain("sendResult({ text: cleaned, html: latest.html || lastResponseHtml }, true, 'LLM_RESPONSE', msg?.meta || null)");
  });

  test('normalisation fills gaps rather than overriding an explicit meta', () => {
    const utils = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-utils.js'), 'utf8');
    const ensure = utils.slice(
      utils.indexOf('const ensureDispatchMeta'),
      utils.indexOf('const ensureDispatchMeta') + 900
    );
    // base.<field> wins; the stored fallback only applies when absent.
    expect(ensure).toContain('base.runSessionId || storedRunSessionId');
    expect(ensure).toContain('if (storedDispatchId && !base.dispatchId)');
  });
});

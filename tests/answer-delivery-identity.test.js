const fs = require('fs');
const path = require('path');

const GROK = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-grok.js'), 'utf8');
const DEEPSEEK = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-deepseek.js'), 'utf8');

describe('generated answers keep the identity of their dispatch', () => {
  test('Grok primary automatic delivery passes the dispatch meta in scope', () => {
    const deliverStart = GROK.indexOf('const deliverAnswer = (answerPayload');
    const deliver = GROK.slice(deliverStart, GROK.indexOf("activity.stop({ status: 'success'", deliverStart));
    expect(deliver).toContain('sendResult(payload, true, dispatchMeta)');
    expect(deliver).not.toMatch(/sendResult\(payload,\s*true\)\s*;/);
  });

  test('DeepSeek normalizes identity once for every delivery path', () => {
    const send = DEEPSEEK.slice(
      DEEPSEEK.indexOf('function sendResult(resp, ok = true'),
      DEEPSEEK.indexOf('// ---- Attachment helpers ---- //')
    );
    expect(send).toContain('ContentUtils?.ensureDispatchMeta');
    expect(send).toContain('Object.assign({}, identity || {}, { responseMeta })');
    expect(send).toContain(': identity');
  });

  test('identity normalization fills gaps and preserves explicit dispatch identity', () => {
    const utils = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'content-utils.js'), 'utf8');
    const ensureAt = utils.indexOf('const ensureDispatchMeta');
    const ensure = utils.slice(ensureAt, ensureAt + 900);
    expect(ensure).toContain('base.runSessionId || storedRunSessionId');
    expect(ensure).toContain('if (storedDispatchId && !base.dispatchId)');
  });
});

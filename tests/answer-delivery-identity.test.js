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

describe('automatic terminal extraction recovery uses the working collector', () => {
  const ORCH = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
  const recoveryStart = ORCH.indexOf('async function runTerminalExtractionRecovery');
  const recovery = ORCH.slice(
    recoveryStart,
    ORCH.indexOf("emitTelemetry(llmName, accepted ? 'TERMINAL_EXTRACTION_AUTO_RECOVERY_SUCCESS'", recoveryStart)
  );

  test('requests the latest answer rather than repeating the failed default target', () => {
    const flagAt = recovery.indexOf('manualLatestRecovery: true');
    expect(flagAt).toBeGreaterThan(-1);
    expect(flagAt).toBeLessThan(recovery.indexOf('lateCollectAnswer({'));
  });

  test('collection and acceptance share the exact same correlation object', () => {
    expect(recovery).toContain('meta: recoveryMeta');
    expect(recovery).toContain('acceptLateCollectResult(llmName, result, recoveryMeta)');
  });

  test('the latest-answer flag is consumed by late collection plumbing', () => {
    const plumbingAt = ORCH.indexOf('const manualLatestRecovery = Boolean(manualRecovery?.manualLatestRecovery');
    const plumbing = ORCH.slice(plumbingAt, plumbingAt + 240);
    expect(plumbing).toContain('meta?.manualLatestRecovery');
    expect(plumbing).toContain('meta?.responseMeta?.manualLatestRecovery');
  });
});

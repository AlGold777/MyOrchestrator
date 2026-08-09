const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('provider focused dispatch ownership', () => {
  test('Grok acknowledges command ownership before asynchronous provider work', () => {
    const source = read('content-scripts/content-grok.js');
    const handlerAt = source.indexOf("if (msg?.type === 'GET_ANSWER'");
    const acceptedAt = source.indexOf("status: 'accepted'", handlerAt);
    const activeAt = source.indexOf("reportProviderPipelineState?.(MODEL, acceptedMeta || msg.meta || null, 'composer', true)", acceptedAt);
    const injectAt = source.indexOf('injectAndGetResponse(', activeAt);
    expect(handlerAt).toBeGreaterThan(0);
    expect(acceptedAt).toBeGreaterThan(handlerAt);
    expect(activeAt).toBeGreaterThan(acceptedAt);
    expect(injectAt).toBeGreaterThan(activeAt);
    expect(source.slice(handlerAt, injectAt)).toContain('sendResponse?.({');
    expect(source.slice(handlerAt, injectAt)).toContain('return false;');
  });

  test('Grok releases provider ownership after the asynchronous pipeline settles', () => {
    const source = read('content-scripts/content-grok.js');
    const handlerAt = source.indexOf("if (msg?.type === 'GET_ANSWER'");
    const handler = source.slice(handlerAt, source.indexOf("if (msg.action === 'injectPrompt'", handlerAt));
    expect(handler).toContain('.finally(() => {');
    expect(handler).toContain("'composer', false");
    expect(handler).toContain("'answer_collection', false");
    expect(handler).toContain('releaseActive();');
  });

  test('recovery dispatches defer while current provider ownership is alive', () => {
    const coordinator = read('background/dispatch-coordinator.js');
    expect(coordinator).toContain('function isProviderPipelineOwnershipActive');
    expect(coordinator).toContain('providerComposerTransactionActive');
    expect(coordinator).toContain("['retry_supervisor', 'round2_repair', 'round2_repair_pre_visit'].includes(reason)");
    expect(coordinator).toContain("reason: 'provider_pipeline_active'");
    expect(coordinator).toContain('const getProviderPipelineOwnershipTtlMs = () => getScriptRuntimeHardStopMs()');
  });

  test('Gemini acknowledges composer ownership before asynchronous provider work', () => {
    const source = read('content-scripts/content-gemini.js');
    const handlerAt = source.indexOf("if (message?.type === 'GET_ANSWER'");
    const activeAt = source.indexOf("reportProviderPipelineState?.(MODEL, acceptedMeta, 'composer', true)", handlerAt);
    const acceptedAt = source.indexOf("status: 'accepted'", activeAt);
    const injectAt = source.indexOf('injectAndGetResponse(', acceptedAt);
    expect(handlerAt).toBeGreaterThan(-1);
    expect(activeAt).toBeGreaterThan(handlerAt);
    expect(acceptedAt).toBeGreaterThan(activeAt);
    expect(injectAt).toBeGreaterThan(acceptedAt);
    expect(source.slice(handlerAt, injectAt)).toContain('sendResponse?.({');
  });

  test('Gemini releases composer ownership when asynchronous work settles', () => {
    const source = read('content-scripts/content-gemini.js');
    const handlerAt = source.indexOf("if (message?.type === 'GET_ANSWER'");
    const handler = source.slice(handlerAt, source.indexOf('// --- БАЗОВЫЙ HEARTBEAT', handlerAt));
    expect(handler).toContain('.finally(() => {');
    expect(handler).toContain("'composer', false");
    expect(handler).toContain("'answer_collection', false");
    expect(source).toContain('const sharedPromise = opPromise.finally');
    expect(source).toContain('geminiSharedInjection === sharedPromise');
  });
});

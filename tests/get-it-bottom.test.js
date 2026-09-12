/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../results'), 'utf8');
const start = source.indexOf("if (getItButton) {\n    getItButton.addEventListener('click'");
const handler = source.slice(start, source.indexOf('function getSelectedJudgeSystemPrompt', start));

test('forced status double-click requests bottom preparation independently of the batch button', () => {
  expect(source).toContain("getIt: options.source === 'status_indicator_dblclick'");
  const router = fs.readFileSync(require.resolve('../background/message-router'), 'utf8');
  const request = router.slice(router.indexOf("case 'REQUEST_LLM_RESPONSE'"));
  expect(request).toContain('getIt: message.getIt === true');
});

test('manual recovery prefers the run-bound tab and does not silently switch a missing tab', async () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('async function handleManualResponsePing');
  const c = { jobState: { llms: { GPT: { tabId: 11 } } }, TabMapManager: { get: () => 22 },
    getTabSafe: jest.fn(async id => ({ id })), isEligibleTabForLlm: () => true };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('  if (!tabId) {', from)) + 'return {tabId};\n}', c);
  expect((await c.handleManualResponsePing('GPT')).tabId).toBe(11);
  c.getTabSafe.mockResolvedValue(null);
  expect((await c.handleManualResponsePing('GPT')).status).toBe('manual_ping_failed');
});

test('Get it can re-read an unchanged current answer while still excluding the pre-dispatch answer', () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('const buildManualLatestRecoveryOptions =');
  const c = { normalizeAnswerSignatureBg: v => v.trim(), MANUAL_RECOVERY_STRATEGIES: [{ id: 'bottom_most' }] };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('const markLastManualCandidateRejected', from)), c);
  const result = vm.runInContext("buildManualLatestRecoveryOptions({answer:'current', pendingFinalAnswer:'partial', preDispatchAnswerSignature:'old'}, 'GPT', null, {keepCurrentAnswer:true})", c);
  expect(Array.from(result.excludeTextSignatures)).toEqual(['old']);
});

test('Get it hands the entire queue to the background in one message', async () => {
  let click, finishFirst;
  const order = [];
  const c = {
    console, getItButton: { dataset: {}, addEventListener: (_, fn) => { click = fn; } },
    getSelectedLLMs: () => ['GPT', 'Qwen', 'Claude'],
    pendingResponses: { GPT: 'old' }, updateLLMPanelOutput: () => order.push('old'),
    checkCompareButtonState: jest.fn(), showNotification: jest.fn(),
    chrome: { runtime: { sendMessage: jest.fn(message => {
      order.push(message.type);
      return new Promise(resolve => { finishFirst = resolve; });
    }) } }
  };
  vm.runInNewContext(handler, c);
  const first = click();
  await click(); // A duplicate click cannot start a competing focus sequence.
  expect(order).toEqual(['old', 'GET_IT_BATCH']);
  finishFirst({ results: [{ llmName: 'GPT', status: 'manual_ping_failed', error: 'bottom unavailable' }] });
  await first;
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(c.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_IT_BATCH', llmNames: ['GPT', 'Qwen', 'Claude'] });
  expect(c.showNotification).toHaveBeenCalledWith('GPT: bottom unavailable');
  expect(c.getItButton.dataset.collecting).toBeUndefined();
});

function batchSetup() {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('let getItBatchInFlight =');
  const c = {
    jobState: { llms: { GPT: {}, Qwen: {}, Claude: {} } }, LLM_TARGETS: {},
    getActiveSessionId: () => 1, isSessionActive: () => true,
    handleManualResponsePing: jest.fn(async () => ({ status: 'manual_ping_sent' }))
  };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('async function handleManualResponsePing', from)), c);
  return c;
}

test('background advances through the whole queue without any further UI message or callback', async () => {
  const c = batchSetup(); let finishFirst;
  c.handleManualResponsePing.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
  const batch = c.collectGetItBatch(['GPT', 'Qwen', 'Claude', 'GPT']);
  expect(c.collectGetItBatch(['GPT'])).toBe(batch);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(1);
  finishFirst({ status: 'manual_ping_sent' });
  const result = await batch;
  expect(c.handleManualResponsePing.mock.calls.map(([name]) => name)).toEqual(['GPT', 'Qwen', 'Claude']);
  expect(result.results).toHaveLength(3);
  expect(c.handleManualResponsePing).toHaveBeenLastCalledWith('Claude', expect.objectContaining({ getIt: true, manualLatestRecovery: true }));
});

test('one model failing does not hold the remaining queue', async () => {
  const c = batchSetup(); c.handleManualResponsePing.mockRejectedValueOnce(new Error('closed tab'));
  const result = await c.collectGetItBatch(['GPT', 'Qwen']);
  expect(result.results[0].status).toBe('manual_ping_failed');
  expect(result.results[1].llmName).toBe('Qwen');
  await c.collectGetItBatch(['Claude']);
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(3);
});

test('a new session stops the old batch before the next page', async () => {
  const c = batchSetup();
  c.handleManualResponsePing.mockImplementationOnce(async () => { c.isSessionActive = () => false; return {}; });
  expect((await c.collectGetItBatch(['GPT', 'Qwen'])).status).toBe('get_it_cancelled');
  expect(c.handleManualResponsePing).toHaveBeenCalledTimes(1);
});

test('Get it inline collection skips the health round-trip but validates the tab', async () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('async function classifyLateCollectState');
  const c = { getTabSafe: async () => ({ id: 1 }), isEligibleTabForLlm: () => true,
    buildTabSnapshot: tab => tab, sendTabMessageForLateCollect: jest.fn() };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('async function runInlineLateExtract', from)), c);
  expect((await c.classifyLateCollectState(1, 'GPT', { inlineOnly: true })).state).toBe('REINJECTABLE');
  expect(c.sendTabMessageForLateCollect).not.toHaveBeenCalled();
  c.isEligibleTabForLlm = () => false;
  expect((await c.classifyLateCollectState(1, 'GPT', { inlineOnly: true })).reason).toBe('tab_ineligible');
});

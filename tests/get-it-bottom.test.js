/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../results'), 'utf8');
const start = source.indexOf("if (getItButton) {\n    getItButton.addEventListener('click'");
const handler = source.slice(start, source.indexOf('function getSelectedJudgeSystemPrompt', start));

test('Get it can re-read an unchanged current answer while still excluding the pre-dispatch answer', () => {
  const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');
  const from = orch.indexOf('const buildManualLatestRecoveryOptions =');
  const c = { normalizeAnswerSignatureBg: v => v.trim(), MANUAL_RECOVERY_STRATEGIES: [{ id: 'bottom_most' }] };
  vm.createContext(c);
  vm.runInContext(orch.slice(from, orch.indexOf('const markLastManualCandidateRejected', from)), c);
  const result = vm.runInContext("buildManualLatestRecoveryOptions({answer:'current', pendingFinalAnswer:'partial', preDispatchAnswerSignature:'old'}, 'GPT', null, {keepCurrentAnswer:true})", c);
  expect(Array.from(result.excludeTextSignatures)).toEqual(['old']);
});

test('Get it requests fresh collection for every model sequentially and flushes old pending text first', async () => {
  let click, finishFirst;
  const order = [];
  const c = {
    console, getItButton: { dataset: {}, addEventListener: (_, fn) => { click = fn; } },
    getSelectedLLMs: () => ['GPT', 'Qwen', 'Claude'],
    pendingResponses: { GPT: 'old' }, updateLLMPanelOutput: () => order.push('old'),
    checkCompareButtonState: jest.fn(), showNotification: jest.fn(),
    chrome: { runtime: { sendMessage: jest.fn(message => {
      order.push(message.llmName);
      return message.llmName === 'GPT' ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve({});
    }) } }
  };
  vm.runInNewContext(handler, c);
  const first = click();
  await click(); // A duplicate click cannot start a competing focus sequence.
  expect(order).toEqual(['old', 'GPT']);
  finishFirst({ status: 'manual_ping_failed', error: 'bottom unavailable' });
  await first;
  expect(order).toEqual(['old', 'GPT', 'Qwen', 'Claude']);
  expect(c.chrome.runtime.sendMessage.mock.calls.map(([m]) => [m.getIt, m.manualLatestRecovery])).toEqual([
    [true, true], [true, true], [true, true]
  ]);
  expect(c.showNotification).toHaveBeenCalledWith('GPT: bottom unavailable');
  expect(c.getItButton.dataset.collecting).toBeUndefined();
});

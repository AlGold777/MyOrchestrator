/** @jest-environment node */
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../content-scripts/content-perplexity'), 'utf8');
const start = source.indexOf("    reportStage('send_action_requested');\n    const domSend");
const end = source.indexOf("    try { chrome.runtime.sendMessage({ type: 'PROMPT_SUBMITTED'", start);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('window', 'reportStage', 'findLivePromptComposer', 'activity',
  'inputField', 'KeyboardEvent', 'confirmPerplexitySend', 'chrome', 'MODEL', 'prompt', source.slice(start, end));

test.each([true, false])('clicked Send with confirmation=%s never falls through to a second send', async confirmed => {
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const clickSend = jest.fn(() => ({ok:true, method:'dom_send_control_click'}));
  const sendMessage = jest.fn();
  const dispatchEvent = jest.fn();
  const report = jest.fn();
  const evidence = jest.fn(async () => confirmed);
  const result = run({PerplexityComposerTransaction:{clickSend}}, report, () => ({}),
    {heartbeat:jest.fn()}, {focus:jest.fn(),dispatchEvent}, class {}, evidence,
    {runtime:{sendMessage}}, 'Perplexity', '8 / 4');
  if (confirmed) await result;
  else await expect(result).rejects.toMatchObject({type:'send_failed'});
  expect(clickSend).toHaveBeenCalledTimes(1);
  expect(evidence).toHaveBeenCalledWith(6000, false);
  expect(dispatchEvent).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
  expect(report.mock.calls.some(([stage]) => stage === 'send_action_completed')).toBe(confirmed);
});

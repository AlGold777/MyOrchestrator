const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const extPath = '/Users/restart/Downloads/LLM_Codex';
  const userDataDir = '/tmp/pw-llm-codex-profile';
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const getExtensionId = async () => {
    const workers = context.serviceWorkers();
    if (workers.length) {
      const url = workers[0].url();
      const match = url.match(/chrome-extension:\/\/(.*?)\//);
      return match ? match[1] : null;
    }
    const worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const url = worker.url();
    const match = url.match(/chrome-extension:\/\/(.*?)\//);
    return match ? match[1] : null;
  };

  const extensionId = await getExtensionId();
  if (!extensionId) {
    console.error('Extension ID not found');
    await context.close();
    process.exit(1);
  }

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#telemetry-tab', { timeout: 15000, state: 'attached' });
  await page.evaluate(() => {
    const tab = document.getElementById('telemetry-tab');
    tab && tab.click();
  });
  await page.waitForFunction(() => {
    const panel = document.getElementById('telemetry-tabpanel');
    return panel && !panel.hasAttribute('hidden');
  }, null, { timeout: 15000 });

  const runSessionId = Date.now();
  const dispatchId = `Grok:${runSessionId}:1`;
  const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

  await page.evaluate(({ runSessionId, dispatchId, baseMeta }) => {
    const send = (event) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'LLM_DIAGNOSTIC_EVENT', llmName: 'Grok', event }, () => resolve());
    });

    const now = Date.now();
    const events = [
      {
        ts: now,
        type: 'TELEMETRY',
        label: 'ROUND1_START',
        details: 'dispatching prompt',
        level: 'error',
        meta: { ...baseMeta, round: 1 }
      },
      {
        ts: now + 200,
        type: 'PIPELINE',
        label: 'PIPELINE_STEP',
        details: '',
        level: 'error',
        meta: { ...baseMeta, step: 'streaming_start' }
      },
      {
        ts: now + 400,
        type: 'TELEMETRY',
        label: 'ROUND1_END',
        details: 'dispatch complete',
        level: 'error',
        meta: { ...baseMeta, round: 1, durationMs: 400 }
      }
    ];

    return events.reduce((p, evt) => p.then(() => send(evt)), Promise.resolve())
      .then(() => {
        if (typeof window.__telemetryRefreshHook === 'function') {
          window.__telemetryRefreshHook();
        }
      });
  }, { runSessionId, dispatchId, baseMeta });

  await page.waitForTimeout(1500);

  const timelineText = await page.locator('#telemetry-timeline').innerText();
  const roundsText = await page.locator('#telemetry-rounds').innerText();

  console.log('--- Telemetry Timeline ---');
  console.log(timelineText.trim());
  console.log('--- Telemetry Rounds ---');
  console.log(roundsText.trim());

  await context.close();
})();

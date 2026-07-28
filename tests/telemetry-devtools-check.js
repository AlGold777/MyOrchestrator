const { chromium } = require('playwright');

(async () => {
  const extPath = process.env.EXT_PATH || '/Users/restart/Downloads/LLM_Codex';
  const userDataDir = process.env.PW_USER_DATA || '/tmp/pw-llm-codex-profile';
  const headless = process.env.HEADLESS === '1';

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
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
    const worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
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

  await page.waitForSelector('#telemetry-tab', { timeout: 20000, state: 'attached' });
  await page.evaluate(() => {
    const tab = document.getElementById('telemetry-tab');
    tab && tab.click();
  });

  await page.waitForFunction(() => {
    const panel = document.getElementById('telemetry-tabpanel');
    return panel && !panel.hasAttribute('hidden');
  }, null, { timeout: 20000 });

  await page.evaluate(() => {
    const grokBtn = document.getElementById('llm-grok');
    if (grokBtn && !grokBtn.classList.contains('active')) {
      grokBtn.click();
    }
  });

  await page.waitForTimeout(300);

  const runSessionId = Date.now();
  const dispatchId = `Grok:${runSessionId}:1`;
  const baseMeta = { runSessionId, dispatchId, llmName: 'Grok' };

  await page.evaluate(async ({ baseMeta }) => {
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
        ts: now + 120,
        type: 'TELEMETRY',
        label: 'ROUND2_START',
        details: 'verifying prompt',
        level: 'error',
        meta: { ...baseMeta, round: 2 }
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
      },
      {
        ts: now + 520,
        type: 'TELEMETRY',
        label: 'ROUND2_END',
        details: 'verification complete',
        level: 'error',
        meta: { ...baseMeta, round: 2, durationMs: 400 }
      }
    ];

    for (const evt of events) {
      await send(evt);
    }

    if (typeof window.__telemetryRefreshHook === 'function') {
      window.__telemetryRefreshHook();
    }
  }, { baseMeta });

  await page.waitForTimeout(1500);

  const timelineText = await page.locator('#telemetry-timeline').innerText();
  const roundsText = await page.locator('#telemetry-rounds').innerText();

  const timelineOk = timelineText.includes('ROUND1_START')
    && timelineText.includes('PIPELINE_STEP')
    && timelineText.includes('ROUND1_END')
    && timelineText.includes('ROUND2_START')
    && timelineText.includes('ROUND2_END');
  const roundsOk = roundsText.includes('Grok') && roundsText.includes('done') && roundsText.includes('R2');

  if (!timelineOk || !roundsOk) {
    console.error('Telemetry DevTools check failed');
    console.error('Timeline:', timelineText.trim());
    console.error('Rounds:', roundsText.trim());
    await context.close();
    process.exit(1);
  }

  console.log('Telemetry DevTools check passed');
  await context.close();
})();

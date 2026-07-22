const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const extPath = process.env.EXT_PATH || repoRoot;
const userDataDir = process.env.PW_USER_DATA || path.join(os.tmpdir(), 'pw-llm-codex-qwen-profile');
const headless = process.env.HEADLESS === '1';
const prompt = process.env.QWEN_PROMPT || [
  'Explain in two short paragraphs why selector fallbacks are necessary in browser automation.',
  'Include one concrete example of how a DOM change can hide an answer from a narrow selector.'
].join(' ');
const timeoutMs = Number(process.env.QWEN_TIMEOUT_MS || 240000);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getExtensionId(context) {
  const fromWorkers = () => {
    const workers = context.serviceWorkers();
    for (const worker of workers) {
      const match = String(worker.url() || '').match(/chrome-extension:\/\/([^/]+)\//);
      if (match) return match[1];
    }
    return null;
  };

  const existing = fromWorkers();
  if (existing) return existing;

  const worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const match = String(worker.url() || '').match(/chrome-extension:\/\/([^/]+)\//);
  return match ? match[1] : null;
}

async function sendRuntimeMessage(page, message) {
  return page.evaluate((payload) => {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(response || null);
        });
      } catch (err) {
        reject(err);
      }
    });
  }, message);
}

async function waitForOutputChange(page, baselineText, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const output = document.getElementById('output-qwen');
      if (!output) return { exists: false, text: '', html: '' };
      return {
        exists: true,
        text: String(output.innerText || output.textContent || '').trim(),
        html: String(output.innerHTML || '').trim()
      };
    });
    if (
      snapshot.exists &&
      snapshot.text &&
      snapshot.text !== baselineText &&
      !snapshot.text.startsWith('Error:')
    ) {
      return snapshot;
    }
    await wait(1000);
  }
  throw new Error('Timed out waiting for Qwen output panel to change');
}

async function waitForQwenAnswer(page, timeout) {
  const selectorCandidates = [
    '[data-testid="chat-response"]',
    '[data-testid*="message"]',
    '[data-message-type="assistant"]',
    '[data-role*="assistant"]',
    '[data-testid*="assistant"]',
    'article[data-role*="assistant"]',
    'section[data-role*="assistant"]',
    'main [role="article"]',
    'main article',
    'main [class*="message" i]',
    'div[class*="assistant-message"]',
    'div[class*="assistantMessage"]',
    '[class*="response"]',
    '[class*="reply"]',
    '.prose',
    'div[class*="markdown"]',
    '[class*="markdown-body"]'
  ];
  const selector = selectorCandidates.join(', ');
  await page.waitForFunction(
    (sel) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.some((node) => {
        const text = String(node.innerText || node.textContent || '').trim();
        return text.length > 0;
      });
    },
    selector,
    { timeout }
  );
}

async function getQwenPage(context, timeout) {
  const existing = context.pages().find((page) => page.url().includes('chat.qwen.ai'));
  if (existing) return existing;
  return context.waitForEvent('page', {
    timeout,
    predicate: (page) => page.url().includes('chat.qwen.ai')
  }).catch(() => null);
}

async function main() {
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  try {
    const extensionId = await getExtensionId(context);
    if (!extensionId) {
      throw new Error('Extension ID not found');
    }

    const resultsPage = await context.newPage();
    await resultsPage.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });
    await resultsPage.waitForSelector('#prompt-input', { timeout: 30000, state: 'visible' });
    await resultsPage.waitForSelector('#llm-qwen', { timeout: 30000, state: 'visible' });

    await resultsPage.evaluate((nextPrompt) => {
      const input = document.getElementById('prompt-input');
      if (!input) throw new Error('prompt-input not found');
      input.value = nextPrompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, prompt);

    const baselineOutput = await resultsPage.locator('#output-qwen').innerText().catch(() => '');
    await resultsPage.locator('[data-target="output-qwen"].panel-clear-response-btn').click({ timeout: 5000 }).catch(() => {});
    await resultsPage.waitForFunction(() => {
      const output = document.getElementById('output-qwen');
      return output && !String(output.innerText || output.textContent || '').trim();
    }, null, { timeout: 10000 }).catch(() => {});

    await sendRuntimeMessage(resultsPage, {
      type: 'START_FULLPAGE_PROCESS',
      prompt,
      selectedLLMs: ['Qwen'],
      forceNewTabs: true,
      useApiFallback: true
    });

    const qwenPage = await getQwenPage(context, 60000);
    if (qwenPage) {
      await qwenPage.waitForLoadState('domcontentloaded').catch(() => {});
      await qwenPage.waitForTimeout(2000);
      await waitForQwenAnswer(qwenPage, timeoutMs / 2).catch(() => {});
    } else {
      console.warn('[qwen-playwright] no visible qwen page detected; continuing with results panel check');
    }

    const output = await waitForOutputChange(resultsPage, baselineOutput, timeoutMs);
    console.log('[qwen-playwright] output length:', output.text.length);
    console.log('[qwen-playwright] output preview:', output.text.slice(0, 200));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('[qwen-playwright] failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

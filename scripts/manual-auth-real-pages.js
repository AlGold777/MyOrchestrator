#!/usr/bin/env node
// Open real model pages in a persistent browser profile for manual login and smoke checks.

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const extPath = process.env.EXT_PATH || repoRoot;
const userDataDir = process.env.PW_USER_DATA || path.join(repoRoot, '.playwright-auth-profile');
const artifactsDir = process.env.ARTIFACTS_DIR || path.join(repoRoot, 'artifacts');
const authWaitMs = Number(process.env.AUTH_WAIT_MS || 10 * 60 * 1000);
const outputWaitMs = Number(process.env.OUTPUT_WAIT_MS || 4 * 60 * 1000);
const pollMs = Number(process.env.POLL_MS || 2000);
const headless = process.env.HEADLESS === '1';
const startRun = process.env.START_RUN === '1';
const keepOpen = process.env.KEEP_OPEN !== '0';
const prompt = process.env.PROMPT || 'Reply with exactly one short sentence: manual auth smoke test ready.';

const MODEL_TARGETS = {
  GPT: 'https://chatgpt.com/',
  Claude: 'https://claude.ai/new',
  Gemini: 'https://gemini.google.com/app',
  Grok: 'https://grok.com/',
  Qwen: 'https://chat.qwen.ai/',
  DeepSeek: 'https://chat.deepseek.com/',
  Perplexity: 'https://www.perplexity.ai/',
  'Le Chat': 'https://chat.mistral.ai/chat',
  'Z.ai': 'https://chat.z.ai/',
  'Kimi': 'https://www.kimi.ai/'
};

const MODEL_BUTTON_IDS = {
  GPT: 'llm-gpt',
  Claude: 'llm-claude',
  Gemini: 'llm-gemini',
  Grok: 'llm-grok',
  Qwen: 'llm-qwen',
  DeepSeek: 'llm-deepseek',
  Perplexity: 'llm-perplexity',
  'Le Chat': 'llm-lechat',
  'Z.ai': 'llm-zai',
  'Kimi': 'llm-kimi'
};

const MODEL_OUTPUT_IDS = {
  GPT: 'output-gpt',
  Claude: 'output-claude',
  Gemini: 'output-gemini',
  Grok: 'output-grok',
  Qwen: 'output-qwen',
  DeepSeek: 'output-deepseek',
  Perplexity: 'output-perplexity',
  'Le Chat': 'output-lechat',
  'Z.ai': 'output-zai',
  'Kimi': 'output-kimi'
};

const COMPOSER_SELECTOR = [
  'textarea',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[aria-multiline="true"]',
  'input[type="text"]',
  'input[type="search"]'
].join(', ');

const AUTH_TEXT_RE = /sign in|log in|login|continue with google|captcha|verify you are human|войдите|войти|авториз|iniciar sesión|connexion/i;

function parseModels() {
  const raw = process.env.MODELS || 'GPT,Claude,Gemini,Qwen';
  return raw.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((name) => MODEL_TARGETS[name]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return String(rawUrl || '').split(/[?#]/)[0];
  }
}

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
  const worker = await context.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
  const match = String(worker?.url() || '').match(/chrome-extension:\/\/([^/]+)\//);
  return match ? match[1] : null;
}

async function inspectPage(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  return page.evaluate(({ selector, authPatternSource }) => {
    const authRe = new RegExp(authPatternSource, 'i');
    const candidates = Array.from(document.querySelectorAll(selector));
    const composer = candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const editable = node.isContentEditable
        || node.tagName === 'TEXTAREA'
        || node.getAttribute('role') === 'textbox'
        || node.getAttribute('aria-multiline') === 'true';
      return editable
        && rect.width > 20
        && rect.height > 10
        && style.visibility !== 'hidden'
        && style.display !== 'none';
    });
    const bodyText = String(document.body?.innerText || document.body?.textContent || '').slice(0, 5000);
    const blockers = [];
    const authUrl = /(^|\.)accounts\.google\.com$/i.test(location.hostname)
      || /\/(auth|login|signin|rejected)(\/|$)/i.test(location.pathname);
    if (authUrl || (!composer && authRe.test(bodyText))) blockers.push('auth_required_or_challenge');
    return {
      title: document.title || '',
      url: `${location.origin}${location.pathname}`,
      composerReady: !!composer,
      composerTag: composer ? composer.tagName.toLowerCase() : null,
      composerRole: composer ? composer.getAttribute('role') : null,
      blockers,
      bodyTextLength: bodyText.length
    };
  }, { selector: COMPOSER_SELECTOR, authPatternSource: AUTH_TEXT_RE.source }).catch((err) => ({
    title: '',
    url: sanitizeUrl(page.url()),
    composerReady: false,
    composerTag: null,
    composerRole: null,
    blockers: ['inspect_failed'],
    error: err.message
  }));
}

async function waitForComposer(page, modelName, deadline) {
  let last = null;
  while (Date.now() < deadline) {
    last = await inspectPage(page);
    if (last.composerReady && !last.blockers.length) return last;
    console.log(`[manual-auth] ${modelName}: waiting for login/composer`, JSON.stringify({
      composerReady: last.composerReady,
      blockers: last.blockers,
      url: last.url
    }));
    await wait(pollMs);
  }
  return last || await inspectPage(page);
}

async function waitForAllComposers(pages, models, deadline) {
  const report = {};
  const ready = new Set();
  while (Date.now() < deadline && ready.size < models.length) {
    for (const model of models) {
      if (ready.has(model)) continue;
      const snapshot = await inspectPage(pages[model]);
      report[model] = snapshot;
      if (snapshot.composerReady && !snapshot.blockers.length) {
        ready.add(model);
      console.log(`[manual-auth] ${model}: ready`, JSON.stringify({
          composerTag: snapshot.composerTag,
          composerRole: snapshot.composerRole,
          url: sanitizeUrl(snapshot.url)
        }));
        continue;
      }
      console.log(`[manual-auth] ${model}: waiting for login/composer`, JSON.stringify({
        composerReady: snapshot.composerReady,
        blockers: snapshot.blockers,
        error: snapshot.error || null,
        url: sanitizeUrl(snapshot.url)
      }));
    }
    if (ready.size < models.length) await wait(pollMs);
  }
  return report;
}

async function sendRuntimeMessage(page, message) {
  return page.evaluate((payload) => new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response || null);
      });
    } catch (err) {
      reject(err);
    }
  }), message);
}

async function runExtensionPrompt(context, extensionId, models) {
  const resultsPage = await context.newPage();
  await resultsPage.goto(`chrome-extension://${extensionId}/result_new.html`, { waitUntil: 'domcontentloaded' });
  await resultsPage.waitForSelector('#prompt-input', { timeout: 30000, state: 'visible' });
  await resultsPage.waitForSelector('#start-button', { timeout: 30000, state: 'visible' });
  await sendRuntimeMessage(resultsPage, { type: 'STOP_ALL', platforms: models }).catch((err) => {
    console.warn('[manual-auth] preflight STOP_ALL failed:', err?.message || String(err));
  });
  await resultsPage.waitForTimeout(500);
  await resultsPage.evaluate(({ nextPrompt, selectedModels, buttonIds }) => {
    const input = document.getElementById('prompt-input');
    if (!input) throw new Error('prompt-input not found');
    input.value = nextPrompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    Object.values(buttonIds).forEach((id) => {
      const button = document.getElementById(id);
      if (button?.classList.contains('active')) button.click();
    });
    selectedModels.forEach((name) => {
      const button = document.getElementById(buttonIds[name]);
      if (button && !button.classList.contains('active')) button.click();
    });
    const newPages = document.getElementById('new-pages-checkbox');
    if (newPages) {
      newPages.checked = false;
      newPages.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const apiMode = document.getElementById('api-mode-checkbox');
    if (apiMode) {
      apiMode.checked = true;
      apiMode.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { nextPrompt: prompt, selectedModels: models, buttonIds: MODEL_BUTTON_IDS });
  await resultsPage.locator('#start-button').click({ timeout: 10000 });
  const deadline = Date.now() + outputWaitMs;
  const outputs = {};
  while (Date.now() < deadline) {
    const snapshot = await resultsPage.evaluate(({ names, outputIds }) => {
      const result = {};
      names.forEach((name) => {
        const output = document.getElementById(outputIds[name]);
        result[name] = String(output?.innerText || output?.textContent || '').trim();
      });
      return result;
    }, { names: models, outputIds: MODEL_OUTPUT_IDS });
    Object.assign(outputs, snapshot);
    const complete = models.every((name) => outputs[name] && !outputs[name].startsWith('Error:'));
    if (complete) return { ok: true, outputs };
    await wait(pollMs);
  }
  let diagnostics = [];
  try {
    const response = await sendRuntimeMessage(resultsPage, {
      type: 'GET_DIAG_EVENTS',
      platforms: models,
      limit: 120
    });
    diagnostics = Array.isArray(response?.events) ? response.events : [];
  } catch (err) {
    diagnostics = [{ platform: 'manual-auth', label: 'GET_DIAG_EVENTS failed', details: err?.message || String(err), level: 'warning' }];
  }
  return { ok: false, outputs, diagnostics };
}

async function main() {
  const models = parseModels();
  if (!models.length) throw new Error('No supported MODELS selected');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });

  console.log('[manual-auth] profile:', userDataDir);
  console.log('[manual-auth] models:', models.join(', '));
  console.log('[manual-auth] password/2FA must be entered manually in the opened browser');

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  const report = {
    ts: new Date().toISOString(),
    userDataDir,
    models: {},
    extensionId: null,
    run: null
  };

  try {
    report.extensionId = await getExtensionId(context);
    if (!report.extensionId) throw new Error('Extension ID not found');

    const pages = {};
    for (const model of models) {
      const page = await context.newPage();
      pages[model] = page;
      await page.goto(MODEL_TARGETS[model], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    const deadline = Date.now() + authWaitMs;
    report.models = await waitForAllComposers(pages, models, deadline);
    models.forEach((model) => {
      console.log(`[manual-auth] ${model}:`, JSON.stringify(report.models[model] || null));
    });

    if (startRun) {
      report.run = await runExtensionPrompt(context, report.extensionId, models);
      console.log('[manual-auth] run:', JSON.stringify({
        ok: report.run.ok,
        outputLengths: Object.fromEntries(Object.entries(report.run.outputs || {}).map(([k, v]) => [k, String(v || '').length])),
        diagnosticCount: Array.isArray(report.run.diagnostics) ? report.run.diagnostics.length : 0
      }));
      (report.run.diagnostics || []).slice(-20).forEach((event) => {
        console.log('[manual-auth][diag]', JSON.stringify({
          platform: event.platform || event.llmName || null,
          label: event.label || event.event || event.type || null,
          level: event.level || null,
          details: event.details || null
        }));
      });
    }

    const reportPath = path.join(artifactsDir, 'manual-auth-smoke-report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log('[manual-auth] report:', reportPath);

    if (keepOpen) {
      console.log('[manual-auth] browser remains open. Press Ctrl+C here when finished.');
      await new Promise(() => {});
    }
  } finally {
    if (!keepOpen) await context.close();
  }
}

main().catch((err) => {
  console.error('[manual-auth] failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

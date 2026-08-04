require('../shared/secret-redaction');
const B1SkeletonCollector = require('../background/b1-skeleton-collector');
const fs = require('fs');
const path = require('path');

const safeCapture = (platform, overrides = {}) => ({
  ok: true,
  schemaVersion: 1,
  capturedAt: '2026-07-26T12:00:00.000Z',
  platform,
  resolution: 'exact',
  reason: 'platform_answer_and_root_matched',
  textPolicy: 'length_placeholders_only',
  attributePolicy: 'structural_allowlist_and_secret_redaction',
  privacyValidated: true,
  structuralComplete: true,
  structuralIssues: [],
  rawTextLength: 120,
  linearizedTextLength: 100,
  selectedAnswerLength: 100,
  ignoredTextDelta: 20,
  ignoredTextRatio: 0.1667,
  ignoredContentRisk: false,
  html: '<article data-testid="assistant-response"><p>⟦TEXT:100⟧</p></article>',
  ...overrides
});

const chromeMock = () => {
  const platformByTab = new Map();
  let nextTabId = 1;
  return {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: '2.81.91' })
    },
    scripting: {
      executeScript: jest.fn((_details, callback) => callback())
    },
    tabs: {
      query: jest.fn((query, callback) => {
        const firstPattern = Array.isArray(query.url) ? query.url[0] : query.url;
        const target = B1SkeletonCollector.TARGETS.find((entry) => entry.patterns.includes(firstPattern));
        const id = nextTabId++;
        platformByTab.set(id, target.platform);
        callback([{ id }]);
      }),
      sendMessage: jest.fn((tabId, _message, callback) => callback(safeCapture(platformByTab.get(tabId))))
    }
  };
};

describe('B1 sanitized live-skeleton collector', () => {
  test('production background loads the collector and authorizes only extension result pages', () => {
    const root = path.join(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'background', 'index.js'), 'utf8');
    const router = fs.readFileSync(path.join(root, 'background', 'message-router.js'), 'utf8');
    expect(index).toContain("'b1-skeleton-collector.js'");
    expect(index.indexOf("'b1-skeleton-collector.js'")).toBeLessThan(index.indexOf("'message-router.js'"));
    expect(router).toContain("case 'CAPTURE_B1_SANITIZED_SKELETONS'");
    expect(router).toContain("chrome.runtime.getURL('result_new.html')");
    expect(router).toContain("chrome.runtime.getURL('pipeline_panel.html')");
    expect(router).toContain("sender?.id !== chrome.runtime.id");
  });

  test('collects exactly one privacy-safe exact fixture for every supported platform', async () => {
    const chromeApi = chromeMock();
    const result = await B1SkeletonCollector.collectAll({ chromeApi });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      expectedCount: 10,
      capturedCount: 10,
      exactCount: 10,
      complete: true,
      exactOnAllPlatforms: true
    }));
    expect(result.results.map((entry) => entry.platform)).toEqual([
      'chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'qwen', 'deepseek', 'lechat', 'zai', 'kimi'
    ]);
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledTimes(10);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(10);
  });

  test('rejects a capture if conversation text survives the page privacy gate', () => {
    const capture = safeCapture('chatgpt', { html: '<article>private answer</article>' });
    expect(B1SkeletonCollector.validateCapture(capture, 'chatgpt')).toEqual({
      ok: false,
      error: 'raw_text_detected'
    });
  });

  test('accepts adjacent independently sanitized text-node placeholders', () => {
    const capture = safeCapture('chatgpt', {
      html: '<article><span>⟦TEXT:4⟧⟦TEXT:8⟧</span></article>'
    });
    expect(B1SkeletonCollector.validateCapture(capture, 'chatgpt')).toEqual({ ok: true });
  });

  test('accepts allowlisted DeepSeek structural classes after independent background validation', () => {
    const capture = safeCapture('deepseek', {
      html: '<div class="ds-message-assistant"><div class="ds-markdown">⟦TEXT:42⟧</div></div>'
    });
    expect(B1SkeletonCollector.validateCapture(capture, 'deepseek')).toEqual({ ok: true });
  });

  test('still rejects arbitrary key-shaped ds values in sanitized HTML', () => {
    const capture = safeCapture('deepseek', {
      html: '<div class="ds-abcdefghijklmnopqrstuvwxyz123456">⟦TEXT:42⟧</div>'
    });
    expect(B1SkeletonCollector.validateCapture(capture, 'deepseek')).toEqual({
      ok: false,
      error: 'secret_redaction_changed_capture'
    });
  });

  test('rejects platform substitution and secret-shaped retained attributes', () => {
    expect(B1SkeletonCollector.validateCapture(safeCapture('claude'), 'chatgpt').ok).toBe(false);
    const secret = safeCapture('chatgpt', {
      html: '<article class="Bearer abcdefghijklmnopqrstuvwxyz"><p>⟦TEXT:2⟧</p></article>'
    });
    expect(B1SkeletonCollector.validateCapture(secret, 'chatgpt')).toEqual({
      ok: false,
      error: 'sensitive_shape_detected'
    });
  });
});

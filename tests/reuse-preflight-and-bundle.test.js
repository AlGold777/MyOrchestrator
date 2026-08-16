// Phase C of the global review:
//  - unsafe global reuse (New pages = off) must not hijack a user's working
//    chat: a draft in the composer or an active generation skips that tab;
//  - the legacy platform-selectors.js claimed window.AnswerPipelineSelectors
//    with an incompatible contract ('gpt' vs 'chatgpt') and was silently
//    bundled INSTEAD of the real selector contract by scripts/build-bundles.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ORCHESTRATOR_SOURCE = read('background', 'job-orchestrator.js');

describe('unsafe global reuse preflight', () => {
  test('tab-manager probes the page surface before taking over an unbound tab', () => {
    const src = read('background', 'tab-manager.js');
    expect(src).toContain("async function probeReusableTabSurface(tabId, llmName = '')");
    expect(src).toContain('args: [llmName]');
    expect(src).toContain("const composerSelectors = modelName === 'Grok'");
    expect(src).toContain(".some((el) => isVisible(el)");
    expect(src).toContain("return { ok: false, reason: 'composer_has_draft', probe };");
    expect(src).toContain("return { ok: false, reason: 'generation_active', probe };");
    expect(src).toContain("'UNSAFE_REUSE_SKIPPED'");
    expect(src).toContain("details: 'unsafe_reuse_preflight'");
    // Run-bound tabs and disabled global reuse keep the fast path.
    expect(src).toContain('if (!allowGlobalReuse || isRunBound) {');
    // An inconclusive probe is fail-closed: a user tab is never hijacked on uncertainty.
    expect(src).toContain("return { ok: false, reason: 'probe_failed'");
    expect(src).toContain("return { ok: false, reason: 'modal_visible', probe }");
    expect(src).toContain('probeReusableTabSurface(tabOption.id, llmName)');
    expect(src).toContain('for (const tabOption of eligibleTabs)');
  });

  test('Round 0 awaits the complete tab-acquisition transaction', () => {
    expect(ORCHESTRATOR_SOURCE).toContain('async function runModelThroughTabs');
    expect(ORCHESTRATOR_SOURCE).toContain('await runModelThroughTabs(llmName, prompt, forceNewTabs');
    expect(ORCHESTRATOR_SOURCE).toContain("'TAB_ISOLATION_FALLBACK_CREATE'");
    expect(ORCHESTRATOR_SOURCE).toContain('await setTabBinding(llmName, null);');
    expect(ORCHESTRATOR_SOURCE).not.toContain('reuseMappedTabOrCreate');
  });

  test('donor sticky mapped-tab reuse is limited to Le Chat and Perplexity', () => {
    expect(ORCHESTRATOR_SOURCE).toContain("const DONOR_STICKY_REUSE_MODELS = new Set(['Le Chat', 'Perplexity'])");
    expect(ORCHESTRATOR_SOURCE).toContain('await reuseMappedDonorProviderTab(llmName, prompt, attachments, options)');
    expect(ORCHESTRATOR_SOURCE).toContain("reason: 'donor_sticky_reuse'");
    expect(ORCHESTRATOR_SOURCE).toContain("'DONOR_STICKY_TAB_REUSED'");
    const stickyAt = ORCHESTRATOR_SOURCE.indexOf('await reuseMappedDonorProviderTab(llmName, prompt, attachments, options)');
    const genericAt = ORCHESTRATOR_SOURCE.indexOf('await tryAttachExistingTab(llmName, prompt, attachments', stickyAt);
    expect(stickyAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(stickyAt);
  });

  test('sticky reuse recovers the newest matching provider tab when mapping was cleared', async () => {
    const start = ORCHESTRATOR_SOURCE.indexOf("const DONOR_STICKY_REUSE_MODELS = new Set");
    const end = ORCHESTRATOR_SOURCE.indexOf('\nasync function runModelThroughTabs', start);
    const runtime = ORCHESTRATOR_SOURCE.slice(start, end);
    const calls = [];
    const sandbox = {
      Set,
      Promise,
      TabMapManager: { get: () => null },
      findReusableTabsForLlm: async () => [{ id: 42, url: 'https://www.perplexity.ai/search/old' }],
      isValidTabId: (id) => Number.isInteger(id) && id > 0,
      isSessionActive: () => true,
      chrome: {
        runtime: { lastError: null },
        tabs: { get: (id, callback) => callback({ id, url: 'https://www.perplexity.ai/search/old' }) }
      },
      ensureTabReadyForDispatch: async () => ({ ok: true, tab: { url: 'https://www.perplexity.ai/search/old' } }),
      prepareTabForUse: async (id) => calls.push(['prepare', id]),
      initRequestMetadata: (...args) => calls.push(['metadata', ...args]),
      setTabBinding: async (...args) => calls.push(['bind', ...args]),
      emitTelemetry: (...args) => calls.push(['telemetry', ...args]),
      dispatchPromptToTab: (...args) => calls.push(['dispatch', ...args]),
      LLM_TARGETS: { Perplexity: { url: 'https://www.perplexity.ai/' } }
    };
    vm.createContext(sandbox);
    vm.runInContext(`${runtime}\n;globalThis.reuse = reuseMappedDonorProviderTab;`, sandbox);
    await expect(sandbox.reuse('Perplexity', 'prompt', [], {})).resolves.toBe(true);
    expect(calls).toContainEqual(['bind', 'Perplexity', 42]);
    expect(calls.some((call) => call[0] === 'dispatch' && call[2] === 42)).toBe(true);
  });
});

describe('legacy selector bundle removal', () => {
  test('platform-selectors.js is out of content-scripts and out of the manifest', () => {
    expect(fs.existsSync(path.join(__dirname, '..', 'content-scripts', 'platform-selectors.js'))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '..', 'legacy', 'platform-selectors.js'))).toBe(true);
    expect(read('manifest.json')).not.toContain('platform-selectors');
  });

  test('the bundler ships the real selector contract, not the legacy one', () => {
    const bundler = read('scripts', 'build-bundles.js');
    expect(bundler).toContain("'content-scripts/answer-pipeline-selectors.js'");
    expect(bundler).not.toContain("'content-scripts/platform-selectors.js'");
  });

  test('the two-script distribution includes the Completion authority runtime', () => {
    const bundler = read('scripts', 'build-bundles.js');
    expect(bundler).toContain("'shared/completion-protocol.js'");
    expect(bundler).toContain("'content-utils/response-lifecycle-detector.js'");
    expect(bundler).toContain("'content-scripts/content-bootstrap.js'");
    expect(bundler).toContain("'content-scripts/content-utils.js'");
  });
});

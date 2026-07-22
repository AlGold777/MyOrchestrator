// Phase C of the global review:
//  - unsafe global reuse (New pages = off) must not hijack a user's working
//    chat: a draft in the composer or an active generation skips that tab;
//  - the legacy platform-selectors.js claimed window.AnswerPipelineSelectors
//    with an incompatible contract ('gpt' vs 'chatgpt') and was silently
//    bundled INSTEAD of the real selector contract by scripts/build-bundles.js.
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

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
});

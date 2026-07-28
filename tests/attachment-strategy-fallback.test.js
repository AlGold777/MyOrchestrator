const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'content-scripts', 'attachment-handler.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// 2.81.116 field regression. The `debugger` permission was removed in 2.81.112,
// but four providers (Gemini, Perplexity, Qwen, Z.ai) still declared a CDP-only
// attachment strategy list. chrome.debugger was undefined, the CDP request failed
// with "Cannot read properties of undefined (reading 'attach')", and because no
// other strategy existed the whole dispatch ended as
// USER_ACTION_REQUIRED:attachment_failed — the prompt itself was never inserted.
// Six of nine providers were unusable. These assertions make the same shape of
// regression impossible to reintroduce silently.
describe('attachment strategy fallback contract', () => {
  const CDP_STRATEGIES = ['cdp-file-input', 'qwen-cdp-file-input', 'provider-cdp-file-input'];

  const strategyLists = () => {
    const lists = [];
    const re = /strategies: \[([^\]]*)\]/g;
    let match = re.exec(HANDLER_SRC);
    while (match) {
      lists.push({
        raw: match[1],
        entries: match[1].split(',').map((item) => item.trim().replace(/^'|'$/g, '')).filter(Boolean)
      });
      match = re.exec(HANDLER_SRC);
    }
    return lists;
  };

  test('every provider declares at least one strategy', () => {
    const lists = strategyLists();
    expect(lists.length).toBeGreaterThan(0);
    lists.forEach(({ entries }) => expect(entries.length).toBeGreaterThan(0));
  });

  test('no provider relies on a CDP strategy alone', () => {
    const offenders = strategyLists()
      .filter(({ entries }) => entries.every((entry) => CDP_STRATEGIES.includes(entry)))
      .map(({ raw }) => raw);
    expect(offenders).toEqual([]);
  });

  test('every CDP strategy is followed by a non-CDP fallback', () => {
    strategyLists().forEach(({ entries, raw }) => {
      if (!entries.some((entry) => CDP_STRATEGIES.includes(entry))) return;
      const fallbacks = entries.filter((entry) => !CDP_STRATEGIES.includes(entry));
      expect(fallbacks.length).toBeGreaterThan(0);
      // The fallback must come after the CDP attempt, never replace it silently.
      const firstFallbackAt = entries.findIndex((entry) => !CDP_STRATEGIES.includes(entry));
      const firstCdpAt = entries.findIndex((entry) => CDP_STRATEGIES.includes(entry));
      expect(firstFallbackAt).toBeGreaterThan(firstCdpAt);
      expect(raw).toBeTruthy();
    });
  });

  test('a strategy that throws does not abort the remaining strategies', () => {
    const tryViaAt = HANDLER_SRC.indexOf('const tryVia = async');
    expect(tryViaAt).toBeGreaterThan(-1);
    const tryVia = HANDLER_SRC.slice(tryViaAt, HANDLER_SRC.indexOf('\n    };', tryViaAt));
    // The dispatch call must be guarded, otherwise a missing browser API surfaces
    // as an uncaught TypeError and kills the whole attachment chain.
    expect(tryVia).toContain('try {');
    expect(tryVia).toContain('dispatchResult = await dispatchFn()');
    expect(tryVia).toContain('catch');
    expect(tryVia).toContain('dispatch_threw');
  });

  test('CDP strategies are only declared while the debugger permission is absent-safe', () => {
    // The manifest deliberately has no `debugger` permission since 2.81.112.
    // Keeping the CDP entries is allowed, but only because they now degrade to a
    // failed strategy rather than an aborted dispatch.
    const permissions = [...(MANIFEST.permissions || []), ...(MANIFEST.optional_permissions || [])];
    expect(permissions).not.toContain('debugger');
  });
});

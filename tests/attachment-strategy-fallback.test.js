const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'content-scripts', 'attachment-handler.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// CDP attachment routes remain disabled even though the debugger permission is
// required by the narrowly scoped Le Chat/Perplexity submission transactions.
// Every attachment strategy must therefore retain a non-CDP fallback.
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

  test('debugger permission does not enable CDP attachment routes', () => {
    const permissions = [...(MANIFEST.permissions || []), ...(MANIFEST.optional_permissions || [])];
    const router = fs.readFileSync(path.join(ROOT, 'background', 'message-router.js'), 'utf8');
    expect(permissions).toContain('debugger');
    expect(router).toContain("'GEMINI_CDP_ATTACH_REQUEST',");
    expect(router).toContain("'QWEN_CDP_ATTACH_REQUEST',");
    expect(router).toContain("'PROVIDER_CDP_ATTACH_REQUEST'");
    expect(router).toContain("reason: 'debugger_route_disabled'");
  });
});

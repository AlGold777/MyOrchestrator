const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HANDLER_SRC = fs.readFileSync(path.join(ROOT, 'content-scripts', 'attachment-handler.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// Browser-level debugging is permanently disabled. Every attachment strategy
// must therefore be a page/input/drop/paste strategy.
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

  test('no attachment strategy uses CDP', () => {
    strategyLists().forEach(({ entries, raw }) => {
      expect(entries.filter((entry) => CDP_STRATEGIES.includes(entry))).toEqual([]);
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

  test('debugger permission and attachment routes are absent', () => {
    const permissions = [...(MANIFEST.permissions || []), ...(MANIFEST.optional_permissions || [])];
    const router = fs.readFileSync(path.join(ROOT, 'background', 'message-router.js'), 'utf8');
    expect(permissions).not.toContain('debugger');
    expect(router).toContain('const BROWSER_DEBUGGING_DISABLED = true;');
    expect(router).toContain("reject(new Error('browser_debugging_disabled'))");
  });
});

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// The extension ships NO build step for content scripts: the manifest injects
// the raw files in order and they share one isolated-world global scope per page
// (a deliberate choice — see README, dist/ gitignore note). That makes the load
// ORDER an implicit contract (global-code-review-2026-06-18.md F-A): a file that
// declares a top-level `const`/`let`/`class` already used by another file loaded
// on the same page would either be a SyntaxError under bundling or a silent
// global clobber today. This test makes that contract explicit and guards it.

// Heuristic top-level declaration scan: these files wrap internals in IIFEs, so
// real top-level (module-program) declarations sit at column 0. That is exactly
// the set that shares/clobbers across concatenated or co-injected scripts.
const topLevelDeclarations = (relFile) => {
  const abs = path.join(ROOT, relFile);
  const src = fs.readFileSync(abs, 'utf8');
  const names = [];
  for (const line of src.split('\n')) {
    const m = line.match(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/);
    if (m) names.push(m[1]);
  }
  return names;
};

const contentBlocks = manifest.content_scripts || [];
// Block 0 matches every provider; each later block targets one provider. The
// set actually co-injected on a provider page is block0 ∪ that block.
const baseBlock = contentBlocks[0];

describe('content-script load-order contract', () => {
  test('manifest declares at least the shared block plus per-provider blocks', () => {
    expect(contentBlocks.length).toBeGreaterThan(1);
    expect(Array.isArray(baseBlock.js)).toBe(true);
    expect(baseBlock.js.length).toBeGreaterThan(0);
  });

  test('every content-script file referenced by the manifest exists', () => {
    const missing = [];
    for (const block of contentBlocks) {
      for (const rel of block.js || []) {
        if (!fs.existsSync(path.join(ROOT, rel))) missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  test('no top-level const/let/class collisions within any co-injected page set', () => {
    // For each provider page: shared block + that provider's block.
    const offenders = [];
    for (let i = 1; i < contentBlocks.length; i++) {
      const loaded = [...baseBlock.js, ...(contentBlocks[i].js || [])];
      const owners = new Map();
      for (const rel of loaded) {
        for (const name of topLevelDeclarations(rel)) {
          if (!owners.has(name)) owners.set(name, new Set());
          owners.get(name).add(path.basename(rel));
        }
      }
      for (const [name, set] of owners) {
        if (set.size > 1) {
          offenders.push(`page#${i} ${name} <- ${[...set].join(', ')}`);
        }
      }
    }
    // A failure here means two co-injected files own the same top-level binding:
    // a silent global clobber today and a hard blocker for any future bundling.
    expect(offenders).toEqual([]);
  });
});

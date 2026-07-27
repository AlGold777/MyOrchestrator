const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRODUCTION_ROOTS = ['background', 'content-scripts', 'shared'];

function javascriptFiles(directory) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  });
  return files;
}

describe('verification provenance guard', () => {
  test('production code never fabricates verified with a true literal', () => {
    const offenders = PRODUCTION_ROOTS
      .flatMap((directory) => javascriptFiles(path.join(ROOT, directory)))
      .filter((file) => /\bverified\s*:\s*true\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

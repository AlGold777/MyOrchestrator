const fs = require('fs');
const vm = require('vm');
test.each(['qwen', 'grok', 'lechat'])('%s preserves prose, sources and literal code', provider => {
  const source = fs.readFileSync(require.resolve(`../content-scripts/content-${provider}`), 'utf8');
  const a = source.indexOf('  class ContentCleaner {');
  const b = source.indexOf('  const contentCleaner = new ContentCleaner();', a);
  if (a < 0 || b <= a) throw new Error('Cleaner boundaries changed');
  const cleaner = vm.runInNewContext(source.slice(a, b) + '\nnew ContentCleaner();', { DOMParser, document, console });
  const text = 'Today at 12:30, Copy the Qwen and Alibaba links.\nhttps://example.org/docs?q=1&x=2\n\n```html\n<button>Save</button>\n<!-- literal comment -->\n```\n\n```python\nif ready:\n    print("Search &nbsp; Menu")\n```';
  expect(cleaner.clean(text)).toBe(text);
  expect(cleaner.getStats().charactersRemoved).toBe(0);
  expect(cleaner.clean('<p>Copy https://example.org</p>', { format: 'html' })).toBe('Copy https://example.org');
});

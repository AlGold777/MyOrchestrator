/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-claude'), 'utf8');
const start = source.indexOf('function isLikelyClaudeModelLabel(');
const end = source.indexOf('  let claudeSharedInjection', start);
if (start < 0 || end <= start) throw new Error('Claude filter boundaries changed');
const filter = vm.runInNewContext(source.slice(start, end) + '\nisLikelyClaudeModelLabel;');
test.each(['Sonnet 4.5', 'Claude Opus 4', 'haiku', ' CLAUDE SONNET 4.5 '])(
  'rejects model UI label %s as answer text', label => expect(filter(label)).toBe(true)
);
test.each(['42', 'Claude Opus 4 is one available model.', 'Use Sonnet 4.5 for this task.', '']) (
  'does not discard answer text %s', text => expect(filter(text)).toBe(false)
);

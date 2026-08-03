const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADAPTERS = [
  'content-chatgpt.js',
  'content-claude.js',
  'content-gemini.js',
  'content-grok.js',
  'content-qwen.js',
  'content-deepseek.js',
  'content-lechat.js',
  'content-perplexity.js',
  'content-zai.js'
];

describe('internal error answer contract', () => {
  test.each(ADAPTERS)('%s never serializes a technical Error string as model answer', (file) => {
    const source = fs.readFileSync(path.join(ROOT, 'content-scripts', file), 'utf8');
    expect(source).not.toMatch(/answer\s*:\s*['"`]Error:/);
    expect(source).not.toMatch(/answer\s*:\s*['"`]Structural Error:/);
    expect(source).not.toMatch(/answer\s*:\s*[^\n?]+\?[^\n:]+:\s*`Error:/);
  });

  test('central finalization never synthesizes an Error string into normalizedAnswer', () => {
    const source = fs.readFileSync(path.join(ROOT, 'background', 'job-orchestrator.js'), 'utf8');
    expect(source).not.toMatch(/normalizedAnswer\s*=\s*['"`]Error:/);
    expect(source).not.toMatch(/finalAnswer\s*=\s*[^\n]+`Error:/);
  });
});

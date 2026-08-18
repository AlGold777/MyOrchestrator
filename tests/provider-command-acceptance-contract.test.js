const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROVIDERS = [
  ['GPT', 'content-chatgpt.js'],
  ['Claude', 'content-claude.js'],
  ['Gemini', 'content-gemini.js'],
  ['Grok', 'content-grok.js'],
  ['Le Chat', 'content-lechat.js'],
  ['Qwen', 'content-qwen.js'],
  ['DeepSeek', 'content-deepseek.js'],
  ['Perplexity', 'content-perplexity.js'],
  ['Z.ai', 'content-zai.js'],
  ['Kimi', 'content-kimi.js']
];

describe('provider command acceptance contract', () => {
  test.each(PROVIDERS)('%s ACKs ownership before starting asynchronous provider work', (_model, filename) => {
    const source = fs.readFileSync(path.join(ROOT, 'content-scripts', filename), 'utf8');
    const acceptedAt = source.lastIndexOf("status: 'accepted'");
    const injectAt = source.indexOf('injectAndGetResponse(', acceptedAt);
    expect(acceptedAt).toBeGreaterThan(-1);
    expect(injectAt).toBeGreaterThan(acceptedAt);
    expect(source.slice(Math.max(0, acceptedAt - 1200), injectAt)).toContain('reportProviderPipelineState');
  });

  test('Round 1 requires command acceptance before treating delivery as pending', () => {
    const source = fs.readFileSync(path.join(ROOT, 'background', 'job-orchestrator.js'), 'utf8');
    const round1 = source.slice(
      source.indexOf('async function dispatchRound1Sequentially'),
      source.indexOf('async function', source.indexOf('async function dispatchRound1Sequentially') + 10)
    );
    expect(round1).toContain('requireCommandAcceptance: true');
  });
});

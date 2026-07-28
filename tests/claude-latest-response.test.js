const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function compareDocumentOrder(a, b) {
  if (a === b) return 0;
  const NodeCtor = a?.ownerDocument?.defaultView?.Node;
  const pos = a.compareDocumentPosition(b);
  if (pos & NodeCtor.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & NodeCtor.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function latestClaudeTextFromBundle(document) {
  const bundle = JSON.parse(read('selectors', 'config-bundle.json'));
  const selectors = bundle.Claude.emergencyFallbacks.response;
  const seen = new Set();
  const nodes = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      nodes.push(node);
    });
  }
  nodes.sort(compareDocumentOrder);
  const latest = nodes[nodes.length - 1];
  return (latest?.textContent || '').trim();
}

describe('Claude latest response selection', () => {
  test('selects the latest assistant turn even when a user turn follows it', () => {
    const dom = new JSDOM(`
      <main>
        <div data-testid="conversation-turn" data-author-role="assistant">
          <div class="standard-markdown grid-cols-1">Previous Claude answer</div>
        </div>
        <div data-testid="conversation-turn" data-author-role="user">Follow-up prompt</div>
        <div data-testid="conversation-turn" data-author-role="assistant">
          <div class="standard-markdown grid-cols-1">Latest Claude answer</div>
        </div>
        <div data-testid="conversation-turn" data-author-role="user">Trailing user draft</div>
      </main>
    `);

    expect(dom.window.document.querySelectorAll(
      'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1'
    )).toHaveLength(0);
    expect(latestClaudeTextFromBundle(dom.window.document)).toBe('Latest Claude answer');
  });

  test('content extractor merges primary and fallback candidates and sorts by DOM order', () => {
    const source = read('content-scripts', 'content-claude.js');
    expect(source).toContain('return nodes.sort(compareClaudeDocumentOrder);');
    expect(source).toContain('pool.sort(compareClaudeDocumentOrder);');
    expect(source).not.toContain('if (primary.length) return primary;');
  });
});

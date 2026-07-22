// Behavioural tests for results/dom-utils.js — enabled by extracting the DOM/
// HTML/render helpers out of the results.js monolith into a testable module.
require('../results/dom-utils');

const makeUtils = () => window.ResultsDomUtils.create({
  promptPasteBlockSelector: 'p,div,ul,ol,li',
  escapeHtml: (v = '') => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  sanitizeHTML: (v = '') => String(v)
});

describe('ResultsDomUtils.looksLikeHtml', () => {
  const { looksLikeHtml } = makeUtils();
  test('detects block-level HTML and ignores plain text', () => {
    expect(looksLikeHtml('<p>hi</p>')).toBe(true);
    expect(looksLikeHtml('<ul><li>x</li></ul>')).toBe(true);
    expect(looksLikeHtml('just plain text < 5')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
  });
});

describe('ResultsDomUtils.buildHtmlFromText', () => {
  const { buildHtmlFromText } = makeUtils();
  test('escapes and converts newlines to <br>', () => {
    expect(buildHtmlFromText('a\nb')).toBe('a<br>b');
    expect(buildHtmlFromText('<x>')).toBe('&lt;x&gt;');
  });
});

describe('ResultsDomUtils.clearNode / replaceChildrenFromHtml', () => {
  const utils = makeUtils();
  test('clearNode empties a container', () => {
    const el = document.createElement('div');
    el.innerHTML = '<span>a</span><span>b</span>';
    utils.clearNode(el);
    expect(el.childNodes.length).toBe(0);
  });
  test('replaceChildrenFromHtml renders a fragment', () => {
    const el = document.createElement('div');
    document.body.appendChild(el); // createContextualFragment needs an attached context node
    utils.replaceChildrenFromHtml(el, '<span id="z">z</span>');
    expect(el.querySelector('#z')).not.toBeNull();
    el.remove();
  });
});

describe('ResultsDomUtils.setSvgContent', () => {
  test('strips executable SVG content even when sanitizer is a no-op', () => {
    const { setSvgContent } = makeUtils();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setSvgContent(svg, `
      <script>alert(1)</script>
      <foreignObject><div>unsafe</div></foreignObject>
      <circle onload="alert(1)" onclick="alert(2)" fill="red"></circle>
      <a href="javascript:alert(3)"><text>bad</text></a>
    `);

    expect(svg.querySelector('script')).toBeNull();
    expect(svg.querySelector('foreignObject')).toBeNull();
    expect(svg.querySelector('circle').getAttribute('onload')).toBeNull();
    expect(svg.querySelector('circle').getAttribute('onclick')).toBeNull();
    expect(svg.querySelector('a').getAttribute('href')).toBeNull();
  });

  test('preserves safe connector SVG elements when the HTML sanitizer would strip them', () => {
    const { setSvgContent } = window.ResultsDomUtils.create({
      sanitizeHTML: () => ''
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setSvgContent(svg, '<line x1="0" y1="1" x2="2" y2="3" class="connector-line inactive"/><polygon points="0,0 4,2 0,4" class="arrow-head inactive"/>');

    expect(svg.querySelector('line.connector-line')).not.toBeNull();
    expect(svg.querySelector('polygon.arrow-head')).not.toBeNull();
  });
});

describe('ResultsDomUtils.plainTextFromHtml', () => {
  const { plainTextFromHtml } = makeUtils();
  test('flattens lists with prefixes and <br> to newlines', () => {
    const text = plainTextFromHtml('<ul><li>first</li><li>second</li></ul>');
    expect(text).toContain('- first');
    expect(text).toContain('- second');
    expect(plainTextFromHtml('a<br>b')).toBe('a\nb');
  });
  test('numbers ordered lists', () => {
    const text = plainTextFromHtml('<ol><li>one</li><li>two</li></ol>');
    expect(text).toContain('1. one');
    expect(text).toContain('2. two');
  });
});

describe('ResultsDomUtils.renderIncrementalList', () => {
  test('reuses unchanged nodes, re-renders changed ones, and reports measurements', () => {
    const utils = makeUtils();
    const measurements = [];
    utils.setIncrementalRenderHandler((m) => measurements.push(m));
    const container = document.createElement('div');

    const renderItem = (item) => {
      const node = document.createElement('div');
      node.textContent = item.text;
      return node;
    };
    const opts = { getId: (i) => i.id, getHash: (i) => i.text, renderItem };

    utils.renderIncrementalList(container, [{ id: 'a', text: '1' }, { id: 'b', text: '1' }], opts);
    const firstA = container.querySelector('[data-item-id="a"]');
    expect(container.children.length).toBe(2);
    expect(measurements[0]).toEqual(expect.objectContaining({ itemCount: 2, mutatedCount: 2 }));

    // Re-render: 'a' unchanged (reused node), 'b' changed (new node).
    utils.renderIncrementalList(container, [{ id: 'a', text: '1' }, { id: 'b', text: '2' }], opts);
    expect(container.querySelector('[data-item-id="a"]')).toBe(firstA); // reused
    expect(measurements[1]).toEqual(expect.objectContaining({ itemCount: 2, mutatedCount: 1 }));
  });
});

describe('ResultsDomUtils.insertTextAtCursor', () => {
  const { insertTextAtCursor } = makeUtils();
  test('inserts at the selection range', () => {
    const input = document.createElement('textarea');
    input.value = 'hello world';
    input.setSelectionRange(5, 5); // after "hello"
    insertTextAtCursor(input, ' there');
    expect(input.value).toBe('hello there world');
  });
});

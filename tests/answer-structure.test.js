/** @jest-environment jsdom */
const AnswerStructure = require('../content-scripts/answer-structure');

describe('recursive answer structural completeness', () => {
  test('exact selected answer with only ignored controls is complete', () => {
    document.body.innerHTML = `
      <article id="root">
        <div id="answer"><p>placeholder paragraph</p><pre>placeholder code</pre></div>
        <div role="toolbar"><button>placeholder action</button></div>
      </article>`;
    const result = AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    );
    expect(result).toEqual(expect.objectContaining({ complete: true, omittedBlockCount: 0 }));
  });

  test.each([
    ['nested paragraph', '<section><div><p>omitted placeholder</p></div></section>'],
    ['short code', '<section><pre>x</pre></section>'],
    ['list item', '<ul><li>omitted item</li></ul>'],
    ['table cell', '<table><tbody><tr><td>omitted cell</td></tr></tbody></table>'],
    ['non-text media', '<section><img alt="placeholder"></section>']
  ])('artificial truncation with %s never reports complete', (_name, omittedHtml) => {
    document.body.innerHTML = `<article id="root"><div id="answer">kept placeholder</div>${omittedHtml}</article>`;
    const result = AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    );
    expect(result.complete).toBe(false);
    expect(result.issues).toContain('uncovered_message_blocks');
    expect(result.omittedBlockCount).toBeGreaterThan(0);
  });

  test('a tiny omitted block is not excused by a high coverage ratio', () => {
    document.body.innerHTML = `<article id="root"><div id="answer">${'p'.repeat(1000)}</div><code>x</code></article>`;
    const result = AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    );
    expect(result.complete).toBe(false);
  });

  test('content hidden by a stylesheet class does not create false incompleteness', () => {
    document.head.innerHTML = '<style>.provider-hidden { display: none; }</style>';
    document.body.innerHTML = `
      <article id="root">
        <div id="answer">kept placeholder</div>
        <div class="provider-hidden"><p>hidden service placeholder</p></div>
      </article>`;
    const result = AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    );
    expect(result.complete).toBe(true);
  });

  test.each(['sr-only', 'visually-hidden', 'screen-reader-label', 'cdk-visually-hidden'])(
    'accessibility-only class %s is ignored as service text',
    (className) => {
      document.body.innerHTML = `
        <article id="root"><div id="answer">kept placeholder</div><h2 class="${className}">service label</h2></article>`;
      expect(AnswerStructure.inspect(
        document.querySelector('#root'), document.querySelector('#answer')
      ).complete).toBe(true);
    }
  );

  test('decorative SVG is ignored but explicitly semantic SVG remains content', () => {
    document.body.innerHTML = `
      <article id="root">
        <div id="answer">kept placeholder</div>
        <svg class="decorative-icon"><path d="M0 0"></path></svg>
      </article>`;
    expect(AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    ).complete).toBe(true);

    document.querySelector('svg').setAttribute('role', 'img');
    expect(AnswerStructure.inspect(
      document.querySelector('#root'), document.querySelector('#answer')
    ).complete).toBe(false);
  });

  test('missing or detached nodes fail closed', () => {
    const root = document.createElement('article');
    const detached = document.createElement('div');
    expect(AnswerStructure.inspect(null, detached).complete).toBe(false);
    expect(AnswerStructure.inspect(root, detached).issues).toContain('selected_outside_message_root');
  });
});

const fs = require('fs');
const source = fs.readFileSync(require.resolve('../content-scripts/content-utils'), 'utf8');
beforeEach(() => { delete window.ContentUtils; window.eval(source); });

test('rich editor replaces its selected draft without DOM-clear/framework-restore duplication', async () => {
  document.body.innerHTML = '<div contenteditable="true">previous draft previous draft</div>';
  const editor = document.querySelector('div');
  const before = editor.textContent;
  const previousExec = document.execCommand;
  const cleared = jest.fn(() => { editor.textContent = before; });
  editor.addEventListener('input', event => { if (event.inputType === 'deleteContentBackward') cleared(); });
  document.execCommand = jest.fn((command, _, text) => {
    if (command !== 'insertText') return false;
    const selected = document.getSelection().toString();
    editor.textContent = selected === editor.textContent ? text : editor.textContent + text;
    return true;
  });
  try {
    const result = await window.ContentUtils.ensurePromptPrepared(editor, 'Divide 144 by 12');
    expect(result.ok).toBe(true);
    expect(editor.textContent).toBe('Divide 144 by 12');
    expect(cleared).not.toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledTimes(1);
  } finally { document.execCommand = previousExec; }
});

test('shared preparation follows a replacement editor and skips unnecessary fallback', async () => {
  document.body.innerHTML = '<div contenteditable="true"></div>';
  const old = document.querySelector('div');
  const previousExec = document.execCommand;
  const fallback = jest.fn();
  document.execCommand = jest.fn((command, _, text) => {
    if (command === 'insertText') {
      const next = document.createElement('div');
      next.contentEditable = 'true';
      next.textContent = text;
      old.replaceWith(next);
    }
    return true;
  });
  try {
    const result = await window.ContentUtils.ensurePromptPrepared(old, 'Divide 144 by 12', {
      resolveComposer: () => document.querySelector('div'), fallback
    });
    expect(result.ok).toBe(true);
    expect(result.composer).toBe(document.querySelector('div'));
    expect(result.composer).not.toBe(old);
    expect(fallback).not.toHaveBeenCalled();
  } finally { document.execCommand = previousExec; }
});

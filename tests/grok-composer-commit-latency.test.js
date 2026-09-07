/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
test.each([false, true])('Grok checks the complete text at both ends of a short settlement (changed=%s)', async changed => {
  jest.useFakeTimers();
  try {
    const source = fs.readFileSync(require.resolve('../content-scripts/content-grok'), 'utf8');
    const start = source.indexOf('async function waitForGrokComposerCommit');
    const c = { Date, normalizeForComparison: s => s, readComposerValue: el => el?.value || '',
      discoverComposer: () => null, emitDiagnostic: jest.fn(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
    vm.createContext(c);
    vm.runInContext(source.slice(start, source.indexOf('\n  // Полностью', start)), c);
    const editor = {isConnected:true, value:'8 / 4'};
    const result = c.waitForGrokComposerCommit(editor, editor.value);
    await jest.advanceTimersByTimeAsync(100);
    if (changed) editor.value = '8 /';
    await jest.advanceTimersByTimeAsync(50);
    expect(await result).toBe(changed ? null : editor);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

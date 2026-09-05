/** @jest-environment jsdom */
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../humanoid.js'), 'utf8');

describe('bounded composer interaction', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.Humanoid;
    document.body.innerHTML = '<textarea></textarea>';
    window.requestAnimationFrame = jest.fn(); // A suspended background tab.
    window.__UniversalScrollToolkit = jest.fn(() => ({
      scrollElementIntoView: jest.fn(() => new Promise(() => {}))
    }));
    window.eval(source);
  });
  afterEach(() => {
    jest.useRealTimers();
    delete window.Humanoid;
    delete window.__UniversalScrollToolkit;
  });
  test('long prompt inserts in one second without page settlement or animation frames', async () => {
    const input = document.querySelector('textarea');
    input.scrollIntoView = jest.fn();
    const prompt = 'Long prompt. '.repeat(2000);
    const operation = window.Humanoid.typeText(input, prompt);
    await jest.advanceTimersByTimeAsync(1000);
    await operation;
    expect(input.value).toBe(prompt);
    expect(window.__UniversalScrollToolkit).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(input.scrollIntoView).toHaveBeenCalledTimes(1);
  });
  test('native setter makes a controlled textarea observe the inserted value', async () => {
    const input = document.querySelector('textarea');
    const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    let tracked = '';
    Object.defineProperty(input, 'value', {
      get() { return native.get.call(this); },
      set(value) { tracked = value; native.set.call(this, value); }
    });
    let changed = false;
    input.addEventListener('input', () => { if (tracked !== input.value) changed = true; });
    const operation = window.Humanoid.typeText(input, 'new prompt');
    await jest.advanceTimersByTimeAsync(1000);
    await operation;
    expect(changed).toBe(true);
  });
  test('rejected paste fails promptly and never starts character typing', async () => {
    const input = document.querySelector('textarea');
    input.addEventListener('input', () => { input.value = ''; });
    const keydown = jest.fn();
    input.addEventListener('keydown', keydown);
    const operation = window.Humanoid.typeText(input, 'long '.repeat(2000));
    const rejected = expect(operation).rejects.toThrow('provider fallback required');
    await jest.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(keydown).not.toHaveBeenCalled();
  });
});

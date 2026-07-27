/** @jest-environment jsdom */
const Renderer = require('../results/debate-renderer');

test('renders run controls from a view model only', () => {
  document.body.innerHTML = '<button id="run"></button><button id="step"></button>';
  Renderer.renderRunControls({
    runButton: document.getElementById('run'),
    stepButton: document.getElementById('step'),
    view: { action: 'pause', icon: 'ti pause', title: 'Pause', active: false, enabled: true, stepEnabled: true }
  });
  expect(document.getElementById('run').dataset.action).toBe('pause');
  expect(document.getElementById('run').querySelector('i').className).toBe('ti pause');
  expect(document.getElementById('step').disabled).toBe(false);
  expect(document.getElementById('run').disabled).toBe(false);
});

test('honors disabled state from the run-control view model', () => {
  document.body.innerHTML = '<button id="run"></button>';
  Renderer.renderRunControls({
    runButton: document.getElementById('run'),
    view: { action: 'wait', icon: 'ti wait', title: 'Starting', active: true, enabled: false }
  });
  expect(document.getElementById('run').disabled).toBe(true);
  expect(document.getElementById('run').getAttribute('aria-disabled')).toBe('true');
});

/** @jest-environment jsdom */
const Renderer = require('../results/debate-renderer');

test('renders run controls from a view model only', () => {
  document.body.innerHTML = '<button id="run"></button><button id="step"></button>';
  Renderer.renderRunControls({
    runButton: document.getElementById('run'),
    stepButton: document.getElementById('step'),
    view: { action: 'pause', icon: 'ti pause', title: 'Pause', active: false, stepEnabled: true }
  });
  expect(document.getElementById('run').dataset.action).toBe('pause');
  expect(document.getElementById('run').querySelector('i').className).toBe('ti pause');
  expect(document.getElementById('step').disabled).toBe(false);
});

const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const PANEL_SRC = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
const RESULT_SRC = fs.readFileSync(path.join(__dirname, '..', 'result_new.html'), 'utf8');

describe('Disput T10 safety controls', () => {
  test('pause control follows the active preset safety policy', () => {
    expect(RESULTS_SRC).toContain('const canPause = getDebateSafetyPolicy().canPause;');
    expect(RESULTS_SRC).toContain("debateAutoPauseBtn.classList.toggle('hidden', !isAuto || !canPause)");
    expect(RESULTS_SRC).toContain('if (!getDebateSafetyPolicy().canPause) return;');
  });

  test('dropout recovery exposes a guarded manual retry action', () => {
    expect(RESULTS_SRC).toContain("retryText: safetyPolicy.canRecover ? 'Повторить ещё раз' : ''");
    expect(RESULTS_SRC).toContain("return 'retry';");
    expect(PANEL_SRC).toContain('id="retry-confirm"');
    expect(RESULT_SRC).toContain('id="retry-confirm"');
  });
});

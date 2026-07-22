// Locks the UI-recovery wiring fix: the main page must recover a hidden/collapsed
// shell promptly (on tab re-visibility and on run completion) instead of only on the
// 30s watchdog tick — the cause of "after a run the main page shows only the
// background for a while, then comes back".
const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const BOOT_SRC = fs.readFileSync(path.join(__dirname, '..', 'results', 'boot-utils.js'), 'utf8');
const UI_BROADCAST_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'ui-broadcast.js'), 'utf8');
const ORCHESTRATOR_SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

describe('main-page UI recovery triggers', () => {
  test('visibilitychange (becoming visible) triggers recovery, not just logging', () => {
    const idx = RESULTS_SRC.indexOf("addEventListener('visibilitychange'");
    expect(idx).toBeGreaterThan(-1);
    const block = RESULTS_SRC.slice(idx, idx + 1600);
    expect(block).toContain("document.visibilityState === 'visible'");
    expect(block).toContain("recoverUiIfHidden('visibilitychange')");
  });

  test('run completion triggers recovery', () => {
    expect(RESULTS_SRC).toContain("recoverUiIfHidden('run_complete')");
  });

  test('recovery defers via requestAnimationFrame so layout reports real sizes', () => {
    // Both triggers should double-rAF before measuring (avoid false collapse trigger).
    expect(RESULTS_SRC).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => recoverUiIfHidden\('visibilitychange'\)\)\)/);
    expect(RESULTS_SRC).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => recoverUiIfHidden\('run_complete'\)\)\)/);
  });

  test('recoverUiIfHidden still un-hides shell + clears hiding classes/styles', () => {
    // Guard the remediation contract the triggers rely on.
    expect(BOOT_SRC).toContain("classList.remove('pro-features-hidden', 'hidden')");
    expect(BOOT_SRC).toContain("resetGeometryState()");
  });

  test('global-state recovery hydrates an empty card from persisted answer payload', () => {
    expect(UI_BROADCAST_SRC).toContain('buildGlobalStateSnapshot({ includeAnswers: true })');
    expect(RESULTS_SRC).toContain("source: 'GLOBAL_STATE_ANSWER_RECOVERY'");
    expect(RESULTS_SRC).toContain('updateDebateModelCardOutput(llmName, answerText, answerHtml');
  });

  test('accepted answer is persisted before SUCCESS is published', () => {
    const guardAt = ORCHESTRATOR_SRC.indexOf('Persist accepted answer text before publishing SUCCESS');
    const block = ORCHESTRATOR_SRC.slice(guardAt, guardAt + 1000);
    expect(guardAt).toBeGreaterThan(-1);
    expect(block.indexOf('entry.answer = normalizedAnswer;')).toBeGreaterThan(-1);
    expect(block.indexOf('updateModelState(llmName, finalStatus, {'))
      .toBeGreaterThan(block.indexOf('entry.answer = normalizedAnswer;'));
    expect(RESULTS_SRC).toContain("const status = successWithoutAnswer ? 'UNCERTAIN' : rawStatus;");
  });
});

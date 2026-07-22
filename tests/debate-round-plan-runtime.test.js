const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const duelSource = fs.readFileSync(path.join(__dirname, '..', 'disput', 'duel-runner.js'), 'utf8');
const triadSource = fs.readFileSync(path.join(__dirname, '..', 'disput', 'triad-runner.js'), 'utf8');
const multiSource = fs.readFileSync(path.join(__dirname, '..', 'disput', 'multi-runner.js'), 'utf8');

describe('Debate round-plan runtime wiring', () => {
  test('R1 is excluded from Duel public-turn budget', () => {
    expect(source).toContain('Math.max(0, (roundLimit - 1) * 2)');
  });

  test('all topologies execute a round filter pass', () => {
    expect(duelSource).toContain("topology: 'duel'");
    expect(triadSource).toContain("topology: 'triad'");
    expect(multiSource).toContain("topology: 'multi'");
    expect(duelSource).toContain('deps.runRoundFilter?.({');
    expect(triadSource).toContain('deps.runRoundFilter?.({');
    expect(multiSource).toContain('deps.runRoundFilter?.({');
  });

  test('Multi synthesis receives every wave and every filter', () => {
    expect(multiSource).toContain('turns: state.responsesByWave.flat()');
    expect(multiSource).toContain('roundFilters: state.roundFilters');
  });

  test('Multi manual mode waits between protocol stages', () => {
    expect(multiSource).toContain("const runPolicy = input.executionPlan?.runPolicy || preset.runPolicy || 'manual'");
    expect(multiSource).toContain("runPolicy === 'manual'");
    expect(multiSource).toContain('await deps.waitForContinuation?.');
  });

  test('Duel publishes generated Final Synthesis, not moderator placeholder text', () => {
    expect(duelSource).toContain('buildFinalSynthesisPrompt');
    expect(duelSource).toContain("title: 'Final Synthesis'");
    const finalizer = duelSource.slice(duelSource.indexOf('async requestFinalWords'), duelSource.indexOf('async runTurnWithRetry'));
    expect(finalizer).not.toContain('buildModeratorSummaryText(serialState)');
  });
});

const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
const DUEL_RUNNER_SRC = fs.readFileSync(path.join(__dirname, '..', 'disput', 'duel-runner.js'), 'utf8');

function extractRouteSerialApprovedTurn() {
  const start = DUEL_RUNNER_SRC.indexOf('async routeApprovedTurn');
  const end = DUEL_RUNNER_SRC.indexOf('\n      }\n    });', start);
  return DUEL_RUNNER_SRC.slice(start, end);
}

describe('serial debate routing source guards', () => {
  test('manual routing chooses a target without rewriting participant identity', () => {
    const adapterStart = RESULTS_SRC.indexOf('prepareRoute:');
    const adapterEnd = RESULTS_SRC.indexOf('recordRoute:', adapterStart);
    const adapter = RESULTS_SRC.slice(adapterStart, adapterEnd);
    expect(adapter).toContain('const manualTarget');
    expect(adapter).not.toMatch(/state\.modelA\s*=/);
    expect(adapter).not.toMatch(/state\.modelB\s*=/);
  });

  test('auto routing uses an explicit loop instead of recursive continuation', () => {
    const body = extractRouteSerialApprovedTurn();
    expect(body).toContain('while (true)');
    expect(body).toContain('current = { llmName: route.targetModel, text: answer }');
    expect(body).not.toMatch(/await\s+routeApprovedTurn\(/);
  });

  test('serial opening dispatch uses one promptsByModel batch for A0 and B0', () => {
    const start = DUEL_RUNNER_SRC.indexOf('const initResult = await');
    const end = DUEL_RUNNER_SRC.indexOf('const recordOpening', start);
    const body = DUEL_RUNNER_SRC.slice(start, end);
    expect(body).toContain('[scenario.modelA]: initialPrompt');
    expect(body).toContain('[scenario.modelB]: silentInitBPrompt');
    expect(body).toContain('promptsByModel:');
    expect(body).toContain('models: [scenario.modelA, scenario.modelB]');
  });
});

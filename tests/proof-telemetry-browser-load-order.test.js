const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');

const ROOT = path.join(__dirname, '..');
const dependencyOrder = [
  'shared/proof-telemetry-contracts.js',
  'shared/proof-telemetry-inventory.js',
  'shared/proof-telemetry-clock.js',
  'shared/proof-telemetry-incidents.js',
  'shared/proof-telemetry-policy.js',
  'shared/proof-oriented-telemetry.js'
];

function browserContext() {
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder });
  context.globalThis = context;
  dependencyOrder.forEach((resource) => {
    const filename = path.join(ROOT, resource);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  });
  return context;
}

describe('proof telemetry browser load order', () => {
  test.each(['result_new.html', 'pipeline_panel.html'])('%s loads policy before the builder', (page) => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    expect(html.indexOf('shared/proof-telemetry-policy.js'))
      .toBeLessThan(html.indexOf('shared/proof-oriented-telemetry.js'));
  });

  test('background loads policy before the builder', () => {
    const source = fs.readFileSync(path.join(ROOT, 'background', 'index.js'), 'utf8');
    expect(source.indexOf("'../shared/proof-telemetry-policy.js'"))
      .toBeLessThan(source.indexOf("'../shared/proof-oriented-telemetry.js'"));
  });

  test('page-side state axes use exact policy provenance instead of fallback audit data', () => {
    const context = browserContext();
    const ledger = context.ProofOrientedTelemetry.buildLedger([{
      ts: 1000,
      type: 'TELEMETRY',
      label: 'ANSWER_GENERATING',
      level: 'info',
      platform: 'GPT',
      meta: { llmName: 'GPT', runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, textLength: 1 }
    }], { runSessionId: 42, exportedAt: 2000 });
    const state = context.ProofOrientedTelemetry.deriveAxisState(ledger);
    expect(state.stateAxesProvenance.generationStart).toEqual(expect.objectContaining({
      layer: 'fact',
      ruleId: 'generation-start-observed',
      basisEventIds: [ledger[0].eventId],
      derivationVersion: 'state-axes-provenance@1.0.0'
    }));
  });
});

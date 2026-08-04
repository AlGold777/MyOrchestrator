const fs = require('fs');
const path = require('path');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Contracts = require('../shared/proof-telemetry-contracts.js');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('provider dispatch stage telemetry', () => {
  test('maps provider and focus-boundary stages into canonical evidence', () => {
    const provider = {
      label: 'PROVIDER_DISPATCH_STAGE_OBSERVED',
      platform: 'Grok',
      meta: { stage: 'send_action_requested', dispatchId: 'd1' }
    };
    const hold = {
      label: 'DISPATCH_POST_COMMAND_FOCUS_HOLD',
      platform: 'Grok',
      meta: { boundaryReason: 'hold_elapsed', dispatchId: 'd1' }
    };
    expect(ProofTelemetry.canonicalType(provider)).toBe('DISPATCH_STAGE_OBSERVED');
    expect(ProofTelemetry.canonicalType(hold)).toBe('DISPATCH_STAGE_OBSERVED');
    const ledger = ProofTelemetry.buildLedger([provider, hold], { runSessionId: 'run' });
    expect(ledger.map((event) => Contracts.factOf(event))).toEqual([
      expect.objectContaining({ kind: 'dispatch_stage', state: 'send_action_requested' }),
      expect.objectContaining({ kind: 'dispatch_stage', state: 'hold_elapsed' })
    ]);
  });

  test('Grok and Perplexity publish composer, insertion and send stages', () => {
    for (const file of ['content-grok.js', 'content-perplexity.js']) {
      const source = read('content-scripts', file);
      expect(source).toContain("reportStage('composer_transaction_started')");
      expect(source).toContain("reportStage('composer_ready'");
      expect(source).toContain("reportStage('prompt_insertion_started')");
      expect(source).toContain("reportStage('send_action_requested')");
      expect(source).toContain("reportStage('send_action_completed'");
    }
  });

  test('stage messages require bound-tab and dispatch correlation', () => {
    const router = read('background', 'message-router.js');
    expect(router).toContain("case 'PROVIDER_DISPATCH_STAGE_OBSERVED'");
    expect(router).toContain("validateLifecycleSender(llmName, sender, 'PROVIDER_DISPATCH_STAGE_OBSERVED'");
    expect(router).toContain("validateLifecycleCorrelation(llmName, message, 'PROVIDER_DISPATCH_STAGE_OBSERVED')");
  });
});

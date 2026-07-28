const fs = require('fs');
const path = require('path');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');
const Policy = require('../shared/proof-telemetry-policy.js');
const { validateStandaloneReport, optimizeRepresentation } = require('../scripts/validate-proof-telemetry.js');

const evt = (label, ts, meta = {}) => ({
  ts,
  label,
  platform: 'GPT',
  meta: { runSessionId: 42, dispatchId: 'GPT:42:1', generationEpoch: 1, ...meta }
});

describe('proof telemetry final acceptance metrics', () => {
  test('standalone artifact is one self-contained, replayable incident', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('DISPATCH_BASELINE_CAPTURED', 1000),
      evt('DISPATCH_SEND', 1010),
      evt('PROMPT_SUBMITTED_ACCEPTED', 1020),
      evt('PAGE_READY_STATE', 1030),
      evt('LIFECYCLE_SNAPSHOT_REJECTED', 1040)
    ], { runSessionId: 42 });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, {
      canonicalLedger: true, modelId: 'GPT', reportType: 'submission-proof'
    });
    const ids = new Set(report.eventSelection.eventRefs);
    expect(report.correlation).toEqual(expect.objectContaining({
      runSessionId: '42', modelId: 'GPT', dispatchId: 'GPT:42:1', generationEpoch: 1
    }));
    expect(report.eventSelection.materializedEvents.every((event) => event.includedFor.length > 0)).toBe(true);
    expect(Object.values(report.derivedViews.fieldProvenance).every((item) => item.derivedFromEventIds.every((id) => ids.has(id)))).toBe(true);
    expect(report.exportIntegrity.replay.valid).toBe(true);
    expect((await validateStandaloneReport(report)).valid).toBe(true);
  });

  test('missing independent observation cannot become tier 3 completion proof', () => {
    const withoutCoverage = ProofTelemetry.buildLedger([
      evt('TURN_RESOLUTION_ACCEPTED', 1000, { answerIdentity: 'current_dispatch' }),
      evt('STREAMING_TRUE_TO_FALSE', 1010)
    ], { runSessionId: 42 });
    expect(Policy.evidenceTier(withoutCoverage, withoutCoverage.at(-1))).toBeLessThan(3);
  });

  test('representation pressure never removes core evidence', async () => {
    const ledger = ProofTelemetry.buildLedger([
      evt('DISPATCH_BASELINE_CAPTURED', 1000), evt('DISPATCH_SEND', 1010), evt('PROMPT_SUBMITTED_ACCEPTED', 1020)
    ], { runSessionId: 42 });
    const report = await ProofTelemetry.buildStandaloneReport(ledger, { canonicalLedger: true, modelId: 'GPT', reportType: 'submission-proof' });
    const optimized = await optimizeRepresentation(report, { transportLimitBytes: 1 });
    expect(optimized.eventSelection.materializedEvents).toEqual(report.eventSelection.materializedEvents);
  });

  test('both telemetry surfaces retain exactly Platform and Tasks', () => {
    ['result_new.html', 'pipeline_panel.html'].forEach((filename) => {
      const html = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
      const start = html.indexOf('<div class="telemetry-filters">');
      const end = html.indexOf('</div>', start);
      const toolbar = html.slice(start, end);
      expect((toolbar.match(/<select /g) || [])).toHaveLength(2);
      expect(toolbar).toContain('telemetry-platform-select');
      expect(toolbar).toContain('telemetry-task-select');
      expect(toolbar).not.toContain('Only problems');
    });
  });
});

const LogReplayHarness = require('../shared/log-replay-harness');
const ProofTelemetry = require('../shared/proof-oriented-telemetry.js');

describe('LogReplayHarness', () => {
  test('detects legacy, schema 6 and container inputs explicitly', async () => {
    const legacy = [{ ts: 10, llmName: 'GPT', label: 'MODEL_FINAL', status: 'SUCCESS' }];
    const proof = ProofTelemetry.buildLedger(legacy, { runSessionId: 42 });
    const container = await ProofTelemetry.buildAllPresets(proof, { canonicalLedger: true, exportedAt: 20 });
    expect(LogReplayHarness.detectInputSchema(legacy)).toBe(LogReplayHarness.INPUT_SCHEMAS.LEGACY_EVENTS_V1);
    expect(LogReplayHarness.detectInputSchema(proof)).toBe(LogReplayHarness.INPUT_SCHEMAS.PROOF_EVENTS_V6);
    expect(LogReplayHarness.detectInputSchema(container)).toBe(LogReplayHarness.INPUT_SCHEMAS.ALL_PRESETS_V5);
  });

  test('reads modelId, eventType and wallTs through the schema 6 adapter and compares policy replay', () => {
    const proof = ProofTelemetry.buildLedger([
      { ts: 10, platform: 'GPT', label: 'MODEL_FINAL', meta: { runSessionId: 42, dispatchId: 'd1', finalStatus: 'SUCCESS' } }
    ], { runSessionId: 42 });
    const replay = LogReplayHarness.replay(proof);
    expect(replay.inputSchema).toBe('proof-events-v6');
    expect(replay.adapter).toBe('proof-v6');
    expect(replay.models.GPT).toEqual(expect.objectContaining({
      finalStatus: 'SUCCESS', terminalEvents: 1, lastEventAt: 10
    }));
    expect(replay.models.unknown).toBeUndefined();
    expect(replay.proofPolicyComparison).toEqual(expect.objectContaining({
      compared: true,
      modelSetEquivalent: true,
      summaryModels: ['GPT'],
      policyModels: ['GPT']
    }));
  });

  test('fails closed for mixed or unknown schemas', () => {
    const proof = ProofTelemetry.buildLedger([
      { ts: 10, platform: 'GPT', label: 'MODEL_FINAL', meta: { runSessionId: 42, finalStatus: 'SUCCESS' } }
    ], { runSessionId: 42 });
    expect(() => LogReplayHarness.replay([proof[0], { ts: 11, label: 'MODEL_FINAL' }]))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REPLAY_SCHEMA', inputSchema: 'mixed' }));
    expect(() => LogReplayHarness.replay({ arbitrary: true }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REPLAY_SCHEMA', inputSchema: 'unsupported' }));
  });

  test('accepts a grouped legacy export without manual flattening', () => {
    const replay = LogReplayHarness.replay({
      '<GPT>': [{ ts: 10, llmName: 'GPT', label: 'MODEL_FINAL', status: 'SUCCESS' }]
    });
    expect(replay.inputSchema).toBe('legacy-grouped-v1');
    expect(replay.models.GPT.finalStatus).toBe('SUCCESS');
  });

  test('replays terminal decisions and ignored duplicate finals per model', () => {
    const replay = LogReplayHarness.replay([
      {
        ts: 10,
        llmName: 'GPT',
        label: 'MODEL_FINAL',
        status: 'SUCCESS',
        meta: { decision: 'accept_success', reason: 'open_terminal_slot' }
      },
      {
        ts: 11,
        llmName: 'GPT',
        label: 'MODEL_FINAL ignored (deduplicated)',
        status: 'SUCCESS',
        meta: {
          decision: 'ignore_duplicate_final',
          telemetryTaxonomy: { eventClass: 'finalization_duplicate_ignored' }
        }
      }
    ]);

    expect(replay.models.GPT).toEqual(expect.objectContaining({
      finalStatus: 'SUCCESS',
      duplicateFinalIgnored: 1,
      terminalEvents: 1
    }));
    expect(replay.totals).toEqual(expect.objectContaining({
      events: 2,
      models: 1,
      duplicateFinalIgnored: 1,
      terminalEvents: 1
    }));
  });

  test('counts stale quarantine and recovery denial without changing terminal status', () => {
    const replay = LogReplayHarness.replay([
      {
        llmName: 'Qwen',
        label: 'STALE_EVENT_QUARANTINED',
        meta: { decision: 'ignore_stale_event', reason: 'runSessionId_mismatch' }
      },
      {
        llmName: 'Qwen',
        label: 'RECOVERY_INTENT_DENIED',
        meta: { decision: 'deny_recovery_intent', reason: 'no_resend_after_answer_evidence' }
      }
    ]);

    expect(replay.models.Qwen).toEqual(expect.objectContaining({
      finalStatus: null,
      staleEvents: 1,
      recoveryDenied: 1
    }));
    expect(replay.totals).toEqual(expect.objectContaining({
      staleEvents: 1,
      recoveryDenied: 1,
      terminalEvents: 0
    }));
  });
});

describe('real export replay fixtures (Track 4)', () => {
  // Fixture: the defective 2.74.97 export (run 1781134505984) — UI-filtered,
  // no terminal events for any model. Replaying it must (a) not crash,
  // (b) derive NO terminal outcome for any model, and (c) the run-summary
  // builder must flag the export as taken mid-run. Every future problem
  // export gets dropped into tests/replay-fixtures/ the same way.
  const fs = require('fs');
  const path = require('path');
  const TelemetryExport = require('../shared/telemetry-export');

  test('replay of run 1781134505984 derives no terminal outcomes and flags an active-run export', () => {
    const grouped = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'replay-fixtures', 'telemetry-1781134749690.json'),
      'utf8'
    ));
    const allEvents = Object.values(grouped).flat();
    expect(allEvents.length).toBeGreaterThan(50);

    const replay = LogReplayHarness.replay(allEvents);
    Object.entries(replay.models || {}).forEach(([model, summary]) => {
      expect({ model, finalStatus: summary.finalStatus || null }).toEqual({ model, finalStatus: null });
    });

    const summaryGroup = TelemetryExport.buildRunSummaryGroup(grouped, { runSessionId: 1781134505984 });
    const exportState = summaryGroup.find((e) => e.label === 'RUN_EXPORT_STATE');
    expect(exportState.details).toBe('export_during_active_run');
    expect(exportState.meta.pendingModels.length).toBeGreaterThan(0);
  });
});

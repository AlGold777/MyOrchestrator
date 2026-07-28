const LogReplayHarness = require('../shared/log-replay-harness');

describe('LogReplayHarness', () => {
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

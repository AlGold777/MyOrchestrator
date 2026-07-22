const TelemetryExport = require('../shared/telemetry-export.js');

const evt = (platform, label, details = '', extra = {}) => ({
  ts: extra.ts || Date.now(),
  type: extra.type || 'TELEMETRY',
  label,
  details,
  level: extra.level || 'info',
  platform,
  meta: { llmName: platform, ...(extra.meta || {}) }
});

describe('TelemetryExport run summary', () => {
  test('model with MODEL_FINAL gets a terminal outcome', () => {
    const outcome = TelemetryExport.buildModelOutcome('GPT', [
      evt('GPT', 'ROUND1_END', 'dispatch command sent'),
      evt('GPT', 'MODEL_FINAL', 'SUCCESS'),
      evt('GPT', 'SELECTOR_STATS', 'noise')
    ]);
    expect(outcome.meta.terminal).toBe(true);
    expect(outcome.meta.finalStatus).toBe('SUCCESS');
    expect(outcome.meta.finalSignalSource).toBe('MODEL_FINAL');
  });

  test('model without terminal signal is reported as no_terminal_outcome (Grok/Le Chat case)', () => {
    const outcome = TelemetryExport.buildModelOutcome('Grok', [
      evt('Grok', 'ROUND1_END', 'dispatch command sent (awaiting confirmation)'),
      evt('Grok', 'MANUAL_PING_FAIL', 'unchanged'),
      evt('Grok', 'BUDGET_EXHAUSTED', ''),
      evt('Grok', 'DOM_FALLBACK_TIMEOUT', 'elapsed=63852ms')
    ]);
    expect(outcome.meta.terminal).toBe(false);
    expect(outcome.details).toBe('no_terminal_outcome');
    expect(outcome.level).toBe('warning');
  });

  test('RECOVERABLE_ERROR status alone is not treated as terminal', () => {
    const outcome = TelemetryExport.buildModelOutcome('DeepSeek', [
      evt('DeepSeek', 'Status: RECOVERABLE_ERROR', 'script_runtime_hard_stop_180000ms')
    ]);
    expect(outcome.meta.terminal).toBe(false);
  });

  test('MODEL_FINAL outranks an earlier recoverable status (DeepSeek case)', () => {
    const outcome = TelemetryExport.buildModelOutcome('DeepSeek', [
      evt('DeepSeek', 'Status: RECOVERABLE_ERROR', 'hard stop', { ts: 1000 }),
      evt('DeepSeek', 'FINALIZATION_DECISION', 'SUCCESS:accepted', { ts: 2000 }),
      evt('DeepSeek', 'MODEL_FINAL', 'SUCCESS', { ts: 3000 })
    ]);
    expect(outcome.meta.terminal).toBe(true);
    expect(outcome.meta.finalStatus).toBe('SUCCESS');
    expect(outcome.meta.finalSignalSource).toBe('MODEL_FINAL');
  });

  test('rejected finalization decision is not a terminal signal', () => {
    const outcome = TelemetryExport.buildModelOutcome('Gemini', [
      evt('Gemini', 'FINALIZATION_DECISION', 'SUCCESS:rejected')
    ]);
    expect(outcome.meta.terminal).toBe(false);
  });

  test('appendRunSummary marks export taken during active run (run 1781134505984 replay)', () => {
    const groups = {
      '<GPT>': [evt('GPT', 'MODEL_FINAL', 'SUCCESS')],
      '<Gemini>': [evt('Gemini', 'MODEL_FINAL', 'PARTIAL')],
      '<Grok>': [evt('Grok', 'MANUAL_PING_FAIL', 'unchanged')],
      '<Le Chat>': [evt('Le Chat', 'BUDGET_EXHAUSTED', '')],
      '<ROUNDS>': [evt('ROUNDS', 'ROUND0_START', 'opening tabs sequentially')]
    };
    const result = TelemetryExport.appendRunSummary(groups, { runSessionId: 1781134505984, exportedAt: 1781134749690 });
    const summary = result[TelemetryExport.RUN_SUMMARY_GROUP_KEY];
    expect(Array.isArray(summary)).toBe(true);

    const runState = summary.find((entry) => entry.label === 'RUN_EXPORT_STATE');
    expect(runState.details).toBe('export_during_active_run');
    expect(runState.meta.complete).toBe(false);
    expect(runState.meta.pendingModels.sort()).toEqual(['Grok', 'Le Chat']);
    expect(runState.meta.runSessionId).toBe(1781134505984);

    const gemini = summary.find((entry) => entry.platform === 'Gemini');
    expect(gemini.meta.finalStatus).toBe('PARTIAL');

    // Original groups stay untouched in the export payload.
    expect(result['<GPT>']).toBe(groups['<GPT>']);
  });

  test('appendRunSummary reports run_complete when all models are terminal', () => {
    const groups = {
      '<GPT>': [evt('GPT', 'MODEL_FINAL', 'SUCCESS')],
      '<Claude>': [evt('Claude', 'MODEL_FINAL', 'EXTRACT_FAILED')]
    };
    const result = TelemetryExport.appendRunSummary(groups, { runSessionId: 42 });
    const runState = result[TelemetryExport.RUN_SUMMARY_GROUP_KEY].find((entry) => entry.label === 'RUN_EXPORT_STATE');
    expect(runState.details).toBe('run_complete');
    expect(runState.meta.complete).toBe(true);
    expect(runState.meta.pendingModels).toEqual([]);
  });

  test('exports first-class release failure outcomes', () => {
    const groups = {
      '<Gemini>': [evt('Gemini', 'MODEL_FINAL', 'USER_ACTION_REQUIRED')],
      '<Grok>': [evt('Grok', 'MODEL_FINAL', 'EXTERNAL_LLM_FAILURE')],
      '<Qwen>': [evt('Qwen', 'MODEL_FINAL', 'UNCERTAIN')]
    };
    const result = TelemetryExport.appendRunSummary(groups, { runSessionId: 101 });
    const byPlatform = Object.fromEntries(result[TelemetryExport.RUN_SUMMARY_GROUP_KEY]
      .filter((entry) => entry.label === 'MODEL_OUTCOME')
      .map((entry) => [entry.platform, entry.meta.finalStatus]));
    expect(byPlatform).toEqual({
      Gemini: 'USER_ACTION_REQUIRED',
      Grok: 'EXTERNAL_LLM_FAILURE',
      Qwen: 'UNCERTAIN'
    });
  });
});

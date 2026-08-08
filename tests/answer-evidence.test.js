const AnswerEvidence = require('../shared/answer-evidence');

describe('AnswerEvidence Lite', () => {
  test('normalizes DOM snapshot evidence into a terminal-eligible contract', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'Gemini',
      text: 'Recovered answer text. '.repeat(120),
      responseMeta: { source: 'dom_snapshot_recovery' }
    });

    expect(evidence).toEqual(expect.objectContaining({
      schemaVersion: 1,
      llmName: 'Gemini',
      sourceKind: 'snapshot',
      terminalEligible: true,
      reason: 'snapshot_with_text',
      partialAllowed: false
    }));
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'SUCCESS'
    }));
  });

  test('timeout evidence with enough text is terminal-eligible partial', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'DeepSeek',
      text: 'Timeout answer text. '.repeat(8),
      responseMeta: {
        source: 'stream_watcher',
        completionReason: 'hard_timeout'
      }
    });

    expect(evidence).toEqual(expect.objectContaining({
      sourceKind: 'timeout',
      terminalEligible: true,
      reason: 'timeout_with_text',
      partialAllowed: true
    }));
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'PARTIAL'
    }));
  });

  test('API response evidence is terminal-eligible success with API source kind', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'GPT',
      text: 'Direct API answer text. '.repeat(12),
      responseMeta: {
        source: 'api',
        completionReason: 'api_response'
      }
    });

    expect(evidence).toEqual(expect.objectContaining({
      sourceKind: 'api',
      terminalEligible: true,
      reason: 'api_with_text',
      partialAllowed: false
    }));
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'SUCCESS'
    }));
  });

  test('stable text requires the larger stable threshold', () => {
    const shortStable = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(20),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stableMinChars: 1200
    });
    const longStable = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(120),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stableMinChars: 1200
    });

    expect(shortStable.terminalEligible).toBe(false);
    expect(longStable.terminalEligible).toBe(true);
    expect(longStable.reason).toBe('stable_text');
  });

  test('stable text is not terminal eligible while stop button is visible', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      text: 'Stable answer text. '.repeat(120),
      responseMeta: { source: 'deferred_finalization', completionReason: 'generation_inactive' },
      stopButtonVisible: true,
      stableMinChars: 1200
    });

    expect(evidence.terminalEligible).toBe(false);
    expect(evidence.reason).toBe('stable_text_stop_visible');
  });

  test('short snapshot is not terminal eligible without explicit terminal signal', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      text: 'Short snapshot text. '.repeat(35),
      responseMeta: { source: 'dom_snapshot_recovery' },
      snapshotTerminalMinChars: 1200
    });

    expect(evidence.length).toBeLessThan(1200);
    expect(evidence.terminalEligible).toBe(false);
    expect(evidence.reason).toBe('snapshot_text_too_short_without_terminal_signal');
  });

  test('pre-terminal materialize alone is not terminal evidence for short preserved text', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'Claude',
      text: 'Partial Claude answer. '.repeat(18),
      responseMeta: {
        source: 'preserved_pending',
        preTerminalMaterialize: true
      },
      stableMinChars: 1200
    });

    expect(evidence.length).toBeLessThan(1200);
    expect(evidence.terminalEligible).toBe(false);
    expect(evidence.reason).toBe('prefinal_materialize_without_completion_evidence');
  });
});

describe('AnswerEvidence with a typed run result', () => {
  test('an unproven run result cannot reach the caller as a plain success', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'Qwen',
      text: 'Answer text that is long enough to pass the length bar. '.repeat(8),
      responseMeta: { source: 'panel_extraction' },
      runResult: { type: 'OBSERVER_LOST', guarantee: 'BLIND', strongestEvidenceClass: 'P3' }
    });

    expect(evidence.resultType).toBe('OBSERVER_LOST');
    expect(evidence.reason).toBe('unproven_run_result_observer_lost');
    expect(evidence.partialAllowed).toBe(true);
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      finalStatus: 'PARTIAL'
    }));
  });

  test('a committed run result carries its guarantee through unchanged', () => {
    const evidence = AnswerEvidence.buildAnswerEvidence({
      llmName: 'GPT',
      text: 'Proven answer text. '.repeat(20),
      responseMeta: { source: 'panel_extraction' },
      runResult: { type: 'COMMITTED', guarantee: 'STRICT', strongestEvidenceClass: 'P0' }
    });

    expect(evidence.resultGuarantee).toBe('STRICT');
    expect(evidence.evidenceClass).toBe('P0');
    expect(evidence.partialAllowed).toBe(false);
    expect(AnswerEvidence.shouldFinalizeWithEvidence(evidence)).toEqual(expect.objectContaining({
      ok: true,
      finalStatus: 'SUCCESS'
    }));
  });
});

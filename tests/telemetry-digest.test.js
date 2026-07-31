// A full "all presets" export runs ~640KB — about 163k tokens if read whole,
// while only a dozen fields inside ledger.events have ever driven a diagnosis.
// The digest exists so an export can be discussed without carrying the rest of
// the file; these tests pin the facts it must never drop.
const { buildDigest, render } = require('../scripts/telemetry-digest.js');

const event = (seq, modelId, eventType, metadata = {}, extra = {}) => ({
  seq,
  modelId,
  eventType,
  runSessionId: extra.runSessionId || '111',
  payload: { metadata, sourceEventType: extra.sourceEventType || eventType, ...(extra.payload || {}) }
});

const doc = {
  sharedConfig: { extensionVersion: '2.81.205' },
  manifest: { createdAt: '2026-07-31T13:18:25.995Z' },
  ledger: {
    events: [
      event(1, 'Qwen', 'DISPATCH_BASELINE_CAPTURED', { signatureLength: 646, anchorAnswerCount: 15 }),
      event(2, 'Qwen', 'OBSERVATION_SLOT_RELEASED', { durationMs: 684, minUsefulMs: 1500, reason: 'automation_focus_end' }),
      event(3, 'Qwen', 'MODEL_TERMINAL_RECORDED', { finalStatus: 'SUCCESS', finalReason: 'forced_success_with_text', answerLen: 648, durationMs: 900 }),
      event(4, 'GPT', 'DISPATCH_BASELINE_CAPTURED', { signatureLength: 0 }),
      event(5, 'GPT', 'MODEL_TERMINAL_RECORDED', { finalStatus: 'SUCCESS', finalReason: 'stable_text', answerLen: 7444, durationMs: 800 }),
      event(6, 'Claude', 'SUBMIT_ACTION_OBSERVED', {}),
      { ...event(7, 'GPT', 'DECISION_RECORDED', {}), payload: { metadata: {}, sourceEventType: 'DECISION_RECORDED', rules: [
        { ruleId: 'submission_confirmed', passed: false },
        { ruleId: 'generation_not_active', passed: true }
      ] } },
      event(8, 'GPT', 'TAB_EVENT', { reason: 'no_safe_reusable_tab' }, { sourceEventType: 'TAB_ISOLATION_FALLBACK_CREATE' })
    ]
  }
};

describe('telemetry digest', () => {
  const digest = buildDigest(doc);

  test('reports the build and whether the export is one session', () => {
    expect(digest.scope.extensionVersion).toBe('2.81.205');
    expect(digest.scope.runSessions).toEqual(['111']);
    expect(digest.scope.singleSession).toBe(true);
  });

  test('a mixed-session export is flagged rather than silently averaged', () => {
    const mixed = buildDigest({
      ...doc,
      ledger: { events: [...doc.ledger.events, event(9, 'GPT', 'SUBMIT_ACTION_OBSERVED', {}, { runSessionId: '222' })] }
    });
    expect(mixed.scope.singleSession).toBe(false);
    expect(render(mixed)).toContain('RUN SESSIONS MIXED');
  });

  test('a delivered answer matching the prior page text is surfaced', () => {
    // Qwen: 646 already on the page, 648 delivered, reported SUCCESS.
    expect(digest.stale).toHaveLength(1);
    expect(digest.stale[0]).toMatchObject({ model: 'Qwen', priorTextLength: 646, answerLength: 648 });
    // GPT started from an empty page, so it is a real answer, not residue.
    expect(digest.stale.some((row) => row.model === 'GPT')).toBe(false);
  });

  test('a model that never reached a terminal is named', () => {
    expect(digest.modelsWithoutTerminal).toContain('Claude');
    expect(digest.modelsWithoutTerminal).not.toContain('GPT');
  });

  test('starved focus leases are shown against minUsefulMs', () => {
    expect(render(digest)).toContain('684ms < 1500ms');
  });

  test('failed decision rules are grouped, passing ones are not reported', () => {
    const ids = digest.blockers.map((b) => b.ruleId);
    expect(ids).toContain('submission_confirmed');
    expect(ids).not.toContain('generation_not_active');
  });

  test('a duplicate-tab creation is carried through', () => {
    expect(digest.tabs.map((t) => t.label)).toContain('TAB_ISOLATION_FALLBACK_CREATE');
  });

  test('the rendered digest stays small enough to paste', () => {
    expect(render(digest).length).toBeLessThan(4000);
  });
});

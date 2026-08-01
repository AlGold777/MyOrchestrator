// A full "all presets" export runs ~640KB — about 163k tokens if read whole,
// while only a dozen fields inside ledger.events have ever driven a diagnosis.
// The digest exists so an export can be discussed without carrying the rest of
// the file; these tests pin the facts it must never drop.
const { buildDigest, render } = require('../shared/telemetry-digest.js');

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
      event(8, 'GPT', 'TAB_EVENT', { reason: 'no_safe_reusable_tab' }, { sourceEventType: 'TAB_ISOLATION_FALLBACK_CREATE' }),
      { ...event(10, 'Qwen', 'POLICY_OVERRIDE_APPLIED', {}), payload: { metadata: {}, sourceEventType: 'POLICY_OVERRIDE_APPLIED', trigger: 'accepted_below_automatic_policy', mode: 'forced', waivedRules: ['submission_confirmed'] } },
      { ...event(11, 'Qwen', 'MISSING_EVIDENCE_RECORDED', {}), payload: { metadata: {}, sourceEventType: 'MISSING_EVIDENCE_RECORDED', missingEvidence: 'post_terminal_observation', status: 'pending', impact: 'not confirmed later' } },
      { ...event(12, 'Gemini', 'POST_TERMINAL_AUDIT_COMPLETED', {}), payload: { metadata: {}, sourceEventType: 'POST_TERMINAL_AUDIT_COMPLETED', acceptedLength: 1090, observedLength: 4316, growthChars: 3226 } }
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
    // Carrying every exception raised this from ~1.7KB to ~9KB on a real run:
    // still 1.4% of the 640KB export, and it is what removes the need to go
    // back to the JSON for a failure mode we already know how to read.
    expect(render(digest).length).toBeLessThan(40000);
  });

  test('exception events are carried, not merely counted', () => {
    const types = digest.exceptions.map((e) => e.type);
    expect(types).toContain('POLICY_OVERRIDE_APPLIED');
    expect(types).toContain('MISSING_EVIDENCE_RECORDED');
    const override = digest.exceptions.find((e) => e.type === 'POLICY_OVERRIDE_APPLIED');
    // The waived rules are the point: they say what the forced accept ignored.
    expect(override.detail).toContain('submission_confirmed');
  });

  test('a post-terminal audit shows how much answer arrived after acceptance', () => {
    const audit = digest.exceptions.find((e) => e.type === 'POST_TERMINAL_AUDIT_COMPLETED');
    expect(audit.detail).toContain('accepted=');
    expect(audit.detail).toContain('growth=');
  });

  test('only genuinely unknown event types are reported as uncovered', () => {
    // Types the digest reads or deliberately ignores must not appear here,
    // otherwise the warning cries wolf and stops being read.
    expect(digest.coverage.unknownTypes.map((u) => u.type)).not.toContain('MODEL_TERMINAL_RECORDED');
    expect(digest.coverage.unknownTypes.map((u) => u.type)).not.toContain('OBSERVER_HEALTH_INTERVAL_CLOSED');
    expect(digest.coverage.unknownTypes.map((u) => u.type)).not.toContain('POLICY_OVERRIDE_APPLIED');
  });

  test('an event type added after this digest was written is flagged', () => {
    const withNew = buildDigest({
      ...doc,
      ledger: { events: [...doc.ledger.events, event(99, 'GPT', 'SOME_FUTURE_EVENT_TYPE', {})] }
    });
    expect(withNew.coverage.unknownTypes.map((u) => u.type)).toContain('SOME_FUTURE_EVENT_TYPE');
    expect(render(withNew)).toContain('send the JSON too');
  });
});

describe('the Export button writes the digest alongside the JSON', () => {
  const fs = require('fs');
  const path = require('path');
  const DEVTOOLS = fs.readFileSync(path.join(__dirname, '..', 'results-devtools.js'), 'utf8');

  test('checked exports the digest, unchecked exports the complete report', () => {
    const branch = DEVTOOLS.slice(
      DEVTOOLS.indexOf("if (task === 'all') {"),
      DEVTOOLS.indexOf('const selectedModelId')
    );
    // The full report is built either way; only the delivered document changes.
    expect(branch).toContain('buildAllPresets(canonicalEvents, buildOptions)');
    expect(branch).toContain('digestExportEnabled() ? downloadTelemetryDigest(payload, filename) : null');
    expect(branch).toContain('if (!digest) {');
    expect(branch).toContain('downloadProofArtifact(payload, filename)');
  });

  test('the export is never left empty-handed', () => {
    const branch = DEVTOOLS.slice(
      DEVTOOLS.indexOf("if (task === 'all') {"),
      DEVTOOLS.indexOf('const selectedModelId')
    );
    // A digest that cannot be produced must still yield the full JSON, so the
    // toggle can never cost the user their export.
    const guardAt = branch.indexOf('if (!digest) {');
    const jsonAt = branch.indexOf('downloadProofArtifact(payload, filename)', guardAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(jsonAt).toBeGreaterThan(guardAt);
    expect(branch).toContain('Digest unavailable — full JSON exported');
  });

  test('the toggle defaults to on and is remembered', () => {
    const wiring = DEVTOOLS.slice(
      DEVTOOLS.indexOf('const DIGEST_TOGGLE_KEY'),
      DEVTOOLS.indexOf('const downloadTelemetryDigest')
    );
    expect(wiring).toContain("chrome.storage?.local?.get?.([DIGEST_TOGGLE_KEY]");
    expect(wiring).toContain('chrome.storage?.local?.set?.({ [DIGEST_TOGGLE_KEY]');
    // Absent element or unset preference must behave as enabled.
    expect(wiring).toContain('const digestExportEnabled = () => !digestToggle || digestToggle.checked === true;');
  });

  test('both pages carry the toggle, checked by default', () => {
    for (const page of ['result_new.html', 'pipeline_panel.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
      expect(html).toContain('id="telemetry-export-digest-toggle"');
      expect(html).toMatch(/id="telemetry-export-digest-toggle"[^>]*checked/);
    }
  });

  test('a digest failure never costs the user the export', () => {
    const helper = DEVTOOLS.slice(
      DEVTOOLS.indexOf('const downloadTelemetryDigest'),
      DEVTOOLS.indexOf('const describeSelectedIncident')
    );
    expect(helper).toContain('if (!window.TelemetryDigest?.buildDigest) return null;');
    expect(helper).toContain('catch (err)');
    expect(helper).toContain('return null;');
  });

  test('the digest lands next to its JSON, by name', () => {
    const helper = DEVTOOLS.slice(
      DEVTOOLS.indexOf('const downloadTelemetryDigest'),
      DEVTOOLS.indexOf('const describeSelectedIncident')
    );
    expect(helper).toContain(".replace(/\\.json$/i, '') + '-digest.txt'");
  });

  test('both extension pages load the shared digest module', () => {
    for (const page of ['result_new.html', 'pipeline_panel.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
      expect(html).toContain('shared/telemetry-digest.js');
    }
  });

  test('the CLI and the page share one implementation', () => {
    const cli = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'telemetry-digest.js'), 'utf8');
    expect(cli).toContain("require('../shared/telemetry-digest.js')");
    // No second copy of the logic to drift out of sync.
    expect(cli).not.toContain('function buildDigest');
  });
});

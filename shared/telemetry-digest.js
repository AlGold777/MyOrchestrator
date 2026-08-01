/**
 * Reduce a telemetry export to the facts that actually drive diagnosis.
 *
 * A full "all presets" export runs ~640KB. Roughly 46% of that is preset report
 * definitions and 9% derived views — neither carries run data. Every diagnosis
 * in practice has come from a dozen fields inside ledger.events. This prints
 * those, and nothing else, so an export can be pasted into a conversation
 * without carrying the rest of the file with it.
 *
 * Usage:
 *   node scripts/telemetry-digest.js <export.json> [--json]
 */
(function initTelemetryDigest(root) {
  'use strict';

const SECTIONS = Object.freeze({
  SCOPE: 'scope',
  MODELS: 'models',
  STALE: 'stale',
  LEASES: 'leases',
  BLOCKERS: 'blockers',
  TABS: 'tabs',
  EXCEPTIONS: 'exceptions',
  COVERAGE: 'coverage'
});

// Events that mark an exception rather than routine progress. They are rare
// precisely because of that — 36 of 295 in the run this was built against,
// against 70 OBSERVER_HEALTH_INTERVAL_CLOSED — so carrying all of them costs
// about a kilobyte and removes the need to go back to the JSON for the failure
// modes we already know about.
const EXCEPTION_TYPES = Object.freeze({
  ANSWER_DELIVERY_REJECTED: (p, m) => `${p.sourceEventType || 'rejected'} ${m.attemptId || ''}`.trim(),
  MISSING_EVIDENCE_RECORDED: (p) => `${p.missingEvidence || '?'} (${p.status || '?'}) — ${p.impact || ''}`.trim(),
  POST_TERMINAL_AUDIT_COMPLETED: (p) => `accepted=${p.acceptedLength} observed=${p.observedLength} growth=${p.growthChars}`,
  SELECTOR_FORENSIC_SNAPSHOT_CAPTURED: (p) => `${p.anomalyTrigger || '?'} available=${p.captureAvailable}${p.omissionReason ? ` — ${p.omissionReason}` : ''}`,
  POLICY_OVERRIDE_APPLIED: (p) => `${p.trigger || '?'} (${p.mode || '?'}) waived: ${(p.waivedRules || []).join(', ')}`,
  GENERATION_START_EVALUATED: (p, m) => `${(p.typed && p.typed.state) || '?'} ${m.step || ''}`.trim(),
  OBSERVATION_FRAME_CAPTURED: (p, m) => `${m.reason || '?'} status=${m.status || '?'} state=${m.state || '?'}`
});

// Types the digest deliberately reads or deliberately ignores. Anything outside
// both lists is new since this file was written, which is the one thing a
// coverage line can honestly warn about — the known gaps are now carried above.
const READ_TYPES = Object.freeze([
  'DISPATCH_BASELINE_CAPTURED', 'MODEL_TERMINAL_RECORDED', 'DECISION_RECORDED',
  'OBSERVATION_SLOT_GRANTED', 'OBSERVATION_SLOT_RELEASED', 'OBSERVATION_SLOT_DENIED'
]);
const IGNORED_TYPES = Object.freeze([
  'OBSERVER_HEALTH_INTERVAL_CLOSED', 'OBSERVER_HEALTH_OBSERVED', 'OBSERVATION_INTERVAL_CLOSED',
  'SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED', 'SUBMISSION_INFERRED',
  'ANSWER_SOURCE_MATERIALIZED', 'EXTRACTION_COMPLETED', 'ANSWER_CARD_RENDER_EVALUATED',
  'ANSWER_COMMIT_EVALUATED', 'FINALIZATION_POLICY_EVALUATED', 'PAGE_HEALTH_OBSERVED',
  'PAGE_CONTEXT_OBSERVED', 'RUN_CONFIG_RECORDED', 'CLOCK_EPOCH_STARTED'
]);

const metaOf = (event) => (event && event.payload && event.payload.metadata) || {};

function buildDigest(doc) {
  const ledger = (doc && doc.ledger) || {};
  const events = Array.isArray(ledger.events) ? [...ledger.events].sort((a, b) => a.seq - b.seq) : [];
  const sessions = [...new Set(events.map((e) => String(e.runSessionId)))];
  const baselines = new Map();
  const terminals = [];
  const leases = [];
  const failedRules = new Map();
  const tabEvents = [];
  const exceptions = [];
  const unknownTypes = new Map();

  for (const event of events) {
    const meta = metaOf(event);
    const describeException = EXCEPTION_TYPES[event.eventType];
    if (describeException) {
      let detail = '';
      try { detail = String(describeException(event.payload || {}, meta) || ''); } catch (_) { detail = ''; }
      exceptions.push({ model: event.modelId, type: event.eventType, detail });
    } else if (!READ_TYPES.includes(event.eventType) && !IGNORED_TYPES.includes(event.eventType)) {
      unknownTypes.set(event.eventType, (unknownTypes.get(event.eventType) || 0) + 1);
    }
    switch (event.eventType) {
      case 'DISPATCH_BASELINE_CAPTURED':
        baselines.set(event.modelId, {
          priorTextLength: meta.signatureLength ?? null,
          baselineState: meta.baselineState ?? null,
          anchorAnswerCount: meta.anchorAnswerCount ?? null
        });
        break;
      case 'MODEL_TERMINAL_RECORDED':
        terminals.push({
          model: event.modelId,
          status: meta.finalStatus ?? null,
          reason: meta.finalReason ?? null,
          answerLength: meta.answerLen ?? null,
          durationMs: meta.durationMs ?? null
        });
        break;
      case 'OBSERVATION_SLOT_GRANTED':
      case 'OBSERVATION_SLOT_RELEASED':
      case 'OBSERVATION_SLOT_DENIED':
        leases.push({
          model: event.modelId,
          action: event.eventType.replace('OBSERVATION_SLOT_', ''),
          source: meta.source ?? null,
          durationMs: meta.durationMs ?? null,
          minUsefulMs: meta.minUsefulMs ?? null,
          reason: meta.reason ?? null
        });
        break;
      case 'DECISION_RECORDED': {
        const rules = (event.payload && event.payload.rules) || [];
        for (const rule of rules) {
          if (rule.passed !== false) continue;
          const key = rule.ruleId;
          if (!failedRules.has(key)) failedRules.set(key, new Set());
          failedRules.get(key).add(event.modelId);
        }
        break;
      }
      default:
        break;
    }
    const label = String((event.payload && event.payload.sourceEventType) || '');
    if (/TAB_ISOLATION_FALLBACK_CREATE|SOFT_REUSE_BLOCKER_OVERRIDDEN|UNSAFE_REUSE_SKIPPED/.test(label)) {
      tabEvents.push({ model: event.modelId, label, reason: meta.reason ?? null, tabId: meta.tabId ?? null });
    }
  }

  // The stale-answer check that found the forced successes: a delivered answer
  // whose length is within a whisker of the text already on the page.
  const stale = terminals
    .map((t) => {
      const prior = baselines.get(t.model);
      const priorLength = prior ? prior.priorTextLength : null;
      const near = Number.isFinite(priorLength) && Number.isFinite(t.answerLength)
        && priorLength > 0 && Math.abs(priorLength - t.answerLength) <= 60;
      return { ...t, priorTextLength: priorLength, looksLikePriorPageText: near };
    })
    .filter((row) => row.looksLikePriorPageText);

  return {
    [SECTIONS.SCOPE]: {
      extensionVersion: (doc.sharedConfig || {}).extensionVersion || null,
      createdAt: (doc.manifest || {}).createdAt || null,
      eventCount: events.length,
      runSessions: sessions,
      singleSession: sessions.length <= 1
    },
    [SECTIONS.MODELS]: terminals,
    [SECTIONS.STALE]: stale,
    [SECTIONS.LEASES]: leases,
    [SECTIONS.BLOCKERS]: [...failedRules.entries()]
      .map(([ruleId, models]) => ({ ruleId, models: [...models].sort() }))
      .sort((a, b) => b.models.length - a.models.length),
    [SECTIONS.TABS]: tabEvents,
    [SECTIONS.EXCEPTIONS]: exceptions,
    [SECTIONS.COVERAGE]: {
      totalEvents: events.length,
      exceptionsCarried: exceptions.length,
      unknownTypes: [...unknownTypes.entries()].map(([type, count]) => ({ type, count }))
    },
    modelsWithoutTerminal: [...new Set(events.map((e) => e.modelId))]
      .filter((m) => m !== 'SYSTEM' && !terminals.some((t) => t.model === m))
      .sort()
  };
}

function render(digest) {
  const lines = [];
  const scope = digest[SECTIONS.SCOPE];
  lines.push(`version ${scope.extensionVersion} | ${scope.createdAt} | ${scope.eventCount} events`);
  lines.push(scope.singleSession
    ? `run sessions: ${scope.runSessions.join(', ') || 'none'}`
    : `RUN SESSIONS MIXED: ${scope.runSessions.join(', ')}`);
  lines.push('');

  lines.push('TERMINALS');
  for (const t of digest[SECTIONS.MODELS]) {
    lines.push(`  ${t.model.padEnd(11)} ${String(t.status).padEnd(14)} ${t.reason} · len=${t.answerLength} · ${t.durationMs}ms`);
  }
  if (digest.modelsWithoutTerminal.length) {
    lines.push(`  no terminal at all: ${digest.modelsWithoutTerminal.join(', ')}`);
  }
  lines.push('');

  if (digest[SECTIONS.STALE].length) {
    lines.push('DELIVERED ANSWER MATCHES TEXT ALREADY ON THE PAGE');
    for (const s of digest[SECTIONS.STALE]) {
      lines.push(`  ${s.model.padEnd(11)} prior=${s.priorTextLength} delivered=${s.answerLength} → ${s.status}`);
    }
    lines.push('');
  }

  const starved = digest[SECTIONS.LEASES].filter((l) => (
    l.action === 'RELEASED' && Number.isFinite(l.durationMs) && Number.isFinite(l.minUsefulMs)
    && l.durationMs < l.minUsefulMs
  ));
  if (starved.length) {
    lines.push('FOCUS LEASES BELOW minUsefulMs');
    for (const l of starved) lines.push(`  ${l.model.padEnd(11)} ${l.durationMs}ms < ${l.minUsefulMs}ms (${l.reason})`);
    lines.push('');
  }

  if (digest[SECTIONS.BLOCKERS].length) {
    lines.push('FAILED DECISION RULES');
    for (const b of digest[SECTIONS.BLOCKERS]) lines.push(`  ${b.ruleId.padEnd(36)} ${b.models.join(', ')}`);
    lines.push('');
  }

  if (digest[SECTIONS.TABS].length) {
    lines.push('TAB REUSE');
    for (const t of digest[SECTIONS.TABS]) lines.push(`  ${t.model.padEnd(11)} ${t.label} ${t.reason || ''}`);
    lines.push('');
  }

  if (digest[SECTIONS.EXCEPTIONS].length) {
    lines.push('EXCEPTIONS');
    for (const e of digest[SECTIONS.EXCEPTIONS]) {
      lines.push(`  ${String(e.model).padEnd(11)} ${e.type}${e.detail ? ` · ${e.detail}` : ''}`);
    }
    lines.push('');
  }

  const coverage = digest[SECTIONS.COVERAGE];
  if (coverage.unknownTypes.length) {
    // The known gaps are carried in EXCEPTIONS above, so this warns only about
    // event types added since this digest was written — the one case where the
    // full JSON is genuinely required to see what happened.
    lines.push('UNRECOGNISED EVENT TYPES — send the JSON too, the digest cannot read these');
    for (const u of coverage.unknownTypes) lines.push(`  ${u.type} ×${u.count}`);
    lines.push('');
  }
  return lines.join('\n');
}

const api = Object.freeze({ buildDigest, render, SECTIONS });
  root.TelemetryDigest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

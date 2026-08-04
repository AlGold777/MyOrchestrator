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
  // correlationReason is what distinguishes "arrived with the wrong id" from
  // "arrived with none" — two different defects that read identically without it.
  ANSWER_DELIVERY_REJECTED: (p, m) => [
    m.correlationReason || p.sourceEventType || 'rejected',
    m.expectedDispatchId ? `expected=${m.expectedDispatchId}` : '',
    m.incomingDispatchId ? `incoming=${m.incomingDispatchId}` : '',
    m.expectedRunSessionId ? `expectedRun=${m.expectedRunSessionId}` : '',
    m.incomingRunSessionId ? `incomingRun=${m.incomingRunSessionId}` : ''
  ].filter(Boolean).join(' '),
  // The extraction chain: a frame length that shrinks into a tiny materialised
  // answer is the signature of reading the wrong node — 131 -> 47 while the real
  // answer was 1797 (2026-08-01).
  ANSWER_SOURCE_MATERIALIZED: (p, m) => `len=${m.normalizedLength ?? '?'} source=${m.source || '?'}`,
  EXTRACTION_COMPLETED: (p, m) => `len=${m.normalizedLength ?? '?'} ${m.outcome || m.status || ''}`.trim(),
  STRUCTURAL_VERIFICATION_EVALUATED: (p, m) => `${(p.typed && p.typed.state) || m.status || '?'}`,
  CANDIDATE_SET_CHANGED: (p, m) => `count=${m.candidateCount ?? '?'} ${(p.typed && p.typed.state) || ''}`.trim(),
  CANDIDATE_IDENTITY_INFERRED: (p, m) => `${m.answerIdentity || (p.typed && p.typed.state) || '?'}`,
  GENERATION_SIGNAL_CHANGED: (p, m) => `${(p.typed && p.typed.state) || m.signal || '?'}`,
  GENERATION_STATE_INFERRED: (p) => `${(p.typed && p.typed.state) || '?'}`,
  MISSING_EVIDENCE_RECORDED: (p) => `${p.missingEvidence || '?'} (${p.status || '?'}) — ${p.impact || ''}`.trim(),
  POST_TERMINAL_AUDIT_COMPLETED: (p) => `accepted=${p.acceptedLength} observed=${p.observedLength} growth=${p.growthChars}`,
  SELECTOR_FORENSIC_SNAPSHOT_CAPTURED: (p) => `${p.anomalyTrigger || '?'} available=${p.captureAvailable}${p.omissionReason ? ` — ${p.omissionReason}` : ''}`,
  POLICY_OVERRIDE_APPLIED: (p) => `${p.trigger || '?'} (${p.mode || '?'}) waived: ${(p.waivedRules || []).join(', ')}`,
  GENERATION_START_EVALUATED: (p, m) => `${(p.typed && p.typed.state) || '?'} ${m.step || ''}`.trim(),
  OBSERVATION_FRAME_CAPTURED: (p, m) => `${m.reason || '?'} status=${m.status || '?'} state=${m.state || '?'} len=${m.textLength ?? '?'}`
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
  'ANSWER_CARD_RENDER_EVALUATED',
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
  const omittedTypes = new Map();

  for (const event of events) {
    const meta = metaOf(event);
    const describeException = EXCEPTION_TYPES[event.eventType];
    if (describeException) {
      let detail = '';
      try { detail = String(describeException(event.payload || {}, meta) || ''); } catch (_) { detail = ''; }
      exceptions.push({ model: event.modelId, type: event.eventType, detail });
    } else if (!READ_TYPES.includes(event.eventType)) {
      // Everything the digest does not turn into a fact is omitted, whether it
      // was omitted on purpose or is simply a type this file has no rule for.
      // Both matter to a reader deciding whether to ask for the full report.
      omittedTypes.set(event.eventType, (omittedTypes.get(event.eventType) || 0) + 1);
      if (!IGNORED_TYPES.includes(event.eventType)) {
        unknownTypes.set(event.eventType, (unknownTypes.get(event.eventType) || 0) + 1);
      }
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
      omittedTypes: [...omittedTypes.entries()]
        .map(([type, count]) => ({ type, count, recognised: IGNORED_TYPES.includes(type) }))
        .sort((a, b) => b.count - a.count),
      unknownTypes: [...unknownTypes.entries()].map(([type, count]) => ({ type, count }))
    },
    modelsWithoutTerminal: [...new Set(events.map((e) => e.modelId))]
      .filter((m) => m !== 'SYSTEM' && !terminals.some((t) => t.model === m))
      .sort()
  };
}

// Addressed to whatever model reads this file. A digest is lossy by
// construction, and a reader that does not know what was removed cannot tell
// the difference between "this run had no such event" and "this document does
// not carry that kind of event". State both, and say how to get the rest.
function renderReaderContract(digest) {
  const coverage = digest[SECTIONS.COVERAGE];
  const lines = [];
  lines.push('# READ THIS FIRST — instructions for the model reading this file');
  lines.push('');
  lines.push('This is a DIGEST of a telemetry report, not the report itself. It is lossy.');
  lines.push('');
  lines.push('It carries: run scope and session identity, per-model terminal status and');
  lines.push('reason, answers that match text already on the page, focus leases below');
  lines.push('minUsefulMs, failed decision rules, tab-reuse events, and every exception');
  lines.push(`event (${coverage.exceptionsCarried} of ${coverage.totalEvents} events in this run).`);
  lines.push('');
  if (coverage.omittedTypes.length) {
    lines.push('It does NOT carry these event types, present in this run:');
    for (const o of coverage.omittedTypes) {
      lines.push(`  ${o.type} ×${o.count}${o.recognised ? '' : '   [UNRECOGNISED — this digest has no rule for it]'}`);
    }
    lines.push('');
  }
  lines.push('RULE: do not infer the absence of anything from this document alone.');
  lines.push('If the question you are answering depends on any event type listed above,');
  lines.push('or the failure is not explained by the sections below, you MUST ask the');
  lines.push('user for the full report before concluding. To produce it: uncheck the');
  lines.push('`digest` checkbox next to the telemetry Export button and export again —');
  lines.push('that delivers the complete report as JSON.');
  if (coverage.unknownTypes.length) {
    lines.push('');
    lines.push('This run contains event types this digest cannot read at all, marked');
    lines.push('UNRECOGNISED above. Ask for the full report.');
  }
  lines.push('');
  lines.push('─'.repeat(70));
  lines.push('');
  return lines;
}

function render(digest) {
  const lines = renderReaderContract(digest);
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

  return lines.join('\n');
}

const api = Object.freeze({ buildDigest, render, SECTIONS });
  root.TelemetryDigest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

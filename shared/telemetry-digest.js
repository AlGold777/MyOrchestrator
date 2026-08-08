/**
 * Reduce a telemetry export to the facts that actually drive diagnosis.
 *
 * A full "all presets" export is mostly scaffolding: on a measured 20-event run
 * it was 163KB, of which 85KB was preset report prose and 61KB the dependency
 * registry, against 19KB of actual run data. This prints the facts that drive
 * diagnosis and nothing else, so an export can be pasted into a conversation
 * without carrying the rest of the file with it — 3.2MB reduces to 44KB, and
 * the 20-event run above to 2.3KB.
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
  SUBMIT: 'submit',
  BLOCKERS: 'blockers',
  TABS: 'tabs',
  EXCEPTIONS: 'exceptions',
  PROGRESS: 'progress',
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

// The seven diagnostic presets rest on 34 event types. Before this list existed
// the digest had a rule for 20 of them: eight had no rule at all and eleven were
// ignored wholesale, which left prompt-not-sent blind on 8 of its 11 types and
// prompt-not-inserted on 7 of 10 — the digest could not diagnose those classes.
//
// Rather than fourteen bespoke metadata readers guessing at field names, these
// are read through payload.typed = {kind, state}. That pair is the canonical
// fact on every schema-6 event ("prompt_insertion: inserted", "deadline:
// reached"), so one rule covers all of them and cannot drift out of sync with
// per-type metadata. tests/telemetry-digest-coverage.test.js recomputes the
// preset requirement from REPORT_EVENT_TYPES and fails if this list falls behind.
const PROGRESS_TYPES = Object.freeze([
  'PROMPT_INSERTION_EVALUATED', 'SUBMIT_ACTION_OBSERVED', 'SUBMISSION_EVIDENCE_CHANGED',
  'SUBMISSION_INFERRED', 'DISPATCH_STAGE_OBSERVED',
  'TEXT_STATE_CHANGED', 'ANSWER_COMPLETENESS_EVALUATED', 'ANSWER_CARD_RENDER_EVALUATED',
  'ANSWER_COMMIT_EVALUATED', 'ANSWER_DELIVERY_ACKNOWLEDGED', 'EXTRACTION_ATTEMPTED',
  'COMPLETION_HYPOTHESIS_EVALUATED', 'TERMINAL_DEADLINE_REACHED', 'STABILITY_INTERVAL_CLOSED',
  'FINALIZATION_POLICY_EVALUATED', 'OBSERVATION_INTERVAL_CLOSED',
  'OBSERVER_HEALTH_OBSERVED', 'OBSERVER_HEALTH_INTERVAL_CLOSED',
  'PAGE_HEALTH_OBSERVED', 'PAGE_CONTEXT_OBSERVED'
]);

// Metadata worth carrying alongside a state. Deliberately short: a state without
// its length or budget is often unusable ("deadline reached" at what budget?),
// but the rest of metadata is what makes the full report 163KB.
const PROGRESS_DETAIL_KEYS = Object.freeze([
  'reason', 'outcome', 'insertionState', 'boundaryReason', 'phase', 'status',
  'promptLength', 'composerLength', 'answerLength', 'normalizedLength',
  'budgetMs', 'heldMs', 'durationMs'
]);

const IGNORED_TYPES = Object.freeze([
  'RUN_CONFIG_RECORDED', 'CLOCK_EPOCH_STARTED'
]);

const metaOf = (event) => (event && event.payload && event.payload.metadata) || {};
const typedOf = (event) => (event && event.payload && event.payload.typed) || {};

// "prompt_insertion: inserted" — the fact, without the envelope around it.
function describeTypedState(event) {
  const typed = typedOf(event);
  const kind = typed.kind && typed.kind !== 'unknown' ? typed.kind : null;
  const state = typed.state && typed.state !== 'unknown' ? typed.state : null;
  // TEXT_STATE_CHANGED and the page observers carry typed:unknown by contract;
  // for them the source event type is the only thing that names what happened.
  const label = kind && state
    ? `${kind}:${state}`
    : String((event.payload && event.payload.sourceEventType) || event.eventType || '?');
  const meta = metaOf(event);
  const detail = PROGRESS_DETAIL_KEYS
    .filter((key) => meta[key] !== null && meta[key] !== undefined && meta[key] !== '')
    .map((key) => `${key}=${meta[key]}`);
  return { label, detail: detail.join(' ') };
}

// Dedup collapses a repeated state, but not states that alternate: a 2180-event
// run produced 1793 steps and a 104KB digest, which defeats the point. Keep the
// head (how the run started) and the tail (how it failed — failures land at the
// end), and drop the middle.
//
// The reader contract says a state absent from the trajectory did not occur.
// Dropping steps can falsify that, so any label that survives ONLY in the
// dropped middle is reported by name: the claim then stays true for every label
// the reader can actually see.
const PROGRESS_STEP_LIMIT = 60;
const PROGRESS_HEAD_STEPS = 20;

function capProgress(steps) {
  if (steps.length <= PROGRESS_STEP_LIMIT) return { steps, droppedSteps: 0, droppedOnlyLabels: [] };
  const head = steps.slice(0, PROGRESS_HEAD_STEPS);
  const tail = steps.slice(steps.length - (PROGRESS_STEP_LIMIT - PROGRESS_HEAD_STEPS));
  const dropped = steps.slice(PROGRESS_HEAD_STEPS, steps.length - tail.length);
  const kept = new Set([...head, ...tail].map((step) => step.label));
  const droppedOnlyLabels = [...new Set(dropped.map((step) => step.label))].filter((label) => !kept.has(label));
  return { steps: [...head, ...tail], droppedSteps: dropped.length, droppedOnlyLabels, dropAfterIndex: head.length };
}

function buildDigest(doc) {
  const ledger = (doc && doc.ledger) || {};
  const events = Array.isArray(ledger.events) ? [...ledger.events].sort((a, b) => a.seq - b.seq) : [];
  const sessions = [...new Set(events.map((e) => String(e.runSessionId)))];
  const baselines = new Map();
  const terminals = [];
  const leases = [];
  const failedRules = new Map();
  const submits = [];
  const tabEvents = [];
  const exceptions = [];
  const progress = new Map();
  const unknownTypes = new Map();
  const omittedTypes = new Map();

  for (const event of events) {
    const meta = metaOf(event);
    if (PROGRESS_TYPES.includes(event.eventType)) {
      // Consecutive repeats of one state carry no new fact — a heartbeat that
      // closed seventy identical intervals is one line with a count, not
      // seventy. Only a change of state is a step in the trajectory.
      const model = String(event.modelId || 'SYSTEM');
      if (!progress.has(model)) progress.set(model, []);
      const steps = progress.get(model);
      const { label, detail } = describeTypedState(event);
      const last = steps[steps.length - 1];
      if (last && last.label === label) {
        last.count += 1;
        if (detail) last.detail = detail;
        last.lastSeq = event.seq;
      } else {
        steps.push({ label, detail, count: 1, type: event.eventType, firstSeq: event.seq, lastSeq: event.seq });
      }
    }
    const describeException = EXCEPTION_TYPES[event.eventType];
    if (describeException) {
      let detail = '';
      try { detail = String(describeException(event.payload || {}, meta) || ''); } catch (_) { detail = ''; }
      exceptions.push({ model: event.modelId, type: event.eventType, detail });
    } else if (!READ_TYPES.includes(event.eventType) && !PROGRESS_TYPES.includes(event.eventType)) {
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
    // Which control actually submitted the prompt. Its canonical type
    // (SUBMISSION_EVIDENCE_CHANGED) is ignored wholesale above because most of
    // its instances are routine, but "what sent this?" is a digest-level fact:
    // it is the difference between a send that failed and one that was never
    // made, and it is the first thing asked when a run ends UNCERTAIN.
    if (label === 'PROVIDER_SUBMIT_METHOD_OBSERVED') {
      submits.push({
        model: event.modelId,
        method: meta.submitMethod || null,
        evidence: meta.submitEvidence || null,
        attempts: Array.isArray(meta.attempts) ? meta.attempts : []
      });
    }
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
    [SECTIONS.SUBMIT]: submits,
    [SECTIONS.BLOCKERS]: [...failedRules.entries()]
      .map(([ruleId, models]) => ({ ruleId, models: [...models].sort() }))
      .sort((a, b) => b.models.length - a.models.length),
    [SECTIONS.TABS]: tabEvents,
    [SECTIONS.EXCEPTIONS]: exceptions,
    [SECTIONS.PROGRESS]: [...progress.entries()]
      .map(([model, steps]) => ({ model, ...capProgress(steps) }))
      .sort((a, b) => a.model.localeCompare(b.model)),
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
  lines.push('minUsefulMs, failed decision rules, the control that submitted each');
  lines.push('prompt, tab-reuse events, and every exception');
  lines.push(`event (${coverage.exceptionsCarried} of ${coverage.totalEvents} events in this run).`);
  lines.push('');
  lines.push('It also carries the per-model PROGRESS trajectory: every change of state');
  lines.push('across prompt insertion, submission, dispatch stages, text and answer');
  lines.push('handling, completion and deadlines. Consecutive repeats of one state are');
  lines.push('collapsed to a ×count — the count is exact, the intermediate events are not');
  lines.push('carried. A state that never appears in the trajectory did not occur in this');
  lines.push('run: those types are read in full, so their absence IS evidence here.');
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

  if (digest[SECTIONS.SUBMIT].length) {
    lines.push('WHAT SUBMITTED THE PROMPT');
    for (const s of digest[SECTIONS.SUBMIT]) {
      const attempts = s.attempts.length ? ` · ${s.attempts.join(' → ')}` : '';
      lines.push(`  ${String(s.model).padEnd(11)} ${String(s.method).padEnd(14)} evidence=${s.evidence}${attempts}`);
    }
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

  if (digest[SECTIONS.PROGRESS].length) {
    lines.push('PROGRESS (state changes; ×n = consecutive repeats collapsed)');
    for (const row of digest[SECTIONS.PROGRESS]) {
      lines.push(`  ${row.model}`);
      row.steps.forEach((step, index) => {
        if (row.droppedSteps && index === row.dropAfterIndex) {
          lines.push(`    … ${row.droppedSteps} state changes omitted from the middle of this run`);
          if (row.droppedOnlyLabels.length) {
            lines.push(`      states occurring ONLY in the omitted part: ${row.droppedOnlyLabels.join(', ')}`);
          }
        }
        const repeat = step.count > 1 ? ` ×${step.count}` : '';
        lines.push(`    seq ${String(step.firstSeq).padStart(5)}  ${step.label}${repeat}${step.detail ? ` · ${step.detail}` : ''}`);
      });
    }
    lines.push('');
  }

  return lines.join('\n');
}

const api = Object.freeze({ buildDigest, render, SECTIONS });
  root.TelemetryDigest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

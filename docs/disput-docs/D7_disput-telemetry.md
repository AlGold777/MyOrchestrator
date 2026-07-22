# D7. Disput telemetry contract

This document is the normative owner for Debate/Disput observability, the
Disput DevTools tab, machine-readable trace data and Disput MD/JSON exports.
Protocol behavior remains owned by the topology specifications; general model
tab delivery remains owned by `model-tabs-architecture.md`.

## Objective

One Disput report must be sufficient to reconstruct the selected execution
plan, actual stage order, participant state, waits, retries, recovery,
correlation rejections, terminal decisions and the reason for the final health
classification. `All Logs` remains a supplemental low-level runtime export and
must not be required to diagnose a Debate run.

Telemetry is observational. It cannot dispatch, advance, pause, recover or
finalize a run. `DebateRunStore`, the protocol FSMs and background model state
remain authoritative for behavior; trace data is an append-only projection of
their decisions.

## Ownership

| Fact | Owner |
|---|---|
| Expected stages and policies | immutable `DebateExecutionPlan` |
| Protocol and aggregate status | protocol FSMs and `DebateRunStore` |
| Browser delivery/model terminal decision | background runtime |
| Observed facts | `DebateTraceStore` |
| Health, plan/fact and diagnoses | `DebateTraceProjections` |
| Presentation and filters | Disput tab renderer |
| MD/JSON serialization | the same trace projections used by the UI |

No Disput UI component may infer protocol success from DOM cards, non-empty
text or a green visual state.

## Correlation chain

Every event after run start carries the known portion of this chain:

```text
debateRunId
  -> planId
    -> stageId
      -> stageAttemptId
        -> pipelineRunId
          -> pipelineRoundId
            -> pipelineBatchId
              -> dispatchId
                -> tabId/sessionId
```

`debateRunId` is created once and survives all participant waves, service
stages, final words, synthesis, retries and MV3 worker restarts. Background
receives topology-neutral correlation metadata and must not interpret stage
roles or Debate semantics. Missing or inferred correlation is retained with
`correlationQuality: exact|partial|inferred`, never silently promoted to exact.

At the response-acceptance boundary, `pipelineRunId`, `pipelineStageId` and
`stageAttemptId` are mandatory and compared exactly. A missing field is a
correlation rejection, not a wildcard. Collection and acceptance are separate
events: transport emits `MODEL_RESPONSE_RECEIVED` with `accepted:false`, while
only an acceptance point may emit the same identity with `accepted:true`. The
accepted-attempt ledger survives serialize/hydrate and rejects a different
attempt for the same `stageId:participant` key.

## Event schema

The schema uses a small envelope and an event-specific payload:

```text
schemaVersion, eventId, eventType, source, severity,
sourceTimestamp, receivedAt, receivedSeq, reasonCode,
correlation, causality, payload, provenance
```

`receivedSeq`, assigned by the collector, is the canonical ordering key.
Source timestamps are presentation/evidence data. A source-local monotonic
offset may measure a local operation but is never used to order different page,
content and background contexts.

`correlation` contains only identity fields. `causality` contains
`parentEventId`, `causedByEventId`, and `relatedEventIds`. Payload validation is
selected by `eventType`; unrelated nullable fields are not added to the base
envelope.

Core event families:

- run/plan: `RUN_CREATED`, `PLAN_COMPILED`, `PLAN_VALIDATION_FAILED`,
  `RUN_STARTED`, `RUN_PAUSED`, `RUN_RESUMED`, `RUN_CANCELLED`, `RUN_COMPLETED`,
  `RUN_FAILED`;
- stage: `STAGE_SCHEDULED`, `STAGE_STARTED`, `STAGE_COMPLETED`, `STAGE_FAILED`,
  `STAGE_SKIPPED`, `STAGE_ARTIFACT_PRODUCED`;
- barrier: `BARRIER_OPENED`, `BARRIER_PARTICIPANT_READY`,
  `BARRIER_PARTICIPANT_FAILED`, `BARRIER_WAITING`, `BARRIER_RELEASED`,
  `BARRIER_TIMEOUT`;
- dispatch: `DISPATCH_CREATED`, `TAB_ACQUIRED`, `COMPOSER_READY`,
  `PROMPT_INSERTED`, `SUBMIT_ATTEMPTED`, `SUBMIT_CONFIRMED`, `SUBMIT_REJECTED`,
  `SUBMIT_TIMEOUT`, `GENERATION_OBSERVED`, `FRESH_ANSWER_OBSERVED`,
  `TEXT_STABLE`, `COMPLETION_DETECTED`, `ANSWER_COLLECTED`, `ANSWER_REJECTED`,
  `MODEL_TERMINAL_COMMITTED`;
- recovery: `RECOVERY_REQUIRED`, `RECOVERY_ATTEMPT_STARTED`,
  `RECOVERY_ATTEMPT_FAILED`, `RECOVERY_ATTEMPT_SUCCEEDED`,
  `MANUAL_RECOVERY_REQUESTED`, `TERMINAL_FAILURE_UPGRADED`,
  `STABLE_TEXT_FALLBACK_USED`, `DROPOUT_DECISION_REQUESTED`,
  `DROPOUT_CONTINUE_SELECTED`, `DROPOUT_STOP_SELECTED`;
- integrity: `STATE_DIVERGENCE`, `STALE_EVENT_REJECTED`,
  `CORRELATION_REJECTED`, `DUPLICATE_FINAL_REJECTED`,
  `UNEXPECTED_STAGE_TRANSITION`, `MISSING_REQUIRED_ARTIFACT`,
  `UI_PROJECTION_FAILED`, `TAB_OWNERSHIP_VIOLATION`, `PLAN_ACTUAL_MISMATCH`.
- epistemic runtime: `PROMPT_COMPILED`, `STATE_DELTA_PROPOSED`,
  `STATE_DELTA_APPLIED`, `STATE_DELTA_REJECTED`, `HUMAN_DECISION_RECORDED`;
- rules and decisions: `DECISION_REQUESTED`, `DECISION_RESOLVED`,
  `RULE_EVALUATED`, `RULE_FIRED`, `RULE_SUPPRESSED`,
  `PROGRESS_WINDOW_UPDATED`;
- diagnostic model service block: `MODEL_SIGNAL_OBSERVED`,
  `MODEL_SIGNAL_INVALID`. Эти события всегда имеют `shadow:true` и не являются
  доказательством изменения дела.

`STAGE_SKIPPED` always has a stable protocol-level reason code such as
`PARTICIPANT_DROPPED`, `ARTIFACT_REUSED`, `PLAN_BRANCH`, `USER_OVERRIDE` or
`RUN_CANCELLED`. A provider/model diagnostic such as
`PARTICIPANT_ALREADY_TERMINAL` does not by itself skip the protocol stage and
is adapted as `LEGACY_DIAGNOSTIC_EVENT`.

Context compaction emits `LEGACY_DIAGNOSTIC_EVENT` with
`reasonCode=context_budget_exceeded`, total and overflow character counts.
Registry checkpoint parsing emits `ANSWER_REJECTED` with
`reasonCode=checkpoint_parse_failed`. ProcessAudit consumes protocol stage
evidence and never promotes provider-level labels into stage completion.

Legacy stage, lifecycle and diagnostic events are adapted rather than copied as
unstructured notes. Adapted events include `provenance: legacy_adapter` and
explicit correlation quality.

## Privacy boundary

Redaction is enforced on entry to the trace store. The store removes secret,
credential, cookie, authorization, raw prompt, raw answer and raw DOM/HTML
fields even when an emitter supplies them accidentally. Diagnostic evidence may
contain fingerprints, lengths, selector categories, reason codes, boolean
evidence and a short sanitized excerpt. Exports apply a second redaction pass.

## Storage and MV3

Events enter an in-memory buffer and are persisted in batches. Terminal,
failure, recovery-result, divergence, correlation-rejection, dropout and final
synthesis events request an immediate flush. Storage is bounded per run and by
retained run count; critical events are retained before noisy selector samples.
The persisted record stores the last `receivedSeq`, so a restarted collector
continues ordering without rewriting history. Duplicate `eventId` values are
ignored and reported by integrity projections.

## Deterministic health

Protocol outcome and diagnostic health are separate fields:

| Condition | Health |
|---|---|
| explicit user cancellation | `cancelled` |
| required terminal stage unreachable/incomplete | `incomplete` |
| required stage failed | `failed` |
| required participant lost but final artifact exists | `partial_success` |
| completed with manual recovery, forced completion, divergence or unresolved high diagnostic | `degraded_success` |
| complete plan with no warning/high diagnoses | `success` |

Precedence is the order above. The classifier is a pure function and every
non-success result lists evidence event IDs. UI text does not participate.

## Machine-first report

JSON is the canonical export and contains:

```text
metadata, plan, runOutcome, health, diagnoses,
stageExecutions, participantExecutions, barriers, dispatchAttempts,
recoveryAttempts, stateDivergences, artifacts, events, integrity
```

Each diagnosis contains `code`, `severity`, `confidence`, affected component,
stage and participant, evidence event IDs, first/resolved timestamps,
resolution and user impact. Each expected stage contains expected/actual data
and deviations. `integrity` exposes sequence gaps, duplicate IDs,
uncorrelated events, missing required stage/terminal events, clock warnings,
redacted field count and schema errors.

Markdown is derived from the same report and may shorten display text. JSON
does not truncate structured diagnostic fields.

## Disput tab

The Disput tab is the primary Debate diagnostic surface, in this order:

1. Run Health Summary: topology, preset, duration, outcome, health and counts.
2. Problems / Recovery Ledger ordered by severity and lost time.
3. Plan vs Actual stage table with duration, participants and deviations.
4. Participant Matrix with submit, completion, recovery and final status.
5. Critical Path / Barrier Waits.
6. Correlation and raw events, filterable by stage, model, type and severity.

During a live run it shows the active/next stage, ready/pending participants,
current barrier duration and recovery strategy. Rendering subscribes to the
trace store; it does not poll or reinterpret DOM runtime state.

### State map UI and export

The collapsible state-map block is an epistemic projection next to this
operational telemetry, not a replacement for it. Its summary contains case,
profile, current stage, readiness, blocker count and TechnicalStatus. Structure
and Graf share run, snapshot, filter, search and focus state. A–B comparison
lists every added, changed and removed artifact without a silent display cap.
Drawer provenance may navigate to the corresponding turn when that turn exists
in the loaded feed.

Страница History карты читает rule/decision/progress/model-signal события из
RunStore и агрегированную историю завершённых runs. Она не смешивает их с
operational health: transport failure остаётся в Disput telemetry, а
содержательная стагнация — в progress window.

Map JSON and case JSON are separate exports. Map export is a deterministic,
read-only projection suitable for inspection; case export is the restorable
versioned source with artifacts, changes and snapshots. Neither export changes
runtime state. Imported cases pass schema and reference validation before
storage. Feature-flag audit records only time, flag name and boolean value;
prompt, answer, artifact text and user content are forbidden in this audit.

## Acceptance

For the recorded Triad Red Team case from 2026-07-13 a single report must show:

- Triad Red Team, Qwen/DeepSeek/Le Chat participants and Claude service model;
- every participant/filter/final/synthesis stage with actual duration;
- Qwen invalid-candidate retries and manual recovery;
- DeepSeek premature `EXTRACT_FAILED`, recovered 7306-character answer and
  state divergence;
- Le Chat stuck busy evidence and stable-text forced completion;
- rejected stale DeepSeek dispatch and UI projection failures;
- an explicit warning for the conflicting final-word skip/result sequence;
- `degraded_success`, its evidence, critical stage and critical participant;
- no missing R0-R4 solely because the final background batch used a different
  numeric run session.

Unit tests cover schema/redaction, store ordering/deduplication/persistence,
health rules, plan/fact and diagnosis projections. Contract tests cover every
runner and background correlation. UI/export parity tests assert the same stage
count, health and evidence. End-to-end acceptance covers Duel, Triad and Multi,
including retry, manual recovery, dropout, cancel and MV3 restart.

## Migration

Existing `DebateRunStore` stage events and background lifecycle diagnostics are
adapted first. New instrumentation fills evidence gaps without changing runtime
decisions. The new collector initially operates in observational shadow mode.
Once all topology and recovery paths are covered, `serialDebateTimeline` and
the latest-background-run telemetry merge cease to be export sources and remain
only compatibility projections until removed.

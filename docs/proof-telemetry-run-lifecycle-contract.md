# Proof Telemetry Run Lifecycle Contract

**Contract version:** 1.0  
**Status:** normative  
**Date:** 2026-08-28

## 1. Purpose

This contract defines how proof telemetry opens, admits events into, closes,
recovers and supersedes runs without consulting wall-clock time and without
mutating canonical history. The lifecycle journal is the source of truth;
manifests, active pointers, indexes and staging buffers are projections.

## 2. Identity and ordering

1. `runSessionId` identifies a run and MUST NOT encode ordering.
2. `runGeneration` is strictly increasing and assigned by the sole background
   writer.
3. A persisted `RUN_OPEN_INTENT` reserves a generation forever.
4. The next generation is one greater than the maximum generation in every
   lifecycle event, including an intent that never opened.
5. `ingestSeq` is globally increasing. Gaps are allowed; reuse is forbidden.
6. `eventId` is independent of `ingestSeq` and collision-resistant.
7. `wallTs` is external-correlation metadata only and MUST NOT decide lifecycle
   admission, ordering, supersession or recovery.

## 3. States and events

```text
closed -> opening -> active -> closing -> closed
```

Normative events:

1. `RUN_OPEN_INTENT` reserves `{runSessionId, runGeneration, intentId,
   predecessorRunId}`.
2. `RUN_OPENED` activates the matching intent.
3. `RUN_OPEN_ABANDONED` explains why an unopened intent was abandoned.
4. `RUN_SUPERSESSION_REQUESTED` links an active run to a newer intent.
5. `RUN_CLOSE_INTENT` enters `closing`.
6. `RUN_CLOSED` closes the run and records whether completeness is known.

Allowed close reasons are `normal`, `superseded`, `recovered_after_crash` and
`quota_failure`. Only one run may be active. An opened run is closed or
superseded; it is never reclassified as abandoned.

## 4. Pending, quarantine and unattributed evidence

Admission uses an authoritative `(runSessionId, runGeneration)` mapping.

- An active identity enters the active ledger.
- A known opening intent enters bounded `pending`.
- An older or closed generation enters that run's `quarantine`.
- An identity without an authoritative mapping enters bounded `unattributed`.

Promotion from pending occurs only after `RUN_OPENED` and preserves ingestion
order. Eviction or expiration produces a durable loss marker at the first
subsequent successful write.

Pre-run lifecycle and loss records use a segmented global journal. Closed
segments are immutable; only its bounded tail and derived manifest are mutable.
This avoids claiming that one structure is both bounded and infinitely
append-only.

## 5. Crash and quota recovery

1. An intent without `RUN_OPENED` remains a burned generation. Recovery SHOULD
   append `RUN_OPEN_ABANDONED`, but uniqueness does not depend on it.
2. `RUN_CLOSE_INTENT` without `RUN_CLOSED` recovers as
   `recovered_after_crash` with `completenessKnown=false`.
3. Restart during an active run resumes it and closes open observation
   intervals with `observer_restart` and degraded coverage.
4. Failure to persist `RUN_OPENED` means the run never became active.
5. Closed chunks remain immutable. Late evidence is stored separately and
   referenced through quarantine indexes.

## 6. Invariants

1. **R01:** generations never repeat, including abandoned intents.
2. **R02:** at most one run is active.
3. **R03:** model events enter a run only on exact authoritative identity match.
4. **R04:** bounded staging never loses evidence silently.
5. **R05:** closed chunks are immutable.
6. **R06:** lifecycle transitions are append-only events.
7. **R07:** lifecycle decisions do not read `wallTs`.
8. **R08:** manifests declare `derivedThroughSeq`; the journal wins on conflict.
9. **R09:** opened runs are closed/superseded, never abandoned.
10. **R10:** promoted pending events retain ingestion order and provenance.

## 7. Prohibited conclusions

- A recovered close does not prove model completion.
- Pending loss means pre-open evidence coverage is unknown.
- Non-empty quarantine means later-attributed evidence exists outside the
  closed core ledger.
- Different generations cannot be ordered by `wallTs`.
- Unattributed evidence cannot participate in automatic finalization proof.

## 8. Required tests

1. Property: arbitrary lifecycle interleavings never yield two active runs or a
   repeated generation.
2. Property: changing `wallTs` does not alter lifecycle decisions.
3. Property: staging bounds never cause silent loss.
4. Regression: pre-open evidence promotes after matching `RUN_OPENED`.
5. Regression: a late old-run event with a fresh receive timestamp is
   quarantined without changing the active run.
6. Regression: concurrent intents serialize deterministically.
7. Regression: crash between intent/open burns the generation.
8. Regression: crash in closing produces an incomplete recovered close.
9. Regression: restart closes open observation intervals as degraded.
10. Regression: quota failure cannot create a partially active run.


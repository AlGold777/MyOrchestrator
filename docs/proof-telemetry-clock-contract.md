# Proof Telemetry Clock Contract

**Contract version:** 1.0  
**Target event schema:** 6  
**Status:** normative  
**Date:** 2026-08-28

## 1. Purpose

This contract separates canonical order from duration evidence across multiple
content scripts, documents, frames and restartable MV3 workers. No causal or
temporal conclusion may be derived from `wallTs`.

## 2. Canonical order

The sole background writer orders events by `(runGeneration, ingestSeq)`.
Producer sequence detects gaps and reordering but cannot replace `ingestSeq`.
No time value determines canonical order.

## 3. Clock epochs

A clock epoch is the maximum interval in which one producer's monotonic clock
is continuous and comparable. Producer creation, reload, reinjection, worker
restart, discard/restore and independent frame initialization start new epochs.

`clockEpochId` is collision-resistant random identity, not time, URL or tab ID.
Boundaries are append-only `CLOCK_EPOCH_STARTED` and `CLOCK_EPOCH_CLOSED`
events. A predecessor may be declared when known.

## 4. Schema 6 clock evidence

Schema 6 adds a typed `clock` block while preserving `wallTs` only for external
correlation:

```json
{
  "clock": {
    "contractVersion": "1.0",
    "producerEpochId": "cs-a91f:1",
    "producerSequence": 42,
    "observedAtLocalMonoMs": 8421.3,
    "sentAtLocalMonoMs": 8433.7,
    "originKind": "document",
    "ingestEpochId": "sw-77c2:3",
    "ingestMonoMs": 15208.1
  }
}
```

Schema 6 analyzers MUST NOT use legacy `monoMs` for durations. Atomic frames
also contain `checkedAtLocalMonoMs` for every signal. `maximumSignalSkewMs` is
the range between signal check times; observation-to-send delay is a separate
transport metric.

## 5. Comparing clock points

`compareClockPoints(left, right)` returns:

- `exact` with a scalar inside one producer epoch;
- `bounded` with `[lowerBoundMs, upperBoundMs]` when a validated bridge exists;
- `unavailable` with a reason.

Reliability belongs to a comparison, not globally to an event. Thresholds are
tri-state:

```text
lowerBound >= threshold -> true
upperBound < threshold  -> false
otherwise               -> unknown
```

`unknown` never satisfies automatic finalization.

## 6. Observation coverage

Timer throttling and sparse polling degrade observation coverage, not the
monotonic clock itself. Exact local duration does not prove continuous
observation, and degraded coverage does not make local timestamps
non-monotonic.

## 7. Invariants

1. **C01:** canonical order is independent of every clock.
2. **C02:** exact scalar duration requires one producer epoch.
3. **C03:** cross-epoch duration is bounded or unavailable.
4. **C04:** `wallTs` does not contribute to a derived numerical/policy field.
5. **C05:** clockless legacy evidence is orderable but cannot satisfy a
   duration-dependent automatic proof.
6. **C06:** epoch boundaries are canonical events.
7. **C07:** uncertain thresholds use tri-state evaluation.
8. **C08:** signal skew uses per-signal check timestamps.
9. **C09:** artifact hash may include `wallTs`; semantic-derived hash excludes
   external-correlation timestamps.
10. **C10:** out-of-order producer events become anomalies, not silent reorder.

## 8. Prohibited conclusions

- No scalar duration crosses an epoch without a validated bridge.
- No exact latency comparison is made between different model tabs.
- No stability window crosses a worker restart.
- No timeout is proven from an unavailable comparison.
- `absent` is not strong evidence without a fresh reliable signal check.
- A producer sequence gap is not absence of events.

## 9. Required tests

1. Property: changing `wallTs` while preserving order and typed clock evidence
   leaves axes, summary, tier and semantic hash unchanged; artifact hash may
   change.
2. Property: same-epoch duration is exact.
3. Property: cross-epoch comparison is bounded or unavailable.
4. Property: tri-state thresholds use interval bounds correctly.
5. Regression: worker restart blocks cross-restart timeout/stability proof.
6. Regression: reload/reinjection creates a new producer epoch.
7. Regression: iframe producers have independent epochs.
8. Regression: clockless evidence cannot prove a duration.
9. Regression: throttling degrades coverage without corrupting local clocks.
10. Regression: transport reordering produces an anomaly.


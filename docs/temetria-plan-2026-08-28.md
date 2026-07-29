# Finish plan: incident-oriented proof telemetry

**Date:** 2026-08-28  
**Primary metric:** maximum independently verifiable evidence completeness for
one concrete incident. Compactness comes only from removing redundancy,
rebuildable representation and evidence unrelated to that incident.

The `Done` marker is applied only after implementation, tests, documentation
and the required stage commit are complete.

## 1. Normative contracts

1.1. Publish the Run Lifecycle Contract. - Done

1.2. Publish the Clock Contract. - Done

1.3. Publish this numbered implementation plan and completion gates. - Done

## 2. Safety containment

2.1. Prevent mismatched or late-run events from resetting the active ledger. - Done

2.2. Add bounded pending, quarantine and explicit detected-loss records. - Done

2.3. Remove generic completion-plus-verification promotion to T3; require a
strong transition and current-dispatch identity. - Done

2.4. Remove standalone replay/schema attestation derived from hidden events. - Done

2.5. Make standalone output conform to its JSON Schema. - Done

2.6. Preserve applicable SYSTEM context under an explicit Platform filter. - Done

2.7. Unify signal-skew thresholds and replace optimistic observation defaults
with unknown/degraded values. - Done

2.8. Add containment regressions and update version/documentation. - Done

## 3. Executable contracts and schema 6

3.1. Create one executable report registry with typed evidence slots,
criticality and sibling rules for all eight tasks. - Done

3.2. Add schema 6 event payload and clock definitions. - Done

3.3. Add typed accessors for submission, candidate identity, generation,
completion, extraction and terminal facts. - Done

3.4. Make policy consume typed state rather than regex over legacy labels. - Done

3.5. Enforce strict run/model/dispatch/generation scope compatibility. - Done

3.6. Add registry/schema/policy conformance tests and update version/docs. - Done

## 4. Run lifecycle and clock runtime

4.1. Implement append-only lifecycle events and non-reused run generations. - Done

4.2. Implement deterministic pending promotion, quarantine and worker-restart
recovery. - Done

4.3. Implement collision-resistant event IDs and global ingestion ordering. - Done

4.4. Implement producer/background clock epochs and comparison helpers. - Done

4.5. Record per-signal check times, delivery delay and independent observation
coverage. - Done

4.6. Close observation intervals on restart/navigation with degraded coverage. - Done

4.7. Add lifecycle/clock property and recovery tests; update version/docs. - Done

## 5. Typed transition emission

5.1. Isolate legacy label mapping in one migration adapter. - Done

5.2. Emit typed canonical facts from runtime producers where available. - Done

5.3. Suppress no-op observations by incident/signal state instead of the last
global event. - Done

5.4. Add immutable `OBSERVATION_INTERVAL_CLOSED` summaries and rare heartbeats. - Done

5.5. Emit inference companions only when inferred state changes. - Done

5.6. Remove envelope/static fields duplicated inside payload metadata. - Done

5.7. Add interleaved polling, mutation and restart tests; update version/docs. - Done

## 6. Incident index and evidence graph

6.1. Index incidents by run/model/dispatch/generation/candidate and navigation
lineage. - Done

6.2. Implement deterministic Platform + Task selection and record its reason
and other matching incidents. - Done

6.3. Resolve critical, required, conditional and corroborating evidence slots. - Done

6.4. Build causal/correlation/evidence closure with SYSTEM context,
decision/terminal lineage, contradictions and audit evidence. - Done

6.5. Attach `includedFor` provenance to every materialized event. - Done

6.6. Reject cross-dispatch, cross-generation and unproved navigation mixing. - Done

6.7. Add complete/bounded/insufficient and multi-incident tests; update
version/docs. - Done

## 7. Standalone and All-presets builders

7.1. Replace standalone-through-All-presets with a dedicated incident pipeline. - Done

7.2. Compute every state axis, summary and replay only from materialized closure. - Done

7.3. Add per-field `derivedFromEventIds` and derivation versions. - Done

7.4. Compute typed sufficiency, missing evidence, safe conclusions and blocked
conclusions from evidence slots. - Done

7.5. Evaluate the normative sibling registry and anti-loop policy. - Done

7.6. Compose All-presets from one shared ledger/attachment store and embedded
event references without duplicated events. - Done

7.7. Add artifact/semantic hashes and size-category accounting. - Done

7.8. Add all-eight-report replay-equivalence tests; update version/docs. - Done

## 8. Strict validator and representation optimizer

8.1. Validate report/container/event JSON Schemas. - Done

8.2. Validate lifecycle, clock, scope and S01-S20 invariants. - Done

8.3. Rebuild derived fields and summary from materialized events and compare
semantic hashes. - Done

8.4. Validate evidence slots, `includedFor`, registry hash, siblings,
attachments and privacy. - Done

8.5. Apply overflow strategy only after sufficiency: remove rebuildable detail,
deduplicate static context, externalize optional attachments and compress. - Done

8.6. Preserve core evidence and report explicit oversized/externalized status. - Done

8.7. Add tampering, overflow and minimality tests; update version/docs. - Done

## 9. Segmented persistence

9.1. Add IndexedDB stores for lifecycle, canonical events, incidents,
quarantine and attachments. - Done

9.2. Keep only the active pointer, compact manifest and feature flags in
`chrome.storage.local`. - Done

9.3. Implement transactional append, indexes and incident-range reads. - Done

9.4. Implement crash/index recovery and quota-failure behavior. - Done

9.5. Make snapshots read only the records required by the selected run/incident. - Done

9.6. Add restart, durability and bounded-write tests; update version/docs. - Done

## 10. UI, cutover and final gate

10.1. Keep exactly Platform and Tasks; show the selected incident, selection
reason and other-match count without a third filter. - Done

10.2. Export separate isolated reports when multiple matching incidents are
requested. - Done

10.3. Add feature-flagged shadow comparison against the previous builder. - Done

10.4. Run the scenario corpus and representative comparison runs. - Done

10.5. Cut over to incident builder/persistence and remove the legacy proof path. - Done

10.6. Synchronize versions, changelog, telemetry and project documentation. - Done

10.7. Run the complete regression gate, verify tag recoverability and mark
every plan item Done. - Done

## 11. Final acceptance metrics

11.1. Every report identifies exactly one incident scope. - Done

11.2. Every available critical/required slot is included or explicitly marked
unavailable with impact. - Done

11.3. Every derived reference resolves inside standalone materialized events. - Done

11.4. Standalone replay reproduces recorded state and summary. - Done

11.5. Every included event has at least one `includedFor` reason. - Done

11.6. No cross-dispatch or cross-generation contamination exists. - Done

11.7. No no-op polling or duplicated static context is persisted. - Done

11.8. Uncertain clocks, missing observation and degraded coverage never become
strong absence or automatic completion proof. - Done

11.9. Core evidence is never removed solely to satisfy a size target. - Done

11.10. JSON Schema, invariants, replay, registry, privacy and hashes validate. - Done

11.11. Late events, restarts and quota failures do not destroy active evidence. - Done

11.12. Exactly two telemetry filters remain in both result surfaces. - Done

## Completion evidence

- Full regression gate: 184 suites / 1244 tests passed.
- Focused final acceptance gate covers isolated incident scope, closure replay,
  provenance, missing-observation policy, preserved core evidence and both UI
  surfaces.
- Final recoverability tag: `gate-proof-telemetry-complete-v2.81.140`.

## 12. Post-cutover corrections

12.1. Allow every Task to export an explicit insufficient report when the
selected incident has zero matching task event types. - Done

12.2. Populate Platform from the supported catalog plus selected and observed
Schema 6 platforms instead of restricting it to active models. - Done

12.3. Add zero-evidence task export and complete-platform-list regressions;
update version/docs. - Done

## 13. Semantic-size correction

13.1. Stop catch-all wrapping of unknown legacy events as observer health. - Done

13.2. Route known proof facts, repeating operational signals and unknown debug
events into canonical, interval and bounded-debug stores respectively. - Done

13.3. Aggregate polling/recovery families into immutable interval summaries
with count, monotonic bounds and distinct reasons. - Done

13.4. Remove repeated taxonomy/version/projection metadata and unavailable
clock fields without removing proof-bearing metrics. - Done

13.5. Replace repeated All-presets UUID indexes with compact event sequence
indexes while preserving standalone event IDs. - Done

13.6. Report unavoidable overflow explicitly as `oversized_preserved_core`. - Done

13.7. Add a quantitative polling/noise regression and update version/docs. - Done

13.8. Run the complete regression gate after canonical-ingress cutover. - Done

Section 13 evidence: 635 operational/debug inputs produce fewer than 20
canonical events and a sub-100 KB proof snapshot; full gate passes 184 suites /
1249 tests.

## 14. User-question preset catalog

14.1. Replace the eight implementation-oriented Tasks with the six approved
user diagnoses: Cutted, False success, Old answer, Empty, Prompt not sent and
Late end. - Done

14.2. Merge true-completion, forced-success and forced-finalization evidence
into one False success contract without removing their proof-bearing event
families. - Done

14.3. Split extraction diagnosis into Old answer for wrong-turn identity and
Empty for empty/wrong-node extraction. - Done

14.4. Narrow Cutted to SUCCESS with incomplete captured text and rename request
not sent to Prompt not sent. - Done

14.5. Add Late end evidence slots and the derived `stableToTerminalMs` interval
from the last stability boundary to terminal recording. - Done

14.6. Replace the Task catalog in both Telemetry surfaces while retaining
exactly Platform and Tasks filters. - Done

14.7. Synchronize the executable registry, sibling rules, offline validator,
schemas/examples generator and six validated standalone examples. - Done

14.8. Update manifest/package version and the existing project, telemetry,
specification, changelog and plan documentation. - Done

14.9. Run focused artifact validation and the complete regression gate. - Done

Section 14 evidence: All tasks and all six generated standalone examples pass
the offline validator; full gate passes 184 suites / 1250 tests. Runtime writes
remain a single canonical segmented ledger, with All tasks and standalone Tasks
implemented as export projections.

## 15. Semantic applicability review of user presets

### Review findings

15.1. Separate evidence availability from proof that the selected problem
actually occurred. A report can have every event family present and still be
about a normal run. - Done

15.2. Cutted currently accepts any terminal/decision and any text event; it
does not require SUCCESS plus positive incomplete-capture evidence. - Done

15.3. False success currently accepts text activity anywhere in the incident;
it does not require measured growth after the SUCCESS terminal boundary. - Done

15.4. Old answer currently treats the presence of candidate identity evidence
as sufficient; a confirmed current-dispatch candidate can therefore satisfy
the same slots as an old candidate. - Done

15.5. Empty currently proves only that generation and extraction events both
exist; it does not prove that observed generated text was non-empty while the
extracted result was empty or failed. - Done

15.6. Prompt not sent currently accepts a confirmed submission event as slot
coverage; it does not distinguish failed/not-confirmed submission from unknown
observation. - Done

15.7. Late end currently subtracts wall timestamps and clamps reversed values
to zero; it does not prove clock comparability or preserve an unknown delay. - Done

15.8. Sibling rules currently use negative/unknown values such as
`answerIdentity != current_dispatch`, which can request another diagnosis from
missing evidence rather than positive anomaly evidence. - Done

### Change plan

15.9. Add executable per-preset applicability predicates with tri-state
`confirmed`, `not_confirmed`, and `unknown` outcomes. - Done

15.10. Add positive derived proof facts for terminal SUCCESS, extracted length,
incomplete capture, post-terminal growth, old-answer identity, empty extraction
after observed generation, failed submission, and comparable stability delay. - Done

15.11. Make standalone and embedded reports expose applicability independently
from evidence-slot sufficiency. - Done

15.12. Replace sibling predicates with positive anomaly facts and prevent
unknown values from matching ordinary comparison operators. - Done

15.13. Extend the offline validator to replay applicability and reject stale
or contradictory recorded applicability. - Done

15.14. Add normal-run negative controls and positive semantic scenarios for
all six presets, including incomparable clocks for Late end. - Done

15.15. Regenerate and independently validate All tasks plus all six standalone
examples. - Done

15.16. Synchronize specification, telemetry documentation, changelog, project
version and final acceptance evidence. - Done

Section 15 evidence: All tasks and all six standalone examples pass schema,
hash, replay, registry, slot and applicability validation. Six positive and six
normal/unknown semantic controls cover the user questions, including old-answer
dispatch mismatch and incomparable Late end clocks. Full gate passes 185 suites
/ 1258 tests.

## 16. Incident-scoped semantic hardening

16.1. Preserve the independent semantic review and record corrections that
reject arbitrary size/time targets and false diagnosis exclusivity. - Done

16.2. Compute derived views and applicability per exact incident scope, then
aggregate them to Platform with explicit incident references. - Done

16.3. Make post-terminal audit require exact incident scope and known comparable
length/hash evidence; missing measurement must remain unknown. - Done

16.4. Correct Old answer identity precedence and normalized dispatch identity. - Done

16.5. Correct False success tri-state audit semantics and measured zero-growth
opposition evidence. - Done

16.6. Separate Cutted boundary coverage from False success post-terminal growth
and forbid extraction-length substitution. - Done

16.7. Add counter-evidence and causal ordering to Prompt not sent. - Done

16.8. Resolve the accepted extraction and implement both Empty branches: empty
result and wrong-node result. - Done

16.9. Derive Late end from the effective policy eligibility boundary and prove
the absence of later relevant mutations. - Done

16.10. Use REPORT_CONTRACTS as the single source of truth for embedded and
standalone applicability, evidence slots and sufficiency. - Done

16.11. Implement executable requiredIf conditions for conditional evidence
slots and observation-reliability limitations. - Done

16.12. Add causal diagnosis arbitration without changing factually true
applicability; expose primaryDiagnosis, causedBy and explanationRole. - Done

16.13. Minimize standalone evidence by proof role, boundary, extrema and
provenance while preserving every conclusion and replay invariant. - Done

16.14. Add explicit legacy limitations and remove identity inference from the
mere presence of dispatchId. - Done

16.15. Add positive, negative and unknown tests for all six presets plus
cross-incident isolation, embedded sufficiency, arbitration and compaction. - Pending

16.16. Synchronize schemas, registry, examples, documentation and project
versions; run focused validators and the complete regression gate. - Pending

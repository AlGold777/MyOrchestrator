# Disput universal pipeline — evidence matrix

**Version:** 3.0  
**Last reviewed:** 2026-07-23  
**Status vocabulary:** `implemented`, `partial`, `planned`, `not-applicable`.

This is the release-control matrix. A claim is not release evidence until it
names the implementation, deterministic test and gate.

| Requirement | Status | Implementation evidence | Test evidence | Release condition |
|---|---|---|---|---|
| One execution path; no named topology routing | implemented | `debate-application.js`, production loader and profiles | application/profile/repository-gate tests | Gate A |
| Policy-driven sequential and parallel batches | implemented | `debate-stage-executor.js` | stage-executor and partial-barrier tests | Gate A/B |
| Artifact → StateDelta → StateMap provenance | implemented | artifact pipeline, `debate-state-delta.js`, `debate-state-map.js` | artifact-pipeline and state-delta tests | Gate B |
| Atomic same-version parallel delta commit | implemented | `debate-case.js` | atomic-commit tests | Gate B |
| Participant accounting and transport retry/dropout | implemented | `debate-participant-registry.js`, `debate-stage-executor.js`, `debate-orchestrator.js` | participant-registry, stage-executor and persisted-recovery migration tests | Gate B/C |
| Revision-checked plan commands | partial | `debate-plan-revision.js`, `debate-run-store.js` | plan-revision tests, including persisted command-id replay | Browser recovery proof required |
| Planned-stage execution and explicit synthesizer ownership | implemented | `debate-planner.js`, `debate-orchestrator.js`, `debate-application.js` | planner planned-stage, orchestrator linkage and application synthesizer-migration tests | Gate A/B |
| Canvas DraftPlan and intermediate synthesis graph | implemented | `debate-draft-plan.js`, plan revision graph validation, Canvas controls in `results.js` | draft-plan, plan-revision, application binding and artifact-pipeline regressions | Gate A/B; browser recovery remains P0-R1 |
| Event replay and duplicate protection | partial | `debate-trace-store.js`, `debate-trace-schema.js` | trace tests, including semantic-ID conflict | Full replay/recovery E2E required |
| Event-log integrity and replay equivalence | partial | trace store/schema and orchestrator replay guard | `EVID-R6` target: replay corruption/recovery E2E | P0-R6 / Gate B/C |
| Semantic commit/no-op/version integrity | partial | StateDelta, DebateCase atomic commit, stage-count-scoped planning decisions and orchestrator version checks | planned-stage no-op dedup test plus `EVID-R7` target semantic-integrity suite | P0-R7 / Gate B |
| Single-owner lease | partial | `debate-orchestrator.js` | orchestrator ownership/expiry/fenced-late-dispatch tests | Browser-level cross-context invalidation and recovery proof required |
| Persisted recovery equivalence | planned | orchestrator/run store persistence primitives | none at browser level | R1 / Gate C |
| Transport race safety | planned | terminal and late-event guards | unit coverage only | R2 / Gate C |
| Human decision UI and recovery | partial | persisted decision request in `debate-orchestrator.js` | orchestrator reload/stale/duplicate-resolution test | DOM rendering and browser E2E acceptance required |
| Universal panel-header round counter | implemented | `results.js` round-limit UI/config synchronization | results UI regression coverage | Gate D |
| Message header ownership and moderator-role cleanup | implemented | `pipeline_panel.html`, `results.js`, `styles/modals-responsive.css` | release regression and results UI tests | Gate D |
| Universal arbitrary participant selection and reload canvas geometry | implemented | `pipeline/pipeline-runtime.js`, `results.js`, `styles/pipeline.css` | Universal default, arbitrary-selection, hidden-slot and explicit-synthesizer-reload UI regression tests | Gate D |
| Persisted legacy-config translation | planned | profile/config boundary | no migration suite | R7 |
| Telemetry redaction, canary thresholds and owner | planned | trace projection primitives | no operational acceptance suite | R6 / Gate E |
| Release-artifact rollback | planned | ADR-001 decision | no rollback drill | R10 / Gate E |
| Legacy execution fallback | not-applicable | ADR-001 | repository architecture gate | Deliberately prohibited; removal evidence pending ADR001-P/R/S |

## Evidence rules

1. `implemented` requires a named source module and at least one deterministic
   regression test.
2. `partial` means supporting code exists but its stated release acceptance
   proof is absent; it must not be represented as complete.
3. `planned` is not a release claim.
4. Each row is updated in the same change set as the behavior, manifest version
   and changelog entry.

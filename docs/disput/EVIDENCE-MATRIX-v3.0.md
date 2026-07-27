# Disput universal pipeline — evidence matrix

**Version:** 3.0  
**Last reviewed:** 2026-07-24
**Status vocabulary:** `implemented`, `partial`, `planned`, `not-applicable`.

This is the release-control matrix. A claim is not release evidence until it
names the implementation, deterministic test and gate.

| Requirement | Status | Implementation evidence | Test evidence | Release condition |
|---|---|---|---|---|
| One execution path; no named topology routing | implemented | `debate-application.js`, production loader and profiles | application/profile/repository-gate tests | Gate A |
| Policy-driven sequential and parallel batches | implemented | `debate-stage-executor.js` | stage-executor and partial-barrier tests | Gate A/B |
| Artifact → StateDelta → StateMap provenance | implemented | artifact pipeline, `debate-state-delta.js`, `debate-state-map.js` | artifact-pipeline and state-delta tests | Gate B |
| Atomic same-version parallel delta commit | implemented | `debate-case-schema.js.applyBatch`, `debate-case-store.js.commit`, single-batch Orchestrator path, Web Locks fencing | canonical integration, Phase 0, ownership and browser fencing evidence | Gate B |
| Единственный semantic writer артефактов | implemented | Один `DebateCaseStore` передаётся Application как `semanticStore`; UI actions идут через `submitIntervention` | canonical integration, application/orchestrator tests, browser recovery fixture | Gate B |
| Lifecycle артефакта (update/supersede/merge) | implemented | prospective batch validation, per-artifact revision, explicit supersede/merge, one-active-final invariant | case-store lifecycle tests and canonical synthesis replacement integration | Gate B |
| State Map виден пользователю во время run | partial | CaseStore subscription рендерит canonical case; Planner и UI используют один projector contract | Phase 0 E-07, state-map-view tests | Интерактивный drawer browser E2E остаётся P1 |
| Резолюционные goals выводятся из карты | implemented | StateMap v4 использует CaseSchema actionable contract; Planner читает actionable collections | `tests/semantic-layer-canonical-integration.test.js`, `tests/debate-planner.test.js` | Gate B |
| Participant accounting and transport retry/dropout | implemented | `debate-participant-registry.js`, `debate-stage-executor.js`, `debate-orchestrator.js` | participant-registry, stage-executor and persisted-recovery migration tests | Gate B/C |
| Revision-checked plan commands | partial | `debate-plan-revision.js`, `debate-run-store.js` | plan-revision tests, including persisted command-id replay | Browser recovery proof required |
| Planned-stage execution and explicit synthesizer ownership | implemented | `debate-planner.js`, `debate-orchestrator.js`, `debate-application.js` | planner planned-stage, orchestrator linkage and application synthesizer-migration tests | Gate A/B |
| Canvas DraftPlan and intermediate synthesis graph | implemented | `debate-draft-plan.js`, plan revision graph validation, Canvas controls in `results.js` | draft-plan, plan-revision, application binding and artifact-pipeline regressions | Gate A/B; browser recovery remains P0-R1 |
| Reuse model pages after first pipeline round | implemented | `results.js` `forceNewTabs`/`newPagesDispatched` and New Pages reset | `tests/release-log-regressions.test.js` tab-reuse contract | Gate D; browser smoke after extension reload |
| Double-click intermediate synthesis with final-model binding | implemented | `results.js` `toggleIntermediateSynthesis`, `styles/pipeline.css` visual state; no menu/independent selector | release-log and DraftPlan regressions | Gate A/B/D |
| Manual-only answer approval | implemented | `results.js` approval-mode guard and control sync | `tests/results-debate-favorites.test.js`, release-log regression | Gate D |
| Manual dispatch without active preset | implemented | empty initial pipeline selection and `startManualModeratorDispatch` in `results.js` | release-log manual-dispatch contract | Gate D |
| Reload cleanup of UI/session/model selection | implemented | `results.js` runtime reset and reload guards for local/sync/session/transcript state | release-log reload-cleanup contract | Gate D; browser smoke |
| UI persistence and Canvas performance coalescing | implemented | debounced cross-view persistence, rAF resize, no Canvas DOM churn | release-log performance contract and full Jest | Gate D; Chrome profile recommended |
| Top control bar row alignment on main and Disput pages | implemented | `styles/app-controls.css`, `styles/results-debate.css` nowrap layout with overflow-safe model strip | `tests/release-log-regressions.test.js` top-control-bar contract | Gate D |
| Append-only per-request Disput feed | implemented | `results.js` request-scoped card resolution and terminal `turnClosed` state | `tests/results-debate-favorites.test.js` multi-round preservation regression | Gate D |
| Finite concise response contract for participant and synthesis stages | implemented | Prompt Pack 3.1 marker, transport guard and acceptance `maxWords`; unlimited option removed | `tests/debate-prompt-runtime-v3.test.js`, release-log contract | Gate A/B/D |
| Answer-card wide overlay, no Branch action and terminal printing cleanup | implemented | `results.js` final-event cleanup; `styles/modals-responsive.css` viewport overlay; Branch removed from templates | `tests/results-debate-favorites.test.js`, release-log CSS/handler contract | Gate D |
| Closed composer prompt clear and telemetry reset on browser reload | implemented | `pipeline_panel.html` trash control; delegated prompt cleanup in `results.js`; `clearTelemetryOnReload` and background `CLEAR_DIAG_EVENTS` | `tests/release-log-regressions.test.js`, `tests/telemetry-markdown-export-regression.test.js` | Gate D |
| Empty model selection keeps a visible inactive round pipeline | implemented | `results.js` placeholder block generation; `styles/pipeline.css` keeps `.pipeline-empty-slot` visible | release-log placeholder contract; pipeline UI smoke | Gate D |
| Event replay and duplicate protection | partial | `debate-trace-store.js`, `debate-trace-schema.js` | trace tests, including semantic-ID conflict | Full replay/recovery E2E required |
| Event-log integrity and replay equivalence | partial | trace store/schema and orchestrator replay guard | `EVID-R6` target: replay corruption/recovery E2E | P0-R6 / Gate B/C |
| Semantic commit/no-op/version integrity | partial | StateDelta, DebateCase atomic commit, stage-count-scoped planning decisions and orchestrator version checks | planned-stage no-op dedup test plus `EVID-R7` target semantic-integrity suite | P0-R7 / Gate B |
| Single-owner lease | implemented | durable lease revision + Web Locks cross-context mutex | ownership/expiry/fenced-late-dispatch tests; two-page browser fixture | Gate B/C |
| Persisted recovery equivalence | implemented | OrchestratorPersistence v2 localStorage event/snapshot journal; canonical reprojection on recovery | two-page browser `pause → reload → continue`, no duplicate dispatch | Gate C |
| Transport race safety | planned | terminal and late-event guards | unit coverage only | R2 / Gate C |
| Human decision UI and recovery | partial | persisted decision request in `debate-orchestrator.js` | orchestrator reload/stale/duplicate-resolution test | DOM rendering and browser E2E acceptance required |
| Universal panel-header round counter | implemented | `results.js` round-limit UI/config synchronization | results UI regression coverage | Gate D |
| Message header ownership and moderator-role cleanup | implemented | `pipeline_panel.html`, `results.js`, `styles/modals-responsive.css` | release regression and results UI tests | Gate D |
| Universal arbitrary participant selection and reload canvas geometry | implemented | `pipeline/pipeline-runtime.js`, `results.js`, `styles/pipeline.css` | Universal default, arbitrary-selection, hidden-slot and explicit-synthesizer-reload UI regression tests | Gate D |
| Persisted legacy-config translation | planned | profile/config boundary | no migration suite | R7 |
| Telemetry redaction, content minimization and owner | implemented | `debate-trace-schema.js`, `debate-trace-store.js`, `debate-trace-projections.js`, safe evidence bridge in `results.js` | `tests/debate-trace.test.js`, `tests/telemetry-export-actions.test.js` cover generic/camelCase/nested content, legacy restore, derived-section dedupe and Only-problems filtering | R6 / Gate E |
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

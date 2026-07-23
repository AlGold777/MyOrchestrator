# Universal pipeline: final implementation plan

**Version:** 3.0  
**Date:** 2026-07-23  
**Status:** architecture adopted; core implementation completed; release hardening remains.

## 1. Objective

Ship one production execution path capable of sequential and parallel collaboration among an arbitrary policy-valid set of LLM or human participants. The pipeline must be deterministic where policy requires it, fail closed at semantic boundaries, preserve provenance, survive reload, support human intervention and produce an auditable final artifact.

## 2. Architectural decisions

1. There is one application boundary and one orchestrator.
2. Conversation shape is planned from StateMap; it is not selected as a mode.
3. Participant count is data governed by one policy source.
4. Every semantic output passes through Artifact → StateDelta → DebateCase → StateMap.
5. Parallel participant deltas share an expected version and commit atomically.
6. Synthesis is versioned and every corrected synthesis requires a fresh audit.
7. Cancellation has one terminal owner and one abort tree.
8. Missing production ports, decision resolvers or semantic commits fail closed.
9. UI state is a projection of canonical runtime state.
10. No feature switch can route execution to another engine.

## 3. Capability decisions

### Adopted

- terminal transport failure distinct from an accepted empty response;
- participant dropout with explicit accounting;
- native batch dispatch and an all-settled barrier;
- bounded retry under stage policy;
- deterministic reassignment of unavailable service roles;
- atomic same-version delta commit;
- typed linked artifacts with provenance;
- context selection from StateMap instead of hand-built round transcript filters;
- rule-driven creation of follow-up work;
- persisted human decisions and immutable plan revisions;
- synthesis audit and correction loop;
- idempotent terminal outputs and late-event rejection.

### Rejected

- fixed participant cardinality;
- hard-coded rounds, waves or speaking order;
- dedicated runner per conversation shape;
- final-word rituals as a mandatory stage;
- page-local mutable lifecycle as source of truth;
- fallback to a second executor;
- automatic continuation when a required human decision cannot be obtained;
- synthesis validation that is not bound to an artifact ID.

## 4. Delivered implementation

### 4.1 Application and lifecycle — complete

- `DebateApplication.start()` always creates the universal engine.
- Composition validates production semantic ports before dispatch.
- Pause, continue, cancel and plan commands route through the application.
- `DebateRunStore` projects one universal aggregate.
- UI controls read universal lifecycle and stage events.
- Terminal transitions are idempotent.

Acceptance evidence: application, run-store, transition, cancellation and UI lifecycle tests.

### 4.2 Planning and stages — complete

- DebateCase is created before execution.
- Planner proposes purpose/capability-based stages.
- Plan revisions are immutable and revision-checked.
- Orchestrator owns stage lifecycle and budgets.
- Executor supports sequential and parallel dispatch.
- Participant attempts use bounded retry and explicit acceptance.

Acceptance evidence: planner, plan revision, stage executor, partial barrier and orchestrator tests.

### 4.3 State and artifacts — complete

- Multiple linked artifacts can be extracted from one response.
- Deltas are sequence/version anchored.
- Parallel deltas commit atomically.
- Stale and conflicting writes are rejected.
- StateMap projects canonical claims, evidence, objections, gaps, dissent and synthesis state.

Acceptance evidence: artifact pipeline, StateDelta, DebateCase and StateMap tests.

### 4.4 Synthesis — complete

- Synthesis creates an artifact with a unique ID.
- Audit targets that exact ID.
- Audit issues schedule correction.
- Correction creates a new ID and requires another audit.
- Finalization cannot reuse an audit from an older synthesis.

Acceptance evidence: synthesis audit loop, terminal evidence and production wiring tests.

### 4.5 UI and profiles — complete for current surface

- Built-in choices are Universal, Research and Red Team profiles.
- Custom pipeline builder selects participants, policy, stage budget, output length and optional synthesizer.
- No UI control selects a fixed conversation shape.
- Synthesis is shown as a universal stage.
- StateMap human action requests synthesis through a plan revision.
- Existing RunStore/event projections preserve current page diagnostics and exports.

Acceptance evidence: results page, favorites, profile store, content load order and repository gate tests.

### 4.6 Removed architecture — complete

- dedicated fixed-shape runners and runtimes removed;
- dedicated registries, plan compiler and run services removed;
- trigger-specific second executor removed after transferring rule-driven planning;
- feature switches for selecting an executor removed;
- legacy source-contract tests removed; historical documents isolated in `docs/disput-old/`;
- HTML entrypoints no longer load removed modules.

## 5. Remaining release work

### R1. Persisted recovery E2E — priority P0

Build a deterministic browser test that:

1. starts a run with at least four participants;
2. completes one parallel stage and commits artifacts;
3. pauses at a safe boundary;
4. reloads the page;
5. reconstructs DebateCase, plan revision, RunStore and orchestrator snapshot;
6. verifies no completed participant is redispatched;
7. continues and reaches one terminal result;
8. compares final StateMap with a no-reload control run.

Gate: zero duplicate attempts, identical accepted artifact set and exactly one terminal event.

### R2. Browser transport race suite — priority P0

Cover delayed final responses, duplicate finals, timeout followed by late success, abort during batch, tab loss, one participant failure in a parallel batch and cancellation during synthesis.

Gate: no late event changes canonical state; abort is never classified as participant failure; all barriers settle.

### R3. Human decision UI — priority P0

Render persisted decision requests with request ID, reason, options and affected stage. Resolve through an expected revision. Restore an unanswered request after reload.

Gate: absence of UI cannot auto-continue; duplicate resolution is rejected; stale resolution cannot modify the active plan.

### R4. StateMap conflict UI — priority P1

Expose stale/conflicting deltas, provenance and available human actions. Allow retry/replan, accept supported alternative or reject with reason.

Gate: every human action creates a persisted decision and a trace event.

### R5. Resource governance — priority P1

Enforce total stages, participant calls, retries, wall time, context size and synthesis correction limits. Planner must return a typed stop or degradation decision when a budget is exhausted.

Gate: no unbounded loop; every exhaustion reason appears in terminal evidence and telemetry.

### R6. Telemetry completeness — priority P1

Add dashboards/projections for stage duration, retry count, failed participants, stale deltas, audit corrections, decision wait time, cancellation latency and artifact coverage.

Gate: trace replay reproduces the same report; sensitive raw prompts and answers remain redacted by policy.

### R7. Migration of persisted custom configs — priority P1

Normalize imported configs to `type: universal`, preserve selected models, profile, budgets, outputs and synthesizer, and discard unknown execution-shape fields. Emit one migration record without executing deprecated semantics.

Gate: migration is idempotent and imported config produces the same universal runtime snapshot on the second load.

### R8. Performance and capacity — priority P2

Measure planner latency, batch dispatch overhead, delta commit cost and StateMap projection for 1, 4, 8 and 16 participants and 10/50/200 artifacts.

Initial budgets:

- planner p95 below 100 ms for 200 artifacts;
- UI projection p95 below 50 ms;
- no quadratic growth in participant dispatch preparation;
- bounded trace and RunStore retention;
- cancellation acknowledgement below 1 second excluding browser shutdown.

### R9. Accessibility and operator UX — priority P2

Verify keyboard operation, focus restoration, live regions for lifecycle changes, decision-dialog labels, stage status contrast and readable degraded-result explanations.

### R10. Release and rollback — priority P0

Because there is one engine, rollback means reverting the release artifact, not activating another runtime. Prepare:

- signed previous extension package;
- storage schema compatibility statement;
- migration rollback test;
- canary checklist;
- telemetry alert thresholds;
- incident procedure for stuck runs and corrupted snapshots.

## 6. Test matrix

| Layer | Required coverage |
|---|---|
| Unit | policies, planner decisions, PromptPack, acceptance, artifact extraction, delta validation, projections |
| Integration | application composition, executor batches, atomic commit, pause/continue/cancel, audit correction |
| Replay | event order, duplicate events, stale revisions, corrupted snapshots, terminal idempotency |
| Browser | real DOM controls, reload recovery, transport races, human decisions, export |
| Manual canary | provider authentication, long answers, attachments, cancellation, degraded completion |

Every bug fix adds the smallest deterministic regression at the lowest sufficient layer.

## 7. Mandatory negative tests

- zero participants;
- duplicate participant IDs;
- unavailable adapter;
- missing compile/extract/commit/project port;
- empty, malformed and over-limit response;
- one and several failed participants in a parallel stage;
- stale StateDelta;
- conflicting same-version deltas;
- abort before dispatch, during dispatch and after response;
- duplicate final response;
- synthesis unavailable;
- audit malformed, audit issues, correction malformed;
- stale human command;
- reload with active decision request;
- cancellation racing finalization;
- output action invoked twice.

## 8. Release gates

### Gate A — architecture

- only one application start path;
- no dedicated execution runner by conversation shape;
- no executor-selection feature switch;
- one participant-cardinality policy source;
- production composition fails closed.

### Gate B — semantic integrity

- every accepted response has provenance;
- every canonical write is a validated delta;
- parallel commit is atomic;
- current synthesis has a current audit;
- terminal evidence names degradation and skipped requirements.

### Gate C — lifecycle

- pause/continue survives reload;
- cancellation is idempotent;
- late responses cannot reopen a run;
- only one terminal event is accepted.

### Gate D — regression

- full Jest suite passes;
- browser E2E passes on both HTML entrypoints;
- no source loader references removed modules;
- no unresolved imports or syntax errors;
- dirty-worktree review contains only intended files.

### Gate E — operations

- canary telemetry visible;
- rollback artifact tested;
- storage migration reversible or forward-compatible;
- incident owner and stop criteria documented.

## 9. Definition of Done

The universal pipeline is release-ready when all P0 items and Gates A–E pass, no semantic operation bypasses StateDelta, recovery reproduces the control run, a corrected synthesis cannot inherit an old audit, cancellation produces one terminal result under race, and operators can explain every degraded output from persisted evidence.

## 10. Change discipline

1. One architectural concern per commit.
2. Tests land with the behavior they protect.
3. No compatibility branch may create a second executor.
4. Migration may translate data but never resurrect execution semantics.
5. A TODO must name owner, gate and removal condition.
6. Documentation changes in the same commit as ownership or lifecycle changes.
7. Every Disput change also increments `manifest.json` and `package.json`, adds
   a top entry to `docs/CHANGELOG.md`, and updates the affected file in
   `docs/disput/`. `docs/disput-old/` is archive-only and is never normative.

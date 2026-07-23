# Canvas synthesis insertion — implementation contract v1.1

**Version:** 1.1  
**Date:** 2026-07-23  
**Status:** implemented in 2.81.39; browser recovery proof remains a release-register obligation.

## Decision

Canvas is not a decorative graph. Before a run it edits one persisted
`DraftPlan`; at run start that DraftPlan becomes the initial immutable
`PlanRevision`. During `PAUSED`, a Canvas change is submitted through
`DebateApplication` as a revision command and is persisted only after the
revision is accepted. No Canvas control writes an active runtime plan directly.

The rejected v1.0 draft in `docs/disput-old/` must not be used as a normative
source: it described Canvas blocks without wiring their stages to the Planner.

## Canonical data and invariants

`DraftPlan` (`disput/debate-draft-plan.js`) contains normalized generic stages:

- stable `plannedStageId`, `purpose`, explicit `participantIds` and optional
  `participantBindings`;
- `upstream`, `activationPolicy`, `outputIntent`, `terminalPolicy`,
  `auditPolicy`, `expectedArtifactTypes`, `inputSelector` and `goalIds`;
- only `pending` stages before execution.

The Canvas's R1/R2/… columns materialize as `canvas-r1`, `canvas-r2`, …;
they are ordinary executable stages rather than a separate round runtime.
`planned-final-synthesis` is the terminal candidate stage. An inserted stage is
`purpose: synthesis`, `outputIntent: working_synthesis`,
`terminalPolicy: continue`, `assignmentPolicy: explicit_required` and emits
`synthesis_working`, never `synthesis_conclusion`.

The following fail closed before dispatch:

1. duplicate stage ID, unknown upstream reference or dependency cycle;
2. an explicit synthesis without an assigned model;
3. a paused-run revision targeting a completed, running or waiting stage;
4. an unavailable explicit participant. It yields a typed wait; Planner may
   not silently substitute a model.

## Graph operation

`+` after stage **A** constructs **S** with `upstream: [A]`, rewrites every
immediate downstream edge `A → B` to `S → B`, then places S after A in the
presentation order. Removing S performs the inverse rewiring. This is one
semantic graph operation, not an array reorder.

`CHANGE_STAGE_ORDER` preserves dependencies unless a deliberate linear rewire
is requested. PlanRevision validates graph integrity after every command batch.

## Runtime path

```text
Canvas → persisted DraftPlan → initial PlanRevision
       → Planner ready-stage selection → proposed stage
       → Orchestrator StageInstance → StageExecutor
       → Artifact / StateDelta / StateMap
```

`participantBindings` follow the planned stage through Planner and Orchestrator
to the participant task (`promptId`). `inputSelector: working_synthesis` reads
only `StateMap.workingSynthesisArtifactIds`; final StateMap synthesis remains
the final `synthesis_conclusion` only. This prevents a checkpoint from being
mistaken for a terminal answer.

## UI and migration

The panel-header `debate-synthesizer-select` has been removed. The final Canvas
select reads and writes the DraftPlan. `protocol.synthesizer` and
`overrides.synthesizers` are compatibility inputs during load only; a loaded
legacy value is materialized into DraftPlan and is not written back as a new
header-state value.

Insertion is available pre-run and when the run is `PAUSED`; it is disabled
while planning, running or cancelling. Paused insert/remove/participant-change
operations use `INSERT_STAGE`, `REMOVE_PENDING_STAGE`, and
`CHANGE_PARTICIPANT` through `DebateApplication` with revision concurrency.

## Evidence

- `tests/debate-draft-plan.test.js` — materialization, atomic rewiring,
  invalid assignment/reference and cycle rejection.
- `tests/debate-plan-revision.test.js` — revision graph and future-stage guard.
- `tests/debate-application-universal.test.js` — DraftPlan initial revision,
  binding propagation and executable planned stage.
- `tests/debate-artifact-pipeline.test.js` — working synthesis cannot set the
  final synthesis pointer.
- `tests/results-debate-favorites.test.js` — Canvas final selection and reload
  visibility regression.

Browser reload/recovery equivalence remains `P0-R1`; it is not claimed closed
by these unit and DOM regressions.

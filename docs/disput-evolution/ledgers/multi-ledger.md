# Multi Capability Ledger

## Source Map

| Layer | Files | Relevant symbols | Status |
|---|---|---|---|
| Preset | disput/pipeline-presets.js | Multi presets | INVENTORIED |
| Compiler | disput/debate-plan-compiler.js | wave stages | INVENTORIED |
| Prompt | prompt compiler + synthesis/audit contracts | — | INVENTORIED |
| Protocol | disput/debate-protocols.js | MULTI_BEGIN_WAVE, MULTI_WAVE_COMPLETED, MULTI_SYNTHESIS_RECORDED | INVENTORIED |
| FSM | disput/multi-runtime.js | wave lifecycle | INVENTORIED |
| Runner | disput/multi-runner.js | start (wave loop), synthesis, audit | INVENTORIED |
| Tests | tests/multi-runner.test.js, tests/multi-runtime.test.js | characterization | INVENTORIED |

## Capability Ledger

| ID | Legacy source | Capability | Classification | New owner | Policy | Tests | Status |
|---|---|---|---|---|---|---|---|
| M-1 | wave loop runModelBatch(waveModels) | Arbitrary participant batch / large parallel dispatch | Universal | StageExecutor `parallel` | ExecutionPolicy | debate-stage-executor.test.js | INTEGRATED |
| M-2 | partial batch (failedModels + continue) | Partial batch completion | Universal | CompletionPolicy `quorum` | CompletionPolicy | debate-stage-executor.test.js | INTEGRATED |
| M-3 | successfulModels per wave | Participant selection per round | Universal | Planner participant selection | — | debate-planner.test.js | INTEGRATED |
| M-4 | DROPOUT_* per batch | Batch failure handling | Universal | StageExecutor + Planner replan | DropoutPolicy | debate-stage-executor.test.js | INTEGRATED |
| M-5 | synthesis alternatives loop | Synthesis retry (alternate synthesizer) | Universal | Planner reselection | SynthesisPolicy | debate-planner.test.js | INTEGRATED |
| M-6 | runSynthesisAudit + repair | Audit + audit correction | Universal | Audit stage + Planner goal `test_revision` | AuditPolicy | debate-planner.test.js | INTEGRATED |
| M-7 | degraded continuation after dropout | Degraded continuation | Universal | CompletionPolicy + Planner | DropoutPolicy | debate-stage-executor.test.js | INTEGRATED |
| M-8 | correlation guard per entry | Correlation validation | Universal | StageExecutor | — | existing tests | INTEGRATED |

## Constraint Inventory

| Constraint | Source | Decision | Обоснование |
|---|---|---|---|
| wave/round count | preset.roundLimit | KEEP_AS_EXPLICIT_POLICY | PlannerBudgets |
| synthesizer ≠ auditor | runner | KEEP_AS_EXPLICIT_POLICY | IndependencePolicy (Planner §12.3) |
| min participants | нет явного минимума (implicit ≥1) | REPLACE_WITH_CAPABILITY_RULE | ParticipantCardinalityPolicy |

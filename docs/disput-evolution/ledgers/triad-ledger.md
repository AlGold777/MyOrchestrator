# Triad Capability Ledger

## Source Map

| Layer | Files | Relevant symbols | Status |
|---|---|---|---|
| Preset | disput/pipeline-presets.js | Triad presets, checkpointPolicy.everyWaves | INVENTORIED |
| Compiler | disput/debate-plan-compiler.js | wave_batch branches | INVENTORIED |
| Prompt | disput/debate-prompt-compiler.js, triad prompt contracts (`buildTriadSynthesisPrompt`) | required sections: Вердикт, Что устояло, Позиции меньшинства, … | INVENTORIED |
| Protocol | disput/debate-protocols.js | TRIAD_INIT_ANSWER, TRIAD_WAVE_ANSWER | INVENTORIED |
| FSM | disput/triad-runtime.js | wave lifecycle | INVENTORIED |
| Runner | disput/triad-runner.js | dispatchWave, finalize | INVENTORIED |
| Registry | disput/triad-registry.js | artifact registry, checkpoint | INVENTORIED |
| Massage | disput/triad-massage.js | context assembly | INVENTORIED |
| Tests | tests/triad-full-run.test.js | characterization | INVENTORIED |

## Capability Ledger

| ID | Legacy source | Capability | Classification | New owner | Policy | Tests | Status |
|---|---|---|---|---|---|---|---|
| T-1 | dispatchWave BARRIER_OPENED/RELEASED | Parallel barrier (all participants) | Universal | StageExecutor + CompletionPolicy `all` | CompletionPolicy | debate-stage-executor.test.js | INTEGRATED |
| T-2 | init wave | Initialization barrier | Universal | StageExecutor (первый parallel stage) | — | debate-stage-executor.test.js | INTEGRATED |
| T-3 | partial barrier + DROPOUT_CONTINUE | Quorum / degraded continuation | Universal | CompletionPolicy `quorum` | CompletionPolicy.quorumSize | debate-stage-executor.test.js | INTEGRATED |
| T-4 | wave synchronization (wave counters) | Wave synchronization | Legacy implementation | Planner tick (создаёт следующий parallel stage по state) | — | debate-planner.test.js | INTEGRATED |
| T-5 | roles (participant/critic/verifier) | Role differentiation | Universal | Planner participant selection (requiredCapabilities) | RolePolicy | debate-planner.test.js | INTEGRATED |
| T-6 | repairInvalidBatch-analog, PROMPT_COMPILED | Format repair + prompt fingerprint trace | Universal | StageExecutor repair hook; PromptCompiler | AcceptancePolicy | debate-stage-executor.test.js | INTEGRATED |
| T-7 | checkpointPolicy.everyWaves + registry checkpoint | Periodic checkpoint | Universal | Orchestrator snapshot + Planner `compact_context` | CheckpointPolicy | debate-orchestrator.test.js | INTEGRATED |
| T-8 | critical attack / meta-review waves | Critique wave semantics | Product behavior | Stage purpose `critique` via Planner rules | — | debate-planner.test.js | CLASSIFIED |
| T-9 | resolveDropout | Participant dropout, barrier release conditions | Universal | StageExecutor partial result + Planner replan | DropoutPolicy | debate-stage-executor.test.js | INTEGRATED |
| T-10 | validateCorrelation в барьере | Correlation guard per participant | Universal | StageExecutor | — | existing tests | INTEGRATED |

## Constraint Inventory

| Constraint | Source | Decision | Обоснование |
|---|---|---|---|
| 3 participants fixed | preset/roles | REPLACE_WITH_CAPABILITY_RULE | Barrier работает для N; cardinality → policy |
| checkpoint every N waves | preset.checkpointPolicy | KEEP_AS_EXPLICIT_POLICY | CheckpointPolicy в debate-policies.js |
| synthesis required sections | prompt contract | KEEP_AS_EXPLICIT_POLICY | Output contract стадии synthesis (AcceptancePolicy) |
| wave count limit | preset.roundLimit | KEEP_AS_EXPLICIT_POLICY | PlannerBudgets.maxTotalStages |

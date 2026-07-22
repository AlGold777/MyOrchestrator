# FreeTalk Capability Ledger

## Source Map

| Layer | Files | Relevant symbols | Status |
|---|---|---|---|
| Preset | disput/pipeline-presets.js:218 | FREE_TALK_MVP (roundLimit: infinite, triggers, progressPolicy, defaultModelCount: 1) | INVENTORIED |
| Compiler | disput/debate-plan-compiler.js | dynamic_action | INVENTORIED |
| Prompt | disput/debate-prompt-compiler.js (repairPrompt), action contracts | — | INVENTORIED |
| Protocol | disput/free-talk-protocol.js | — | INVENTORIED |
| FSM/runtime | disput/free-talk-runtime.js | budget, decision effects | INVENTORIED |
| Runner | disput/free-talk-runner.js | trigger loop, planNext, checkpoint, repairInvalidBatch | INVENTORIED |
| Rules | disput/debate-rule-engine.js, debate-rule-history.js | trigger evaluation | INVENTORIED |
| Decisions | disput/debate-decision-request.js | human decision requests | INVENTORIED |
| Tests | tests/free-talk-runner.test.js, tests/free-talk-mvp.test.js | characterization | INVENTORIED |

## Capability Ledger

| ID | Legacy source | Capability | Classification | New owner | Policy | Tests | Status |
|---|---|---|---|---|---|---|---|
| F-1 | planNext + triggerState.rules | Dynamic trigger evaluation | Universal | Planner rule engine | ruleSet | debate-planner.test.js | INTEGRATED |
| F-2 | planned.next / batch | Next-action planning (incl. parallel batch) | Universal | Planner PlanningDecision | — | debate-planner.test.js | INTEGRATED |
| F-3 | task.actionContract | Action contracts | Universal | ProposedStage (purpose + promptContractId) | — | debate-planner.test.js | INTEGRATED |
| F-4 | chooseModel (independence, auditor≠synthesizer) | Participant routing + independence | Universal | Planner participant selection §12 | IndependencePolicy | debate-planner.test.js | INTEGRATED |
| F-5 | runCheckpoint + state map | State-map checkpoint | Universal | Orchestrator snapshot + StateMapProjector | CheckpointPolicy | debate-orchestrator.test.js | INTEGRATED |
| F-6 | progressWindow, unchangedMaps | Stagnation detection (progress window) | Universal | Planner stagnation §14 | StagnationPolicy | debate-planner.test.js | INTEGRATED |
| F-7 | repeated fingerprints suppression | Repetition detection | Universal | Planner repetition §15 (duplicationPenalty) | StagnationPolicy | debate-planner.test.js | INTEGRATED |
| F-8 | awaitingHuman + DebateDecisionRequest | Human decision request | Universal | Planner REQUEST_HUMAN_DECISION §13 | — | debate-planner.test.js | INTEGRATED |
| F-9 | contextPressure → compaction | Context compaction | Universal | Planner goal `compact_context` §20 | CompactionPolicy | debate-planner.test.js | INTEGRATED |
| F-10 | repairInvalidBatch | Dynamic repair | Universal | StageExecutor repair hook | AcceptancePolicy | debate-stage-executor.test.js | INTEGRATED |
| F-11 | stopReason='synthesizer_none' → completion | Optional synthesis / no-synthesis completion | Universal | FinalizationPolicy (STATE_MAP / ARTIFACTS_ONLY) | FinalizationPolicy | debate-planner.test.js | INTEGRATED |
| F-12 | resourceBudget used/limit/reserved | Budget-bounded continuation | Universal | PlannerBudgets §16 | Budgets | debate-planner.test.js | INTEGRATED |
| F-13 | decisionMode auto/assisted/manual | Human approval mode | Policy | ApprovalPolicy | ApprovalPolicy | — | CLASSIFIED |

## Constraint Inventory

| Constraint | Source | Decision | Обоснование |
|---|---|---|---|
| defaultModelCount: 1 (UI default) | pipeline-presets.js:218 | KEEP_AS_EXPLICIT_POLICY | Только initial default, не runtime limit; cardinality → ParticipantCardinalityPolicy (maximum: null) |
| Историческое ограничение «2 участника» | НЕ НАЙДЕНО в runtime (runner принимает произвольный models[]); риск только в UI-слое | REMOVE_AS_LEGACY | Обязательный тест §17.4: 4 participants проходят policy validation (debate-policies.test.js) |
| roundLimit: infinite | preset | KEEP_AS_EXPLICIT_POLICY | PlannerBudgets.maxTotalStages = null |
| contextPressure каждые 8 actions | free-talk-runner.js:229 | KEEP_AS_EXPLICIT_POLICY | CompactionPolicy.actionInterval |

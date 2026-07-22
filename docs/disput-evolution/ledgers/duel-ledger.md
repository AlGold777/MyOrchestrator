# Duel Capability Ledger

## Source Map

| Layer | Files | Relevant symbols | Status |
|---|---|---|---|
| Preset | disput/pipeline-presets.js | Duel presets (roundLimit, finalizationPolicy) | INVENTORIED |
| Compiler | disput/debate-plan-compiler.js:99 | `normalizedModels.slice(0, 2)` — hidden 2-participant limit | INVENTORIED |
| Prompt | prompts via deps.buildInitAPrompt/buildInitBPrompt/buildFinalWordPrompt/buildFinalSynthesisPrompt | duel prompt contracts | INVENTORIED |
| Protocol | disput/debate-protocols.js | duel protocol reduce | INVENTORIED |
| FSM | deps.fsm (debate-engine.js) | beginOpenings, canRoutePublic, hasReachedTurnLimit, retainParticipant | INVENTORIED |
| Runner | disput/duel-runner.js | createDuelRunner: start, requestFinalWords, runTurnWithRetry, routeApprovedTurn | INVENTORIED |
| UI | pipeline panel (approval controls, renderCards) | approvalSelectable | INVENTORIED |
| Persistence | disput/debate-run-store.js | topology='duel', protocolState | INVENTORIED |
| Tests | tests/duel-runner.test.js | characterization | INVENTORIED |

## Capability Ledger

| ID | Legacy source | Capability | Classification | New owner | Policy | Tests | Status |
|---|---|---|---|---|---|---|---|
| D-1 | routeApprovedTurn loop | Sequential dispatch (ordered turn routing) | Universal | StageExecutor (`dispatchMode: sequential`) | ExecutionPolicy | debate-stage-executor.test.js | INTEGRATED |
| D-2 | start() parallel init A0+B0 | Parallel opening barrier | Universal | StageExecutor + CompletionPolicy `all` | CompletionPolicy | debate-stage-executor.test.js | INTEGRATED |
| D-3 | runTurnWithRetry | Retry with attempt IDs, acceptance-gated | Universal | StageExecutor RetryPolicy | RetryPolicy | debate-stage-executor.test.js | INTEGRATED |
| D-4 | waitingApprovalModel + approveTurn | Approval boundary between turns | Universal | Orchestrator pause/human gate + Planner REQUEST_HUMAN_DECISION | ApprovalPolicy | debate-orchestrator.test.js | INTEGRATED |
| D-5 | requestFinalWords | Final words stage per participant | Product behavior (requires PO confirmation) | Stage purpose `final_position` via Planner rule | FinalizationPolicy | — | CLASSIFIED |
| D-6 | resolveDropout / retainSingleParticipant | Participant dropout: retry/continue/stop, degraded continuation | Universal | StageExecutor partial completion + Planner replanning | DropoutPolicy (failurePolicy) | debate-stage-executor.test.js | INTEGRATED |
| D-7 | synthesis loop with alternate synthesizers | Synthesis retry with alternate participant | Universal | Planner (participant reselection on failed goal) | SynthesisPolicy | debate-planner.test.js | INTEGRATED |
| D-8 | auditRequired + runSynthesisAudit | Synthesis audit + correction | Universal | Audit stage (purpose `audit`) via Planner goal `audit_output` | AuditPolicy | debate-planner.test.js | INTEGRATED |
| D-9 | validateRequiredSections + repair dispatch | Format repair (missing sections) | Universal | StageExecutor repair hook | AcceptancePolicy | debate-stage-executor.test.js | INTEGRATED |
| D-10 | validateCorrelation | Dispatch correlation guard | Universal | StageExecutor (idempotency key + correlation) | — | existing dispatch-correlation-contract.test.js | INTEGRATED |
| D-11 | completed_without_synthesis path | Completion without synthesis | Universal | FinalizationPolicy mode `ARTIFACTS_ONLY`/`STATE_MAP` | FinalizationPolicy | debate-planner.test.js | INTEGRATED |
| D-12 | runRoundFilter per round | Round filter (context distillation) | Legacy implementation of `compact_context` | Planner goal `compact_context` | CompactionPolicy | debate-planner.test.js | CLASSIFIED |
| D-13 | pendingAutoContinuation + markPaused | Pause between turns, resume continuation | Universal | Orchestrator persisted pause (QUIESCING) | PausePolicy | debate-orchestrator.test.js | INTEGRATED |

## Constraint Inventory

| Constraint | Source | Decision | Обоснование |
|---|---|---|---|
| Exactly 2 participants | plan-compiler `slice(0, 2)`, fixed slots A/B | REPLACE_WITH_CAPABILITY_RULE | Sequential dispatch works for N≥2; cardinality → `ParticipantCardinalityPolicy` |
| Turn limit (publicTurnLimit) | preset.turnLimit | KEEP_AS_EXPLICIT_POLICY | Budget: `PlannerBudgets.maxTotalStages`; owner: debate-policies.js; test: debate-planner.test.js |
| Synthesizer 'auto' rejected | runner start() | REMOVE_AS_LEGACY | Planner selects synthesizer by capability |
| finalWords обязательны перед synthesis | requestFinalWords | KEEP_AS_EXPLICIT_POLICY (product) | Требует подтверждения PO; выражается rule-порядком через goal dependencies |

# Disput stabilization verification report — 2026-07-23

This report separates verified code facts from implementation decisions. Line numbers may move after stabilization commits; file/function names are normative.

## Verified findings

| Finding | Evidence | Decision |
|---|---|---|
| FreeTalk retry recursively restarts the whole runner | `disput/free-talk-runner.js`, `return runner.start(input)` | IMPLEMENT: opening-only bounded retry; no aggregate reinitialization |
| Duel contains the same recursive restart pattern | `disput/duel-runner.js`, opening dropout retry | IMPLEMENT under legacy retry/dropout normalization |
| Universal step budget has hidden default | `debate-orchestrator.js::runLoop(maxSteps = 50)` and multiple public entry points pass optional `command.maxSteps` | IMPLEMENT explicit policy budget and persisted continuation state |
| Universal recovery validates sequence but does not reduce replayed events | `debate-orchestrator.js::recoverRun` only advances `eventSequence` | IMPLEMENT deterministic reducer/replay |
| Universal semantic commit defaults to applied when no commit port exists | `debate-orchestrator.js::commitStageResult`, initial `{ applied: true }` | IMPLEMENT fail-closed semantic commit before rollout |
| DebateEngine persists a separate transcript cache | `debate-engine.js`, storage key `llmCortexDebateEngineState.v1`; direct `appendTurn` call sites in `results.js` | IMPLEMENT canonical RunStore projection/cache contract |
| DebateEngine clone has `structuredClone` first and JSON fallback | `debate-engine.js::clone` | PARTIAL: Set loss is not confirmed when structuredClone exists; JSON fallback remains lossy and must use shared codec if protocol data crosses this boundary |
| Protocol runtime states contain Sets | Duel/Triad runtime `newPagesOpenedModels`, `routedTurnIds` | IMPLEMENT Set-safe transition cloning; RunStore already preserves Set in serialize/hydrate |
| Protocol transition already has a composition-root wrapper, but it mutates before sync | `results.js::transitionDebateProtocol` calls mutable `protocol.reduce` then `syncAggregateProtocolState` | IMPLEMENT separate transactional integration service and CAS revision check |
| Round-control plan item is still applicable in one path | `syncDebateRoundStepperUi` and `syncDebateSchemeUi` use different selector fallbacks; HTML wrappers differ | IMPLEMENT one data attribute and remove silent select fallback after transition work |
| Legacy auditor removal is incomplete | `debate-service-roles.js` still resolves auditor; Duel/Triad/Multi/FreeTalk runners still dispatch legacy audit | IMPLEMENT deprecation invariant: legacy auditor always empty; Universal audit stage remains |
| Plan revision can mutate completed stages | `debate-plan-revision.js::applyCommand`, `CHANGE_PARTICIPANT` loops all stages | IMPLEMENT completed-stage immutability |
| Goal conflict detection omits CANCEL+REOPEN for one goal | `debate-plan-revision.js::detectConflicts` has stage/constraint/policy maps only | IMPLEMENT goal conflict map |
| Planner repetition fingerprint is incomplete | planner uses `goal.type|targetArtifactIds`; orchestrator uses `stage.purpose|inputArtifactIds` and fixed window 6 | IMPLEMENT canonical full fingerprint and policy window |
| `applyIntervention` mutates versions after duplicate finalization | `debate-orchestrator.js::applyIntervention` increments versions after `STOP_RUN` | IMPLEMENT finalized guard and version event |

## Already implemented; retain as regression baseline

- Pipeline barrier settles terminal participant failures.
- FreeTalk opening dropout excludes failed participants from later dispatch.
- FreeTalk repair skips current terminal failures.
- Universal production wiring hard gate exists.
- RunStore serialization preserves protocol Sets.
- Round-stepper hotfix has a single button-state synchronization function.

## Verification conclusion

The original `[V]` items are sufficiently resolved to start implementation. The first architectural task is the transactional protocol transition boundary, followed by application-owned cancellation and bounded opening retry.

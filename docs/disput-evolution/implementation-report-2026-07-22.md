# Mandatory LLM Implementation Report — 2026-07-22

## Hotfix (после полевого теста): barrier deadlock при terminal failure участника

Симптом: 2 из 3 моделей ответили, третья (terminal failure после recovery) держала opening barrier; run оставался `running`. Исправления:
1. `results.js` pipelineWaiter: терминальное сообщение без usable text теперь **settles** участника (`failed[model]`), батч резолвится по all-settled, а не all-successful (tests/pipeline-waiter-settlement.test.js).
2. `disput/free-talk-runner.js`: dropout handling на opening stage — BARRIER_PARTICIPANT_FAILED / DROPOUT_* события, учёт `failurePolicy` (skip_stage→continue, fail_run→stop, ask_user→resolveParticipantDropout с default **continue degraded**, не бесконечное ожидание), выбывшие исключаются из последующих dispatch, уведомление пользователю (tests/free-talk-dropout.test.js).
3. Repair не диспатчится терминально выбывшим участникам (нечего чинить — только contract violations).

Известное ограничение: если выбыл сам synthesizer, synthesis-стадия ещё диспатчится ему (теперь быстро settle-ится как failure, но alternate-synthesizer fallback для FreeTalk не реализован — в отличие от Duel/Multi).

Прогон: `npx jest --config tests/jest.config.js` → 160 suites / 979 tests, все проходят.

## Hotfix 2: Round-stepper +/− (panel-header), default length, Auditor/Actions removal

1. **Auditor/Actions removal (Technical Specification v1.0)**: удалены `debate-auditor-select` (UI, user config, plan-compiler audit-stage auto-creation, plan-validator auditor checks), pipeline-presets/runners больше не принимают `input.auditor`. Audit capability сохранена как universal Stage (`debate-run-services.js`, `SYNTHESIS_AUDIT` rule) — не тронута. Actions selector отсутствовал в кодовой базе (NOT APPLICABLE per §3.1). Migration warnings добавлены для старых сохранённых `overrides.auditors`/`serviceRoles.auditor`.
2. **free-talk-budget-select removed**: UI-лимит числа шагов FreeTalk убран из `pipeline_panel.html`/`result_new.html`/`results.js` по прямому запросу — control никогда не был реально enforced в runtime (`state.budget` нигде не читался), был неудачной попыткой ограничения.
3. **Round-stepper `+`/`−` fix**: `syncPipelineChromeControls()` (results.js) содержала независимую, устаревшую (от прежнего назначения кнопки — "добавить колонку раунда") логику `pipelineAddRoundBtn.disabled = !editable`, выполнявшуюся ПОСЛЕ `syncDebateRoundStepperUi()` в каждой цепочке клика и перетиравшую её решение только для `+` (минус не трогался). Итог: `+` мог оставаться включён на устаревшем/несинхронизированном значении select при неприменимом для пресета round-limit, `−` управлялся только правильной функцией и часто оставался disabled — асимметрия воспринималась как "+3 вместо +1, минус не работает". Исправление: `syncDebateRoundStepperUi()` — единственный источник истины, `editable` остаётся дополнительным (не подменяющим) ограничением для обеих кнопок одинаково. Подтверждено через jsdom-харнесс с реальной разметкой pipeline_panel.html: `3 → 4 rounds` чистым шагом, кнопки синхронны.
4. **Default answer length 300**: `debate-length-select` default `500 → 300` (`pipeline_panel.html`, `results.js:getPipelineProtocolConfig` fallback).

## Universal Production Wiring Contract v1.0 (в процессе; см. §"Пре-rollout blockers")

Обнаружен при попытке спланировать dark-launch (Removal Gate §21 требует §19 Behavioral Parity, для которой нужен реальный трафик через universal path).

**Найденные разрывы**:
- Production `deps` для `DebateApplication` (`results.js:7120`) не содержат ни одного из 7 обязательных портов (`runModelBatch`, `compilePrompt`, `acceptResponse`, `extractArtifacts`, `proposeStateDelta`, `commitStateDelta`, `projectStateMap`) — только `startFromPage`/`createId`/`cancelTransport`.
- **Критический baseline-bug** (не зависит от rollout, существовал изначально): `commitStageResult` в `debate-orchestrator.js` по умолчанию считает delta применённым (`{applied: true}`) если `commitStateDelta` не передан — false positive semantic commit: `caseVersion`/`stateMapVersion` растут, goals резолвятся, хотя реального изменения state не произошло.
- `executor.execute(stage, {signal})` — Orchestrator передавал StageExecutor только abort signal, без `debateCase`/`stateMap`/`openGoals`/`constraints` — `compilePrompt` не мог собрать содержательный prompt без обращения к legacy globals (запрещённый hidden coupling).
- `DebaseCase` (создаётся в `createUniversalRun`) не содержит `problemSpec`/`taskContract` полей, необходимых `DebatePromptCompiler.compile({task, stage, model, map})` — существующему topology-neutral compile-примитиву (в отличие от `DebatePromptCatalog`, который topology-specific).

**Сделано (Hotfix 2)**:
1. `disput/debate-orchestrator.js` `executeStage()`: `executionContext` расширен до `{signal, debateCase, stateMap, openGoals, constraints, attachments, caseVersion, stateMapVersion, planRevisionId}`.
2. `disput/debate-application.js` `createUniversalRun()`: hard-fail gate `assertProductionWiringComplete()` — при `universalEnabled() === true` и отсутствии обязательного порта бросает `UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE` с `error.missingPorts` до первого LLM-вызова. Пропускается только явным `options.allowIncompleteWiring` (для unit-тестов, не для production). `repairPrompt` не входит в обязательные (opt-in retry, отсутствие не создаёт false-positive commit).
3. `tests/debate-universal-production-wiring.test.js` (6 тестов): fully-wired проходит, отсутствие любого порта — explicit throw с корректным списком, флаг выключен — gate не применяется (legacy untouched), `allowIncompleteWiring` работает, custom `stageExecutor` освобождает от per-stage-executor портов но не от `commitStateDelta`/`projectStateMap`.
4. `tests/debate-application-universal.test.js`: добавлен `allowIncompleteWiring: true` (тест намеренно проверяет dispatch/validation на минимальных моках, не полноту wiring).

**НЕ сделано** (per GPT roadmap "Universal Production Wiring and Semantic Commit v1.0", согласовано как отдельный bounded work item до фактического dark-launch):
- Composition-root модуль (`debate-universal-production-ports.js`), собирающий 7 портов из существующих shared-примитивов вместо ad hoc сборки в `results.js`.
- Canonical artifact/state-delta pipeline (`debate-artifact-pipeline.js`): response → Artifact[] → StateDelta → validated commit → StateMap projection. Прямого topology-neutral эквивалента в `debate-run-services.js`/`debate-context-assembly.js` нет — требует нового кода, не адаптера.
- Prompt-compiler adapter: Universal StageInstance → `DebatePromptCompiler.compile()` input; включает расширение `DebateCase` схемы `problemSpec`/`taskContract` полями.
- Реальное подключение `deps` в `results.js:7120` (заблокировано предыдущими тремя пунктами — подключать сейчас означало бы семантически ложный prod-run).
- Dark-launch/shadow-comparison harness со структурными инвариантами (lifecycle completion, participant coverage, artifact completeness, failure semantics, pause/continue correctness, intervention handling, terminal-state consistency) — GPT roadmap п.3.
- §19 Behavioral Parity Review, §21 Removal Gate formal evaluation, §22 Physical Removal — все остаются BLOCKED, порядок не нарушен.

## Новые модули

| Модуль | Файл | Тесты |
|---|---|---|
| Policies + Validation Contract | disput/debate-policies.js | tests/debate-policies.test.js |
| Plan Revision | disput/debate-plan-revision.js | tests/debate-plan-revision.test.js |
| Planner (rule engine, utility, conflict resolver, participant selector, goal generator, finalization evaluator — в одном модуле) | disput/debate-planner.js | tests/debate-planner.test.js |
| StageExecutor + adapters (llm/human) | disput/debate-stage-executor.js | tests/debate-stage-executor.test.js |
| Orchestrator | disput/debate-orchestrator.js | tests/debate-orchestrator.test.js |
| Application integration + флаги | disput/debate-application.js, disput/disput-evolution-flags.js | tests/debate-application-universal.test.js, tests/disput-evolution-gates.test.js |

## 1. Technical Architecture Roadmap v1.0

- Slice A (Contracts): DONE — 5 документов в docs/disput-evolution, README со статусами.
- Slice B (DebateCase-first): PARTIAL — новый path создаёт DebateCase → Initial Revision → Run → Orchestrator строго до runtime (тест «startRun requires a pre-created DebateCase»); legacy path не переведён на case-first.
- Slice C (StageExecutor): DONE как модуль; dynamic runner НЕ делегирует ему (PARTIAL по slice-критерию).
- Slice D (Planner MVP): DONE — rule-based, deterministic, без LLM, без topology branching.
- Slice E (Persistent Pause/Continue): DONE в новом path — QUIESCING/PAUSED, snapshot, recovery после «reload» (тест «run survives reload»). Legacy Promise-waiters не удалены (используются legacy path).
- Slice F (Human Participant): DONE в новом path — human adapter → awaiting_participant → submitParticipantResponse → StateDelta → goal resolution; intervention отделён от response.
- Slice G (Plan Revisions): DONE.
- Slice H (Canvas Commands): PARTIAL — командная поверхность DebateApplication (insertStage/removePlannedStage/changeParticipant/changePolicy/requestSynthesis/requestAudit/insertHumanStage); UI Canvas не подключён.
- Slices I/J/K (legacy migrations): NOT SWITCHED — capabilities реализованы в новом executor/planner (barrier, quorum, partial, retry, repair, dropout, sequential, audit), но production-переключение presets не выполнено (флаги off).
- Slice L (Legacy Removal): BLOCKED — removal gate не пройден (см. ledgers/shared-ledgers.md).
- Slice M (Enforcement): PARTIAL — gate-тесты для нового path (tests/disput-evolution-gates.test.js); полный repo-grep gate возможен только после Slice L.
- Feature flags §15: DONE — 10 slice-флагов, default off, аудит переключений.
- Key risks §18: монолитный runner не создан (Planner/Orchestrator/Executor раздельны); dual execution существует временно за флагами — это by design Strangler Fig, legacy развитие после switch запрещено контрактом.

## 1.1 Legacy Capability Extraction Contract v1.1

- Source Maps: DONE для Duel/Triad/Multi/FreeTalk (docs/disput-evolution/ledgers/).
- Capability Ledgers: DONE (7 ledgers, включая Shared/UI/Prompt).
- Constraint Inventory: DONE — каждое ограничение имеет решение (KEEP_AS_EXPLICIT_POLICY / REMOVE_AS_LEGACY / REPLACE_WITH_CAPABILITY_RULE).
- Hidden limits: найден `normalizedModels.slice(0, 2)` в debate-plan-compiler.js:99 (Duel scenario builder) — классифицирован REPLACE_WITH_CAPABILITY_RULE; в новом path отсутствует. FreeTalk runtime скрытого лимита «2 участника» не содержит (проверено grep); UI-инвентаризация панели pipeline — открытый пункт.
- ParticipantCardinalityPolicy §8.5: DONE — minimum/maximum/recommended/reason, maximum=null по умолчанию; тесты 2/3/4/7 участников.
- Configuration Validation Contract §18: DONE — DebatePolicies.validateConfiguration, один источник для UI и runtime, отказы с policyId/actual/allowed (тест «UI and runtime reject with the same traceable policy error»).
- Characterization tests §14: существующие runner-тесты (duel/triad/multi/free-talk) сохранены и проходят — выполняют роль characterization для legacy behavior.
- Behavioral Parity §19 / Production Switch §20 / Removal Gate §21 / Physical Removal §22: NOT DONE — legacy path остаётся primary; удаление запрещено контрактом до parity verification в production и architecture review. Подтверждаю: ни один legacy модуль НЕ удалён.
- Repository Enforcement §23: PARTIAL — gates для нового path: запрет topology-терминов, запрет hidden limits, единственный источник cardinality, запрет импорта runners, default-off флаги.

## 2. Orchestrator Contract v1.0 — Definition of Done (§25)

1. Single execution owner — DONE (lease, тесты second-tab/expired/takeover).
2. Recovery после reload — DONE (snapshot + event replay).
3. Continue без Promise/closure — DONE (reconstruction: reconcile → invalidate → replan).
4. QUIESCING — DONE.
5. Нет stages после PAUSE_REQUESTED — DONE (тест).
6. Planner tick сериализован — DONE (tickInFlight + one-tick test).
7. Stage только после persisted PlanningDecision — DONE (порядок событий проверен тестом).
8. Idempotency key транспорта — DONE (`runId:stageInstanceId:attempt:participantId`).
9. Атомарный semantic commit — DONE (commitStageResult: delta → caseVersion → goal → terminal event).
10. StateDelta по optimistic case version — DONE (STATE_DELTA_STALE).
11. Revision activation сериализована — DONE (expectedRevisionId + REVISION_STALE).
12. Late responses reconciled — DONE (finish_received_only → LATE_RESPONSE_RECORDED → reconcile).
13. Единый finalization path — DONE (включая STOP_RUN intervention; duplicate finalization idempotent).
14. Event log достаточен для recovery — PARTIAL: recovery восстанавливает state из snapshot + валидирует непрерывность sequence; полный event-sourced rebuild без snapshot не реализован (fatal CORRUPTED_EVENT_SEQUENCE есть).
15. Нет topology branching — DONE (gate-тест).
16. Нет содержательных planning decisions — DONE (все стадии из PlanningDecision).

## 3. Planner Contract v1.0 — Architecture Confirmation (§29.3)

1. Planner не вызывает LLM — ПОДТВЕРЖДАЮ.
2. Не вызывает transport — ПОДТВЕРЖДАЮ.
3. Не мутирует DebateCase — ПОДТВЕРЖДАЮ (pure evaluate, frozen decision).
4. Не создаёт persisted Stage — ПОДТВЕРЖДАЮ (ProposedStage; StageInstance создаёт Orchestrator).
5. Не использует topology — ПОДТВЕРЖДАЮ (gate-тест).
6. Все решения имеют rationale — ПОДТВЕРЖДАЮ (rationaleCode обязателен, NO_OP включительно).
7. Version metadata — ПОДТВЕРЖДАЮ (ruleSet/algorithm/utility/goalSchema/stateMapSchema versions).
8. Детерминированные конфликты — ПОДТВЕРЖДАЮ (tie-break: blocker → dependents → createdAt → cost → goalId; тест identical input → identical output).
9. Finalization не в runner — ПОДТВЕРЖДАЮ (FinalizationDecision из Planner, policy-driven).
10. Synthesis не обязателен — ПОДТВЕРЖДАЮ (STATE_MAP/ARTIFACTS_ONLY terminal outcomes, тесты).

Статусы по разделам: §5 tick lifecycle DONE; §6 Goal model/lifecycle/dedup DONE; §7 derived goals DONE (все условия); §8 rule model PARTIAL — правила встроены как goal-type→purpose mapping с ruleId/version, отдельный конфигурируемый RuleSet DSL не реализован; §9 utility DONE (все 11 компонент + breakdown); §10 conflict resolution DONE; §11 ProposedStage DONE; §12 participant selection DONE (capability, independence, degraded, capacity); §13 HumanDecisionRequest DONE; §14 stagnation DONE; §15 repetition DONE; §16 budgets DONE (пер-tick, concurrent, total, model calls, cost, time); §17 finalization DONE; §18 synthesis planning DONE; §19 audit planning DONE; §20 compaction DONE (derived goal); §21 WAIT/NO_OP DONE; §22 LLM advisory — NOT APPLICABLE (MVP, запрещён); §24 observability PARTIAL — trace-поля в decision полные, метрики-агрегаты не реализованы.

## 4. Plan Revision Specification v1.0 — Acceptance (§29)

1. Immutable — DONE (deepFreeze, тест).
2. Единственная Active — DONE.
3. Все изменения через Revision — DONE в новом path.
4. Canvas не меняет Runtime — DONE (команды только через DebateApplication → validation → Revision).
5. Human → только Revision Commands / Interventions — DONE.
6. Planner использует только Active Revision — DONE (activePlanRevision в input; cancelled goals из metadata).
7. StageExecutor не знает о Revision — DONE (в модуле нет упоминаний revision).
8. Dependency Graph как механизм affected stages — DONE (upstream/goal closure, транзитивно).
9. Running Stage Policy централизована — DONE (FINISH/CANCEL/IGNORE_RESULT/RESTART/CONVERT_TO_AUDIT валидируются; применение FINISH/CANCEL/IGNORE_RESULT реализовано, CONVERT_TO_AUDIT/RESTART — PARTIAL, только фиксация policy).
10. Continue использует последнюю Active Revision — DONE (reconcile инвалидирует stages чужих revisions).
11. Трассировка — DONE (trace в REVISION_ACTIVATED).
12. Тесты §28 — DONE: create/activate/supersede/archive, все 17 команд, closure, stale+retry, hydrate/recovery, conflict batch.

Известные ограничения: Budget Validation в pipeline §9 — hook (validateDraft), собственных budget-правил нет; Semantic Stability §23 — реализован предикат requiresRevision, интеграция с Canvas UI отложена до Slice H.

## Removal Confirmation (Extraction Contract §28.6)

1. Legacy path больше не вызывается — НЕТ: вызывается, это соответствует стадии миграции (флаги off).
2. Hidden limits отсутствуют — в новом path отсутствуют (gate); в legacy остаётся plan-compiler slice(0,2) до Slice J.
3. Topology-specific branching не добавлено — ПОДТВЕРЖДАЮ.
4. Capability не потеряны — ПОДТВЕРЖДАЮ (ничего не удалялось).
5. All gates pass — новые gates проходят; removal gate НЕ пройден (осознанно, по контракту).

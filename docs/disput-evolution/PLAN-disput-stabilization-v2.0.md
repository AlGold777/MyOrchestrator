# План стабилизации Disput v2.0

Объединяет: TZ-legacy-hardening-v1.0 (Claude review) + подтверждённые пункты GPT-ТЗ, Z.ai review, Qwen review.
Каждый пункт из внешних ревью верифицирован по коду перед включением; неподтверждённые помечены `[V]` — верификация входит в задачу первым шагом. Отклонённые пункты — в §5.

Инварианты на весь план:
- `universalEngine: false` до Этапа 4. Legacy runners не удаляются до Removal Gate.
- Каждая задача = код + тест. Полный прогон `npx jest --config tests/jest.config.js` зелёный после каждой задачи.
- Ни один пункт не закрывается только на unit-моках, если помечен `[E2E]`.

---

## Этап 1 — Production path (legacy): устранение дефектов

### S1.1 AbortError semantics — все runners
Файлы: `disput/duel-runner.js` (:417, :531 подтверждены), `disput/triad-runner.js`, `disput/multi-runner.js`, `disput/free-talk-runner.js`; зоны: dispatch, retry, dropout, checkpoint, synthesis, audit, repair.
Дефект: catch-блоки интерпретируют отмену как participant failure → retry/dropout/degraded после cancel.
Fix: первой строкой каждого catch: `if (error?.name === 'AbortError' || input.signal?.aborted) throw error;`
Инвентаризация: в отчёте перечислить каждый catch каждого runner'а: guard добавлен / был / не нужен (причина).
Тест: `tests/legacy-abort-semantics.test.js` — abort из runModelBatch на каждой стадии каждого runner'а → run CANCELLED; нет BARRIER_PARTICIPANT_FAILED / DROPOUT_* / retry-вызовов; нет LLM-вызовов после abort.
AC: cancel на opening / public turn / synthesis / checkpoint → CANCELLED без dropout-событий.

### S1.2 FreeTalk: retry без рекурсии + лимит (Z.ai BLOCKER 2.1 подтверждён)
Файл: `disput/free-talk-runner.js:211` (`return runner.start(input)`).
Дефект: full-run restart изнутри активного start(); retry без счётчика — при стабильном 'retry' от резолвера бесконечная рекурсия. Существующий тест маскирует (mock отдаёт 'retry' один раз).
Fix:
1. Retry повторяет ТОЛЬКО opening-batch (тот же runId, существующий aggregate, новый stageAttemptId), не `start()`.
2. `state.dropoutRetryAttempts` с лимитом 1; после лимита — dropout-политика (continue degraded / stop).
3. Запрещено: повторный aggregate init, повторный `RUN_CREATED`/`transition('RUNNING')`/`appendModerator`/`setRunPresentation`.
Тест: расширить `tests/free-talk-dropout.test.js`: (a) резолвер всегда 'retry' → ровно 2 opening-dispatch, затем dropout-политика, без переполнения стека; (b) retry не создаёт второй RUN init (aggregate init один раз); (c) runId неизменен.
AC: GPT 3.2 acceptance criteria 1–5.

### S1.3 FreeTalk: fallback synthesizer / завершение без синтеза
Файл: `disput/free-talk-runner.js` (:423 throw; синтезатор — константа из input).
Fix:
1. Перед synthesis: если synthesizer ∈ droppedModels или ∉ живых `models` — выбрать замену из живых; событие `SYNTHESIZER_REASSIGNED {from,to}` + notify.
2. Нет живых или synthesis (после одной repair-попытки) не дал usable text → существующий путь `synthesizer_none`: COMPLETED, `finalization.synthesis=false`, `epistemicOutcome='inconclusive'`, reason `synthesis_unavailable`, `handleTerminalOutputs`, `finalizeRuntime`. `throw` удалить.
Тест: `tests/free-talk-synthesizer-fallback.test.js`: переназначение + событие; все мертвы → COMPLETED без синтеза, terminal outputs вызваны; синтез после переназначения попадает в verdict.
AC: терминальный отказ синтезатора никогда не даёт FAILED run.

### S1.4 FreeTalk: mid-run terminal dropout
Файл: `disput/free-talk-runner.js`, action-цикл (:357-360; `actionResult.failed` не читается).
Fix:
1. После каждого action-batch: модели из `actionResult.failed` (только терминальные) → `state.droppedModels`, исключить из `models`; события BARRIER_PARTICIPANT_FAILED + DROPOUT_CONTINUE_SELECTED (или policy-ветка как в opening); notify.
2. Acceptance-failure / пустой нетерминальный ответ → как сейчас (`settleTask('failed')`), БЕЗ исключения участника.
3. `models` пуст → завершение по S1.3.2.
Тест: расширить `tests/free-talk-dropout.test.js`: терминальный mid-run отказ → модель отсутствует во всех последующих batch; acceptance-failure → модель остаётся.
AC: мёртвая модель не получает назначений после первого терминального отказа; разные reason codes для terminal vs invalid.

### S1.5 ask_user без резолвера — явная семантика (Z.ai 2.2 подтверждён)
Файлы: `disput/free-talk-runner.js` (dropout-ветка), `results.js:7120` (deps).
Дефект: `resolveParticipantDropout` не передан в production deps → `ask_user` молча деградирует в continue; DROPOUT_DECISION_REQUESTED без потребителя.
Fix (минимальный, без нового UI): при `failurePolicy='ask_user'` и отсутствии резолвера — событие `DROPOUT_RESOLVER_MISSING`, notify пользователю «продолжаем без X (авторешение: resolver не подключён)», продолжение degraded. Молчаливого пути нет — расхождение видно в телеметрии и UI.
Тест: dropout при ask_user без резолвера → событие + notify + continue.
AC: ask_user никогда не деградирует бесследно.

### S1.6 Repair не диспатчится терминально мёртвым — Duel/Triad/Multi (переформулированный Z.ai 2.4)
Файлы: `disput/duel-runner.js`, `disput/triad-runner.js`, `disput/multi-runner.js` — repair-ветки (final words repair, synthesis repair, audit repair, wave repair).
Дефект: `result.failed` игнорируется — repair/повторные вызовы уходят моделям с терминальным транспортным отказом (в FreeTalk уже исправлено).
Fix: перед каждым repair-dispatch фильтровать участников по `result.failed`; терминально мёртвым repair не отправлять (их обрабатывает существующая dropout-логика).
Тест: `tests/legacy-repair-terminal-skip.test.js` — терминальный отказ → repair-batch не содержит модель (по каждому runner'у).
AC: ни один repair-вызов не адресован модели из `failed`.

### S1.7 Recovered run — honest non-resumable [E2E]
Файлы: `results.js` (~:4759 recovery, `updateDebateButtonsUi`, run-toggle handler).
Дефект: после reload continuation мёртв для всех topology (closures); UI показывает рабочий Resume; противоречие флагов `pipelineRunActive=false` + `debatePaused=true`.
Fix:
1. Recovered run → состояние `RECOVERED_NONRESUMABLE` (использовать существующий `activePipelineRunContext.recovered`), reason `execution_context_lost`.
2. Toggle-click для recovered: НЕ снимать pause; notify «Run восстановлен после перезагрузки и не может быть продолжен. Экспортируйте результаты или начните новый run»; title кнопки «Recovered».
3. Доступны: transcript, state map, экспорт, закрытие run, новый run. Новый UI не добавлять.
Тест: jsdom — recovered aggregate → click → pause не снят, notify показан; экспорт работает.
AC: GPT 3.5 acceptance criteria 1–4.

### S1.8 Round-limit control — data-атрибут
Файлы: `pipeline_panel.html` (:260 `.debate-round-control`), `result_new.html` (:971 `.debate-turn-limit`), `results.js` (`syncDebateSchemeUi` ~:19679).
Дефект: код ищет `.debate-select-wrap` — промах на обеих страницах (обёртки разные), fallback на `<select>` маскирует.
Fix: `data-debate-round-limit-control` на обе обёртки; `closest('[data-debate-round-limit-control]')`; fallback на select удалить. Проверить остальные `closest('.debate-select-wrap')` в Disput-зоне.
Тест: unit — атрибут присутствует в обоих HTML; `syncDebateSchemeUi` скрывает именно wrapper.

### S1.9 Fail-fast production composition (GPT 4.1, Qwen §8)
Файлы: новый `disput/debate-composition-validator.js`; вызов в `results.js` до `createApplication`.
Дефект: service-locator `root.X || require || null` — пропущенный `<script>` = тихий null и поздний runtime-крах.
Fix: `validateDisputProductionComposition({DebateRunStore, DebateProtocols, DebatePromptCatalog, DebatePromptCompiler, DebateResponseAcceptance, DebateRunServices, runners, runModelBatch, ...})` — проверка наличия, обязательных методов, VERSION (отсутствие → `VERSIONED_DEPENDENCY_MISSING`). Ошибка блокирует запуск run c именем модуля; LLM-вызовы невозможны.
Тест: удаление зависимости из композиции → fail-fast с именем модуля; полная композиция → проходит.
AC: GPT 4.1 acceptance criteria 1–4.

### S1.10 Response acceptance — false rejections (Qwen §5 подтверждён: debate-response-acceptance.js:39-41)
Файл: `disput/debate-response-acceptance.js`.
Дефекты: `incomplete_ending` только по пунктуации последней строки (>3 слов без ENDING-знака → reject); `truncation_marker` по нечётному числу fences; required sections только `## Name` [V — проверить формы].
Fix:
1. `incomplete_ending` — только комбинация признаков: незакрытый fenced block / незакрытая JSON-структура / явный truncation marker / transport-metadata partial. Пунктуация сама по себе — не критерий.
2. Required sections: принимать `## S` / `### S` / `**S**`; точный heading — только если явно требует stage contract [V].
3. Reason code всегда содержит конкретное правило.
Тест: расширить существующий acceptance-тест: полный ответ без точки в конце — принят; незакрытый fence — отклонён; partial transport — отклонён; все формы заголовков секций — приняты.
AC: GPT 5.1 acceptance criteria 1–5.

### S1.11 Provenance anchors (Qwen §13 подтверждён: debate-state-delta.js:39-41)
Файл: `disput/debate-state-delta.js`.
Дефект: порог 3 символа + `source.includes(quote)` — короткие слова валидируются как цитаты.
Fix: минимум 20 символов ИЛИ 4 lexical tokens; проверка по конкретному turnId; reject ambiguous multiple match (цитата встречается в нескольких turn'ах без offsets); reject цитаты из чужого turn.
Тест: короткое слово → reject; цитата из другого turn → reject; изменение source → anchor инвалиден.
AC: GPT 6.1 acceptance criteria.

### S1.12 Protocol transition wrapper (GPT 3.4, Qwen §1)
Файлы: новый helper в `disput/debate-protocols.js` или отдельный модуль; runners.
Дефект: мутирующий FSM + ручной `syncState` — пропуск вызова = тихое расхождение protocol state / aggregate. Полный immutable rewrite НЕ выполняется.
Fix:
1. `applyProtocolTransition({runId, transitionName, protocolState, payload})`: transition → syncState → событие `PROTOCOL_STATE_SYNCED` → инкремент `protocolRevision`.
2. Прямые mutating transitions из runners — запрещены; repo-gate тест (grep) на прямые вызовы.
3. Комментарии «Pure (no DOM/chrome)» в `debate-runtime.js` исправить на фактические («mutable FSM, no DOM/chrome»).
Тест: transition через wrapper → aggregate синхронизирован, revision увеличен; намеренный пропуск sync → тест падает; repo-gate на прямые вызовы.
AC: GPT 3.4 acceptance criteria 1–4.
Замечание объёма: правка всех call sites в 4 runners — самая широкая задача этапа; выполнять последней в Этапе 1.

### S1.13 Transcript: единственный владелец recovery (GPT 3.3, Qwen §2) [V]
Файлы: `disput/debate-engine.js`, `disput/debate-run-store.js`, `disput/debate-projections.js`, `results.js` recovery.
[V] Верифицировать: DebateEngine персистит sessions/turns независимо (`llmCortexDebateEngineState.v1`) и recovery объединяет два источника.
Fix (вариант B из GPT — временный, меньший объём):
1. DebateEngine-кэш хранит `projectionSourceVersion + eventSequence + runId`; несовпадение с DebateRunStore → полный rebuild из event stream через DebateProjections.
2. Прямые записи в DebateEngine вне projection-пути — событие/warning (инвентаризация `appendTurn` call sites).
3. Qwen §9 (Set → `JSON.parse(JSON.stringify)` в `debate-engine.js::clone` теряет Set) — проверить пересечение protocol state с clone(); при подтверждении — использовать существующий encode/decode из run-store.
Тест: удаление DebateEngine-кэша не меняет восстановленный transcript; несовпадение eventSequence → rebuild; turn не может существовать только в DebateEngine.
AC: GPT 3.3 acceptance criteria 1–5.
Вариант A (полный rebuilding projection) — Этап 2.

---

## Этап 2 — Декомпозиция legacy (после зелёного Этапа 1)

### S2.1 Единый dropout handler
Дублирование dropout-логики ×4 в `duel-runner.js` (Qwen §3) и по разу в triad/multi/free-talk → общий `handleParticipantDropout({state, stageId, failedModels, remainingModels, policy, resolve})`. Поведение бит-в-бит (characterization-тесты до рефакторинга).

### S2.2 Общий checkpoint executor (GPT 7.1, Qwen §7)
`runCheckpoint`/`runDuelCheckpoint` (~90% дублирования) → `executeCheckpoint({runId, topology, state, turns, checkpointNumber, stageId, synthesizer, context, signal})` в `debate-run-services.js`. Topology-код: условие запуска, выбор turns, cadence, transition.

### S2.3 Общий stage execution template (GPT 7.2)
Pipeline: dispatch → transport classification → AbortError → acceptance → repair/retry → terminal failure → commit. Применить к opening/public turns/final words/synthesis/audit/checkpoints. Retry policy из stage contract. `requestFinalWords` в duel разделить на dispatchFinalWords → dispatchSynthesis → dispatchAudit → finalize.

### S2.4 Lifecycle command router (GPT 11.1)
`runController.dispatch({runId, command, expectedLifecycle})`, команды START/PAUSE/RESUME/APPROVE/CONTINUE/CANCEL/FINALIZE. Заменяет probing четырёх глобальных callbacks (`debateApprovalBridge`, `resumeAutoSerialDebate`, `__resumeAutoTriad`, `multiContinuationResolver`). Continuation-реестр: `continuations.set(runId, {topology, reason, resolve, reject})` — закрывает shared-slot Multi/FreeTalk.

### S2.5 JSDoc contracts + checkJs (GPT 12, Qwen §11)
Только: events/payloads, StageContract, TaskContract, ActionContract, Artifact, StateDelta, StateMap, lifecycle, transport result, participant failure. Reducer — discriminated union по event.type. Без TypeScript-миграции.

---

## Этап 3 — Universal pre-rollout (параллельно Этапу 2 допустимо)

Сделано ранее (не повторять): execution context executor'а расширен (debateCase/stateMap/openGoals/constraints/versions); hard-gate `UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE` + `allowIncompleteWiring` + тесты.

### S3.1 Silent degradation при universalEnabled && !modulesReady (Z.ai 5.2 подтверждён)
Файл: `disput/debate-application.js:154`.
Fix: `universalEnabled() && !universalModulesReady()` → throw `UNIVERSAL_MODULES_UNAVAILABLE` (не тихий legacy fallback).
Тест: флаг on + отсутствующий модуль → ошибка, legacy не вызван.

### S3.2 Fingerprint unification (Z.ai 3.2c подтверждён: orchestrator:286 vs planner:296)
Fix: единый формат `${goal.type}|${targetArtifactIds}` в обоих местах (orchestrator при commit знает goalIds стадии — брать первый goal, либо писать оба формата в отдельные поля). Инкремент PLANNER_ALGORITHM_VERSION.
Тест: повтор одинаковой goal-стадии → `repeated()` срабатывает; duplicationPenalty применяется.

### S3.3 Lease renewal во время stage + lease-check перед commit (Z.ai 3.1a подтверждён: renewLease только :379)
Fix: renewal-интервал на время `executeStage` await (или `assertLease()` в начале `commitStageResult` с веткой `LEASE_LOST` — результат не коммитится, событие пишется).
Тест: lease истекает во время stage → commit отклонён LEASE_LOST; второй владелец не получает двойной записи.

### S3.4 Real event replay (GPT 10.1) [V]
[V] Верифицировать: recovery применяет post-snapshot события к state или только валидирует sequence.
Fix: детерминированный `reduceEvent(state, event)` для каждого persisted типа; unknown type → recovery failure, не молчание; gap → fatal (есть).
Тест: recovery со snapshot == recovery полным replay (property-based на записанном event log); post-snapshot события применены.

### S3.5 Stale result protection (GPT 10.2)
Fix: stage attempt несёт `attemptId, caseVersion, stateMapVersion, planRevisionId`; перед commit — сверка всех; несовпадение → `STAGE_RESULT_REJECTED_STALE`, state не меняется.
Тест: intervention во время executeStage → результат стадии отклонён stale.

### S3.6 Step-budget semantics (GPT 10.3, Z.ai 3.1c) [V]
[V] Верифицировать поведение `runLoop(maxSteps=50)` при исчерпании.
Fix: lifecycle НЕ остаётся RUNNING: `WAITING_FOR_CONTINUATION` + событие `STEP_BUDGET_REACHED` (для UI-продолжения). maxSteps — из policies, не магическое число.

### S3.7 ask_user semantics в universal (GPT 10.7)
Fix: ask_user без резолвера → `WAITING_FOR_USER` (persisted HumanDecisionRequest) или `CONFIGURATION_ERROR`; авто-continue запрещён.

### S3.8 Feature flags fail-closed (GPT 10.6)
Fix: `enabled(name)` для неизвестного имени → configuration error (не false).
Тест: опечатка во flag name → ошибка.

### S3.9 Мелкие подтверждённые дефекты universal-модулей (Z.ai 3.x)
- `applyIntervention` бампает версии без emit (:475) → писать событие [V].
- `recoverRun` sequence: явная дедупликация `<=` continue / `>+1` fatal [V].
- `withTimeout`: fast-path `signal.aborted`, clearTimeout при resolve (stage-executor:73-82).
- `seenIdempotencyKeys`: cleanup по завершении стадии.
- `invalidateStages`: running stages в affected set → явный `RUNNING_AFFECTED`, применение runningStagePolicy [V — проверить ветку orchestrator:657].
- `trace.affectedGoals` → `.filter(Boolean)`.
- `partial` executionStatus: не мапить в stage.status='completed' без пометки; goal при partial → отдельная обработка, исключить бесконечный reopen-цикл [V].
- `establish_position`: cap участников на стадию (`maxParticipantsPerStage` в policies).
- `dependentsOf`: транзитивный подсчёт (closure по blockedByGoalIds).
- `validateConfiguration`: расширить на pause.mode / retry.maxAttempts / completion.mode (валидация значений enum/диапазонов).
Каждый — с точечным тестом. Версионные константы бампать (memory rule).

### S3.10 Production ports composition (из wiring-плана, был «НЕ сделано»)
1. `disput/debate-artifact-pipeline.js`: response → Artifact[] (deterministic IDs, schema validation, provenance) → StateDelta (validated, stale-reject) → atomic commit → StateMap projection; no-op detection.
2. Prompt-adapter: Universal StageInstance → `DebatePromptCompiler.compile()` input; расширение DebateCase полями problemSpec/taskContract.
3. `disput/debate-universal-production-ports.js`: сборка 8 портов (runModelBatch, compilePrompt, repairPrompt, acceptResponse, extractArtifacts, proposeStateDelta, commitStateDelta, projectStateMap) из существующих shared-примитивов.
4. `results.js`: только передача composition root в `createApplication` (+ persistence: IndexedDB/chrome.storage адаптер вместо memory).
Тест (hard-gate, production-композиция без моков): LLM adapter зарегистрирован; prompt ≠ `purpose:participantId`; accepted response создаёт ≥1 artifact; delta реально меняет state; no-op/rejected delta не бампает версии; final stateMap непустой; ни один порт не заглушка.

---

## Этап 4 — Rollout (по завершении Этапов 1 и 3)

1. Shadow/dark-launch: параллельный universal-run на реальном входе, без влияния на UI.
2. Структурные parity-инварианты (не текстовый diff): lifecycle completion, participant coverage, artifact completeness, failure semantics, pause/continue, intervention handling, terminal-state consistency.
3. Browser E2E gate [E2E]: start/pause/resume/cancel/intervention/dropout/synthesizer failure/retry/reload/recovery/finalization/state-map/terminal consistency.
4. Ограниченный rollout → production telemetry → §19 Parity Review → §21 Removal Gate (16 условий) → §22 Physical Removal.

---

## §5. Отклонено / отложено (с причинами)

| Источник | Пункт | Решение |
|---|---|---|
| Z.ai 2.4 | «Распространить barrier-settlement на Duel/Triad/Multi» | Переформулировано в S1.6: settlement уже общий (waiter-уровень), dropout-ветки в runners есть; реальный残 остаток — repair мёртвым |
| Z.ai 2.3 / GPT 8 | Auditor: вернуть stage либо удалить поле | Продуктовое решение, не код-фикс. До решения: зафиксировано «legacy model audit disabled до universal rollout»; поле serviceRoles.auditor остаётся (читается runner-ветками при preset-заданном auditor) |
| Qwen §4, §6 / GPT 13 | O(n²) transition, relatedIds, аллокации | Отложено: только после profiling/benchmarks (позиция GPT принята) |
| Qwen §1 | Полный immutable FSM rewrite | Отклонено на этом этапе; wrapper S1.12 (позиция GPT принята) |
| Qwen §11 / GPT 12 | TypeScript-миграция | Отклонено; JSDoc + checkJs (S2.5) |
| Qwen §10 | Линейный plan не выражает FreeTalk loop | Не фиксится в legacy; universal Planner решает by design |
| Qwen §14 | Распределённые VERSION | Покрыто memory-rule (бамп при изменении) + S1.9 (валидация наличия) |
| GPT 11.2 | «Удалить fallback на select» | Смягчено: fallback остаётся как защита от отсутствия wrapper'а, промах закрыт data-атрибутом |
| Z.ai 2.5 | Re-entrancy guard runner.start | Поглощено S1.2 (устранение рекурсии устраняет вектор) |

## §6. Порядок исполнения и контроль

Очерёдность: S1.1 → S1.2 → S1.3 → S1.4 → S1.5 → S1.6 → S1.8 → S1.9 → S1.10 → S1.11 → S1.7 → S1.13 → S1.12 → Этап 2 ∥ Этап 3 → Этап 4.
После каждой задачи: полный прогон; версии изменённых модулей бампаются; отчёт по задаче — DONE/PARTIAL/BLOCKED + файлы + тесты.
Definition of Done всего плана = GPT §16 п.1–13.

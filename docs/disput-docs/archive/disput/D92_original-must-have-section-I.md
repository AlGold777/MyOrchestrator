# D92. Исходное ТЗ: Must Have, раздел I

Дата: 2026-07-15. Основа: «Приоритизация развития Disput — версия Claude.md», раздел I.
Исполнитель: LLM-агент среднего уровня. ТЗ самодостаточно: все файлы, текущее поведение и критерии приёмки указаны. Если реальный код расходится с описанием — верить коду и отметить расхождение в отчёте, а не «подгонять» код под ТЗ.

---

## 0. Общие правила для исполнителя

**Рабочая папка:** `/Users/restart/Downloads/LLM_Sol-Fable` (не worktree). Без коммитов, пока пользователь явно не попросит.

**Архитектура (что нужно знать):**
- Это Chrome-расширение (MV3). Debate работает через веб-интерфейсы чужих LLM (вкладки), фоновая часть — `background/`, протокольная логика Debate — `disput/`, UI/рантайм страницы результатов — `results.js` + `results-shared.js`.
- Топологии: `duel` (2 модели, последовательные ходы), `triad` (3 модели, волны), `multi` (N моделей, волны). Пресеты и roundPlan — `disput/pipeline-presets.js` (`BUILTIN_PIPELINE_DEFINITIONS`).
- План исполнения компилируется в `disput/debate-plan-compiler.js` (`compile()`), валидируется в `disput/debate-plan-validator.js`. ВАЖНО: runner'ы (`duel-runner.js`, `triad-runner.js`, `multi-runner.js`) сейчас НЕ читают stages из плана — они хардкодят собственную последовательность и только генерируют stageId той же формы (`r{N}:wave`, `r{N}:turn:{i}`, `final:synthesis`).
- Промпты: `disput/debate-prompt-catalog.js` (общий каталог), `disput/disput-massage.js` (Duel-шаблоны), `disput/triad-massage.js` (Triad-шаблоны).
- Каноническое состояние run: `disput/debate-run-store.js` (event-driven store, есть `serialize`/`hydrate`, `STORAGE_KEY='llmCodexDebateRun.v1'`).
- Схема трейс-событий с correlation-ключами: `disput/debate-trace-schema.js` (`CORRELATION_KEYS` уже содержит `stageAttemptId`, `dispatchId` и т.д.).
- Диспетчеризация в фоне: `background/dispatch-coordinator.js`, `dispatch-state-machine.js`, `dispatch-retry.js`, `ready-signal-manager.js`, `pipeline-run-state.js`.

**Стиль кода:** модули — IIFE с экспортом в `root.<Name>` + `module.exports` (см. любой файл в `disput/`). `Object.freeze` для публичных API и констант. Зависимости в runner'ы передаются через объект `deps` (dependency injection) — новые зависимости добавлять туда же, не импортировать напрямую.

**Тесты:** jest, папка `tests/`. Перед началом изучить существующие тесты диспута (`ls tests/ | grep -i debate` / `grep -rl "DebatePlanCompiler\|DuelRunner" tests/`), новые тесты писать в том же стиле. Каждая задача ниже обязана добавлять тесты; `npx jest` должен быть зелёным после каждой задачи.

**Порядок выполнения задач:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12. Зависимости указаны в каждой задаче. Каждая задача = отдельный самостоятельный диф, после которого система работоспособна.

---

## T1. Реестр определений артефактов (основа для T2, T3, T9)

**Проблема.** roundPlan пресетов оперирует артефактами (`claim_ledger`, `attack_surface_map`, `defence_retest`, `residual_risk_ranking`, `positions_map`, `final_verdict` и ещё ~25 имён в `BUILTIN_PIPELINE_DEFINITIONS`), но нигде нет их определений. В промпты попадает только имя: «Обязательные filter-artifacts R1: attack_surface_map» (`disput-massage.js:28`) или «Required filter artifacts: …» (`debate-prompt-catalog.js:61`). Модель сама угадывает, что такое `attack_surface_map`.

**Что сделать.**
1. Новый файл `disput/debate-artifact-definitions.js` (тот же IIFE-паттерн, экспорт `root.DebateArtifactDefinitions`).
2. Собрать ПОЛНЫЙ список имён артефактов: пройти `BUILTIN_PIPELINE_DEFINITIONS` и `CHECKPOINT_OUTPUTS` в `pipeline-presets.js`, выписать каждый уникальный id из всех `roundPlan` и `outputs`.
3. Для каждого id — запись:
   ```js
   claim_ledger: {
     title: 'Реестр утверждений',
     purpose: 'Зафиксировать все существенные утверждения раунда с автором и статусом.',
     format: 'Markdown-таблица: | # | Утверждение | Автор | Статус (supported/challenged/withdrawn) | Основание |',
     completion: 'Каждое материальное утверждение из ответов раунда присутствует одной строкой; нет строк без автора.'
   }
   ```
   Содержание записей писать самостоятельно, по смыслу имени и протокола (Verdict / Red Team / Long — миссии см. `PROTOCOL_MISSIONS` в `debate-prompt-catalog.js:14-18`). Формат — всегда конкретная структура (таблица или нумерованный список с фиксированными полями), не «свободный текст».
4. Экспортировать функции:
   - `getDefinition(id)` → запись или `null`;
   - `renderArtifactSpec(ids)` → готовый текстовый блок для вставки в промпт: для каждого id — `### {title} ({id})\n{purpose}\nФормат: {format}\nКритерий полноты: {completion}`;
   - `listUndefined(ids)` → массив id без определения (для валидатора в T4).
5. Использовать реестр в местах, где сейчас вставляются голые имена:
   - `debate-prompt-catalog.js` → `buildRoundFilter()` (строка «Required filter artifacts: …») и `buildMultiWave()` (строка «This wave's required filter artifacts: …»);
   - `disput-massage.js` → `buildInitAPrompt`/`buildInitBPrompt`/`buildStandardTurnPrompt` (строки «Обязательные filter-artifacts …»);
   - `triad-massage.js` — найти аналогичные места (grep по `roundOutputs`).
   Подключение: каталог получает реестр через `root.DebateArtifactDefinitions || require('./debate-artifact-definitions')` — как уже сделано для `DisputMessageTemplates` в `debate-engine.js:9-11`.

**Приёмка.**
- `listUndefined(<все id из pipeline-presets>)` возвращает пустой массив — тест, который итерирует реальные `BUILTIN_PIPELINE_DEFINITIONS` и проверяет, что каждый артефакт определён (защита от будущих «голых» имён).
- Юнит-тест: `buildRoundFilter({outputs:['claim_ledger']})` содержит и заголовок, и формат, и критерий полноты.
- Файл подключён в манифест/страницы там же, где подключается `debate-prompt-catalog.js` (найти по grep `debate-prompt-catalog` в `*.html` и `manifest.json`, добавить рядом).

## T2. Стадийно-специфичные промпты вместо generic-волн

**Проблема.** В Multi все волны после первой получают один и тот же текст: «Critique and improve the previous wave…» (`debate-prompt-catalog.js:136`), независимо от того, что по roundPlan волна 2 — это `adversarial_review`, волна 3 — `defence_retest`, волна 4 — `severity_ranking`. В Duel каждый публичный ход строится `buildStandardTurnPrompt` (`disput-massage.js:82-138`) с одинаковой инструкцией «атакуй самое слабое место» — даже в раунде, который по плану является `resolution_map`/`final_verdict`.

**Что сделать.**
1. В `debate-prompt-catalog.js` добавить понятие **фазы раунда**, выводимой из roundPlan: функция `resolveStagePhase({ roundOutputs })` → одна из: `'opening' | 'critique' | 'defence' | 'resolution'`. Маппинг по артефактам раунда: если в outputs есть `positions_map`/`attack_surface_map`/`positions_cluster_map`/`attack_vector_map` → opening; `challenge_map`/`adversarial_review`/`evidence_gaps`/`hidden_assumptions`/`counterexamples`/`cross_review_matrix`/`outlier_review` → critique; `defence_retest`/`failure_modes`/`conflict_resolution` → defence; `resolution_map`/`risk_ranking`/`residual_risk_ranking`/`severity_ranking`/`weighted_synthesis`/`*_verdict` → resolution. Если outputs пуст (Long-режимы) — по номеру: 1 → opening, чётные → critique, нечётные → defence.
2. Завести `STAGE_TASKS` — по одному блоку инструкций на фазу (5–10 строк каждый), с разными задачами:
   - opening: независимая позиция, допущения, критерии решения (примерно как сейчас);
   - critique: НЕ улучшать свой ответ, а атаковать чужие позиции по существу: цитировать атакуемое утверждение, назвать тип уязвимости, дать контрпример; запрещено вводить новую собственную позицию;
   - defence: ответить на каждое возражение против своей позиции: принять (с revision), опровергнуть (с основанием) или пометить как открытый вопрос; явно перечислить, что изменилось в позиции и почему;
   - resolution: свести к финальным формулировкам: что устояло, что снято, что не решено; без новых аргументов.
3. `buildMultiWave()` — заменить тернарник `wave <= 1 ? ... : ...` на выбор блока из `STAGE_TASKS` по `resolveStagePhase`. То же для Triad-волн (найти построитель в `triad-massage.js`/`triad-runtime.js` по grep `wave`).
4. `buildStandardTurnPrompt()` (Duel) — добавить параметр `stagePhase` и заменить фиксированный блок «# Твой ход:» на блок фазы. Прокинуть фазу из места вызова: в duel-runner ход знает `route.protocolRound` и `route.roundOutputs` (см. `duel-runner.js:328-390`) — вычислить фазу там же и передать. Проследить цепочку вызова: `deps.prepareRoute` создаётся в `debate-runtime.js` или `debate-run-services.js` (найти grep'ом `buildStandardTurnPrompt`).
5. Роли участников (`PARTICIPANT_ROLES`, `debate-prompt-catalog.js:7-12`) расширить с одной строки до 3–5 строк каждая: что делает роль в каждой фазе.

**Приёмка.**
- Тест: для пресета «Multi Red Team» промпт волны 2 содержит инструкции critique-фазы и НЕ содержит текст «Critique and improve the previous wave» (старая строка удалена).
- Тест: для «Duel Verdict» (roundPlan `[['positions_map'], ['claim_ledger','challenge_map'], ['resolution_map','final_verdict']]`) ход раунда 3 содержит resolution-инструкции, а не «Атакуй самое слабое место».
- Все четыре фазы покрыты юнит-тестом `resolveStagePhase`.

## T3. Blind-открытия: верификация и защитный тест

**Текущее состояние (проверено).** Duel: A0+B0 отправляются одним параллельным батчем, `buildInitBPrompt` не содержит текста A (`duel-runner.js:100-109`, `disput-massage.js:73` — «оппонент её ещё не видит»). Multi: волна 1 получает `previousTurns=[]` → «No previous wave yet» (`multi-runner.js:57-95`). Считать blind реализованным, задача — не дать этому сломаться и закрыть Triad.

**Что сделать.**
1. Прочитать `triad-runner.js` + `triad-massage.js`: убедиться, что волна 1 не включает ответы других участников (по компилятору `r1:wave` — `opening_batch`, должно быть аналогично Multi). Если включает — исправить по образцу Multi.
2. Добавить инвариант-функцию в `debate-prompt-catalog.js`: `assertBlindOpening(promptsByModel, openingTexts)` — dev-проверка, что ни один opening-промпт не содержит фрагментов (первые 80 символов) ответа другого участника. Вызывать в runner'ах перед первым батчем только если `openingTexts` уже есть (recovery-сценарий).
3. Тесты на промпт-билдеры всех трёх топологий: opening-промпт каждого участника не содержит имени-заголовка и текста ответа другого участника.

**Приёмка.** Три теста (duel/triad/multi) зелёные; в Triad подтверждено или исправлено blind-поведение; вывод зафиксирован в отчёте.

## T4. Stage contracts в плане + расширение валидатора

**Проблема.** `makeStage()` в компиляторе уже несёт `promptContract`, `inputs`, `outputs`, `completionPolicy`, `failurePolicy` (`debate-plan-compiler.js:20-37`), но: (а) валидатор не проверяет контрактные поля (только структуру графа, `debate-plan-validator.js`); (б) runner'ы план не читают вообще — контракты ни на что не влияют.

**Что сделать.**
1. Каждой стадии в компиляторе добавить поле `purpose` (одна строка: что стадия должна дать) — заполнить в `compile()` по kind.
2. Расширить `validate()` в `debate-plan-validator.js`:
   - `promptContract` непуст и входит в известный список контрактов (экспортировать список из `debate-prompt-catalog.js` как `KNOWN_PROMPT_CONTRACTS`; собрать имена из компилятора: `duel_openings`, `duel_public_turn`, `round_filter`, `{topology}_openings`, `{topology}_wave`, `{topology}_final_words`, `{topology}_final_synthesis`);
   - `completionPolicy` ∈ {`all_required_answers`, `any_answer`, `quorum`};
   - `failurePolicy` ∈ {`fail_run`, `ask_user`, `skip_stage`};
   - все артефакты в `outputs` стадий-фильтров определены в `DebateArtifactDefinitions` (использовать `listUndefined` из T1) — ошибка `artifact_undefined:<id>`.
3. Минимальное подключение плана к runner'ам (без переписывания сиквенса): runner'ы получают `input.executionPlan` (duel уже читает `input.executionPlan?.runPolicy`, `duel-runner.js:62`). Добавить хелпер `DebatePlanCompiler.stageById(plan, stageId)` (уже существует) в deps runner'ов и при старте каждой стадии читать её `failurePolicy`: при `fail_run` — текущее поведение; `ask_user` — существующий механизм `resolveParticipantDropout`. Сейчас достаточно duel + multi; triad — по тому же образцу.

**Приёмка.**
- Юнит-тесты валидатора: план с неизвестным `promptContract` / неопределённым артефактом / кривым `completionPolicy` не проходит, с корректным — проходит.
- Компиляция всех девяти `BUILTIN_PIPELINE_DEFINITIONS` проходит `assertValid` (итерационный тест).

## T5. Проверка полноты ответа (единая точка приёмки)

**Проблема.** Ответ принимается по критерию «непустой и не error»: `String(result?.responses?.[model] || '').trim()` + `deps.isErrorOutput?.(answer)` — одинаковый паттерн в `duel-runner.js:122-127,296`, `multi-runner.js:96-99,182`. Оборванный на полуслове ответ (обрыв генерации, обрезка при извлечении из DOM) проходит как валидный.

**Что сделать.**
1. Новый модуль `disput/debate-response-acceptance.js`, экспорт `root.DebateResponseAcceptance` с одной главной функцией:
   ```js
   evaluate({ text, meta }) → { ok: boolean, reason: '' | 'empty' | 'error_output' | 'too_short' | 'truncation_marker' | 'incomplete_ending', details }
   ```
   Правила (в порядке):
   - пусто → `empty`;
   - `isErrorOutput(text)` (передавать функцией в meta или deps) → `error_output`;
   - `text.length < minChars` (по умолчанию 200 для участников, 400 для synthesis; конфигурируемо через `meta.minChars`) → `too_short`;
   - содержит маркеры обрыва: `[...truncated]` (его вставляет `trimText` в `debate-engine.js:74-78`), незакрытый код-блок (нечётное число ```), заканчивается на `…`/`...` без завершённого предложения → `truncation_marker`;
   - последний непустой символ не входит в `.?!)»"']` И последняя строка выглядит оборванной (эвристика: > 3 слов и нет конечной пунктуации) → `incomplete_ending`. Списки/заголовки в конце допустимы: если последняя строка начинается с `-`, `*`, цифры с точкой или `#` — не считать обрывом.
2. Встроить в runner'ы: везде, где сейчас стоит пара «trim + isErrorOutput», заменить на `deps.acceptResponse(...)` (новая зависимость в deps, реализация — обёртка над `evaluate`). Отказ по полноте обрабатывать так же, как сейчас обрабатывается пустой ответ (retry → dropout-решение). В `runTurnWithRetry` (`duel-runner.js:275-316`) `lastError` должен получать `reason` из evaluate.
3. Записывать trace-событие `ANSWER_REJECTED` (тип уже есть в `debate-trace-schema.js`) с `reasonCode` = reason — через существующий механизм `stageEvent`.

**Приёмка.**
- Юнит-тесты на каждое правило (по 2 позитивных/негативных случая).
- Интеграционный тест runner'а (см. существующие тесты duel-runner, если есть; иначе с mock deps): батч возвращает текст, оканчивающийся на «поэтому главным фактором являет» → ответ не принят, выполнен retry.
- Ложных срабатываний нет: ответ, оканчивающийся markdown-списком или код-блоком, принимается (тест).

## T6. Persistent accepted state, переживающий перезагрузку страницы

**Проблема.** `DebateRunStore` имеет `serialize`/`hydrate` и `STORAGE_KEY` (`debate-run-store.js:6,239-241`), но нужно проверить, что store реально пишется в `chrome.storage.local` в момент принятия каждого ответа и что при перезагрузке страницы результатов run можно продолжить или хотя бы корректно показать терминальное состояние. Runner'ы держат протокольное состояние в памяти (`state` в замыкании).

**Что сделать.**
1. Разведка (результат — в отчёт): grep `llmCodexDebateRun` и `DebateRunStore` по репозиторию; найти, кто вызывает `serialize`/`hydrate` (вероятно `debate-run-services.js` / `debate-application.js` / `results-shared.js`). Зафиксировать: (а) когда пишется, (б) читается ли при загрузке страницы, (в) что происходит с активным run после F5.
2. Обеспечить запись в `chrome.storage.local` НЕ реже, чем на каждом из событий: `MODEL_TURN_RECORDED`, `STAGE_COMPLETED`, `VERDICT_RECORDED`, любой терминал (`RUN_FAILED`, `CANCEL_REQUESTED`, `FINALIZATION_COMPLETED`). Механизм: подписка `store.subscribe(...)` + debounce 300 мс + немедленный flush для терминальных (список `TERMINAL` уже есть в `debate-run-store.js:8`). Протокольное состояние runner'а уже попадает в store через `PROTOCOL_STATE_SYNCED` (`deps.syncState` в runner'ах) — проверить, что `serialize` его включает (поле `protocolState`; `encode` уже умеет `Set`).
3. Восстановление при загрузке: при инициализации Debate-страницы прочитать сохранённый state; если `!isTerminal(state)` и `runId` непуст — показать баннер «Обнаружен незавершённый запуск <topology> от <время>» с кнопками: «Показать как прерванный» (перевести в `cancelled` с reason `page_reload_abandon`) и «Продолжить» — только если реализуемо дёшево; иначе в первой итерации только честная фиксация прерывания (это уже соответствует must have: состояние не теряется и не «висит» призраком). Полный resume — за пределами этого ТЗ.
4. Ограничить размер: перед записью обрезать `events` до `MAX_EVENTS` (уже делается в `transition`) и НЕ хранить полные тексты ответов в events (проверить, что тексты живут в `protocolState`, а payload событий — метаданные).

**Приёмка.**
- Тест: `hydrate(serialize(state))` идемпотентен для state с Set-полями и protocolState.
- Тест подписки: после dispatch `STAGE_COMPLETED` замоканный `chrome.storage.local.set` вызван с ключом `llmCodexDebateRun.v1`.
- Ручная проверка (описать шаги в отчёте): запустить Duel Verdict, дождаться раунда 2, F5 → баннер появляется, состояние не потеряно.

## T7. Сквозная correlation identity + отклонение stale-ответов

**Текущее состояние.** Схема готова: `CORRELATION_KEYS` = `debateRunId, planId, stageId, stageAttemptId, pipelineRunId, pipelineRoundId, pipelineBatchId, dispatchId, tabId, sessionId` (`debate-trace-schema.js:39-42`), есть типы `STALE_EVENT_REJECTED`, `CORRELATION_REJECTED`, `DUPLICATE_FINAL_REJECTED`. Runner'ы передают `pipelineRunId/RoundId/StageId/BatchId` в `context` батча, но `stageAttemptId` не передаётся, а приёмка ответа не сверяет идентификаторы.

**Что сделать.**
1. В `runTurnWithRetry` (duel) и в цикле retry Multi/Triad добавить в `context` поле `stageAttemptId: `${stageId}:a${attempt}``. Проверить, что `background/pipeline-run-state.js` и координатор прокидывают `pipelineContext` в ответ (grep `pipelineBatchId` по `background/`) — ответ батча должен возвращаться с тем же context (вероятно уже так; зафиксировать в отчёте).
2. Точка приёмки (там же, где T5 `acceptResponse`): сверять, что ответ относится к ожидаемому `pipelineRunId` + `pipelineStageId` + `stageAttemptId`. Несовпадение → не принимать, записать `CORRELATION_REJECTED` (несовпадение stage/attempt) или `STALE_EVENT_REJECTED` (пришёл ответ от отменённого/предыдущего run). Для этого текущий ожидаемый идентификатор хранить в protocolState: `state.expectedDispatch = { stageId, attemptId, batchId }` — выставлять перед `runModelBatch`, очищать после приёмки.
3. Защита от двойного терминала: в `debate-run-store.js` `transition()` — если state уже терминален (`TERMINAL.has(state.status)`) и приходит второй терминальный event, не менять состояние, добавить event `DUPLICATE_FINAL_REJECTED` (сохранив исходный `completedAt`/`terminalReason`).

**Приёмка.**
- Тест store: `CANCEL_REQUESTED` после `FINALIZATION_COMPLETED` не меняет `status`/`completedAt`.
- Тест приёмки: ответ с `stageAttemptId` от attempt 1, пришедший когда ожидается attempt 2, отклонён с событием `CORRELATION_REJECTED`.
- В телеметрии реального прогона (ручная проверка) все DISPATCH/ANSWER-события содержат `stageAttemptId`.

## T8. Manual-режим: довести или честно закрыть

**Текущее состояние.** Все fixed-пресеты принудительно `runPolicy: 'auto'`; причина задокументирована в комментарии `pipeline-presets.js:172-175`: в manual рантайм останавливается после opening-волны, хотя план обещает полный roundPlan и синтез. В Multi есть `deps.waitForContinuation` (`multi-runner.js:147-149`), в Duel — механизм `waitingApprovalModel` + `routeApprovedTurn`.

**Что сделать (вариант A — довести; выбран по умолчанию).**
1. Определить semantics manual одинаково для всех топологий: после КАЖДОЙ волны/пары ходов рантайм переходит в `awaiting_approval` (store-событие `APPROVAL_REQUESTED` уже есть), UI показывает кнопку «Продолжить» и поле указания модератора; «Продолжить» → `APPROVAL_GRANTED` → следующая волна. Финальный синтез в manual тоже требует подтверждения.
2. Multi/Triad: убедиться, что `waitForContinuation` реально резолвится по действию пользователя (найти реализацию: grep `waitForContinuation` — вероятно `debate-runtime.js`/`debate-run-services.js`; вероятная причина зависания — обработчик кнопки не привязан для fixed-пресетов). Починить связку UI-кнопка → resolve.
3. Duel: проверить, что в manual `state.waitingApprovalModel` выставляется и `routeApprovedTurn` вызывается по approve из UI; убедиться, что moderator-указание из поля попадает в `moderatorText` следующего промпта.
4. После починки: в `BUILTIN_PIPELINE_DEFINITIONS` оставить `runPolicy: 'auto'` по умолчанию, но разрешить переключение в manual из UI (сейчас оно заблокировано/игнорируется — найти по grep `runPolicy` в UI-коде debate-страницы), и удалить устаревший комментарий.
5. Если в ходе работ выяснится, что доведение manual требует переписывания рантайма (> ~300 строк диффа) — остановиться и переключиться на вариант B: убрать выбор manual из UI для fixed-пресетов, показывать тултип «Manual доступен только в Long-режимах», комментарий в presets обновить. Решение зафиксировать в отчёте.

**Приёмка (вариант A).**
- Ручной e2e: «Duel Verdict» и «Multi Red Team» в manual проходят все раунды до финального вердикта с кнопкой «Продолжить» между волнами. ВАЖНО: тестовый браузер кэширует JS расширения — перед проверкой перезагрузить расширение и страницу (известная ловушка).
- Jest-тест на multi-runner с mock `waitForContinuation`: в manual он вызывается после каждой волны, в auto — не вызывается.
- Пауза/отмена работают и в manual (кнопки не блокируются в awaiting_approval).

## T9. Правила финального синтеза (minority, unresolved, no-new-claims)

**Текущее состояние.** В фильтре уже есть «Preserve strong minority positions… Do not use majority count as proof» (`debate-prompt-catalog.js:64`); в Duel-синтезе — «Do not use model count as evidence» (`:108`); Multi-синтез требует секций agreed/disputed/assumptions (`:159-164`). Нет: обязательной секции minority, переноса unresolved issues, пометки новых выводов синтезатора.

**Что сделать.**
1. Единый набор обязательных секций финального синтеза (все топологии), зафиксировать в `debate-prompt-catalog.js` как `SYNTHESIS_REQUIRED_SECTIONS`:
   ```
   ## Вердикт
   ## Что устояло (с указанием, чья позиция)
   ## Позиции меньшинства (сохранять, даже если их не поддержало большинство; если нет — написать «нет»)
   ## Нерешённые вопросы (перенести ВСЕ open issues из фильтров; если нет — «нет»)
   ## Выводы синтезатора [synthesis_inference] (утверждения, которых не было у участников; если нет — «нет»)
   ## Уверенность и основания
   ```
2. Переписать `buildDuelFinalSynthesis` и `buildMultiFinalSynthesis` (и triad-аналог) так, чтобы промпт требовал ровно эти секции + правила: консенсус не доказательство; новые материальные утверждения только в секции synthesis_inference; каждая позиция меньшинства сохраняется с автором.
3. Лёгкая пост-проверка: функция `validateSynthesisSections(text)` → список отсутствующих заголовков (сравнение по нормализованным `##`-заголовкам, допускать вариации регистра/пунктуации). Если что-то отсутствует — ОДИН повторный запрос синтезатору: «Ответ не содержит обязательных секций: <список>. Выдай полный синтез по заданной структуре» (использовать существующий retry-механизм synthesis-цикла, `multi-runner.js:156-195`). После второй неудачи — принять как есть + trace-событие `MISSING_REQUIRED_ARTIFACT` (тип уже есть) с перечнем секций.

**Приёмка.**
- Юнит-тесты `validateSynthesisSections` (полный текст / без minority / с заголовками другого регистра).
- Тест synthesis-цикла с mock-батчем: первый ответ без секций → второй запрос отправлен; второй ответ полный → принят.
- Промпт-тесты: build*FinalSynthesis каждой топологии содержит все шесть секций и правило про synthesis_inference.

## T10. Пользовательский контроль: аудит и доведение флагов safetyPolicy

**Текущее состояние.** `SAFETY_POLICY {canPause, canRecover, canError, canCancel}` объявлен на каждом пресете (`pipeline-presets.js:41-53`); в duel есть пауза (`options.isPaused?.()`, `pendingAutoContinuation`, `duel-runner.js:394-402`), отмена через AbortSignal (`multi-runner.js:58`), retry (`runTurnWithRetry`), dropout-approve (`resolveParticipantDropout` — это и есть «approve degraded continuation»).

**Что сделать.**
1. Составить матрицу «флаг × топология × фактическое поведение» (проверкой кода, не прогоном): pause / resume / cancel / retry(стадии) / approve-degraded. Внести в отчёт.
2. Закрыть найденные дыры. Ожидаемые (проверить в первую очередь):
   - pause в Multi/Triad между волнами (в duel есть; в multi `input.isPaused?.()` учитывается только вместе с manual — `multi-runner.js:147`, пауза в auto-режиме между волнами, вероятно, не срабатывает);
   - resume после паузы во всех топологиях возобновляет с того же места (duel: `pendingAutoContinuation` — проверить, кто его потребляет, grep);
   - cancel во время ожидания approve (manual, T8) и во время фильтр-стадии;
   - ручной retry последней неудачной стадии из UI, когда auto-retry исчерпан (сейчас после исчерпания — только dropout-решение; добавить в диалог dropout третью опцию «Повторить ещё раз», которая вызывает ту же стадию заново — механизм `resolveParticipantDropout` расширить значением `'retry'`).
3. UI-кнопки должны отражать `safetyPolicy` пресета: флаг false → кнопка скрыта/disabled (найти рендер управления run на debate-странице по grep `canPause`).

**Приёмка.**
- Матрица в отчёте, все клетки «работает/исправлено/не применимо».
- Jest: `resolveParticipantDropout` → `'retry'` перезапускает стадию (mock-тест runner'а).
- Ручной e2e: пауза в Multi Verdict между волнами 1 и 2 → возобновление → run доходит до вердикта.

## T11. Context budget: запрет молчаливого усечения

**Проблема.** Молчаливые усечения уже есть: `trimText` режет ходы до `maxTurnTextChars=12000` с маркером `[...truncated]` (`debate-engine.js:74-78`) — маркер попадает в контекст следующих промптов без какой-либо сигнализации; промпты волн склеивают всю историю `previousTurns` без оценки размера (`buildMultiWave`), синтез получает `state.responsesByWave.flat()` целиком (`multi-runner.js:161`).

**Что сделать.**
1. Новый модуль `disput/debate-context-budget.js` (`root.DebateContextBudget`):
   - `estimate(text)` → символы (не токены; честно назвать поле `chars`);
   - `DEFAULT_LIMITS = { promptChars: 60000, reservedOutputChars: 8000 }` — конфигурируемые;
   - `check({ parts, limits })` → `{ ok, totalChars, overflowChars }`, где parts — массив `{ id, text, priority }`.
2. Вызывать перед каждым `runModelBatch` во всех runner'ах (обёртка в deps: `deps.checkContextBudget(prompt)`); при превышении:
   - записать trace-событие с `reasonCode: 'context_budget_exceeded'` и размерами (тип `LEGACY_DIAGNOSTIC_EVENT` или добавить `CONTEXT_BUDGET_EXCEEDED` в `EVENT_TYPES` — добавить, схема расширяема);
   - применить ДЕТЕРМИНИРОВАННОЕ сокращение, а не обрезку хвоста: порядок выбрасывания — (1) полные тексты старых волн, которые уже покрыты round filter (заменять строкой `[волна N: см. filtered state]`), (2) старейшие ходы сверх последних двух, (3) только затем усечение самого длинного ответа с явной пометкой `[обрезано системой: было X символов]`;
   - показать пользователю notify-предупреждение (механизм `deps.notify` уже есть).
3. `trimText`-маркер: в точке приёмки T5 уже отклоняются ответы с `[...truncated]`; здесь дополнительно — если усечение применилось к ПРОМПТУ, это всегда сопровождается событием и notify (молчаливых путей не остаётся).

**Приёмка.**
- Юнит-тесты `check` и функции сокращения: приоритетный порядок выбрасывания соблюдается, ответы последней волны не трогаются никогда.
- Тест: multi-runner c 4 волнами × длинные ответы → в промпт волны 4 старые волны вошли ссылкой на filtered state, событие записано, notify вызван.

## T12. Baseline benchmark

**Задача.** Скрипт + процедура сравнения трёх конфигураций: (A) одна сильная модель, один запрос; (B) те же N моделей blind + один синтез (без раундов критики); (C) полный Disput-пресет. Цель — узнать, окупается ли протокол.

**Что сделать.**
1. Папка `benchmarks/`: `tasks.json` — 12 задач (по 3: анализ/решение, факт-проверка, план действий, red-team разбор предложения; поле `id`, `prompt`, `type`, `evaluationCriteria` — 3–5 критериев на задачу, писать самостоятельно).
2. Так как прогоны идут через живые вкладки, полный автомат не нужен: сделать полуавтоматический протокол — `benchmarks/README.md` с пошаговой процедурой (какой пресет запускать, что копировать) + `benchmarks/collect.js` (node-скрипт): принимает папку с сохранёнными результатами (`<taskId>/<config>.md`), собирает единый `comparison.md` с таблицей «задача × конфигурация» и слепой рандомизацией порядка (для оценки человеком не знать, где какая конфигурация: маппинг в отдельный `key.json`).
3. Конфигурация B («blind + синтез») — это существующий Multi с `waveLimit=1`? Проверить: если `MULTI_STANDARD` c одной волной даёт ровно «независимые ответы + синтез», использовать его; иначе добавить в `BUILTIN_PIPELINE_DEFINITIONS` служебный пресет `Multi Baseline` (1 волна, без критики, обычный синтез).
4. Шаблон оценки: `benchmarks/rubric.md` — для каждой задачи оценка 1–5 по её `evaluationCriteria` + общий выбор лучшего ответа.

**Приёмка.** `node benchmarks/collect.js --demo` на приложенных фикстурах (3 задачи × 3 конфигурации, заготовить фиктивные) собирает корректный `comparison.md` и `key.json`; README воспроизводим человеком без чтения кода.

---

## Отчёт исполнителя (обязателен)

По завершении — файл `docs/must-have-report.md` в репозитории: по каждой задаче — статус, список изменённых файлов, результаты разведки (T6.1, T7.1, T10.1), принятые решения (T8 вариант A/B), найденные расхождения кода с ТЗ, красные/пропущенные тесты с причиной. Ничего не коммитить без запроса пользователя.

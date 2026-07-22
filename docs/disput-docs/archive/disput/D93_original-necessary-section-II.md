# D93. Исходное ТЗ: необходимая вторая очередь, раздел II

Дата: 2026-07-15. Основа: «Приоритизация развития Disput — версия Claude.md», раздел II.
Предусловие: раздел I реализован по «ТЗ — Disput Must Have (раздел I).md» (задачи T1–T12). Ссылки вида «T5» указывают на задачи того ТЗ. Если какая-то T-задача не реализована — соответствующий шаг здесь пропустить и зафиксировать в отчёте, остальное выполнять.

Исполнитель: LLM-агент среднего уровня. Правила те же, что в ТЗ раздела I (раздел «0. Общие правила»): рабочая папка `/Users/restart/Downloads/LLM_Sol-Fable`, без коммитов без запроса, стиль IIFE-модулей с `root.<Name>` + `module.exports`, зависимости runner'ов только через `deps`, каждая задача — самостоятельный диф с зелёным `npx jest`.

**Дополнительный контекст, проверенный по коду:**
- Тестов уже ~146 в `tests/`, в т.ч. `debate-plan-compiler.test.js`, `debate-run-store.test.js`, `debate-projections.test.js`, `dispatch-correlation-contract.test.js`, `dispatch-baseline-stale-guard.test.js` — новые тесты писать в их стиле, существующие не ломать.
- Фасад протоколов уже есть: `disput/debate-protocols.js` — `lifecycleAdapter` с `reduce()`, `planNextEffects()`, `buildPrompt()`, `isTerminal()` для трёх топологий.
- Идемпотентность dispatch: `background/dispatch-retry.js` — `DispatchIdRegistry` (in-memory `Map`, TTL 15 мин) + `DispatchCircuit` (персистится в `chrome.storage.session` с debounce, образец — `persistDispatchCircuitState`/`loadDispatchCircuitState`).
- Канонический store: `disput/debate-run-store.js` (`VERSION=1`, терминальные статусы `completed|error|cancelled|stopped_by_moderator`).

**Рекомендованный порядок:** U5 → U10 → U6 → U1 → U2 → U3 → U7 → U4 → U8 → U9 (сначала три независимые небольшие задачи, затем цепочка с зависимостями, conformance-тесты после всех, архитектурная уборка последней).

---

## U1. Selective context assembly: стадия видит только своё

**Проблема.** Контекст склеивается ad-hoc и растёт неограниченно: волна Multi получает полные тексты всей предыдущей волны (`multi-runner.js:61-74`, `previousTurns`), финальный синтез Multi — вообще все ответы всех волн (`state.responsesByWave.flat()`, `multi-runner.js:161`) плюс все фильтры. Правил «кому что видно» нет; T11 (context budget) лишь режет переполнение, но не решает, что класть.

**Что сделать.**
1. Новый модуль `disput/debate-context-assembly.js` (`root.DebateContextAssembly`). Главная функция:
   ```js
   assemble({ topology, stageKind, stagePhase, role, state, policy }) →
     { parts: [{ id, label, text, priority }], omitted: [{ id, reason }] }
   ```
   `stagePhase` — из T2 (`resolveStagePhase`), `policy` — см. п.3.
2. Правила по умолчанию (реализовать как декларативную таблицу VISIBILITY_RULES, не как if-каскад):
   - участник волны N: тема + ProblemSpec (U4) + СВОЯ последняя позиция полностью + последний round filter + тексты ЧУЖИХ ответов только последней волны; более старые волны — никогда полными текстами (они покрыты фильтрами);
   - duel-ход: как сейчас (последний ответ оппонента + последний фильтр) — здесь поведение не менять, только провести через assemble;
   - round filter: только ответы текущего раунда + предыдущий фильтр (уже так — `buildRoundFilter`, закрепить);
   - final words: собственная линия участника + все фильтры (уже так — `buildDuelFinalWord`, закрепить);
   - final synthesis: фильтры + final words + полные тексты ТОЛЬКО последней волны. Полная история — лишь при explicit policy.
3. Политика на пресете: в `pipeline-presets.js` каждому пресету поле `contextPolicy: 'filtered'` (по умолчанию) `| 'full_history'`. Для существующих Verdict-пресетов с 3–4 раундами поставить `full_history` (маленькие прогоны, менять качество синтеза без benchmark'а нельзя), для Long-пресетов — `'filtered'`. После прогона benchmark (T12) политику Verdict можно пересмотреть — отметить это комментарием.
4. Интеграция: `buildMultiWave` / triad-аналог / `buildMultiFinalSynthesis` принимают уже собранные `parts` от `assemble` (вызов — в runner'ах через `deps.assembleContext`). Каждый omitted-элемент отражается в trace-событии (`reasonCode: 'context_omitted_by_policy'`) — невидимых выбрасываний нет.
5. Связка с T11: результат `assemble` прогоняется через `DebateContextBudget.check` до отправки; сокращение при переполнении работает поверх `parts` с их `priority`.

**Приёмка.**
- Юнит-тесты таблицы правил: для каждой пары (топология × стадия) снимок списка id частей.
- Тест: Multi 4 волны, policy `filtered` → промпт волны 4 не содержит полных текстов волн 1–2, содержит фильтр; policy `full_history` → содержит всё.
- Существующие тесты промптов (`debate-prompt-catalog.test.js`, `disput-massage.test.js`) зелёные без изменения ожиданий для duel.

## U2. TechnicalStatus отдельно от EpistemicOutcome

**Проблема.** Терминальный статус run — технический (`completed|error|cancelled|stopped_by_moderator`, `debate-run-store.js:8`). «Completed» ничего не говорит о том, решён ли вопрос: синтез мог честно написать «данных недостаточно», а run выглядит одинаково успешным.

**Что сделать.**
1. В `debate-run-store.js` добавить поле состояния `epistemicOutcome: '' | 'resolved' | 'partially_resolved' | 'inconclusive' | 'insufficient_evidence' | 'external_verification_required' | 'protocol_degraded'`. Заполняется ТОЛЬКО на терминальных событиях; для `error/cancelled` — всегда `''` (не оценивается).
2. Новый модуль `disput/debate-epistemic-outcome.js`: `derive({ synthesisText, state }) → { outcome, signals }`. Логика (в порядке приоритета):
   - `state.degradedMode` установлен (U3) или `droppedModels` непуст → минимум `protocol_degraded` (если контент-сигналы хуже — берётся худший);
   - парсинг секций синтеза из T9: секция «Нерешённые вопросы» непуста (не «нет») и секция «Вердикт» существенно короче нерешённого — `partially_resolved`; маркеры «недостаточно данных/источников», «требуется проверка внешним источником» в секциях уверенности/нерешённого — `insufficient_evidence` / `external_verification_required`; вердикт отсутствует или содержит явный отказ от вывода — `inconclusive`; иначе `resolved`;
   - маркеры искать по словарю регулярок, словарь — экспортируемая константа (для тестов и будущей правки).
   `signals` — список сработавших правил (для отладки и UI-тултипа).
3. Вызов `derive` — в месте финализации (там, где `deps.appendVerdict` + `FINALIZATION_COMPLETED`; найти обработчик по grep `FINALIZATION_COMPLETED` и `recordFinalization`). Результат — в payload события и в состояние store.
4. UI: рядом с терминальным статусом run показать бейдж outcome (проекции — `debate-projections.js`; добавить поле в view-model, найти отображение статуса по grep существующего статус-бейджа). Формулировки на русском: «Решено», «Решено частично», «Не решено», «Недостаточно данных», «Нужна внешняя проверка», «Протокол деградировал».

**Приёмка.**
- Юнит-тесты `derive`: по 2 фикстуры текста синтеза на каждый из 6 outcome.
- Тест store: `FINALIZATION_COMPLETED` с payload.epistemicOutcome кладёт значение в state; `RUN_FAILED` оставляет `''`.
- `hydrate(serialize())` сохраняет поле (обратная совместимость: старые сохранённые state без поля читаются, поле = `''`).

## U3. Dropout revalidation + управляемый degraded mode

**Проблема.** При выпадении участника пользователю задаётся только «продолжить/остановить» (`resolveParticipantDropout`, вызовы в `duel-runner.js:144-153`, `multi-runner.js:108-123`). Решение принимается вслепую: не проверяется, потерян ли синтезатор, валидна ли оставшаяся топология, потеряна ли уникальная роль. После «продолжить» run внешне неотличим от полноценного.

**Что сделать.**
1. Новый модуль `disput/debate-dropout-revalidation.js`: 
   ```js
   revalidate({ topology, stage, failedModels, remainingModels, roles, synthesizer, plan }) →
     { verdict: 'continue_ok' | 'continue_degraded' | 'stop_required', warnings: [...], degradation: {...} }
   ```
   Правила:
   - `remainingModels.length === 0` → `stop_required`;
   - выпал synthesizer → warning `synthesizer_lost` (runner'ы уже умеют замену — `multi-runner.js:184-194`; ревалидация только сообщает);
   - duel → остался 1: `continue_degraded`, degradation `duel_to_monologue` (дальше только final word + synthesis — текущее поведение, теперь названное);
   - triad → осталось 2: `continue_degraded`, `triad_to_duel`; multi → осталось < 3: warning `low_diversity`;
   - потеря роли: если среди remaining не осталось ни одного участника с ролью `critical` (роли — из пресета `roles[]`) в red_team-протоколе → warning `no_critic_left` + `continue_degraded`.
2. Встроить ПЕРЕД диалогом: результат revalidate передаётся в `resolveParticipantDropout` и отображается в диалоге пользователю (найти реализацию диалога по grep `resolveParticipantDropout` в `disput/`/`results*`): verdict `stop_required` — кнопки «продолжить» нет; `continue_degraded` — предупреждения списком + текст «Run будет помечен как деградировавший».
3. При продолжении с `continue_degraded`: `state.degradedMode = { reason, stage, failedModels, at }`; событие store `EXECUTION_STATE_CHANGED` с payload degradedMode; UI-баннер «Деградированный режим: <reason>» до конца run.
4. Синтез в деградированном run получает вставку в промпт: «Внимание: участник X выбыл на стадии Y. Его позиция после этой стадии не защищалась — не считай молчание согласием»; `epistemicOutcome` получает пол `protocol_degraded` (U2 уже учитывает).

**Приёмка.**
- Юнит-тесты revalidate: каждая ветка правил (≥ 8 случаев).
- Mock-тест multi-runner: волна с 1 выжившим из 3 → диалог получил warnings, после continue state.degradedMode установлен, синтез-промпт содержит вставку.
- Тест U2-связки: деградированный completed run → outcome `protocol_degraded` даже при «чистом» тексте синтеза.

## U4. Минимальный ProblemSpec

**Проблема.** Запуск несёт только `topic` (произвольная строка) + пресет. Ни цель, ни тип задачи, ни требуемый выход нигде не структурированы — промпты не могут на них опереться, синтез не знает, какой формат результата требовался.

**Что сделать.**
1. Новый модуль `disput/debate-problem-spec.js`:
   ```js
   { objective: string, taskType: 'analysis'|'factual'|'decision'|'red_team'|'creative'|'other',
     constraints: string[], requiredOutput: string, evidenceMode: 'none'|'preferred'|'required' }
   ```
   `extract({ topic, moderatorMessage, preset })` — эвристики БЕЗ LLM-вызова:
   - `taskType`: от пресета (Red Team → `red_team`) и ключевых слов темы (словарь регулярок: «сравни/оцени» → analysis, «правда ли/факт» → factual, «выбери/стоит ли/решение» → decision, «придумай/предложи» → creative);
   - `objective`: первое предложение темы (до 200 символов);
   - `constraints`: строки темы/сообщения модератора, начинающиеся с «не », «без », «только », «учти » (каждая — отдельный элемент);
   - `requiredOutput`: по taskType из таблицы дефолтов («ранжированный список рисков с оценкой» для red_team и т.п.);
   - `evidenceMode`: `required` для factual, `preferred` для analysis/decision/red_team, `none` для creative.
2. Построение — один раз на старте run (место: где формируется `input` для runner'ов — grep `pipelineNameText` до вызова `runner.start`); сохранить в store `config.problemSpec` (поле `config` уже есть, `debate-run-store.js:64`).
3. Рендер-блок `renderProblemSpec(spec)` → 5–7 строк текста; вставить в opening-промпты (`buildInitAPrompt`/`buildInitBPrompt`/`buildMultiWave` opening-фаза, через U1-части) и в финальный синтез («Требуемый выход: …» + «Вердикт обязан соответствовать requiredOutput»).
4. UI: показать извлечённый spec в шапке run (read-only в этой итерации); если извлечение дало пустой objective — показывать «не определено», не падать.

**Приёмка.**
- Юнит-тесты extract: ≥ 6 разных тем (все taskType) + тема с тремя constraints.
- Тест: opening-промпт Multi содержит блок ProblemSpec; синтез-промпт содержит requiredOutput.
- store сериализует/гидрирует `config.problemSpec`.

## U5. Расширение семантического валидатора плана

**Проблема.** `debate-plan-validator.js` проверяет структуру графа (id, producer'ы артефактов, единственность и терминальность синтеза), но не проверяет: назначение ролей, независимость synthesizer, доступность заявленных артефактов синтезу, однозначность terminal path при degraded-ветках. T4 добавил проверки контрактных полей; здесь — семантика.

**Что сделать.**
1. Перевести результат на три поля: `{ ok, errors, warnings }` (`ok` игнорирует warnings). `assertValid` бросает только на errors; warnings логируются trace-событием `PLAN_VALIDATION_FAILED` с severity `warning` (тип уже есть в `debate-trace-schema.js`).
2. Новые проверки-ERRORS:
   - synthesis-стадия: `inputs` непусты И каждый input произведён ДО неё (сейчас порядок producer→consumer уже проверяется общим циклом — убедиться и покрыть тестом именно для синтеза);
   - каждый participant плана встречается хотя бы в одной стадии до final (защита от «мёртвых» участников);
   - в плане ровно один терминальный путь: последняя стадия — синтез, и ни одна нетерминальная стадия не имеет `failurePolicy`, ведущую в никуда (допустимые значения — из T4).
3. Новые проверки-WARNINGS:
   - `roles`: план получает поле `roles` (маппинг participant → роль из пресета; прокинуть в `compile()` из `input.scenario`/`preset.roles`). Для red_team-пресетов (по `reasoningBudget.comparableSuffix`) — нет ни одного `critical` → `no_critic_assigned`;
   - synthesizer совпадает с единственным critical-участником → `synthesizer_not_independent`;
   - фильтр-стадии отсутствуют при roundPlan с артефактами (outputs объявлены, но ни одного `round_filter`) → `artifacts_without_filter`.
4. Прогнать все 9 `BUILTIN_PIPELINE_DEFINITIONS` через новый валидатор; если у существующих пресетов вылезли warnings — НЕ менять пресеты, зафиксировать список в отчёте (это диагностика, решение за пользователем).

**Приёмка.**
- Юнит-тесты: на каждую новую проверку — план-нарушитель и план-образец (использовать `compile()` с искусственными пресетами, как в `debate-plan-compiler.test.js`).
- Все существующие тесты компилятора/валидатора зелёные; `assertValid` по-прежнему не бросает на всех builtin-пресетах.

## U6. Durable attempt ledger

**Проблема.** Идемпотентность dispatch держится на in-memory `Map` (`dispatchIdRegistry`, `background/dispatch-retry.js:14`) — MV3 service worker выгружается при простое, после рестарта реестр пуст: подтверждённый dispatch можно «подтвердить» повторно, а поздний дубль ответа — принять как новый. Circuit breaker рядом уже персистится правильно (`chrome.storage.session`, debounce 2 c) — использовать тот же паттерн.

**Что сделать.**
1. В `dispatch-retry.js` персистить реестр: ключ `dispatchIdRegistry.v1` в `chrome.storage.session` (fallback `local`, как `resolveDispatchCircuitStorage`). Запись — write-through с debounce 1–2 с, НО немедленный flush при `markDispatchConfirmed` (подтверждение — то, что нельзя терять). Загрузка — `loadDispatchIdRegistry()` при инициализации модуля, рядом с `loadDispatchCircuitState()` (найти вызов по grep). TTL-очистка при загрузке (уже есть `cleanupDispatchIds`).
2. Ledger принятых логических операций на стороне run: в protocolState `state.acceptedLedger = { [`${stageId}:${participant}`]: { attemptId, answerHash, at } }` (hash — дешёвый, длина+первые/последние 64 символа). Точка приёмки (T5/T7) перед принятием проверяет ledger: ключ уже занят другим attemptId → отклонить, trace `DUPLICATE_FINAL_REJECTED`; тем же attemptId (идемпотентный повтор) → тихо игнорировать. Ledger попадает в persistent state автоматически (T6 сериализует protocolState; `encode` в run-store поддерживает вложенные объекты).
3. Терминальная защита: `FINALIZATION_COMPLETED`/`VERDICT_RECORDED` при уже установленном терминале — уже отклоняется (T7.3); дополнить тестом, что и после hydrate из storage повторная финализация отклоняется.

**Приёмка.**
- Тест dispatch-retry (в стиле существующего `dispatch-baseline-stale-guard.test.js`): register → confirm → «рестарт SW» (переинициализация модуля с mock storage, который вернул сохранённое) → `isDispatchConfirmed(id) === true`, повторный `registerDispatchId(id)` → `{ok:false, reason:'already_confirmed'}`.
- Тест ledger: два ответа на один `stageId:participant` с разными attemptId → второй отклонён; повтор с тем же attemptId → no-op без ошибки.

## U7. FinalPosition delta

**Проблема.** Финальные слова участников (duel `buildDuelFinalWord` — «Твоя зафиксированная линия…») не требуют объяснить эволюцию позиции; синтез не показывает, кто и почему сместился. Незаметный дрейф позиций не виден ни пользователю, ни синтезатору.

**Что сделать.**
1. В промпт final words (все топологии; duel — `buildDuelFinalWord`, `debate-prompt-catalog.js:73-86`; triad — найти аналог в `triad-massage.js`) добавить обязательную секцию:
   ```
   ## Эволюция позиции
   - Сохранил: <тезисы, устоявшие с открытия>
   - Изменил: <тезис → как изменился>
   - Причина каждого изменения: <какое возражение/довод повлияли; или «переоценка без новых доводов»>
   ```
2. Валидация присутствия секции — обобщить механизм T9: `validateRequiredSections(text, headers)` уже должен существовать (если T9 сделан через `validateSynthesisSections` — отрефакторить в общий `validateRequiredSections`, T9-функция становится его частным вызовом). Один повторный запрос при отсутствии, затем принять + trace `MISSING_REQUIRED_ARTIFACT`.
3. В синтез-промпт (секции T9) добавить подпункт в «Что устояло»: сводка дельт по каждому участнику (материал — их секции «Эволюция позиции», они приходят с final words, которые синтез уже получает).
4. Multi не имеет final words (`debate-plan-compiler.js:106-113`, стадия только для не-multi) — для Multi дельту запрашивать в последней волне: в resolution-фазу (T2 `STAGE_TASKS`) добавить требование той же секции «Эволюция позиции». Зафиксировать это отличие в комментарии.

**Приёмка.**
- Промпт-тесты: final-word-промпт duel/triad содержит секцию; resolution-промпт multi содержит секцию.
- Тест повторного запроса: final word без секции → один re-request (mock батча).
- `validateRequiredSections` покрыт юнит-тестами (общий механизм, 3 случая).

## U8. Conformance-тесты UI ↔ runtime

**Проблема.** UI-проекции (`debate-projections.js`, `debate-trace-projections.js`, view-model) и рантайм могут разъезжаться на редких путях: retry, recovery, partial response, терминальные стадии, degraded. Существующие тесты проверяют модули по отдельности; сквозных сценариев «события → проекция» мало.

**Что сделать.**
1. Разведка: прочитать `debate-projections.js` и `debate-plan-view-model.test.js` — понять форму view-model (какие поля читает UI: статус, текущая стадия, кнопки). Зафиксировать в отчёте перечень полей.
2. Новый файл `tests/debate-conformance-scenarios.test.js`. Каждый сценарий = массив событий для `DebateRunStore.transition` (+ trace-события, если проекции их читают) → assertions на проекцию. Обязательные сценарии:
   - **retry**: STAGE_STARTED → ANSWER_REJECTED → RECOVERY_ATTEMPT_STARTED → успех → проекция ни в один момент не показывает стадию завершённой до STAGE_COMPLETED;
   - **partial response**: ответ отклонён по T5 (`incomplete_ending`) → статус стадии в проекции «выполняется/повтор», не «ошибка run»;
   - **recovery после reload**: `hydrate(serialize(state))` посреди run → проекция идентична до/после (deep-equal view-model);
   - **терминал**: после `FINALIZATION_COMPLETED` любые последующие события не меняют проекцию терминального статуса (свойство из T7.3);
   - **degraded**: continue_degraded (U3) → проекция содержит баннер-флаг degradedMode, статус run остаётся running;
   - **manual approve**: APPROVAL_REQUESTED → проекция показывает ожидание approve нужной модели; APPROVAL_GRANTED → снимает.
3. Инвариант-хелпер `assertProjectionInvariants(state, projection)` — вызывается после каждого события каждого сценария: стадия completed в проекции ⇒ есть STAGE_COMPLETED в events; проекция терминальна ⇔ `isTerminal(state)`; текущая стадия проекции ∈ stages плана.
4. Если сценарий вскрыл реальный баг проекции — исправить проекцию (не тест), баг описать в отчёте.

**Приёмка.** Все 6 сценариев + инварианты зелёные; найденные и исправленные расхождения перечислены в отчёте.

## U9. Чистое разделение topology / protocol / preset

**Проблема.** Фасад `debate-protocols.js` уже разделяет топологии и жизненный цикл, но протокольные решения продолжают жить в трёх местах сразу: runner'ы хардкодят последовательность стадий (дублируя `planNextEffects`), UI местами сам вычисляет фазу/доступность действий. Оригинальный пункт 24 must-have («UI — только проекция») закрыт частично.

**Что сделать (это уборка, не рефакторинг рантайма — объём строго ограничить).**
1. Инвентаризация (пол-дня, результат — таблица в отчёте): grep по `results.js`, `results-shared.js`, файлам debate-страницы на предмет протокольных вычислений в UI: сравнение номеров раундов, `wave`, `turnLimit`, `phase ===`, `status ===` с ветвлением поведения (не отображения). Каждая находка: файл:строка, что решает, куда должно уехать.
2. Устранить только находки категории «UI принимает протокольное решение» (включает/выключает кнопки по своим подсчётам, решает, завершена ли стадия). Механизм: недостающие поля добавить в проекцию/view-model (`debate-projections.js`), UI читает готовый флаг. Находки категории «runner дублирует planNextEffects» — НЕ трогать в этой задаче (риск), только перечислить в отчёте как кандидатов.
3. Написать `docs/architecture-boundaries.md` (1–2 страницы): слои (protocol = `debate-runtime/triad-runtime/multi-runtime` + `debate-protocols`; planning = compiler/validator; orchestration = runner'ы + run-services; transport = background/*; state = run-store + trace; projection = projections + view-model), правило для каждого слоя «что ему запрещено», и правило для новых фич: «протокольное решение добавляется в protocol-слой и приходит в UI полем проекции».
4. Защита от регресса: в conformance-suite (U8) добавить инвариант-тест: view-model не содержит функций, вычисляющих фазу из сырых событий (проверить экспорт проекций: все решения — данные, не колбэки; формализовать как snapshot-тест формы view-model).

**Приёмка.** Таблица инвентаризации в отчёте; найденные UI-решения переведены на поля проекции; документ границ написан; jest зелёный.

## U10. Version manifest

**Проблема.** Версии разбросаны и не связаны: `DebateRunStore.VERSION=1`, `DebateTraceSchema.VERSION=1`, план `version:1`, `DebateEngine.VERSION=1`, версия расширения в `manifest.json`. Сохранённый run не знает, какой версией кода он создан; после изменения схемы старые сохранения будут читаться молча и криво.

**Что сделать.**
1. Новый модуль `disput/debate-version-manifest.js` (`root.DebateVersionManifest`):
   ```js
   getVersions() → {
     implementation: <chrome.runtime.getManifest().version, fallback 'dev'>,
     protocol: 1,        // семантика стадий/фаз (T2, T9)
     planSchema: 1,      // debate-plan-compiler
     runStoreSchema: DebateRunStore.VERSION,
     traceSchema: DebateTraceSchema.VERSION
   }
   ```
   Числа protocol/planSchema объявляются здесь и становятся единственным источником (компилятор берёт planSchema отсюда).
2. Штамповать в run: на `START_REQUESTED` в payload и в state поле `versions` (расширить `createState`/`transition` в run-store). В экспорт (`debate-export` — есть тест `debate-export.test.js`, найти модуль) — тоже.
3. Политика чтения при `hydrate`: сохранённый `runStoreSchema` больше текущего → не гидрировать, вернуть state со статусом `error`, terminalReason `saved_by_newer_version` (recovery-баннер T6 покажет честное сообщение); меньше текущего → гидрировать, поле `versions.migratedFrom` = старое значение. Никаких молчаливых чтений «как получится».
4. Правило для будущих изменений (комментарий в модуле): меняешь форму protocolState/событий — инкрементируй runStoreSchema; меняешь семантику фаз или обязательные секции — инкрементируй protocol.

**Приёмка.**
- Тест: START_REQUESTED → state.versions заполнен; serialize/hydrate сохраняет.
- Тест: hydrate снапшота с runStoreSchema=99 → статус error, reason `saved_by_newer_version`; с отсутствующим полем versions (старые сохранения) → гидрируется, versions проставлен текущий с `migratedFrom: 0`.
- Экспортированный артефакт содержит versions.

---

## Отчёт исполнителя (обязателен)

`docs/section-two-report.md`: по каждой задаче — статус, изменённые файлы, результаты разведок (U8.1, U9.1), warnings валидатора на builtin-пресетах (U5.4), найденные баги проекций (U8.4), кандидаты на вынос протокольной логики из runner'ов (U9.2), пропущенные шаги из-за нереализованных T-задач. Без коммитов без запроса пользователя.

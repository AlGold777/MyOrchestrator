# D94. Исходное ТЗ: качественные улучшения, раздел III

Дата: 2026-07-15. Основа: «Приоритизация развития Disput — версия Claude.md», раздел III.
Предусловия: разделы I и II реализованы («ТЗ — Disput Must Have (раздел I).md», задачи T1–T12; «ТЗ — Disput Необходимо (раздел II).md», задачи U1–U10). Ссылки на T-/U-задачи — на те документы.

**ГЛАВНОЕ УСЛОВИЕ РАЗДЕЛА.** Раздел III имеет смысл, только если: (а) benchmark T12 показал, что Disput выигрывает у одной сильной модели, и (б) V1 подтвердила надёжность claim extraction. Если V1 провалилась — выполнять только V5, V6, V7, V8 (не зависят от registry), остальное вернуть пользователю на пересмотр.

Исполнитель: LLM-агент среднего уровня. Общие правила — из ТЗ раздела I: рабочая папка `/Users/restart/Downloads/LLM_Sol-Fable`, без коммитов без запроса, IIFE-модули, зависимости runner'ов через `deps`, каждая задача — самостоятельный диф с зелёным `npx jest`.

**Контекст, проверенный по коду (критично для этого раздела):**
- Предметная модель УЖЕ ЕСТЬ: `disput/triad-registry.js` (767 строк; `debate-registry.js` — фасад-реэкспорт). Внутри: артефакты `claim` (статусы asserted/supported/contested/refuted/conceded), `open_issue` (open/clarifying/partially_closed/closed/reopened), `term_mismatch`; **anchor-валидация** — дельта применяется только если несёт дословную цитату, реально существующую в event log (`anchorIsValid`, защита от галлюцинированной экстракции); отклонённые дельты пишутся в `violations`; каталог из 10 триггеров (`UNSUPPORTED_CLAIM`, `STRAWMAN`, `CIRCULAR_ARGUMENT`, `FALSE_CONSENSUS`, `TERM_MISMATCH`, `ONE_SIDE_IGNORED`, `PREMATURE_VERDICT`, `TOPIC_DRIFT`, `REPEATED_POINT`, `RECURRING_WEAKNESS`) с готовыми русскими инструкциями-шаблонами; pending actions с cooldown/expiry; `summarizeForCheckpoint`, `ingestCheckpoint`.
- Checkpoint-цикл ЕСТЬ: `disput/debate-run-services.js` — `runCheckpoint` (triad/multi) и `runDuelCheckpoint`: строит промпт `buildTriadCheckpointPrompt` (в `triad-massage.js`), парсит `parseTriadCheckpointOutput`, применяет `ingestCheckpoint`. Checkpoint-модель = `state.synthesizer` (совмещение ролей — предмет V9).
- Registry ВЫКЛЮЧЕН по умолчанию/за флагом: `state.registry = input.registryEnabled ? …` в runner'ах; гейты `isTriadRegistryEnabled()` (results.js:5973) и `isDebateRegistryEnabled(synthesizer)` (results.js:6303) — что именно они проверяют, выяснить в V1.
- Неудачи тихие: `parseTriadCheckpointOutput` → `!parsed.ok` → `return null` без событий (`debate-run-services.js:118-121,179`); сбой checkpoint — timeline-строка и `null` (`:136-140`).
- Тесты registry, вероятно, есть: `ls tests/ | grep -i "triad\|registry"` — проверить и опираться.

**Рекомендованный порядок:** V1 (гейт) → V2 → V3 → V4 → V10 → V9 → V5 → V6 → V7 → V8.

---

## V1. Гейт: измерение надёжности claim extraction и включение registry

**Проблема.** Весь раздел стоит на допущении, что checkpoint-модель умеет надёжно извлекать структурированные дельты из свободного текста. Инфраструктура для проверки уже есть (anchor-валидация + violations), но метрики никто не собирает, а сбои парсинга молчаливы.

**Что сделать.**
1. Разведка (в отчёт): что проверяют `isTriadRegistryEnabled()` / `isDebateRegistryEnabled(synthesizer)` (results.js:5973, 6303) — флаг настроек? модель? Как включить registry для всех топологий из UI.
2. Инструментация:
   - `parseTriadCheckpointOutput` → `!parsed.ok`: trace-событие (schema `debate-trace-schema.js`) `ANSWER_REJECTED` c `reasonCode: 'checkpoint_parse_failed'` + счётчик в state (`state.checkpointStats = { attempted, parsed, parseFailed, deltasProposed, deltasApplied, deltasRejected }`);
   - `ingestCheckpoint` уже возвращает `{ applied, rejected, actions }` (`debate-run-services.js:122,133`) — суммировать в `checkpointStats`;
   - `checkpointStats` — в persistent state (T6) и в финальный отчёт run.
3. Скрипт оценки `benchmarks/registry-reliability.md` (процедура) : включить registry, прогнать по 3 живых run на Duel Long / Triad Verdict / Multi Verdict, выписать из `checkpointStats` и `registry.violations` итог: parse-rate, доля отклонённых дельт, топ-3 кода violations.
4. **Критерий гейта** (записать в отчёт с числами): parse-rate ≥ 80% И доля дельт, отклонённых anchor-валидацией, ≤ 25%. Проходит → в results.js включить registry по умолчанию для всех пресетов со включённым checkpointPolicy (гейты оставить как opt-out). Не проходит → registry не включать; итерация на промпте checkpoint (`buildTriadCheckpointPrompt`: явный формат дельт, примеры, требование дословных цитат ≥ 8 символов — лимит `MIN_ANCHOR_QUOTE_CHARS`) и одна повторная серия; после второй неудачи — стоп, отчёт пользователю.

**Приёмка.** Отчёт с числами по 9+ прогонам; события parse-fail видны в trace; решение включено/не включено зафиксировано. Jest: юнит-тест на счётчики `checkpointStats` (mock parse-fail и успех).

## V2. Достройка предметной модели: Objection, Revision, append-only history

**Проблема.** В registry есть claims/issues/terms, но нет двух сущностей из целевой модели: Objection (возражение как объект, а не только триггер) и Revision (изменение позиции со ссылкой на причину). Артефакты мутируются in-place (`applyDelta` op=update) — история переходов статуса не сохраняется: незаметная перезапись возможна внутри модели, которая создавалась против незаметных перезаписей.

**Что сделать (всё — в `triad-registry.js`, стиль модуля сохранить: чистые функции, in-place мутация reg).**
1. `ARTIFACT_TYPES` + `OBJECTION: 'objection'` (статусы: `raised/answered/conceded/withdrawn/unresolved`, активные — `raised/unresolved`) и `REVISION: 'revision'` (статусы: `recorded`; не мутирует). Обновить `normalizeType`, `defaultStatusForType`, `STATUSES_FOR_TYPE`, активные наборы, `summarizeForCheckpoint` (добавить секции в сводку).
2. Связи: у `objection` обязательное поле `targetId` (id существующего claim; дельта без валидного targetId → violation `objection_without_target`). У `revision` — `claimId` (обязателен) + `basis`: `{ kind: 'objection'|'evidence'|'correction'|'spec_change'|'reassessment', refId?: string }`; `reassessment` разрешён без refId, но помечается в сводках как «переоценка без новых оснований».
3. Append-only history: каждому артефакту поле `history: [{ at, wave, fromStatus, toStatus, sourceCheckpointId, anchor }]`; `applyDelta` op=update больше не затирает прошлое — пушит запись. Изменение ТЕКСТА claim запрещено (violation `claim_text_immutable`) — изменение формулировки = новый revision.
4. Checkpoint-промпт (`buildTriadCheckpointPrompt` в `triad-massage.js`): расширить формат дельт двумя новыми типами с примерами; требование: revision всегда указывает claimId и basis.
5. Wave-промпты через registry-контекст (`PROMPT_ARTIFACT_LIMIT`-сводка, попадающая в `registryContext` — см. `buildStandardTurnPrompt`): в сводку добавить активные objections по позициям адресата («на твой claim-3 есть неотвеченное возражение obj-2: …»).

**Приёмка.**
- Юнит-тесты: objection без target → violation; revision c basis=objection и валидным anchor применяется; update claim пишет history и не теряет прошлый статус; попытка сменить текст claim → violation.
- Существующие registry-тесты зелёные (найти: `ls tests/ | grep -i "triad\|registry"`).
- `summarizeForCheckpoint` содержит новые секции (snapshot-тест).

## V3. RoundDelta как проекция registry

**Проблема.** После каждой волны известно только «+N артефактов, M триггеров» (timeline-строка, `debate-run-services.js:133`). Что именно нового появилось, что решилось, что переоткрылось — не видно ни пользователю, ни механизму остановки (V10).

**Что сделать.**
1. В `triad-registry.js` функция `computeRoundDelta(reg, { sinceCheckpointId })`:
   ```js
   → { newClaims: [...], newObjections: [...], revisions: [...],
       resolvedIssues: [...], reopenedIssues: [...],
       duplicateSignals: [...],   // pending actions с триггером REPEATED_POINT за окно
       counts: {...} }
   ```
   Источник — `history` (V2) и `sourceCheckpointId` артефактов: всё, что создано/изменено после указанного checkpoint. Без нового LLM-вызова — чистая проекция.
2. Вызов после каждого `ingestCheckpoint` (оба места в `debate-run-services.js`); результат — в `state.roundDeltas.push({ wave, delta })` и в store-событие `REGISTRY_UPDATED` (payload дополнить delta.counts).
3. UI: компактный блок «Итог волны N» в ленте run (место — рядом с существующим выводом round filter; найти рендер фильтра в results.js по grep `roundFilters`): 5 строк counts + раскрываемый список. Поля в проекцию — через `debate-projections.js` (правило U9: UI не считает сам).
4. Для run без registry (V1-гейт не пройден или отключён) — fallback: те же поля запрашиваются секцией в промпте round filter (T1-артефакт `round_delta` добавить в `debate-artifact-definitions.js`), без парсинга — просто текст. Обе ветки дают пользователю одинаковый по смыслу блок.

**Приёмка.**
- Юнит-тесты `computeRoundDelta`: новая волна с 2 claims + 1 revision + 1 закрытым issue → корректные списки; повторный вызов с тем же checkpoint → пусто.
- Тест проекции: counts доступны view-model.
- Fallback-ветка: определение `round_delta` есть в реестре артефактов, фильтр-промпт его содержит.

## V4. Повторы аргументов и premature convergence

**Текущее состояние.** Детекция уже существует как триггеры checkpoint: `REPEATED_POINT`, `RECURRING_WEAKNESS`, `PREMATURE_VERDICT`, `FALSE_CONSENSUS` (`TRIGGER_CATALOG`, `triad-registry.js:42-53`) с шаблонами инструкций. Задача — не строить детектор, а превратить сигналы в системное поведение.

**Что сделать.**
1. Агрегация: в `computeRoundDelta` (V3) добавить `stagnation: { repeatedPointCount, newContentRatio }`, где `newContentRatio` = (новые claims + objections + revisions за волну) / (число участников волны). Порог стагнации: две волны подряд `newContentRatio === 0` ИЛИ ≥ половины участников получили `REPEATED_POINT`.
2. Premature convergence: сигнал `FALSE_CONSENSUS` или `PREMATURE_VERDICT` в волне ≤ 2 при roundLimit ≥ 3 → пометка `state.convergenceWarning = { wave, kind }` + notify пользователю («Модели сошлись подозрительно рано — проверьте вердикт на группу-синк») + вставка в промпт следующей волны для всех: «Согласие достигнуто слишком быстро. Каждый участник обязан привести один сильный довод ПРОТИВ текущего консенсуса (steelman противоположной позиции)».
3. Стагнация (по порогу из п.1): в auto-режиме fixed-пресетов — только notify + отметка в ProcessAudit (V8); в Long-режимах — событие для adaptive stopping (V10).
4. Для run без registry: детекция повторов промптом round filter — в определение артефакта `round_delta` (V3.4) добавить обязательный подпункт «semantic duplicates: тезисы, повторяющие ранее сказанное без нового содержания».

**Приёмка.**
- Юнит-тесты порога стагнации (3 случая: свежий контент / две пустые волны / половина REPEATED_POINT).
- Тест convergence: FALSE_CONSENSUS на волне 2 → warning установлен, промпт волны 3 содержит steelman-вставку.
- Notify-вызовы замоканы и проверены.

## V5. Анонимизация моделей в промптах

**Проблема.** Промпты называют участников реальными именами моделей: `### ${turn.model}` в `buildRoundFilter`/`buildMultiWave` (`debate-prompt-catalog.js:69,124`), `Your model: ${modelName}` (`:129`), имена в `buildDuelFinalSynthesis` и checkpoint-промптах. Модели знают, кого критикуют (authority bias: критиковать GPT смелее, чем «Участника B», и наоборот).

**Что сделать.**
1. Модуль `disput/debate-anonymization.js`: `createAliasMap(models)` → стабильное соответствие `{ 'Claude': 'Участник A', ... }` (порядок — по исходному списку участников run); `anonymizeText(text, aliasMap)` — замена имён моделей и их частых само-упоминаний (словарь вариантов на модель: «GPT», «ChatGPT», «OpenAI» → алиас; словарь — экспортируемая константа `MODEL_NAME_VARIANTS`); `deanonymizeText(text, aliasMap)` — обратная замена для UI.
2. Точка применения — сборка промпта, НЕ хранение: state/registry/trace хранят реальные имена; алиасы подставляются в момент build* (все билдеры каталога и massage-файлов получают `aliasMap` параметром через U1 `assemble` / deps). Ответ модели деанонимизируется перед записью в feed/verdict (UI показывает реальные имена).
3. Включение — флаг пресета `anonymizeParticipants: true` по умолчанию для всех Verdict/Red Team пресетов, `false` для Long (там пользователь общается с моделями напрямую в manual-цикле — решение зафиксировать комментарием). Собственное имя модели в её же промпте («Your model») заменить на алиас во всех случаях.
4. Синтезатор получает анонимные тексты, но финальный вердикт после деанонимизации должен корректно называть участников — проверить, что замена `Участник A` → имя работает и в родительном/дательном падежах не встречается (алиасы выбраны несклоняемыми: «Участник A» склоняется… — использовать формы «участник A» без падежных вариаций невозможно; правило: deanonymize заменяет только точную строку алиаса; падежные искажения оставляем — это приемлемая цена, отметить в комментарии).

**Приёмка.**
- Юнит-тесты alias map: стабильность, коллизии (модель с именем, входящим в другое имя — заменять по убыванию длины).
- Тест промпта Multi: при флаге промпт волны не содержит ни одного реального имени модели (проверить по списку участников).
- Тест round-trip: anonymize → ответ с алиасами → deanonymize → реальные имена в feed.
- A/B-прогон для benchmark (T12): одна задача с/без анонимизации, результат в отчёт (не автоматизировать, процедура в benchmarks/README).

## V6. Полная причинная цепочка Red Team

**Проблема.** Red Team пресеты (`Duel Red Team`, `Triad Red Team`, `Multi Red Team` в `pipeline-presets.js:178,181,184`) имеют roundPlan с артефактами атак (`attack_surface_map` → `defence_retest` → `residual_risk_ranking`), но: защита и повторная проверка не разделены как стадии с разными исполнителями; retest делает тот же участник, что защищался; residual risk выводит синтезатор из общей кучи. Целевая цепочка: Proposal → Attack → Defence/Patch → **Independent** Retest → Residual Risk.

**Что сделать.**
1. Triad Red Team (основной случай, 3 участника — хватает ролей): переопределить roundPlan и роли:
   - R1 `proposal` — участник-proposer (роль `meta`) формулирует предложение/систему; двое других параллельно строят `attack_surface_map` (blind друг от друга — batch, как openings);
   - R2 `attack` — оба атакующих: `counterexamples`, `failure_modes` по карте атак;
   - R3 `defence_patch` — proposer отвечает на КАЖДУЮ атаку: patch / принятие риска / опровержение (T2-фаза defence);
   - R4 `independent_retest` — атакующий, чья атака НЕ была основной целью патча (правило выбора: не автор большинства пропатченных атак; при равенстве — второй атакующий), проверяет патчи: снята ли уязвимость, появились ли новые; proposer в этой стадии не участвует;
   - final: `residual_risk_ranking` + `red_team_verdict` — синтезатор.
   Реализация: расширить `BUILTIN_PIPELINE_DEFINITIONS` полем `stageRoles` (map round → participant-роли) и научить triad-runner назначать исполнителей волны по нему (сейчас все волны — все участники; найти место сборки волны в `triad-runner.js` по образцу multi). Это самая объёмная часть — если правка triad-runner превышает ~150 строк диффа, остановиться и согласовать с пользователем.
2. Duel Red Team (2 участника — независимого retest нет): честно понизить: R4 переименовать в `self_retest`, а в промпт синтеза добавить: «Retest не был независимым — автор патчей проверял себя сам; отрази это в остаточных рисках». Отметить в UI-описании пресета.
3. Multi Red Team: как Triad, но атакующих ≥ 2 и retest распределяется «крест-накрест» (каждый ретестит патчи чужих атак); при нечётном — остаток синтезатору.
4. Определения новых артефактов (`proposal`, `patch_map`, `retest_report`) — в `debate-artifact-definitions.js` (T1). Фазы для новых раундов — расширить маппинг `resolveStagePhase` (T2): `proposal` → opening, `attack` → critique, `defence_patch` → defence, `independent_retest` → отдельная фаза `retest` с собственным STAGE_TASKS-блоком («проверяй только заявленные патчи, не изобретай новые атаки; вердикт по каждому: снято / не снято / появилось новое»).
5. `debate-plan-validator.js` (U5): warning `retest_not_independent`, если исполнитель retest-стадии совпадает с исполнителем defence-стадии (для Duel — ожидаемый warning, подавляется флагом пресета `acceptSelfRetest: true`).

**Приёмка.**
- Компиляция обновлённых Red Team пресетов проходит валидатор; Duel даёт ожидаемый подавленный warning.
- Промпт-тесты: retest-промпт содержит retest-инструкции и патчи, НЕ содержит указания атаковать заново.
- Mock-тест triad-runner: волна R4 отправляется одному участнику, и это не proposer.
- Живой прогон Triad Red Team (ручной, шаги в отчёте): цепочка стадий видна в timeline, вердикт содержит residual risks.

## V7. Risk-based SynthesisAudit

**Проблема.** Финальный синтез никем не проверяется. Для high-stakes задач (factual/legal/security/red_team) цена пропущенной ошибки синтеза максимальна: потерянное меньшинство, добавленный от себя вывод, снятое без оснований возражение.

**Что сделать.**
1. Условие включения: `problemSpec.taskType` (U4) ∈ {`factual`, `red_team`, `decision`} ИЛИ `evidenceMode === 'required'` ИЛИ флаг пресета `synthesisAudit: 'required'`. Для brainstorming/creative и коротких Duel Verdict — выключен (флаг `'off'`), можно включить вручную.
2. Стадия `final:audit` ПОСЛЕ `final:synthesis` (компилятор: вставить перед завершением, kind `SYNTHESIS_AUDIT` — новый в `debate-stage-types.js`; валидатор U5: audit получает inputs `final:verdict` + фильтры + final words). Аудитор — участник, НЕ являющийся синтезатором (правило выбора: первый активный не-синтезатор; если некому — audit пропускается c trace-событием `STAGE_SKIPPED`, reason `no_independent_auditor`).
3. Промпт аудита (новый билдер в `debate-prompt-catalog.js`, контракт `synthesis_audit`): вход — вердикт + фильтры + final words; чек-лист:
   - каждое материальное утверждение вердикта прослеживается к позиции участника или помечено synthesis_inference (T9)?
   - позиции меньшинства из фильтров дошли до секции меньшинства?
   - нерешённые вопросы не потеряны?
   - есть ли в вердикте утверждения, противоречащие фильтрам?
   Выход — фиксированный формат: `## Вердикт аудита: pass | issues_found` + нумерованный список проблем с цитатами.
4. Обработка результата: `pass` → run завершается как раньше; `issues_found` → ОДИН корректирующий проход синтезатора (вердикт + список проблем → исправленный вердикт), затем завершение без повторного аудита (защита от цикла); в UI оба вердикта (финальный сверху, черновик сворачиваемый), отметка «прошёл аудит / исправлен по аудиту / аудит пропущен». `epistemicOutcome` (U2): непустой issues_found после исправления НЕ меняет outcome, но пишет signal.
5. Budget: аудит-промпт идёт через U1 assemble (фильтры + вердикт, без полной истории).

**Приёмка.**
- Юнит-тест условия включения (5 комбинаций taskType/evidenceMode/флаг).
- Mock-тест: audit возвращает issues_found → корректирующий диспатч выполнен ровно один раз; повторный issues_found не зацикливает.
- Тест выбора аудитора: синтезатор исключён; при единственной модели — STAGE_SKIPPED.
- Компиляция пресета с audit проходит валидатор; для Duel Verdict стадия отсутствует.

## V8. ProcessAudit: проверка качества процесса

**Проблема.** Никто не отвечает на вопрос «заявленный протокол действительно выполнен?»: получили ли claims критику, исполнены ли роли, не потерялось ли меньшинство, не крутились ли раунды вхолостую. Данные для ответа уже есть (registry, trace, roundDeltas) — нет отчёта.

**Что сделать.**
1. Модуль `disput/debate-process-audit.js`: `audit({ state, registry, plan, traceEvents }) → { checks: [{ id, verdict: 'pass'|'warn'|'fail', detail }], summary }`. Чеки (все — вычисления, БЕЗ LLM-вызова):
   - `claims_received_critique`: доля claims, имеющих ≥ 1 objection (V2) или contested-статус; < 50% → warn, 0 объектов критики → fail;
   - `roles_executed`: для каждого участника с ролью critical — оставил ли он objections/contested-переводы; для synthesizer — произведён ли вердикт; несоответствие → warn;
   - `minority_retained`: если в фильтрах была секция меньшинства (grep текста фильтров по заголовку) — есть ли она в вердикте (T9-секция) → fail при потере;
   - `rounds_productive`: из roundDeltas (V3) — волны с нулевым новым контентом → warn с номерами;
   - `plan_executed`: сверка плана и факта — каждый stageId плана имеет STAGE_COMPLETED или STAGE_SKIPPED в trace; расхождение → fail (тип `PLAN_ACTUAL_MISMATCH` уже есть в схеме — использовать);
   - `degraded_disclosed`: если был degradedMode (U3) — упомянут ли он в вердикте → warn.
   Run без registry: чеки claims/roles выдают verdict `'skipped'` с причиной.
2. Запуск автоматически после терминала (в обработчике финализации, рядом с U2 derive) — НЕ стадия плана, чистая пост-обработка. Результат — в state (`processAudit`), в persistent snapshot и в export.
3. UI: сворачиваемая панель «Аудит процесса» в терминальном виде run: строки чеков с ✓/⚠/✗. Поля — через проекции (U9).
4. Связка: fail-чеки добавляют signals в `epistemicOutcome.derive` (U2): `minority_retained: fail` или `plan_executed: fail` → outcome не выше `partially_resolved`.

**Приёмка.**
- Юнит-тесты каждого чека (pass/warn/fail фикстуры) + run без registry (skipped).
- Тест U2-связки: потерянное меньшинство понижает outcome.
- Терминальный run в UI показывает панель (проекционный тест в conformance-suite U8).

## V9. Разделение ролей: extractor / synthesizer / verifier

**Проблема.** Одна модель (`state.synthesizer`) совмещает: round filter (`runRoundFilter`), checkpoint-экстракцию (`runCheckpoint`: `models: [synthesizer]`), финальный синтез и — до V7 — самопроверку. Экстрактор, оценивающий дебаты, и синтезатор, пишущий вердикт, — разные функции с разными рисками смещения.

**Что сделать.**
1. В пресетах поле `serviceRoles: { extractor: '<модель>' | 'same_as_synthesizer', auditor: '<модель>' | 'auto' }` (auto = правило V7.2). По умолчанию `same_as_synthesizer` — поведение не меняется без явной настройки.
2. Прокинуть: `debate-run-services.js` `runCheckpoint`/`runDuelCheckpoint`/`runRoundFilter` принимают `extractorModel` (fallback — synthesizer, как сейчас); runner'ы берут из preset. UI выбора моделей run: селектор «Экстрактор» рядом с существующим селектором синтезатора (найти по grep `triadSynthesizer`/`multiSynthesizer` в UI-коде) — опционально, при пустом значении скрытая настройка не мешает.
3. Экстрактор — участник или третья модель: если extractor не входит в участников run, вкладка/сессия для него создаётся по тем же правилам, что для synthesizer-фильтра (`forceNewTabs: false`, комментарий в `runRoundFilter:53-56` — сохранить семантику).
4. V7-аудитор уже отделён правилом «не синтезатор» — свести оба выбора в один модуль `disput/debate-service-roles.js`: `resolveServiceRoles({ preset, participants, synthesizer })` → `{ extractor, auditor }` с юнит-тестами правил (extractor=synthesizer по умолчанию; auditor ≠ synthesizer; все fallback-ветки).

**Приёмка.**
- Юнит-тесты `resolveServiceRoles` (6 комбинаций).
- Mock-тест: пресет с отдельным extractor → checkpoint-батч уходит на него, синтез — на синтезатора.
- Без настройки поведение бинарно идентично (существующие тесты run-services зелёные без правок ожиданий).

## V10. Adaptive stopping для Long-режимов

**Проблема.** Long-пресеты (`DUEL_LONG`, `TRIAD_LONG`) бесконечны, terminationOwner `moderator` — но модератору не на что опереться: система не сообщает, что дебаты выдохлись. Checkpoint-политика уже тикает (`everyPublicTurns: 4` / `everyWaves: 2`, `pipeline-presets.js:79-87,115-119`).

**Что сделать.**
1. Правило (модуль `disput/debate-adaptive-stopping.js`): `assess({ roundDeltas, checkpointStats, budget }) → { recommendation: 'continue' | 'suggest_finalize', reasons }`. `suggest_finalize` когда: два последних RoundDelta (V3) подряд без новых claims/objections/revisions; ИЛИ стагнация V4; ИЛИ превышен мягкий бюджет (checkpoints ≥ 10 — конфигурируемо в checkpointPolicy как `softStopAfterCheckpoints`).
2. Вызов после каждого checkpoint в Long-run. `suggest_finalize` → НЕ останавливать: notify + баннер «Дебаты не производят нового содержания N волн. Рекомендуется завершить» с кнопкой «Завершить с синтезом» (существующий механизм ручной финализации Long — найти по grep `finalizationPolicy`/`manual_only` в results.js; кнопка вызывает его же). Повторные suggest_finalize не спамят: баннер обновляется, notify не чаще одного на 2 checkpoint.
3. Auto-остановки НЕТ нигде (решение всегда за модератором — соответствует terminationOwner). В trace — событие с recommendation для ProcessAudit (V8 `rounds_productive` может ссылаться).

**Приёмка.**
- Юнит-тесты `assess` (4 ветки: свежий контент / 2 пустые дельты / стагнация / бюджет).
- Mock-тест Long-цикла: после 2 пустых checkpoint вызван notify и выставлен флаг в state; run продолжает идти.
- Баннер в проекции (поле view-model), тест в conformance-suite.

---

## Отчёт исполнителя (обязателен)

`docs/section-three-report.md`: результат гейта V1 с числами (parse-rate, reject-rate, топ violations) и принятым решением; статус каждой задачи; изменённые файлы; для V6 — фактический размер правки triad-runner и решение (сделано/согласование); найденные ограничения anchor-валидации; замечания к качеству checkpoint-промпта. Без коммитов без запроса пользователя.

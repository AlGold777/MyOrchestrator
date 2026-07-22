# D95. Исходное ТЗ: малые улучшения, раздел IV

Дата: 2026-07-15. Основа: «Приоритизация развития Disput — версия Claude.md», раздел IV.
Предусловия: разделы I–III реализованы (задачи T1–T12, U1–U10, V1–V10 соответствующих ТЗ). КРИТИЧНО: задачи W1, W2, W3, W6, W8 зависят от registry и выполняются ТОЛЬКО если гейт V1 пройден (registry включён по умолчанию). Если нет — эти пять задач пропустить и зафиксировать в отчёте.

Исполнитель: LLM-агент среднего уровня. Общие правила — из ТЗ раздела I: рабочая папка `/Users/restart/Downloads/LLM_Sol-Fable`, без коммитов без запроса, IIFE-модули с `root.<Name>` + `module.exports`, зависимости через `deps`, каждая задача — самостоятельный диф с зелёным `npx jest`.

**Контекст, проверенный по коду:**
- Реестр моделей: `background/llm-targets.js` — `LLM_TARGETS` (GPT, Gemini, Claude, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai) содержит только url/delay/queryPatterns — метаданных о возможностях моделей НЕТ (нужны для W10).
- Телеметрия развитая: `background/telemetry-logs.js` — diagnostics events (`__diagnostics_events__`, до 2000 записей / 1.5 МБ), сэмплирование 5% сессий, `TELEMETRY_SCHEMA_VERSION = 2`; есть view-слой и тесты (`debate-telemetry-view.test.js`, `model-run-telemetry.test.js`, `telemetry-export.test.js` и др.) — W4 строится поверх, не заново.
- Trace-события Debate с таймстампами уже пишутся: `debate-trace-schema.js` (STAGE_STARTED/COMPLETED, DISPATCH_CREATED, RECOVERY_*, `sourceTimestamp`/`receivedAt`) — сырьё для per-stage latency готово.
- Registry (для W1/W2): `triad-registry.js`, artifacts типа `claim` с одним измерением статуса (`CLAIM_STATUSES: asserted/supported/contested/refuted/conceded`); после V2 у артефактов есть `history[]`, типы `objection`/`revision`.

**Важная рамка раздела.** Это «немного улучшит»: у каждой задачи жёсткий потолок объёма. Если задача выходит за указанный лимит диффа — остановиться и согласовать с пользователем, а не наращивать. Метрики и лейблы этого раздела — наблюдательные: ни одно системное решение от них зависеть не должно (правило VI.22 приоритизации).

**Рекомендованный порядок:** W4 → W10 → W1 → W2 → W6 → W3 → W9 → W5 → W7 → W8.

---

## W1. Расширенная типизация claims

**Что.** У claim в registry появляется поле `claimType`: `factual | causal | inferential | predictive | normative | recommendation | definition | requirement`.

**Как.**
1. `triad-registry.js`: константа `CLAIM_TYPES` (8 значений + `unclassified` по умолчанию); поле в артефакте; `applyDelta` принимает `claimType`, невалидное значение → `unclassified` БЕЗ violation (мягкая деградация — классификация вторична, не роняем дельту).
2. Checkpoint-промпт (`buildTriadCheckpointPrompt` в `triad-massage.js`): в формат дельты claim добавить поле типа с одной строкой-легендой на каждый тип (по 5–8 слов, писать самостоятельно).
3. `summarizeForCheckpoint` и registry-контекст волновых промптов: тип показывается однобуквенным/коротким тегом `[factual]` рядом с claim.
4. Использование (единственное на этом этапе): W3-метрики считают распределение по типам; V7-аудит для `taskType: factual` получает в промпт список claims типа `factual` без источников (связка с W2) — если W2 не сделан, пункт пропустить.

**Потолок:** ~120 строк диффа + тесты. **Приёмка:** юнит-тесты applyDelta (валидный тип / мусор → unclassified); snapshot-тест сводки с тегами; существующие registry-тесты зелёные.

## W2. Второе измерение статуса claim: verificationStatus (+ узкий decisionStatus)

**Что.** Текущий статус claim — дискуссионный (asserted…conceded). Добавить независимое измерение `verificationStatus`: `unverified | source_provided | source_verified | corroborated | disputed_sources`. Третье измерение `decisionStatus` — только заготовка: `undecided | accepted_for_decision | rejected | deferred`, выставляется ТОЛЬКО человеком (W5-стадия decision), автоматики нет.

**Как.**
1. `triad-registry.js`: оба поля у claim (по умолчанию `unverified` / `undecided`); переходы `verificationStatus` — через `applyDelta` op=update c anchor (checkpoint сообщает «участник привёл источник» → `source_provided`); `source_verified`/`corroborated` НЕДОСТУПНЫ checkpoint-модели — только человеку через UI (см. п.3) или будущей интеграции проверки (раздел V приоритизации). Правило зашить в `applyDelta`: попытка checkpoint-дельты установить verified → violation `verification_not_allowed_for_model`.
2. `history` (V2) фиксирует переходы обоих измерений (поле `dimension` в записи history).
3. UI: в панели claims (появится в W6/W8; до того — в существующем registry-выводе, найти по grep `registryContext`/registry-рендер в results.js) — контекстное действие человека «Отметить источник проверенным» → op=update от имени `source: 'human'` (registry принимает `basis: {kind:'human_verification'}` без anchor — расширить валидацию для human-опа).
4. Сериализация: оба поля в persistent state автоматически (артефакты в protocolState); экспорт (`debate-export`) включает.

**Потолок:** ~150 строк + тесты. **Приёмка:** юнит-тесты: модельная дельта на verified → violation; human-оп проходит; history фиксирует dimension; hydrate сохраняет поля. Старые снапшоты без полей читаются (дефолты).

## W3. Quality metrics

**Что.** Пост-run метрики качества процесса: наблюдательные числа в терминальной панели и экспорте. Решений от них не зависит.

**Как.**
1. Модуль `disput/debate-quality-metrics.js`: `compute({ registry, roundDeltas, processAudit, state })` → плоский объект:
   - `claimCoverage` — доля claims, получивших ≥1 objection или contested (пересечение с V8-чеком — переиспользовать его вычисление, не дублировать: V8 отдаёт detail с числами, взять оттуда либо вынести общий хелпер);
   - `objectionResponseCoverage` — доля objections со статусом answered/conceded (не raised/unresolved);
   - `evidenceCoverage` — доля claims типа factual (W1) с verificationStatus ≥ source_provided (W2); без W1/W2 — `null`;
   - `minorityRetention` — из V8-чека `minority_retained` (pass=1/fail=0/skipped=null);
   - `convergenceRate` — по roundDeltas: номер волны, после которой новые claims+objections стали 0, делённый на общее число волн (null, если не сходилось);
   - `compressionLoss` — эвристика: (суммарные символы ответов волн) / (символы всех round filters) — коэффициент сжатия, не «потеря» в строгом смысле; честно назвать `compressionRatio`;
   - `claimTypeDistribution` (W1).
   Каждое поле — `{ value, basis }` (basis — краткая строка «как посчитано»), чтобы UI мог показать тултип и никто не принял число за истину без определения.
2. Вызов рядом с ProcessAudit (V8) на терминале; результат в state (`qualityMetrics`), persistent snapshot, экспорт.
3. UI: строка-сводка в панели «Аудит процесса» (V8) — 5–6 чисел с тултипами. Отдельной страницы НЕ делать.

**Потолок:** ~200 строк + тесты. **Приёмка:** юнит-тесты compute на фикстурах registry (полный run / run без registry → все null с basis «registry disabled»); деление на ноль везде даёт null, не NaN; проекционный тест панели.

## W4. Расширенная observability: per-stage latency, рост контекста, retry-распределение

**Что.** Сводка исполнения run из уже пишущихся trace-событий: сколько занимала каждая стадия, как рос контекст, сколько было ретраев и чем кончились recovery.

**Как.**
1. Модуль `disput/debate-run-observability.js`: `aggregate(traceEvents)` →
   ```js
   { stages: [{ stageId, durationMs, dispatchCount, retryCount, outcome }],
     retryDistribution: { total, byReason: {...}, byModel: {...} },
     recoveryOutcomes: { attempted, succeeded, failed, manual },
     contextGrowth: [{ stageId, promptChars }],   // из T11-событий budget-check
     totals: { runDurationMs, dispatches, chars } }
   ```
   Источники: пары STAGE_STARTED/STAGE_COMPLETED|FAILED (по `sourceTimestamp`), RECOVERY_ATTEMPT_* (reasonCode), T11-события с размерами промптов. Всё из массива событий — без новых точек записи; если каких-то данных нет (T11 не писал размер) — поле null.
2. Где взять события: коллектор trace (найти по grep `DebateTraceSchema.createEvent` — кто собирает и где хранит; вероятно `debate-trace-store.js`, читающий/пишущий события run). `aggregate` работает по его выдаче.
3. UI: вкладка/секция «Исполнение» в существующем telemetry-view диспута (`debate-telemetry-view` — есть тест, найти модуль): таблица стадий + 3 строки итогов. Уважать существующий стиль view-модуля.
4. Экспорт: включить сводку в существующий telemetry/debate export (см. `telemetry-export.test.js` — не сломать формат, добавить секцию).

**Потолок:** ~250 строк + тесты. **Приёмка:** юнит-тест aggregate на фикстуре событий (3 стадии, 1 retry, 1 recovery fail) — точные числа; отсутствующие пары STARTED/COMPLETED не роняют (стадия с durationMs=null); существующие telemetry-тесты зелёные.

## W5. Специализированные human stages

**Что.** Сейчас человек в run — это approve/continue (APPROVAL_REQUESTED) и dropout-диалог. Добавить типизированные human-стадии: `review` (посмотрел, продолжить), `decision` (выбор из вариантов — пишет decisionStatus W2), `evidence_request` (человек даёт источник/файл к claim), `risk_acceptance` (принять остаточный риск Red Team, V6).

**Как.**
1. НЕ новые стадии плана по умолчанию — генерализация существующего approve-механизма: в `debate-run-store.js` `APPROVAL_REQUESTED` payload дополнить `humanStageKind: 'approve' | 'review' | 'decision' | 'evidence_request' | 'risk_acceptance'` и `humanStageInput` (schema на kind: decision — `{options: []}`, evidence_request — `{claimId}` и т.д.); `APPROVAL_GRANTED` payload — `humanResponse` (typed). Всё пишется в events → persistent, trace.
2. UI: компонент approve-панели (найти по grep `APPROVAL_REQUESTED`/approve-кнопки в results.js) рендерит форму по kind: review — кнопка; decision — радио-кнопки options + комментарий; evidence_request — текстовое поле «источник» + комментарий; risk_acceptance — чекбокс «принимаю» + обязательный комментарий.
3. Точки вызова (по одной на kind, больше не делать):
   - `decision`: если план содержит W5-стадию — пока только через custom-пресет; НЕ добавлять в builtin;
   - `evidence_request`: из UI claims-панели (W2.3) — человек сам инициирует, run приостанавливается как pause;
   - `risk_acceptance`: V6 Red Team — после `residual_risk_ranking` в manual-режиме;
   - `review`: алиас текущего approve (переименование kind, поведение то же).
4. Ответ человека — в registry, где применимо: decision → decisionStatus claims (W2), evidence_request → objection/claim получает `basis: human_evidence` с текстом источника (verificationStatus остаётся `source_provided` — человек ДАЛ источник, но это не проверка).

**Потолок:** ~300 строк + тесты (это самая объёмная задача раздела — если больше, резать точки вызова, оставляя механизм). **Приёмка:** store-тесты payload обоих событий с kind/response; UI-тест формы decision (проекция отдаёт options); тест записи decisionStatus после APPROVAL_GRANTED; conformance-сценарий U8 «manual approve» зелёный без правок.

## W6. Epistemic UI labels

**Что.** Пользователь должен видеть природу обоснованности каждого claim: «аргумент модели» / «источник указан» / «источник проверен» / «независимо подтверждён» / «оспорено» / «не решено».

**Как.**
1. Чистая проекция W2-полей — никакой новой логики: модуль-маппинг в `debate-projections.js`: `epistemicLabel(claim)` → одна из 6 меток по таблице: verificationStatus (unverified→«аргумент модели», source_provided→«источник указан», source_verified→«источник проверен», corroborated→«подтверждён независимо», disputed_sources→«источники противоречат») с приоритетом discussionStatus: contested и raised-objections → «оспорено», open unresolved-связка → «не решено» (точную таблицу приоритетов заложить константой и покрыть тестом).
2. UI: цветной бейдж рядом с claim во всех местах, где claims выводятся (registry-панель, W8-граф позже). Цвета: серый/синий/зелёный/тёмно-зелёный/оранжевый/красный; НЕ вводить новые цветовые токены — взять существующие из styles.css (найти классы статус-бейджей по grep существующего статусного UI).
3. Вердикт: в синтез-промпт (T9-секции) добавить требование помечать ключевые утверждения тегом `[аргумент моделей]` / `[источник: …]` — текстовое, без парсинга (модель сама расставляет; аудит V7 проверяет злоупотребления).

**Потолок:** ~120 строк + тесты. **Приёмка:** юнит-тест таблицы меток (8 комбинаций статусов); snapshot проекции claim с бейджем; тест промпта синтеза.

## W7. Разные UI-композиции для Duel, Triad и Multi

**Что.** Сейчас лента run визуально одинакова для всех топологий. Дать каждой свою композицию: Duel — два столбца диалога с центральной колонкой модератора/фильтров; Triad — три колонки + выделенная полоса синтезатора; Multi — сетка карточек волны + полоса фильтра.

**Как.**
1. Разведка (в отчёт, полдня): как рендерится лента сейчас — `deps.renderCards`, `appendFeed`, verdict-блок (grep по results.js/results-shared.js), и что уже отличается по топологиям. Возможно, часть композиции существует — тогда задача сужается до доводки.
2. Реализация ТОЛЬКО через CSS-раскладку поверх существующей DOM-структуры: контейнеру ленты — класс `debate-layout-{topology}` (топология известна из проекции), grid-раскладки в styles.css; JS-изменения — минимальные (проставить класс + атрибут `data-participant-slot` на карточки, чтобы CSS раскладывал по колонкам). НЕ переписывать рендер-функции.
3. Мобильная/узкая ширина: раскладки схлопываются в текущую одноколоночную (media query); ничего не ломается при ресайзе.
4. Long-режимы с бесконечной лентой — оставить одноколоночными (комментарий: колоночная раскладка ломается на сотнях ходов).

**Потолок:** ~80 строк JS + ~150 строк CSS. **Приёмка:** ручная проверка всех трёх топологий (скриншоты в отчёт) + узкое окно; jest-тест проставления класса по топологии; существующие рендер-тесты зелёные.

## W8. Визуализация claim graph

**Что.** Интерактивная схема: claims → objections → revisions со статусами и связями (V2 `targetId`/`claimId`/`basis.refId`), клик по узлу — anchor-цитата.

**Как.**
1. Модуль `disput/debate-claim-graph.js`: `buildGraph(registry)` → `{ nodes: [{id, type, label(≤60 симв.), status, epistemicLabel(W6)}], edges: [{from, to, kind: 'objects_to'|'revises'|'based_on'}] }`. Чистая функция, тестируется без DOM.
2. Рендер — инлайновый SVG БЕЗ внешних библиотек (расширение, CSP): слоистая раскладка (простой алгоритм: claims — колонка 1, objections — колонка 2 напротив цели, revisions — колонка 3; рёбра — прямые/дуги). Никакого force-directed — не тот объём.
3. Размещение: сворачиваемая секция «Карта утверждений» в терминальном виде run (рядом с ProcessAudit V8); кнопка «Открыть крупно» — новая вкладка с тем же SVG (data: URL или отдельная страница расширения — как проще в текущей структуре страниц).
4. Клик по узлу — боковой тултип: полный текст, статусы обоих измерений (W2), anchor-цитата с указанием turnId. Наведение на ребро — подсветка связанных узлов (CSS-класс).
5. Деградация: > 60 узлов — показывать только активные статусы с плашкой «показаны активные N из M»; registry пуст/выключен — секция не рендерится.

**Потолок:** ~350 строк (самая большая UI-задача; при превышении — выкинуть тултипы/подсветку, оставить статичную схему). **Приёмка:** юнит-тесты buildGraph (фикстура: 3 claims, 2 objections, 1 revision → точные nodes/edges); SVG-рендер — smoke-тест (валидный SVG-стринг, все узлы присутствуют); деградация > 60 узлов покрыта тестом.

## W9. Order-swap testing для Duel

**Что.** Проверка чувствительности вердикта Duel к порядку участников: тот же вопрос, A и B меняются местами (кто открывает — систематическое преимущество/недостаток).

**Как.**
1. Расширение benchmark-инфраструктуры T12 (НЕ отдельная система): в `benchmarks/README.md` — процедура order-swap прогона (та же задача, тот же пресет, слоты A/B переставлены, по 2 прогона на порядок); в `benchmarks/collect.js` — поддержка тега `orderSwap: 'AB'|'BA'` в имени файла результата и генерация секции сравнения «вердикт AB vs BA» в comparison.md.
2. Лист сравнения (rubric.md дополнить): совпал ли победитель/вывод; сместилась ли уверенность; изменился ли состав нерешённых вопросов. Оценивает человек.
3. Если V5 (анонимизация) реализована — прогоны выполнять с включённой анонимизацией: тест разделяет эффект порядка от эффекта имени модели. Отразить в процедуре.

**Потолок:** ~80 строк в collect.js + документация. **Приёмка:** `node benchmarks/collect.js --demo` с фикстурами AB/BA собирает секцию сравнения; README-процедура воспроизводима.

## W10. Автовыбор модели с большим context window

**Что.** Когда собранный контекст сервисной стадии (фильтр/checkpoint/синтез — они самые тяжёлые) приближается к лимиту, система предлагает модель с большим окном.

**Как.**
1. Метаданные: в `background/llm-targets.js` каждой записи `LLM_TARGETS` поле `contextClass: 'S' | 'M' | 'L'` (порядок ёмкости веб-интерфейса; точных чисел не публиковать — они меняются; выставить по общеизвестной ёмкости флагманских веб-чатов на момент реализации, значения перепроверить перед простановкой и датировать комментарием). Хелпер `getContextClass(llmName)` с fallback 'M'.
2. Правило (в `disput/debate-service-roles.js` из V9): `suggestLargerContext({ currentModel, estimatedChars, participants })` — если T11-оценка промпта > порога для класса текущей модели (пороги: S=50k, M=120k, L=∞ символов; константы рядом с contextClass) и среди участников/доступных моделей есть класс выше → вернуть кандидата.
3. Поведение — ТОЛЬКО предложение, никаких автопереключений посреди run: на старте run, если synthesizer/extractor класса S при Long-пресете или большом attachments-объёме — notify «Для синтеза рекомендуется <модель> (больше контекстное окно)»; в момент T11-переполнения — та же рекомендация в notify рядом с существующим предупреждением. Пользователь переключает вручную (существующие селекторы синтезатора/экстрактора).
4. Смена модели посреди run технически = V-раздел (замена участника) — сюда не тащить.

**Потолок:** ~100 строк + тесты. **Приёмка:** юнит-тесты suggestLargerContext (4 ветки: хватает / не хватает и есть кандидат / не хватает и некому / неизвестная модель); notify-вызов на старте Long с S-синтезатором (mock-тест); contextClass у всех 9 моделей проставлен.

---

## Отчёт исполнителя (обязателен)

`docs/section-four-report.md`: статус задач (отдельно — пропущенные из-за непройденного гейта V1); результаты разведок (W4.2, W7.1); скриншоты композиций W7; фактические объёмы диффов против потолков; datировка contextClass-значений W10. Без коммитов без запроса пользователя.

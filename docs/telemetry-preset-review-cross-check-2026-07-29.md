# Перепроверка внешних review telemetry presets (2026-07-29)

Источник: `LLMs answers jul26 14-27.txt` — семь ответов (GPT, Gemini, Claude, Grok,
Z.ai, Qwen, DeepSeek) на тот же запрос семантического review.

Проверка выполнена на текущем `main` (`a55b8e0`, версия контрактов
`REGISTRY_VERSION=5.1.0`, семь presets вместе с `prompt-not-inserted`), то есть
уже после hardening-серии 2.81.145–2.81.149. Каждое утверждение проверялось
исполнением кода, а не чтением. Тесты (`tests/proof-telemetry-*`, 81 шт.)
проходят — всё описанное ниже ими не покрывается.

## 1. Что уже закрыто hardening-серией

Из предыдущего review [telemetry-preset-semantic-review-2026-07-29.md](telemetry-preset-semantic-review-2026-07-29.md)
закрыто: incident-scoping derived views, `requiredIf` у conditional-слотов,
`postTerminalAuditStatus=null` (отсутствие аудита больше не опровергает
`false-success`), нормализация dispatch-идентификаторов, counter-evidence в
`prompt-not-sent`, ветка `wrong_node` в `empty`, `resolveAcceptedExtraction`,
`observationReliability ∈ {reliable, degraded, stale, unavailable}`, единый
источник слотов, `selectProofEvents` (граничная выборка), `primaryDiagnosis`.

## 2. Подтверждённые находки внешних review

Все воспроизведены на текущем коде.

| # | Находка | Кто | Воспроизведение |
|---|---|---|---|
| V1 | **Компактизация меняет вердикт.** Standalone пересчитывает derived view и applicability на materialized-подмножестве (`shared/proof-oriented-telemetry.js:1072-1080`). Контрдоказательства, не входящие в слоты preset'а, отбрасываются, и `not_confirmed` превращается в `confirmed` | GPT | Полный incident (failed submit → генерация 500 симв. → extraction → SUCCESS): `prompt-not-sent` = `not_confirmed`; `buildStandaloneReport` на тех же событиях → `confirmed`, `sufficiency=complete`, 4 события |
| V2 | **Арбитраж игнорирует достаточность доказательств.** `primaryDiagnosis` выбирается только по `applicability.status` (`:711`, `:1082`) | GPT, Qwen | `old-answer`: applicability `confirmed`, `completeness.level=insufficient`, `primaryDiagnosis=old-answer` |
| V3 | **Слот удовлетворяется типом события, а не фактом.** `resolveEvidenceSlots` (`shared/proof-telemetry-incidents.js:161`) фильтрует только по `eventType`; `typed.state`, payload, порядок и candidate не проверяются | GPT, Grok, Qwen | `MODEL_TERMINAL_RECORDED` со статусом FAILURE удовлетворяет слот `success_terminal` |
| V4 | **`old-answer` подтверждается при terminal FAILURE** — applicability не требует принятого ответа | GPT, Grok, Qwen | FAILURE + `previous_dispatch` → `confirmed` |
| V5 | **Нет временных инвариантов между слоями.** `POST_TERMINAL_AUDIT_COMPLETED` до terminal принимается как post-terminal доказательство | GPT | audit (seq 1, `contradicted`, growth 50) + terminal (seq 2) → `false-success` = `confirmed` |
| V6 | **`late-end` без порога.** Любая положительная задержка при наличии rejected-решения подтверждает диагноз | GPT (и предыдущий review) | задержка 1 мс → `confirmed` |
| V7 | **`late-end` доказывается только через `DECISION_RECORDED{accepted:false}`.** «Тихое» ожидание (deadline/policy без rejected-решения) даёт `unknown` | Grok | `policyWaitObserved` (`:560`) — единственный источник |
| V8 | **Coverage сравнивает разных кандидатов.** `maxObservedTextLength` берётся по всем text-событиям incident'а, `extractedTextLength` — из принятого extraction; continuity кандидата не проверяется | GPT, Qwen | текст 1000 (candidate A) + extraction 100 (candidate B) → `cutted` = `confirmed`, coverage 10 % |
| V9 | **`prompt-not-sent` при активной генерации без длины.** Контрдоказательство завязано на `generationTextObserved` (нужен `textLength`), а не на факт старта генерации | GPT | failed submit + `GENERATION_SIGNAL_CHANGED{state:active}` без длины → `confirmed` |
| V10 | **Два несогласованных scope-контракта.** `Contracts.sameIncidentScope` (используется policy и audit) не сравнивает `runGeneration`, `Incidents.exactScope` — сравнивает | GPT | `sameIncidentScope` с `runGeneration` 1 и 9 → `true` |
| V11 | **Несуществующий `incidentId` подменяется молча** — `selectIncident` сортирует и берёт первый, `selectionReason` при этом заявляет explicit-выбор | GPT | `incidentId:'incident:НЕТ-ТАКОГО'` → выбран `incident:run-1\|1\|GPT\|d1\|1` |
| V12 | **SYSTEM-события обходят scope-проверку целиком** (`shared/proof-telemetry-incidents.js:207`), включая `runSessionId` | Claude | SYSTEM-событие из другой сессии, подтянутое через `evidenceRefs`, попало в closure без violation |
| V13 | **Conditional-слоты искажают coverage.** Не сработавший conditional остаётся в знаменателе | GPT | `prompt-not-sent`: `sufficiency=complete` при 4/5 удовлетворённых слотов |
| V14 | **Порог роста задан в двух местах.** `THRESHOLDS.postTerminalGrowthTolerancePct` объявлен, audit хардкодит `0.5` (`shared/proof-telemetry-audit.js:80`) | GPT | чтение кода |
| V15 | **Состояния сопоставляются подстрокой.** `/truncat\|partial\|incomplete/` (`:506`) | Claude | `answerCompleteness='incomplete_pending_retry'` при coverage 100 % → `cutted` = `confirmed` |
| V16 | **У `old-answer` нет проверяемой доказательной базы.** Диагноз межинцидентный, но closure отвергает любое событие чужого incident'а, а prior-incident lane отсутствует (`grep priorIncident\|previousIncident\|crossIncident` — 0 совпадений). Доказательством служит самодекларация `answerEvidenceDispatchId` в terminal-событии | Claude | чтение кода + grep |
| V17 | **`false-success` не покрывает подмену без роста.** audit признаёт `contradicted` при hash-only изменении, applicability требует `growthChars > 0` | Grok, Qwen | вопрос preset'а «ответ продолжил расти» vs факт «ответ изменился» — требуется product-решение |
| V18 | **`canDiagnose`/`cannotDiagnoseAlone` — статические строки** (`:781`, `:1119`), одинаковые для всех presets | Claude | чтение кода |
| V19 | **Несогласованный словарь identity.** `old-answer` ждёт `previous_dispatch\|stale_accepted`, `empty` — `stale\|rejected\|ambiguous` | Claude | чтение кода |
| V20 | **Field provenance недостоверна.** Всем осям приписывается один и тот же полный список eventId (`:1099`), а для диагностических флагов (`incompleteCaptureEvidence`, `oldAnswerEvidence`, `lateEndEvidence` и др.) provenance отсутствует | GPT | чтение кода |
| V21 | **Completeness всего отчёта деградирует по худшему incident'у** (`:771`) — один нерелевантный incident делает report `insufficient` | GPT | чтение кода |

Частично подтверждено: `selectProofEvents` может отбросить опровергающее
событие (Grok B7) — role-key включает `typed.state`, поэтому `verified:false`
как отдельная роль сохраняется; риск остаётся только для событий, чья
опровергающая информация лежит в payload и не отражена в typed-факте.

## 3. Отклонено

* **Gemini** и **Z.ai** отвечали без кодовой базы: разбирают выдуманные presets
  (`Connection Loss & Reconnect Loop`, `DB_Pool_Exhaustion`, метрики
  `db.pool.active`). Пригодных находок нет; общая рамка (completeness vs
  verdict) уже реализована.
* **GPT** сообщает об отсутствии `shared/proof-telemetry-clock.js`,
  `background/proof-telemetry-ledger.js` и каталога спецификации — это дефект
  переданного ему архива, а не репозитория; из-за него его выводы о clock-контракте
  строились на собственной заглушке.
* **Qwen** и **DeepSeek** дали структурно идентичные ответы; уникальных находок
  сверх таблицы §2 у них нет (их вклад — «candidate continuity», «пороги
  значимости», «forced terminal семантически спорен для `false-success`»,
  включённые в план ниже).

## 4. Консолидированный план

Порядок — по тяжести последствий: сначала то, что делает отчёт недостоверным,
затем ложные срабатывания, затем метрики и наблюдаемость.

**Задача 1. Вердикт не должен зависеть от компактизации (V1).**
Вычислять applicability и derived view на полном frozen incident, переносить их
в standalone-отчёт как записанный результат; компактизация обязана сохранять все
события, влияющие на подтверждение, опровержение, unknown, identity, порядок и
причинность.
*Приёмка:* для всех presets `verdict(fullIncident) === verdict(materializedReport)`
на фиксированных сценариях и на случайных удалениях событий; кейс
prompt-not-sent из V1 даёт `not_confirmed` в обоих режимах; в отчёт добавлено
поле с хешем полного incident'а, по которому проверяется совпадение.

**Задача 2. Composite verdict вместо raw applicability (V2, V21).**
Ввести `diagnosticVerdict = f(applicability, sufficiency, invariantViolations)`:
`confirmed` только при `complete|bounded` и отсутствии нарушений инвариантов;
`confirmed` + `insufficient` → `unknown`. Арбитраж и `primaryDiagnosis` строить
по verdict. Completeness агрегировать по паре `(reportType, incidentId)`, а не по
худшему incident'у run'а.
*Приёмка:* сценарий V2 даёт `verdict=unknown` и `primaryDiagnosis=null`;
отчёт с одним нерелевантным incident'ом не понижает completeness релевантного;
в контейнере виден `verdict` по каждому incident'у.

**Задача 3. Fact-level контракт слота (V3).**
Расширить слот до альтернатив вида `{eventType, factPredicate, payloadPredicates,
identityRelation, temporalRelation}`; для critical/required слотов требовать
совпадения факта, а не только типа.
*Приёмка:* terminal FAILURE не удовлетворяет `success_terminal`; audit без
`evidenceRefs` на terminal и observation не удовлетворяет `post_terminal_audit`;
событие чужого кандидата не удовлетворяет сравнительный слот; на каждый слот —
positive/negative/malformed тесты.

**Задача 4. Временные и причинные инварианты (V5).**
Ввести проверяемые отношения `baseline < submit < acceptance < generation <
extraction < decision < terminal < audit` с исключениями только через явные
recovery/supersession события; нарушение — `invariantViolation` и запрет на
сильный вердикт.
*Приёмка:* audit до terminal → violation и `false-success = unknown`; extraction
после terminal без recovery-связи не используется как принятый; validator
воспроизводит те же нарушения, что и builder.

**Задача 5. Единый identity-контракт (V10, V12, V19).**
Свести `sameIncidentScope` и `exactScope` к одной реализации, включающей
`runGeneration`; SYSTEM-события допускать в closure только при совпадении
`runSessionId` (и `runGeneration`, если задан); единый нормализующий helper для
словаря identity-состояний, общий для `old-answer` и `empty`.
*Приёмка:* разные `runGeneration` никогда не один scope; SYSTEM-событие чужой
сессии, подтянутое через `evidenceRefs`, отклоняется с violation; значение
`stale` трактуется одинаково в обоих presets либо различие задокументировано.

**Задача 6. Candidate continuity в измерениях (V8).**
Сравнивать `maxObservedTextLength` и `extractedTextLength` только внутри одного
`candidateId`/lineage; при несовпадении или отсутствии candidate identity —
`unknown` вместо вычисленного coverage.
*Приёмка:* сценарий V8 даёт `cutted = unknown` и явный `missingItem` про
несопоставимую identity; тот же расчёт внутри одного кандидата — `confirmed`.

**Задача 7. Опровергающие предикаты как отдельная часть контракта (V4, V9).**
Ввести `refutation`-предикаты, при срабатывании которых вердикт принудительно
`not_confirmed`. Для `old-answer` — требовать принятого ответа (terminal
outcome/accepting decision); для `prompt-not-sent` и `prompt-not-inserted` —
считать контрдоказательством сам факт старта генерации текущего dispatch, а не
только измеренную длину.
*Приёмка:* FAILURE + `previous_dispatch` → `not_confirmed`/`unknown`;
failed submit + `GENERATION_SIGNAL_CHANGED{active}` без длины → `not_confirmed`;
существующие positive-кейсы не регрессируют.

**Задача 8. `late-end`: порог и альтернативные доказательства ожидания (V6, V7).**
Задержку считать относительно доказанной policy-границы (момента, с которого
завершение уже было разрешено), а не абсолютного числа; `policyWaitObserved`
дополнить `TERMINAL_DEADLINE_REACHED` и `FINALIZATION_POLICY_EVALUATED` с
блокерами ожидания.
*Приёмка:* 1 мс → `not_confirmed`; «тихое» ожидание 8 с с deadline-событием →
`confirmed`; мутация текста внутри интервала → `not_confirmed`; несопоставимые
часы → `unknown`.

**Задача 9. Доказательная база `old-answer` (V16).**
Ввести явную ссылку на prior incident (`priorIncidentRef`) и отдельную полосу
доказательств, позволяющую приобщить terminal/extraction исходного инцидента;
без найденного prior-инцидента слот считать `unavailable`, а не удовлетворённым
самодекларацией.
*Приёмка:* при наличии prior-инцидента в ledger его события попадают в closure с
явным `includedFor`; при отсутствии — `sufficiency` не выше `bounded` и в
`missingItems` указана недоступность prior-инцидента.

**Задача 10. Единая семантика изменения ответа после terminal (V14, V17).**
Порог брать из `THRESHOLDS.postTerminalGrowthTolerancePct`; определить, что
доказывает `false-success` — рост или любое изменение принятого ответа, и
привести audit, derived-флаг и вопрос preset'а к одному определению
(при выборе «изменение» — отдельная ветка `hash_changed` в отчёте).
*Приёмка:* значение порога встречается в коде один раз; hash-only изменение даёт
задокументированный и протестированный статус; forced-terminal кейс явно
классифицирован.

**Задача 11. Точность метрик и провенанса (V13, V15, V18, V20).**
Coverage считать по effective required set; сравнение состояний перевести с
regex на перечислимые множества; `canDiagnose`/`cannotDiagnoseAlone` привязать к
конкретным slotId и осям; provenance вести пофайлово для каждого диагностического
флага, а не общим списком.
*Приёмка:* не сработавший conditional не влияет на coverage;
`incomplete_pending_retry` не подтверждает `cutted`; два incident'а с разным
набором отсутствующих слотов дают разные списки заключений; для каждого
диагностического флага provenance содержит только участвовавшие eventId.

**Задача 12. Безопасный выбор incident'а (V11).**
При неизвестном `incidentId` возвращать `no_matching_incident`, а не подменять
инцидент молча.
*Приёмка:* запрос несуществующего `incidentId` завершается явной ошибкой или
пустым результатом с этой причиной; `selectionReason` никогда не заявляет
explicit-выбор при фактическом fallback.

**Задача 13. Тестовая матрица под §2.**
Добавить: эквивалентность вердикта до и после компактизации; type-present /
fact-absent для каждого critical-слота; audit до terminal; несколько extraction
с supersession; разные candidate/document/navigation/runGeneration; несуществующий
incidentId; applicability confirmed при отсутствующих critical-слотах;
пороговые тесты (`порог-1`, `порог`, `порог+1`); конфликтующие факты
(confirmed+failed, verified+rejected, current+stale); forced/recovery terminal;
observer `degraded|stale|unavailable`.
*Приёмка:* каждый пункт §2 закрыт регрессионным тестом, который падает на
текущем коде и проходит после соответствующей задачи.

## 5. Статус реализации

План выполнен в версиях `2.81.152`–`2.81.155`. Все V1–V21 закрыты executable
contracts и adversarial regressions; итоговые registry/report/generator версии
— `5.4.0` / `2.6.0` / `1.7.0`. All tasks и семь standalone examples проходят
offline validation без ошибок. Focused gate: 8 suites / 88 tests; полный gate:
186 suites / 1292 tests.

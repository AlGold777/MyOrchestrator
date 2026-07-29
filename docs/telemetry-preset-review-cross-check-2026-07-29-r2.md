# Проверка внешних review итерации 2 (файл `LLMs answers jul26 16-01.txt`)

Семь ответов на тот же запрос по снимку `jul29 15-24`. Проверка выполнена
исполнением кода на `main` (`a6c23bc`, `REGISTRY_VERSION=5.4.0`); тесты
(`tests/proof-telemetry-*`, `tests/proof-oriented-*`, 114 шт.) проходят, ни одна
из подтверждённых находок ими не ловится.

## 1. Оценка ответов

| Модель | Оценка |
|---|---|
| GPT | Наиболее содержательный. Восемь системных дефектов, все проверяемые утверждения воспроизвелись. Численные факты о коде точны до единицы (50 слотов, 10 matchRule, 3 refutation). |
| Claude | Точный и адресный: семь находок, шесть подтвердились, одна ошибка в счёте пар. Формулировки привязаны к конкретным функциям. |
| Qwen | Сильный разбор, 16 задач; проверенные G1/G2/G5/G6 воспроизвелись, включая одну важную регрессию. |
| Gemini | На этот раз по делу, но общими формулировками; уникальных проверяемых находок сверх GPT/Qwen нет. |
| DeepSeek | Пересказ контрактов, план из общих задач («добавить слот», «проверить условия»); воспроизводимых дефектов не содержит. |
| Z.ai | Не по этой кодовой базе: разбирает выдуманные presets «OOM / K8s eviction», прямо оговаривая отсутствие кода. |
| Grok | Ответа нет — воспроизведён только текст запроса. |

## 2. Подтверждённые находки

Все воспроизведены исполнением, кроме помеченных «чтение кода».

| # | Находка | Автор | Воспроизведение |
|---|---|---|---|
| A1 | **`bounded` даёт `confirmed`.** `diagnosticVerdict` понижает вердикт только при `insufficient`, поэтому отсутствие required-слотов не блокирует диагноз | GPT (P0-1), Qwen (G4) | `prompt-not-inserted` с `DISPATCH_BASELINE_CAPTURED` + failed insertion: `sufficiency=bounded`, missing `composer_context(required)`, `submit_counterevidence(required)` → `verdict=confirmed` |
| A2 | **Невозможный аудит опровергает `false-success`.** `postTerminalAuditStatus='impossible'` — известное значение, предикат `eq 'completed'` даёт `not_confirmed` | Qwen (G1) | SUCCESS + рост 50 + `MISSING_EVIDENCE_RECORDED{post_terminal_comparable_measurement, unavailable}` → `not_confirmed` вместо `unknown`. Это та же ошибка «нет данных = доказано отсутствие», что была устранена для случая полностью отсутствующего аудита |
| A3 | **Candidate continuity применена только к coverage.** Рост чужого кандидата подтверждает `false-success`; extraction чужого кандидата подтверждает `empty` | GPT (P0-3) | terminal candidate A (100) + пост-terminal текст candidate B (150) + audit → `postTerminalGrowthProven=true`, `verdict=confirmed`; генерация A (100) + `EXTRACTION_COMPLETED{failed}` кандидата B → `empty=confirmed` |
| A4 | **Нет модели supersession — в обе стороны.** История агрегируется то слишком широко, то слишком узко | GPT (P0-4) | `probably_truncated` → `probably_complete` → SUCCESS: `incompleteCaptureEvidence=true`, `cutted=confirmed` при coverage 100 %. Обратно: audit(growth 50, contradicted) → audit(growth 0, confirmed) → `postTerminalGrowthProven=false`, ранее доказанный рост исчезает |
| A5 | **Рост в пределах tolerance даёт `unknown` вместо опровержения** | Qwen (G2) | SUCCESS(1000) + audit `confirmed, growthChars=1, growthPct=0.1` → `postTerminalGrowthProven=null`, `false-success=unknown`, хотя измерение отрицательное |
| A6 | **`late-end` опровергается любой мутацией, в том числе без изменения длины** | Qwen (G5) | `TEXT_STATE_CHANGED` с той же длиной 100 между границами → `postStabilityMutationObserved=true`, `lateEndEvidence=false` |
| A7 | **Absence-диагнозы разрешены при `degraded` наблюдении.** Гейт исключает только `unavailable` и `stale` | GPT (P0-7) | failed submission + `OBSERVER_HEALTH_OBSERVED{degraded}` → `prompt-not-sent=confirmed` при `observationReliability=degraded` |
| A8 | **Слот `late-end.stable_boundary` предъявляет не ту пару, что участвовала в расчёте** | Claude (Г) | Два `STABILITY_INTERVAL_CLOSED` (mono 1000 и 3000) → слот содержит `e1, e3`, а `stableToTerminalMs=6000` посчитан от `e3`; temporal-правила для этой пары в `SLOT_MATCH_RULES` нет |
| A9 | **`ambiguous_pre_terminal_extraction` не оставляет следа.** Downstream-флаги корректно уходят в `unknown`, но факт «identity была неоднозначной» не фиксируется событием, в отличие от `auditPossible=false` в `proof-telemetry-audit.js` | Claude (В) | чтение кода: единственное вхождение — `shared/proof-oriented-telemetry.js:371`, эмиттера нет |
| A10 | **`completeness.level` смешивает «неприменимо» и «не собрали».** При отсутствии релевантных инцидентов уровень падает в `insufficient` | Claude (Е) | чистый прогон: `prompt-not-sent`, `old-answer`, `empty` → `applicability=not_confirmed`, `completeness=insufficient`, `coverage=0` |
| A11 | **Дедупликация ledger не различает identity.** `stateKey` — `runSession\|model\|dispatch\|generationEpoch\|layer\|typed.kind`, сравнение — `stableStringify({eventType, payload})`, а `stripEnvelopeMetadata` удаляет `candidateId`, `documentInstanceId`, `turnId`, `navigationEpoch`, `causationId`, `correlationId` из metadata | GPT (P0-6) | чтение кода: `background/proof-telemetry-ledger.js:122-129, 434, 576-577`. Два одинаковых по payload наблюдения разных кандидатов схлопываются в no-op |
| A12 | **Выбор инцидента не учитывает вердикт.** Ранжирование по task-score/contradiction/terminal/recency | Qwen (G6) | два инцидента одной модели: выбран `d1` с причиной `task_evidence_rank_then_latest_including_zero_match`, альтернатива указана, но вердикты в ранжировании не участвуют |
| A13 | **`refutation` только у 3 из 7 presets**; **причинные правила покрывают 2 связи** | Claude (А, Д), GPT | подсчёт: 7 presets, 50 слотов, 10 `matchRule`, 3 `refutation`, 6 уникальных sibling-пар, 2 causal-правила |
| A14 | **Минимальность не достигнута: расхождение любого из семи вердиктов ведёт к материализации всего инцидента** | GPT (P1-2) | совпадает с находкой G1 моего review r2: 9 из 9 прогонов дали полный дамп инцидента |

Кроме того подтверждается на уровне кода: `prior_incident_evidence`
удовлетворяется существованием prior-инцидента и материализуется terminal-событием
текущего (GPT, раздел 4.3; совпадает с G6 моего r2), сравнение содержимого
принятого ответа с prior-ответом не выполняется вовсе.

## 3. Неточности внешних ответов

* Claude: «9 sibling-пар» — фактически 6 уникальных пар (12 направленных
  записей). Вывод о неполноте causal-правил при этом верен.
* Claude: пример «`empty` и `old-answer` подтверждены одновременно из одного
  extraction-события» не воспроизвёлся — `old-answer` уходит в `unknown` из-за
  недоступной prior-полосы; структурная часть находки (роль `related` без
  `causedBy`) остаётся верной.
* GPT: «в UI и correlation нужно показывать `selectionReason`/альтернативы» —
  они уже экспортируются в `correlation` (`selectionReason`,
  `otherMatchingIncidents`, `matchingIncidentCount`); недостаёт именно учёта
  вердикта при выборе (A12).
* Z.ai и Grok полезных данных не дали; Gemini и DeepSeek не добавили ничего
  сверх перечисленного.

## 4. Дополнение к плану r2

Нумерация продолжает
[telemetry-preset-semantic-review-2026-07-29-r2.md](telemetry-preset-semantic-review-2026-07-29-r2.md).
Задачи 1-10 остаются в силе; A14 подтверждает задачу 1, A3 расширяет задачу 2,
A9 примыкает к задаче 3, A8 — к задаче 4, A13 — к задачам 7 и 8.

**Задача 11. Required-слоты должны блокировать подтверждение (A1).**
Ввести различие между `confirmed` (полный набор обязательных доказательств) и
`supported_but_incomplete` (`bounded`); в арбитраже как первичный диагноз
допускать только `confirmed`.
*Приёмка:* `prompt-not-inserted` без `composer_context`/`submit_counterevidence`
даёт `supported_but_incomplete` и не становится `primaryDiagnosis`; при
дозаполнении слотов — `confirmed`; существующие тесты обновлены под новый статус.

**Задача 12. Невозможность измерения ≠ опровержение (A2, A5).**
`postTerminalAuditStatus='impossible'` должен давать `unknown`, а не
`not_confirmed`: заменить предикат `eq 'completed'` на явную обработку
`impossible|pending|null`. Рост в пределах `postTerminalGrowthTolerancePct`
считать доказательством отсутствия — `postTerminalGrowthProven=false`.
*Приёмка:* SUCCESS + рост + `MISSING_EVIDENCE_RECORDED{unavailable}` →
`unknown`; SUCCESS + audit `confirmed, growthPct=0.1` → `not_confirmed`;
SUCCESS + audit `contradicted, growthPct=30` → `confirmed`.

**Задача 13. Candidate continuity во всех доказательных цепочках (A3).**
Требовать совпадения кандидата (или доказанного lineage `A superseded by B`) для
пост-terminal роста, ветки `empty`, completeness-оценок и structural
verification, а не только для coverage.
*Приёмка:* рост кандидата B после terminal кандидата A → `false-success=unknown`;
генерация A + extraction B → `empty=unknown`; те же наборы с общим кандидатом →
прежние вердикты.

**Задача 14. Модель supersession (A4).**
Ввести жизненный цикл оценок (`observation → hypothesis → decision →
superseded|reaffirmed|invalidated`): completeness-состояния учитывать по
последнему действующему, а доказанный рост не отменять более поздним аудитом,
измерившим ту же выросшую версию.
*Приёмка:* `truncated → complete` → `cutted=not_confirmed`; audit(50) →
audit(0) на той же длине → `false-success=confirmed`; audit(50) → audit(0) после
доказанного отката содержимого → `not_confirmed` с явной причиной.

**Задача 15. Строгие условия для absence-диагнозов (A7).**
Ввести `absenceObservationWindow` (границы, требуемые сигналы, покрытие, skew) и
подтверждать `prompt-not-sent`/`prompt-not-inserted` только при полном покрытии;
`degraded` понижать до `unknown`.
*Приёмка:* failed submission при `degraded` → `unknown`; при `reliable` и полном
окне → `confirmed`; окно с пропуском сигналов → `unknown` с явным missing item.

**Задача 16. Identity в дедупликации ledger (A11).**
Включить `candidateId`, `documentInstanceId`, `turnId`, `navigationEpoch` в
`stateKey` и в сравнение no-op; наследовать identity в companion-события.
*Приёмка:* два наблюдения с одинаковым payload и разными `candidateId` дают два
события; companion-события содержат identity исходного события; тест на
подавление повторов внутри одного кандидата продолжает проходить.

**Задача 17. Разделить «неприменимо» и «не собрали» (A10, A12).**
Ввести `completeness.level='not_applicable'` для случая отсутствия релевантных
инцидентов; в выборе инцидента для standalone учитывать вердикт (предпочитать
инцидент с `confirmed`, при равенстве — сообщать неоднозначность).
*Приёмка:* прогон без проблем даёт `completeness=not_applicable`, а не
`insufficient`; при двух инцидентах, где диагноз подтверждён только во втором,
standalone выбирает второй либо возвращает явную неоднозначность.

**Задача 18. Аудируемость неоднозначной identity (A9).**
При `ambiguous_pre_terminal_extraction` эмитить
`MISSING_EVIDENCE_RECORDED{extraction_identity_ambiguous, status: unavailable}`.
*Приёмка:* два несвязанных `EXTRACTION_COMPLETED` без acceptance-признаков дают
такое событие, оно попадает в отчёт, зависимые флаги равны `null`.

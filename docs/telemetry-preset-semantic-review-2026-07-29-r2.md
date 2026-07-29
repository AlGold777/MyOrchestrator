# Семантический review telemetry presets — итерация 2 (2026-07-29, снимок 15:24)

Снимок `presets-analyze.txt` побайтово совпадает с `main` (`a6c23bc`,
`REGISTRY_VERSION=5.4.0`, семь presets). Проверка выполнена исполнением кода:
`deriveModelView` → `evaluateApplicability` → `resolveEvidenceSlots` →
`diagnosticVerdict`, а также `buildStandaloneReport`/`buildAllPresets`.
Тесты (`tests/proof-telemetry-*`, `tests/proof-oriented-*`, 114 шт.) проходят;
всё, что ниже, ими не покрывается.

## 1. Состояние контрактов по presets

Контракты сейчас выражены исполняемо: applicability-предикаты, `refutation`,
слоты с `criticality` + `requiredIf` + `matchRule` (fact/temporal),
`counterEvidenceTypes`, `diagnosticVerdict = f(applicability, sufficiency,
invariantViolations)`.

| Preset | Вопрос | Критерий подтверждения | Опровержение | `unknown` | Статус |
|---|---|---|---|---|---|
| `cutted` | SUCCESS зафиксирован, а текст неполный | `terminalOutcome=SUCCESS` + `incompleteCaptureEvidence` (coverage < 98 % по сопоставимому кандидату либо перечислимое truncated-состояние) | coverage ≥ 98 % либо explicit complete | нет сопоставимой длины/кандидата | ⚠ G2 |
| `false-success` | Решили «готово», ответ продолжил расти | SUCCESS + audit `contradicted` с `growthChars>0`, audit ссылается на terminal и на послеterminal-наблюдение | audit `confirmed`, рост 0 | аудита нет либо `impossible` | ⚠ G9 |
| `old-answer` | Принят текст предыдущего запроса | SUCCESS + identity принятого ответа ≠ текущий dispatch (нормализованные id) | `terminalOutcome ≠ SUCCESS`; identity `current` | id неизвестны | ⚠ G6 |
| `empty` | Генерация была, extraction пуст или не тот узел | `generationTextObserved` + (`empty_result` \| `wrong_node`) | непустое verified extraction текущего dispatch | extraction не найден/неоднозначен | ok |
| `prompt-not-inserted` | Prompt не вставился | typed insertion `failed` при отсутствии контрдоказательств и пригодном наблюдении | `promptInsertedCounterEvidence` | наблюдение `stale/unavailable` | ok |
| `prompt-not-sent` | Модель не получила запрос | typed submission `failed` при отсутствии контрдоказательств (включая факт старта генерации) | `promptReceivedCounterEvidence` | нет typed-фактов submission | ok |
| `late-end` | Текст стабилен, система ждала ещё N секунд | сопоставимые часы + задержка ≥ порога + доказанное ожидание policy + отсутствие мутаций после стабилизации | задержка < порога, мутация внутри интервала, ожидания не было | несопоставимые часы, наблюдение непригодно | ⚠ G4, G5 |

Уровни обязательности (обязательные / условно обязательные / вспомогательные)
заданы в `REPORT_CONTRACTS.slots`; «условно обязательные» реализованы через
`requiredIf` и повышаются до `required` при выполнении условия. Избыточное
отсекается на входе: operational-тики (`OPERATIONAL_EVENT_PATTERN`) и события,
не входящие ни в слоты, ни в `counterEvidenceTypes`.

Разделение (п. 6 задания) выполнено: `sufficiency` (полнота доказательств) и
`applicability` (применимость диагноза) считаются независимо и сводятся в
`diagnosticVerdict`; арбитраж работает по вердикту, а не по applicability.

## 2. Найденные пробелы

### G1. Минимальность отчёта фактически не достигается (критично)

Standalone сравнивает **весь** `stateAxes` и applicability **всех семи** presets
до и после компактизации (`shared/proof-oriented-telemetry.js:1211-1223`) и при
любом расхождении материализует весь инцидент.

Проверено: для инцидента из 23 / 73 / 313 событий и presets `cutted`,
`late-end`, `empty` — **9 из 9 запусков** дали
`fallbackMaterializedFullIncident=true`, отчёт содержал 100 % событий инцидента
(313 из 313, 190 КБ). Причина расхождения на минимальном примере: компактный
набор `cutted` (9 событий) законно не содержит submission/page-событий, из-за
чего деградируют оси `submission` (`confirmed → not_attempted`), `generationStart`
(`started → not_evaluated`), `textEvolution` (`stable → none`) и меняется
applicability чужого preset'а `late-end` (`not_confirmed → unknown`).

Следствие: `selectProofEvents` в продуктивном пути не влияет ни на что, а
требование «минимальный по объёму отчёт» нарушается системно.

### G2. `cutted` систематически `unknown` на реальной телеметрии (критично)

После введения candidate continuity coverage считается только по событиям с тем
же `candidateId` (`:447-455`). Продюсеры `candidateId` не выставляют — ledger
лишь пробрасывает `meta.candidateId`; `answerIdentity` формируется только на
terminal-событии (`background/job-orchestrator.js:8411`), поэтому hint из
extraction пуст.

Проверено на обычном потоке (наблюдалось 1000 символов, extraction 100, SUCCESS):
`candidateContinuity=unknown`, `extractionCoveragePct=null`,
`cutted = unknown` — очевидная обрезка не диагностируется.

### G3. Одно нарушение инварианта гасит все диагнозы инцидента

`diagnosticVerdict` получает нарушения, посчитанные по инциденту целиком
(`:818-828`), поэтому нарушение, относящееся к одному виду доказательств,
обнуляет вердикт всех presets. Проверено: инцидент `prompt-not-sent`
(applicability `confirmed`) с посторонним `POST_TERMINAL_AUDIT_COMPLETED` без
`evidenceRefs` → `diagnosticVerdict=unknown`, `invariantViolationCount=1`.

### G4. Внутри `late-end` отсутствие наблюдений всё ещё работает как доказательство

`postStabilityMutationObserved` вычисляется как «нет TEXT_STATE_CHANGED между
границами». Проверено: инцидент без единого наблюдения текста
(`STABILITY_INTERVAL_CLOSED` → `TERMINAL_DEADLINE_REACHED` → terminal) даёт
`late-end = confirmed` при слоте `text_evolution` в статусе `unavailable`
(sufficiency `bounded`). Положительный диагноз опирается на ненаблюдение.

### G5. Порог `late-end` абсолютный

`THRESHOLDS.lateEndPolicyToleranceMs = 1000` — фиксированная величина, тогда как
принятый контракт требует измерять просрочку относительно доказанной
policy-границы. Сейчас 999 мс → `not_confirmed`, 1001 мс → `confirmed`
независимо от того, когда завершение стало разрешено.

### G6. Слот `prior_incident_evidence` не содержит доказательств prior-инцидента

Слот критический, но материализуется terminal-событием **текущего** инцидента и
лишь гейтится наличием prior-инцидента в экспорте
(`shared/proof-telemetry-incidents.js:257-261`). События prior-инцидента
попадают в closure отдельным путём (`prior-incident:*`), в слот — нет. При этом
если prior-инцидент вне границы экспорта (предыдущая сессия), `old-answer` при
доказанной identity получает `insufficient → unknown` навсегда (проверено).

### G7. `refutation` задана не для всех presets

`refutation.any` есть только у `old-answer`, `prompt-not-inserted`,
`prompt-not-sent`. У `cutted`, `false-success`, `empty`, `late-end` опровержение
выражается лишь отрицанием applicability, из-за чего «доказано, что проблемы
нет» неотличимо от «предикат не выполнился».

### G8. Причинные правила покрывают 2 связи из 7

`DIAGNOSIS_CAUSAL_RULES` — `false-success → cutted` и
`prompt-not-inserted → prompt-not-sent`. Для остальных одновременно
подтверждённых пар роль остаётся `related, causedBy: null`, а первичный диагноз
выбирается статическим приоритетом.

### G9. Ограничение legacy-источника оформлено как нарушение инварианта

Legacy-адаптер не строит `evidenceRefs`, поэтому temporal-правило
`false-success.post_terminal_audit` не выполняется никогда, а
`validateTemporalInvariants` фиксирует `CAUSAL_AUDIT_LINEAGE`. В связке с G3 это
переводит **все** presets такого инцидента в `unknown`. Проверено: audit с
`contradicted, growthChars=30` без `evidenceRefs` → `sufficiency=insufficient`,
`viol=1`, `verdict=unknown`; тот же набор с `evidenceRefs` → `confirmed`.

### G10. Пробелы тестов

Нет тестов на объём отчёта и на срабатывание fallback (поэтому G1 невидим), на
инцидент без `candidateId` (G2), на изоляцию нарушений между presets (G3), на
`late-end` без наблюдений текста (G4), на пограничные значения порога (G5), на
недоступный prior-инцидент (G6).

## 3. План исправлений

**Задача 1. Сохранять вердикт без потери минимальности (G1).**
Считать derived views и оси на полном инциденте и переносить их в отчёт как
записанный результат (`recordedDerivedView` + хеш полного инцидента); проверку
эквивалентности сузить до проекции, относящейся к данному диагнозу: его
applicability, refutation-входы и факты его слотов. Fallback на полный инцидент
оставить как аварийный путь.
*Приёмка:* на инциденте из 313 событий отчёт `cutted` содержит ≤ 40 событий при
`diagnosticVerdict=confirmed`; `fallbackMaterializedFullIncident=false` во всех
сценариях, где вердикт и его доказательства сохранены; тест фиксирует верхнюю
границу размера отчёта и равенство вердиктов до/после компактизации.

**Задача 2. Градуированная сопоставимость измерений (G2).**
Ввести уровни `measurementComparability`: `candidate_proven` (совпал
`candidateId`), `dispatch_proven` (identity текущего dispatch),
`single_candidate` (в инциденте один кандидат и нет `CANDIDATE_SET_CHANGED` с
заменой), `unknown`. Coverage считать на всех уровнях кроме `unknown`, понижая
sufficiency до `bounded` для слабых уровней. Параллельно — выставлять
`candidateId` в продюсерах extraction/terminal.
*Приёмка:* поток без `candidateId` с одним кандидатом (1000 наблюдалось,
extraction 100, SUCCESS) даёт `cutted=confirmed` с
`measurementComparability=single_candidate` и `sufficiency=bounded`; поток с
двумя кандидатами и без identity остаётся `unknown`; событие extraction
содержит `candidateId` в runtime-тесте.

**Задача 3. Локализовать нарушения инвариантов (G3, G9).**
Привязать каждое нарушение к слоту/полю (`affectedSlotIds`, `affectedFields`) и
гасить вердикт только тех presets, чьи доказательства затронуты. Для
legacy-режима отсутствие `evidenceRefs` фиксировать как `limitation`
(`clock/lineage unavailable`), а не как нарушение инварианта продюсера.
*Приёмка:* посторонний битый audit не меняет вердикт `prompt-not-sent`;
`false-success` в том же инциденте получает `unknown` с явной причиной;
legacy-экспорт не содержит `CAUSAL_AUDIT_LINEAGE` в `invariantViolations`, а
несёт limitation, и остальные presets сохраняют свои вердикты.

**Задача 4. Положительное доказательство отсутствия мутаций (G4).**
`postStabilityMutationObserved=false` принимать только при наличии наблюдений,
покрывающих интервал (`OBSERVATION_FRAME_CAPTURED`/закрытый observation
interval/`TEXT_STATE_CHANGED` без изменения длины); иначе — `null` и `unknown`.
Слот `text_evolution` для `late-end` поднять до `critical`.
*Приёмка:* инцидент без наблюдений текста → `late-end=unknown`; тот же инцидент
с кадрами наблюдения без мутаций → `confirmed`; мутация внутри интервала →
`not_confirmed`.

**Задача 5. Относительный порог просрочки (G5).**
Считать просрочку от момента, когда завершение стало разрешено (последний
`FINALIZATION_POLICY_EVALUATED`/`COMPLETION_HYPOTHESIS_EVALUATED`, снявший
блокеры, либо `TERMINAL_DEADLINE_REACHED`), с `lateEndPolicyToleranceMs` как
допуском измерения, а не как критерием диагноза.
*Приёмка:* задержка 5 с, целиком объяснённая незакрытым policy-блокером →
`not_confirmed`; та же задержка после снятия блокеров → `confirmed`; в отчёте
присутствует момент разрешения и его eventId.

**Задача 6. Настоящая полоса prior-инцидента (G6).**
Слот `prior_incident_evidence` матчить событиями prior-инцидента
(`MODEL_TERMINAL_RECORDED`/`EXTRACTION_COMPLETED` в его scope); при доказанной
identity и недоступном prior-инциденте — `bounded` с явным `missingItem`
`prior_incident_outside_export`, а не `insufficient`.
*Приёмка:* при наличии prior-инцидента слот содержит его eventId; при его
отсутствии `old-answer` даёт `confirmed` с `sufficiency=bounded` и явной
пометкой; identity-опровержение продолжает давать `not_confirmed`.

**Задача 7. Полный контракт опровержения (G7).**
Добавить `refutation.any` для `cutted` (coverage ≥ порога при сопоставимом
измерении и explicit complete), `false-success` (audit `confirmed`, рост 0),
`empty` (verified непустое extraction текущего dispatch), `late-end` (мутация
после стабилизации либо задержка ниже допуска).
*Приёмка:* для каждого preset есть сценарий, дающий `not_confirmed` именно по
refutation-предикату (виден в `refutationResults`), и сценарий `unknown`, где ни
один refutation-предикат не known.

**Задача 8. Полнота причинных правил (G8).**
Для каждой пары из `SIBLING_RULES` задать направление (`cause → consequence`)
либо явно пометить `co-occurring, no causal claim`; арбитраж должен объяснять
роль каждого подтверждённого диагноза.
*Приёмка:* при одновременном `confirmed` вне текущих двух пар ни один диагноз не
получает `related, causedBy: null` без документированного `co-occurring`.

**Задача 9. Регрессионная матрица под §2.**
Тесты: верхняя граница объёма отчёта и `fallback=false` (G1); инцидент без
`candidateId` (G2); изоляция нарушений (G3); `late-end` без наблюдений и с
кадрами (G4); пороговые значения `порог-1 / порог / порог+1` (G5); недоступный
prior-инцидент (G6); refutation-ветка каждого preset (G7); одновременное
подтверждение вне причинных пар (G8); legacy-экспорт без ложных нарушений (G9).
*Приёмка:* каждый тест падает на текущем коде и проходит после соответствующей
задачи; `scripts/validate-proof-telemetry.js` валидирует перегенерированные
примеры.

**Задача 10. Синхронизация спецификации и registry.**
Отразить `measurementComparability`, локализованные нарушения, относительный
порог `late-end`, prior-incident lane и полные refutation-контракты в
`SPECIFICATION.md` и `registry/report-dependency-registry.json`; поднять
`REGISTRY_VERSION`, версии `package.json`/`manifest.json`, дополнить
`docs/CHANGELOG.md`.
*Приёмка:* сравнение registry-файла с кодом остаётся зелёным; версии подняты;
изменения описаны в CHANGELOG.

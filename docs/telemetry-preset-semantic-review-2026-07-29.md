# Семантический review механизма telemetry presets (2026-07-29)

Область: `shared/proof-telemetry-contracts.js`, `shared/proof-oriented-telemetry.js`,
`shared/proof-telemetry-incidents.js`, `shared/proof-telemetry-audit.js`,
`docs/proof_oriented_telemetry_spec_v1/*`, `tests/proof-telemetry-*`.

Базовое требование: preset должен формировать **минимальный по объёму, но
доказательно полный** отчёт под конкретный диагноз. Наличие события нужного типа
не является доказательством проблемы.

Все утверждения ниже проверены исполнением кода (`deriveModelView` +
`evaluateApplicability` + `buildAllPresets`) на позитивных, негативных и
неопределённых наборах событий; воспроизводящие наборы указаны в §2.

### Независимая перепроверка перед реализацией

Фактические находки приняты с четырьмя уточнениями к плану реализации:

1. Runtime-аудит в штатном порядке загрузки делегирует scope-проверку в
   `ProofTelemetryPolicy.sameScope`, где уже учитываются `dispatchId` и
   `generationEpoch`. Опасен fallback только по run+model; его требуется
   устранить, но он не является штатным поведением runtime.
2. Для `late-end` нельзя вводить произвольный абсолютный порог. Просрочка должна
   считаться относительно доказанной policy-границы, после которой конкретный
   run уже мог быть завершён.
3. Связанные диагнозы нельзя делать взаимоисключающими ценой ложного
   `not_confirmed`. Одновременно истинные причина и последствие сохраняют свою
   applicability, а контейнер явно фиксирует `primaryDiagnosis`, `causedBy` и
   роль диагноза в объяснении.
4. Минимизация задаётся семантическими правилами отбора доказательств, а не
   фиксированным лимитом событий. `All tasks` остаётся общей проекцией одного
   ledger; incident-минимальность обязательна для standalone preset.

---

## 1. Целевые контракты по presets

Ниже — то, каким контракт **должен** быть (диагностический вопрос, критерий
подтверждения, обязательность типов событий, правила опровержения и `unknown`).
Отличия текущей реализации помечены ⚠ и раскрыты в §2.

### 1.1. `cutted` — «зафиксирован SUCCESS, а текст неполный»

* **Вопрос:** почему принятый (сохранённый) текст короче того, что реально
  наблюдалось в DOM к моменту terminal?
* **Критерий подтверждения:** `terminalOutcome == SUCCESS` **и** доказанный
  дефицит захвата **на границе terminal**: `extractionCoveragePct < 98`, где
  покрытие считается как `extractedTextLength / maxObservedTextLength` **по
  событиям того же incident и только до terminal**, либо явный
  `ANSWER_COMPLETENESS_EVALUATED ∈ {probably_truncated, verified_truncated}`.
* **Обязательные:** `MODEL_TERMINAL_RECORDED` (с длиной принятого текста),
  `TEXT_STATE_CHANGED` (эволюция длины), `EXTRACTION_COMPLETED` с собственной
  длиной извлечения.
* **Условно обязательные:** `FINALIZATION_POLICY_EVALUATED` / `POLICY_OVERRIDE_APPLIED`
  — обязательны, если `terminalMode ∈ {forced, recovery}`;
  `POST_TERMINAL_AUDIT_COMPLETED` — обязателен, если применяется рост после
  terminal (иначе преcет опирается только на coverage).
* **Вспомогательные:** `CANDIDATE_SET_CHANGED`, `CANDIDATE_IDENTITY_INFERRED`,
  `DECISION_RECORDED`, `STRUCTURAL_VERIFICATION_EVALUATED`.
* **Избыточные:** пост-terminal рост как *первичное* доказательство — это
  предмет `false-success` (см. §1.2 и D1).
* **Опровержение:** coverage ≥ 98 при известной `extractedTextLength`,
  происходящей из самого extraction-события, и audit `conclusion=confirmed`.
* **`unknown`:** нет длины в extraction-событии; нет terminal; наблюдение
  деградировано (`observationReliability ∈ {degraded, unavailable}`).
* ⚠ Реализация подтверждает `cutted` по неаудированному пост-terminal росту и
  подставляет длину terminal вместо длины extraction.

### 1.2. `false-success` — «решили „готово“, а ответ продолжил расти»

* **Вопрос:** почему terminal SUCCESS зафиксирован до фактического окончания
  генерации?
* **Критерий:** `terminalOutcome == SUCCESS` **и** `POST_TERMINAL_AUDIT_COMPLETED`
  с `conclusion=contradicted` и `growthChars > 0`, где сравниваемые наблюдения
  принадлежат **тому же** `dispatchId`/`generationEpoch`.
* **Обязательные:** `MODEL_TERMINAL_RECORDED`, `POST_TERMINAL_AUDIT_COMPLETED`,
  пост-terminal `TEXT_STATE_CHANGED`.
* **Условно обязательные:** `TERMINAL_DEADLINE_REACHED` / `POLICY_OVERRIDE_APPLIED`
  — при `terminalMode=forced`; `COMPLETION_HYPOTHESIS_EVALUATED` — при
  `terminalMode=automatic` (нужно основание completion).
* **Вспомогательные:** `GENERATION_SIGNAL_CHANGED`, `OBSERVATION_FRAME_CAPTURED`,
  `DECISION_RECORDED`.
* **Избыточные:** hash-only мутация без роста; мутации до terminal.
* **Опровержение:** audit `conclusion=confirmed` при `growthChars = 0`.
* **`unknown` (ключевое):** audit **не проводился** или невозможен (вкладка
  закрыта, observer недоступен) — это отсутствие данных, а не опровержение.
* ⚠ Реализация в этом случае выдаёт `not_confirmed` (B1).

### 1.3. `old-answer` — «принят текст предыдущего запроса»

* **Вопрос:** принадлежит ли принятое answer evidence текущему dispatch?
* **Критерий:** identity принятого evidence: `answerEvidenceDispatchId != dispatchId`
  при **обоих известных и нормализованных** идентификаторах, либо
  `EXTRACTION_COMPLETED.answerIdentity ∈ {previous_dispatch, stale_accepted}`.
* **Обязательные:** `DISPATCH_BASELINE_CAPTURED`, `CANDIDATE_IDENTITY_INFERRED`,
  `EXTRACTION_COMPLETED`, `MODEL_TERMINAL_RECORDED`.
* **Условно обязательные:** `PAGE_CONTEXT_OBSERVED` — при наличии SPA-навигации
  или смены `documentInstanceId`/`navigationEpoch`.
* **Вспомогательные:** `CANDIDATE_SET_CHANGED`, `STRUCTURAL_VERIFICATION_EVALUATED`.
* **Избыточные:** факт корректного отклонения stale-кандидата (это доказательство
  исправной работы, а не проблемы).
* **Опровержение:** `answerIdentity=current_dispatch` у принятого extraction.
* **`unknown`:** `dispatchId` у terminal отсутствует; идентификаторы в разных
  форматах; identity не выводилась.
* ⚠ Реализация подтверждает диагноз при отсутствующем `dispatchId` у terminal и
  при разном формате идентификаторов (A4).

### 1.4. `empty` — «генерация была, extraction пуст или не тот узел»

* **Вопрос:** почему при наблюдавшейся генерации не получен корректный текст?
* **Критерий (две ветки):**
  1. *пусто*: `generationTextObserved == true` **и** принятое extraction
     `failed` либо `extractedTextLength == 0`;
  2. *не тот узел*: extraction непустой, но `verification=rejected` либо
     `answerIdentity ∈ {ambiguous, rejected, stale}` при непустом наблюдавшемся
     тексте.
* **Обязательные:** `GENERATION_START_EVALUATED`/`GENERATION_SIGNAL_CHANGED` с
  ненулевой длиной, `EXTRACTION_COMPLETED`, `CANDIDATE_SET_CHANGED`/
  `CANDIDATE_IDENTITY_INFERRED`.
* **Условно обязательные:** `OBSERVER_HEALTH_OBSERVED`/`PAGE_HEALTH_OBSERVED` —
  обязательны при `observationReliability=degraded` (иначе нельзя отличить
  «пусто» от «не наблюдали»).
* **Вспомогательные:** `STRUCTURAL_VERIFICATION_EVALUATED`, `TEXT_STATE_CHANGED`.
* **Опровержение:** принятое extraction с длиной > 0 и verified identity.
* **`unknown`:** extraction не выполнялся; длина генерации неизвестна.
* ⚠ Ветка «не тот узел» не реализована; «принятым» считается последнее по
  порядку extraction-событие, а не то, на которое опирался terminal (C4).

### 1.5. `prompt-not-sent` — «модель не получила запрос»

* **Вопрос:** было ли действие отправки принято платформой?
* **Критерий:** typed `submission.state = failed` **и** отсутствие любого
  последующего доказательства обратного (подтверждённая submission, наблюдавшаяся
  генерация, непустое extraction, SUCCESS terminal).
* **Обязательные:** `DISPATCH_BASELINE_CAPTURED`, `SUBMIT_ACTION_OBSERVED`,
  `SUBMISSION_EVIDENCE_CHANGED`/`SUBMISSION_INFERRED`.
* **Условно обязательные:** `PAGE_HEALTH_OBSERVED` — при `submission=attempted`
  без acceptance evidence.
* **Вспомогательные:** `OBSERVER_HEALTH_*`, `OBSERVATION_SLOT_DENIED`.
* **Опровержение (жёсткое):** `generationTextObserved == true`, непустое
  extraction или `terminalOutcome == SUCCESS` — генерация доказывает получение
  запроса независимо от качества submission-сигналов.
* **`unknown`:** только attempted/partial evidence.
* ⚠ Реализация подтверждает preset при успешно полученном ответе (C3).

### 1.6. `late-end` — «текст давно стабилен, а система ждала ещё N секунд»

* **Вопрос:** какая задержка между доказанной стабилизацией текста и terminal и
  чем она объясняется?
* **Критерий:** сопоставимые монотонные часы **и** `stableToTerminalMs >
  порога` (порог из policy, а не `> 0`) **и** отсутствие релевантных мутаций
  текста/активной генерации внутри интервала.
* **Обязательные:** `STABILITY_INTERVAL_CLOSED`, `MODEL_TERMINAL_RECORDED`,
  `TEXT_STATE_CHANGED` (для доказательства отсутствия мутаций в интервале).
* **Условно обязательные:** `TERMINAL_DEADLINE_REACHED`/
  `FINALIZATION_POLICY_EVALUATED` — обязательны, если интервал превышает
  policy-окно (иначе задержка не объяснена);
  `OBSERVATION_SLOT_DENIED`/`OBSERVER_HEALTH_INTERVAL_CLOSED` — при деградации
  наблюдения.
* **Вспомогательные:** `GENERATION_SIGNAL_CHANGED`, `DECISION_RECORDED`.
* **Опровержение:** мутации текста внутри интервала; интервал ≤ порога.
* **`unknown`:** разные clock epochs (`basis != producer_monotonic|ingest_monotonic`).
* ⚠ Реализация подтверждает при 1 мс и при продолжающемся росте текста (C1, C2).

---

## 2. Найденные пробелы

### A. Identity- и scope-связи (нарушен п. 4 задания)

* **A1. Derived views смешивают dispatch'и.** `deriveModelView` вызывается для
  всех событий модели за run (`shared/proof-oriented-telemetry.js:607`), scope по
  `dispatchId`/`generationEpoch` не применяется. Проверено: terminal dispatch-1
  (100 симв.) + текст dispatch-2 (900 симв.) → `postTerminalGrowthChars = 800`,
  `false-success` и `cutted` = `confirmed`. Диагноз строится на событиях чужого
  запроса. Standalone-путь этой ошибки не имеет (incident closure), то есть два
  пути дают разные ответы на одних данных.
* **A2. Runtime-audit имеет небезопасный fallback scope.** В штатном runtime
  `sameScope` делегирует проверку в `ProofTelemetryPolicy.sameScope`, где
  учитываются `dispatchId` и `generationEpoch`. Но fallback в
  `shared/proof-telemetry-audit.js:7` сравнивает только run+model и способен
  смешать incident'ы при отдельной загрузке модуля. Fallback должен быть таким
  же строгим, как основной контракт.
* **A3. Отсутствующая длина трактуется как 0.** `numberFrom`
  (`shared/proof-telemetry-audit.js:17`) возвращает 0 при отсутствии метаданных,
  далее `growthPct = 100` (строка 69) → `contradicted`. Terminal без
  `answerLen` гарантирует ложный `false-success`.
* **A4. `oldAnswerEvidence` ложно срабатывает.**
  `shared/proof-oriented-telemetry.js:419` сравнивает
  `answerEvidenceDispatchId` со `String(terminalEvent.dispatchId || '')`.
  Проверено: terminal без `dispatchId` → `oldAnswerEvidence = true`,
  applicability `confirmed`. Кроме того, `job-orchestrator.js:8406` кладёт
  идентификатор вида `LLM:id`, а `dispatchId` события берётся из
  `meta.dispatchId` — при расхождении формата preset подтверждается системно;
  проверено: `answerEvidenceDispatchId='GPT:d1'` при `dispatchId='d1'` и
  `answerIdentity=current_dispatch` → `confirmed` (готовая identity-оценка
  игнорируется).

### B. Разделение «нет доказательства» и «доказано отсутствие» (п. 3)

* **B1. `false-success` не может быть `unknown`.**
  `postTerminalAuditStatus` = `'not_applicable'` при отсутствии audit
  (`shared/proof-oriented-telemetry.js:443`) — это *известное* значение, поэтому
  предикат `eq 'completed'` даёт `not_confirmed`. Проверено: пустой набор
  событий и набор «terminal SUCCESS + рост без audit» → `not_confirmed`.
  Невозможность аудита (закрытая вкладка, недоступный observer) выдаётся за
  опровержение проблемы — прямое нарушение §29 спецификации.
* **B2. Измеренное отсутствие роста не фиксируется как `false`.** Строка 393:
  при наличии пост-terminal наблюдений и нулевом росте `postTerminalGrowthProven`
  = `null`, а не `false` — теряется единственное честное опровержение.
* **B3. Разный доказательный барьер у соседних presets.** `cutted` принимает
  неаудированный рост (`incompleteCaptureEvidence` через `postTerminalGrowthProven`,
  строка 412), `false-success` — нет. Проверено: набор «SUCCESS + рост без
  audit» → `cutted=confirmed`, `false-success=not_confirmed`.
* **B4. Подмена факта в coverage.** Строка 376: если в `EXTRACTION_COMPLETED`
  нет длины, берётся длина terminal. Проверено: наблюдалось 1000, extraction без
  длины → `extractedTextLength=1000`, `coverage=100 %` — реальная обрезка
  extraction невидима, а провенанс поля указывает на extraction.
* **B5. Деградация наблюдения не влияет на applicability.** Ни один preset не
  использует `observationReliability`; сами оси никогда не принимают значения
  `unavailable`/`stale` (строка 353), хотя спецификация §5 требует трактовать
  отсутствие сигнала при `unavailable` как `unknown`.

### C. Сила критериев подтверждения (п. 1)

* **C1. `late-end` без порога.** Применимость: `stableToTerminalMs > 0`
  (`shared/proof-telemetry-contracts.js:112`). Проверено: 1 мс → `confirmed`.
  В `THRESHOLDS` нет параметра задержки; `generationStartTimeoutMs`
  (`contracts.js:9`) не используется нигде.
* **C2. `late-end` без причинной проверки.** Проверено: стабильность на 1000 мс,
  рост текста на 3000 мс, terminal на 9000 мс → `confirmed`,
  `stableToTerminalMs=8000`, хотя генерация шла. Граница берётся как *последняя*
  `STABILITY_INTERVAL_CLOSED` до terminal (строка 365) без проверки отсутствия
  мутаций внутри интервала.
* **C3. `prompt-not-sent` без опровергающих фактов.** Проверено: failed
  submission → генерация 500 симв. → extraction → SUCCESS terminal даёт
  `confirmed`. Кроме того, критерий берёт *последний* submission-факт
  (строка 424): последовательность confirmed → failed также даёт `confirmed`, а
  failed → повторная успешная отправка без typed-факта остаётся `confirmed`.
* **C4. `empty` уже своего вопроса и зависит от порядка.** Ветка «не тот узел»
  не выражена ни в одном предикате. «Принятым» считается последнее
  extraction-событие (строка 372): успешное extraction, за которым следует
  неудачная повторная попытка, даёт `confirmed` (проверено).
* **C5. `cutted` смешивает причины.** `incompleteCaptureEvidence` (строка 412)
  объединяет пост-terminal рост, явную truncation и coverage; coverage считается
  от `maxObservedTextLength`, куда попадают и пост-terminal, и (см. A1) чужие
  dispatch-события.

### D. Связанные диагнозы и дублирование (п. 5)

* **D1. Один набор доказательств подтверждает два preset'а.** Проверено:
  SUCCESS(100) + пост-terminal текст(130) + audit `contradicted` →
  `cutted=confirmed` **и** `false-success=confirmed`. Приоритета/эксклюзивности
  нет: `SIBLING_RULES` (`shared/proof-oriented-telemetry.js:494`) лишь помечают
  связь, но оба отчёта заявляют подтверждённый диагноз.
* **D2. Anti-loop только в standalone.** В embedded-отчётах у siblings нет
  `antiLoop` (строки 514-526 против 784-794), хотя registry-файл его описывает.
* **D3. Нет арбитража на уровне контейнера.** Контейнер не содержит поля вида
  `primaryDiagnosis`/`supersededBy`, поэтому потребитель отчёта видит несколько
  «подтверждённых» диагнозов без правил разрешения.

### E. Полнота доказательств vs применимость диагноза (п. 6)

* **E1. В embedded-отчётах контракт доказательств не вычисляется вообще.**
  `buildReports` (строка 503) не использует `REPORT_CONTRACTS.slots`,
  `resolveEvidenceSlots` и `buildEvidenceClosure`. `completeness.level` — всегда
  `partial`/`insufficient`; `evidenceCoveragePct` = доля релевантных событий во
  всём ledger (в проверке — 66.67 %, величина не имеет диагностического смысла);
  `missingItems`, `safeConclusions`, `canDiagnose`, `cannotDiagnoseAlone` —
  всегда пусты. То есть в основном экспортируемом артефакте разделение
  «достаточность доказательств / применимость диагноза» реализовано только
  наполовину: applicability есть, sufficiency — нет.
* **E2. Два источника истины о составе preset'а.** `REPORT_INFO`
  (`shared/proof-oriented-telemetry.js:29`) против `REPORT_CONTRACTS.slots`
  (`shared/proof-telemetry-contracts.js:16`). Проверенный drift: `cutted`,
  `false-success` — `MISSING_EVIDENCE_RECORDED`; `empty` —
  `OBSERVATION_FRAME_CAPTURED`, `OBSERVER_HEALTH_INTERVAL_CLOSED`;
  `prompt-not-sent`, `late-end` — `OBSERVER_HEALTH_INTERVAL_CLOSED`,
  `OBSERVATION_SLOT_DENIED`. Эти слоты в embedded-представлении не могут быть
  заполнены никогда.
* **E3. Уровень `conditional` не имеет условия.** `resolveEvidenceSlots`
  (`shared/proof-telemetry-incidents.js:104`) трактует `conditional` как
  «необязательный всегда» (`not_observed`), поэтому категория «условно
  обязательные» из задания в коде отсутствует: нет предиката, при котором слот
  становится обязательным (например `finalization_policy` при
  `terminalMode=forced`).

### F. Минимальность отчёта

* **F1. Слот включает все совпавшие события.** `resolveEvidenceSlots` берёт
  каждое событие подходящего типа; для `TEXT_STATE_CHANGED` и
  `OBSERVATION_FRAME_CAPTURED` это неограниченный объём вместо граничной выборки
  (первое/последнее/экстремумы/явно связанные `evidenceRefs`).
* **F2. Closure добавляет заведомо нерелевантное.**
  `shared/proof-telemetry-incidents.js:143-152` безусловно включает все SYSTEM
  события run и все `DECISION_RECORDED`/`MODEL_TERMINAL_RECORDED`/audit-события
  incident'а независимо от того, нужны ли они слотам preset'а.
* **F3. Нет явного разделения режимов минимальности.** `All tasks` обоснованно
  содержит все шесть projections и единый ledger, включая отрицательные и
  неопределённые выводы. Но standalone preset должен гарантировать
  incident-scoped proof-preserving closure, а контейнер — не дублировать
  материализованные события внутри projections.

### G. Legacy-путь

* **G1.** В legacy-адаптере `clock.producerEpochId='legacy-clockless'` и
  `ingestEpochId='legacy-adapter'` (`shared/proof-oriented-telemetry.js:249`),
  поэтому `stableToTerminalMs` всегда `null` и `late-end` всегда `unknown`
  (проверено: `basis=clock_point_missing`). Поведение честное, но ограничение
  нигде не фиксируется как `MISSING_EVIDENCE_RECORDED`/limitation в отчёте.
* **G2.** `deriveAxes` выводит `answerIdentity='current_dispatch'` из одного лишь
  факта наличия `dispatchId` у любого события (строка 345) — идентичность
  объявляется без identity-доказательства, что противоречит §29 спецификации.

### H. Покрытие тестами (п. 7)

`tests/proof-telemetry-preset-semantics.test.js` покрывает позитив и негатив по
всем шести presets и `unknown` для `prompt-not-sent`/`late-end`. Отсутствуют:
`unknown`-сценарии для `cutted`, `false-success`, `empty`, `old-answer`;
изоляция incident'ов (A1); взаимоисключение presets (D1); проверка
embedded-контейнера (applicability + sufficiency, E1); негативная применимость в
standalone-отчёте; проверка синхронности `REPORT_INFO` и слотов (E2).

---

## 3. План исправлений

Приоритет: сначала ложные подтверждения (A, C3), затем ложные опровержения (B1),
затем контракт доказательств (E), затем минимальность (F).

**Задача 1. Scope derived views по incident.**
Считать `deriveModelView` для группы `(modelId, dispatchId, generationEpoch)`;
в контейнере хранить per-incident views, applicability вычислять по incident'у,
агрегировать до модели явным правилом (`confirmed`, если подтверждён хотя бы
один incident, со ссылкой на его id).
*Приёмка:* набор «terminal d1 (100) + текст d2 (900)» даёт
`postTerminalGrowthChars = 0` для d1 и `false-success = unknown`; standalone и
embedded пути дают одинаковый статус на одних данных; добавлен тест изоляции.

**Задача 2. Scope post-terminal audit.**
`sameScope` в `shared/proof-telemetry-audit.js` расширить до
`dispatchId` + `generationEpoch`; при отсутствии длины у terminal или наблюдения
не считать рост, а писать `auditPossible:false` + `MISSING_EVIDENCE_RECORDED`.
*Приёмка:* наблюдение следующего dispatch не порождает `contradicted`; terminal
без `answerLen` даёт `conclusion=unknown`/`auditPossible=false`, а не
`growthPct=100`.

**Задача 3. Identity-контракт `old-answer`.**
Ввести нормализацию dispatch-идентификаторов (единый формат на стороне
`job-orchestrator`), требовать известности обоих идентификаторов, при
отсутствии любого — `unknown`; при `answerIdentity=current_dispatch` считать
диагноз опровергнутым независимо от сравнения строк.
*Приёмка:* terminal без `dispatchId` → `unknown`; `GPT:d1` vs `d1` → `not_confirmed`;
`previous_dispatch` → `confirmed`; тесты на все три случая.

**Задача 4. `unknown` для `false-success` при невозможном аудите.**
Разделить `postTerminalAuditStatus` на `completed | pending | impossible | null`
(отсутствие аудита без явной причины = `null`), applicability строить так, чтобы
отсутствие аудита давало `unknown`, а `conclusion=confirmed` — `not_confirmed`.
Одновременно: `postTerminalGrowthProven = false` при измеренном нулевом росте (B2).
*Приёмка:* пустой набор событий → `unknown`; SUCCESS + рост без аудита →
`unknown`; SUCCESS + audit `confirmed` → `not_confirmed`; SUCCESS + audit
`contradicted, growthChars>0` → `confirmed`.

**Задача 5. Выравнивание доказательного барьера `cutted`.**
Убрать пост-terminal рост из `incompleteCaptureEvidence`; оставить coverage (по
границе terminal и внутри incident) и явную truncation-оценку. Считать
`extractedTextLength` только из полей самого extraction-события; при их
отсутствии — `null` и `unknown` (B4).
*Приёмка:* SUCCESS + рост без аудита → `cutted=unknown`; extraction без длины →
`extractionCoveragePct=null`, `cutted=unknown`; extraction 60 при наблюдавшихся
120 → `confirmed`.

**Задача 6. Policy-граница и причинность `late-end`.**
Вычислять момент, когда evidence впервые удовлетворил действовавшей policy
финализации, требовать отсутствия последующей релевантной мутации/активной
генерации и сравнивать terminal именно с этой границей. Числовое окно берётся
из зафиксированного effective policy конкретного run, а не из произвольного
глобального порога.
*Приёмка:* terminal до или на policy-границе → `not_confirmed`; рост текста после
кандидатной границы инвалидирует её; доказанная тишина после policy-границы до
terminal → `confirmed` с фактическим `lateByMs`; разные clock epochs или
неизвестная policy-граница → `unknown`.

**Задача 7. Опровергающие предикаты `prompt-not-sent`.**
Добавить в applicability отрицательные условия: `generationTextObserved != true`,
`terminalOutcome != SUCCESS`, отсутствие непустого extraction; вместо «последнего
submission-факта» использовать правило «есть failed и нет более позднего
confirmed».
*Приёмка:* failed → генерация → SUCCESS даёт `not_confirmed`;
confirmed → failed даёт `not_confirmed`; одиночный failed без генерации —
`confirmed`; отсутствие submission-фактов — `unknown`.

**Задача 8. Вторая ветка `empty` и «принятое» extraction.**
Ввести производное `acceptedExtraction` (extraction, на который ссылается
terminal/`DECISION_RECORDED`, иначе последнее до terminal) и предикат
wrong-node: непустой extraction при `verification=rejected` либо
`answerIdentity ∈ {ambiguous, rejected, stale}`.
*Приёмка:* успешное extraction + поздняя неудачная попытка → `not_confirmed`;
непустое extraction с rejected verification → `confirmed` по ветке wrong-node с
указанием ветки в отчёте; отсутствие extraction → `unknown`.

**Задача 9. Правила связанных диагнозов.**
Задать в registry причинные роли и приоритет объяснения: доказанный
post-terminal рост делает `false-success` первичной причиной, а доказанную
неполноту сохранённого текста — последствием `cutted`. Не изменять истинную
applicability ради арбитража; добавить `primaryDiagnosis`, `causedBy`,
`explanationRole` и перенести `antiLoop` в embedded siblings.
*Приёмка:* набор из D1 сохраняет оба фактически истинных статуса, но имеет один
`primaryDiagnosis=false-success`; `cutted` помечен как consequence со ссылкой
на причинное правило; у embedded siblings присутствует `antiLoop`.

**Задача 10. Единый контракт доказательств для embedded-отчётов.**
Удалить `REPORT_INFO`-списки как второй источник истины: строить состав отчёта из
`REPORT_CONTRACTS.slots`; в embedded-отчётах вычислять
`resolveEvidenceSlots` и заполнять `completeness.level` (`complete|bounded|insufficient`),
`missingItems`, `safeConclusions`, `blockedConclusions`, `canDiagnose`,
`cannotDiagnoseAlone`; `evidenceCoveragePct` считать как долю удовлетворённых
слотов.
*Приёмка:* для любого preset множество релевантных типов равно объединению
типов его слотов (тест на отсутствие drift); отчёт с отсутствующим critical-слотом
даёт `insufficient` и непустой `missingItems`; sufficiency и applicability
меняются независимо (тест: слоты заполнены, applicability `not_confirmed`).

**Задача 11. Реализовать «условно обязательные» слоты.**
Расширить формат слота до `[slotId, criticality, eventTypes, requiredIf?]`, где
`requiredIf` — предикат того же языка; в `resolveEvidenceSlots` при истинном
`requiredIf` считать слот обязательным (`unavailable` вместо `not_observed`).
*Приёмка:* `cutted.finalization_policy` при `terminalMode=forced` без
`FINALIZATION_POLICY_EVALUATED` → `sufficiency=bounded`, слот в `missingItems`;
при `terminalMode=automatic` тот же слот остаётся `not_observed` и не влияет на
sufficiency.

**Задача 12. Proof-preserving минимизация выборки событий.**
Для высокочастотных типов сохранять семантически необходимые границы, экстремумы,
смены состояния и события из `evidenceRefs`; SYSTEM/DECISION/AUDIT включать
только при связи со слотом, причинностью или provenance. Фиксированный лимит
событий не вводить.
*Приёмка:* поток повторов сокращается до набора уникальных доказательных ролей;
applicability, sufficiency, временные границы, экстремумы и replay-инварианты до
и после минимизации совпадают.

**Задача 13. Учёт деградации наблюдения.**
Реализовать значения `observationReliability ∈ {reliable, degraded, stale, unavailable}`
и добавить в applicability presets, опирающихся на отсутствие сигнала
(`empty`, `prompt-not-sent`, `late-end`), условие «при `unavailable` — `unknown`».
*Приёмка:* набор с `SCRIPT_HEALTH_FAIL`/`TAB_CLOSED` и отсутствующим extraction
даёт `empty=unknown`, а не `confirmed`.

**Задача 14. Явная фиксация ограничений legacy-пути.**
При `sourceCompatibility.mode='legacy-runtime-adapter'` добавлять в отчёты
`MISSING_EVIDENCE_RECORDED`-эквивалент (`limitations[]`) с причиной
`clock_unavailable` и запретом на временны́е выводы; убрать вывод
`answerIdentity='current_dispatch'` из одного лишь наличия `dispatchId`.
*Приёмка:* legacy-экспорт содержит `late-end.applicability=unknown` с явной
причиной; `answerIdentity` без identity-события = `candidate`.

**Задача 15. Тестовая матрица.**
Для каждого preset — три сценария (positive / negative / unknown) плюс:
изоляция incident'ов, взаимоисключение `cutted`/`false-success`, embedded
applicability+sufficiency, отсутствие drift между слотами и составом отчёта,
негативная применимость в standalone.
*Приёмка:* 6 × 3 + 5 сценариев в `tests/proof-telemetry-preset-semantics.test.js`
и `tests/proof-oriented-telemetry.test.js`; все проходят; `scripts/validate-proof-telemetry.js`
валидирует обновлённые примеры в `docs/proof_oriented_telemetry_spec_v1/presets/`.

**Задача 16. Синхронизация спецификации и registry.**
Обновить §29-35 `SPECIFICATION.md`, `registry/report-dependency-registry.json`
(порог `late-end`, `requiredIf`, приоритеты диагнозов), поднять
`REGISTRY_VERSION`, перегенерировать примеры.
*Приёмка:* `registry.applicability`/`rules` в файле совпадают с кодом (тест
сравнения уже возможен и сейчас проходит — сохранить его зелёным), версии
`REGISTRY_VERSION`/`REPORT_VERSION`/`package.json`/`manifest.json` подняты,
`docs/CHANGELOG.md` дополнён.

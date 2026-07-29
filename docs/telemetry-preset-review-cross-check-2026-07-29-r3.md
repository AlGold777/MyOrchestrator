# Проверка внешних review итерации 3 (файл `LLMs answers jul26 21-01.txt`)

Пять ответов (GPT, Claude, Z.ai, Qwen, DeepSeek) по снимку `presets-analyze r3`.
Проверка исполнением кода на `main` `85315d6` (registry 5.5.0, report 2.7.0,
generator 1.8.0), то есть на той же ревизии, которую разбирали модели. Тесты
(`tests/proof-telemetry-*`, `tests/proof-oriented-*`, 130 шт.) проходят; ни одна
подтверждённая находка ими не ловится.

## 1. Оценка ответов

| Модель | Оценка |
|---|---|
| GPT | Лучший ответ раунда. Восемь дефектов, все проверяемые воспроизвелись; счётчики кода (52 слота, 12 `matchRule`) точны. |
| Claude | Одна глубокая архитектурная находка (избыточность `refutation`) плюс четыре точных структурных замечания; всё подтвердилось. |
| Qwen | Два адресных дефекта допуска (`confirmationAllowedWhenBounded`), оба воспроизвелись. |
| DeepSeek | Корректный, но описательный: план из общих задач, воспроизводимых контрпримеров нет. |
| Z.ai | Снова не по этой кодовой базе: разбирает выдуманный `P-MEM-LEAK` / OOM, прямо оговаривая отсутствие файла. |

Gemini и Grok в этом раунде отсутствуют.

## 2. Подтверждённые находки

| # | Находка | Автор | Воспроизведение |
|---|---|---|---|
| W1 | **Окно наблюдения отсутствия не является временным окном.** Достаточно baseline + любого observation-события; момент наблюдения относительно неудачного действия не проверяется, `generationStartTimeoutMs` не используется нигде, кроме объявления | GPT (P0-2) | baseline → `PAGE_HEALTH_OBSERVED{reliable}` → `SUBMIT_ACTION_OBSERVED` → `SUBMISSION_INFERRED{failed}`: `prompt-not-sent=confirmed`, при этом `absenceObservationWindow = {coverage: complete, reliability: unknown}`, хотя единственный сигнал предшествует неудаче |
| W2 | **`late-end` не привязан к принятому кандидату** | GPT (P0-3) | стабильность кандидата A (mono 1000) + decision и terminal кандидата B (mono 9000) при надёжном наблюдении → `lateEndEvidence=true`, `sufficiency=complete`, `verdict=confirmed` |
| W3 | **Deadline подменяет момент возникновения eligibility** | GPT (P0-4) | accepted decision на 3000, `TERMINAL_DEADLINE_REACHED` на 9000, terminal на 9500: выбран последний eligibility-кандидат (deadline), задержка посчитана как 500 мс → `not_confirmed`; фактическая просрочка 6500 мс скрыта |
| W4 | **`typed.state='unknown'` блокирует canonical fallback** | GPT (P1) | `MODEL_TERMINAL_RECORDED{typed:{terminal_action, unknown}, metadata.terminalStatus:SUCCESS}`: `terminalOutcome=SUCCESS`, applicability `confirmed`, но слот `success_terminal` — `unavailable`, вердикт `unknown` |
| W5 | **Посторонний `unknown`-инцидент портит полноту подтверждённого** | GPT (P1) | только инцидент A: `completeness=complete`, coverage 100 %; после добавления инцидента B из одного `PAGE_CONTEXT_OBSERVED`: `insufficient`, coverage 60 %, при этом по инцидентам `d1:confirmed`, `d2:unknown` |
| W6 | **Embedded `eventSeqs` не минимальны** | GPT (P1) | в отчёте `prompt-not-sent` присутствует seq 6 — событие чужого инцидента; отбор идёт по списку типов, без учёта слотов, применимости и scope |
| W7 | **`prompt-not-inserted` требует submit-контрдоказательство даже при провале до отправки** | GPT | baseline + reliable observation + `PROMPT_INSERTION_EVALUATED{failed}` → applicability `confirmed`, но `missing submit_counterevidence(required)` → `supported_but_incomplete` |
| W8 | **`cutted` считает от максимума, а не от финальной валидной границы** | GPT | легитимный откат 1000 → 500, extraction 500, SUCCESS: coverage 50 %, `verdict=confirmed` — откат неотличим от обрезки |
| W9 | **`refutation` избыточна относительно applicability** | Claude | для `cutted`, `false-success`, `empty`, `late-end`, `old-answer` предикат опровержения — прямое дополнение того же поля: на синтетическом контексте статус без refutation тот же `not_confirmed`. Для `prompt-not-*` независимость формально есть, но контекст, где `promptReceivedCounterEvidence=true` и `promptNotSentEvidence=true` одновременно, `deriveModelView` построить не может |
| W10 | **Temporal-инварианты покрывают не все presets** | Claude | в `proof-telemetry-incidents.js` три вида нарушений (`TEMPORAL_AUDIT_ORDER`, `CAUSAL_AUDIT_LINEAGE`, `TEMPORAL_EXTRACTION_AFTER_TERMINAL`) с `affectedReportTypes` = `false-success`, `empty`, `old-answer`, `cutted`; для `prompt-not-inserted`, `prompt-not-sent`, `late-end` инвариантов нет |
| W11 | **`single_candidate` допускает подтверждение по предположению** | Qwen (G2) | поток без `candidateId`: `measurementComparability=single_candidate`, `sufficiency=bounded`, `confirmationAllowedWhenBounded=true` → `cutted=confirmed` при coverage 60 % |
| W12 | **`old-answer` подтверждается при prior-инциденте вне экспорта** | Qwen (G1) | terminal с `priorIncidentRef` на отсутствующий в ledger инцидент: `missing prior_incident_evidence:prior_incident_outside_export`, `confirmationAllowedWhenBounded=true` → `confirmed` на одной самодекларации metadata. Без `priorIncidentRef` поведение корректное — `supported_but_incomplete` |

Дополнительно подтверждается чтением кода: счётчики GPT точны (52 слота, 12
`matchRule`); отсутствует декларативный список исключённых типов событий
(Claude); ветки `empty_result` и `wrong_node` используют одни и те же слоты
(Claude); report-level `applicability.status` вычисляется из `diagnosticVerdict`,
из-за чего на верхнем уровне снова смешиваются применимость и полнота (Claude);
порядок `DIAGNOSIS_PRIORITY` нигде не обоснован (Claude).

## 3. Уточнения к формулировкам моделей

* Qwen (G1) описывает механизм верно, но общий вывод «`old-answer` может быть
  confirmed без prior-инцидента» справедлив только когда `priorIncidentRef`
  заявлен и не разрешается. Когда ссылки нет вовсе, слот считается обычным
  required-missing и вердикт корректно понижается.
* GPT (P0-3) пишет, что `late-end` «подтверждается»; на неполных слотах вердикт
  всё же удерживается на `supported_but_incomplete`. При надёжном observer и
  полном наборе слотов вердикт становится `confirmed` — то есть защита носит
  случайный характер и на полном наборе доказательств не срабатывает.
* Claude формулирует избыточность `refutation` как безусловную; фактически для
  двух absence-presets предикаты формально независимы, но недостижимы из
  реального derived view — практический вывод тот же.

## 4. Дополнение к плану

Нумерация продолжает
[telemetry-preset-review-cross-check-2026-07-29-r2.md](telemetry-preset-review-cross-check-2026-07-29-r2.md)
(задачи 11-18).

**Задача 19. Реальное окно наблюдения отсутствия (W1).**
Считать окно от неудачного действия (submit/insertion) до конца наблюдения;
требовать закрытого интервала либо непрерывного покрытия длительностью не менее
`generationStartTimeoutMs`, учитывать разрывы; наблюдения до неудачного действия
в покрытие не засчитывать.
*Приёмка:* сценарий W1 даёт `unknown`; окно короче порога — `unknown`; окно с
разрывом — `unknown`; полное окно после неудачи — `confirmed`;
`generationStartTimeoutMs` фигурирует в вычислении.

**Задача 20. Candidate binding для `late-end` (W2).**
Все границы (`STABILITY_INTERVAL_CLOSED`, пост-стабильные наблюдения, terminal)
брать по принятому кандидату; при несовпадении — `unknown`; добавить в контракт
critical-слот идентичности.
*Приёмка:* сценарий W2 даёт `unknown`; те же события с общим кандидатом —
`confirmed`.

**Задача 21. Eligibility вместо deadline (W3).**
Брать первую eligibility-границу после финальной стабильности, действующую до
terminal; `TERMINAL_DEADLINE_REACHED` использовать только как объяснение
terminal mode, а не как точку отсчёта.
*Приёмка:* сценарий W3 даёт задержку 6500 мс и `confirmed`; повторная accepted
decision не сдвигает начало отсчёта; отмена eligibility через явную supersession
учитывается.

**Задача 22. Canonical fallback для typed-фактов (W4).**
`factOf` должен использовать typed только при известных `kind`/`state`, иначе
переходить к canonical mapping; противоречие typed и canonical payload
фиксировать как нарушение инварианта.
*Приёмка:* terminal с `typed.state='unknown'` и `terminalStatus=SUCCESS`
удовлетворяет `success_terminal`; противоречивая пара даёт violation.

**Задача 23. Полнота по инцидентам (W5, W6).**
Хранить `completeness.byIncident` и отдельную сводку по отчёту; для embedded
отбирать события по слотам, контрдоказательствам и scope инцидента, а не по
списку типов.
*Приёмка:* добавление постороннего инцидента не меняет ни полноту, ни `eventSeqs`
подтверждённого; каждый `eventSeq` имеет обоснование включения.

**Задача 24. Условная обязательность контрдоказательств отправки (W7).**
`submit_counterevidence` делать обязательным только когда submit-действие
наблюдалось; при провале вставки до отправки — вспомогательный.
*Приёмка:* сценарий W7 даёт `confirmed`; при наблюдавшемся submit-действии
отсутствие контрдоказательства по-прежнему понижает вердикт.

**Задача 25. Граница сравнения для `cutted` (W8).**
Сравнивать extraction с финальной валидной границей принятого кандидата
(последняя стабильная длина/хеш), а не с историческим максимумом; откат с
доказанной стабилизацией не считать обрезкой.
*Приёмка:* сценарий W8 даёт `not_confirmed`; обрезка без отката (1000 → extraction
600 при стабильной границе 1000) остаётся `confirmed`.

**Задача 26. Независимая семантика `refutation` (W9).**
Либо строить refutation на независимых фактах (отдельные события/аудиты, а не
дополнение того же поля), либо явно пометить контракт
`refutationModel: 'complement'` и убрать претензию на независимую проверку.
*Приёмка:* для каждого preset тест показывает либо срабатывание refutation при
неопровергнутой applicability, либо явную декларацию модели дополнения.

**Задача 27. Temporal-инварианты для оставшихся presets (W10).**
Добавить инварианты для `prompt-not-inserted`, `prompt-not-sent` (порядок
baseline → insertion → submit → acceptance) и `late-end` (стабильность после
старта генерации, eligibility после стабильности) с `affectedReportTypes`.
*Приёмка:* у каждого из семи presets минимум один инвариант и тест на его
нарушение.

**Задача 28. Ограничить допуск подтверждения при слабой сопоставимости (W11, W12).**
`single_candidate` и `prior_incident_outside_export` не должны сохранять
`confirmationAllowedWhenBounded`: для измерительных диагнозов и для `old-answer`
такой набор доказательств даёт `supported_but_incomplete`.
*Приёмка:* сценарии W11 и W12 дают `supported_but_incomplete`; при
`candidate_proven` и материализованном prior-инциденте — `confirmed`.

# ТЗ Phase 5–6 — Контракт проекции и интеграция Planner

**Версия:** 1.1
**Приоритет:** P0 (S-03, S-06, S-07)
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573`
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md) D4, D5 · **План:** [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md)
**Prerequisite:** [Phase 3–4](TZ-semantic-phase3-4-registry-durability-v1.0.md) завершены

---

# Phase 5 — Контракт проекции

## Цель

`projectStateMap` — единственный контур проекции, производящий полный набор
полей, которые читают потребители. Проекция вычисляется на чтении из
канонического case.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `disput/debate-state-map.js` | `project` | Новые поля; переименование `openQuestions` → `questions`; поля идентичности |
| `disput/debate-artifact-pipeline.js` | `projectStateMap` | Единственный публичный контур; проброс новых полей |
| `disput/debate-orchestrator.js` | — | Удаление независимого `stateMapVersion` |

## Обязательные поля вывода

**Идентичность** (заменяет независимый счётчик):
```
sourceCaseId
sourceCaseVersion
projectorVersion       // = DebateStateMap.VERSION
```

Идентичность карты — пара `{ sourceCaseVersion, projectorVersion }`.
`stateMapVersion` как независимо инкрементируемое значение удаляется:
именно его расхождение с `caseVersion` даёт S-09.

**Коллекции** (существующие сохраняются) плюс:

| Поле | Определение | Основание |
|---|---|---|
| `questions` | Переименование `openQuestions`. `openQuestions` остаётся deprecated-алиасом на одну версию | `debate-planner.js:77` читает `map.questions` |
| `actionableObjections` `actionableContradictions` `actionableDissent` | Артефакты, для которых `CaseSchema.isActionable(type, status)` истинно (D5). Raw `status` **не мутируется** | Planner читает actionable-коллекции вместо литеральной сверки статусов |
| `artifactAuthors` | **`{ [artifactId]: participantId }`** (D6.5, S-21) — автор по id артефакта, из `artifact.owner`. Planner индексирует `authorship[id]` (`debate-planner.js:121`); существующие planner-тесты подтверждают эту форму | Независимость подбора участников |
| `contextPressure` | `totalChars / effectivePromptLimit`, клампится в `[0, 1]`. Источник — `DebateContextBudget.check({ parts })` над текстами активных артефактов; лимит — `promptChars − reservedOutputChars` (по умолчанию 60000 − 8000) | `debate-planner.js:84,283` — порог `compaction.contextPressureThreshold ?? 0.8` |
| `finalArtifactIds` | **Правило принято (D6.10):** `[synthesisArtifactId]`, если активный `synthesis_conclusion` существует (инвариант единственного активного финала, S-16); иначе принятые не-superseded артефакты заключительных типов в порядке `changes`. Не «решается в ходе реализации» | `debate-planner.js:378,437,513` — `selectedFinalArtifactIds` |

**Правило `finalArtifactIds` фиксируется тестом.** Если предложенное выше
определение не соответствует продуктовому ожиданию — решение принимается в этой
фазе и записывается в отчёт; молчаливая интерпретация недопустима.

## Наблюдаемость отброшенного — в trace, не в карте (D6.6)

Из сверки валидации Phase 1 следует: часть элементов не доходит до карты. Но
проекция чистого canonical case **не располагает** отброшенными до delta
элементами — считать их в карте невозможно и противоречит D4.

Решение: наблюдаемость переносится в **TraceStore**. Каждый отказ extractor'а
(`return null` по правилу target / whitelist) порождает trace-событие с типом,
причиной и stage. `rejectedCounts` из StateMap **удаляется**. Молчаливый
`return null` без trace-события запрещён.

## Идентичность карты и Orchestrator Contract (D6.8, S-09)

Независимый `stateMapVersion` удаляется; идентичность — `{ sourceCaseVersion,
projectorVersion }`. Orchestrator Contract v1.0 включает `stateMapVersion` в
Planner input (`:308`) и snapshot (`:496`) — эти разделы **superseded** ADR-002
(D6.8). Правка `orchestrator-contract-v1.0.md` выполняется в этой фазе: поле
заменяется парой идентичности; bump версии контракта.

## Единственность контура

`DebateStateMap.project` остаётся низкоуровневым builder'ом;
`projectStateMap` — единственный публичный контур. Planner и UI вызывают его
над одним committed snapshot.

## Версия

`DebateStateMap.VERSION`: 3 → 4. Карта не персистится — миграции данных нет,
требуется пересборка на чтении.

## Тесты

| Тип | Проверка |
|---|---|
| unit | Проекция производит все поля, читаемые Planner |
| contract | `PlannerInput.stateMap ⊆ projectStateMap output` — падает со списком недостающих ключей |
| unit | `questions` присутствует; `openQuestions` — алиас с тем же содержимым |
| unit | `artifactAuthors` группирует по `owner`; артефакт без owner не ломает группировку |
| unit | `contextPressure` в `[0,1]`; при превышении лимита равен 1; пустой case → 0 |
| unit | `finalArtifactIds` соответствует зафиксированному правилу |
| unit | Идентичность: одинаковый case и projectorVersion → идентичная карта |
| unit | `artifactAuthors` имеет форму `{ artifactId: participantId }` |
| trace | Отказ extractor'а порождает trace-событие с типом/причиной/stage; `rejectedCounts` в карте отсутствует |
| E-04, E-05 | Становятся зелёными |

## Acceptance criteria

1. `PlannerInput.stateMap` полностью покрыт выводом проекции; `artifactAuthors`
   имеет форму `{ artifactId: participantId }`.
2. Независимый `stateMapVersion` отсутствует в коде; `orchestrator-contract-v1.0.md`
   разделы `:308`/`:496` обновлены на пару идентичности (D6.8).
3. Один публичный контур проекции; второго вызова `DebateStateMap.project` из UI нет.
4. Отброшенные при извлечении элементы наблюдаемы в trace; `rejectedCounts` в карте нет.
5. Правило `finalArtifactIds` (D6.10) зафиксировано тестом.
6. E-04, E-05 зелёные (ожидания перевёрнуты из baseline).

## Rollback boundary

Карта не персистится; откат — возврат предыдущего пакета. Deprecated-алиас
`openQuestions` защищает внешних потребителей на одну версию.

## Запрет следующей фазы

Phase 6 запрещена до фиксации контракта проекции: иначе предикаты Planner будут
переписаны под изменяющийся набор полей.

---

# Phase 6 — Интеграция Planner

## Цель

Предикаты `deriveGoals` определяются поверх контракта `ARTIFACT_STATUS`
(введён в Phase 2), а не поверх литералов. Резолюционные goals начинают
выводиться.

## Prerequisite

Phase 5, AC 1–6.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `disput/debate-planner.js` | `deriveGoals` | Литеральная сверка статусов заменяется чтением actionable-коллекций из проекции |
| `disput/debate-planner.js` | `deriveGoals` | Чтение `map.questions` — поле существует (Phase 5) |
| `disput/debate-case-schema.js` | `isActionable` | Владелец предиката actionable (D5); проекция вызывает его |

## Контракт

**Текущий** — нулевое пересечение словарей:

| Тип | Ставит extractor | Ждёт `deriveGoals` | Результат |
|---|---|---|---|
| `objection` | `raised` (`:40`) | `'unresolved'` (`:72`) | goal не выводится |
| `contradiction` | `recorded` (fallback) | `'open'` (`:75`) | goal не выводится |
| `dissent` | `recorded` (`:40`) | `'unexamined'` (`:81`) | goal не выводится |
| `open_question` | — | `'open'` по `map.questions` (`:78`) | двойной промах |

**Новый:** creation-состояния признаются actionable; resolution-состояния
(введённые в Phase 2) снимают actionable. Extractor свой словарь **не меняет**
(D5: адаптируется Planner).

## Границы

- Ranking, utility-формула, tie-break, finalization policy и алгоритм подбора
  участников **не меняются** — только предикаты actionable и имя поля вопросов.
- Новые типы goals не вводятся.
- `artifactAuthors` начинает влиять на независимость подбора участников — это
  включение существующей логики, а не новая логика.

## Тесты

| Тип | Проверка |
|---|---|
| unit | `objection` со статусом от `statusFor` → `resolve_objection` выводится |
| unit | `contradiction` со статусом от `statusFor` → `resolve_contradiction` |
| unit | `dissent` со статусом от `statusFor` → `examine_dissent` |
| unit | `open_question` → `answer_open_question` |
| unit | После резолюции goal не выводится повторно |
| unit | Детерминизм сохранён: одинаковый вход — одинаковое решение |
| integration | Полный цикл: ответ → артефакт → карта → goal → следующая стадия |
| regression | Существующие planner-тесты зелёные; tie-break не изменился |
| E-03a/b/c, E-04 | Становятся зелёными |

## Acceptance criteria

1. Все четыре типа порождают резолюционные goals при статусах от `statusFor`.
2. Ни один предикат не сверяет литерал статуса — только контракт.
3. Резолюция снимает actionable; повторный вывод goal невозможен.
4. Детерминизм и tie-break не изменились (существующие тесты зелёные).
5. E-03a, E-03b, E-03c, E-04 зелёные.

## Rollback boundary

Изменения только в предикатах; persisted-форма не затронута. Откат —
возврат пакета.

## Отчёт (обе фазы)

Baseline commit · изменённые файлы и функции · зафиксированное правило
`finalArtifactIds` · определение `contextPressure` с формулой и источником ·
таблица «статус extractor → actionable» · тесты и результаты прогона ·
статус E-тестов · подтверждение неизменности ranking/tie-break ·
статус: DONE / PARTIAL / BLOCKED.

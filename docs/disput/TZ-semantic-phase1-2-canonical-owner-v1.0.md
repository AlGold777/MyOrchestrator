# ТЗ Phase 1–2 — Канонический владелец и lifecycle артефакта

**Версия:** 1.1
**Приоритет:** P0
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573` (2.81.41)
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md) D1, D2, D5, **D6** · **План:** [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md)
**Prerequisite:** [Phase 0](TZ-semantic-phase0-evidence-v1.0.md) завершена (characterization-тесты зелёные на baseline)

Две фазы в одном документе: они связаны одним инвариантом — fencing по revision
бессмысленен, пока writer'ов больше одного. Коммиты раздельные.

**Изменения ревизии 1.1** (переносы из поздних фаз для устранения промежуточной
поломки — D6):
- адаптер проектора map←→array включён в Phase 1 (D6.3, S-20);
- все competing writers (`onHumanAction`, `onLinkRemove`,
  `syncAggregateArtifactsToCase`) маршрутизируются в Phase 1 (D6.4, S-13/S-17);
- `caseVersion` определён (D6.1); lease-fencing commit (D6.2, S-18);
- failure code и `revision: 0` согласованы (D6.9).

---

# Phase 1 — Единый semantic writer

## Цель

`DebateCaseStore` становится единственным владельцем артефактов; единственная
точка мутации — `DebateCaseSchema.applyChange`, вызываемая из
`Orchestrator.commitStageResult`.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `disput/debate-artifact-pipeline.js` | `commitStateDelta` | Перестаёт мутировать. Возвращает подготовленные мутации `{ additions, updates, supersedes }` |
| `disput/debate-artifact-pipeline.js` | `projectStateMap` | **D6.3/S-20:** принимает canonical case, где `artifacts` — map: `list(...)` → `values(...)`. Legacy-массив продолжает поддерживаться. Без этого после Phase 1 карта пуста |
| `disput/debate-orchestrator.js` | `commitStageResult` | Применяет мутации через semantic port под lease (D6.2) |
| `disput/debate-orchestrator.js` | `commitStageResult`, `activatePlanRevision` | **D6.1:** `caseVersion === changes.length`; активация ревизии **не** инкрементирует `caseVersion` |
| `disput/debate-orchestrator.js` | `startRun`, `recoverRun` | Гидратируют working copy из canonical case; начальный `caseVersion = 0` |
| `disput/debate-case-store.js` | `apply` → `commit` | **D6.2/S-18:** commit принимает `expectedCaseVersion` + fencing-токен `leaseRevision`; сверяет с персистированным `changes.length`; без lease/при устаревшем токене — отклонение |
| `disput/debate-application.js` | `createApplication`, `createUniversalRun` | Инжектирует `semanticStore` port; `assertProductionWiringComplete` расширяется обязательным портом |
| `results.js` | `createApplication` call site | Передаёт реальный `DebateCaseStore` |
| `results.js` | `onHumanAction` (`:2545`), `onLinkRemove` (`:2591`) | **D6.4/S-13/S-17:** маршрутизация через `Orchestrator.submitIntervention`; действие человека — один атомарный batch commit, не серия `apply` |
| `results.js` | `syncAggregateArtifactsToCase` (`:2618`) | **D6.4:** прекращает создавать/менять canonical case; помечается к удалению |

## Контракт

**Текущий:**
```
commitStateDelta({state, stage, delta})
  → мутирует state.debateCase.artifacts (memory)
  → возвращает { applied, stateMap }
```

**Новый:**
```
prepareMutations({case, stage, delta})        // чистая функция, artifact-pipeline
  → { additions[], updates[], supersedes[] }
semanticStore.commit({ caseId, expectedCaseVersion, mutations, deltaId })
  → { ok, case, caseVersion } | { ok: false, code, reasonCode }
```

`Orchestrator.state.debateCase` — hydrated working copy на время planner tick,
не независимый источник. Прямое присваивание `state.debateCase.artifacts`
запрещено.

## Обязательная сверка валидации (блокирует переключение writer'а)

Правила target расходятся между слоями и при переносе владения изменят поведение:

| Тип | `TARGET_REQUIRED` (pipeline `:14`) | `validateArtifact` (case-schema `:79`) | Риск |
|---|---|---|---|
| `objection` | требуется | требуется | совпадает |
| `revision` | требуется | требуется | совпадает |
| `evidence` | **не требуется** | **требуется** | evidence без target начнёт отклоняться — регрессия |
| `dissent` | требуется | не требуется | сейчас теряется на извлечении, до case не доходит |
| `contradiction` | требуется | не требуется | то же |
| `evidence_gap` | требуется | не требуется | то же |

Дополнительно расходятся списки типов: `STRUCTURED_TYPES` (pipeline `:10`) — 12
типов; `ARTIFACT_TYPES` (case-schema `:6`) — 18. Отсутствуют в whitelist:
`human_decision`, `synthesis_working`, `synthesis_conclusion`, `audit`, `source`,
`finding` — такие элементы внутри смешанного structured payload молча
отбрасываются (`:62`).

**Требование:** до переключения writer'а привести оба контракта к единому
источнику. Решение по каждой строке фиксируется в отчёте:
принять правило pipeline, принять правило case-schema или ослабить оба.
Молчаливое расхождение недопустимо — каждый отказ порождает событие
(см. Phase 5 по наблюдаемости).

**Запрещено** переключать writer'а до закрытия этой таблицы: иначе
переключение само станет источником потери данных.

## Concurrency и single-owner (D6.2, S-18)

`chrome.storage` не даёт CAS. Семантический commit проходит **только от владельца
Orchestrator lease** (`assertLease`/`compareAndSetLease`/`leaseRevision` уже
существуют, `debate-orchestrator.js:120-159`):

1. `assertLease()` перед записью; потеря → `LEASE_LOST`, commit отклонён.
2. `expectedCaseVersion` сверяется с **персистированным** `changes.length`,
   не только с локальным `active`.
3. Запись несёт `leaseRevision`; устаревший токен → отклонение.

Тест «ровно один concurrent commit успешен» реализуется через два экземпляра:
второй не имеет lease. Новый service-worker coordinator не вводится.

## Persistence

Production-композиция обязана передавать durable semantic store.
`createMemoryPersistence` для семантического case остаётся только явной
тестовой зависимостью. `assertProductionWiringComplete` расширяется:
отсутствие semantic port даёт `UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE`
с указанием порта.

Durable persistence самого Orchestrator (snapshot/event-log) — **отдельный
adapter** (D6.7), вводится в Phase 4. Здесь достаточно durable semantic case.

## Миграция

Runtime-массив артефактов преобразуется в `artifacts` map при первом открытии
run. Схема остаётся v2 — эта фаза не меняет persisted-форму.

## Удаляемые competing paths

- самостоятельная запись в `state.debateCase.artifacts` вне `applyChange`;
- `commitStateDelta` как writer (остаётся как подготовка мутаций).

## Тесты

| Тип | Проверка |
|---|---|
| unit | `prepareMutations` — чистая: не меняет входной case |
| unit | Прямая мутация `state.debateCase` не отражается в stored case |
| integration | StageExecutor → Orchestrator → CaseStore: артефакт в store **до** вызова Planner |
| integration | Сверка валидации: каждая строка таблицы выше имеет тест на принятое решение |
| concurrency | Два Orchestrator-инстанса на один case: один commit проходит, второй получает `stale` |
| recovery | Перезапуск после commit — артефакты на месте |
| E-08 | Становится зелёным: production-композиция не использует memory persistence |

## Acceptance criteria

1. Поиск по production-коду не находит записи в `state.debateCase.artifacts`
   вне `applyChange`.
2. После завершения стадии артефакт присутствует в `CaseStore` до вызова Planner.
3. Reload восстанавливает тот же `caseVersion` и набор артефактов.
4. Два writer'а не могут успешно применить одну базовую версию.
5. Mutable semantic holders = 1.
6. Таблица сверки валидации закрыта; ни одно правило не изменено молча.
7. E-08 остаётся characterization baseline до Phase 4; E-01…E-07 остаются
   зелёными characterization-тестами и меняют ожидание в назначенной фазе.

## Rollback boundary

До первой production-записи в новом каноническом пути — внутренний рефакторинг,
откат безопасен. После переключения writer'а откат требует восстановления
pre-migration снимка.

## Запрет следующей фазы

Phase 2 запрещена до доказанного единственного writer'а (AC 1, 4, 5): fencing по
revision применился бы только к одному из конкурирующих владельцев.

---

# Phase 2 — Lifecycle артефакта

## Цель

Артефакт получает эволюцию: update, supersede, merge, с per-artifact fencing и
идемпотентностью, не считающейся стагнацией.

## Prerequisite

Phase 1, AC 1–7.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `disput/debate-case-schema.js` | `applyChange` | Новые kinds: `SUPERSEDE_ARTIFACT`, `MERGE_ARTIFACT` |
| `disput/debate-case-schema.js` | `applyChange` | Per-artifact `expectedRevision` в дополнение к `expectedSequence` |
| `disput/debate-case-schema.js` | новый `applyBatch` | validate всех → reduce всех → один persist |
| `disput/debate-artifact-pipeline.js` | `prepareMutations` | Формирует `updates` для известных id вместо отбрасывания |
| `disput/debate-case-schema.js` | `initialStatusFor`, `validateStatusTransition`, `isActionable` | Владелец словаря статусов (D5) — вводится здесь, потребляется в Phase 5–6 |
| `disput/debate-orchestrator.js` | `commitStageResult` | Идемпотентный повтор не инкрементирует сигнал стагнации |

## Контракт

**Текущий:** delta добавляет только неизвестные id; известный id →
`no_state_change`.

**Новый:**
```
create           — id отсутствует
update           — id известен, требует expectedRevision
supersede        — помечает supersededBy, требует expectedRevision
merge            — помечает mergedInto, требует expectedRevision
```

`UPSERT_ARTIFACT` уже реализует create+update с инкрементом `revision` (`:61`)
и записью прежнего состояния в `history` (`:124`) — переиспользуется, не
переписывается. Достраиваются `supersede` и `merge` (поля `supersededBy`,
`mergedInto` уже существуют, `:62-63`).

## Инвариант единственного активного финала (S-16)

`projectStateMap` при нескольких `synthesis_conclusion` выбирает последний через
`findLast` (`:131`), не помечая предыдущий superseded. Lifecycle обязан
поддерживать инвариант: **в одном synthesis scope не более одного активного
`synthesis_conclusion`**.

Новый финал:
- либо обновляет существующий финал с revision fencing;
- либо создаётся как новый артефакт с явным `supersede` предыдущего;
- **не** становится просто последним элементом.

Два `synthesis_conclusion` без lifecycle-операции между ними → `SEMANTIC_INVALID`.
Миграция нескольких legacy-финалов, где активный не определить → пометка
`NEEDS_USER_REVIEW`, не автоматический выбор.

## Словарь статусов (D5, подготовка к Phase 6)

Словарь переносится в `DebateCaseSchema` (D5) — владельца артефактов:

- `initialStatusFor(type)` — creation-состояния, значения совпадают с текущим
  `statusFor` (extractor свои состояния не меняет);
- resolution-состояния, вводимые lifecycle (`resolved`, `superseded`,
  `merged`, `examined`);
- `validateStatusTransition(type, from, to)`;
- `isActionable(type, status)`.

`statusFor` в pipeline становится тонкой ссылкой на `initialStatusFor` (или
удаляется, если нет внешних потребителей). Потребление контракта проекцией и
Planner'ом — Phase 5–6.

## Идемпотентность

1. `deltaId`/`correlationId` проверяется до применения мутаций.
2. Повтор применённой delta возвращает сохранённый результат
   (`duplicate: true` уже реализован, `:106`).
3. Повтор **не** увеличивает `consecutiveNoStateDelta`.
4. Тот же id с иным семантическим содержанием — не replay, а конфликт (D6.9).

## Failure codes (D6.9)

- Case-level fencing — существующий `case_sequence_stale` (`debate-case-schema.js:102`).
- Per-artifact fencing — **новый** код `artifact_revision_stale` при несовпадении
  `expectedRevision`. Формулировка v1.0 «новых кодов не вводить» была ошибочна:
  per-artifact revision в схеме отсутствовал. Не переиспользовать `REVISION_STALE`
  из plan-revision — другой bounded context.

## Атомарность батча

Запрещено вызывать `applyChange` последовательно с persistence между
изменениями: одна невалидная операция оставит частично применённый батч.
Обязательно `validate all → reduce all → persist once`.

## Миграция

- Артефактам без `revision` присваивается `revision: 0` — согласовано с правилом
  создания новых (`debate-case-schema.js:61` даёт 0 при отсутствии previous).
  Исправляет несоответствие v1.0 (там было `1`).
- Существующий `history` сохраняется; отсутствующий — пустой массив.
- Валидные `supersededBy`/`mergedInto` сохраняются.
- Висящие ссылки помечаются для review, **не удаляются**.
- `DebateCaseSchema.VERSION`: 2 → 3.
- **Forward-version guard (D6.9/S-22):** `load` при `stored.schemaVersion >
  Schema.VERSION` **не** мигрирует назад, а отказывает (read-only + сигнал
  «данные новее кода»). Текущий `load` (`debate-case-store.js:48`) мигрирует любую
  несовпадающую версию — это разрушало бы rollback. Guard добавляется здесь,
  чтобы rollback на предыдущий пакет не переписал v3-данные под v2.

**Storage-версия vs schema-версия (S-15).** `keyFor(caseId)` содержит
`disputDebateCaseV1` — версия зашита в ключ. Бамп schema-версии не меняет ключ,
поэтому v2 и v3 попадут под один ключ. Требование: миграция читает schema-версию
из **value** (`state.schemaVersion`), а не из ключа, и применяет преобразование
на чтении. Смена storage-ключа (`disputDebateCaseV2`) — альтернатива; выбор
фиксируется в отчёте. Это отдельная от schema-версии concern и не решается самим
бампом.

## Тесты

| Тип | Проверка |
|---|---|
| unit | update содержимого и статуса — `revision` инкрементируется, прежнее значение в `history` |
| unit | Устаревший `expectedRevision` → `artifact_revision_stale` (D6.9) |
| unit | `supersede` помечает исходный артефакт, не удаляет |
| unit | `merge` помечает `mergedInto` |
| unit | Одна невалидная операция откатывает **весь** батч |
| unit | Replay возвращает первоначальный результат |
| unit | Тот же id с другим содержанием — конфликт, не replay |
| integration | Уточнение ответа обновляет артефакт, не порождает дубль |
| integration | Идемпотентный повтор не увеличивает сигнал стагнации |
| migration | Старый case без `revision` открывается; артефакты получают `revision: 0` |
| E-01, E-02 | Становятся зелёными |

## Acceptance criteria

1. Update существующего id инкрементирует `revision`; прежнее значение в `history`.
2. Устаревший `expectedRevision` → `artifact_revision_stale` (новый код per D6.9).
   Case-level fencing использует существующий `case_sequence_stale`.
3. Частично применённый батч невозможен.
4. Replay возвращает исходный результат и не порождает событие изменения.
5. `no_state_change` используется только для действительно пустой семантической
   мутации, не для повтора.
6. Идемпотентный повтор не засчитывается как стагнация.
7. Миграция идемпотентна: повторный запуск на мигрированном case ничего не меняет.
8. E-01, E-02 зелёные.

## Rollback boundary

После записи `CaseSchema` v3 старая версия расширения не должна открывать case
на запись. Откат — read-only режим либо восстановление v2-снимка.

### Follow-up schema v4 (2.81.51)

Стабилизация добавила canonical `ADD_CONSTRAINT`, prospective batch invariants,
единственный активный `synthesis_conclusion` и исправленную array→map migration.
Фактическая production-версия схемы повышена с 3 до 4; forward-version guard и
запрет downgrade сохраняются.

## Запрет следующей фазы

Phase 3 запрещена до фиксации identity и lifecycle-ссылок: миграция реестра не
сможет корректно разрешить дубликаты и superseded-артефакты.

## Отчёт (обе фазы)

Baseline commit · изменённые файлы и функции · закрытая таблица сверки
валидации с решением по каждой строке · контракт before/after · миграция ·
добавленные тесты с результатами прогона · статус E-тестов · остаточные риски ·
статус: DONE / PARTIAL / BLOCKED.

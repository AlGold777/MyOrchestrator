# План модернизации семантического слоя Disput

**Версия:** 1.1
**Дата:** 2026-07-24
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573` (**2.81.41**)
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md), включая D6 (ревизия 1.1) — нормативны, здесь не пересматриваются.
**Статус:** Phase 0–6 реализованы частично; `REQUIRES_BROWSER_DURABILITY_PROOF`.

> Реализованный change set закрывает schema/store/pipeline/projection contracts и
> добавляет characterization tests. Полная готовность блокируется доказательством
> cross-context lease fencing поверх `chrome.storage` (текущий adapter синхронный
> и предназначен для deterministic/unit wiring), а также browser recovery E2E.

> **Состояние рабочего дерева.** На момент выпуска 1.1 дерево содержит
> незакоммиченные изменения `results.js`, `pipeline_panel.html`, `result_new.html`,
> `styles.css` от предыдущих задач сессии (round-stepper, удаление selector A,
> очистка scheme). Документационный change set семантического слоя **физически не
> изолирован** от них. Перед началом Phase 0 накопленные кодовые изменения должны
> быть закоммичены или отложены отдельно.

Цепочка: **артефакты → реестр → карта состояния → Planner → UI/persistence**.
Карта — производная; работа ведётся снизу вверх.

## 1. Статус верификации

Проверено на baseline построчно; ссылки в findings ведут на фактические строки.

Подтверждено и **не** является дефектом (в scope не входит):

- Разделение working/final synthesis: `synthesisArtifactId` только из
  `synthesis_conclusion`, `workingSynthesisArtifactIds` — отдельное поле.
- `JSON.parse(JSON.stringify)` clone: проекция возвращает только plain
  objects/arrays/примитивы. Латентный риск, активного дефекта нет.

Опровергнутые в ходе разбора утверждения (зафиксированы, чтобы не всплыли снова):

- «Objection резолвится, т.к. `'raised'` входит в `isOpen`» — неверно.
  `isOpen` управляет коллекцией `blockers`; `deriveGoals` (`debate-planner.js:72`)
  сверяет литерал `'unresolved'`. Не срабатывает.
- «Planner не читает `questions`» — неверно. `debate-planner.js:77`
  `for (const question of arr(map.questions))`.

## 2. Держатели состояния (current state)

| Holder | Данные | Роль | Writer | Readers | Persistence | Version |
|---|---|---|---|---|---|---|
| `Orchestrator.state.debateCase.artifacts` | append-only артефакты | de-facto canonical в runtime | `commitStateDelta` через `commitStageResult` | `projectStateMap`, Planner | нет — `createMemoryPersistence` по умолчанию | `state.caseVersion` |
| `protocolState.registry.artifacts` | артефакты для UI | stale projection, **пуст в universal run** | должен `syncAggregateProtocolState` — 0 call sites | `disput-state-map-view`, `syncAggregateArtifactsToCase` | `chrome.storage` `llmCodexDebateRun.v1` | aggregate caseVersion |
| `DebateCaseStore` case | artifacts map, changes, snapshots | persisted canonical **по схеме**, заполняется из пустого реестра | `apply`/`applyChange` (human-решения), `syncAggregateArtifactsToCase` | UI, export | `chrome.storage` `disputDebateCaseV1:<id>` | `CaseSchema.VERSION = 2` |
| `Orchestrator.state.stateMap` | проекция + synthesis-поля | runtime projection | `projectStateMap` при start/recovery/commit/reconcile | Planner | snapshot как кэш | `{sourceCaseVersion, projectorVersion}` |
| `DebateStateMap.project(aggregate)` (UI) | проекция для рендера | **второй независимый контур** | `disput-state-map-view.render` | UI | нет | `DebateStateMap.VERSION = 3` |
| PlanRevision store | активная ревизия, cancelledGoalIds | canonical (plan) | `activatePlanRevision` | Planner, Orchestrator | memory | `revisionId` |
| `DebateTraceStore` | event log | diagnostic append-only | `recordUniversalEvent` → timeline | export, telemetry | `chrome.storage` `llmCodexDebateTrace.v1` | `TraceSchema.VERSION = 5` |

Три конкурирующих семантических держателя (строки 1–3). Два независимых контура
проекции (строки 4–5).

**Внутреннее операционное состояние Orchestrator** (не семантические держатели,
но участвуют в границе транзакции — важны для §3):

| Поле | Роль | Меняется |
|---|---|---|
| `state.openGoals` | Planner-owned derived operational state | после semantic commit и по решению Planner |
| `state.stages` | execution state | из PlanningDecision |
| `state.events`, `state.eventSequence` | operational event stream, **не** semantic source | публикуется отдельно от semantic commit |
| `state.persistence` | recovery backend | по умолчанию `createMemoryPersistence` |
| snapshot | recovery checkpoint, **не** canonical DebateCase | при pause/complete/cancel |

Целевые роли: `DebateCaseStore` — canonical semantic facts; `openGoals` —
derived operational; `stages` — execution; `events`/snapshot — operational
recovery, не источник семантики.

**Целевое состояние:** 1 mutable semantic holder (`DebateCaseStore`);
реестр — производный индекс без writer'а; карта — вычисляемая проекция;
RunStore и TraceStore теряют право на семантику, сохраняя lifecycle и диагностику.

## 3. Граница транзакции и failure windows

Целевой атомарный semantic commit:

```
expectedCaseVersion + expectedRevision
→ validate всех мутаций батча
→ применить к изолированной копии case
→ инкремент revision артефактов и caseVersion
→ перестроить registry index в той же копии
→ persist один раз
→ синхронно опубликовать событие
→ пересобрать проекцию
→ вызвать Planner только при совпадении версий
```

Semantic commit считается завершённым на шаге `persist`. Публикация и проекция —
recoverable post-commit обработка; их повтор не должен повторно применять мутации.

| Failure window | Текущее поведение | Целевое |
|---|---|---|
| Артефакты применены, реестр не обновлён | Разрыв: runtime artifacts и `protocolState.registry` живут раздельно | Невозможно: индекс строится в той же копии до единственного persist |
| Реестр обновлён, карта не построена | UI/Planner получают разные или пустые проекции | Canonical уже сохранён; проекция детерминированно пересобирается по `{caseVersion, projectorVersion}` |
| Карта построена, persistence не завершена | Публикуется transient runtime state | Неперсистированная карта не публикуется и не передаётся Planner |
| Persistence завершена, событие не опубликовано | RunStore/UI могут не узнать о commit | Recovery пересобирает проекции из `case.changes[]` |
| Retry повторяет применённую delta | Duplicate id → `no_state_change` → засчитывается как стагнация | `deltaId`/`correlationId` возвращает прежний результат; сигнал стагнации не растёт |
| Два writer'а применяют delta одновременно | Возможны независимые изменения Orchestrator case и CaseStore | Единственный writer; fencing по `expectedSequence`; проигравший получает `stale` |
| Crash между мутациями батча | Возможен partial batch при последовательном `applyChange` | validate всего батча → один reduce → один persist |
| `STATE_DELTA_STALE` после ответа модели | Delta пропускается, rebase/retry отсутствует, событие не содержит delta | Один детерминированный rebase; при конфликте delta сохраняется в событии с полным payload |

## 4. Findings

Классы: **A** WIRING_BREAK · **B** SEMANTIC_DRIFT · **C** DURABILITY_GAP · **D** DATA_LOSS

| ID | Класс | Sev | Файл / функция | Producer → consumer | Последствие |
|---|---|---|---|---|---|
| S-01 | D | P0 | `debate-artifact-pipeline.js` `commitStateDelta` | delta → canonical case | Существующий id молча отбрасывается: новое содержание и статус теряются; артефакты не эволюционируют |
| S-02 | A | P0 | `debate-application.js:174-182` `recordUniversalEvent`; `results.js` `syncAggregateArtifactsToCase` | Orchestrator → RunStore → UI | `protocolState` не заполняется; вся семантика невидима в UI и не персистится до terminal output |
| S-03 | B | P0 | `debate-artifact-pipeline.js:39-42` `statusFor` ↔ `debate-planner.js:72,75,78,81` `deriveGoals` | extractor → Planner | Нулевое пересечение словарей: `resolve_objection`, `resolve_contradiction`, `examine_dissent` не выводятся никогда |
| S-04 | C | P0 | `debate-orchestrator.js` `createMemoryPersistence`; `results.js` `createApplication` без `persistence` | semantic commit → recovery | Канонический runtime-state существует только в памяти; reload уничтожает его |
| S-05 | D | P0 | `debate-orchestrator.js:359-363` | stale delta → recovery | Delta отбрасывается без rebase/retry; событие не содержит payload — содержимое невосстановимо |
| S-06 | A | P1 | `debate-state-map.js:81,123` ↔ `debate-planner.js:77` | projection → Planner | Проекция даёт `openQuestions`, Planner читает `map.questions` — open questions не порождают goals |
| S-07 | A | P1 | `debate-state-map.js`, `debate-artifact-pipeline.js` ↔ `debate-planner.js:84,121,283,378,437,513` | projection → Planner | `artifactAuthors`, `contextPressure`, `finalArtifactIds` читаются, но не производятся: подбор участников игнорирует авторство, `compact_context` не приоритизируется, `finalArtifactIds` всегда пуст |
| S-08 | A | P1 | `debate-state-map.js:73` | три формы входа | `input.registry \|\| protocol.registry \|\| aggregate.registry`; в run-store поля `registry` нет — третий fallback всегда undefined |
| S-09 | C | P1 | `caseVersion` ↔ `stateMapVersion` | mutation → projection → Planner | Счётчики меняются независимо: `activatePlanRevision` инкрементирует только `caseVersion`, `reconcile` перепроецирует без инкремента |
| S-10 | D | P1 | `debate-artifact-pipeline.js:14,62,66` | extraction → delta | Два механизма молчаливого отбрасывания: `TARGET_REQUIRED` (`objection`/`revision`/`dissent`/`contradiction`/`evidence_gap` без `targetId`) и `STRUCTURED_TYPES` whitelist (12 типов против 18 в `ARTIFACT_TYPES`: отсутствуют `human_decision`, `synthesis_working`, `synthesis_conclusion`, `audit`, `source`, `finding`). Отказ не порождает события |
| S-11 | B | P2 | `debate-state-map.js:18`; `debate-case-schema.js:45` | artifact links → projection | `supersededBy`/`mergedInto` читаются, `relations[]` объявлен — ничем не заполняются |
| S-12 | C | P2 | `docs/disput/EVIDENCE-MATRIX-v3.0.md` | документация → release gate | Матрица заявляет «Atomic same-version parallel delta commit \| implemented \| `debate-case.js`»; файла не существует |
| S-13 | A | P0 | `results.js:2545-2596` `onHumanAction` | UI → CaseStore | Прямой `debateCaseStore.apply` в обход Orchestrator. **Становится дефектом после D1**: когда CaseStore — канонический владелец, UI превращается во второго semantic writer'а без fencing по версии; решения человека не видимы Planner |
| S-14 | D | P1 | `debate-orchestrator.js:528-536` `reconcile` | late response → canonical | При `finish_received_only` late response с superseded revision даёт `LATE_RESPONSE_DISCARDED` с одним `reason`; delta не сохраняется. Отдельный от S-05 путь: потеря происходит в reconcile, не в commit |
| S-15 | C | P1 | `debate-case-store.js:5` `keyFor`; `debate-run-store.js:6` `STORAGE_KEY` | schema bump → storage | Версия зашита в ключ (`disputDebateCaseV1`, `llmCodexDebateRun.v1`). Бамп `CaseSchema.VERSION 2→3` не меняет ключ — v2 и v3 пишутся под один ключ без version-marker внутри value. Storage-версия — отдельная от schema-версии concern |
| S-16 | B | P2 | `debate-artifact-pipeline.js:131-132` `projectStateMap` | несколько final → проекция | `findLast(synthesis_conclusion)` при нескольких финалах молча выбирает последний; предыдущий остаётся без `supersededBy`. Эволюция финала неявна; в `finalArtifactIds` может попасть неактуальный |
| S-17 | A | P0 | `results.js:2591` `onLinkRemove` | UI → CaseStore | Второй прямой writer помимо S-13: `DELETE_ARTIFACT` в обход Orchestrator. Тот же класс, что S-13 — после D1 обходит fencing |
| S-18 | C | P0 | `debate-case-store.js:21` `apply`/`save` | concurrent commit | Безусловный `storage.set` после локальной `expectedSequence`; CAS/сериализации нет. Два экземпляра перезаписывают друг друга. Решение — D6.2 (lease-fencing) |
| S-19 | C | P0 | `debate-case-schema.js` | контракты версий | В схеме нет `caseVersion`; fencing на `changes.length`. Контракты `expectedCaseVersion`/`sourceCaseVersion`/`{caseId, caseVersion}` не имели определения до D6.1 |
| S-20 | A | P0 | `debate-artifact-pipeline.js:123` `projectStateMap` | canonical map → проекция | Проектор принимает только массив (`list`); canonical `artifacts` — map. После Phase 1 карта была бы пустой. Адаптер переносится в Phase 1 (D6.3) |

## Статус реализации 2.81.51

Стабилизационный комплекс выполнен: S-09 закрыт идентичностью проекции
`{sourceCaseVersion, projectorVersion}`; start/recovery проецируют canonical case
до Planner; constraint получил canonical change kind; lifecycle использует
prospective batch validation, единственный активный `synthesis_conclusion` и
явные supersede/merge transitions; legacy artifact array мигрирует в map.
Durable OrchestratorPersistence v2 использует localStorage-журнал, fencing
revision и Web Locks для взаимного исключения page contexts. Полная матрица
E-01…E-09 и browser fixture `pause → reload → continue` являются release
evidence этого статуса.
| S-21 | B | P1 | `docs/disput/TZ-*` ↔ `debate-planner.js:121` | ТЗ → Planner | `artifactAuthors` в ТЗ v1.0 задан обратной формой; Planner ждёт `{artifactId: participantId}` (D6.5) |
| S-22 | C | P1 | `debate-case-store.js:48` `load` | forward-version | `load` мигрирует любую несовпадающую версию, включая **более новую** (rollback пишет старой версией, читает новую → миграция назад). Нужен forward-version guard |

## 5. Что уже работает и не подлежит переделке

| Компонент | Файл / функция | Доказательство | Почему сохранить |
|---|---|---|---|
| Семантический агрегат | `debate-case-schema.js`: `applyChange`, `normalizeArtifact`, `validateArtifact` | `:61` инкремент revision, `:124` history, `:106` идемпотентность, `:101` fencing | Основа D1/D2 — достраивается, не переписывается |
| Персистентность case | `debate-case-store.js`: `apply`/`save`/`load`/`subscribe` | `:5` `keyFor`, `:30` `storage.set` | Готовый persisted canonical |
| Разделение синтезов | `debate-artifact-pipeline.js` `projectStateMap` | `tests/debate-artifact-pipeline.test.js` | Working не перезаписывает final — контракт сохраняется |
| PlanRevision | `debate-plan-revision.js` | immutable lineage, `REVISION_STALE`, `SEMANTIC_INVALID` + reasonCode | Отдельный bounded context; не объединять с DebateCase |
| RunStore как operational aggregate | `debate-run-store.js`: `serialize`/`hydrate`, Set-aware encode | версия 5, guard | Снимается только претензия `protocolState` на семантику |
| TraceStore | `debate-trace-store.js`, `debate-trace-schema.js` | append-only, semanticHash, redaction | Диагностика; не превращать в canonical |
| Wiring gate | `debate-application.js` `assertProductionWiringComplete` | `tests/debate-universal-production-wiring.test.js` | Гейт обязательных портов — основа Phase 1/4 |

## 6. Карта фаз и зависимости

| Phase | Содержание | Документ | Prerequisite |
|---|---|---|---|
| 0 | Failing-evidence тесты | [TZ Phase 0](TZ-semantic-phase0-evidence-v1.0.md) | — |
| 1–2 | Единый writer; lifecycle артефакта | [TZ Phase 1–2](TZ-semantic-phase1-2-canonical-owner-v1.0.md) | Phase 0 |
| 3–4 | Реестр как индекс; атомарный durable commit | [TZ Phase 3–4](TZ-semantic-phase3-4-registry-durability-v1.0.md) | Phase 1–2 |
| 5–6 | Контракт проекции; интеграция Planner | [TZ Phase 5–6](TZ-semantic-phase5-6-projection-planner-v1.0.md) | Phase 3–4 |
| 7–8 | UI и persistence; удаление мёртвых путей | [TZ Phase 7–8](TZ-semantic-phase7-8-ui-cleanup-v1.0.md) | Phase 5–6 |

**Запрещено:**

- начинать Phase 2 до доказанного единственного writer'а — иначе fencing
  применится только к одному из конкурирующих владельцев;
- начинать миграцию реестра до фиксации identity и revision артефактов —
  иначе не разрешить дубликаты и superseded;
- строить новую проекцию до durable commit — иначе проекция зафиксирует
  недолговечное состояние;
- менять Planner до фиксации контракта проекции;
- переподключать UI до совпадения контуров CaseStore → проекция → Planner;
- удалять compatibility-пути до миграции старых persisted runs.

## 7. Матрица версий

Бамп только там, где меняется persisted-форма или публичный контракт.

| Компонент | Текущая | Целевая | Основание |
|---|---|---|---|
| `DebateCaseSchema.VERSION` | 2 | 4 | v3: lifecycle kinds/revision; v4: canonical `ADD_CONSTRAINT`, prospective invariants и array→map migration |
| `DebateStateMap.VERSION` | 3 | 4 | Phase 5: новые обязательные поля проекции, переименование `openQuestions` → `questions`. Карта не персистится — миграции данных нет |
| `DebateRunStore.VERSION` | 5 | **без изменения** | Operational aggregate. Семантическая durability обеспечивается **отдельным** `OrchestratorPersistence` adapter (D6.7) со своим storage key и версией — не бампом RunStore |
| `OrchestratorPersistence` (новый) | — | 2 | v1 port; v2 durable localStorage journal + Web Locks/lease fencing |
| `DebateStateDelta.VERSION` | 1 | без изменения | Модуль не подключается в production; судьба решается в Phase 8 |
| `DebateTraceSchema.VERSION` | 4 | без изменения | Диагностика не меняет форму |
| `PlanRevision.SCHEMA_VERSION` | 1 | без изменения | Не затрагивается |
| `manifest.json` / `package.json` | — | +1 patch за change set | Дисциплина изменений |

Всего два бампа схем. Реестр **не персистится** (уточнение D3 в Phase 3:
вычисляется на чтении, допустима мемоизация по `{caseId, caseVersion}`) — это
снимает третий бамп и устраняет класс расхождений «индекс разошёлся с
артефактами».

Storage keys не меняются; меняется внутренняя версия схемы, чтобы существующие
данные прошли явную миграцию.

## 8. Политика миграции

Приоритет источников при миграции persisted run:

1. Валидный `DebateCaseStore` case — baseline.
2. Артефакт из `protocolState.registry` добавляется, только если id отсутствует.
3. Артефакт из `aggregate.registry` — только если id отсутствует.
4. Legacy artifact array — последним.
5. Ни один источник не перезаписывает автоматически конфликтующий артефакт;
   конфликт помечается для review.

Артефакты без `revision` получают `revision: 0`, существующий `history`
сохраняется, отсутствующий инициализируется пустым. Валидные
`supersededBy`/`mergedInto` сохраняются; висящие ссылки помечаются, но не удаляются.

**Миграция не считается завершённой, если новый код работает только для новых
runs.** Каждая миграция версионирована, идемпотентна, сохраняет неизвестные
данные и имеет путь экспорта (политика [ADR-001](ADR-001-universal-only-cutover.md)).

## 9. Связь с release-регистром

- Закрывает часть **P0-R7** (Semantic commit / no-op / version integrity) —
  S-01, S-05, S-09.
- Закрывает часть **P0-R6** (Event-log integrity and replay) — S-04, S-05.
- Влияет на **P0-R1** (Browser recovery equivalence) — S-02, S-04.
- Влияет на **P0-R3** (Human-decision surface) — S-13: маршрутизация решений
  человека через единственную точку мутации.
- Требует исправления записи evidence matrix по S-12 до начала Phase 1.

## 10. Порядок работ и границы ответственности

Один change set = одна фаза (Phase 1–2 и далее — раздельные коммиты внутри
своего ТЗ). Каждый change set выполняет дисциплину из
[README-disput](README-disput.md): бамп версий, запись в CHANGELOG, обновление
каталога и evidence matrix, детерминированные тесты.

Ни одна фаза не считается выполненной, пока её target-ожидания не стали
зелёными, а characterization-тесты baseline не потеряли наблюдаемость дефекта.

Статус плана: **ADR-002 принято → schema/projection contracts реализованы
частично → требуется browser-level durability/recovery evidence.**

### Остаток работ (нормативный список)

1. Заменить deterministic in-memory lease adapter на действительно атомарный
   cross-context coordinator для `chrome.storage` либо документированный lock
   protocol с fencing token.
2. Реализовать и доказать recovery snapshot/event cursor вместе с canonical
   CaseStore после reload.
3. Зафиксировать `lastPublishedSequence`, порядок публикации и idempotent
   consumers; без этого post-commit delivery остаётся partial.
4. Провести browser E2E для UI human actions, pause/continue и поздних ответов.
5. Закрыть migration matrix для legacy cases и добавить rollback/export proof.

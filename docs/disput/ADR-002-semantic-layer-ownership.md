# ADR-002 — Semantic layer ownership

**Status:** Architecture decision accepted; implementation not started
**Revision:** 1.1 (D6 добавлен после код-ревью)
**Date:** 2026-07-24
**Decision owner:** Disput architecture
**Extends:** [ADR-001](ADR-001-universal-only-cutover.md).
**Supersedes:** разделы `stateMapVersion` в [Orchestrator Contract v1.0](orchestrator-contract-v1.0.md) (`:308`, `:496`) — см. D6.8.

## Context

Семантика Disput производится артефактами. Карта состояния (State Map) —
производная проекция над ними, а реестр — контейнер, через который артефакты
должны доходить до UI и persistence.

Проверка текущего HEAD показала, что первичный слой не выполняет своей роли:

1. **Артефакты не эволюционируют.** `debate-artifact-pipeline.js` `commitStateDelta`
   применяет `filter(a => a?.id && !known.has(a.id))` — существующий артефакт по id
   никогда не обновляется. Objection не может стать resolved, claim — пересмотренным,
   supersede невозможен. Повтор даёт `no_state_change`, который засчитывается как
   стагнация.
2. **Рядом лежит неиспользуемый более способный агрегат.** `debate-case-schema.js`
   уже содержит: artifacts map, инкремент `revision` при update (`:61`), `history`
   с записью прежнего состояния (`:124`), `supersededBy`/`mergedInto` (`:62-63`),
   идемпотентность по `correlationId` → `duplicate: true` (`:106`), optimistic
   fencing по `expectedSequence` → `stale: true` (`:101`), snapshots, валидацию
   target и dependents. `debate-case-store.js` персистит его в `chrome.storage`
   (`keyFor(caseId)`). Production-путь идёт мимо.
3. **Три конкурирующих держателя.** Orchestrator `state.debateCase.artifacts`
   (memory), `protocolState.registry` (пуст в universal path), `DebateCaseStore`
   (заполняется из пустого реестра).
4. **Словари не пересекаются.** Extractor ставит creation-статусы
   (`objection:'raised'`, `contradiction`→fallback `'recorded'`, `dissent:'recorded'`),
   `deriveGoals` сверяет resolution-статусы литерально
   (`'unresolved'`, `'open'`, `'unexamined'`). Пересечение — пустое, резолюционные
   goals не выводятся ни для одного из трёх типов.

Решения ниже приняты как композит из трёх независимых планов (GPT, Qwen, Z.ai);
для каждого указано, чей аргумент принят и почему.

## Decision

### D1. Канонический владелец артефактов

Канонический владелец — `DebateCase`, персистируемый через `DebateCaseStore`.
Единственная точка семантической мутации — `DebateCaseSchema.applyChange`,
вызываемая из `Orchestrator.commitStageResult`.

`DebateArtifactPipeline.commitStateDelta` перестаёт быть writer'ом и становится
чистой функцией подготовки мутаций (`{ additions, updates, supersedes }`).
`Orchestrator.state.debateCase` — hydrated working copy на время planner tick,
не независимый источник.

Mutable semantic holders после: **1**.

### D2. Модель изменения артефакта

**In-place update с per-artifact revision fencing.** Не immutable version chain,
не event-sourced replay.

Обоснование (принят аргумент GPT):

- `CaseSchema` — материализованный агрегат с `changes[]` как аудит-логом:
  `applyChange` пишет и в `state.artifacts`, и в `changes`. Это уже не
  event-sourcing и не требует им становиться.
- `normalizeArtifact` уже инкрементирует `revision` и переносит `history`.
- Идемпотентность обеспечена `acceptedCorrelations`, аудит — `changes[]` +
  `artifact.history`, recovery — чтением одного materialized case.
- Event-sourced replay сделал бы `state.artifacts` кэшем и добавил стоимость,
  растущую с длиной run. Альтернатива Qwen отклонена: его собственное описание
  фаз («проекция читает текущее состояние по id») описывает материализацию,
  а не replay — решение внутренне противоречиво.

Мутация существующего артефакта требует `artifactId` + `expectedRevision`.
Достраиваются операции `supersede` и `merge` (поля под них уже есть).

### D3. Судьба реестра

Реестр — **детерминированный materialized index**, производный от канонических
артефактов, перестраиваемый внутри той же транзакции commit'а. Не канонический
store и не удаляется.

Три формы входа проектора (`input.registry || protocol.registry ||
aggregate.registry`) сохраняются как read-only compatibility adapter для старых
persisted runs до Phase 8. Запись идёт только в canonical.

Независимых writer'ов реестра после: **0**.

### D4. Карта состояния

Карта **вычисляется на чтении** через единственный контур `projectStateMap`.
Planner и UI используют один контур и один committed snapshot.

Независимый mutable `stateMapVersion` устраняется. Идентичность карты —
пара `{ sourceCaseVersion, projectorVersion }`.

Персистится только canonical (`artifacts` + `changes`); карта не персистится.

### D5. Владелец словаря статусов

**Владелец — `DebateCaseSchema`** (пересмотрено после сведения ответов; принят
аргумент GPT/Qwen). Схема уже валидирует артефакты и применяет мутации; словарь
статусов и допустимых переходов должен жить там же, иначе словарь (в pipeline) и
мутации (в schema) разойдутся. Экспортирует `initialStatusFor(type)`,
`validateStatusTransition(type, from, to)`, `isActionable(type, status)`.

Потребители: extractor вызывает `initialStatusFor` вместо собственной таблицы;
`DebateStateMap.isOpen` и проекция — `isActionable`; `Planner.deriveGoals`
не сверяет литералы статусов.

**Адаптируется Planner, extractor свои creation-состояния не меняет.**

**Способ потребления — actionable-коллекции в проекции**, не предикаты в Planner
(пересмотрено; принят аргумент GPT/Z.ai/Qwen). Проекция даёт
`actionableObjections`/`actionableContradictions`/`actionableDissent`,
вычисленные через `isActionable`; raw `status` остаётся нетронутым для audit и
migration; Planner читает actionable-коллекции. Это держит actionable-логику в
едином контуре проекции (согласуется с D4), а не размазывает предикаты по
Planner, и не мутирует исходный статус.

Прежний вариант (`ARTIFACT_STATUS` в pipeline + предикаты в Planner) отклонён:
владелец-pipeline расходится с владельцем-мутаций, а предикаты в Planner дублируют
логику вне единого контура.

## D6. Определения, отсутствовавшие в v1.0 (принято после код-ревью GPT)

Ревизия v1.1. Восемь пунктов ниже — не правки текста, а решения по несоответствиям
между документами и фактическим кодом. Без них Phase 0 небезопасна.

### D6.1. `caseVersion`

`caseVersion === changes.length` канонического `DebateCase`. Отдельного поля не
вводится: fencing схемы уже опирается на `changes.length`
(`debate-case-schema.js:101`). Начальное значение — **0** (пустой `changes`).

Активация PlanRevision **не** инкрементирует `caseVersion`: это две независимые
версии (`activePlanRevisionId` передаётся отдельно). Текущее смешение в
Orchestrator (инкремент `caseVersion` при активации ревизии) устраняется в
Phase 1.

`sourceCaseVersion` карты и ключ мемоизации `{caseId, caseVersion}` ссылаются на
это же значение.

### D6.2. Concurrency: durable single-owner lease, не CAS в CaseStore

`chrome.storage.local` не даёт compare-and-swap, а `CaseStore.apply` делает
безусловный `storage.set` после локальной проверки `expectedSequence` — двух
экземпляров это не разводит.

Решение: **семантический commit проходит только от владельца существующего
Orchestrator lease** (`acquireLease`/`assertLease` уже реализованы с
`compareAndSetLease` и fencing-токеном `leaseRevision`,
`debate-orchestrator.js:120-159`). Новый service-worker coordinator не вводится.

Контракт commit:
1. `assertLease()` перед записью; при потере — `LEASE_LOST`, commit отклонён.
2. `expectedCaseVersion` сверяется с персистированным `changes.length` (не только
   с локальным `active`).
3. Запись несёт fencing-токен `leaseRevision`; запись с устаревшим токеном
   отклоняется.

Так «ровно один concurrent commit успешен» становится реализуемым: второй
владелец не имеет lease.

### D6.3. Проектор принимает canonical map — в Phase 1

`projectStateMap` сейчас принимает массив через `list(...)`
(`debate-artifact-pipeline.js:123`); canonical `DebateCase.artifacts` — map.
Адаптер map→values переносится в **Phase 1** (не Phase 3): иначе после смены
владельца Planner получит пустую карту.

### D6.4. Все competing writers — в Phase 1

Прямые семантические записи в CaseStore существуют помимо S-13:
- `onHumanAction` — серия `debateCaseStore.apply` (`results.js:2545`);
- `onLinkRemove` — `DELETE_ARTIFACT` (`results.js:2591`) — **не был в S-13**;
- `syncAggregateArtifactsToCase` — создаёт/меняет case (`results.js:2618`).

Все переводятся на маршрутизацию через Orchestrator **в Phase 1**, не Phase 7.
Действие человека становится **одним атомарным batch commit**, а не серией из
2–3 записей.

### D6.5. `artifactAuthors`: `{ artifactId: participantId }`

Planner индексирует `authorship[id]` по id артефакта
(`debate-planner.js:121`) — форма `{ artifactId: participantId }`. ТЗ v1.0
задавало обратную (`{ participantId: artifactId[] }`) — исправлено. Существующие
planner-тесты подтверждают форму `{ artifactId: participantId }`.

### D6.6. `rejectedCounts` — не в карте, а в trace

Проекция чистого canonical case не располагает элементами, отброшенными
extractor'ом **до** создания delta. Требование считать их в карте противоречит
D4. Наблюдаемость отброшенного переносится в **TraceStore**: каждый отказ
extractor'а — trace-событие с типом, причиной и stage. `rejectedCounts` из
StateMap удаляется.

### D6.7. Durable Orchestrator persistence — отдельный версионированный adapter

`DebateRunStore` не реализует `appendEvent`/`saveSnapshot`/`loadLatestSnapshot`/
lease; production передаёт только memory-backed aggregate, `options.persistence`
отсутствует (`results.js:5897`). Вводится **отдельный** `OrchestratorPersistence`
adapter со своим storage key, версией snapshot/event-log и атомарностью
последовательности. Утверждение «RunStore.VERSION остаётся 5» относится только к
operational aggregate и не покрывает семантическую durability.

### D6.8. `stateMapVersion` — ADR-002 supersede контракта

Orchestrator Contract v1.0 включает `stateMapVersion` в Planner input и snapshot
(`orchestrator-contract-v1.0.md:308,496`). D4 удаляет независимый счётчик,
заменяя идентичностью `{ sourceCaseVersion, projectorVersion }`. Настоящий ADR
**явно supersede** эти разделы; соответствующая правка контракта — часть Phase 5.

Исполнено в 2.81.51: контракт обновлён на эту составную идентичность; старое
поле удалено из runtime, snapshot и PlanningDecision.

### D6.9. Failure code и `revision`

- Case-level fencing использует существующий `case_sequence_stale`. Per-artifact
  fencing (`expectedRevision`) — **новый** механизм: формулировка v1.0 «новых
  кодов не вводить» была ошибочна. Вводится `artifact_revision_stale` рядом с
  существующим (не `REVISION_STALE` из plan-revision — это другой bounded context).
- Новые артефакты получают `revision: 0` (`debate-case-schema.js:61`). Миграция
  legacy-артефактов присваивает тот же `revision: 0` при отсутствии — не `1`
  (исправление несоответствия v1.0).

### D6.10. `finalArtifactIds` — правило принято сейчас

Не «в ходе реализации». Правило: `finalArtifactIds = [synthesisArtifactId]`, если
активный `synthesis_conclusion` существует (инвариант единственного активного
финала, D2/S-16); иначе — принятые не-superseded артефакты заключительных типов в
порядке `changes`. Фиксируется тестом в Phase 5.

## Explicitly out of scope

- **Граф `relations[]`.** Поле объявлено в `createCase` (`:45`) и никогда не
  заполняется. В scope остаются только прямые lifecycle-ссылки: `targetId`,
  `supersededBy`, `mergedInto`. Проектирование общего графа отношений — отдельное
  продуктовое решение.
- **Transactional outbox.** Отклонён (предлагался GPT). Для расширения с
  chrome.storage публикация выполняется синхронно после persist, а восстановление
  проекций при recovery — из `case.changes[]`, который уже персистируется.
  Outbox добавил бы вторую durable-очередь ради проблемы, решаемой существующим
  журналом.
- **Замена `JSON.parse(JSON.stringify)` clone.** Проверено: текущая проекция
  содержит только plain objects/arrays/примитивы; активного дефекта нет.
  Латентный риск фиксируется в OPEN-ITEMS, но в этот scope не входит.

## Consequences

- Один mutable semantic holder вместо трёх; реестр и карта становятся
  производными без права записи.
- Semantic commit получает границу транзакции и переживает reload —
  до сих пор канонический runtime-state существовал только в памяти.
- Требуется миграция persisted-данных: старые артефакты получают `revision: 0`,
  реестры старых форм читаются adapter'ом. Миграция не считается выполненной,
  если новый код работает только для новых runs.
- Evidence matrix содержит недостоверную запись: «Atomic same-version parallel
  delta commit | implemented | `debate-case.js`» — файла `debate-case.js`
  не существует. Запись исправляется на `planned` со ссылкой на этот ADR.

## Rejected alternatives

| Альтернатива | Источник | Причина отклонения |
|---|---|---|
| Event-sourced артефакты с replay | Qwen 3.2 | `CaseSchema` уже материализован; replay сделал бы `artifacts` кэшем и добавил стоимость по длине run; описание фаз у автора само описывает материализацию |
| Immutable version chain (новый артефакт на каждое изменение) | рассмотрено | Ломает стабильность `artifactId`, от которой зависят `targetId` и ссылки Planner'а |
| Transactional outbox | GPT Phase 4 | Вторая durable-очередь при наличии `changes[]`; несоразмерно масштабу расширения |
| `actionable*` коллекции в проекции | GPT 3.5 | Первоначально отклонены как дубли; после D5 приняты как единый контракт предикатов для Planner'а |
| Удалить реестр как сущность | рассмотрено | Нужен как индекс для чтения и как compatibility-вход для старых runs |

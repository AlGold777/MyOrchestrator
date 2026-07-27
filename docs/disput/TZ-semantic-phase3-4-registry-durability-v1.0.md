# ТЗ Phase 3–4 — Реестр и durable atomic commit

**Версия:** 1.1
**Приоритет:** P0
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573`
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md) D3, D4 · **План:** [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md)
**Prerequisite:** [Phase 1–2](TZ-semantic-phase1-2-canonical-owner-v1.0.md) завершены

---

# Phase 3 — Реестр как производный индекс

## Цель

Устранить реестр как конкурирующего владельца семантики, не удаляя его как
средство чтения.

## Уточнение решения D3

Реестр **вычисляется на чтении** той же чистой функцией, что используется в
commit'е, и **не персистится** отдельно.

Обоснование уточнения: персистирование индекса вводит схемное изменение и
целый класс расхождений «индекс разошёлся с артефактами». При объёмах
расширения пересборка индекса из `artifacts` дешева. Допустима мемоизация по
ключу `{ caseId, caseVersion }` без семантики записи.

Следствие: `DebateCaseSchema.VERSION` в этой фазе **не меняется**.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `disput/debate-artifact-pipeline.js` | новый `buildRegistry(artifacts)` | Чистая функция: `byId`, `byType`, `byStatus`, `byTargetId`, `activeIds`, `supersededIds` |
| `disput/debate-state-map.js` | `project` | Принимает канонический case; три legacy-формы входа остаются read-only adapter'ом |
| `results.js` | `syncAggregateProtocolState`, `replaceAggregateProtocolState` | Удаляются как semantic writer'ы (0 production call sites; второй — только test-gated) |
| `results.js` | `syncAggregateArtifactsToCase` | Помечается к удалению: канонический case больше не наполняется из aggregate. Физическое удаление — Phase 7 после переподключения UI |
| `disput/debate-run-store.js` | reducer `REGISTRY_UPDATED` | Решение фиксируется в отчёте: оставить как diagnostic или удалить в Phase 8 |

## Контракт

**Текущий:** `registry = input.registry || protocol.registry || aggregate.registry || {}`
(`debate-state-map.js:73`); писателя нет; в run-store поля `registry` не существует,
третий fallback всегда `undefined`.

**Новый:** канонический источник — `DebateCase.artifacts`; индекс строится
`buildRegistry`. Три legacy-формы принимаются только при чтении старых
persisted runs.

## Миграция

Старые runs с `protocolState.registry` читаются через adapter и переносятся в
канонический case по приоритету источников из
[плана §8](PLAN-semantic-layer-v1.0.md). Новые runs legacy-формы не создают.

## Тесты

| Тип | Проверка |
|---|---|
| unit | `buildRegistry` детерминирован: одинаковый вход — идентичный индекс |
| unit | Индекс полностью восстанавливается из `artifacts`; удаление индекса не теряет данных |
| integration | После commit индекс совпадает с каноническими артефактами |
| migration | Старый run с `protocolState.registry` гидратируется без потерь |
| migration | Смешанные формы реестра: приоритет источников соблюдён, конфликты помечены |
| gate | Отсутствие production-writer'ов реестра |

## Acceptance criteria

1. Ноль независимых writer'ов реестра.
2. Индекс всегда выводим из артефактов; его отсутствие не теряет семантику.
3. Проектор принимает канонический case; legacy-формы работают только на чтение.
4. Новые runs не создают legacy-реестр.
5. Старые persisted runs открываются и мигрируются до вызова Planner и UI.
6. Схема case не изменена этой фазой.

## Rollback boundary

Compatibility-reader сохраняется до Phase 8. Запись идёт только в канонический
store — откат не теряет данные.

## Запрет следующей фазы

Phase 4 запрещена до единственного контракта реестра: транзакция не должна
координировать несколько независимо изменяемых представлений.

---

# Phase 4 — Атомарный durable commit

## Цель

Semantic commit становится атомарным, идемпотентным и переживающим reload;
stale delta перестаёт быть безвозвратной потерей.

## Prerequisite

Phase 3, AC 1–6.

## Порядок транзакции

```
1  проверить expectedCaseVersion и per-artifact expectedRevision
2  validate весь батч мутаций
3  применить к изолированной копии case
4  инкремент revision артефактов и caseVersion
5  persist один раз                          ← commit завершён здесь
6  синхронно опубликовать событие
7  пересобрать проекцию
8  вызвать Planner только при совпадении версий
```

Шаги 6–8 — recoverable post-commit обработка; их повтор не применяет мутации
повторно.

## Отказ от outbox — что именно закрывает failure window W4

Transactional outbox **не вводится** (ADR-002, out of scope). Обоснование
предметно, а не по общему принципу:

Окно W4 («persist завершён, событие не опубликовано») закрывается тем, что
`RunStore` и `TraceStore` — **производные** от канонического case, а не
независимые получатели, которым нужна гарантированная доставка. `case.changes[]`
персистируется в той же операции, что и `artifacts` (шаг 5). При сбое между 5 и 6
recovery пересобирает операционные проекции из `changes[]` — потерянное событие
восстанавливается из журнала, а не из очереди доставки.

Outbox был бы нужен, только если бы существовал внешний получатель, который
нельзя пересобрать из canonical. Такого нет: и `RunStore`, и `TraceStore`
выводимы. Введение outbox добавило бы вторую durable-структуру с собственным
consistency-инвариантом ради проблемы, которой при производных проекциях не
существует.

**Требование к реализации:** `changes[]` и `artifacts` персистируются одной
операцией (шаг 5). Если хранилище не даёт атомарности между ними — это меняет
решение и требует правки плана, не молчаливого обхода.

**Publication cursor (уточнение после код-ревью).** Отказ от outbox корректен
только при наличии идентичности «что уже опубликовано». `changes[]` восстанавливает
case и проекцию, но сам не доказывает, какое операционное событие доставлено.
`OrchestratorPersistence` хранит `lastPublishedSequence`. Recovery публикует
события с `eventSequence > lastPublishedSequence` и продвигает курсор в той же
durable операции. Это даёт идемпотентную доставку без второй durable-очереди:
курсор — одно поле, не outbox-таблица.

## Политика stale delta и late-response discard

При несовпадении `expectedCaseVersion` (**S-05**):

1. Загрузить актуальный case.
2. Выполнить **один** детерминированный rebase.
3. `create`-операции без конфликта применяются.
4. `update` применяется только при совпадении `expectedRevision`.
5. Тот же id с тем же семантическим хэшем — replay, не конфликт.
6. Конфликт отклоняется с `REVISION_STALE`.
7. **Событие `STATE_DELTA_STALE` содержит полную delta** — содержимое остаётся
   восстановимым.

Тот же принцип распространяется на late-response discard (**S-14**,
`reconcile:528-536`): при `finish_received_only` и superseded revision событие
`LATE_RESPONSE_DISCARDED` обязано нести полную delta, а не только `reason`.
Discard проходит через ту же rebase-политику: содержимое сохраняется, не
отбрасывается молча. Одна причина потери на двух путях (commit и reconcile) —
одно решение.

## Durable Orchestrator persistence — отдельный adapter (D6.7, S-04)

`DebateRunStore` не реализует `appendEvent`/`saveSnapshot`/`loadLatestSnapshot`/
lease; production передаёт только memory-backed aggregate. Вводится **отдельный**
`OrchestratorPersistence` adapter:

- собственный storage key (не `llmCodexDebateRun.v1`);
- версия snapshot/event-log — `OrchestratorPersistence.VERSION = 1`;
- атомарность последовательности событий (`eventSequence` монотонен);
- связь snapshot с `caseVersion` канонического case;
- совместимость с существующим lease (`compareAndSetLease`).

`results.js` передаёт его в `createApplication`. `createMemoryPersistence`
запрещён в production, остаётся тестовой зависимостью. Отсутствие durable порта →
`UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE`.

**Фактический статус change set:** добавлен deterministic adapter
`disput/debate-orchestrator-persistence.js` с versioned event/snapshot/lease API.
Cross-context atomicity поверх `chrome.storage` и publication cursor пока не
доказаны browser-тестом и остаются обязательным P0 follow-up; adapter не должен
считаться заменой такого доказательства.

## Версии

`DebateRunStore.VERSION` **не меняется** — operational aggregate. Семантическая
durability обеспечивается новым `OrchestratorPersistence` (v1), не бампом
RunStore. Утверждение «RunStore остаётся 5» относится только к operational
данным и не покрывает семантику.

## Recovery

```
прочитать канонический case
→ пересобрать индекс
→ пересобрать проекцию
→ восстановить lifecycle из RunStore
→ возобновить Planner только при совпадении версий
```

## Тесты

| Тип | Проверка |
|---|---|
| unit | Атомарность батча: сбой одной операции не оставляет частичного применения |
| unit | Fencing: конкурирующий commit на ту же базовую версию отклоняется |
| unit | Идемпотентная публикация: повтор события не меняет state |
| integration | Commit переживает reload — артефакты и `caseVersion` на месте |
| integration | Сбой между persist и publish: recovery восстанавливает проекцию из `changes[]` |
| integration | Два конкурентных commit'а: успешен ровно один |
| recovery | Replay даёт состояние, идентичное прямому чтению case |
| stale | Late response после pause+intervention: delta не теряется, событие содержит payload |
| E-06, E-08 | Становятся зелёными |

## Acceptance criteria

1. Нет окна «артефакты применены, persistence не завершена».
2. Подтверждённый commit присутствует в canonical store после reload.
3. Применённая delta не применяется дважды.
4. Stale delta сохраняется с полным содержимым и одной попыткой rebase.
5. Production не использует memory persistence для семантики.
6. Два конкурентных commit'а к одной версии не могут оба завершиться успешно.
7. Recovery восстанавливает проекцию без обращения к RunStore-семантике.
8. E-06, E-08 зелёные.

## Rollback boundary

Изменения аддитивны по persisted-форме (схема не менялась в Phase 3–4, кроме
уже сделанного бампа в Phase 2). Откат — восстановление предыдущего пакета
расширения; данные читаются обеими версиями.

## Запрет следующей фазы

Phase 5 запрещена до crash-safe commit: иначе новая проекция будет
детерминированно проецировать недолговечное состояние.

## Отчёт (обе фазы)

Baseline commit · изменённые файлы и функции · решение по `REGISTRY_UPDATED` ·
контракт before/after · подтверждение, что `RunStore.VERSION` не потребовал
бампа (или обоснование обратного) · миграция · тесты и результаты прогона ·
статус E-тестов · остаточные риски · статус: DONE / PARTIAL / BLOCKED.

### Follow-up persistence v2 (2.81.51)

Memory-only реализация v1 заменена durable localStorage event/snapshot/lease
journal. Cross-context mutual exclusion выполняет Web Locks, а
`leaseRevision` остаётся fencing token для semantic commit. Два browser page
contexts доказали recovery и отклонение второго владельца до dispatch.

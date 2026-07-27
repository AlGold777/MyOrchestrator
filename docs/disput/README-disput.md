# Disput — актуальная нормативная документация

`docs/disput/` — каталог актуальных требований, контрактов и доказательств
готовности Disput. Общая карта всего проекта находится в
[`../documentation-map.md`](../documentation-map.md). Архив расположен отдельно в
[`../disput-old/`](../disput-old/) и не задаёт требования к текущей реализации.

## Нормативные документы

1. [Universal pipeline plan](PLAN-universal-pipeline-v3.0.md) — решения, статус, release-задачи и gates.
2. [Orchestrator contract](orchestrator-contract-v1.0.md) — единственный lifecycle owner.
3. [Plan revision specification](plan-revision-specification-v1.0.md) — immutable-команды и revisions.
4. [ADR-001: Universal-only cutover](ADR-001-universal-only-cutover.md) — принятое решение об отсутствии legacy fallback.
5. [Evidence matrix](EVIDENCE-MATRIX-v3.0.md) — требование → код → тест → release gate.
6. [Незавершённые обязательства](OPEN-ITEMS-v3.0.md) — открытые P0/P1/P2 и критерии их закрытия.
7. [Canvas synthesis insertion v1.1](TZ-synthesis-insertion-v1.1.md) — DraftPlan,
   materialизация графа, промежуточный synthesis и UI/revision boundary.
8. [ADR-002: Semantic layer ownership](ADR-002-semantic-layer-ownership.md) —
   владелец артефактов, модель изменения, судьба реестра и карты, словарь статусов.
9. [Semantic layer plan v1.0](PLAN-semantic-layer-v1.0.md) — держатели состояния,
   граница транзакции, findings S-01…S-13, карта фаз и матрица версий.
10. [Runtime и UI corrections](TZ-runtime-ui-corrections-v1.0.md) — вкладки
    раундов, double-click synthesis, Manual/Auto approval, ручной запуск,
    reload cleanup и performance safeguards.

### ТЗ фаз семантического слоя

Исполняются строго по порядку; каждое ТЗ содержит собственные acceptance criteria
и rollback boundary.

| Фаза | Документ | Содержание |
|---|---|---|
| 0 | [Evidence](TZ-semantic-phase0-evidence-v1.0.md) | Characterization-тесты E-01…E-09; baseline зафиксирован зелёным |
| 1–2 | [Canonical owner](TZ-semantic-phase1-2-canonical-owner-v1.0.md) | Единый semantic writer; lifecycle артефакта; реализованы schema/store contracts |
| 3–4 | [Registry & durability](TZ-semantic-phase3-4-registry-durability-v1.0.md) | Реестр как производный индекс; adapter persistence и batch commit |
| 5–6 | [Projection & Planner](TZ-semantic-phase5-6-projection-planner-v1.0.md) | Контракт проекции; actionable-предикаты Planner |
| 7–8 | [UI & cleanup](TZ-semantic-phase7-8-ui-cleanup-v1.0.md) | Единый контур чтения; удаление конкурирующих путей |

## Обязательная дисциплина изменений

Любое изменение Disput, включая документацию, выполняется одним атомарным
change set:

1. увеличивается версия в `manifest.json` и `package.json`;
2. добавляется верхняя запись в `docs/CHANGELOG.md`;
3. обновляется этот каталог: контракт, план и/или evidence matrix по затронутой области;
4. добавляются или обновляются детерминированные тесты;
5. в evidence matrix фиксируется фактический статус: `implemented`, `partial`,
   `planned` или `not-applicable`.

Новый материал не может вводить альтернативный executor, фиксированную форму
разговора или второй источник lifecycle state.

## Граница содержимого Disput telemetry

`DebateTraceStore` — диагностическое хранилище, а не копия transcript или
semantic state. В trace разрешены идентификаторы, lifecycle/status transitions,
тайминги, счётчики, hash и ограниченные причины ошибок. Полные prompts, ответы
моделей, HTML, semantic artifact prose, StateMap/context snapshots и тела
вложений запрещены и удаляются на входе. Производные секции отчёта ссылаются на
канонические `eventId`, а не вкладывают копии events. Старые persisted trace
events повторно санитизируются при restore и сразу перезаписываются в storage
уже в `TraceSchema.VERSION=5`.

## Осталось сделать

Ниже перечислены обязательства, которые **не считаются выполненными** текущим
change set и должны закрываться отдельными изменениями с тестами и записью в
CHANGELOG:

| Обязательство | Текущий статус | Критерий закрытия |
|---|---|---|
| Publication cursor / post-commit delivery | open / P1 | Идемпотентная доставка событий с доказанным `lastPublishedSequence` |
| Полный browser E2E интерактивного UI Phase 7–8 | open / P1 | Реальный drawer human action виден Planner после reload; текущий E2E закрывает semantic pause/reload/continue и duplicate-dispatch |
| Полная migration matrix старых persisted cases | partial / P1 | Array→map и повторный reload закрыты; ещё нужны unknown fields, rollback/export и все исторические schema fixtures |
| Replay equivalence без последнего snapshot | open / P1 | Восстановление только из event log даёт эквивалентный case/StateMap |

Закрыто в 2.81.51: durable Orchestrator recovery и cross-context lease fencing.
Browser evidence: одинаковые artifacts/StateMap до и после reload,
`dispatchCount = 1`, конкурентный владелец получает `LEASE_HELD`.

Любое закрытие строки требует обновить этот раздел, [OPEN-ITEMS](OPEN-ITEMS-v3.0.md),
[EVIDENCE-MATRIX](EVIDENCE-MATRIX-v3.0.md), версию пакета и CHANGELOG.

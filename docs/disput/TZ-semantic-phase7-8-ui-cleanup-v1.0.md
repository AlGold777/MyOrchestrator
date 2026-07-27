# ТЗ Phase 7–8 — Согласование UI и удаление конкурирующих путей

**Версия:** 1.1
**Приоритет:** P0 (S-02) / P1 (очистка)
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573` (2.81.41)
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md) D1, D4, **D6** · **План:** [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md)
**Prerequisite:** [Phase 5–6](TZ-semantic-phase5-6-projection-planner-v1.0.md) завершены

> **Изменение 1.1:** маршрутизация competing writers (`onHumanAction`,
> `onLinkRemove`, `syncAggregateArtifactsToCase`) **перенесена в Phase 1** (D6.4),
> т.к. они делали UI вторым semantic writer'ом сразу после смены владельца в
> Phase 1. Здесь остаётся только **чтение** UI из канонического контура и
> отображение — запись человека уже маршрутизирована.

---

# Phase 7 — UI (чтение и отображение)

## Цель

UI показывает ту же карту, по которой Planner принимает решения. Запись действий
человека уже проходит через единственную точку мутации (Phase 1); здесь
согласуется источник чтения.

## Контекст (writers закрыты в Phase 1)

S-13 (`onHumanAction`) и S-17 (`onLinkRemove`) как semantic writers устранены в
Phase 1 (D6.4): действие человека — атомарный batch commit через
`Orchestrator.submitIntervention`. Эта фаза их не трогает; проверяет только, что
UI **читает** из канонического контура.

## Файлы и функции

| Файл | Функция | Изменение |
|---|---|---|
| `results.js` | `DisputStateMapView.init` / `getAggregate` | Источник — канонический case через `projectStateMap`, не `aggregate.protocolState` |
| `results/disput-state-map-view.js` | `render` | Принимает результат единственного контура проекции |
| `results/disput-state-map-view.js` | — | Отображение `synthesisArtifactId`, `workingSynthesisArtifactIds`, `validAuditArtifactId` |

(Маршрутизация `onHumanAction`/`onLinkRemove` и удаление `syncAggregateArtifactsToCase`
выполнены в Phase 1 — здесь не повторяются.)

## Контракт

**Текущий:** `render(aggregate)` → `DebateStateMap.project({...aggregate})` →
при пустом `protocolState` пустые коллекции.

**Новый:** `render(projectStateMap(canonicalCase))` — тот же вызов, что у Planner.

## Отображение синтезов

Проекция даёт `synthesisArtifactId`, `workingSynthesisArtifactIds`,
`validAuditArtifactId`; UI их не показывает. Пользователь не видит, какой синтез
считается финальным, какие промежуточные существуют и пройден ли аудит.
Добавляется отображение — без новых контролов управления.

## Recovered run

Для восстановленного run семантика читается из персистированного case.
Совместимость с текущим поведением recovered-lifecycle не меняется — эта фаза
не трогает pause/resume.

## Тесты

| Тип | Проверка |
|---|---|
| jsdom | Во время run UI-карта непуста и совпадает с `orchestrator.getState().stateMap` |
| jsdom | Действие пользователя проходит через `submitIntervention`; прямого `caseStore.apply` нет |
| jsdom | После действия пользователя Planner видит изменение (goal или снятие actionable) |
| jsdom | Отображаются финальный синтез, промежуточные и статус аудита |
| jsdom | Reload: карта восстанавливается из персистированного case |
| gate | В `results.js` нет прямых семантических записей в `caseStore` |
| E-07 | Становится зелёным |

## Acceptance criteria

1. UI и Planner читают один контур; расхождение невозможно по построению.
2. Ноль прямых semantic-записей из UI в `caseStore`.
3. Действие пользователя видимо Planner'у.
4. Синтезы и статус аудита отображаются.
5. Reload восстанавливает карту.
6. E-07 зелёный. Все E-тесты Phase 0 зелёные.

## Rollback boundary

Изменения в слое чтения и маршрутизации; persisted-форма не меняется.
Откат — возврат пакета.

## Запрет следующей фазы

Phase 8 запрещена до совпадения контуров: удаление compatibility-путей при
несовпадении оставит UI без источника.

---

# Phase 8 — Удаление конкурирующих и мёртвых путей

## Цель

Снять временные адаптеры и мёртвый код после того, как канонический путь
доказан.

## Prerequisite

Phase 7, AC 1–6; миграция старых persisted runs завершена.

## Кандидаты на удаление

| Элемент | Основание | Условие удаления |
|---|---|---|
| `syncAggregateProtocolState` | 0 production call sites | Ноль ссылок |
| `replaceAggregateProtocolState` | Единственный вызов — test-gated `__setSerialDebateStateForTest` | Тестовый хелпер переведён на канонический путь либо удалён |
| Три формы входа проектора | Compatibility для старых runs | Все persisted runs мигрированы; телеметрия не фиксирует legacy-чтений в течение release window |
| `syncAggregateArtifactsToCase` | Удалён в Phase 7 | Подтвердить отсутствие ссылок |
| Deprecated-алиас `openQuestions` | Введён в Phase 5 на одну версию | Внешних потребителей нет |
| `REGISTRY_UPDATED` reducer | Решение принято в Phase 3 | По зафиксированному решению |
| `disput/debate-state-delta.js` | В production не вызывается; логика дублирована в `artifact-pipeline` | **Требует отдельного решения**, см. ниже |

## Решение по `debate-state-delta.js`

Модуль содержит `revise`, `supersede`, `merge`, anchor-валидацию и проверку
`expectedRevision` — семантику, которую Phase 2 реализует в `CaseSchema`.
Production-путь идёт мимо него; `debate-version-manifest.js` читает его `VERSION`.

Три варианта, решение фиксируется в отчёте:

1. **Удалить** — после переноса всей нужной семантики в `CaseSchema` и замены
   источника версии в манифесте.
2. **Свести** — сделать тонкой обёрткой над `CaseSchema`, сохранив публичное имя.
3. **Оставить** — если найдутся потребители вне production-пути.

Удаление запрещено до доказательства нулевых call sites **и** замены источника
версии в манифесте.

## Условия удаления (для каждого элемента)

1. Ноль production call sites.
2. Ноль persisted-зависимостей writer'а.
3. Успешная миграция старых fixtures.
4. Телеметрия без legacy-чтений в установленном release window.
5. Browser E2E нового и мигрированного run.
6. Задокументированная процедура отката.

## Тесты

| Тип | Проверка |
|---|---|
| gate | Repository call-graph: удаляемые символы отсутствуют |
| migration | Старые fixtures открываются после удаления адаптеров |
| E2E | Новый run и мигрированный run дают эквивалентный семантический результат |
| regression | Полный прогон зелёный |

## Acceptance criteria

1. Один semantic mutation port.
2. Ноль записей в `protocolState.registry`.
3. Ноль записей в массив артефактов Orchestrator.
4. Planner не читает legacy-поля и не сверяет литералы статусов.
5. Новые runs не создают compatibility-данных.
6. Старые runs открываются после завершения миграции.
7. Удаление legacy-кода не меняет семантический результат E2E.
8. Решение по `debate-state-delta.js` принято и обосновано.

## Rollback boundary

После удаления compatibility-читателей откат требует сохранённого
мигрированного case. Возврат к legacy-хранению реестра не поддерживается
(политика [ADR-001](ADR-001-universal-only-cutover.md)).

## Отчёт (обе фазы)

Baseline commit · изменённые файлы · решение по `debate-state-delta.js`
с обоснованием · подтверждение шести условий удаления по каждому элементу ·
результаты E2E нового и мигрированного run · итоговое число mutable semantic
holders · статус: DONE / PARTIAL / BLOCKED.

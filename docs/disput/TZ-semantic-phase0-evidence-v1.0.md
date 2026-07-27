# ТЗ Phase 0 — Current-state evidence

**Версия:** 1.1
**Приоритет:** P0
**Baseline:** `a33b37fc9739c81cd9a3bc42cbec6436e3ab4573` (2.81.41)
**Решения:** [ADR-002](ADR-002-semantic-layer-ownership.md) вкл. D6 · **План:** [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md)
**Prerequisite:** нет

## Формат: characterization-тесты (пересмотрено в 1.1)

Версия 1.0 требовала, чтобы тесты «падали», но при этом задавала baseline-ожидания
(`applied === false`), при которых они **проходят** — внутреннее противоречие.

Ревизия 1.1: тесты — **characterization**. Они фиксируют фактическое дефектное
поведение и **зелёные на baseline**. В фазе-фиксе меняется одно ожидание
(дефектное → желаемое), а не структура теста. Отдельный красный Jest project не
вводится; смешение двух форматов запрещено.

Так тест доказывает дефект (документирует его как контракт) и служит точкой,
которая переворачивается ровно в своей фазе.

## Цель

Зафиксировать каждый подтверждённый дефект characterization-тестом **до**
изменения production-кода: сначала документируем текущее поведение как контракт,
затем в фазе переворачиваем ожидание.

## Границы

- Production-код **не меняется**. Ни одной строки вне `tests/`.
- Меняется только одно ожидание в фазе-фиксе, не структура теста.
- Тест не пишется против отсутствующей инфраструктуры «на будущее».
- Экспорт для тестируемости: если `commitStageResult` не экспортирован (E-02) или
  persistence недоступен для прямой проверки (E-08) — тест использует существующий
  публичный путь (`start`/`getState`/`getOrchestrator`), а не приватные символы.
  Требование теста к неэкспортированному API запрещено.

## Файлы

- `tests/semantic-layer-evidence.test.js` — модульные доказательства (E-01…E-06).
- `tests/semantic-layer-wiring-evidence.test.js` — jsdom-доказательства проводки
  (E-07…E-08). Использовать существующий харнесс из
  `tests/results-debate-favorites.test.js` (`loadResultsScript`).

## Обязательные тесты

Каждый тест помечается в описании finding-ID и фазой, в которой станет зелёным.

Тест обращается к поведению через **публичный путь** (`start` → `getState`),
а не к конкретной функции: `commitStateDelta` в Phase 1 станет `prepareMutations`,
и тест, привязанный к имени функции, сломался бы структурно. Проверяется
наблюдаемый результат (state после стадии), не внутренний вызов.

### E-01 — существующий артефакт не обновляется (S-01, переворот в Phase 2)

**Given** run, где стадия произвела артефакт `id: 'a1'`, `status: 'raised'`,
`title: 'X'`.
**When** следующая стадия предлагает `a1` с `status: 'resolved'`, `title: 'Y'`.
**Then** baseline (characterization): в `getState().stateMap` артефакт `a1`
остаётся `raised`/`X`; число артефактов не изменилось.
**Переворот в Phase 2:** ожидание меняется на `resolved`/`Y`, `revision` +1.

### E-02 — повтор засчитывается как стагнация (S-01, переворот в Phase 2)

**Given** артефакт `a1` уже в state после стадии.
**When** та же delta наблюдается повторно (тот же correlation).
**Then** baseline: `getState().stagnationSignals.consecutiveNoStateDelta`
инкрементируется.
**Переворот в Phase 2:** идемпотентный повтор не увеличивает сигнал стагнации.

### E-03 — резолюционные goals не выводятся (S-03, зелёный в Phase 6)

Три независимых кейса, каждый — отдельный `test()`:

| Кейс | Артефакт от extractor | Ожидание baseline |
|---|---|---|
| E-03a | `objection`, `severity: 'blocking'`, статус из `statusFor('objection')` = `'raised'` | `deriveGoals` не содержит `resolve_objection` |
| E-03b | `contradiction`, статус = fallback `'recorded'` | нет `resolve_contradiction` |
| E-03c | `dissent`, статус `'recorded'` | нет `examine_dissent` |

Статус **брать из `statusFor`**, не хардкодить — тест должен ломаться, если
extractor изменит словарь.

### E-04 — open questions не порождают goal (S-06, зелёный в Phase 5)

**Given** артефакт `type: 'open_question'`, `status: 'open'`.
**When** `projectStateMap` → `Planner.deriveGoals`.
**Then** baseline: проекция содержит непустой `openQuestions`; `map.questions`
undefined; `answer_open_question` не выведен.
**Assert обе стороны:** и наличие `openQuestions`, и отсутствие `questions` —
тест доказывает именно расхождение имён, а не отсутствие данных.

### E-05 — проекция не производит поля, читаемые Planner (S-07, зелёный в Phase 5)

**Given** case с артефактами разных типов и авторов.
**When** `projectStateMap(state)`.
**Then** baseline: `artifactAuthors`, `contextPressure`, `finalArtifactIds`
отсутствуют в результате.
**Дополнительно:** contract-тест `PlannerInput.stateMap ⊆ projectStateMap output`
падает с перечислением недостающих ключей.

### E-06 — stale delta теряет содержимое (S-05, зелёный в Phase 4)

**Given** stage с `proposedStateDeltas`, где `expectedCaseVersion` отстаёт от
`state.caseVersion`.
**When** `commitStageResult`.
**Then** baseline: эмитится `STATE_DELTA_STALE` с payload
`{ stageInstanceId, expected, actual }` — **без** `delta`; артефакты этой delta
отсутствуют в case; повторной попытки не происходит.
**Assert:** `event.payload.delta === undefined`.

### E-07 — артефакты не доходят до UI (S-02, зелёный в Phase 7)

jsdom, production-подобная композиция.

**Given** universal run с полностью подключёнными портами.
**When** выполнена стадия, эмитировано `STATE_DELTA_APPLIED`.
**Then** baseline:
- `aggregate.protocolState` равен `null`;
- `aggregate.protocolState?.registry?.artifacts` пуст;
- после `syncAggregateArtifactsToCase` в `debateCaseStore` нет артефактов;
- `DisputStateMapView.render(aggregate)` даёт пустые коллекции при непустом
  `orchestrator.getState().stateMap.artifacts`.

**Assert контраст явно:** непустой runtime против пустого UI — это и есть
доказательство разрыва.

### E-09 — late response отбрасывается без содержимого (S-14, зелёный в Phase 4)

**Given** stage в `QUIESCING` с `pausePolicy: 'finish_received_only'`; после
paused-интервенции revision superseded.
**When** `reconcile` обрабатывает `lateResponses`.
**Then** baseline: эмитится `LATE_RESPONSE_DISCARDED` с payload
`{ stageInstanceId, reason }` — **без** delta; артефакты late response
отсутствуют в case.
**Assert:** `event.payload.delta === undefined`.

### E-08 — канонический state не переживает reload (S-04, переворот в Phase 4)

**Given** run через публичный `start`; затем новый `createApplication` в той же
production-конфигурации (эмуляция reload).
**When** проверяется восстановление семантики через публичный `getOrchestrator().getState()`.
**Then** baseline: после пересоздания семантический state пуст (memory
persistence не переживает пересоздание).
**Переворот в Phase 4** (единственная фаза для E-08; двойное назначение
Phase 1/4 из v1.0 устранено): reload восстанавливает тот же `caseVersion` и
артефакты из durable `OrchestratorPersistence`.
**Комментарий:** тест не обращается к приватному `loadLatestSnapshot`; фиксирует
наблюдаемое отсутствие durable семантики.

## Acceptance criteria

1. Девять групп characterization-тестов существуют и **зелёные** на baseline.
2. Каждый тест фиксирует одну причину; описание называет finding-ID и ожидаемый переворот.
3. Ни один тест не зависит от таймингов без контролируемого планировщика.
4. Ни одна строка production-кода не изменена (`git diff --stat` вне `tests/` пуст).
5. В описании каждого теста указана фаза, в которой он станет зелёным.
6. Полный прогон `npx jest --config tests/jest.config.js` остаётся зелёным; при
   переходе фазы меняется только соответствующее ожидание.

## Способ фиксации падений

Тесты добавляются сразу в рабочем виде (зелёными characterization), не в `skip`.
Красный проект не вводится: до фикса фазы тест проверяет фактическое baseline-
поведение, после фикса — целевое поведение.

## Rollback boundary

Отсутствует: production-код не изменяется. Откат — удаление тестовых файлов.

## Отчёт

Для каждого E-теста: файл, имя теста, finding-ID, фактическое сообщение о
падении, фаза-цель. Плюс подтверждение п.4 acceptance (пустой diff вне `tests/`).

## Фактическое исполнение

В версии 2.81.51 матрица переведена с baseline-characterization на целевые
ожидания после выполнения фаз. `tests/semantic-layer-phase0.test.js` содержит
E-01, E-02, E-03a/b/c, E-04, E-05, E-06, E-07, E-08 и E-09. Production-shaped
проверки canonical start, constraint reload и lifecycle находятся в
`tests/semantic-layer-canonical-integration.test.js`; browser recovery и
cross-context fencing воспроизводятся через
`tests/fixtures/semantic-recovery.html`.

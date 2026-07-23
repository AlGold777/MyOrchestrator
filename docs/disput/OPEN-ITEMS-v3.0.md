# Disput — незавершённые обязательства

**Версия:** 3.0  
**Дата сверки:** 2026-07-23  
**Статус продукта:** не release-ready.

Этот документ — явный реестр того, что ещё не выполнено по принятому universal
pipeline plan и внешней архитектурной проверке. Он важнее устных оценок
готовности: пункт нельзя считать закрытым без реализации, детерминированного
теста и обновления [evidence matrix](EVIDENCE-MATRIX-v3.0.md).

## P0 — блокирует релиз

| ID | Незавершённый результат | Что уже есть | Критерий закрытия |
|---|---|---|---|
| P0-R1 | Browser recovery equivalence | Snapshot/replay, participant and human-decision migration покрыты unit-тестами | Реальный browser E2E: 4+ участников, parallel stage, pause, reload, отсутствие повторного dispatch, идентичные StateMap и artifact set с контрольным run |
| P0-R2 | Browser transport-race suite | Terminal/idempotency/fencing unit-тесты | E2E для delayed final, duplicate final, timeout→late success, abort batch, tab loss, partial parallel failure и cancel during synthesis; late event не меняет canonical state |
| P0-R3 | Human-decision DOM surface | Pending request persisted; stale/duplicate resolution отклоняется | UI показывает request ID, reason, options и affected stage; после reload восстанавливает запрос и отправляет revision-checked resolution |
| P0-R4 | Cross-context invalidation in browser | Lease revision, compare-and-set hook и notification hook | Две реальные вкладки: takeover/fencing переводит старого владельца в read-only и исключает любой поздний StateDelta commit |
| P0-R5 | Release rollback and canary drill | ADR-001 определяет rollback как возврат release artifact | Проверенный previous package, schema-compatibility statement, rollback test, incident procedure, named owner и stop criteria |

## P1 — требуется до расширенного production rollout

| ID | Незавершённый результат | Критерий закрытия |
|---|---|---|
| P1-T1 | Telemetry allowlist и operational thresholds | Документированы redaction allowlist, dashboard-поля, alert thresholds, canary cohort и ответственный owner; есть regression tests |
| P1-C1 | Persisted custom-config migration | Идемпотентный импорт legacy config в universal data без legacy runtime semantics; тест повторной загрузки |
| P1-S1 | StateMap conflict UI | Пользователь видит stale/conflicting delta, provenance и выполняет только persisted human action |
| P1-G1 | Resource governance | Enforced limits для stages/calls/retries/time/context/corrections с typed degradation evidence |

## P2 — качество эксплуатации

| ID | Незавершённый результат | Критерий закрытия |
|---|---|---|
| P2-P1 | Capacity measurement | Зафиксированы p95 для 1/4/8/16 участников и 10/50/200 artifacts; нет квадратичного dispatch overhead |
| P2-A1 | Accessibility/operator UX | Keyboard/focus/live-region/contrast проверки и понятные degraded-result explanations |

## Что не является незавершённым

- Возврат Multi, Triad, Duel или другого legacy executor не является задачей и
  запрещён [ADR-001](ADR-001-universal-only-cutover.md).
- Совместимость относится только к данным и миграции, а не к восстановлению
  старой execution semantics.

## Правило закрытия

Закрывая строку, change set обязан: увеличить версию манифеста и пакета,
добавить changelog entry, обновить этот документ и evidence matrix, приложить
тест на минимальном достаточном уровне и явно назвать пройденный release gate.

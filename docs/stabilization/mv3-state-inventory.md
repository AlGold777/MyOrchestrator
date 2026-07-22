# MV3 in-memory state inventory (F5)

Дата: 2026-06-16. Цель R5: какое module-scope состояние background переживает перезапуск MV3 service worker, какое теряется, и что из потерянного критично для активного рана.

> Контекст MV3: SW выгружается после ~30с простоя и при крэше. Всё, что в module-scope (Map/Set/таймеры), обнуляется. Переживает только то, что записано в `chrome.storage` и перечитано при следующем пробуждении SW.

## Классификация

### A. Конфигурация / константы — НЕ риск
Frozen-наборы имён моделей и меток, пересоздаются при загрузке скрипта. Состояния не несут.
- `job-orchestrator.js`: `ROUND2_REPAIR_MODELS`, `EARLY_GESTURE_RECOVERY_MODELS`, `HARD_STOP_DEFER_RECOVERY_MODELS`, `PRE_TERMINAL_MATERIALIZE_MODELS/_STATUSES`, `MATERIALIZE_LATEST_RETRY_MODELS`, `RECOVERABLE_TERMINAL_PING_STATUSES`, `DOM_SNAPSHOT_RECOVERY_MODELS`, `LATE_COLLECT_SLOW_MODELS`, `DEFER_STREAM_FINAL_MODELS`, `EARLY_TERMINAL_GUARD_MODELS`.
- `message-router.js`: `DIAG_PINNED_LABELS`; `telemetry-logs.js`: `POST_TERMINAL_NOISE_LABELS`, `PINNED_LABELS`; `tab-manager.js`: `URL_MATCH_BOUNDARY`.

### B. Персистентное состояние — переживает рестарт ✅
| Структура | Файл | Механизм |
|---|---|---|
| `jobState` (состояние всего рана) | `shared-state.js` / `job-orchestrator.js` | `CompressedStorage.set('jobState')` (запись), `CompressedStorage.get('jobState')` (чтение, ~3352) |
| rate-limit окна | `rate-limit.js` | `chrome.storage` + `chrome.alarms` resume (ТЗ этап 5) ✅ MV3-safe |
| dispatch circuit breaker | `dispatch-retry.js` | `DISPATCH_CIRCUIT_STORAGE_KEY` persist/restore ✅ |

### C. Runtime-состояние, ТЕРЯЕТСЯ при рестарте — РИСК

| Структура | Файл | Что теряется | Самовосстановление? |
|---|---|---|---|
| **`sessionTimers` + все `setTimeout`** | `job-orchestrator.js:3190` | таймеры deferred-finalization, stable-pending auto-finalize, recheck-пинги | **НЕТ** — таймер не перевзводится |
| `claudeRetryTimers`, `claudeRetryFinalizeTimers` | `job-orchestrator.js:2508` | отложенный повторный сбор Claude | НЕТ |
| `postR2AutoCollectTimers`, `adaptiveCollectTimers` | `job-orchestrator.js:2507,2510` | отложенный сбор ответов | НЕТ |
| `postSuccessScrollTimers` | `human-presence.js:34` | пост-успех скролл | НЕТ (не критично) |
| `scriptRuntimeHardStopTimers` | `dispatch-coordinator.js:77` | hard-stop сторожевые таймеры | НЕТ |
| `lateAnswerSnapshotMemory`, `lateAnswerCollectInFlight` | `job-orchestrator.js:105` | дедуп/память поздних снапшотов | да (пересоберётся при следующем пинге) |
| `pendingPings`, `pendingPingByTabId`, `healthCheckFailuresByTabId` | `health-monitor.js:12` | незавершённые health-пинги | да (новые пинги) |
| `automationVisitLocks`, `programmaticFocusByTabId` | `human-presence.js:32` | лизы визитов/фокуса | да (лиза переустановится) |
| `dispatchIdRegistry` | `dispatch-retry.js:14` | идемпотентность доставки (TTL 60с) | частично — окно дедупа теряется |
| `promptSubmitWaiters` | `dispatch-coordinator.js:8` | ожидание подтверждения submit | НЕТ (промис зависнет) |
| `earlyReadyWaiters` | `message-router.js:114` | ожидание готовности вкладки | НЕТ (промис зависнет) |
| `sessionTabIds`, `jobMetadata`, `platformDegradedAt` | `shared-state.js` | привязка вкладок/деградация | частично |

## Критический вывод

`jobState` переживает рестарт, но **механизм, который должен его до-финализировать (session-таймеры на `setTimeout`), — нет**. Сценарий зависания:

1. Ран в фазе deferred-finalization (долгий ответ, как Le Chat в логе) → взведён `setTimeout` recheck/auto-finalize.
2. SW выгружается по простою до срабатывания таймера.
3. SW просыпается на внешнем событии → `jobState` перечитан, но **таймер потерян и не перевзводится** → запись остаётся `RECEIVING`/pending, пока пользователь не нажмёт пинг вручную или не придёт tab-событие.

Это и есть R5 «высокий импакт»: рассинхрон между персистентным состоянием и эфемерными драйверами этого состояния.

## Рекомендации (следующий этап, НЕ слепые правки)

1. **`chrome.alarms` вместо критических `setTimeout`** для deferred/stable-pending финализации — по образцу rate-limit. Alarm с ключом `llmName:sessionId` переживает рестарт и до-финализирует.
2. **Reconcile-проход при пробуждении SW** (`chrome.runtime.onStartup` + после `loadJobState`): пройти по `jobState.llms`, найти нетерминальные entry с pending-ответом и переустановить недостающие таймеры/alarm'ы. Сейчас `onStartup` есть в `remote-selectors`, `tab-manager`, `message-router`, но НЕ перезапускает финализацию рана.
3. **Идемпотентность доставки**: персистить `dispatchIdRegistry` (или хотя бы `confirmedDispatchId` уже в `jobState` — проверить, что используется при reconcile), чтобы рестарт не привёл к повторной отправке промпта.
4. **Зависающие промисы** (`promptSubmitWaiters`, `earlyReadyWaiters`): при reconcile отклонять/перезапускать ожидания, осиротевшие рестартом.

Приоритет: #1 и #2 закрывают основной сценарий зависания и должны идти вместе.

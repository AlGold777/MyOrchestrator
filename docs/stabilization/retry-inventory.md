# Инвентаризация слоёв ретраев

Дата: 2026-06-13. Составлено в рамках стабилизационного ТЗ (этап 3).

| Слой | Файл:строка | Триггер | Макс. попыток | Задержка | Может повторно отправить промпт в чат? |
|---|---|---|---|---|---|
| `RetryStrategy` (классификация/бэкофф) | `background/dispatch-retry.js:19` (класс — `utils/retry-strategy.js`) | вызывается другими слоями для расчёта решения | 5 (параметр) | экспоненциальная 1с→30с, jitter 0.3 | нет (только расчёт) |
| `scheduleDispatchRetry` | `background/dispatch-coordinator.js:336` | `ack_timeout`, `page_not_ready`, `submit_timeout`, ошибки диспатча | через `DispatchRetry.getDispatchRetryDecision` (5) | `retryAfterAt = now + delayMs` | нет напрямую — только взводит `retryAfterAt`; доставку выполняет supervisor через `dispatchPromptToTab` |
| `runPromptDispatchSupervisor` | `background/dispatch-coordinator.js:725` | периодический проход по незавершённым entry | `DISPATCH_MAX_ATTEMPTS` | пер-модельный бэкофф `getRetryBackoffForModel` | **да**, через `dispatchPromptToTab` (reason `retry_supervisor`) — легально по контракту |
| `sendMessageSafely` | `background/dispatch-coordinator.js:1410` | ошибка `chrome.tabs.sendMessage` | по `CONNECTION_RETRY_DELAYS` | `getConnectionRetryDelaysForModel` | нет — повтор доставки того же сообщения в ту же вкладку в рамках того же dispatchId |
| `sendPassiveMessageWithRetries` | `background/dispatch-coordinator.js:1707` | пассивные сообщения (сбор/пинг) | 3 (параметр) | base 2с / `transportRetryDelays` | нет — не несёт промпт |
| `scheduleClaudeHardTimeoutRetry` | `background/job-orchestrator.js:2629` | hard timeout у Claude | 1 (`hardTimeoutRetryDone`) | session-таймер | нет — повторная ЭКСТРАКЦИЯ ответа, не отправка промпта |
| Rate-limit resume | `background/rate-limit.js` (с этапа 5 — chrome.alarms) | истечение окна rate-limit | 1 на окно | до конца окна | нет напрямую — вызывает `startModelForLLM`, который идёт через стандартный диспатч |
| `dispatchRound1Sequentially` / Round-механика | `background/job-orchestrator.js` | recovery раундов (round1_recover, MODEL_MISSING) | 1 на причину | фиксированные паузы раундов | **да**, через `startModelForLLM` → `dispatchPromptToTab` — легально по контракту |

## Контракт ретраев

1. Единственная функция, имеющая право доставить текст промпта во вкладку — `dispatchPromptToTab` (`background/dispatch-coordinator.js`).
2. Все остальные слои повторов обязаны вызывать доставку только через неё и только с тем же dispatchId-механизмом (`llmName:sessionId:attempt`).
3. Повторная доставка подтверждённого dispatchId блокируется реестром `DispatchIdRegistry` (TTL 15 минут, телеметрия `DUPLICATE_DISPATCH_BLOCKED`).
4. Слои, нарушающие пункты 1–3, считаются дефектом и подлежат исправлению в следующем этапе работ.

## Найденные нарушения контракта

Нарушений пункта 1 не найдено: все слои, способные привести к повторной отправке промпта (supervisor, rate-limit resume, round recovery), сходятся в `dispatchPromptToTab`, где действует реестр идемпотентности.

Замечания (не нарушения, кандидаты на следующий этап):
- `sendMessageSafely` ретраит произвольные сообщения, включая `GET_ANSWER`-команды; идемпотентность обеспечивается полем `meta.dispatchId` на принимающей стороне, но формального гейта через `DispatchIdRegistry` в этом слое нет.
- dispatchId строится как `llmName:sessionId:attempt` — каждая новая попытка получает новый id, поэтому реестр защищает от двойной доставки ОДНОЙ попытки, но не ограничивает число попыток (это делает `DISPATCH_MAX_ATTEMPTS`).

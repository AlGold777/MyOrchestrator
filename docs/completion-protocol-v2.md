# Completion Protocol V2

Completion V2 использует существующий per-dispatch tracker `ResponseLifecycleDetector` как единственного владельца terminal decision. `UnifiedAnswerCompletionWatcher`, provider controls, mutation observer и `GenerationSignal` поставляют только `WitnessEvent` в append-only Evidence Ledger.

Success определяется буквально:

```text
GENERATION_OBSERVED
&& PRODUCER_TERMINAL
&& CONTENT_TERMINAL
&& OWNERSHIP_CONFIRMED
&& !ACTIVE_VETO
```

Copy, Regenerate, completion marker, исчезновение Stop и transport marker переводят producer только в `CANDIDATE`. После configurable confirmation window substantive content/structure progress или active generation отзывают candidate. Score сохраняется лишь как `diagnosticConfidence`.

`CONTENT_TERMINAL` требует stable structural verification, восстановленной length regression и неизменности generic Materialization/Hydration pass. Проверенные text, HTML, hashes и response identity фиксируются одной immutable `ExtractionSnapshot`; Unified pipeline не выполняет повторный answer lookup.

Non-success состояния типизированы: `CONTINUE_REQUIRED`, `PROVIDER_ERROR`, `INTERRUPTED`, `STALLED`, `AMBIGUOUS`, `CONTEXT_LOST`. Progress, producer-stuck и hard-attempt timeout независимы и никогда не дают success. Recovery перед resume проходит `RecoveryReconciler`.

Production default — `enforced`: сохранённые ранее `enabled:false`, `legacy` или `shadow` не могут отключить Completion authority. Режимы `legacy`/`shadow` доступны только при явном аварийном флаге `allowLegacyCompletionRollout:true`; даже тогда background разрешает прежнюю доставку лишь для конкретного attempt с `legacyDeliveryAuthorized:true`. В обычной работе downstream принимает исключительно `SUCCESS_TERMINAL`. Weighted score остаётся только диагностикой.

`SCRIPT_READY` считается действительным только при точном совпадении build-, detector- и protocol-version и наличии `CompletionSession`. Stale или неполный content runtime автоматически получает protocol, selector resolver, lifecycle detector и bootstrap заново, после чего повторяет handshake. Обычная, ручная и recovery-финализация проходят один background authority gate, поэтому прямой вызов `handleLLMResponse` не может обойти terminal decision.

Readiness изолирован по модели: Round 0 не ждёт общий барьер всех вкладок, а обновление расширения не перезагружает provider pages. Page/runtime recovery выполняется перед dispatch конкретной модели. `reportDispatchBaseline` дожидается создания `CompletionSession`, и адаптер не выполняет Send при отсутствии зарегистрированного Completion attempt.

Переходы capability health для `generationSignal`, `producerControls`, `answerResolution` и `continueDetection` публикуются в canonical ledger как `OBSERVER_HEALTH_OBSERVED`; неизменившиеся состояния дедуплицируются. Shadow delta сохраняется отдельным canonical audit-событием `COMPLETION_SHADOW_DECISION`. Локальный `PRODUCER_TERMINAL` остаётся producer-state fact и не подменяет provider finish reason уровня Tier 4; полный V2 `SUCCESS_TERMINAL` даёт составное доказательство Tier 3.

Сценарная regression matrix находится в `tests/completion-protocol-e2e.test.js` и фиксирует normal/long streaming, stalled partial, early controls, temporary Stop disappearance, delayed hydration/structure, length regression, node replacement, Continue, provider error, SPA navigation, cosmetic churn и immutable extraction race. Отдельные integration-регрессии проверяют stale runtime repair, обязательный enforced rollout, состав двухфайловой production-сборки и запрет recovery bypass.

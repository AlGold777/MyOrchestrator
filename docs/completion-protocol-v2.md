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

Настройка `responseLifecycleDetectorSettings.completionProtocolV2` принимает `legacy`, `shadow`, `enforced`; migration default — `shadow`. В `shadow` отдельный migration-adapter сохраняет прежнюю доставку только для свежего, стабильного и corroborated candidate без active veto, а CompletionSession параллельно формирует V2 decision/delta. В `enforced` downstream принимает исключительно `SUCCESS_TERMINAL`. Weighted score остаётся только диагностикой и не принимается migration-adapter'ом.

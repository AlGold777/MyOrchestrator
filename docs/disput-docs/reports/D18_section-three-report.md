# D18. Section III — implementation report

> Исторический отчёт. С версии 2.81.25 auditor не назначается автоматически:
> допускаются только `None` и явно выбранная модель, отличная от synthesizer.

Дата: 2026-07-17. Версия: 2.80.222.

## V1 gate

Инструментация завершена, но живые девять registry runs не проведены. Поэтому
`parse-rate` и `reject-rate` остаются **not measured**, registry default не
включается. Причина короткая и внешняя: нужны залогиненные provider tabs и
реальные свободные ответы; mocks не измеряют надёжность extraction. Процедура и
порог находятся в `benchmarks/registry-reliability.md`.

## Статусы

| Task | Status | Реализация |
|---|---|---|
| V1 | repository выполнено; live gate не измерен | `checkpointStats`, parse-fail events, applied/rejected counters и процедура 9-run. |
| V2 | выполнено | Objection, Revision, immutable claim text и append-only status history. |
| V3 | выполнено | RoundDelta checkpoint-local: только изменения после previous checkpoint, нормализация по participant count. |
| V4 | выполнено | Wrapped delta корректно распознаётся; stagnation/early convergence добавляют warning и steelman следующей волне. |
| V5 | выполнено | Stable alias map охватывает participants и service models; variants заменяются по убыванию длины. |
| V6 | выполнено | Triad/Multi causal chain и role scheduling; Multi включает всех критиков; Duel раскрывает self-retest; terminal residual-risk artifacts явны. |
| V7 | выполнено | Risk gate, independent auditor, structured audit context, один correction pass и UI draft/audit panel. |
| V8 | выполнено | ProcessAudit различает protocol skip и provider diagnostic, проверяет plan/critique/roles/minority/productivity/degraded disclosure. |
| V9 | выполнено | Один явно выбранный synthesizer используется в filters и обоих checkpoint путях; auditor также выбирается явно и не может совпадать с synthesizer. |
| V10 | выполнено | Long recommendation использует реальные wrapped deltas, throttled notify и кнопку «Завершить с синтезом» без auto-stop. |

## Исправленные дефекты аудита 2.80.221

- Triad Red Team plan больше не падает с `participants_missing` или
  `artifact_undefined:independent_retest`.
- Runtime и compiler одинаково выбирают R1/R2/R3/R4 участников.
- Multi N-role expansion исключает `participant_never_scheduled`.
- Checkpoint использует тот же synthesizer, что и финальный ответ; RoundDelta
  не считает весь накопленный registry новой волной.
- Provider `PARTICIPANT_ALREADY_TERMINAL` больше не превращает stage в skipped.
- Audit correction хранит original draft; accepted identities не переиспользуют
  attempt другой попытки.

## Ограничения и проверка

Anchor quote остаётся hard gate и это намеренно. Live V1, один V5 A/B и ручной
V6 Triad Red Team acceptance не выполнены: для них нужны реальные provider
sessions. Repository verification: **144/144 suites, 820/820 tests**.

**Проверка decision-register:** конфликтов нет | конфликт с R-2, решение:
audit/retry ограничены и идемпотентны; strict delivery guarantee не заявляется.

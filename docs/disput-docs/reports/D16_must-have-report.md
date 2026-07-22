# D16. Disput Must Have — исполнительский отчёт

> Исторический отчёт. С версии 2.81.25 `auditor:auto` удалён: auditor и
> synthesizer выбираются только явно и оба могут быть `None`. Упоминания ниже
> описывают состояние реализации на дату отчёта, а не текущий контракт.

Дата обновления: 2026-07-19. Версия расширения: 2.81.0. Schema versions:
protocol 4, plan 3, case/profile/map 2, prompt pack 3, run-store 3, trace 2.

## Статус раздела I

| Задача | Статус | Реализация и проверка |
|---|---|---|
| T1 | выполнено | `debate-artifact-definitions.js`; все builtin artifact ids определены и проверяются validator/tests. |
| T2 | выполнено | `debate-contracts.js`, `debate-prompt-compiler.js`, prompt pack 3.0; opening/critique/defence/retest/resolution задаются Stage/Action contracts и outputs. |
| T3 | выполнено | Blind opening invariant подключён к Triad/Multi recovery; Duel A0+B0 остаётся одним parallel batch. |
| T4 | выполнено | Plan compiler выдаёт purpose/contracts/policies, validator проверяет граф и artifacts; PromptCompiler валидирует Task/Stage/Action и runner читает plan failure policy. |
| T5 | выполнено | Единая task-aware `debate-response-acceptance.js` используется участниками, filters, checkpoints, final words, synthesis и strict JSON audit. |
| T6 | выполнено | `DebateRunStore` schema 3 сохраняется локально и гидрируется; durable ledger дополнен prompt executions, StateDelta и human decisions. |
| T7 | выполнено | Caller `stageAttemptId` сохраняется сквозным, pipeline context возвращается без подмены, missing/mismatch отклоняются, accepted ledger переживает reload. |
| T8 | выполнено, вариант A | Manual continuation использует общий approval/waiter; retry создаёт новую попытку, auto остаётся default builtin policy. |
| T9 | выполнено | Шесть обязательных synthesis sections и «Эволюция позиции»; один format repair, затем явный `MISSING_REQUIRED_ARTIFACT`. |
| T10 | выполнено | Pause/resume/cancel/retry/degraded controls подключены для Duel/Triad/Multi и ограничены `safetyPolicy`. |
| T11 | выполнено | ContextBroker резервирует output и выбирает релевантные provenance-aware части; общий `runModelBatch` дополнительно проверяет budget каждого prompt/promptsByModel и сообщает пользователю. |
| T12 | выполнено как инструмент | 12 задач, rubric, процедура и blind collector находятся в `benchmarks/`; фактическая сравнительная серия остаётся live-измерением. |

## Исправления по реальному Triad Red Team run

Ошибки `participants_missing:r1…final` и
`artifact_undefined:independent_retest` относились к compilation/config, а не к
качеству ответа моделей. В 2.80.222 compiler:

- берёт роли из runtime protocol snapshot и разворачивает `stageRoles` в
  фактических участников каждой волны;
- на тот момент разрешал `auditor:auto` в другую модель; этот механизм удалён
  в 2.81.25 как скрытое назначение исполнителя;
- содержит определение `independent_retest`;
- гарантирует, что Multi с N моделями планирует каждого повторяющегося критика;
- производит в Red Team terminal artifacts
  `residual_risk_ranking + red_team_verdict`.

Проверка всех девяти builtin definitions проходит. Ожидаемые semantic warnings
остались только у `Duel Verdict` и `Duel Long`: выбранный в искусственной
проверке synthesizer совпадает с единственным critical; это warning, не ошибка.

## Acceptance / recovery matrix

Собранный транспортный ответ сначала отмечается `accepted:false`. Только после
acceptance и точной correlation-проверки runner/service записывает
`accepted:true`. Retry не публикует partial batch и использует новый attempt.
Synthesis format repair и audit correction имеют отдельные identities; второй
terminal/accepted attempt не может затереть первый после hydrate.

## Проверка

- `node --check` для изменённых runtime-модулей — успешно.
- Все Duel/Triad/Multi Red Team планы компилируются с корректными участниками и
  terminal artifacts.
- Полный Jest после реализации: **152/152 suites, 864/864 tests**.

## Внешняя приёмка

Код раздела I завершён. Ручные пункты T6/T7/T8/T10/T11 и сравнительный T12
требуют живых залогиненных provider tabs и перезагрузки расширения; текущая
среда не может честно заменить эти проверки mocks. Они объединены в live
матрицу в `D19_disput-next-steps.md`, поэтому не выдаются за выполненные реальные прогоны.

**Проверка decision-register:** конфликтов нет | конфликт с R-2, решение:
заявляется идемпотентная at-most-once приёмка, а не exactly-once доставка.

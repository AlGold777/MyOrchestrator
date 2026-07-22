# D17. Section II — implementation report

> Исторический отчёт. Термин `adaptive-stop` ниже заменён в текущей реализации
> на предупреждение о стагнации: оно ничего не завершает самостоятельно.

Дата: 2026-07-17. Версия: 2.80.222.

| Task | Status | Нормативное подтверждение |
|---|---|---|
| U1 | выполнено | `DebateContextAssembly` подключён к participant, final synthesis и synthesis audit; omitted parts трассируются. |
| U2 | выполнено | Technical status отделён от `epistemicOutcome`, поле сохраняется и показывается projection/UI. |
| U3 | выполнено | Dropout revalidation использует роли плана по model identity; degraded mode сохраняется и раскрывается синтезу. |
| U4 | выполнено | ProblemSpec извлекается один раз, хранится и входит в opening/synthesis context; `other` имеет безопасный requiredOutput fallback. |
| U5 | выполнено | Validator проверяет participants, producers, contracts, policies и независимость retest по participant wave, а не service filter. |
| U6 | выполнено | Dispatch registry и logical accepted ledger durable; collected-but-unaccepted response не занимает ledger. |
| U7 | выполнено | FinalPosition delta обязателен в Duel/Triad final words и Multi resolution; один repair. |
| U8 | выполнено | Conformance scenarios покрывают retry, partial, reload, terminal, degraded и manual approval. |
| U9 | выполнено в заданной границе | Protocol/planning/orchestration/state/projection границы закреплены; UI читает projection. Универсальный StageExecutor остаётся отдельной архитектурной миграцией. |
| U10 | выполнено | Version manifest штампует implementation/protocol/plan/run/trace; newer snapshot отклоняется, older мигрирует. |

## Разведка и расхождения

- UI view-model читает готовые `status`, `currentStageId`, `approval`,
  `degradedMode`, `epistemicOutcome`, stagnation-warning и audit fields; topology
  decisions остаются в protocol/planning/orchestration.
- Runners всё ещё исполняют topology-specific sequence. Они синхронизированы с
  plan participants/policy, но не заменены одним executor: это осознанная
  граница U9, отражённая в `../D2_disput-architecture.md` и `D19_disput-next-steps.md`.
- Все девять builtin definitions валидны. Единственные warnings в искусственной
  матрице — `synthesizer_not_independent` для Duel Verdict/Long при выборе
  единственного critical как synth; Red Team retest warnings отсутствуют.

## Проверка

Полный Jest: **144/144 suites, 820/820 tests**. Live reload/manual/provider
acceptance не заменена unit-тестами и находится в единой внешней матрице.

**Проверка decision-register:** конфликтов нет | конфликт с R-2, решение:
durable ledger обеспечивает идемпотентную приёмку без обещания exactly-once.

# D11. Раунды встроенных Disput pipelines

> Актуально для 2.80.222. Это единственный нормативный владелец fixed round plans.

Раунд — исполняемая волна участников, после которой отдельная service-stage
строит filter-artifacts. Число моделей не является доказательством; сильные
позиции меньшинства и нерешённые вопросы сохраняются до финального синтеза.

## Канонические планы

| Pipeline | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| Duel Verdict | `positions_map` | `claim_ledger` + `challenge_map` | `resolution_map` + `final_verdict` | — |
| Duel Red Team | `attack_surface_map` | `evidence_gaps` + `hidden_assumptions` | `counterexamples` + `failure_modes` | `self_retest` + `red_team_verdict` |
| Triad Verdict | `positions_map` | `cross_review_matrix` + `claim_ledger` | `arbiter_synthesis` + `final_verdict` | — |
| Triad Red Team | `proposal` + `attack_surface_map` | `counterexamples` + `failure_modes` | `patch_map` | `independent_retest` + `retest_report` |
| Multi Verdict | `positions_cluster_map` | `claim_ledger` + `evidence_weighting` | `outlier_review` + `conflict_resolution` | `weighted_synthesis` + `final_verdict` |
| Multi Red Team | `proposal` + `attack_surface_map` | `counterexamples` + `failure_modes` | `patch_map` | `independent_retest` + `retest_report` |

Long-пресеты не имеют фиксированного round plan. Их фаза выводится по номеру
волны, а checkpoint policy даёт модератору рекомендацию завершить обсуждение;
автоматической остановки нет.

## Red Team causal chain

Triad Red Team назначает роли по стадиям:

- R1: один `meta`-proposer и два `critical`-attacker в blind batch;
- R2: оба критика атакуют proposal;
- R3: proposer отвечает patch map;
- R4: второй критик выполняет independent retest и не является proposer.

Multi использует ту же цепочку, но включает каждого участника с повторяющейся
ролью `critical`: все критики участвуют в R1/R2 и выполняют cross-retest в R4.
Роли циклически продолжаются на N участников, поэтому ни одна выбранная модель
не остаётся вне execution plan.

Duel не имеет третьего независимого проверяющего. Его R4 честно называется
`self_retest`; финальный prompt обязан раскрыть это ограничение как остаточный
риск.

## Terminal stages

После последнего R-раунда:

- Duel и Triad получают `final:words` всех исходных участников, кроме явно
  выбывших по управляемой dropout-политике;
- все topology выполняют отдельный `final:synthesis` только при явно выбранном
  Synthesizer; иначе завершаются предыдущей содержательной стадией;
- Verdict-синтез производит `final:verdict`;
- Red Team-синтез производит `final:residual_risk_ranking` и
  `final:red_team_verdict`;
- для factual/red-team/decision и `evidenceMode=required` после синтеза идёт
  независимый `final:audit`; при issues выполняется не более одной коррекции.

## Runtime contract

`protocol.roundPlan.length` задаёт fixed round count. Compiler разворачивает
`stageRoles` в фактических участников, создаёт filter-stage каждого раунда и
валидирует всех producers/consumers до открытия вкладок. Выбранный
`synthesizer` исполняет filters/checkpoints и финальный synthesis. Auditor
попадает в отдельный audit-stage только при явном выборе. Значения `Auto` для
обеих служебных моделей отсутствуют; старый литерал `auto` мигрирует в `None`.

Filter failure останавливает run (`fail_run`). Participant, final-word и
synthesis failures используют `ask_user`: повторить стадию, продолжить в явно
degraded mode либо остановить. Audit допускает `skip_stage` только с
зафиксированной причиной.

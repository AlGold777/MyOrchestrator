# D9. Triad protocol

## Назначение

Triad — фиксированная topology ровно трёх моделей. Она добавляет третью независимую линию и позволяет разделить proposal, critique/retest и synthesis, но synthesizer не получает права переписывать историю дела.

## Вход

- минимум три выбранные модели; runtime берёт первые три;
- один synthesizer фиксируется в plan и выполняет filters, checkpoints и
  финальный synthesis; независимый auditor появляется только для отдельного
  audit-stage;
- preset задаёт wave count, roles/stageRoles, outputs, run policy, checkpoint и finalization;
- тема, TaskContract, word limit и attachments фиксируются до dispatch.

## Алгоритм волны

1. Init wave отправляет трём моделям разные blind opening prompts одним batch.
2. Для каждого следующего раунда `stageRoles` выбирает нужных участников; если ролей нет, участвуют все трое.
3. PromptCompiler собирает operation из round outputs: opening, critique, response, verification или final position.
4. Barrier ждёт accepted result каждого участника волны. Failure policy решает retry, продолжение degraded или stop.
5. Выбранный synthesizer получает turns и краткое состояние registry,
   возвращает строгий delta для checkpoint. Невалидное извлечение не меняет
   state и не останавливает основную дискуссию.
6. Принятый delta обновляет case, round delta и карту. Общий checkpoint запускает shadow rules и progress trace.
7. Optional round filter создаёт только объявленные artifacts и передаётся следующей волне как состояние, а не как новая тема.
8. В Auto следующий этап запускается после barrier. В Manual состояние ждёт явного продолжения.

## Финал

После последней волны все оставшиеся участники дают final words. Если явно
выбран Synthesizer, он получает карту, round filters, final words, dissent и
limitations. При `None` Triad завершается final words без синтеза. Audit
выполняет только явно выбранный Auditor, отличный от Synthesizer; скрытого
назначения участника нет. Audit может инициировать один repair подтверждённых
проблем. Затем пишутся terminal event, epistemic outcome и snapshot.

## Registry и контекст

Registry является рабочим extraction-слоем; DebateCase остаётся долговременной памятью. Контекст выбирается по relevance/trust и отделяется как untrusted. Full history не прикладывается автоматически. Lazy full context может быть запрошен checkpoint, но не участником через текстовую инструкцию.

## Red Team

Triad Red Team использует causal chain proposal → attack surface/evidence gaps → patch → independent retest → verdict. Для independent retest stage-role routing предпочитает критика, не являющегося автором patch. Если это невозможно, degraded reason сохраняется в audit.

## Инварианты

- Init positions blind и получены до раскрытия чужих ответов.
- Ровно три participant slots; service role не становится четвёртым голосом.
- Barrier открывается и закрывается по стабильным IDs.
- Checkpoint failure degrade-safe и не создаёт фиктивные artifacts.
- Synthesizer не закрывает blockers прямым текстом.
- Dissent и outliers сохраняются в final context.
- Shadow rules журналируются, но не меняют wave order.
- Terminal flow выполняется один раз.

## Проверка

Основные тесты: `triad-runner`, `triad-runtime`, `triad-massage`, `triad-registry`, `triad-full-run`, prompts-by-model, round plans, process audit и conformance scenarios. Живая приёмка включает три вкладки, barrier, checkpoint parse failure, participant dropout, final words, audit и карту.

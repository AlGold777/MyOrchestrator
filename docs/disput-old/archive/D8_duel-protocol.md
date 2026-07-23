# D8. Duel protocol

## Назначение

Duel — фиксированная topology двух участников A и B. Она нужна для адресного столкновения двух линий рассуждения, а не для голосования. Порядок задаёт immutable `DebateExecutionPlan`; профильные правила работают только в shadow mode.

## Вход

- ровно две выбранные модели;
- первая модель A определяется receiver при старте, вторая становится B;
- тема берётся из сообщения человека, а не из имени preset;
- роли, run policy, round plan, word limit, synthesizer и checkpoint policy фиксируются до первого dispatch;
- вкладки, attachments и provider fallback являются transport policy, а не частью логики Duel.

## Алгоритм

1. Runtime создаёт TaskContract и состояние двух slots.
2. A0 и B0 отправляются одним batch с разными prompts. Оба являются blind openings и не содержат позицию соперника.
3. После barrier ответы проходят acceptance и получают устойчивые turn/attempt IDs.
4. Публичные ходы чередуются A → B → A. Каждый prompt получает последнюю релевантную позицию соперника, состояние реестра, round filter и текущую операцию плана.
5. После заданного числа public turns shared checkpoint извлекает StateDelta, обновляет registry/case и запускает shadow rule evaluation.
6. В Manual следующий ход ждёт approval; в Auto маршрутизация продолжается автоматически. Смена DOM control во время run не меняет frozen policy.
7. После лимита или явной финализации оба участника дают final words.
8. Выбранный synthesizer выполняет промежуточные checkpoint/filter и собирает
   итог. Если задача factual/red-team/decision или audit обязателен профилем,
   независимый auditor проверяет synthesis; допускается один ограниченный
   repair.
9. Terminal event, epistemic outcome, финальный case snapshot и exports фиксируются один раз.

## Long

`DUEL_LONG` не имеет автоматического round terminal и принадлежит модератору. Checkpoint выполняется через объявленный интервал public turns. Предупреждение о стагнации и shadow STAGNATION могут только рекомендовать завершение; сами не меняют fixed flow.

## Dropout и recovery

Failure policy берётся из stage plan: retry/skip/fail/ask user. При продолжении с одним участником run помечается degraded, независимая проверка не симулируется. Correlation guard не принимает поздний ответ другого run/stage/attempt. Повторный accepted final для того же stage+participant отклоняется ledger.

## State и UI

FSM владеет slots, фазой, turn counters и routed IDs. RunStore владеет lifecycle и events. DebateCase владеет содержательными артефактами. Лента, selectors, кнопки, карта Structure/Graf/History и экспорт являются проекциями. Sender/receiver не вычисляют очередность сами.

## Инварианты

- A0 и B0 независимы.
- Один public turn имеет одного адресата и один accepted attempt.
- Round limit берётся из compiled plan.
- Consensus двух моделей не закрывает objection без evidence/decision.
- Self-retest в Duel всегда помечается как self, а не independent.
- Shadow rule и ModelSignal не управляют ходом.
- Reserved finalization budget не расходуется на очередной public turn.
- Cancel/error не стирают последнее подтверждённое дело.

## Проверка

Основные тесты: `duel-runner`, `debate-runtime`, `debate-round-plan-runtime`, `debate-conformance-scenarios`, `finalization-evidence`, `debate-process-audit`, correlation и duplicate-final suites. Живая приёмка проверяет blind openings, Auto/Manual, вкладки, dropout, final words, synthesis и сохранённую карту.

# D10. Multi protocol

## Назначение

Multi — фиксированная групповая topology для двух и более выбранных моделей. Она нужна, когда одна и та же стадия должна собрать несколько параллельных вкладов, сравнить outliers и выполнить заданный round plan. Это не FreeTalk: число волн и порядок операций фиксированы до запуска.

## Вход

- не менее двух моделей, верхний предел определяется доступными providers/UI;
- необязательный synthesizer; при `None` filters и checkpoints продолжают
  обновлять карту состояния, а финальный synthesis не создаётся;
- wave limit, roles, stageRoles, outputs и run policy фиксируются в execution
  plan;
- TaskContract, word limit, attachments и context policy едины для run.

## Алгоритм

1. Wave 1 собирает blind positions выбранной группы.
2. Для каждой следующей wave runtime читает объявленные outputs и stageRoles. Если role filter отсутствует, участвуют все активные модели.
3. Все prompts wave отправляются одним batch через `promptsByModel`; каждый имеет общий stage ID и отдельный participant/attempt.
4. Barrier принимает только прошедшие acceptance ответы. Dropout policy может retry, продолжить сокращённым составом с degraded marker либо остановить run.
5. Shared checkpoint/round filter обновляет registry и DebateCase, после чего выполняются shadow rules и progress trace.
6. Следующая wave получает релевантный state, последние turns и filters. Полный transcript не является default context.
7. После последней wave выбранный synthesizer создаёт итог только при явном
   выборе модели. При `None` run завершается ответами, картой, outcome и
   snapshot без искусственного итогового текста.
8. Если synthesis создан, он проходит acceptance, необязательный независимый
   audit и не более одного repair. Auditor также выбирается явно и никогда не
   выводится из значения `Auto`.

## Role routing

`stageRoles` задаёт требуемые lenses, а не жёсткое provider ownership. Runtime сначала выбирает модели с совпадающей ролью, затем заполняет недостающие slots оставшимися. На independent retest приоритет получает критик, отличный от автора. Оставшиеся модели с требуемой ролью также могут участвовать; одна модель не дублируется внутри wave.

## Отличие от FreeTalk

| Multi | FreeTalk |
|---|---|
| фиксированный wave plan | следующая операция выбирается rule engine |
| terminal после wave limit | terminal по readiness, budget, progress или решению |
| роли назначаются stage plan | роли назначаются ActionContract и capabilities |
| shadow rules | control rules |

## Инварианты

- Минимум две активные модели на старте.
- Wave count берётся из frozen plan и ограничен безопасным диапазоном.
- `promptsByModel` сохраняет blind/relevant различия между участниками.
- Один участник имеет один accepted result на stage.
- Outlier не удаляется большинством голосов.
- Synthesizer и auditor необязательны; при выборе auditor должен отличаться от
  synthesizer.
- Shadow rule не меняет состав или порядок wave.
- Сокращение состава всегда видно как degraded execution.

## Проверка

Основные тесты: `multi-runner`, `multi-runtime`, `pipeline-presets`, prompts-by-model, round-plan runtime, dropout, process audit, finalization и conformance scenarios. Живая приёмка проверяет 2/3/4+ модели, stage-role routing, participant loss, завершение с synthesis и без него, а также карту.

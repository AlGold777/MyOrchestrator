# D4. Pipeline profiles and FreeTalk

Этот документ — нормативный контракт профилей pipeline, общего дела, карты
состояния и FreeTalk. Duel, Triad и Multi сохраняют собственные поведенческие
спецификации до завершения их миграции на единый исполнитель профиля.

## Зачем нужны профили

Профиль описывает не конкретный набор моделей, а способ организации работы:
какие роли нужны, какие элементы могут появиться в деле, какие проверки
обязательны, когда создаётся следующая задача и при каких условиях допустим
итог. Поэтому тематический pipeline добавляется конфигурацией поверх общего
механизма, а не копированием нового runtime.

Паспорт профиля schema `3` содержит `id`, semantic `version`, `status`, совместимый
`engineRange`, `promptPack`, `taskTypes`, родительский профиль, роли, стадии,
rule instances, progress policy и policies. Rule instance задаёт trigger,
parameters, action, priority, cost, cooldown, execution ceiling и mode.
Назначение моделей ролям является параметром запуска и не
меняет профиль. Сохранённый pipeline хранит точную ссылку `profileId + version`.

## Общее дело

`DebateCase` schema `2` — каноническая память работы. В нём находятся
`TaskContract`, ProblemSpec, участники, профиль, исходные события, принятые
действия, артефакты, решения человека, технический статус, смысловой исход,
append-only изменения и детерминированные снимки. Claim, Objection, Evidence,
EvidenceGap, Assumption, Contradiction, OpenQuestion, DecisionCriterion,
Revision, AxisVerdict, Dissent, SynthesisConclusion, Audit и HumanDecision
имеют устойчивые ID, revision, confidence и provenance. Revision добавляет
новую версию позиции, не переписывая claim задним числом; merge и supersede
сохраняют историю исходных элементов.

Каждое исходное событие получает устойчивый `turnId` и sequence. Извлечённый
`StateDelta` обязан сослаться на существующее событие и привести цитату,
реально присутствующую в нём. Затем проверяются confidence, ссылочная
целостность, ожидаемые sequence/revision и correlation ID. Stale, duplicate,
низкоуверенные и сиротские изменения не меняют дело, но фиксируются в trace как
rejected delta. Карта состояния schema `3` является чистой проекцией этого
дела, восстанавливается повторным проигрыванием журнала и не вызывает LLM.

## FreeTalk MVP

FreeTalk не имеет фиксированного числа моделей и раундов. При первом выборе
pipeline UI предлагает одну доступную модель; пользователь может добавить
остальные без верхнего лимита. Для запуска обсуждения после выбора должно быть
минимум одну модель. Ограничителями служат полезная незавершённая работа,
ресурсный бюджет, решение человека и terminal condition. Верхнего предела в
профиле нет.

Порядок работы:

1. Все участники параллельно дают blind исходные позиции.
2. Checkpoint превращает принятые ответы в изменения дела.
3. Только разрешённые активным профилем детерминированные триггеры создают
   очередь конкретных `ActionContract`.
4. Явно выбранный Synthesizer выполняет все synthesis-related service stages:
   round filter, registry checkpoint и финальный synthesis. Отдельного
   extractor нет. Auditor выбирается человеком отдельно и только для
   SynthesisAudit; он не равен Synthesizer. Runtime не назначает Auditor из
   состава участников.
5. Prompt compiler собирает задачу, действие и минимальный provenance-aware
   контекст. Ответ проходит acceptance, extraction и `StateDelta` validation;
   только после этого обновляются дело и карта.
6. Цикл повторяется до readiness, stagnation, budget, manual stop или ручного
   запроса synthesis.
7. При выбранном Synthesizer финальный синтез получает защищённый контекст
   claims, blockers, dissent и axes. При `None` synthesis-stage отсутствует.

## Единый synthesizer

В верхней панели pipeline находится один список `Synthesizer`. Он выбирает
одну модель для всех трёх задач: промежуточной фильтрации, checkpoint/state
extraction и финального ответа. Список содержит `None` и конкретные модели;
варианта `Auto` нет. Пустое значение не преобразуется в первую модель и не
блокирует запуск. Фиксированные topology завершаются final words или последней
волной без synthesis. FreeTalk MVP без Synthesizer завершается после стартовых
позиций, поскольку текущий checkpoint ещё исполняется этой служебной моделью.
Выбор сохраняется в `protocol.synthesizer` и отображается в финальном блоке
канвы. Старые `triadSynthesizer`, `multiSynthesizer` и
`serviceRoles.extractor` читаются только при миграции сохранённых pipeline и
сводятся к одному значению.

Правила покрывают непроверенный claim, blocking objection, спор о факте,
слабое evidence, перепроверку revision, contradiction, dissent, repetition,
context pressure, stagnation, readiness и synthesis audit. Задачи имеют reason,
priority, cost, cooldown, dedup key, режим `automatic`/`ask-human`/`human-only`
и failure policy. Профиль задаёт полный набор rule instances: наличие trigger в общем
каталоге само по себе не разрешает его запуск. Предел параллельности, execution ceiling,
semantic repetition guard и оценка полезности не позволяют оркестрации
самовоспроизводиться.

TechnicalStatus сообщает, работает ли механизм. EpistemicOutcome сообщает,
что известно по задаче: `resolved`, `partial`, `inconclusive`, `stagnation`,
`budget_limited` или `manual`. Ошибка выполнения не стирает последнее дело и
карту.

## UI и расширение

`Specialized profile` является точкой выбора, а не псевдонимом FreeTalk:
при выборе открывается редактор профилей, а команда **Применить** сохраняет
`profileId + profileVersion` в активном pipeline. Выбор строки в редакторе без
команды **Применить** конфигурацию запуска не меняет.

Профиль `Research` объявляет обязательный инструмент `web_research`. До
открытия вкладок runtime проверяет выбранные модели и блокирует запуск, если ни
одна из них не имеет явно объявленной или документированной research-
возможности. Движок не выдаёт обычное обсуждение за исследование.

Сворачиваемая карта расположена под сохранёнными pipelines. Structure даёт
рабочий реестр и приоритеты; Graf показывает реальные связи. Выбор run,
снимка, A–B comparison, фильтр, поиск и выбранный элемент используют одну
проекцию. Drawer показывает историю, provenance, confidence/revision,
merge/supersede, связи и действия человека. Страница History показывает rule
trace, progress window, межзапусковую полезность и shadow ModelSignal. Human
action или развилка оркестрации создаёт типизированный `DecisionRequest`; UI не
редактирует проекцию напрямую.

Расширение профиля может объявить новые artifact types, роли, оси, triggers,
tools и секции карты через `extensionContract`. Оно не может отключить
provenance, сохранение dissent, карту при terminal path, проверку ссылок,
acceptance или право человека остановить запуск. `DEEP_RESEARCH_ALPHA` служит
первой проверкой этого контракта и не требует отдельного базового runtime.

## Выпуск и совместимость

`stateMapReadOnly`, `liveStateMap`, `pipelineProfiles`, `triggers` и
`freeTalkMvp` отключаются независимо. Журнал изменения flags хранит только
время, имя и boolean — без prompt, answer и содержимого дела. Форматы дела,
профиля, Task/Stage/Action contracts, StateDelta, prompt pack, карты и run state
имеют отдельные версии. Profile schema `3` мигрирует старые ссылки на
актуальный prompt pack, а несовместимая версия отклоняется до dispatch. Старые
Duel/Triad/Multi runners остаются compatibility layer до отдельной миграции и
живого сравнения при одинаковом бюджете.

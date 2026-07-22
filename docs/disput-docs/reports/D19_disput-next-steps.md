# D19. Открытые задачи Disput

Здесь находится только работа, которая действительно не завершена. Реализованный
пункт удаляется, а фактическое изменение получает запись в
[`docs/CHANGELOG.md`](../../CHANGELOG.md).

## 0. Универсальный движок «Обсуждение темы»

Концепция, критический разбор, этапы и acceptance criteria вынесены в
[D20_universal-topic-discussion-engine.md](D20_universal-topic-discussion-engine.md).
До прохождения этапов 0–8 существующие FreeTalk, Research и Specialized profile
не мигрируются и не меняют поведение.

## 1. Живая калибровка rule intelligence

1. Провести одинаковые factual, analysis, decision и red-team задачи в Duel, Triad, Multi и FreeTalk.
2. Для каждого правила собрать false-positive/false-negative review, а не только fire rate.
3. Калибровать `priority`, `cost`, `cooldown`, `maxExecutions`, progress window и decision defaults на этих данных.
4. Только после review переводить отдельное правило fixed topology из shadow в control; массовое включение запрещено.

## 2. ModelSignal experiment gate

1. Сравнить signal с фактическим StateDelta на фиксированном корпусе.
2. Измерить parse rate, calibration и долю противоречий карте.
3. До прохождения gate сохранять `modelSignals: shadow`; signals не должны становиться triggers или artifacts.

## 3. Универсальный StageExecutor

1. Duel, Triad и Multi остаются совместимыми topology runners поверх общего plan/checkpoint.
2. Мигрировать по одному stage kind с trace equivalence и одинаковыми fixtures.
3. После каждого шага сравнить plan vs actual, terminal outcome, prompts, artifacts и recovery.
4. Удалять compatibility branch только после живого parity run. Это не блокирует текущий FreeTalk.

## 4. External acceptance

1. Проверить расширение после reload в реальных вкладках всех доступных providers.
2. Проверить touchpad scroll, collapse/outside-click, Structure/Graf/History и drawer.
3. Провести interruption matrix: cancel, pause/resume, service dropout, participant dropout, reload и stale response.
4. Записать факты FreeTalk сравнений в D13 без prompt/answer content.

## 5. Prompt calibration

1. Завершить живые задачи Z3–Z5 из D15.
2. Сравнить короткие prompts и `disput-core@3.0.0` по выполнению задачи, а не по стилю ответа.
3. Проверить service budgets checkpoint/filter/audit и repair rate.

## Не являются открытой задачей

DecisionRequest, profile rule instances, FreeTalk control rules, fixed-topology shadow rules, progress fallback, rule history, History UI, shadow ModelSignal, canonical DebateCase/StateDelta и нумерация документации реализованы в 2.81.01.

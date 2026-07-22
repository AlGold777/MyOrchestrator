# Technical Specification v1.0
# Legacy Runners Hardening — Disput

Источники: Claude review (подтверждённые пункты), GPT verification, Qwen (AbortError). Только код-дефекты активного production path. Не входит: universal wiring, transport liveness, audit product decision — отдельные work items.

## 1. FreeTalk: fallback synthesizer / завершение без синтеза

Файл: `disput/free-talk-runner.js`.

Дефект: `synthesizer` — константа из input; после dropout не переназначается. Терминальный отказ синтезатора → `throw` → run FAILED, terminal outputs не выдаются.

Требования:
1. Перед synthesis-стадией: если `synthesizer` входит в `state.droppedModels` или отсутствует в актуальном `models` — выбрать альтернативу из живых моделей (исключая droppedModels).
2. Переназначение фиксируется событием `SYNTHESIZER_REASSIGNED { from, to }` и уведомлением пользователю.
3. Если живых моделей нет ИЛИ synthesis (включая repair-попытку) не дал usable text — НЕ бросать исключение. Выполнить существующий путь завершения без синтеза (ветка `synthesizer_none`): `COMPLETED`, `finalization.synthesis = false`, `epistemicOutcome = 'inconclusive'`, `handleTerminalOutputs`, `finalizeRuntime`. Причина: `synthesis_unavailable`.
4. `throw new Error('FreeTalk final synthesis produced no usable response')` — удалить.

## 2. FreeTalk: терминальный mid-run dropout

Файл: `disput/free-talk-runner.js`, action-цикл.

Дефект: `actionResult.failed` не читается; терминально мёртвая модель остаётся в `models` и получает назначения каждый tick.

Требования:
1. После каждого action-batch: модели из `actionResult.failed` (и только они) переносятся в `state.droppedModels` и исключаются из `models`.
2. Acceptance failure / пустой нетерминальный ответ НЕ приводит к исключению участника — только `settleTask('failed')`, как сейчас.
3. События: `BARRIER_PARTICIPANT_FAILED` + `DROPOUT_CONTINUE_SELECTED` (или policy-ветка, как в opening). Уведомление пользователю.
4. Если после исключения `models` пуст — завершение по п.1.3 (без синтеза), не exception.

## 3. FreeTalk: убрать рекурсивный full-run retry

Файл: `disput/free-talk-runner.js:211`.

Дефект: `if (decision === 'retry') return runner.start(input)` — повторная инициализация всего run изнутри действующего `start()` (дублирование aggregate init, opening, внешних запросов).

Требования:
1. Retry-решение повторяет ТОЛЬКО opening-batch (re-dispatch тем же составом моделей), не весь `start()`.
2. Максимум 1 retry; повторный отказ → штатная dropout-политика (continue degraded / stop).
3. Никаких повторных `transition(state, 'RUNNING')` / `appendModerator` / `setRunPresentation`.

## 4. Все legacy runners: AbortError semantics

Файлы: `disput/duel-runner.js` (минимум :417, :531), `disput/triad-runner.js`, `disput/multi-runner.js`, `disput/free-talk-runner.js`.

Дефект: отмена (`AbortError`) в catch-блоках обрабатывается как отказ участника → auto-retry / dropout-flow / degraded continuation после отмены пользователем.

Требования:
1. В каждом catch-блоке runners первой строкой: `if (error?.name === 'AbortError' || input.signal?.aborted) throw error;`
2. AbortError никогда не приводит к: retry, dropout decision, degraded continuation, записи `BARRIER_PARTICIPANT_FAILED`.
3. Инвентаризация: перечислить в отчёте каждый catch-блок каждого runner'а с вердиктом (guard добавлен / уже был / не нужен — с причиной).

## 5. Round-limit control: селектор обёртки

Файлы: `results.js` (`syncDebateSchemeUi`), `pipeline_panel.html`, `result_new.html`.

Дефект: код ищет `closest('.debate-select-wrap')`; фактические обёртки — `.debate-round-control` (pipeline_panel.html:260) и `.debate-turn-limit` (result_new.html:971). Промах на обеих страницах, fallback на сам `<select>` маскирует ошибку.

Требования:
1. Добавить `data-debate-round-limit-control` на обе обёртки в обоих HTML.
2. `results.js`: `closest('[data-debate-round-limit-control]')`, без CSS-классов. Fallback на select сохранить.
3. Проверить остальные `closest('.debate-select-wrap')` в Disput-зоне на тот же промах; исправления — тем же способом.

## 6. Recovered legacy run: honest non-resumable

Файл: `results.js` (recovery block ~:4759, `updateDebateButtonsUi`, run-toggle handler).

Дефект: после reload recovery восстанавливает только отображение; continuation (closures) уничтожен для всех topology. UI показывает Resume, который не может сработать. Противоречие флагов: `pipelineRunActive = false` + `debatePaused = true` + TECHNICAL_PAUSE.

Требования:
1. Recovered run помечается `nonResumable: true` (в `activePipelineRunContext` уже есть `recovered: true` — использовать).
2. Нажатие Resume/Run для recovered run: НЕ снимать pause, показать уведомление «Run восстановлен после перезагрузки и не может быть продолжен. Экспортируйте результаты или начните новый run», предложить экспорт (существующий export path).
3. Кнопка отображает состояние «Recovered» (title), не «Resume debate».
4. Никакого нового UI не добавлять — существующая кнопка + существующее уведомление + существующий экспорт.

## 7. Тесты (обязательные)

1. `tests/free-talk-synthesizer-fallback.test.js`: synthesizer в droppedModels → переназначение + событие; все мертвы → COMPLETED без синтеза, terminal outputs вызваны; usable synthesis после переназначения попадает в verdict.
2. `tests/free-talk-dropout.test.js` (расширить): mid-run terminal failure → модель исключена из последующих batch; acceptance-failure → НЕ исключена; retry → один re-dispatch opening, не полный restart (нет второго `FREE_TALK_POSITIONS_STARTED` от повторной инициализации, aggregate init один раз).
3. `tests/legacy-abort-semantics.test.js`: для каждого runner'а — AbortError из runModelBatch пробрасывается наружу, dropout-события не записываются, retry не выполняется.
4. `tests/results-debate-favorites.test.js` или новый: recovered run → toggle click не снимает pause, уведомление показано.
5. Селектор: unit-тест, что `[data-debate-round-limit-control]` присутствует в обоих HTML и находится из `syncDebateSchemeUi`.

## 8. Regression

Полный прогон `npx jest --config tests/jest.config.js` — все существующие suites зелёные. Legacy поведение вне перечисленных дефектов не меняется. Universal path не трогается.

## 9. Acceptance Criteria

1. Терминальный отказ синтезатора FreeTalk не приводит к FAILED run — завершение с/без синтеза, terminal outputs выданы.
2. Мёртвая модель не получает назначений после первого терминального отказа.
3. Retry opening не реинициализирует run.
4. Отмена пользователем не порождает retry/dropout ни в одном runner.
5. Round-limit wrapper скрывается/показывается корректно на обеих страницах.
6. Recovered run не предлагает ложный Resume.
7. Все новые и существующие тесты проходят.

## 10. Mandatory Report

По каждому пункту 1–6: DONE/PARTIAL/BLOCKED, изменённые файлы, добавленные тесты, инвентаризация catch-блоков (п.4.3), прогон.

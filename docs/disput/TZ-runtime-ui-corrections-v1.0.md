# Disput runtime и UI corrections — контракт v1.0

**Дата:** 2026-07-24  
**Статус:** implemented in 2.81.53; требуется ручная browser smoke-проверка после Reload extension.

Документ фиксирует поведение, добавленное после теста Universal: повторное
использование вкладок моделей между раундами, упрощённое добавление
промежуточного synthesis, ручное подтверждение ответов, ручной старт без
preset, очистка persisted UI/session state и локальные меры снижения нагрузки.

## 1. Раунды и вкладки моделей

- `New Pages` применяется только к первой отправке pipeline-run.
- После успешного открытия новых страниц флажок автоматически выключается.
- Все последующие model stages и промежуточный synthesis используют уже
  открытые страницы моделей.

Реализация: `results.js` (`activePipelineRunContext.forceNewTabs`,
`newPagesDispatched`, `resetNewPagesCheckboxAfterOpen`).

## 2. Промежуточный synthesis

Одинарный клик по `.pipeline-stage-insert` ничего не добавляет и не открывает
меню. Двойной клик переключает промежуточный synthesis после соответствующего
stage. Включение меняет только визуальное состояние кнопки
(`.has-intermediate-synthesis`), а под капотом создаёт/удаляет в DraftPlan один
`working_synthesis` stage с id `planned-working-synthesis-after-*`.

Participant промежуточного stage всегда равен выбранному финальному
synthesizer; отдельный выбор модели удалён. При paused revision используется
тот же revision-command path, что и для остальных Canvas-изменений.

Реализация: `results.js`, `styles/pipeline.css`, `disput/debate-draft-plan.js`.

## 3. Подтверждение ответа

Чекбокс утверждения ответа отображается и принимается только при `Manual` (Auto
выключен). В Auto новые чекбоксы не рендерятся, существующие pending-карточки
очищают control при смене режима, а delegated change и программный approve
отклоняются защитным guard.

Реализация: `isDebateApprovalAutoMode`, `buildApprovalCheckboxHtml`,
`syncDebateApprovalControls`, `approveDebateCard` в `results.js`.

## 4. Ручной запуск без preset

При старте расширения активный preset пуст. All models остаётся выбранным по
умолчанию, но Universal не активируется скрыто. В Manual moderator может сразу
отправить сообщение всем выбранным моделям или одной модели; путь использует
тот же batch/response lifecycle.

Реализация: `results.js`, `pipeline_panel.html`,
`startManualModeratorDispatch`.

## 5. Очистка после reload

При browser reload и runtime reset расширения удаляются сохранённый выбор
моделей для основной страницы и Disput, cross-view UI snapshot и selector
state, DebateEngine/Disput transcript persistence, а также local и sync
snapshots старых пользовательских сессий. UI возвращается к Moderator → All
models без восстановленного preset/model selection.

Каноническое semantic recovery Orchestrator не относится к этому UI reset и
сохраняет отдельный runtime case, если запущен durable recovery flow.

Реализация: `results.js` (`runtimeReset`, `loadSessions`,
`loadDebateTranscriptFromStorage`, `restoreDebateSelectorState`).

## 6. Производительность

- full cross-view persistence при вводе заменена debounce-очередью;
- resize UI coalesced через `requestAnimationFrame`;
- intermediate synthesis больше не вызывает удаления/пересоздания Canvas DOM
  колонок и connector-ов;
- lease heartbeat предотвращает ложную остановку активного run.

Это не заменяет ручной Performance/Memory profile в Chrome. После Reload
extension нужно проверить три pipeline-раунда, повторный dispatch и
переключение Manual/Auto на реальном профиле.

## 7. Верхняя панель

`.top-control-bar` сохраняет одну flex-строку на главной странице и Disput.
`.top-bar-left` и `.top-bar-right` не переносятся, а `.top-models-bar` занимает
оставшееся место и при узком viewport прокручивается горизонтально. Media-query
не переводит model buttons на отдельную строку.

Реализация: `styles/app-controls.css`, `styles/results-debate.css`.

## 8. Append-only лента и компактные ответы

Финальный ответ каждого model request является отдельной карточкой. Карточка
привязана к `requestId`; terminal response переводит её в `turnClosed=true`.
Следующий раунд той же модели создаёт новую карточку и не может обновить закрытую.
Ограничения на количество завершённых карточек сессии нет; streaming updates
одного request продолжают схлопываться внутри его текущей карточки.

Для обычных participant stages, working synthesis и final synthesis действует
один конечный лимит из `debate-length-select` (по умолчанию 300 слов). Вариант
без лимита удалён. Prompt pack v3.1 добавляет маркированную инструкцию
`[DISPUT_RESPONSE_LIMIT]` с приоритетом ясной концепции и ключевых идей.
Transport boundary повторно добавляет инструкцию, если custom/legacy compiler её
пропустил; response acceptance отклоняет превышение и запрашивает сокращённый
repair response.

Реализация: `results.js`, `disput/debate-prompt-pack.js`,
`disput/debate-profile-schema.js`, `pipeline_panel.html`.

## 9. Карточки ответа

- Double-click по `.debate-model-card-header` открывает карточку как viewport
  overlay почти на всё окно (`inset: 16px`), с прокруткой только тела ответа.
- Иконка Branch удалена из `.debate-model-card-meta` и из delegated event path.
- `LLM_FINAL_RESPONSE` явно завершает карточку; `.debate-model-card-printing`
  удаляется даже если финальное событие пришло без нового текста. Это устраняет
  зависший статус `[Perplexity] printing`.

Реализация: `results.js`, `styles/modals-responsive.css`.

## 10. Очистка prompt и telemetry при reload

В закрытом moderator composer рядом с `Pro` отображается компактная кнопка
корзины. Она очищает textarea, заметку, выбранные модификаторы и вложения тем
же безопасным путём, что и штатная очистка prompt.

При полном browser reload `clearTelemetryOnReload` отправляет команду очистки
диагностических событий в background, после чего очищается локальное окно
телеметрии. Переходы между view без reload историю телеметрии не удаляют.

Реализация: `pipeline_panel.html`, `styles/modals-responsive.css`,
`results.js`, `results/boot-utils.js`, `background/message-router.js`.

## 11. Placeholder pipeline без выбранных моделей

После reload, когда выбор моделей очищен, каждый round сохраняет один
визуальный placeholder-блок в неактивном состоянии. Поэтому структура
pipeline (R1…Rn → Synthesis → Output) остаётся видимой и не выглядит как
обрывок только с синтезатором. Placeholder не участвует в dispatch и выборе
синтезатора; он используется только для схемы и неактивных connector-ов.

Реализация: `results.js` (`buildPipelineEmptySlotBlocksHtml`),
`styles/pipeline.css`.

## 12. Запоминание Auto

Checkbox Auto в Disput сохраняется в `llmDisputAutoMode.v1` и восстанавливается
при следующей загрузке страницы через штатный `change`-lifecycle policy,
синхронно обновляя run policy и связанные controls. Восстановление выполняется
до необязательной загрузки modifiers; принудительный startup-reset отсутствует.

Реализация: `pipeline_panel.html`, `results.js`.

## 13. Действия pipeline в шапке панели

Кнопки создания, сохранения, импорта, экспорта и профилей pipeline находятся
в `.pipeline-panel .panel-header` и сохраняют правое выравнивание. Заголовок
списка pipeline оставлен только для названия секции.

Реализация: `pipeline_panel.html`, `styles/pipeline.css`.

## 14. Создание pipeline без builder-окна

`pipeline-add-btn` переводит интерфейс в состояние `Unsaved Pipeline`,
аналогичное пустому состоянию после reload: раунды и неактивные placeholder-
блоки сохраняются, выбранные модели очищаются. Имя и конфигурация сохраняются
через существующий `pipeline-save-btn`; отдельное окно создания удалено.

Реализация: `results.js`, `styles/pipeline.css`.

## 15. Единый список pipeline

Preset и пользовательские pipeline отображаются в одном `#pipelineItems`;
пользовательские записи идут после предсохранённых preset-ов и сохраняют свои
кнопки удаления/переименования. Отдельный контейнер пользовательских pipeline
и разделитель удалены.

Реализация: `pipeline_panel.html`, `results.js`, `styles/pipeline.css`.

## 16. Неактивные terminal blocks и фиксированный заголовок

При пустом выборе моделей Synthesis и Output визуально неактивны так же, как
model blocks; при появлении активной модели Output возвращает состояние своего
checkbox, а выбранный synthesizer становится активным. Название pipeline в
шапке занимает фиксированные 18 символов и обрезается ellipsis.

Реализация: `results.js`, `styles/pipeline.css`.

## 17. Intermediate synthesis и inactive selector

Кнопка `.pipeline-stage-insert` с включённым intermediate synthesis использует
то же синее hover/focus-состояние, сохраняя только визуальный знак активного
переключения. Если ни одна модель pipeline не активна, выбор финального
synthesizer отключён и его программное изменение не принимается.

Реализация: `results.js`, `styles/pipeline.css`.

## 18. Lifecycle synthesis connector

Synthesis-stack использует отдельный connector mode вместо model input/send
checkboxes, которых у terminal synthesizer нет. При выбранной модели и
назначенном synthesizer обе стрелки активны; при пустом pipeline весь путь
неактивен и не получает `flow-anim`.

Реализация: `results.js`.

## 19. Удаление Output из canvas

Pipeline canvas завершается последним round либо Final Synthesis. Отдельный
блок Output, connector до него и checkbox выбора terminal action удалены с
главной страницы и Disput. Завершение Disput больше не запускает скрытый
автоматический Export HTML; пользовательский экспорт ленты остаётся доступен
через существующие явные кнопки.

Новые и встроенные pipeline не содержат `outputStack`. Поле из старой
сохранённой конфигурации допускается для обратной совместимости при чтении, но
не применяется и не записывается при следующем сохранении.

Реализация: `pipeline_panel.html`, `result_new.html`, `results.js`,
`pipeline/pipeline-runtime.js`, `styles/pipeline.css`.

## 20. Раунды нового пустого pipeline

Создание пустого pipeline сначала очищает прежние model blocks, затем
применяет общий `DEFAULT_DEBATE_ROUND_LIMIT = 3` через существующий
`setDebateRoundLimitValue()`. Значение последнего активного pipeline не
наследуется: selector и canvas переходят к R1–R3, каждый round содержит
неактивный placeholder-блок.

Реализация: `results.js`.

## 21. Заголовок pipeline — 18 символов

Отображаемая ширина заголовка pipeline ограничена `18ch`, а JS-обрезка
формирует максимум 18 видимых символов вместе с ellipsis. Полное имя остаётся
в `data-full-name` и `title`.

Реализация: `styles/pipeline.css`, `results.js`.

## 22. Новый пустой pipeline и встроенные preset

Создание пустого pipeline удаляет его старый DraftPlan и pending synthesizer,
поэтому блок синтезатора начинается с None и inactive. После выбора модели
общий \`syncDebateSchemeUi()\` снимает блокировку select.

Встроенные preset pipeline используют канонические конфигурации. Их изменения
не записываются в persistent overrides или DraftPlan; переключение на другой
preset и обратно восстанавливает исходные round limit, synthesizer и profile.

Реализация: \`results.js\`.

## Evidence

- `tests/release-log-regressions.test.js` — contract regressions для шести
  изменений;
- `tests/results-debate-favorites.test.js` — Manual-only answer approval;
- `tests/debate-orchestrator.test.js` — lease heartbeat;
- полный Jest: **153 suites / 915 tests / 0 failures**;
- `node --check results.js` и `git diff --check` — зелёные.

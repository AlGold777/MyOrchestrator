# False success: план исправления контракта доказательства

Дата: 2026-07-30
База анализа: ветка `codex/no-delivery-telemetry`, HEAD `e1fd77c`
Статус: план составлен, реализация не начата
Исполнитель: Codex

---

## 0. Назначение и границы

### 0.1. Предмет

Система фиксирует терминальный статус SUCCESS, после чего текст ответа на
странице модели продолжает изменяться или увеличиваться, либо изменяется
сохранённый и показанный расширением текст.

### 0.2. Что этот план НЕ покрывает

Существующий документ `docs/false-success-effectiveness-plan.md` описывает
**диагностический preset** — как телеметрия доказывает и классифицирует уже
случившийся инцидент. Настоящий план описывает **механизм**: почему инцидент
возникает и что в коде изменить. Документы дополняют друг друга и не должны
объединяться. Единственное пересечение — п. 2.2 настоящего плана (окно
пост-терминального наблюдения), оно затрагивает данные, на которых работает
preset; при реализации сверить с разделом 2.3–2.4 того документа.

### 0.3. Важное про версию кода

Контекст, по которому проводился внешний анализ (`False-success-Improvement-JUL30.txt`),
собран из ветки `codex/no-delivery-telemetry` коммитом `722bf47`. Эта ветка
**не влита в `main`**. В `main` отсутствуют `commitAcceptedAnswer` и
`ANSWER_COMMIT_EVALUATED` (введены в `3bcc4ec`). Все ссылки на строки ниже
действительны только для указанной ветки. Перед началом работы:

```bash
git branch --contains 3bcc4ec   # должно содержать текущую ветку
```

Если проверка не проходит — остановиться и уточнить базу.

---

## 1. Метод проверки и его слепые зоны

### 1.1. Что проверено исполнением

Два утверждения проверены запуском реальных модулей репозитория в jsdom
(jest, `testEnvironment: jsdom`, загрузка через `window.eval` файлов
`pipeline-config.js`, `answer-pipeline-selectors.js`, `turn-resolver.js`,
`answer-structure.js`, `generation-signal.js`, `pipeline-modules.js`,
`unified-answer-watcher.js`):

1. `UnifiedAnswerCompletionWatcher` завершается с `reason:'content_mutation_stable'`,
   `completed:true`, `confidence:0.85` при **видимой кнопке Stop** и
   `GenerationSignal.inspect().active === true` — после прохождения soft-дедлайна.
   До soft-дедлайна не завершается.
2. `timeoutManager.calculateTimeout()` для watcher, созданного с
   `expectedLength:'veryLong'`, возвращает `{soft: 50000, hard: 100000}`.
   Параметр ожидаемого объёма ответа на дедлайны не влияет.

Готовый воспроизводящий тест приведён в Приложении A.

### 1.2. Что проверено чтением кода и grep

Все остальные утверждения раздела 3. Каждое снабжено якорем `файл:строка`.

### 1.3. Слепые зоны — обязательны к учёту

| Зона | Следствие для плана |
|---|---|
| jsdom не воспроизводит батчинг рендера React, `content-visibility`, отложенную вёрстку | Проба доказывает логику гейта, но не то, что провайдер попадает в это состояние. Все выводы о частоте — гипотезы |
| `turn-resolver.js` и `answer-structure.js` не прочитаны построчно | Семантика `resolution==='exact'` и `structuralComplete` принята на веру. Это половина условия `strictAutomaticVerification` |
| `shared/model-run-state.js:shouldBlockTransition` не прочитан | Утверждение о том, что терминальный карантин пропускает `ANSWER_CANDIDATE_ACCEPTED`, не проверено |
| Из девяти адаптеров построчно прочитан один (`content-chatgpt.js`) | Выводы по остальным получены grep-ом; при реализации п.2.1 проверять каждый отдельно |
| Взаимодействие с `intelligentRetry` (до 8–10 прогонов pipeline) не разобрано | Несколько эмиссий `ANSWER_VERIFICATION_RESULT` за прогон при last-writer-wins в `entry.answerVerification` |
| Runtime-trace конкретного инцидента отсутствует | Ни одна из гипотез раздела 4 не подтверждена фактом исполнения |

---

## 2. Восстановленная архитектура терминального решения

Ключевой вывод: **автоматический SUCCESS закрыт одним узким гейтом**, и
распространённое объяснение «watcher сработал рано → SUCCESS» неполно.

### 2.1. Путь A — UnifiedAnswerPipeline (content)

```
watcher.waitForCompletion()                 unified-answer-watcher.js:226
  → runFinalStabilityChecks()               unified-answer-pipeline.js:1055
      4 снимка × 2500 мс + retry 2          pipeline-config.js:71-80
      verifySnapshotPair()                  answer-verification.js:141
  → !stable ⇒ {success:false,'answer_not_stable'}   unified-answer-pipeline.js:891
  → extract → sanityCheck.execute()         unified-answer-pipeline.js:944
  → результат в адаптер                     content-chatgpt.js:1404-1418
  → adapter шлёт LLM_RESPONSE               content-chatgpt.js:1591
```

### 2.2. Путь B — ResponseLifecycleDetector (content, параллельно)

```
PROMPT_SUBMITTED (перехват sendMessage)
  → waitForAnswerComplete()                 response-lifecycle-detector.js:1007
      гейт: stopButtonSignal===false, нет loading/progressbar,
            confidence >= MIN_COMPLETE_CONFIDENCE      :1163-1172
  → verifyStructuralCompletion()            :290
  → LLM_RESPONSE_READY (+ answerVerification)          :1258
  → schedulePostTerminalObservationWindow(1/3/8 с)     :1287, :7
```

### 2.3. Background

```
message-router.js:3211  recordPipelineAnswerVerification(meta.answerVerification)
message-router.js:4245  тот же вызов из телеметрии ANSWER_VERIFICATION_RESULT
job-orchestrator.js:6764   entry.answerVerification = result   (last-writer-wins)

handleLLMResponse
  :7772  maybeDeferStreamingFinalization  (executeScript-проба страницы)
  :7795  isPartial ← sanityWarnings / sanityConfidence / answerEvidence.partialAllowed
  :8140  submitAnswerCandidate → buildFinalizationEvidence
           :6898  strictAutomaticVerification =
                    verified && resolution==='exact' && structuralComplete
                    && generationActive===false && !lengthRegressionActive
                    && |selectedLength - answerLength| <= max(12, 8%)
           :6966  success && !answerVerified ⇒ contradiction 'answer_not_verified'
           :7026  accepted = contradictions.length===0 || manualRecovery
  :8201  SUCCESS && !accepted ⇒ ранний return, статус RECEIVING
  :8382  commitAcceptedAnswer → entry.answer = answerText   (безусловно при isSuccess)
  :8438  alreadyFinalized → finalProjection без ключа answer
```

**Вывод.** Единственная точка, где ложное «генерация завершена» превращается в
зелёный SUCCESS, — это `generationActive === false` в структурном
доказательстве. Всё остальное (пороги watcher, широкие completion-селекторы,
score threshold) без неё даёт максимум оранжевую карточку `RECEIVING /
Verification pending`.

---

## 3. Находки

Статус: **[исп]** — проверено исполнением, **[код]** — прямо следует из
исходника, **[выв]** — логический вывод, **[гип]** — гипотеза.

| ID | Якорь | Находка | Статус |
|---|---|---|---|
| F01 | `unified-answer-watcher.js:390` | Гейт `if (stopVisible && !softExpired && !hardExpired) return;` — после soft-дедлайна видимая Stop перестаёт блокировать завершение. Ветки завершения (`:393-466`) проверяются раньше веток истечения (`:468-478`), поэтому `extendSoftTimeout` уже не спасает | **[исп]** |
| F02 | `unified-answer-watcher.js:235`, `pipeline-modules.js:148` | Дедлайн вычисляется от длины текста, уже находящегося на странице в момент старта watcher (предыдущий ответ или 0). `expectedLength` из адаптера в расчёт не входит | **[исп]** |
| F03 | `generation-signal.js:70` | `inspect()` возвращает `active:false` и при доказанном отсутствии активности, и при полном промахе селекторов. Массив `checks[].foundCount` для различения уже вычислен и выброшен | [код] |
| F04 | `answer-verification.js:157` | `verifySnapshotPair` имеет отдельную причину `generation_inactive_unproven` для не-boolean значения, но продюсер никогда не отдаёт `null` — ветка недостижима | [код] |
| F05 | `response-lifecycle-detector.js:748` | `probeTrusted` учитывает только **брошенные** запросы. Валидный селектор, не совпавший из-за drift провайдера, не бросает ⇒ `stopButtonSignal === false` = «доказанное отсутствие». Тристейт стоит не на той оси | [код] |
| F06 | `content-chatgpt.js:1591-1597`, `:971-989` | Основной путь шлёт `{type, llmName, answer, answerHtml, meta: dispatchMeta}` — без `responseMeta`. Grep по девяти адаптерам: `responseMeta` встречается один раз, `content-gemini.js:1638-1645` | [код] |
| F07 | `job-orchestrator.js:7484`, `:7784`, `:7801` | `sanityWarnings` и `sanityConfidence` читаются из `responseMeta`; ветка понижения SUCCESS→PARTIAL при `streaming_active` / `content_growing` недостижима на основном пути из-за F06 | [код] |
| F08 | `sanity-check.js:44` | `streaming_active` вычисляется из `answerResult.indicators.streaming` (= `typingActive` в момент cleanup). Система знает, что завершилась при активном стриминге, и теряет это знание на границе процессов | [код] |
| F09 | `content-chatgpt.js:1420-1441` | Любой отказ pipeline, включая `answer_not_stable` (т.е. срабатывание верификации), уводит в `grabLatestAssistantMarkup()` без проверки завершения. Ужесточение верификации механически увеличивает трафик непроверенного fallback | [код] |
| F10 | `message-router.js:4245`, `job-orchestrator.js:6764` | Доказательство едет по телеметрическому каналу отдельно от payload. `ANSWER_VERIFICATION_RESULT` эмитится и при `verified:false` (`unified-answer-pipeline.js:1148`). `entry.answerVerification` — last-writer-wins, без TTL и без расходования | [код] |
| F11 | `job-orchestrator.js:6896` | Связь proof↔payload — только `±max(12, 8%)` длины. Для ответа 5000 знаков допускается расхождение 400 знаков | [код] |
| F12 | `job-orchestrator.js:6761` | `observedAt` перезаписывается временем регистрации в background; истинный возраст наблюдения теряется | [код] |
| F13 | `response-lifecycle-detector.js:7` | Окно пост-терминального аудита `[1000, 3000, 8000]` короче паузы, способной породить false success (≈1,5 с + 7,5–15 с). Метрика эффективности систематически недосчитывает свой целевой класс | [выв] |
| F14 | `response-lifecycle-detector.js:293-295` | При отсутствии `window.AnswerPipelineConfig` дефолты дают `checks:2`, `interval: max(5, 25)` — структурное доказательство вырождается в 2 снимка через 25 мс и уходит в background как `verified:true`. В проде конфиг загружен (bundle 0 манифеста покрывает все хосты, единый isolated world), поэтому дефект латентный | [код] |
| F15 | `response-lifecycle-detector.js:292` vs `unified-answer-pipeline.js:226` | Pipeline ждёт `whenProfileReady()`, lifecycle-детектор читает конфиг синхронно. При включённом Long детектор может отработать на Standard-таймингах | [код] |
| F16 | `unified-answer-pipeline.js:727` | `if (!scrollResult?.success && !answerResult?.success)` — успеха скролла достаточно для перехода к финализации; завершение watcher не обязательно | [код] |
| F17 | `results.js:15897`, `:19894` | Обработчик `LLM_PARTIAL_RESPONSE` безусловно перезаписывает вывод карточки. Проверки на уже зафиксированный терминальный статус нет ни в обработчике, ни в рендере. Любое позднее сообщение меняет видимый текст под зелёным статусом | [код] |
| F18 | `job-orchestrator.js:8382` vs `:8438` | `commitAcceptedAnswer` пишет `entry.answer` до ветки `alreadyFinalized`; в else-ветке `finalProjection` ключ `answer` не восстанавливает. При `terminal_reaccepted_without_state_change` (`finalization-controller.js:178`) текст растёт при неизменном статусе | [код] |
| F19 | `job-orchestrator.js:1136`, `answer-verification.js:196` | Автоматический late-upgrade закрыт `canAutoUpgrade` (verified + generationActive===false + structuralComplete + безопасная дельта). Гипотеза «автоматический late collect подменяет ответ» слабее, чем принято считать | [код] |
| F20 | `job-orchestrator.js:1125-1133` | `manualLatestRecovery` **заменяет** терминальный ответ другим текстом при проверках только на prompt-echo и stale-baseline. Реальный канал пост-терминальной ревизии | [код] |
| F21 | `job-orchestrator.js:2825-2833` | При отказе `chrome.scripting.executeScript` — `.catch()` вызывает `handleLLMResponse` с исходным текстом без проверки активности генерации | [код] |
| F22 | `job-orchestrator.js:2594-2610` | Precheck-байпас: при `answerEvidence.reason ∈ {timeout_with_text, hardstop_with_text, snapshot_with_text, materialize_with_text, panel_with_text}` defer не выполняется вообще, страница не опрашивается | [код] |
| F23 | `job-orchestrator.js:2712-2723` | `stableAnswerForceFinal` и `evidenceForceFinal` форсируют финализацию при `state.active === true`, если Stop не виден либо evidence из класса timeout/hardstop/materialize | [код] |
| F24 | `job-orchestrator.js:6912`, `:7026` | `manualRecovery` устанавливает `answerVerified = true` без доказательств и делает `accepted = true` в обход всех contradictions. Единственный полный обход гейта | [код] |
| F25 | `content-scripts/fetch-monitor-bridge.js` | В main world установлен хук на `window.fetch`, но он репортит только `status >= 400` и срабатывает на заголовках, а не на конце тела. `EventSource`, XHR, `ReadableStream` не перехвачены. Единственный источник истины о конце генерации доступен архитектурно и не используется | [код] |
| F26 | `answer-pipeline-selectors.js:57-66` | В `completionIndicators` ряда провайдеров входят обычные `send-button` / `textarea`. Как ускоритель входа в finalization это работает, но самостоятельным основанием для SUCCESS не является из-за гейта `:8201` | [код] |

---

## 4. Два разных дефекта

Их нельзя лечить одним изменением, и их обязательно надо различать в
диагностике.

### D1 — преждевременный терминал
SUCCESS выдан, пока генерация фактически идёт.
Требует, чтобы **структурное доказательство соврало**: `generationActive===false`
на всех снимках при продолжающейся генерации.
Носители: F03, F04, F05, F14, F15.

### D2 — пост-терминальная мутация текста
SUCCESS выдан корректно, но `entry.answer` и/или показанный текст меняются
после блокировки статуса.
Носители: F17, F18, F20.

**Практическое следствие.** D2 проверяется дешевле и быстрее (этап 4 плана).
Если после блокировки перезаписи в UI симптом исчезает — наблюдался D2, и
этапы 2–3 можно перепланировать.

---

## 5. Гипотезы и блокирующие их guard'ы

Требование к каждой гипотезе: назван код, который обязан её блокировать, и
объяснено, почему он не срабатывает.

| ID | Гипотеза | Guard, который должен блокировать | Почему не срабатывает | Уверенность |
|---|---|---|---|---|
| H1 | Тихое окно генерации ≥ ~9–16,5 с без stop/loading-маркера → честно полученный `verified` → SUCCESS → генерация возобновилась | `:6898` требует `generationActive===false` | Условие выполнено буквально: маркеров в окне не было. Guard не отличает «нет маркера» от «нет генерации» (F03) | высокая |
| H2 | Selector drift: маркеры есть, селекторы профиля их не находят | `probeTrusted` (`response-lifecycle-detector.js:748`) | Проверяет только брошенные запросы; промах валидного селектора трактуется как доказанное отсутствие (F05) | высокая |
| H3 | Пост-терминальная перезапись: второй принятый кандидат длиннее | `finalization-controller.js:162-176` (duplicate_terminal) | `answerIsDuplicate` ложно при более длинном тексте ⇒ `terminal_reaccepted_without_state_change`; далее `commitAcceptedAnswer` пишет `entry.answer` до ветки защиты (F18) | высокая, но это D2 |
| H4 | Ревизия через `manualLatestRecovery` | `canAutoUpgrade` | Не применяется: путь `replacesTerminalAnswer` идёт мимо (F20) | средняя, D2 |
| H5 | Переиспользование устаревшего/чужого proof | `verificationIdentity` + сравнение длины `:6896` | Identity совпадает в пределах одного dispatch; связь с payload — только ±8% длины, TTL отсутствует (F10, F11, F12) | средняя |
| H6 | Фоновая/выгруженная вкладка: `executeScript` упал | `maybeDeferStreamingFinalization` | `.catch()` финализирует исходный текст (F21) | средняя |
| H7 | Watcher завершился после soft-дедлайна при видимой Stop → pipeline корректно отверг → непроверенный DOM-fallback → в background нет `responseMeta` → некому понизить до PARTIAL | `isPartial` (`:7795`) | Ветка не питается: адаптер не шлёт `sanityWarnings` (F06, F07, F08, F09) | средне-высокая |
| H8 | `evidence`-байпас: timeout/hardstop-класс терминально пригоден при видимой Stop | `stableTerminalEligible` требует `stopButtonVisible !== true` | `timeout \|\| hardStop` в `answer-evidence.js:124-136` обходит это условие; в `maybeDeferStreamingFinalization` — ещё и байпас всего defer (F22, F23) | средняя |
| H9 | `manualRecovery` как полный обход | все contradictions | По конструкции: `answerVerified = true` без проверок (F24) | низкая, проверяется одним полем |
| H10 | Гонка двух продюсеров (`LLM_RESPONSE` из адаптера и `LLM_RESPONSE_READY` с `forceTerminalSuccess:true`, `message-router.js:3229`) | identity-гейты | Блокируют cross-dispatch, но не два сообщения одного dispatch из разных источников | средняя |
| H11 | Растёт reasoning-регион, исключённый из извлечения | `AnswerStructure.isIgnored` | Работает по назначению; дефект определения продукта, а не алгоритма | низкая |
| H12 | Латентный fail-open: 2 снимка за 25 мс с `verified:true` | наличие `AnswerPipelineConfig` | В проде конфиг есть; срабатывает только при сбое загрузки (F14) | низкая, но катастрофична при срабатывании |

Ни H1/H2/H7 сами по себе не объясняют D2; ни H3/H4 — D1. **Наблюдаемый симптом,
вероятно, составной.**

---

## 6. План реализации

### Этап 0 — база

```bash
git checkout codex/no-delivery-telemetry
git tag v-before-false-success-hardening
git checkout -b fix/false-success-proof-contract
npx jest 2>&1 | tail -5
```

**Зафиксированная база на 2026-07-30:** 191 test suite, 1360 тестов, все
проходят — это число уже включает добавленный
`tests/false-success-watcher-guard.test.js` (2 теста).
Любое изменение плана сверяется с этим числом; уменьшение числа
проходящих тестов без явного указания в плане — повод остановиться.

Проба уже добавлена в репозиторий: `tests/false-success-watcher-guard.test.js`
(исходник продублирован в Приложении A). На этом этапе она **проходит** —
документирует текущее поведение F01/F02. На этапе 3 её ожидания инвертируются
в тех же коммитах, что и правки.

---

### Этап 1 — наблюдаемость

Ни одно изменение этапа не меняет решений, только количество и качество данных.
Разрешено вносить **до** установления причины.

#### 1.1. Проброс `responseMeta` с основного пути адаптеров

- **Файлы:** `content-scripts/content-chatgpt.js:1591-1597` (эталон правки),
  затем `content-claude.js`, `content-gemini.js`, `content-grok.js`,
  `content-perplexity.js`, `content-qwen.js`, `content-deepseek.js`,
  `content-lechat.js`, `content-zai.js`. Образец существующей реализации —
  `content-gemini.js:1638-1645`.
- **Что:** в `meta` сообщения добавить
  `responseMeta: { source, completionReason, sanityWarnings, sanityConfidence, answerVerification }`.
  Источник данных — результат pipeline, `unified-answer-pipeline.js:955-959`
  (там уже лежат `sanityCheck` и `answerVerification`). Для fallback-ветки
  (`content-chatgpt.js:1425`) — `source:'dom_fallback'`,
  `completionReason:'pipeline_failed'`, `sanityWarnings:['unverified_fallback']`.
- **Зачем:** оживляет уже написанную, но недостижимую ветку понижения
  SUCCESS→PARTIAL (F06, F07, F08).
- **Приёмка:** новый `tests/adapter-response-meta-contract.test.js`. На каждый
  адаптер: pipeline вернул `sanityCheck.warnings ∋ streaming_active` ⇒
  отправленное сообщение содержит `meta.responseMeta.sanityWarnings`.
  Второй кейс: fallback-путь ⇒ `meta.responseMeta.source === 'dom_fallback'`.
- **Корректно ли при неверной ведущей гипотезе:** да. Это передача уже
  вычисленных данных, решение принимает существующий код.
- **Что станет хуже, конкретно:** часть прогонов, сейчас зелёных, станет
  PARTIAL. По сути это правильно, но статистика прогонов изменится скачком.
  Объявить до раскатки; при необходимости — включать через флаг
  `bootstrap-flags.js` на первой итерации.
- **Откат:** удаление одного поля из объекта сообщения.

#### 1.2. Расширить окно пост-терминального аудита

- **Файл:** `content-utils/response-lifecycle-detector.js:7`
- **Что:** `POST_TERMINAL_OBSERVATION_OFFSETS_MS` `[1000, 3000, 8000]` →
  `[1000, 3000, 8000, 15000, 30000]`.
- **Зачем:** текущее окно короче паузы, которая порождает false success (F13).
- **Приёмка:** `tests/false-success-effectiveness.test.js` — новый кейс: рост
  текста на 12-й секунде после терминала фиксируется как
  `observationWindowOutcome: 'changed'`.
- **Что станет хуже:** больше событий на прогон. Проверить троттлинг по образцу
  `ANSWER_GENERATING` (`:1112-1133`), чтобы аудит не вытеснял терминальные
  события из буфера диагностики.
- **Сверить** с `docs/false-success-effectiveness-plan.md` п. 2.3–2.4:
  изменение состава окна влияет на temporal-правила слота
  `post_terminal_mutation`.
- **Откат:** возврат массива.

#### 1.3. Не затирать верифицированное доказательство неверифицированным

- **Файлы:** `background/job-orchestrator.js:6764`;
  эмиссии `content-scripts/unified-answer-pipeline.js:1117` (success) и `:1148` (warning).
- **Что:** писать в `entry.answerVerification` только если входящее
  `verified === true` **или** текущее значение не `verified`. Неверифицированные
  снимки складывать в `entry.answerVerificationLast` (диагностика).
- **Зачем:** F10 + `intelligentRetry` до 8–10 прогонов ⇒ последний писатель
  выигрывает и может быть неудачным снимком.
- **Приёмка:** `tests/answer-verification-record.test.js` — записать verified,
  затем unverified ⇒ `entry.answerVerification.verified === true`,
  `entry.answerVerificationLast.verified === false`.
- **Откат:** снятие условия.

#### 1.4. Сохранять истинный возраст наблюдения

- **Файл:** `background/job-orchestrator.js:6761`
- **Что:** не перезаписывать `observedAt` временем регистрации. Добавить
  `recordedAt: Date.now()` отдельным полем, `observedAt` брать из входящего
  доказательства.
- **Зачем:** F12 — без этого невозможно ввести TTL доказательства (этап 5).
- **Приёмка:** `tests/answer-verification-record.test.js` — доказательство с
  `observedAt` в прошлом сохраняет своё значение.

#### 1.5. Убрать fail-open дефолты в lifecycle-детекторе

- **Файл:** `content-utils/response-lifecycle-detector.js:290-295`
- **Что:** при отсутствии `window.AnswerPipelineConfig?.finalization`
  возвращать `null` из `verifyStructuralCompletion` вместо подстановки
  `checks:2, interval:25`. Вызывающий код (`:1186`) уже трактует это как
  «не верифицировано». Дополнительно — дождаться
  `window.AnswerPipelineTiming?.whenProfileReady?.()` перед первым вызовом
  (F15).
- **Приёмка:** `tests/lifecycle-structural-config.test.js` — при
  `window.AnswerPipelineConfig = undefined` сообщение `LLM_RESPONSE_READY` не
  отправляется; при включённом Long-профиле используется `stabilityChecks: 5`.
- **Что станет хуже:** на страницах с медленной загрузкой bundle 0 первый цикл
  детектора не даст COMPLETE. Приемлемо — цикл поллится.

**Точка остановки 1.** Прогнать полный `npx jest`; число проходящих тестов не
должно уменьшиться. Собрать телеметрию хотя бы одного прогона с симптомом.
Дальнейшие этапы имеют смысл только после того, как в трассе видно, какой из
двух дефектов (D1 или D2) наблюдается.

---

### Этап 2 — причинная правка ядра

#### 2.1. Тристейт `GenerationSignal.inspect`

- **Файл:** `content-scripts/generation-signal.js:32-71`
- **Что:** вычислять `totalFound = checks.reduce((s,c) => s + c.foundCount, 0)`.
  Возвращать:
  - найден видимый узел → `active: true`
  - `totalFound > 0`, видимых нет → `active: false` (**доказанное отсутствие**)
  - `totalFound === 0` → `active: null` (**unknown**)
- **Критично:** различие ведётся по `foundCount`, **не** по `visibleCount`.
  Существующие тесты `tests/generation-signal.test.js:60` и `:68` («индикатор
  присутствует, но disabled / нулевого размера») должны продолжать возвращать
  `false` — это и есть доказанное отсутствие активности.
- **Потребители готовы:** `answer-verification.js:157` вернёт
  `generation_inactive_unproven` (уже покрыто `tests/answer-verification.test.js:113`);
  `job-orchestrator.js:6901` требует строго `=== false`.
- **Продюсеры снимков:** `unified-answer-pipeline.js:1048` и
  `response-lifecycle-detector.js:282` — передавать `generationSignal.active`
  как есть. Fallback `{active:true}` при отсутствии модуля
  (`unified-answer-pipeline.js:1017`) **оставить** — это fail-closed.
- **Приёмка:** расширить `tests/generation-signal.test.js`: селекторы не
  совпали ни с чем ⇒ `active === null`; два существующих кейса продолжают
  давать `false`. Интеграционно: `verifySnapshotPair` с `generationActive:null`
  ⇒ `verified:false`, причина `generation_inactive_unproven`.
- **Корректно ли при неверной ведущей гипотезе:** да. Изменение приводит код в
  соответствие с уже задекларированным контрактом (F04) независимо от того,
  какая гипотеза верна.
- **Что станет хуже, конкретно:** при drift селекторов провайдера вместо
  ложного зелёного статуса будет зависание в `VERIFYING` / оранжевая карточка
  до таймаута. Смягчение уже реализовано: `job-orchestrator.js:8228` доставляет
  текст как non-terminal кандидат с меткой `Verification pending` — проверить,
  что метка действительно отображается в `results.js`.
- **Откат:** одна ветка `return`.

#### 2.2. Тристейт по правильной оси в lifecycle-детекторе

- **Файл:** `content-utils/response-lifecycle-detector.js:748-749`
- **Что:** если `configuredDescriptors.length > 0` и суммарно ничего не найдено
  — `stopButtonSignal = 'unknown'`, а не `false`.
- **Приёмка:** `tests/lifecycle-tristate-completion.test.js` — платформенные
  селекторы не совпадают, в DOM присутствует кнопка Stop с другим атрибутом ⇒
  `stopButtonSignal === 'unknown'`, COMPLETE не выдаётся.
- **Риск выше, чем у 2.1.** У провайдеров, которые действительно не рендерят
  Stop после завершения, `unknown` станет постоянным состоянием.
  **Обязательно** до раскатки проверить все девять профилей на живой странице.
  При провале — ввести per-platform флаг
  `stopButtonAlwaysPresentDuringGeneration` в `answer-pipeline-selectors.js` и
  применять `unknown` только для профилей с этим флагом.
- **Откат:** возврат к прежнему выражению.

**Тег после этапа 2:** `git tag v-false-success-tri-state`.

---

### Этап 3 — watcher

#### 3.1. Soft-timeout не отключает гейт по видимой Stop

- **Файл:** `content-scripts/unified-answer-watcher.js:390`
- **Было:** `if (stopVisible && !expiration.softExpired && !expiration.hardExpired) return;`
- **Стало:** `if (stopVisible && !expiration.hardExpired) return;`
- **Зачем:** F01. Soft-таймаут перестаёт снимать защиту; жёсткий по-прежнему
  выпускает с `completed:false`.
- **Приёмка:** тест из Приложения A инвертируется: после soft-дедлайна
  результат остаётся `null`; на hard-дедлайне приходит `hard_timeout` с
  `completed:false`. Обновить тест в том же коммите.
- **Что станет хуже:** провайдер с «залипшей» кнопкой Stop будет ждать до
  hard-дедлайна вместо soft. Аналог `stuckBusyOverride`
  (`response-lifecycle-detector.js:1157`) в watcher **не добавлять** до
  получения trace — иначе воспроизводится тот же класс дефекта.
- **Откат:** возврат условия.

#### 3.2. Адаптивный дедлайн не от текста, лежащего на странице

- **Файлы:** `content-scripts/unified-answer-watcher.js:148-156`, `:235-236`;
  `content-scripts/pipeline-modules.js:148-164`
- **Что:**
  1. Принимать `options.expectedLength` в конструкторе watcher и использовать
     соответствующую корзину `adaptiveTimeout`, если параметр передан.
  2. Пересчитывать дедлайн по мере роста ответа, а не один раз на старте
     (`recalculateOnGrowth`), с ограничением `hardMax`.
  3. Передавать `expectedLength` из `unified-answer-pipeline.js:860-869` в
     watcher (сейчас параметр доходит только до выбора coordination mode,
     `:602-604`).
- **Приёмка:** `expectedLength:'veryLong'` ⇒ `soft === 450000` (текущий тест из
  Приложения A даёт 50000 — инвертировать).
- **Что станет хуже:** удлиняет ожидание для коротких ответов на длинный
  промпт. Ограничить `hardMax` из конфига профиля.
- **Откат:** параметр игнорируется — поведение возвращается к текущему.

---

### Этап 4 — терминальная блокировка карточки в UI

**Может выполняться раньше этапов 2–3 как диагностический эксперимент.**

#### 4.1. Не перезаписывать текст терминально зафиксированной карточки

- **Файлы:** `results.js:15897` (обработчик `LLM_PARTIAL_RESPONSE`),
  `:19894` (`updateDebateModelCardOutput`)
- **Что:** перед перезаписью проверять, зафиксирован ли для модели терминальный
  статус. Если да и в `message.metadata` нет явного признака ревизии
  (`answerRevision: true` / `revisionOf`) — не заменять основной блок, а
  добавить помеченную ревизию «Ответ обновлён после завершения» с указанием
  источника (`metadata.source`) и дельты длины.
- **Зачем:** F17. Сейчас пост-терминальная ревизия невидима как факт и выглядит
  как «SUCCESS, а текст сам меняется».
- **Приёмка:** `tests/results-post-terminal-render.test.js` — `MODEL_FINAL`
  SUCCESS, затем `LLM_PARTIAL_RESPONSE` с другим текстом ⇒ основной блок не
  изменился, добавлена помеченная ревизия с источником.
- **Диагностическая ценность:** если после 4.1 пользователь перестаёт наблюдать
  симптом — наблюдался D2, и этапы 2–3 нужно перепланировать по приоритету.
- **Что станет хуже:** легитимные поздние улучшения ответа (append после
  верифицированного late-upgrade) перестанут выглядеть как обычный ответ и
  потребуют от пользователя одного клика. Это осознанный размен: явная ревизия
  вместо молчаливой подмены.
- **Откат:** снятие проверки.

---

### Этап 5 — только после runtime-trace

1. Подключение конца сетевого стрима как источника истины: tee тела ответа в
   `content-scripts/fetch-monitor-bridge.js`, перехват `EventSource`,
   новое событие `STREAM_ENDED` как обязательный положительный сигнал
   завершения (F25). Единственное изменение, закрывающее класс целиком.
2. TTL и точная привязка доказательства к payload: `verificationId`,
   `payloadEvidenceId`, сравнение `normalizedHash` вместо `±8%` длины
   (F10, F11) — возможно только после 1.4.
3. Ужесточение `manualLatestRecovery` (`job-orchestrator.js:1125`) и порядка
   вызовов `commitAcceptedAnswer` / `finalProjection` (F18).

---

## 7. Чего не делать

- **Не трогать `shared/finalization-controller.js`.** Ранговая логика корректна.
  Проблема не в ней, а в порядке вызовов в `handleLLMResponse` (F18). Если
  браться — отдельным этапом и после 4.1.
- **Не увеличивать таймауты и пороги** (`mutationIdle`, `contentStable`,
  `stabilityInterval`, `stableMs`) как исправление. Причина не в конкретном
  значении порога; увеличение сдвигает дефект на более длинные паузы.
- **Не удалять пост-терминальный аудит**, заменяя его инвалидацией статуса.
  Монотонность терминального статуса — сознательное свойство; ломать его до
  установления причины нельзя.
- **Не править селекторы конкретных провайдеров** до получения DOM-снимка
  инцидента.
- **Не отключать исключение reasoning-регионов** в `answer-structure.js`.

---

## 8. Порядок исполнения

Полный порядок: `0 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → [точка остановки 1] → 4.1 → 2.1 → 2.2 → 3.1 → 3.2 → [этап 5]`.

Сокращённый, если нужен быстрый результат: `4.1 → 1.1 → 1.2 → 2.1 → 3.1`.
Первые два пункта отвечают на вопрос «какой из двух дефектов мы наблюдаем», и
без этого ответа этапы 2–3 могут чинить не ту половину.

---

## 9. Git, версии, документация

По `CLAUDE.md`:

- Отдельный коммит на каждый пункт плана. Не накапливать несколько пунктов в
  одном коммите — иначе бисекция при поиске регрессии теряет смысл.
- Выборочное стадирование (`git add <path>`), не `git add -A`.
- В каждом коммите поднимать версионные константы затронутых файлов:
  `manifest.json`, `package.json`, `ALGORITHM_VERSION` / `RULE_SET_VERSION` в
  изменённых модулях.
- `docs/CHANGELOG.md` — в том же коммите. `docs/telemetry.md` — для 1.2, 1.3,
  1.4. `docs/false-success-effectiveness-plan.md` — сверка для 1.2.
- Теги: `v-before-false-success-hardening` (до серии),
  `v-false-success-tri-state` (после этапа 2), `v-false-success-ui-lock`
  (после этапа 4).
- Перед разрушающими операциями — `git status --short` и остановка при
  неожиданном результате.

---

## 10. Открытые вопросы, требующие runtime-trace

| Данные | Какие гипотезы различит | Где взять |
|---|---|---|
| `ANSWER_VERIFICATION_RECORDED.generationSignalChecks[].foundCount` на каждом снимке | H1 против H2 — единственное различие между ними | телеметрия расширения |
| `DETECT_DONE.reason` + `signal.stopVisible` | H7: завершился ли watcher при видимой Stop | телеметрия |
| Порядок `PIPELINE_EVENT`, `LLM_RESPONSE_READY`, `LLM_RESPONSE` для одного dispatch | H10 | background message trace |
| `ANSWER_COMMIT_EVALUATED.overwrite` + `finalizationControllerDecision.reason` | H3 (D2) | телеметрия |
| Флаги `manualRecovery` / `manualLatestRecovery` в evidence принятого SUCCESS | H4, H9 | `FINALIZATION_DECISION` |
| `POST_TERMINAL_ANSWER_WINDOW_CLOSED.observationWindowOutcome` после 1.2 | подтверждение самого факта D1 | телеметрия |

**Один прогон с воспроизведением симптома и полной телеметрией закрывает
вопрос H1 против H2** — они дают идентичный путь исполнения и различаются
только полем `foundCount`, которое уже пишется (`job-orchestrator.js:6778`).

---

## Приложение A. Проба, воспроизводящая F01 и F02

Файл: `tests/false-success-watcher-guard.test.js`

```js
const fs = require('fs');
const path = require('path');

const loadScript = (filename) => {
  window.eval(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'));
};

const bootstrapWatcher = () => {
  delete window.AnswerPipeline;
  delete window.AnswerPipelineConfig;
  delete window.AnswerPipelineSelectors;
  delete window.TurnResolver;
  delete window.UnifiedPipelineModules;
  delete window.SelectorCircuit;
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.SelectorCircuit = { shouldUse: jest.fn(() => true), report: jest.fn() };
  loadScript('content-scripts/pipeline-config.js');
  loadScript('content-scripts/answer-pipeline-selectors.js');
  loadScript('content-scripts/turn-resolver.js');
  loadScript('content-scripts/answer-structure.js');
  loadScript('content-scripts/generation-signal.js');
  loadScript('content-scripts/pipeline-modules.js');
  loadScript('content-scripts/unified-answer-watcher.js');
};

const setVisibleRects = () => {
  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      return { width: 120, height: 32, top: 10, bottom: 42, left: 10, right: 130, x: 10, y: 10, toJSON() { return this; } };
    }
  });
};

describe('false success: watcher completion guards', () => {
  beforeEach(() => { bootstrapWatcher(); setVisibleRects(); });

  // F01. До этапа 3.1 тест документирует дефект; после 3.1 ожидания инвертируются:
  //      at100s должен остаться null, а на hard-дедлайне прийти hard_timeout/completed:false.
  test('watcher completes while the Stop button is still visible, once soft deadline passed', async () => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-message-author-role="assistant">
          <div class="prose">${'Partial answer text. '.repeat(30)}</div>
        </article>
        <button aria-label="Stop generating" data-testid="stop-button">Stop</button>
      </main>
    `;

    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT' });

    expect(watcher.getStopVisible()).toBe(true);
    expect(window.GenerationSignal.inspect({
      selectors: window.AnswerPipelineSelectors.PLATFORM_SELECTORS.chatgpt
    }).active).toBe(true);

    let settled = null;
    watcher.waitForCompletion({ container: document.querySelector('main') })
      .then((r) => { settled = r; });

    for (let i = 0; i < 40; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
    const at20s = settled;

    for (let i = 0; i < 760; i += 1) { jest.advanceTimersByTime(500); await Promise.resolve(); }
    const at100s = settled;

    expect(document.querySelector('button[data-testid="stop-button"]')).not.toBeNull();
    expect(at20s).toBeNull();
    expect(at100s).not.toBeNull();
    expect(at100s.reason).toBe('content_mutation_stable');
    expect(at100s.completed).toBe(true);
    expect(watcher.getStopVisible()).toBe(true);
    jest.useRealTimers();
  });

  // F02. После этапа 3.2 ожидание меняется на 450000.
  test('adaptive soft/hard deadline ignores expected answer size', () => {
    document.body.innerHTML = `<main><article data-message-author-role="assistant"><div class="prose">x</div></article></main>`;
    const watcher = new window.AnswerPipeline.UnifiedAnswerCompletionWatcher('chatgpt', { llmName: 'GPT', expectedLength: 'veryLong' });
    const t = watcher.timeoutManager.calculateTimeout(watcher.getCurrentContentLength());
    expect(t.soft).toBe(50000);
  });
});
```

Запуск:

```bash
npx jest tests/false-success-watcher-guard.test.js
```

Примечание к тесту: в первом кейсе текст в DOM присутствует на момент старта
watcher (629 знаков), поэтому корзина таймаута — `medium` (soft 112 000 мс).
Это само по себе демонстрация F02: длина берётся из уже отрендеренного
предыдущего содержимого.

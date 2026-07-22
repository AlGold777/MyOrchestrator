# Timing map — актуальные задержки и wait budgets

> Этот документ — единственный владелец числовых таймингов dispatch, tab
> readiness и answer pipeline. Архитектура вкладок описана в
> `docs/model-tabs-architecture.md`; здесь не дублируются ownership и lifecycle.

> Значения ниже сверяются с кодом и тестом `tests/timing-ladder.test.js`; часть ключевых
> потолков теперь **профильные** (short/long через `longGenerationMode`, см.
> `background/shared-state.js`). Инварианты лестницы таймаутов закреплены тестом
> `tests/timing-ladder.test.js` — при изменении констант тест не даст доку разъехаться
> молча. Полный аудит и обоснования: `docs/timing-review-2026-07-02.md`.
>
> Профильная лестница (short / long):
> - `SCRIPT_RUNTIME_HARD_STOP` 210s / 480s (было фикс. 180s)
> - `DEFER_STREAM_FINAL_MAX` 180s / 460s
> - `ROUND4_PENDING_WAIT_MAX` 230s / 500s (было 190s)
> - `ADAPTIVE_PROBE_TOTAL_WINDOW` 270s / 540s (было 180s)
> - `BASELINE_GUARD_WINDOW` 240s / 510s (было 120s)
> Ключевые значения текущей лестницы: retry backoff без 0ms (`[500,800,3000,8000]` /
> `[2000,2500,5000,9000]`); Perplexity submit 12s; `TAB_READY_RELOAD_TIMEOUT_MS=25s`;
> no-focus probe 3s; focusRestoreMax 5s; `VISIT_QUOTA_MAX=20s/60s`;
> `ROUND2` batch = max(45s, N×8s); stable-pending = defer stable-force = 30s;
> submit-timeout единственный источник — `shared/model-policy.js`.

Цель: быстро найти, откуда берётся задержка (и что именно можно крутить). Тут есть 3 слоя:
- `background/tab-manager.js`, `background/dispatch-coordinator.js`, `background/job-orchestrator.js` — открытие/активация вкладок, очередь отправки, ожидание подтверждения “промпт отправлен”.
- `content-scripts/content-*.js` — поиск композера/кнопки, вставка текста, отправка (клик/Enter) + локальная проверка, что “ушло”.
- `content-scripts/pipeline-config.js` — ожидание/останов ответа (стрим/стабилизация).

Чтобы найти место в коде, ищите константу в указанном владельце, затем сверяйте
формулу с `tests/timing-ladder.test.js`. Историю изменений таймингов не ведём
в этом документе — она находится в `docs/CHANGELOG.md`.

## 0) Важно про `sleep(...)`
- `content-scripts/content-utils.js`: `sleep(ms)` ускоряется, если включён `window.__PRAGMATIST_SPEED_MODE`.
  - коэффициент: `ms * 0.35`
  - минимум: `25ms`
- Поэтому все `await sleep(...)` ниже — номиналы; в speed mode фактические паузы короче.

## 1) Background: открыть/подцепить вкладку → вставить → отправить
### 1.1. Вкладка и готовность контент-скрипта
- `TAB_LOAD_TIMEOUT_MS = 45000` — максимум ждём `tabs.onUpdated ... status === 'complete'` после `chrome.tabs.create(...)`.
- `TAB_READY_TIMEOUT_MS = 15000` — warm-проверки готовности существующей вкладки; для reload discarded/грузящейся вкладки действует `TAB_READY_RELOAD_TIMEOUT_MS = 25000` (2.80.143).
- `SEND_PROMPT_DELAY_MS = 3000` — максимум на ожидание “контент-скрипт жив” перед отправкой `GET_ANSWER`.
  - код: `waitForScriptReady(... { timeoutMs: SEND_PROMPT_DELAY_MS, intervalMs: 250 })`

### 1.2. Очередь отправок (главный источник “почему модель начала позже”)
- `withPromptDispatchLock(...)` сериализует отправку по всем моделям: пока текущая модель ждёт подтверждения отправки, следующая не стартует.
- Верхняя оценка задержки старта последней модели ≈ сумма ожиданий “PROMPT_SUBMITTED” у предыдущих моделей.

### 1.3. Подтверждение “промпт отправлен”
- Бэкграунд ждёт событие `PROMPT_SUBMITTED` (от content-script) до таймаута:
  - `PROMPT_SUBMIT_TIMEOUT_MS = 20000`
  - `PROMPT_SUBMIT_TIMEOUTS_MS`:
    - `GPT: 15000`
    - `DeepSeek: 22000`
    - остальные: `20000`
- Ретраи диспатча (если подтверждение не пришло):
  - `DISPATCH_MAX_ATTEMPTS = 4`
  - `DISPATCH_RETRY_BACKOFF_MS = [0, 2500, 5000, 9000]`
  - `DISPATCH_SUPERVISOR_TICK_MS = 1200`

### 1.4. Защита от retry-storm (когда вкладка ещё обрабатывает прошлый запрос)
- Если content-script вернул `error.type === 'concurrent_request'`, бэкграунд не ставит `ERROR`, а ставит cooldown:
  - `csBusyUntil = now + 60000` (60 сек) — чтобы не долбить вкладку ретраями.

## 2) То, чего не хватало: A) open tab → paste и B) paste → send
Это две разные “паузы”, и они собираются из нескольких кусков:

A) `open/attach tab → paste prompt` =
- время загрузки вкладки (переменно) +
- ожидание очереди `withPromptDispatchLock` (переменно) +
- `waitForScriptReady ≤ 3000ms` (background) +
- “pre-typing” в content-script (ниже по моделям) +
- ожидание поиска композера/селекторов (часто до 10–30 сек, если промах кэша).

B) `paste prompt → send` =
- “post-typing” в content-script (ниже по моделям) +
- ожидание “кнопка активна/отправка подтверждена” (циклы/таймауты в content-script).

## 3) Content scripts: pre-typing / post-typing по моделям
### GPT — `content-scripts/content-chatgpt.js`
A (после `GET_ANSWER` до вставки):
- `await sleep(450)` — стартовая пауза перед поиском композера.
- поиск поля ввода: `findAndCacheElement('inputField', ..., 10000)` — до `10000ms` при промахе.
- если есть attachments: `await sleep(400)` после attach.
- `fastSetPrompt(...)`: `await sleep(120)`.
B (после вставки до отправки):
- `await sleep(120)` — “Prompt injected, waiting for UI to update...”
- ожидание доступности send: `enableDeadline = Date.now() + 2500` + `await sleep(120)` в цикле.
- подтверждение отправки: дедлайн `+1600ms` + `await sleep(120)` в цикле.

### Claude — `content-scripts/content-claude.js`
A:
- `await sleep(250)` в начале inject.
- поиск `inputField` / `sendButton`: `findAndCacheElement(...)` (таймаут по умолчанию до `30000ms`, если кэш промахнулся).
- вставка текста (`typeWithHumanPauses(...)`): контрольные `await sleep(150)` / `await sleep(100)` / `await sleep(200)` (в зависимости от стратегии).
B:
- ожидание enable send: цикл до `5000ms` с `await sleep(50)`.
- подтверждение отправки: дедлайн `+1600ms` с `await sleep(120)` в цикле.

### Gemini — `content-scripts/content-gemini.js`
A:
- `await sleep(1000)` в начале inject.
- после `EXT_SET_TEXT`: `await sleep(150)`.
- `await geminiHumanRead(600)` (до fallback-typing).
- поиск поля ввода/кнопки: `findAndCacheElement(...)` (таймаут по умолчанию до `30000ms`).
B:
- `await sleep(1500)` — “Даем время кнопке активироваться”.

### DeepSeek — `content-scripts/content-deepseek.js`
A:
- `await sleep(isSpeedMode() ? 250 : 1200)` перед поиском композера.
- поиск композера: `resolveComposer()` → может упираться в `findAndCacheElement(...)` (до `30000ms`).
B:
- `sendComposer(...)`: сначала Enter → `await sleep(120)` → затем (если нашли кнопку) клик.

### Perplexity — `content-scripts/content-perplexity.js`
A:
- `await sleep(120)` в начале inject.
- поиск поля ввода: `findAndCacheElement(...)` (до `30000ms`).
B:
- после ввода: `await sleep(100)` (валидация, что текст реально вставился).
- `await sleep(250)` перед отправкой (“активация кнопки”).
- важно: поиск send-кнопки — `findAndCacheElement('sendButton', ...)` (до `30000ms`), иначе фолбэк Enter начнётся только после этого ожидания.

Flow (что реально происходит на странице Perplexity):
1) `background/message-router.js` / `background/dispatch-coordinator.js` → отправляют `GET_ANSWER` в вкладку Perplexity (с `meta.sessionId/dispatchId`) и ждут `PROMPT_SUBMITTED`.
2) `content-perplexity.js` → `onRuntimeMessage(GET_ANSWER)` вызывает `injectAndGetResponse(prompt, attachments, meta)` и возвращает `true` (канал `sendResponse` держится до конца запроса).
3) `injectAndGetResponse(...)`:
   - `await sleep(120)`.
   - ищет композер: `findAndCacheElement('inputField', ...)` (timeout до `30000ms`).
   - (если есть файлы) `attachFilesToComposer(...)` (у тебя в логах файлов не было).
   - вставляет текст: `fallbackPerplexityType(...)` (focus → `sleep(80)` → set value/contenteditable → input/change → `sleep(150)`).
   - проверяет что текст реально вставился: `await sleep(100)` + `value/textContent.trim()`.
   - ждёт активации UI: `await sleep(250)`.
   - пытается найти send-кнопку: `findAndCacheElement('sendButton', ...)` (до `30000ms`); если нашли — `perplexityHumanClick(sendButton)`, иначе фолбэк `keydown Enter`.
   - отправляет сигнал в бэк: `chrome.runtime.sendMessage({ type: 'PROMPT_SUBMITTED', ... })`.
   - ждёт ответ: `tryPerplexityPipeline(...)` → fallback `grabLatestAssistantMarkup()` → fallback `trySelectorFinderResponse(...)`.
4) После получения текста:
   - чистит: `window.contentCleaner.cleanContent(..., { maxLength: 50000 })`.
   - отправляет в бэк: `CONTENT_CLEANING_STATS` и `LLM_RESPONSE`/`FINAL_LLM_RESPONSE` (с тем же `meta`).
   - вызывает `sendResponse({ status: 'success' })` (поэтому “Команда доставлена” в логах может появляться только в конце).

### Qwen — `content-scripts/content-qwen.js`
A:
- `await sleep(1000)` перед поиском композера.
B:
- `sendComposer(...)`: Enter → `await sleep(120)` → клик по кнопке (если найдена).
- поиск send-кнопки через SelectorFinder: `timeout: 12000` внутри `resolveSendButton(...)`.

### Le Chat — `content-scripts/content-lechat.js`
A:
- `await sleep(1200)` перед composer-search.
- поиск композера:
  - `resolveComposerViaSelectorFinder(... timeout: 25000)`
  - fallback: `findAndCacheElement(...)` (таймаут по умолчанию до `30000ms`)
B:
- `await sleep(100)` перед проверкой, что текст вставился.
- `sendComposer(...)`:
  - `confirmLeChatSend(timeout = 3000)` (вызовы обычно с `3500`) + `await sleep(150)` в цикле.
  - внутри `confirmLeChatSend` вызывается `resolveSendButton(...)`, который может ходить в SelectorFinder с `timeout: 20000` (если промах кэша, один вызов может “съесть” весь дедлайн confirm).

### Grok — `content-scripts/content-grok.js`
A:
- `await sleep(1000)` перед composer-search.
- дополнительно (если не speed mode): `humanoid.readPage(650)` и `humanoid.readPage(480)` (это большие паузы).
B (подтверждение после клика):
- `watchResponseActivity(9000)` + `waitForComposerClear(3500)` — ожидания, которые решают “отправилось ли” (используются внутри attemptSend).

## 4) Global answer pipeline (ответ) — `content-scripts/pipeline-config.js`
- `preparation`:
  - `{ tabActivationTimeout: 3000 }`
  - `{ allowTabActivation: false }`
  - `{ streamStartTimeout: 30000, streamStartPollInterval: 100 }`
- `streaming.adaptiveTimeout`:
  - `short: 20000`, `medium: 45000`, `long: 90000`, `veryLong: 180000`
  - `softExtension: 30000`, `hardMax: 180000`
- `streaming.continuousActivity`: `{ interval: 5000, pauseBetweenMoves: 3000 }`
- `streaming.maintenanceScroll`: `{ checkInterval: 3000, scrollStep: 120, idleThreshold: 5000, maxDuration: 20000 }`
- ChatGPT override: `platformOverrides.chatgpt.initialScrollKick.delay = 1000`, `maintenanceScroll.enabled = false`, `continuousActivity.enabled = false`
- `finalization`: `{ stabilityChecks: 3, stabilityInterval: 2000 }`

## 5) Response lifecycle detector — `content-utils/response-lifecycle-detector.js`

- `stableMs = 1500` — стандартное окно стабильности текста.
- `pollIntervalMs = 600` — стандартный интервал проверки lifecycle.
- `STUCK_BUSY_OVERRIDE_MIN_MS = 6000` — минимальная непрерывная стабильность,
  после которой generic loading-class может быть признан застрявшим декором.
- Фактический порог stuck-busy: `max(4 × stableMs, 6000ms)`; override допустим
  только при тишине мутаций и подтверждённом отсутствии Stop/progressbar.

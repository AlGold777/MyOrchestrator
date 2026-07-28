# Техническое задание: добавление новой LLM-модели

> Для изменений главной страницы и model tabs сначала сверяйтесь с
> `docs/model-tabs-architecture.md`; этот документ описывает полный checklist
> добавления провайдера, а не runtime ownership вкладок.

> Версия документа: 1.0 · Дата: 2026-06-22 · Применимо к расширению `A_Codex_Opus` (MV3)

В качестве примера в ТЗ используется условная модель **«Copilot»** с веб-интерфейсом
`https://copilot.example.com/` и каноническим именем `Copilot`. При реальной интеграции
замените имя, домены и API-эндпоинт на фактические.

---

## 0. Контекст и архитектура

Расширение сравнивает ответы нескольких LLM, управляя их **веб-интерфейсами** через
content-scripts (основной транспорт `web_ui`) с резервным **прямым API** (`api-fallback`).
Каждая модель имеет:

- **каноническое имя** (`Copilot`) — используется в background/оркестрации/политиках;
- **value-строку UI** (`copilot`, нижний регистр) — в попапе/результатах;
- **домен(ы)** веб-интерфейса;
- **per-model content-script** (адаптер) `content-scripts/content-<model>.js`;
- **конфиг селекторов** `selectors/<model>.config.js` (реестр `SelectorConfigRegistry`).

Ключевая трудность — имя модели «зашито» в ~20 местах (manifest, background-реестры,
наборы `Set(...)` в оркестраторе, UI-карты, политики). ТЗ перечисляет **все** обязательные
и опциональные правки.

---

## 1. Входные данные (предусловия)

Перед началом получить и зафиксировать:

| Параметр | Пример | Где используется |
|---|---|---|
| Каноническое имя | `Copilot` | background, policy, selectors registry |
| UI value | `copilot` | `popup.html`, `popup.js`, `results.js` |
| URL стартовой страницы | `https://copilot.example.com/` | `llm-targets.js`, `evaluation-manager.js` |
| Домен(ы) / match-паттерны | `*://copilot.example.com/*` | `manifest.json`, `tab-manager.js`, `llm-targets.js` |
| Селекторы composer / sendButton / response | DOM-аудит реальной страницы | `selectors/copilot.config.js` |
| Маркеры конца генерации | спиннер/`aria-busy` | конфиг `observation.endGenerationMarkers` |
| (Опц.) API endpoint, модель, формат запроса | OpenAI-совместимый? | `api-fallback.js`, `host_permissions` |
| (Опц.) ключ хранилища API | `apiKey_copilot` | `api-fallback.js` |
| Поведение стрима (скорость, скрытая вкладка) | — | `model-policy.js` |

DOM-аудит провести вручную (или через SelectorPicker/`content-scripts/element-picker.js`):
найти селекторы поля ввода, кнопки отправки, контейнера ответа и индикатора генерации,
с 2–3 fallback-вариантами на каждый.

---

## 2. Полный список файлов под изменение

### A. Манифест и разрешения
1. `manifest.json` — `host_permissions`: домен страницы (+ API host при API-fallback).
2. `manifest.json` — `content_scripts[0].matches`: добавить паттерны страницы в **общий бандл**.
3. `manifest.json` — **новый** объект в `content_scripts` для `content-copilot.js`
   (с теми же тремя prepend-файлами: `selector-profile-lifecycle.js`,
   `selector-resolver-v2.js`, `response-lifecycle-detector.js`).
4. `manifest.json` — поднять `version`.

### B. Background (service worker)
5. `background/index.js` — `importScripts(...)`: добавить `'../selectors/copilot.config.js'`
   (по алфавиту, до `selectors-config.js`).
6. `background/llm-targets.js` — запись в `LLM_TARGETS` (`url`, `delay`, `queryPatterns`)
   и при необходимости в массив `fallback` внутри `LLM_URL_PATTERNS`.
7. `background/health-monitor.js` — `SCRIPT_MAP['Copilot'] = 'content-scripts/content-copilot.js'`.
8. `background/telemetry-logs.js` — `LLM_NAME_ALIASES` (`copilot: 'Copilot'` и алиасы).
9. `background/evaluation-manager.js` — `evaluatorUrls['Copilot']`.
10. `background/tab-manager.js` — URL-паттерны (массив ~стр. 90) и при желании `PREWARM_MODELS`.
11. `background/message-router.js` — разбор `source → имя` (блок ~стр. 1189):
    `if (source.includes('copilot')) return 'Copilot';`.
12. `background/api-fallback.js` *(если нужен API-fallback)* — запись в `apiFallbackConfig`
    (`endpoint`, `model`, `storageKey`, заголовки/builder; для не-OpenAI формата — свой
    `buildXxxRequest`/парсер ответа).
13. `background/job-orchestrator.js` — добавить `'Copilot'` в релевантные наборы моделей
    (см. §3.B — это политики восстановления/материализации, по умолчанию включить в большинство).

### C. Селекторы
14. `selectors/copilot.config.js` — **новый** файл: `SelectorConfigRegistry.Copilot` со структурой
    `versions[]` (`version`, `uiRevision`, `expiresAt`, `markers`, `selectors.{composer,sendButton,response}`,
    `constraints`, `observation`, `anchors`) и `emergencyFallbacks`. Шаблон — `selectors/grok.config.js`.
15. `selectors/config-bundle.js` и `selectors/config-bundle.json` — добавить блок
    `Copilot` (emergencyFallbacks + observationDefaults), если бандл используется как remote-fallback.

### D. Content-script (адаптер)
16. `content-scripts/content-copilot.js` — **новый** файл. Базис — `content-scripts/content-deepseek.js`
    или `content-grok.js`: IIFE + duplicate-guard, `const MODEL = 'Copilot'`,
    `BaseLLMAdapter({ model, isValidUrl })`, интеграция Pragmatist/Humanoid/pipeline,
    обработчики сообщений `CHECK_READINESS`, `GET_ANSWER`, `GET_FINAL_ANSWER`,
    `HEALTH_CHECK_PING`, `ANTI_SLEEP_PING`, `STOP_AND_CLEANUP`, `HUMANOID_FORCE_STOP`, `getResponses`,
    диагностический `SCRIPT_LOADED`.

### E. Политики и общая логика
17. `shared/model-policy.js` — `MODEL_POLICIES.Copilot` (`stableTextMs`, `promptSubmitTimeoutMs`,
    `conservativeDispatch`, `requireAckReady` и т.д.) + алиас в `normalizeModelName` при необходимости.

### F. UI
18. `popup.html` — чекбокс `<input name="llm" value="copilot" checked> Copilot` и блок ответа
    (`#copilot-response .response-content`, заголовок `<h3>Copilot</h3>`).
19. `popup.js` — `responseMap.copilot = document.querySelector('#copilot-response .response-content')`.
20. `results.js` — `nameMap` в `getSelectedLLMs()` (`'copilot': 'Copilot'`) и любые места
    рендера колонок/иконок/порядка моделей.
21. `result_new.html` / `pipeline_panel.html` — колонка/кнопка/иконка модели в UI результатов,
    если модель должна отображаться в полностраничном режиме.

### B+. Доп. background / content-карты (выявлено при ревизии)
13a. `background/dispatch-coordinator.js` — per-model timeout-карта (`Copilot: <ms>`) и список
    `CONSERVATIVE_MODELS` (если модель «осторожная» по диспатчу).
16a. `content-scripts/content-utils.js` — карты `name→host` (~стр. 41) и `host→name` (~стр. 585).
16b. `content-scripts/unified-answer-pipeline.js` — карта `platform→Name` (~стр. 90); при
    необходимости специальный stabilization-helper (как `PerplexityStabilization`).
16c. `content-scripts/model-selection-toolbar.js` — карта имён (~стр. 15).
16d. `content-scripts/pragmatist-runner.js` — `host→platform` (~стр. 24), per-platform селекторы
    (~стр. 65), карта имён (~стр. 89).
16e. `content-scripts/notes-sidebar-inject.js` — `host→platform` и карты имён (~стр. 932/943/967).
16f. `pipeline/pipeline-runtime.js` — список моделей пайплайна (`{ name: 'Copilot', defaultActive }`).
16g. `results-devtools.js` — карта `llm-<id> → Name` (~стр. 50).

### G. Тесты и документация
22. `tests/` — новый тест(ы) под адаптер/селекторы; обновить затрагиваемые
    (`model-policy.test.js`, snapshot’ы наборов моделей, telemetry-name тесты).
23. `docs/project-overview.md` — список поддерживаемых моделей.
24. `docs/CHANGELOG.md` — запись об изменении (формат «Для чего / Изменение / Файл»).
25. `package.json` — синхронизировать `version` с manifest.
26. `icons/` — иконка модели, если UI её показывает.

---

## 3. Детализация по компонентам

### 3.A Manifest

- В `host_permissions` добавить `"*://copilot.example.com/*"`; при API-fallback — `"https://api.copilot.example.com/*"`.
- В `content_scripts[0].matches` (общий бандл с `purify`, `selector-manager`, `unified-answer-pipeline` и т.д.)
  добавить паттерны страницы — **без этого** общий пайплайн не инжектится.
- Добавить отдельный объект `content_scripts` (как у остальных моделей) с массивом из 4 файлов,
  последний — `content-scripts/content-copilot.js`, `run_at: "document_end"`.
- Все три списка паттернов (`host_permissions`, общий `matches`, персональный `matches`)
  должны совпадать по доменам.

### 3.B Background — наборы моделей в `job-orchestrator.js`

Эти `Set` управляют логикой восстановления/материализации. Рекомендация для новой
web_ui-модели — включить в большинство (как у `DeepSeek`/`Qwen`), кроме узкоспециализированных:

| Набор | Назначение | Включать Copilot? |
|---|---|---|
| `PRE_TERMINAL_MATERIALIZE_MODELS` | дозабор ответа перед терминальной ошибкой | **Да** |
| `DEFER_STREAM_FINAL_MODELS` | отложенная финализация стрима | **Да** |
| `EARLY_TERMINAL_GUARD_MODELS` | защита от раннего терминала | **Да** |
| `LATE_COLLECT_SLOW_MODELS` | увеличенные таймауты позднего сбора | По скорости модели |
| `MATERIALIZE_LATEST_RETRY_MODELS` | ретрай материализации последнего ответа | Да, если стрим медленный |
| `DOM_SNAPSHOT_RECOVERY_MODELS` | восстановление через DOM-snapshot | Да, если ответ остаётся в DOM |
| `HARD_STOP_DEFER_RECOVERY_MODELS` | deferred-recovery после hard-stop | **Да** |
| `ROUND2_REPAIR_MODELS` | repair-dispatch при «prompt not confirmed» | **Да** |
| `EARLY_GESTURE_RECOVERY_MODELS` | модели, требующие user-gesture | Только если UI этого требует |
| `CONNECTION_FRAGILE_RECOVERY_MODELS` | хрупкое соединение | Обычно нет |

Также проверить захардкоженные списки доменов внутри `job-orchestrator.js` (например, ~стр. 5364)
и при необходимости добавить домен модели.

### 3.C Селекторы — `selectors/copilot.config.js`

Минимально один актуальный `versions[]`-элемент:

```js
SelectorConfigRegistry.Copilot = {
  versions: [{
    version: 'copilot-2026-q2',
    uiRevision: '2026.2',
    expiresAt: '2026-09-30T00:00:00Z',   // дата ревизии для алертов об устаревании
    dateCreated: '2026-06-22T00:00:00Z',
    description: '…',
    markers: [{ selector: '<уникальный маркер UI>' }],
    selectors: {
      composer:   [ /* 3–6 вариантов поля ввода */ ],
      sendButton: [ /* 3–8 вариантов кнопки */ ],
      response: {
        primary:  [ /* контейнеры ответа */ ],
        fallback: [ /* запасные */ ],
        extraction: { method: 'innerText', cleanup: 'full' }
      }
    },
    constraints: { composer: { exclude: [/* поиск/прочее */] }, sendButton: { exclude: [...] } },
    observation: {
      rootSelector: 'main',
      targetSelectors: [ /* за чем наблюдает watcher */ ],
      stabilizationDelayMs: 1600,
      endGenerationMarkers: [{ selector: '.spinner, [aria-busy="true"]', type: 'disappear' }]
    },
    anchors: { composer: ['Ask…'], sendButton: ['Send'], response: ['Copilot'] }
  }],
  emergencyFallbacks: {
    composer:   ['div[role="textbox"]','[contenteditable="true"]','textarea'],
    sendButton: ['button[type="submit"]','button[aria-label*="send" i]'],
    response:   ['[class*="response"]','article','main']
  }
};
```

Требования: ≥2 fallback на каждый тип элемента; `markers` должны однозначно идентифицировать
версию UI; `endGenerationMarkers` обязателен для корректной финализации.

### 3.D Content-script — `content-copilot.js`

Скопировать структуру `content-deepseek.js` и заменить:
- `MODEL = 'Copilot'`, guard-переменную (`copilotContentScriptLoaded`), `isValidUrl` под домен;
- `getPragPlatform()`/`llmName` → `Copilot`;
- список `HANDLERS` оставить полным (см. §2.D).

Адаптер использует общий пайплайн (`unified-answer-pipeline`, `selector-manager`), поэтому
основная специфика — корректный `isValidUrl`, guard и платформенное имя; извлечение ответа
идёт через селекторы из конфига.

### 3.E API-fallback (опционально)

Если формат OpenAI-совместимый — достаточно записи в `apiFallbackConfig` (endpoint/model/storageKey)
и переиспользования `buildOpenAICompatibleRequest`. Для иного формата — отдельный builder запроса
и парсер ответа. Добавить host в `host_permissions`. Если API нет — выставить
`apiDirectAllowed: false` в политике и пропустить блок.

### 3.F UI

- `popup.html`: чекбокс + блок ответа + заголовок. `popup.js`: запись в `responseMap`.
- `results.js`: `nameMap` (`copilot → Copilot`) в `getSelectedLLMs()`; проверить рендер
  колонок, иконок и порядка моделей в полностраничном UI.
- При наличии — иконка в `icons/`, отображение в `result_new.html`/`pipeline_panel.html`.

---

## 4. Тестирование и приёмка

### 4.1 Статика
- `npm test` (Jest) — без регрессий; обновить тесты, опирающиеся на списки моделей.
- Проверить, что manifest валиден и расширение загружается без ошибок MV3.

### 4.2 Функциональная проверка (на реальной странице)
1. Открыть веб-интерфейс модели → content-script инжектится, в консоли `SCRIPT_LOADED`.
2. Из попапа выбрать только Copilot, отправить prompt → composer находится, текст вводится,
   кнопка отправки срабатывает.
3. Дождаться ответа → `response` извлекается полностью, финализация без ложного «красного хвоста».
4. Проверить телеметрию: имя нормализуется в `Copilot`, нет «unknown evaluator».
5. Проверить восстановление: скрытая вкладка, медленный стрим, повторный prompt (Round2 repair).
6. (Если есть API) проверить fallback при недоступности веб-UI.

### 4.3 Регрессия
- Полный прогон со всеми моделями: новая модель не ломает существующие колонки/оркестрацию.

---

## 5. Версионирование и документация
- Поднять `version` в `manifest.json` и `package.json` (синхронно).
- Запись в `docs/CHANGELOG.md` (формат: «Для чего / Изменение / Файл»).
- Обновить список моделей в `docs/project-overview.md`.

---

## 6. Definition of Done (чеклист)

- [ ] `manifest.json`: host_permissions (+API), общий `matches`, отдельный content_script, version
- [ ] `background/index.js`: importScripts конфига селекторов
- [ ] `background/llm-targets.js`: LLM_TARGETS + паттерны
- [ ] `background/health-monitor.js`: SCRIPT_MAP
- [ ] `background/telemetry-logs.js`: LLM_NAME_ALIASES
- [ ] `background/evaluation-manager.js`: evaluatorUrls
- [ ] `background/tab-manager.js`: URL-паттерны (+prewarm при необходимости)
- [ ] `background/message-router.js`: source→имя
- [ ] `background/job-orchestrator.js`: наборы моделей + домены
- [ ] `background/api-fallback.js`: API-конфиг (если применимо)
- [ ] `background/dispatch-coordinator.js`: timeout-карта + CONSERVATIVE_MODELS
- [ ] `content-scripts/content-utils.js`: name↔host карты
- [ ] `content-scripts/unified-answer-pipeline.js`: platform→name (+stabilization helper)
- [ ] `content-scripts/model-selection-toolbar.js`: карта имён
- [ ] `content-scripts/pragmatist-runner.js`: host→platform + селекторы + карта имён
- [ ] `content-scripts/notes-sidebar-inject.js`: host→platform + карты имён
- [ ] `pipeline/pipeline-runtime.js`: список моделей пайплайна
- [ ] `results-devtools.js`: карта id→name
- [ ] `selectors/copilot.config.js`: новый реестр
- [ ] `selectors/config-bundle.{js,json}`: блок модели (если используется)
- [ ] `content-scripts/content-copilot.js`: новый адаптер
- [ ] `shared/model-policy.js`: MODEL_POLICIES + алиасы
- [ ] `popup.html` / `popup.js`: чекбокс + блок ответа + responseMap
- [ ] `results.js`: nameMap + рендер
- [ ] `result_new.html` / `pipeline_panel.html` / `icons/`: UI (если нужно)
- [ ] Тесты добавлены/обновлены, `npm test` зелёный
- [ ] Ручная проверка send/extract/финализация/восстановление
- [ ] `docs/project-overview.md` + changelog + bump версии

---

## 7. Риски и типичные ошибки

- **Рассинхрон паттернов**: домен добавлен в `host_permissions`, но не в общий `matches`
  или в `llm-targets.js` → пайплайн не инжектится / вкладка не находится.
- **Имя в разных регистрах**: каноническое `Copilot` vs value `copilot`; пропуск одной из карт
  (`LLM_NAME_ALIASES`, `nameMap`, `SCRIPT_MAP`) → телеметрия «unknown», нет извлечения.
- **Нет в наборах оркестратора** → отсутствует восстановление, ложные терминальные ошибки.
- **`expiresAt`/markers** не настроены → конфиг считается устаревшим или версия не детектируется.
- **Нет `endGenerationMarkers`** → финализация по таймауту, «красный хвост».
- **Remote selectors hash**: при использовании remote-бандла учесть `TRUSTED_REMOTE_SELECTORS_HASH`
  в `selectors-config.js` (хэш меняется при изменении доверенного бандла).
- **importScripts порядок**: конфиг селекторов должен грузиться до `selectors-config.js`.

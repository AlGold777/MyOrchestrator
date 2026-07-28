# Release packaging checklist (F2/F3/F8/F9)

Дата: 2026-06-16. Что приведено в порядок к релизу и что осталось за product owner.

## Сделано в этом этапе

- **WAR сужен** (R2): `web_accessible_resources[0].matches` — с `["<all_urls>"]` до 14 origin'ов LLM-платформ (совпадает с `content_scripts` matches). Ресурсы инжектятся только контент-скриптами на доменах платформ, поэтому сужение безопасно; страница результатов грузит свои ресурсы по `chrome-extension://` и от matches не зависит.
- **dist/ убран из трекинга** (F2): не шипится манифестом (грузятся сырые `content-scripts/`), генерится `npm run build:bundles`. Раньше дрейфовал. Untracked + добавлен в `.gitignore`.
- **Кодировка комментариев** (F8): починены битые UTF-8 комментарии в `dispatch-coordinator.js`, `job-orchestrator.js`, `unified-answer-pipeline.js`.

## Остаётся за product owner (R1/R2) — блокеры стора

1. **`host_permissions` на API-эндпоинты** (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `api.mistral.ai`, `dashscope.aliyuncs.com`, `api.deepseek.com`, `api.perplexity.ai`). API-транспорт за фичефлагом и **выключен** (ТЗ, этап 1). Запрос 8 host-permissions «на будущее» — burden на ревью стора.
   - *Рекомендация:* перенести API-эндпоинты в `optional_host_permissions` и запрашивать по факту включения API-фичи, либо убрать до релиза версии с API.
2. **`*://x.com/*`** — широкий доступ ко всему x.com (нужен, т.к. Grok живёт там). Честно описать в листинге; альтернативы сузить нет без поломки Grok.
3. **Humanoid-эмуляция** (`humanoid.js`, `human-presence`) — описать функциональность честно; план деградации при детекте блокировки (R1).
4. **tos-consent** при первом запуске (ключ `tos_acknowledged_v1`) — проверить, что оверлей показывается и принимается (ручной смоук).

## Ручной смоук перед сабмитом (требует Chrome)

1. `chrome://extensions` → Load unpacked → SW грузится без ошибок `importScripts`.
2. Результаты: consent-оверлей появляется, после принятия — исчезает.
3. Ран на 2 моделях: вкладки открываются, ответы собираются.
4. Повторный ран во время рана → «Another run is already in progress».
5. **(F1)** Ран с долгим/зависшим ответом (напр. Le Chat) → в логах НЕТ потока `RECOVERY_INTENT_DENIED` каждые ~2с; денел максимум один раз в 15с.
6. **(F6)** Ран в чат с историей (не новая страница) → ни одна модель не финализирует прошлый ответ; в телеметрии при отсутствии нового ответа — `stale_baseline`/`finalization_stale_baseline`, а не подхват старого.

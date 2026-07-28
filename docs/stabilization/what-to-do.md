# What to do — открытый backlog улучшений

Дата: 2026-06-16. Единый список того, что **выявлено, но ещё не сделано**. Что уже сделано — см. `docs/CHANGELOG.md` и тематические доки в этой папке. Приоритеты: **P0** релизный блокер / корректность, **P1** заметное улучшение, **P2** долг/качество.

---

## 1. Механика получения ответов (детали — `answer-mechanics-review-followups.md`)

- [~] **P1 — «ответ принадлежит этому промпту» (усиление F6).** (частично, 2.80.44) F6 (text-signature) кросс-адаптерный и закрывает основной кейс; pipeline-finalize дополнительно отклоняет non-answer (provider_error/ui_noise/empty) через классификатор. **Node-fingerprint/turn-index НЕ внедрён осознанно:** идентичность DOM-узла НЕ безопасный сигнал staleness — платформы переиспользуют тот же узел при стриминге, поэтому отклонять по узлу нельзя. Безопасный вариант (turn-index increase) требует надёжного per-platform селектора «все ассистент-ходы» — отдельная проработка.
- [x] **P1 — follow-up baseline guard во всех адаптерах.** (2.80.104) Все web-адаптеры снимают pre-send baseline, отправляют его в background (`DISPATCH_BASELINE_CAPTURED`) и прокидывают в `UnifiedAnswerPipeline({ baselineText })`; DOM fallback пути ChatGPT/Perplexity/DeepSeek/Le Chat отклоняют baseline-равный кандидат; router валидирует baseline-событие по run/dispatch/tab; snapshot-cache не сохраняет baseline-равный stale answer.
- [ ] **P1 — behavioral DOM-тесты follow-up stale answer.** Нужны fixture-сценарии вместо одних source-contract assertions: старый assistant уже в DOM, follow-up отправлен, pipeline возвращает `stale_baseline_answer`, DOM fallback/recovery/cache пытаются вернуть старый ответ и не имеют права эмитить `LLM_RESPONSE`/SUCCESS. Покрыть минимум ChatGPT fallback, Qwen/Le Chat recovery, late `DISPATCH_BASELINE_CAPTURED` от старого dispatch и snapshot-cache write.
- [x] **P1 — content-classifier вместо `textLength >= 20`.** (2.80.44) `shared/answer-content-classifier.js`; подключён в gate детектора + доступен в background. `partial_stream` оставлен lifecycle-слою (нужен стрим-контекст).
- [x] **P0 — manual ping не форсит terminal success на слабом evidence.** (2.80.44) `acceptLateCollectResult` гейтит force на terminal-eligibility (длина+не-эхо). Полный перенос решения в `FinalizationController` для ВСЕХ источников — остаётся как более крупный рефактор (P2).
- [x] **P1 — селекторы по tier'ам + selector-health → extraction.** (2.80.48–49) `classifySelectorTier` тегирует ответ; tier → `finalizationResult` + телеметрия (`finalization_low_tier_selector`). `getAnswerElement` теперь **консультирует `window.SelectorCircuit`** (пропускает disabled-селекторы) и **кормит его на finalize**: success для победившего селектора, failure для более приоритетного, промахнувшегося при победе нижнего (дрейф → авто-демотинг после порога). Защита «low-tier требует подтверждения» обеспечена classifier-гейтом. Остаток-полировка: подача `'unknown'` в tri-state из health-сигнала (опционально).

## 2. Финализация (детали — `finalization-decision-audit.md`)

- [x] **P1 — backoff у recheck-пингов deferred-финализации.** (2.80.43) `nextDeferRecheckDelay`: 8с → ×1.6 → cap 32с, сброс на рост длины.
- [x] **P1 — property-тест тайминга через `log-replay-harness`.** (2.80.43) `finalization-backoff-and-replay.test.js`: deferred→forced→PARTIAL = один терминал, дубль игнор.
- [x] **P2 — свести пороги в один конфиг.** (2.80.43) Блок «Finalization timings» в `job-orchestrator.js` с комментарием-шапкой.
- [x] **P1 — Perplexity stale-cache PARTIAL.** (2.80.51) Лог 09-44: PARTIAL@2309 из `snapshot_cache` — весь snapshot-бюджет (3/3) сгорел на `PING_TRANSPORT_ERROR (message port closed)`, не дав свежего чтения DOM, затем fallback на устаревший кэш середины генерации. Фикс: `refundRecoveryBudget`/`hasRecoveryBudgetRemaining` — попытка снапшота возвращается в бюджет, если не прочитала живой DOM (miss/cooldown/in-flight); `snapshot_cache`-PARTIAL не финализируется, пока есть бюджет и нет completion-evidence (refund+defer на свежее чтение), кэш — только последний рубеж. Тест: `recovery-budget-tuning.test.js`.

## 3. MV3-устойчивость (детали — `mv3-state-inventory.md`)

- [x] **P0 — reconcile вместо потерянных `setTimeout`.** (2.80.45+) Оказалось, базовый механизм уже есть: `MV3_SURVIVAL_ALARM` (период 30с, пока есть открытые модели) → `loadJobState` → `rehydrateActiveJobRuntime` пере-вооружает collection-пинги + supervisor; `ensureInitialState` лениво грузит jobState при пробуждении по сообщению. **Добавлен `chrome.runtime.onStartup` → loadJobState** — закрывает окно «до 30с» на холодном старте браузера. Per-timer переписывание `setTimeout`→alarm не требуется: 30-секундный reconcile бэкстопит любой потерянный session-таймер (нет зависших ранов). Тест: `mv3-reconcile.test.js`.
- [x] **P1 — идемпотентность доставки при reconcile.** rehydrate сбрасывает `dispatchInFlight=false` и пере-вооружает именно **сбор** (collection ping), а не повторную отправку промпта; повтор отправки гейтится `promptSubmittedAt`/`confirmedDispatchId`. Дополнительная персистенция `dispatchIdRegistry` — не требуется для корректности (риск только в редком окне).
- [~] **P1 — осиротевшие промисы.** Не актуально как hazard: при рестарте SW и сами промисы (`promptSubmitWaiters`/`earlyReadyWaiters`), и их awaiter'ы исчезают вместе (всё in-memory одного контекста). Оставлено как наблюдение.

## 4. UI главной страницы

- [ ] **P1 — корень схлопывания геометрии (симптом лечится recovery; ждём данные телеметрии).** Левый сайдбар клампится [240,360] — не он. Теперь `recoverUiIfHidden` шлёт в телеметрию условие-триггер (2.80.43); по реальным логам определить, что именно срабатывает (textLen0 при тяжёлом ре-рендере? body display:none? `--devtools-panels-height`?), и точечно зафиксировать причину.
- [x] **P2 — recovery-триггер в телеметрию.** (2.80.43) `recoverUiIfHidden` → `LLM_DIAGNOSTIC_EVENT` (llmName `UI`) с деталями условия.

## 5. Профили генерации / модели

- [x] **P1 — изоляция профиля для Debate.** (2.80.46+) Debate по-прежнему форсит LONG per-turn (runModelBatch), но `finalizeSerialDebateRuntime` восстанавливает общий флаг к выбору пользователя на главной по завершении дебата — «залипания» LONG после дебата больше нет. Полное прокидывание профиля через payload (без общего флага вовсе) — более крупный рефактор, не требуется сейчас.
- [~] **P2 — донастройка SHORT.** По данным лога 21-12 (2.80.41 SHORT): Grok 2329, Perplexity 1602 — обрезок нет; snapshot-бюджет Gemini/Perplexity поднят. Изменений сейчас не требуется; пересмотреть только если новые SHORT-прогоны покажут truncation.
- [x] **P2 — Gemini false PARTIAL (UX).** (2.80.49) Тултип индикатора для снапшот-PARTIAL с адекватной длиной теперь объясняет: «Recovered after a stream drop — length looks complete (marked partial: completion not confirmed)» вместо безликого «partial answer» — снимает путаницу «почему оранжевый, если ответ полный». Цвет-оттенок индикатора не меняли (центральный UI; **без** relabel PARTIAL→SUCCESS, guard от обрывков сохранён).

## 6. Архитектура / техдолг

> Верхнеуровневая рамка и фазовый план — `global-code-review-2026-06-18.md` (architecture pass).

- [~] **P2 — распил монолитов.** `results.js` (~18k строк) и `background/job-orchestrator.js` (~7k). План — `monolith-decomposition-plan.md`. **(2.80.75)** Debate-рантайм вынесен как явный FSM `disput/debate-runtime.js` (`DebateFSM`): машина состояний (форма, A0/B0-gate, A/B-routing, статус-цикл, прогрессия ходов, чистые мапперы), results.js делегирует в 26 сайтах. Остаток — UI-оркестрация дебата (dispatch/approval/cancel/pause, DOM-завязана) + общий распил job-orchestrator: требуют отдельных заходов с браузерным смоуком.
- [~] **P2 — шаг сборки / контракт загрузки (F-A).** (2.80.74) esbuild-модульный бандлинг неприменим (classic-скрипты, общий global scope). Поставлено: `tests/content-load-order.test.js` (явный контракт: файлы существуют, 0 коллизий top-level decl в co-injected наборе) + opt-in конкатенирующий `scripts/build-content-bundle.js` (`npm run build:content-bundle`, вывод в gitignored `dist/`, все бандлы `node --check`-валидны). **Манифест не переключён** на бандл — сознательный no-build выбор владельца (drift vs parse); cutover = решение владельца. План — §3 Фаза 1.
- [~] **P2 — де-дубликация адаптеров (F-B пересмотрена).** (2.80.74) Находка завышена: `BaseLLMAdapter` инстанцируется всеми 8, общая логика уже в `ContentUtils`/`UnifiedAnswerPipeline`; одноимённые хелперы разошлись по провайдерам и закрываются над провайдерскими координаторами (`attachFilesToComposer` — 8 разных тел). Безопасного механического дедупа нет; слияние = пер-провайдерный рефактор с браузерным смоуком (вне автономного объёма). Кода не меняли. План/коррекция — §F-B, §3 Фаза 2.
- [x] **P1 — единый logger с уровнями.** (2.80.73) `shared/logger.js` (`LLMLog`): error/warn всегда, debug/info/log за флагом (default OFF, `__llm_debug_logging__`). Все 119 background `console.log/info` → `globalThis.LLMLog?.debug?.` (safe no-op в vm-тестах). warn/error не тронуты. Тест `logger.test.js`. F-D для content/results.js — остаток (P2).
- [x] **P1 — redaction-тест секретов.** (2.80.72) `shared/secret-redaction.js` (маскирует secret-поля + формы ключей провайдеров) + `tests/secret-redaction.test.js` (вкл. regression-guard). Подключён в реальные пути экспорта: telemetry JSON/copy, All Logs markdown.
- [x] **P2 — мёртвый код (sweep чистый).** Проверено: нет висячих ссылок на удалённые `background/circuit-breaker.js` / `shared/debate-engine.js`; все `importScripts` и `<script src>` таргеты существуют; `dist/` untracked+gitignored (оставлен как dev-артефакт `build:bundles`); tmp-файлы gitignored. Кода менять не потребовалось.

## 7. Релизная упаковка / стор (детали — `release-packaging-checklist.md`, `risk-register.md`)

- [ ] **P0 (product owner) — API `host_permissions` → `optional_host_permissions`.** 8 API-эндпоинтов запрашиваются «на будущее», но API за фичефлагом выключен — burden для ревью стора. Запрашивать по факту включения API-фичи.
- [ ] **P1 (product owner) — `*://x.com/*`** широкий доступ (нужен для Grok) — честно описать в листинге.
- [ ] **P0 (product owner) — humanoid-эмуляция (R1).** Стратегия деградации при детекте блокировки + честное описание функциональности.
- [ ] **P1 — ручной смоук перед сабмитом.** Чек-лист в `release-packaging-checklist.md` (SW грузится, consent-оверлей, ран на 2 моделях, повторный ран, F1/F6 проверки). Требует Chrome — автономно не выполнен.

---

### Что уже сделано (для контекста, не делать повторно)
F1 recovery-троттлинг • F6 baseline-якорь • tri-state завершения (P0.2) • recovery-бюджет connection-fragile • Qwen voice-button • severity prompt_echo • Debate→LONG • главная→LONG по умолчанию • быстрый UI-recovery на возврате/завершении • F2 dist • F3 WAR • F8 кодировка • F4/F5 аудиты.

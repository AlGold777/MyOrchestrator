# Большие треки: план реализации (по итогам двух review 2026-07-02)

Статус: design. Фазы A–D (границы доверия, позиционный якорь, reuse preflight, CSP-safe bridge) реализованы в 2.80.138–2.80.141. Ниже — треки, которые сознательно НЕ выполнялись в автономном срезе, потому что требуют реальных smoke-run'ов по моделям на каждом шаге.

---

## Трек 1 — Content runtime unification (9 скриптов → 1 runtime + конфиги)

**Цель:** убрать ~12k LOC копипасты и класс дрейф-багов (`attachmentHandler is not defined` жил в 2 копиях из 9).

**Что уже есть:** `base-adapter.js`, декларативные `selectors/*.config.js`, общий `attachment-handler.js` (образец паттерна), `unified-answer-pipeline.js` (общий extraction/lifecycle), `content-zai.js` — 309 строк, фактический прототип цели.

**Порядок миграции (по одной модели на срез, каждый — со smoke-run):**
1. Инвентаризация уникальной логики каждого скрипта (diff против content-zai структуры): у Grok — trusted clipboard paste + composer snapshot; у Qwen — drop-attach и prompt-echo фильтры; у Gemini — CDP files; у Claude —長 typing → перевести на paste-first (отдельный подшаг с высоким ROI: убирает 40s гоночное окно).
2. Расширить base-adapter хуками: `beforeAttach`, `insertPrompt`, `confirmSend`, `extractAnswer` (default = unified pipeline).
3. Пилот: Le Chat или Perplexity (простые). Миграция = конфиг + ≤100 строк хуков.
4. Смоук по модели → следующая. Порядок: Le Chat → Perplexity → DeepSeek → Z.ai(эталон) → GPT → Gemini → Qwen → Claude → Grok (самые кастомные — последними).
5. Гейт: скрипт удаляется только после 2 зелёных смоуков модели.

**Метрика успеха:** content-scripts/*.js суммарно < 8k LOC; ни одного `injectAndGetResponse` вне base-adapter.

---

## Трек 2 — Финализация как единый редьюсер

**Цель:** 8 конкурирующих контуров финализации подают события; решение принимает ОДНО место; телеметрия генерируется ИЗ решений, а не рядом. Здесь же закрывается dual-write `modelRunState` ↔ legacy.

**Шаги:**
1. Каталогизировать все 26 call sites `handleLLMResponse` → классифицировать вход как событие: `{kind: response|timeout|recovery|manual|snapshot, source, evidence, identity}`.
2. Ввести `FinalizationReducer.submit(event)` — обёртка, которая ВНУТРИ вызывает существующие проверки в фиксированном порядке: RunIdentity → sender/turn-anchor guards → PipelineFSM.shouldAcceptEvent → FinalizationController.tryFinalize → evidence/length policy → commit. Сначала как сквозной логирующий фасад (shadow mode: решения пишутся в телеметрию `REDUCER_DECISION`, поведение не меняется).
3. Сравнить shadow-решения с фактическими на 2–3 реальных прогонах (экспорты). Расхождения = найденные баги порядка проверок.
4. Переключить запись состояния на редьюсер; legacy-поля становятся проекцией (write-through), затем read-only.
5. Убрать прямые мутации `entry.finalStatus*` вне редьюсера (ESLint-правило/тест на grep).

**Гейт:** shadow mode ≥ 1 неделя реальных прогонов без расхождений.

---

## Трек 3 — Generation lifecycle из сети (fetch-monitor)

**Цель:** заменить башню DOM-эвристик (busy/stop/stable) первичным сигналом «SSE-стрим закрылся = генерация завершена». Был STOP-условием; теперь отдельный трек.

**Что уже есть:** `content-scripts/fetch-monitor.js` + `fetch-monitor-bridge.js` в кодовой базе.

**Шаги:**
1. Аудит fetch-monitor: какие провайдеры покрыты, какой контракт событий.
2. Shadow mode: события `NETWORK_GENERATION_START/END` пишутся в телеметрию параллельно DOM-детектору, ни на что не влияя.
3. Сравнение по реальным экспортам: где network-сигнал точнее DOM (ожидаемо: stuck-busy кейсы GPT/DeepSeek).
4. Повышение до primary-сигнала per-model через `ModelPolicy` (флаг `lifecycleSource: 'network'|'dom'`), DOM — fallback.

**Гейт на модель:** 3 зелёных смоука с совпадением network- и фактического завершения.

---

## Трек 4 — Full-loop replay-тесты

**Цель:** каждый реальный экспорт автоматически становится регрессионным тестом.

**Что уже есть:** `shared/log-replay-harness.js` (нормализация событий, per-model итог), `tests/log-replay-harness.test.js`, реальный `telemetry-1781134749690.json` в корне.

**Шаги:**
1. Расширить harness: вход = полный JSON-экспорт (grouped by platform + `<RUN_SUMMARY>`), выход = per-model `{finalStatus, terminal, staleRejected}`.
2. Тест: replay реального экспорта → derived outcomes == `RUN_SUMMARY.MODEL_OUTCOME` того же файла.
3. Каталог `tests/replay-fixtures/` — складывать туда каждый проблемный экспорт после разбора (сейчас их 6 в истории change-log).
4. (после Трека 2) Full-loop: скармливать события shadow-редьюсеру в VM и сравнивать терминальные решения.

---

## Порядок и зависимости

```
Трек 4 (replay) ──┐
                  ├─→ Трек 2 (reducer, shadow→prod)
Трек 1 (unification, по модели) — независимо, начать с paste-first для Claude
Трек 3 (fetch-monitor shadow) — независимо, дешёвый старт
```

Рекомендуемый следующий срез: Трек 1 шаг «Claude paste-first» (убирает 40s окно гонок, маленький, проверяется одним смоуком) + Трек 3 шаг 2 (shadow-телеметрия, ни на что не влияет, даёт данные для решения).

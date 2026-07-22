# Аудит таймингов по этапам работы со страницей модели

Дата: 2026-07-02, база 2.80.141. Источники: константы `background/job-orchestrator.js`, `background/dispatch-coordinator.js`, `config/timing.js`, `content-scripts/pipeline-config.js`, `humanoid.js`, `background/human-presence.js` + фактические тайминги из 4 реальных прогонов (1781134505984, 1782940321214, 1782944449199, 1782945983672).

## Главная находка: LONG-профиль не доходит до background

Переключатель «Generation wait profile: LONG» масштабирует **только content-сторону** (`pipeline-config.js`: adaptive ceilings до 450s, hardMax 450s), но все background-потолки — фиксированные константы: `SCRIPT_RUNTIME_HARD_STOP_MS=180s`, `DEFER_STREAM_FINAL_MAX_MS=180s`, `ROUND4_PENDING_WAIT_MAX_MS=190s`. В LONG-режиме контент готов терпеливо ждать 7.5 минут, а бек убивает скрипт на 3-й минуте. Это ровно GPT-кейс из прогона 1782944449199: hard stop на 180s посреди長 генерации → спасение снимком → PARTIAL/шум. Инверсия лестницы таймаутов: adaptive hardMax (450s) > HARD_STOP (180s).

**Принцип, которого не хватает:** лестница таймаутов, где каждый внешний уровень строго больше внутреннего, которым управляет:
`streamStart < adaptive ceiling < settlement < DEFER_MAX < HARD_STOP < ROUND4_GATE`, и вся лестница масштабируется профилем одним множителем.

## Таблица: текущие и рекомендуемые тайминги

Оценки: ✅ оптимально · ⚠️ работает, но неоптимально · 🔴 дефект/рассинхрон.

### Этап 0-1: открытие вкладок и dispatch

| Параметр | Текущее | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| ROUND0_OPEN_STAGGER_MS | 1000 | ⚠️ | 700 | 9 вкладок = 9s последовательного открытия; 700ms достаточно против rate-limit окон |
| ROUND0_BIND_WAIT_TIMEOUT_MS / POLL | 15000 / 250 | ✅ | — | согласовано с tabReadyTimeoutMs |
| tabLoadTimeoutMs / tabReadyTimeoutMs | 45000 / 15000 | ✅ | — | провайдеры грузятся долго при холодном старте |
| ROUND1_BEFORE_SEND_MS / POST_SEND_MS | 500 / 500 | ✅ | — | — |
| sendPromptDelayMs (TimingConfig) | 3000 | ⚠️ | 1500 | пауза после вставки до send; вставка подтверждается валидацией value, 3s — перестраховка ×2 |
| promptSubmitTimeoutMs | 20000 | ✅ | — | — |
| readyAckTimeoutMs / handshakeRetryMs | 6000 / 2000×5 | ✅ | — | — |

### Этап 2: ввод промпта

| Параметр | Текущее | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| Humanoid typing (fallback) | wpm-based, ≥30ms/char, без потолка | 🔴 | cap 15s на весь ввод, дальше — abort в paste-retry | Claude: 4652 chars = **40.2s печати**; всё это окно — гоночная зона (инцидент pre-send finalization). Печать длинного промпта посимвольно не имеет UX-смысла |
| CLAUDE_TYPING_TIMEOUT_MAX_MS | 180000 | 🔴 | 30000 | 3 минуты на ввод промпта — за это время весь run уходит в Round2/3 repair-штопор |
| Instant paste settle | 120–220ms | ✅ | — | — |

### Этап 3: ожидание генерации (ядро рассинхрона)

| Параметр | Текущее (SHORT / LONG) | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| streamStartTimeout | 20–45s / 60s | ✅ | — | — |
| adaptive ceilings (content) | 180s hardMax / **450s** hardMax | ✅ | — | сама лестница разумная |
| SCRIPT_RUNTIME_HARD_STOP_MS | **180s фикс.** | 🔴 | short 180s / **long 480s** | должен быть > content hardMax; сейчас в LONG убивает живую генерацию (GPT-кейс) |
| DEFER_STREAM_FINAL_MAX_MS | **180s фикс.** | 🔴 | short 180s / **long 460s** | тот же рассинхрон; «streaming_incomplete» наступает раньше, чем контент сдался |
| ROUND4_PENDING_WAIT_MAX_MS | **190s фикс.** | 🔴 | hard stop + 20s (short 200s / long 500s) | gate должен закрываться ПОСЛЕ hard stop, всегда |
| HARD_STOP_DEFER_WINDOW | 12s (18–24s по моделям) | ⚠️ | оставить, но станет редким | это пластырь на преждевременный hard stop; после фикса потолков сработки уйдут |
| DEFER recheck | 8s → 32s, backoff 1.6 | ✅ | — | — |
| DEFER_STREAM_STABLE_FORCE_MS | 30s | ✅ | — | — |
| STABLE_PENDING_AUTO_FINALIZE_MS | 15s | ✅ | — | Z.ai-инцидент был не таймингом, а отсутствием guard'ов (исправлено в 2.80.136/137) |
| EARLY_TERMINAL_GUARD (wait/stable) | 20s / 2.5s | ✅ | — | — |

### Этап 4: rounds / верификация

| Параметр | Текущее | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| ROUND2_BATCH_MAX_MS | **45000** | 🔴 | max(45s, N_моделей × 8s) | 9 моделей × 7s visit budget = 63s потребности при бюджете 45s → в каждом прогоне хвост моделей получает «verification skipped (batch timeout)» и лишается Round2-репейра |
| ROUND2_MODEL_VISIT_BUDGET_MS | 7000 | ✅ | — | — |
| ROUND2_VISIT (count/min/max) | 2 / 5s / 8s | ✅ | — | — |
| ROUND2_REPAIR_CONFIRM_WAIT | 3500 / poll 250 | ✅ | — | — |
| ROUND3 delays | 2s + 2s, visit 5–8s | ✅ | — | — |
| ROUND4_PENDING_POLL_MS / телеметрия | 1500 / 15000 | ✅ | — | — |
| NO_SEND_STALL_GRACE_MS | 45000 | ✅ | — | — |

### Этап 5: extraction / recovery / визиты

| Параметр | Текущее | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| DOM_FALLBACK (Grok) | 45s, poll 900ms | ⚠️ | 30s + событийный выход по lifecycle | 50 поллов/цикл; при adaptive-пробах каждые 12s циклы наслаиваются (JOINED); событ十ный выход дешевле |
| ADAPTIVE_PROBE лестница | 2.5s×20s → 6s×60s → 12s×180s | ✅ | long: total 180→450s | окно total должно жить в профиле, как и остальное |
| LATE_COLLECT (budget/ping/exec) | 12s / 0.9–1.5s / 3.5s | ✅ | — | — |
| LATE_COLLECT_SINGLE_FLIGHT_COOLDOWN | 2.5s | ✅ | — | защищает и от спама dblclick |
| SNAPSHOT TTL | 60 мин | ⚠️ | 30 мин | после dispatch-scoping (2.80.135) риск ниже, но час — много для living-кэша |
| RECOVERY maxTotalMs | 90s (fragile 120s) | ✅ | — | — |
| PRE_TERMINAL_MATERIALIZE visit/settle/cooldown | 5.2–7.6s / 1.1s / 45s | ✅ | — | — |
| VISIT_QUOTA (окно/макс/cooldown) | 60s / 12s / 15s | ✅ | — | подтверждено логами: quota-backoff работает как задумано |
| MANUAL_PING_WINDOW_MS | 20000 | ✅ | — | — |

### Этап 6: вложения

| Параметр | Текущее | Оценка | Рекомендуемое | Обоснование |
|---|---|---|---|---|
| attachmentTimeoutMs | 10s × число файлов × стратегию | ✅ | — | Grok ждал 23s на 2 стратегии — приемлемо; проблема была в confirm-селекторах (исправлено 2.80.133), не в тайминге |
| attachmentPollMs | 200 | ✅ | — | — |
| Gemini CDP (timeout/settle/evidence) | 90s / 2.5s / 15s | ✅ | — | материализация файлов через CDP оправдывает потолок |

## Топ-3 действия по ROI

1. **Пробросить профиль в background** (один множитель `waitProfileScale`: hard stop, defer max, round4 gate, adaptive total window). Устраняет целый класс «LONG-режим убивает длинные ответы»; GPT-кейс из последнего прогона исчезает как категория.
2. **Paste-first + cap на typing** (15s cap, Claude typing max 180s→30s). Убирает 40-секундное гоночное окно — самый крупный единичный выигрыш и по скорости, и по надёжности.
3. **ROUND2_BATCH от числа моделей.** Возвращает Round2-верификацию хвосту моделей в полных прогонах (сейчас 3-4 модели из 9 систематически её теряют).

Примечание: пункты реализуются маленькими правками констант/формул, но каждый требует smoke-run подтверждения (особенно №1 — изменение потолков меняет тайм-бюджет всего прогона).

---

## Дополнение: внутренние противоречия таймингов (аудит 2026-07-02, вторая итерация)

Проверены: инверсии «внутренний таймаут ≥ внешнего», дубли одной ручки в разных местах, одновременные истечения конкурирующих механизмов.

### 🔴 T1. Baseline-guard умирает раньше, чем приходит длинный ответ
`BASELINE_GUARD_WINDOW_MS = 120s`, при этом генерация легально длится до 180s (short) / 450s (LONG). Ответ, пришедший позже 2-й минуты, сравнивается с уже «протухшим» baseline → защита от предыдущего ответа отключается ровно в длинных прогонах, где она нужнее всего. (Частично компенсировано позиционным якорем F6.2 из 2.80.139 — у него нет срока жизни, — но сигнатурный guard для стриминга-в-тот-же-узел гаснет рано.) Рекомендация: окно = generation ceiling профиля + 60s.

### 🔴 T2. `promptSubmitTimeoutMs` живёт в 4 местах с 3 разными значениями
`config/timing.js` DEFAULTS = **20000**; `dispatch-coordinator.js` мёртвый фолбэк `getTiming(..., 7000)` (никогда не активен — DEFAULTS всегда определён, тот же анти-паттерн, что `|| 120` из 2.74.98); `shared/model-policy.js` default = **15000** с per-model overrides 20000; плюс legacy-карта `PROMPT_SUBMIT_TIMEOUTS_MS` там же в координаторе. Фактически действует ModelPolicy (15s default), а TimingConfig декларирует 20s. Рекомендация: единственный источник — ModelPolicy; TimingConfig-ключ и legacy-карту удалить, мёртвый фолбэк убрать.

### 🔴 T3. Два определения «стабильности» для одного pendingFinalAnswer
Defer-путь требует `DEFER_STREAM_STABLE_FORCE_MS = 30s` стабильности для форс-финализации, а параллельный таймер `STABLE_PENDING_AUTO_FINALIZE_MS = 15s` финализирует тот же pending вдвое раньше — слабый путь подрезает строгий (Z.ai-инцидент шёл именно 15s-путём). Рекомендация: один порог стабильности (30s), stable-pending — как механизм доставки, а не отдельная политика.

### 🔴 T4. Тройное одновременное истечение на t=180s
`ADAPTIVE_PROBE_TOTAL_WINDOW = DEFER_STREAM_FINAL_MAX = SCRIPT_RUNTIME_HARD_STOP = 180000`. Recovery-механизм (адаптивные пробы) умирает в ту же секунду, что и то, от чего он спасает — подтверждено логом 1781134505984: DeepSeek `ADAPTIVE_PROBE_STOP window_exhausted` в секунду `SCRIPT_RUNTIME_HARD_STOP 180000ms`. Рекомендация: лестница со сдвигом — probes window = hard stop + 60s (recovery обязан переживать смерть пациента).

### 🔴 T5. План визитов противоречит собственной квоте
Квота фокуса: `VISIT_QUOTA_MAX_MS = 12s` на окно 60s. Спланированные же визиты: Round2 2×5–8s + Round3 precollect 5–8s + post-R2 5–8s + materialize 5.2–7.6s ≈ 20–30s/мин. Система планирует в 2–3 раза больше foreground-времени, чем сама себе разрешает → `VISIT_QUOTA_BACKOFF` в каждом реальном прогоне (13–46s/60s в логах): запланированные визиты блокируют друг друга, и какой из них выживет — лотерея. Рекомендация: либо квота 20s/60s, либо планировщик визитов, который проверяет квоту ДО постановки визита и приоритизирует (materialize > round3 > round2-verify).

### 🔴 T6. Claude typing budget (до 180s) vs ROUND2_BATCH (45s)
Submit-таймаут Claude законно растягивается typing-бюджетом до 180s (`CLAUDE_TYPING_TIMEOUT_MAX_MS`), но Round2-батч живёт в 45-секундной картине мира: одна печатающая модель съедает весь батч, хвост получает `verification skipped (batch timeout)`. Усиливает основную проблему батча (см. таблицу): бюджет батча должен учитывать max(typing budget активных моделей).

### 🟡 T7. Typing guard был локальным для dispatch-координатора (закрыто)
`typingActive/typingGuardUntil` заводятся координатором именно чтобы «не судить страницу во время печати», но финализация их не читала — stable-pending сработал в середине печати Claude (инцидент 1782945983672). Закрыто в 2.80.136 gate'ом `awaitingSubmitConfirmation`; guard-поля остаются вторым, теперь избыточным механизмом — кандидат на слияние при Треке 2 (редьюсер).

### 🟡 T8. Пороги длины сбежали из answer-length-policy
Решение 2.74.98: «все пороги длины — в одном policy». Фактически вне policy живут: `EARLY_TERMINAL_GUARD_FORCE_SUCCESS_CHARS = 1800`, `MIN_PARTIAL_ANSWER_LENGTH = 120` (внутри handleLLMResponse), inline-scan `minChars: manualLatestRecovery ? 20 : 80`. Не тайминги, но то же заболевание «одна ручка в двух местах». Рекомендация: перенести в `answer-length-policy` как именованные поля.

### 🟡 T9. LATE_COLLECT-бюджет впритык
`LATE_COLLECT_TOTAL_BUDGET_MS = 12s` против суммы компонентов худшего пути: ping 1.5 + execute 3.5 + post-live 0.7 + retry-wait 1.8 + второй execute 3.5 ≈ 11s. Нулевой запас для slow-моделей (у которых ping и так 1.5s). Рекомендация: 15s либо считать бюджет из компонентов.

### Сводный приоритет фиксов противоречий
1. T1 + T4 + LONG-профиль (из первой части) — это ОДИН фикс: параметризованная лестница `waitProfileScale` (baseline window, probes window, defer max, hard stop, round4 gate — всё от одного множителя).
2. T5 — квота/планировщик визитов (заметный источник недетерминизма recovery в каждом прогоне).
3. T2 + T8 — консолидация ручек (submit-timeout → ModelPolicy; длины → answer-length-policy).
4. T3 — один порог стабильности.
5. T6 — batch-бюджет с учётом typing.


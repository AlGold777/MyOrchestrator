# План: декомпозиция монолитов + переход тестов на поведенческие

- **Версия:** 1.0
- **Дата:** 2026-06-15
- **Статус:** в работе (начато). Это многонедельный долг — здесь зафиксированы паттерн, очередь и правила.
- **Покрывает:** B.6 (вынос «островов» из монолитов) и B.5 (тесты → поведенческие). Они синергичны: вынос модуля делает код юнит-тестируемым.

---

## 0. Контекст

Монолиты: `results.js` (~18.4k строк), `background/job-orchestrator.js` (~7k), `background/message-router.js` (~2.1k). Большой файл = высокий риск регресса (баги прод-подготовки жили именно там). ТЗ запрещает big-bang распил — поэтому делаем **инкрементально, по одному острову, за каждым — зелёные тесты**.

## 1. Проверенный паттерн выноса (по `results.js`)

Уже вынесено (образцы):
- `results/tooltips.js` — floating-tooltip контроллер (через `window.ResultsTooltips.create({...})`).
- `results/boot-utils.js` — boot/reload/ссылочные хелперы (через `} = window.ResultsBootUtils;`, имена сохранены).

**Правила выноса (обязательны):**
1. **Вынос КОДА ТЕКУЩЕЙ ветки, дословно.** НЕ импортировать модули Doc_3 — проверено, что текущая местами впереди (mailto, `contenteditable`, MV3 `setTimeout(finish,250)`); импорт Doc_3 = тихий регресс.
2. Модуль — IIFE по шаблону: `(function install...(root){ if(!root||root.X) return; ... root.X = Object.freeze({...}); })(window||globalThis)`.
3. Зависимости: если функции используют только глобалы (`document`/`window`/`chrome`) — копировать дословно, без `create()`. Если нужны внутренние символы results.js — передавать через `create({deps})` (как `dom-utils`/`attachments` в Doc_3).
4. В `results.js`: заменить инлайн-определения на **деструктуризацию с теми же именами** → call-sites не меняются. Если имя-внутреннего состояния торчит наружу (как `tooltipTargets`) — рефакторить call-sites на публичный API контроллера.
5. Подключить `<script>` в `result_new.html` ПЕРЕД `results.js`; добавить eval во ВСЕ тест-харнессы, грузящие `results.js` (`results-debate-favorites`, `modifier-bootstrap-reset` — сейчас их два; следить за новыми).
6. После каждого выноса: `node --check results.js` + `npm test` зелёные. Один остров = один коммит.
7. Сразу писать **поведенческий** тест на вынесенный модуль (см. `tests/boot-utils.test.js`) — это и есть B.5.

## 2. Очередь островов `results.js` (по возрастанию риска)

| Остров | Прибл. строк | Зависимости | Риск | Статус |
|---|---|---|---|---|
| tooltips | ~80 | — | низкий | ✅ |
| boot-utils | ~130 | — | низкий | ✅ |
| dom-utils (html/sanitize/render helpers) | ~160 | `escapeHtml`, `sanitizeHTML`, `promptPasteBlockSelector` (+ `getListDepth`/`getListPrefix` перенесены внутрь; render-handler через `setIncrementalRenderHandler`) | средний | ✅ |
| attachments (prompt attach) | ~190 | dom-utils (`clearNode`,`replaceChildrenFromHtml`), `escapeHtml`, `showNotification`, DOM-узлы | средний | ✅ |
| pipeline-export (download html/feed) | ~165 | сборщики финального HTML | средний | ⬜ |
| diagnostics/selector-devtools панель | ? | много | высокий | ⬜ |
| disput serial-runtime (`serialDebateState` + route/cancel/pause) | ~600 | глубоко завязан | высокий | ⬜ (требует отдельного ТЗ) |

> Для dom-utils/attachments/pipeline-export код в Doc_3 уже расколот — но брать ТЕЛО ТЕКУЩЕЙ ветки (см. правило 1), сверяя построчно. Эти ветки run-time-логики (paste/render/attachments) **jsdom-харнесс покрывает только на init** — после выноса нужен ручной UI-прогон.

## 3. Очередь по `background/*` (после results.js)

- `job-orchestrator.js` (~7k) — самый опасный. Кандидаты на вынос в `shared/`: классификация статусов, сборка промптов, finalization-хелперы (часть уже в `shared/finalization-controller.js`, `shared/status-contract.js`). Только за фичефлагом, по одному.
- `message-router.js` (~2.1k) — вынести обработчики по типам сообщений в отдельные хендлеры.

## 4. B.5 — переход тестов на поведенческие

Проблема: масса ассертов вида `expect(source).toContain('...')` (снапшоты исходника) — ломаются при любом рефакторе и не проверяют поведение.

**Стратегия:**
1. **Не удалять снапшоты массово** — часть стережёт конкретные регрессии (напр. «нет `id="debate-start-btn"`»). Удалять только те, что дублируются поведенческим тестом.
2. На каждый вынесенный модуль — поведенческий тест (require + проверка вход/выход). Образец: `tests/boot-utils.test.js`.
3. Снапшот-ассерты, привязанные к месту кода, — при выносе **перенаправлять на новый файл** (как сделано для `DEBATE_TRANSCRIPT_STORAGE_KEY` → `boot-utils.js`), а не на `results.js`.
4. Приоритет на поведенческое покрытие **реального пути диспута и pipeline** (уже добавлено в этой серии: cancel, phase-gate, дедуп карточек, status-lock, programmatic-focus, dedup-card).
5. Цель-ориентир: для каждого нового `shared/`/`results/` модуля — ≥1 поведенческий тест; снапшоты на `results.js` сокращать по мере выноса.

## 5. Definition of Done (промежуточные)

- [x] Паттерн выноса проверен (tooltips, boot-utils) + поведенческий тест-образец.
- [x] Зафиксированы правила (особенно «брать код текущей, не Doc_3»).
- [ ] Вынесены dom-utils / attachments / pipeline-export (+ ручной UI-прогон).
- [ ] Снапшот-ассерты `results.js` сокращены ≥50% за счёт поведенческих.
- [ ] Начат вынос в `job-orchestrator.js` за фичефлагом.

> Каждый шаг — обратим (`git revert` одного коммита-острова). Никаких big-bang.

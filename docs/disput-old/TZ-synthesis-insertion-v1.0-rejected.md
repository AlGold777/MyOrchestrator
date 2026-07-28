# Техническое задание: Промежуточные Synthesis Stages через иконки «+»

Версия: 1.0
Приоритет: P0
Baseline: текущий HEAD (Codex обязан зафиксировать точный commit в отчёте)
Область: Pipeline Canvas (results.js), pipeline_panel.html, debate-plan-revision.js, debate-application.js, persistence, tests

Документ самодостаточен: все acceptance criteria записаны внутри, внешних ссылок на чужие ревью нет.

---

## 0. Инвентаризация HEAD (проверено по коду; Codex обязан перепроверить)

**Уже сделано движком — НЕ переделывать:**

| Возможность | Где | Статус |
|---|---|---|
| plannedStages — источник исполнения | `debate-planner.js:207` `proposePlannedStages`; в `evaluate()` `debate-planner.js:384` приоритет над goal-driven (`if (planned?.decision) return planned.decision`) | DONE |
| explicit participant assignment стадии | `debate-planner.js:176` `selectPlannedStageParticipants` берёт `stage.participantIds`, не capability-выбор | DONE |
| Позиционирование стадии | `debate-planner.js:160` `isPlannedStageReady`: `upstream` все terminal + `activationPolicy` (`immediate` / `finalization_ready`) | DONE |
| `config.synthesizer` → final synthesis stage | `debate-application.js:109` создаёт `planned-final-synthesis` (`participantIds:[synthesizer]`, `activationPolicy:'finalization_ready'`, `outputIntent:'candidate_final'`) + serviceOnly-участник | DONE |
| synthesizer доходит из UI до application | `results.js:5637` читает selector A → `results.js:5747` `synthesizer` в top-level config `debateApplication.start` | DONE |
| Команды плана | `debate-plan-revision.js:17` — `INSERT_STAGE`, `REMOVE_PENDING_STAGE`, `CHANGE_STAGE_ORDER`, `REQUEST_SYNTHESIS`, `CHANGE_PARTICIPANT` реализованы | DONE |
| goal-driven synthesis как fallback | `debate-planner.js:93` `produce_synthesis` (+ `correct_synthesis`, `audit_output`, `compact_context`) — работает ПОСЛЕ planned-stage приоритета | DONE, сохранить |

**Остаётся сделать (предмет этого ТЗ):**

| Дефект | Где | Требование |
|---|---|---|
| Run-start читает synthesizer из DOM (selector A) | `results.js:5637` `debateSynthesizerSelect?.value` | Читать из canonical state |
| `pipelineStore.overrides.synthesizers` как хранилище | `results.js` persist-путь | После миграции — не runtime source |
| Canvas synthesis-блок не привязан к PlanRevision | `results.js` `renderTriadSynthesisStage` (имя legacy) рендерит selector B из DOM-значения | Блок = projection final synthesis stage |
| Нет UI вставки между stages | `.stage-label` в pipeline_panel.html — одиночный, без `+` | Иконка `+` в строке `.stage-label` |
| Selector A в panel-header | `pipeline_panel.html:291` `debate-synthesizer-select` | Удалить (последняя фаза) |
| `INSERT_STAGE` использует `payload.index`, не `afterStageId` | `debate-plan-revision.js:174` `stages.splice(index,0,stage)` | Добавить резолв `afterPlannedStageId → index` |

---

## 1. Цель

Дать пользователю добавлять промежуточный synthesis между любыми двумя стадиями Canvas через иконку `+`. Вставленный synthesis:

1. существует как stage в active PlanRevision;
2. исполняется ровно в выбранной позиции (через `upstream` + `activationPolicy:'immediate'`);
3. имеет собственный participant assignment, независимый от других synthesis stages;
4. не запускается скрыто; не управляет StateMap/Planner; не завершает run.

Визуально:
```
R1 Models  (+)  R2 Disput          →  после «+» между R1 и R2:
R1 Models  (+)  Synthesis: Claude  (+)  R2 Disput
```

---

## 2. Инварианты

- **INV-1.** Future stage исполняется, только если присутствует в active PlanRevision.
- **INV-2.** Assignment принадлежит стадии. Изменение одной synthesis stage не меняет другие.
- **INV-3.** После завершения ТЗ runtime не читает синтезатор из DOM / `pipelineStore.overrides.synthesizers` / module-level переменной. Единственный путь — PlanRevision stage.
- **INV-4.** Пустой assignment synthesis stage → `PLAN_VALIDATION_FAILED / SYNTHESIS_PARTICIPANT_REQUIRED`. Скрытого capability-fallback для явно вставленной synthesis stage нет. (Goal-driven `produce_synthesis` со своим capability-выбором сохраняется — это отдельный путь, не UI-вставка.)
- **INV-5.** Synthesis выполняется только как `StageInstance` из planned stage. Не трогать goal-driven fallback.
- **INV-6.** Pipeline без synthesis валиден и исполняется полностью (движок уже это поддерживает — `finalization.synthesis:'none'`).
- **INV-7.** `candidate_final` synthesis-артефакт ≠ lifecycle COMPLETED. Финализация — отдельное решение (уже так: `activationPolicy:'finalization_ready'`).

---

## 3. Ограничения от заказчика (обязательные)

- **C-1.** Иконка `+` **активна только если выбран синтезатор** (final synthesis stage имеет непустой participant, т.е. значение ≠ none/пусто). Если синтезатор none — `+` отображается disabled (или скрыт) с tooltip «Выберите синтезатор, чтобы добавлять промежуточные стадии».
- **C-2.** Selector A (`debate-synthesizer-select` в panel-header) удаляется **только в последней фазе (T5)**, после того как весь путь работает через canonical state и Canvas-блок. До T5 — не трогать.

---

## 4. Data contract вставляемой стадии

```js
// SynthesisStageDraft — то, что кладётся в INSERT_STAGE.payload.stage
{
  plannedStageId: <stable id>,     // generateStableStageId()
  purpose: 'synthesis',            // текущая модель — purpose-based, НЕ вводить параллельный type
  status: 'pending',
  participantIds: [<participantId>],   // explicit, из prefill (см. §6)
  requiredCapabilities: ['synthesis'],
  upstream: [<afterPlannedStageId>],   // позиция: запуск после этой стадии
  activationPolicy: 'immediate',       // intermediate: сразу после upstream (не finalization_ready)
  outputIntent: 'working_synthesis',   // intermediate по умолчанию
  continuationPolicy: 'continue',
  auditPolicy: 'none',
  correctionLimit: 0,
  expectedArtifactTypes: ['synthesis_working'],
  goalIds: []
}
```

Для `final` synthesis (существующий `planned-final-synthesis`) остаётся `outputIntent:'candidate_final'`, `continuationPolicy:'eligible_for_finalization'`, `activationPolicy:'finalization_ready'` — как сейчас в `debate-application.js:112`.

Замечание по модели данных: система работает на `purpose`-полях (`debate-planner.js:182` читает `stage.purpose`). **Не вводить** параллельное поле `type` — это создаст дубль, который сами инварианты осуждают. `outputIntent`/`continuationPolicy` добавляются как дополнительные поля стадии, не заменяя `purpose`.

---

## 5. Фазы (строгий порядок; T4-T5 запрещено начинать до T0-T3)

### T0 — Inventory + failing-evidence (обязательно первым, отдельный отчёт)

1. Подтвердить таблицу §0 на актуальном commit; расхождения зафиксировать.
2. Failing test: «Canvas selected synthesizer = Claude → dispatched final-synthesis participant = Claude?». На HEAD для explicit synthesizer это, вероятно, **уже проходит** (wiring есть). Если проходит — зафиксировать «final synthesis wiring: DONE» и сузить ТЗ до intermediate + selector cleanup. Если для промежуточной позиции расхождение есть — зафиксировать его как целевой дефект.

### T1 — `INSERT_STAGE` по `afterPlannedStageId`

Файл: `debate-plan-revision.js` (`INSERT_STAGE`, строка ~163).
Сейчас вставка по `payload.index`. Добавить: если задан `payload.afterPlannedStageId`, вычислить `index = indexOf(afterPlannedStageId) + 1`; если стадия не найдена → `INVALID_INSERTION_POINT`. `payload.index` оставить как fallback (обратная совместимость тестов).
Тест: вставка после конкретного `afterPlannedStageId` даёт правильный порядок; несуществующий id → `INVALID_INSERTION_POINT`.

### T2 — Canvas final-synthesis блок = projection PlanRevision

Файл: `results.js` (`renderTriadSynthesisStage` и его окружение).
- Блок финального synthesis рендерится из active PlanRevision (`planned-final-synthesis`.participantIds), не из `debateSynthesizerSelect.value`.
- Смена модели в блоке → команда `updateStageAssignment` (`CHANGE_PARTICIPANT` уже есть в `debate-plan-revision.js:189`) → новая revision → rerender. Запрещено писать только в DOM/`pipelineStore`.
- До полного удаления selector A (T5) допускается двусторонняя проекция: canonical state ↔ блок; selector A остаётся видимым, но становится проекцией того же canonical state (не источником).
- Ввести canonical `currentSynthesizerValue` (module-level) как единственный источник для run-start вместо DOM-чтения. `results.js:5637` заменить на чтение canonical value.
Тест: смена модели в canvas-блоке меняет active revision; run-start получает значение из canonical state, не из DOM.

### T3 — Prefill-политика + insertion draft

Файл: `results.js` (новый helper) + `debate-plan-revision.js` (валидация).
`createSynthesisDraft(afterPlannedStageId, revision)`:
1. Найти ближайшую downstream synthesis stage в `revision.plannedStages`.
2. Если у неё explicit непустой assignment — **скопировать массив** participantIds (не ссылку).
3. Иначе — взять текущий final synthesizer (canonical state) как prefill.
4. Никогда не читать модель из DOM/legacy config.
5. Capability-рекомендацию можно показать как hint, но не сохранять без явного выбора.
Тест: prefill копирует, не связывает ссылкой; изменение intermediate не меняет final; при отсутствии downstream берётся final synthesizer.

### T4 — UI: иконка `+` в строке `.stage-label` + меню + вставка

Файлы: `pipeline_panel.html`, `results.js` (canvas render), CSS.

**Структура** (в существующем блоке раунда, на месте одиночного `.stage-label`):
```html
<div class="stage-header-row">
  <div class="stage-label">R1 Models</div>
  <button type="button" class="pipeline-stage-insert"
    data-after-stage-id="<plannedStageId R1>"
    data-before-stage-id="<plannedStageId R2 | null>"
    aria-label="Add stage after R1 Models" title="Add stage">+</button>
</div>
```

**CSS** (значения смещения адаптировать под реальный gap):
```css
.stage-header-row { position: relative; display: flex; align-items: center; min-height: 28px; }
.stage-label { flex: 1 1 auto; min-width: 0; }
.pipeline-stage-insert {
  position: absolute; right: -12px; top: 50%; transform: translate(50%, -50%); z-index: 3;
  width: 24px; height: 24px; border-radius: 50%; opacity: 0.38;
  color: var(--text-muted); background: var(--surface); border: 1px solid var(--border-muted);
}
.pipeline-stage-insert:hover, .pipeline-stage-insert:focus-visible {
  opacity: 1; color: #fff; background: var(--accent); border-color: var(--accent);
}
.pipeline-stage-insert:disabled { opacity: 0.18; cursor: not-allowed; }
```
Контейнер стадии — `overflow: visible`. `+` не меняет высоту блока, не перекрывает `.stage-label` и соседний блок. Click target ≥ 24×24. Виден keyboard focus.

**C-1 (gating):** `+` `disabled` пока final synthesizer = none/пусто. Состояние пересчитывается при каждом изменении синтезатора и при rerender canvas.

**Где показывать `+`:** после каждой стадии, где разрешена вставка. Не показывать: после terminal finalization node; в completed/read-only секции когда run не PAUSED; если нет прав редактировать план. Для последней обычной стадии `+` = append (`data-before-stage-id=null`).

**Поведение:** click → компактное меню `Add stage └ Synthesis` (в v1 только Synthesis; API меню расширяемо на Verification/Audit/Human/Model позже). Выбор Synthesis → `createSynthesisDraft(afterStageId)` → `insertStage({runId, afterPlannedStageId, stageDraft, expectedPlanRevision, commandId})` → Canvas полностью перерисовывается из новой revision, новый блок получает свою `.stage-header-row` и свой `+`.

**Семантика `+`:** не хранит state, не toggle скрытого synthesis, не содержит модель — только открывает insertion для gap.

**Блок вставленной synthesis stage** отображает: `Synthesis / Model: <name> / Output: Working synthesis / Inputs: Through <afterStage> / Audit: None / Status: <из RunStore>`. Управление: выбрать participant (→ `updateStageAssignment`), удалить (`REMOVE_PENDING_STAGE`), переместить (`CHANGE_STAGE_ORDER`), показать validation error / runtime status.

Тест (jsdom): `.stage-header-row` содержит `.stage-label` и `+`; `+` в той же строке; отдельной верхней строки stages нет; `+` disabled при synthesizer=none; click открывает меню; вставка перерисовывает canvas из revision; terminal-блок без `+`.

### T5 — Удаление selector A (C-2, последняя фаза)

Только после того как T2-T4 работают через canonical state / PlanRevision.
Файлы: `pipeline_panel.html` (удалить `<label>` c `debate-synthesizer-select`), `results.js` (удалить `debateSynthesizerSelect` declaration и все DOM-чтения; run-start уже читает canonical из T2), `result_new.html` при наличии копии, тесты.
После удаления: класс `synthesizer-capable` остаётся на `synthesisColumn`/`connectorToSynthesis` (управляет видимостью всей колонки) — не трогать.
`pipelineStore.overrides.synthesizers`: перевести в migration-only reader (значение больше не пишется из UI; при загрузке старого pipeline — мигрируется в canonical/PlanRevision, поле игнорируется с warning).
Тест: HTML не содержит `debate-synthesizer-select`; `results.js` не содержит `getElementById('debate-synthesizer-select')`; run-start получает корректный synthesizer из canonical; reload восстанавливает из PlanRevision/canonical.

---

## 6. Failure semantics

- Нет participant у synthesis stage → `PLAN_VALIDATION_FAILED / SYNTHESIS_PARTICIPANT_REQUIRED`.
- Participant отсутствует в configured → `PLAN_VALIDATION_FAILED / PARTICIPANT_NOT_FOUND`.
- Participant inactive → не подменять скрыто; typed degradation или требование revision.
- Stale revision → `PLAN_REVISION_CONFLICT`.
- Duplicate commandId + тот же payload → `duplicate:true`, вернуть исходный результат. Тот же commandId + другой payload → `IDEMPOTENCY_CONFLICT`.
- Late response после cancellation/reassignment/lease loss → `STAGE_RESULT_REJECTED_STALE`, canonical state не меняется.
- Insertion после terminal finalization → `INVALID_INSERTION_POINT`.

---

## 7. Тесты (обязательные)

**Unit — PlanRevision:** INSERT_STAGE по afterPlannedStageId даёт immutable revision с правильным порядком; несуществующий afterId → INVALID_INSERTION_POINT; duplicate idempotent; stale rejected; assignment копируется не ссылкой; изменение intermediate не меняет downstream; REMOVE удаляет только future stage; CHANGE_STAGE_ORDER меняет порядок; runtime status не создаёт revision.

**Unit — Planner/Orchestrator:** intermediate synthesis с `upstream:[R1]` + `activationPolicy:'immediate'` становится ready после R1 COMPLETED; explicit assignment используется (не capability); пустой assignment блокирует (INV-4); goal-driven produce_synthesis по-прежнему работает как fallback когда planned synthesis отсутствует; removed stage не dispatchится.

**Integration:**
- A (без synthesis): R1→R2, synthesis dispatch = 0, pipeline не стоп после R1.
- B (один intermediate): R1→Synthesis(Claude)→R2, dispatch order R1, Claude, R2; R2 получает committed synthesis artifact через canonical context.
- C (две synthesis): R1→Synthesis(Claude)→R2→Synthesis(GPT); два разных StageInstance; изменение GPT не меняет Claude; dispatched participants совпадают с Canvas.
- D (удаление): удалить intermediate → dispatch R1,R2; synthesis = 0.
- E (reorder): R1→Synthesis→R2 ⇒ R1→R2→Synthesis; фактический dispatch order меняется.

**UI (jsdom):** см. T4. Плюс: C-1 — `+` disabled при synthesizer=none, enabled при выбранном.

**Browser E2E:** открыть Canvas → `+` в строке `.stage-label` R1 → Synthesis → Claude → reload → stage и assignment восстановлены → run → Claude dispatched после R1 до R2 → R2 продолжается → изменить final model → intermediate не изменилась → удалить intermediate → re-run → synthesis call отсутствует.

**Negative:** assignment отсутствует; participant удалён/inactive; stale revision; duplicate insertion; move after itself; cyclic dependency; insertion после finalization; edit running stage; remove completed stage; cancellation during synthesis; late response после cancellation; DOM расходится с PlanRevision; stage видна но нет в revision; stage в revision но не dispatchится.

**Regression:** полный `npx jest --config tests/jest.config.js` зелёный после каждой фазы; существующие universal-тесты (`debate-application-universal.test.js`, `debate-universal-production-wiring.test.js`) не ломаются.

---

## 8. Acceptance Criteria

**Архитектура:** active PlanRevision определяет execution graph (уже так — подтвердить); synthesis только как explicit stage из плана; goal-driven produce_synthesis сохранён как fallback; runtime не читает синтезатор из DOM/overrides/module-var (после T5); pipeline без synthesis работает.

**UI:** `+` в одной строке с `.stage-label`; отдельной верхней строки stages нет; `+` относится к gap после блока; `+` disabled при synthesizer=none (C-1); вставка создаёт explicit stage; появляется полноценный блок с собственным model selector; Canvas восстанавливается после reload.

**Runtime:** synthesis исполняется ровно в указанной позиции; Canvas model = dispatched participant; несколько synthesis stages независимы; отсутствие synthesis не меняет lifecycle; finalization отделён от synthesis; stale/duplicate обрабатываются.

**Persistence/migration:** assignments в PlanRevision; runtime status в RunStore; selector A удалён (T5); `pipelineStore.overrides.synthesizers` — migration-only; старый `protocol.synthesizer` мигрируется в final synthesis stage; миграция idempotent.

**Evidence:** unit + integration + browser E2E зелёные; версии изменённых модулей с публичным/persisted/event-контрактом увеличены; changelog обновлён.

---

## 9. Запрещено

Начинать T4-T5 до T0-T3; создавать отдельную верхнюю строку stage labels; размещать `+` вне строки `.stage-label`; `+` как toggle скрытого synthesis; хранить state в `+`; читать assignment из DOM; вводить новый global synthesizer state; оставлять selector A как hidden state holder после T5; хранить runtime status в PlanRevision; создавать StageInstance внутри Planner; скрытый capability-fallback для явно вставленной synthesis stage; удалять goal-driven produce_synthesis fallback; исполнять synthesis после каждого раунда автоматически; считать наличие Canvas-блока доказательством исполнения без E2E; позволять synthesis model напрямую менять StateMap; **вводить параллельное поле `type` рядом с `purpose`**; удалять selector A раньше T5.

---

## 10. Отчёт Codex

1. Точный baseline commit. 2. Inventory §0 перепроверен (расхождения). 3. Подтверждённые дефекты до правок. 4. Файлы/функции по каждой фазе T0-T5. 5. PlanRevision contract before/after. 6. DOM/CSS для `.stage-label` и `+`. 7. Migration behavior. 8. Tests added + точные команды и результаты. 9. Remaining risks. 10. Статус: DONE / PARTIAL / BLOCKED.

DONE запрещён если: plannedStages не управляют исполнением; Canvas model ≠ dispatched participant; синтезатор читается из DOM в runtime; `+` вне строки `.stage-label`; `+` активна при synthesizer=none; вставленная stage видна но не исполняется; pipeline без synthesis не работает; selector A не удалён; browser E2E отсутствует.

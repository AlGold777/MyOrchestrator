# Отчёт: применение структурных элементов Automation Layer

Версия реализации: independent two-round Web Runtime test  
Ветка: `codex/automation-layer-independent-v1`

Этот документ фиксирует, какие структурные элементы из ранее предложенной архитектуры Automation Layer были реально использованы в данном простом тесте, а какие сознательно не использовались.

## A. Использованные элементы

### 1. Разделение semantic flow и Web transport

Использовано.

Automation Controller не управляет DOM конкретных провайдеров. Он вызывает существующий MyOrchestrator runtime, а provider adapters/content scripts остаются владельцами Web transport.

Причина: это уже существующая и наиболее зрелая часть проекта; дублирование её в Automation Layer создало бы второй источник transport truth.

### 2. Runtime-owned run identity

Использовано.

Каждый automation process получает отдельный `automationRunId`.

Он хранится в controller state и передаётся в `pipelineContext`.

Controller принимает `jobState` только при совпадении текущего run ID.

### 3. Явное разделение этапов

Использовано.

Есть два machine-recognizable этапа:

- Round 1;
- Round 2.

Номер этапа передаётся через `pipelineContext.automationRound` и участвует в correlation.

### 4. Fresh execution context

Использовано.

Оба этапа запускаются через существующий runtime с `forceNewTabs: true`.

Round 2 не продолжает Round 1 chat.

### 5. Fail-closed correlation

Использовано.

Controller не принимает произвольный текущий `jobState`.

Для live in-memory state controller использует `pipelineContext`. Для persisted/compacted state используется stage-scoped идентификатор `session.pipelineRunId = <automationRunId>:R<round>`, который штатно сохраняется MyOrchestrator.

При невозможности восстановить связь после reload controller завершает run ошибкой, а не угадывает состояние.

### 6. Existing completion authority вместо собственного completion detector

Использовано.

Automation Layer потребляет только terminal state, сформированный существующим MyOrchestrator.

Проверяются:

- `finalStatusRecorded`;
- `finalStatus`;
- непустой accepted `answer`.

Это позволяет использовать уже существующие provider-specific completion, stale-answer и extraction guarantees.

### 7. Chronological event projection

Использовано.

Пользовательская лента строится по `finalizedAt` — фактическому времени принятия terminal response существующим runtime.

Machine object order не используется как порядок сообщений.

### 8. Разделение machine ordering и UI chronology

Использовано.

Лента отражает реальный порядок завершения.

Fan-in для Round 2 выполняется в стабильном порядке выбранных моделей.

Таким образом:

```text
UI chronology != deterministic machine merge order
```

### 9. Deterministic fan-in

Использовано.

Два Round 1 ответа объединяются обычным кодом, без дополнительной LLM.

Формат имеет явные SOURCE boundaries.

### 10. Data/instruction separation в Round 2 prompt

Использовано в упрощённой форме.

Round 2 prompt разделяет:

- original request;
- SOURCE_ANSWERS;
- synthesis task.

Дополнительно указано, что SOURCE является данными для анализа, а не инструкциями по изменению задачи.

### 11. Prompt hashing

Использовано.

Controller вычисляет SHA-256 исходного запроса и каждого stage prompt.

Hashes идут в diagnostic journal/audit, а не в пользовательский feed.

### 12. Persistent controller checkpoint

Использовано.

Controller state хранится в `chrome.storage.local`.

Это позволяет восстановить:

- run ID;
- phase;
- модели;
- принятые ответы;
- feed;
- journal;
- session binding.

### 13. Append-only event journal

Использовано в пределах smoke test.

В controller state ведётся последовательный `journal` с событиями:

- RUN_CREATED;
- ROUND_DISPATCH_INTENT;
- ROUND_DISPATCH_ACCEPTED;
- ROUND_SESSION_BOUND;
- MODEL_ANSWER_ACCEPTED;
- MODEL_TERMINAL_FAILURE;
- ROUND_COMPLETED;
- RUN_COMPLETED / RUN_FAILED / RUN_CANCELLED;
- export events.

Это diagnostic journal, а не production transactional Ledger.

### 14. Duplicate-event suppression

Использовано.

Для terminal model events сохраняются `terminalKeys`.

Повторная reconciliation после reload не создаёт второй экземпляр того же model message.

### 15. Recovery после reload

Использовано.

Page controller после reload сверяет persisted controller state с persisted MyOrchestrator `jobState`.

Если dispatch intent существовал, но matching background run отсутствует и runtime свободен, разрешён один recovery dispatch.

Если активный running state нельзя однозначно связать с background runtime, controller fail closed.

### 16. User feed отдельно от diagnostics

Использовано.

Основная лента содержит:

- model;
- время;
- round;
- ответ;
- короткие SYSTEM transitions.

Технический journal выводится отдельно в `Runtime / Diagnostics`.

### 17. Automatic artifact generation

Использовано.

После успешного Round 2 автоматически создаются:

- result TXT;
- audit JSON.

### 18. Existing UI controls as stable boundary

Использовано насколько позволяет текущий GitHub baseline.

`automation.html` отсутствовал в `main`, поэтому новая страница построена на существующем UI contract из `popup.html`:

- `#prompt`;
- `#send-button`;
- `input[name="llm"]`.

Внутри страницы нет второго prompt, второй Send или второго набора model controls.

---

## B. Не использованные элементы и причины

### 1. Model-visible CALL_TOKEN / ATTEMPT_TOKEN

Не использовано.

Причина: существующий MyOrchestrator уже имеет собственную dispatch/session/request correlation и stale-answer protection.

Добавление второго model-visible correlation protocol создало бы дублирующую transport abstraction.

Для этого теста correlation проводится на trusted runtime boundary через stage-scoped `pipelineRunId` и live `automationRunId/automationRound`.

### 2. Специальный PAF response envelope

Не использован.

Моделям не требуется возвращать JSON wrapper или markers.

Причина: полноту и terminal acceptance уже определяет существующий completion/extraction runtime.

Это также позволяет тестировать реальный пользовательский ответ модели без искусственного transport formatting.

### 3. Собственный Automation retry algorithm

Не использован.

Причина: existing MyOrchestrator уже выполняет provider-level retry/recovery.

Automation Controller не должен запускать второй конкурирующий retry state machine поверх него.

После terminal failure существующего runtime automation run становится ERROR.

### 4. Собственный DOM completion detector

Не использован.

Причина: это обязанность существующей provider infrastructure.

### 5. Собственный selector layer

Не использован.

Причина: selectors/configs уже существуют по провайдерам.

### 6. Stage decomposition

Не использовано.

Причина: тест состоит из одного исходного prompt и двух обычных ответов. Нет stage output, требующего partitioning.

### 7. Full Product→Architecture object Registry

Не использован.

Причина: тест проверяет orchestration boundary, а не объектную модель 30-stage Framework.

### 8. Canonical object IDs / versions

Не использовано.

Причина: smoke flow не создаёт PD/REQ/CON/FCT/AD и другие domain objects.

### 9. DPL / authority classes

Не использовано.

Причина: в тесте нет autonomous architecture decision closure. Есть только пересылка и synthesis ответов.

### 10. Evidence subsystem

Не использовано.

Причина: тест не переводит claims в VERIFIED и не выполняет evidence collection.

### 11. Gates G1–G4

Не использованы.

Причина: двухраундовый transport test не моделирует 30-stage framework lifecycle.

### 12. PFB / AIP / CAB baselines

Не использованы.

Причина: baseline construction находится за пределами данного smoke test.

### 13. Transactional production Ledger

Не использован.

Вместо него используется `chrome.storage.local` checkpoint + append-only diagnostic journal.

Причина: цель этого теста — проверить Web orchestration. Нельзя делать вид, что local extension storage уже обеспечивает production transactional guarantees.

### 14. Atomic multi-object StateCommitter

Не использован.

Причина: нет Registry mutations и multi-object commit.

### 15. Evidence-specific human test workflow

Не использован.

Причина: данный test не содержит HTSK/HRES.

### 16. Provider-diversity proof

Не реализован как отдельная formal guarantee.

Пользователь выбирает две разные model controls, но тест не доказывает underlying model identity провайдера.

### 17. Hard token/cost budgets

Не использованы.

Причина: Web UI не предоставляет надёжного общего authoritative token/cost meter для всех поддерживаемых моделей.

### 18. Full WAITING_FOR_OPERATOR state machine

Не использовано.

Если существующий MyOrchestrator в итоге даёт terminal non-success, controller фиксирует ERROR.

Полный workflow login/CAPTCHA/operator-resume относится к следующему уровню Automation Layer.

---

## C. Почему именно такой набор

Главный принцип этой реализации:

> Использовать структурный элемент только там, где он добавляет новую гарантию, а не дублирует уже существующую гарантию MyOrchestrator.

Поэтому Automation Layer здесь отвечает за межэтапную orchestration:

```text
human request
→ existing Web runtime
→ two accepted answers
→ deterministic fan-in
→ existing Web runtime
→ two accepted final answers
→ artifact
```

А существующая инфраструктура продолжает отвечать за:

```text
provider DOM
prompt delivery
dispatch identity
generation observation
completion authority
stale-answer rejection
answer extraction
provider recovery
```

Это делает тест полезным архитектурно: он проверяет новый orchestration layer, не подменяя уже работающий transport.

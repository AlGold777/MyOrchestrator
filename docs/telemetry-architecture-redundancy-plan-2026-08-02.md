# Комплексный план телеметрии: полнота, совместимость, избыточность и экспорт

Дата фиксации: 2026-08-02  
Исходная версия проекта: 2.81.222  
Статус документа: нормативный план, не разрешение на удаление существующего кода или данных.

## 1. Неподвижные принципы

1. До прохождения всех ворот существующие механизмы не удаляются и не отключаются.
2. Повторяющиеся данные не считаются лишними, пока не доказано, что повтор не несёт отдельного времени, источника, причинной связи, контекста или восстановительной ценности.
3. Исходные доказательства важнее размера файла и удобства представления.
4. Отсутствие события означает неизвестность, а не отрицательный факт.
5. JSON, MD, Timeline, standalone report и digest должны иметь одну каноническую границу и объяснимые различия.
6. Новое представление сначала работает параллельно старому в shadow-режиме.
7. Отключение старого пути требует отдельного явного решения после полевых проверок.

## 2. Целевая модель данных

Телеметрия разделяется на четыре слоя.

### 2.1. Исходные доказательства

Невосстановимые наблюдения: открытие запуска, вставка и отправка запроса, подтверждение отправки, генерация, кандидат ответа, источник, извлечение, структурная проверка, commit, отображение карточки, terminal, post-terminal audit, ошибки, отклонения и изменения вкладки.

### 2.2. Канонические факты

Нормализованные утверждения о submission, generation, candidate identity, extraction, verification, delivery, finalization и terminal. Каждый факт обязан ссылаться на исходные события.

### 2.3. Диагностические представления

`derivedViews`, incident/model timeline, evidence slots, diagnosis arbitration и семь диагностических отчётов. Они воспроизводимы только вместе с точной версией правил и генератора.

### 2.4. Представления для человека

UI Timeline, MD, digest, сводки и выбранный standalone report. Они не являются самостоятельными источниками истины.

## 3. Зафиксированный baseline

Эталонный all-presets JSON `telemetry-all-presets-1785625302850.json`:

| Раздел | Размер | Доля |
|---|---:|---:|
| Весь документ | 774 463 байта | 100% |
| `ledger` | 416 225 байт | 53,7% |
| `reports` | 280 039 байт | 36,2% |
| `derivedViews` | 59 120 байт | 7,6% |
| `sharedConfig` | 14 182 байта | 1,8% |

В журнале 426 событий. `OBSERVER_HEALTH_INTERVAL_CLOSED` занимает 125 146 байт, observation frames — 43 554 байта, пары observation slot — около 69 КБ. Обнаружено не менее 27 точных семантических повторов.

Этот baseline используется только для измерений. Он не доказывает, что перечисленные данные можно удалить.

## 4. Реестр потоков и матрица возможностей

Создать машинно проверяемый реестр каждого типа события:

- производитель;
- обязательные поля и идентичность;
- proof-ledger, legacy buffer и другие получатели;
- sampling, дедупликация и retention;
- потребители в UI, JSON, MD, digest и отчётах;
- критичность и возможность восстановления;
- версия контракта.

Тест запрещает добавлять новый тип события без записи в реестре.

Параллельно создать матрицу диагностических возможностей:

- модель без terminal;
- экспорт активного запуска;
- вкладка закрыта во время генерации;
- SUCCESS с ошибочной причиной;
- незавершённая persistence queue;
- старый ответ;
- обрезанный ответ;
- post-terminal рост;
- отклонённая доставка;
- отсутствие подтверждения отправки.

Для каждой возможности фиксируется поддержка в legacy export, schema 6, JSON, MD, Timeline и digest.

## 5. Два независимых измерения полноты

Нельзя смешивать:

1. `snapshotCompleteness` — успела ли очередь записи войти в зафиксированную границу;
2. `runCompleteness` — завершили ли ожидаемые модели свой жизненный цикл.

Будущий audit должен отдельно содержать:

```json
{
  "snapshotCompleteness": "queue_drained|committed_boundary|incomplete",
  "runCompleteness": "complete|active|incomplete|unknown",
  "expectedModels": [],
  "terminalModels": [],
  "pendingModels": [],
  "exportedDuringActiveRun": false
}
```

`shared/telemetry-export.js` сохраняется как исторический эталон, пока schema 6 не воспроизведёт его уникальные состояния `generating_partial_answer`, `answer_observed_without_terminal`, `tab_closed_during_generation`, `success_with_error_done_reason`, `pendingModels` и `export_during_active_run`.

## 6. Аудит внутренних параллельных механизмов

Ничего не удалять. Для каждого механизма сначала измерить уникальную информацию и потребителей.

### 6.1. `decisionLedger`

Сравнить каждую запись с `DECISION_RECORDED`, причины, входы и resulting state. Регистрировать расхождения. Проверить восстановительную ценность и переживание перезапуска.

### 6.2. `stageTimeline`

Создать параллельную `currentStageProjection` из proof-ledger. Сравнивать с текущим массивом и отдельно проверить, требуется ли UI история из 30 элементов или только последнее состояние.

### 6.3. `legacyDebugRing`

Классифицировать уникальные записи, измерить память/storage, проверить необходимость персистентности и возможность привязки к anomaly attachments.

### 6.4. `log-replay-harness`

Текущая реализация молча неверно читает schema 6: не распознаёт `modelId`, `eventType` и `wallTs`. До использования она обязана либо корректно определить входную схему, либо явно отказаться. Требуются отдельные legacy/schema-6 адаптеры и сравнение с `ProofTelemetryPolicy.replay`.

### 6.5. Legacy diagnostics buffer

Proof-ledger и `__diagnostics_events__` сохраняются параллельно до доказанной эквивалентности Timeline и MD. Измеряются legacy-only и proof-only факты, terminal/identity mismatch и различия временной границы.

## 7. Координированные рабочие треки

### Трек A: содержание и совместимость

Реестр, capability matrix, legacy/schema parity, active-run semantics, replay, Timeline, MD и диагностическая достаточность.

### Трек B: производительность и устойчивость

Snapshot, очередь, worker, построение, сериализация, память, progress, timeout, recovery artifact и stress tests.

Оба трека используют общие fixtures и ворота. Производительная оптимизация не принимается без semantic parity; semantic migration не принимается без performance/recovery проверки.

## 8. Зафиксированные форматы экспорта

Три режима уже существуют и должны быть описаны, а не реализованы повторно:

1. **Full forensic** — all tasks, ledger, все семь отчётов и derived views.
2. **Selected report** — standalone report для Task/model/incident.
3. **Digest** — заведомо неполная первичная сводка.

Добавляется только четвёртый режим:

4. **Canonical evidence** — полный журнал и всё необходимое для проверяемого отложенного построения, без заранее встроенных `reports` и `derivedViews`.

Full forensic остаётся доступным независимо от появления canonical evidence.

## 9. Правильная реализация отчётов по запросу

### 9.1. Что уже есть

`buildAllPresets(events, options)` и `buildStandaloneReport(events, options)` уже принимают канонический журнал. Следовательно, диагностический алгоритм не нужно переносить в сервис или переписывать вторично.

Однако два публичных пути сейчас имеют разные формы и частично разные последовательности вычислений. Embedded report агрегирует инциденты и ссылается на общий ledger по `seq`; standalone выбирает один incident и материализует evidence closure. Побайтовое сравнение невозможно, а выборочное сравнение нескольких полей недостаточно.

### 9.2. Единое вычислительное ядро

Выделить чистую внутреннюю функцию уровня инцидента, условно:

```js
buildIncidentReportSemantics(events, incident, reportType, context, options)
```

Она возвращает одну каноническую семантическую проекцию:

- incident scope и идентичность;
- applicability;
- diagnostic verdict;
- evidence slots, их статусы, criticality и выбранные event IDs;
- temporal/invariant violations;
- completeness и missing evidence;
- safe/blocked conclusions;
- diagnosis arbitration;
- sibling dependencies;
- provenance;
- registry/generator identity.

`buildAllPresets` превращает эту проекцию в компактный embedded report. `buildStandaloneReport` превращает ту же проекцию в самодостаточный материализованный report. Офлайн CLI вызывает тот же standalone builder. Второй диагностический движок запрещён.

### 9.3. Семантическая эквивалентность

До рефакторинга создать нормализатор, который извлекает сопоставимую проекцию из embedded и standalone форм. Для embedded event seq преобразуется обратно в event ID через общий ledger.

Сравниваются:

- scope;
- applicability status;
- diagnostic verdict;
- sufficiency;
- каждый slot ID/status/effective criticality/requiredIf;
- множество доказательств;
- ограничения и нарушения;
- conclusions;
- primary diagnosis и causal relation;
- registry/generator versions.

После выделения общего ядра оба результата дополнительно сравниваются с его канонической проекцией.

Эквивалентность проверяется для каждого report type, каждой модели и каждого incident, а не только для автоматически выбранного последнего инцидента.

Тест выполняется на frozen ledger с зафиксированными snapshot boundary, registry, generator/report versions и временем экспорта. Он сравнивает смысл, а не порядок полей, форму ссылок или служебные envelope-поля.

Обязателен отрицательный контроль: намеренное изменение verdict, одного slot status, criticality, evidence event ID, limitation либо causal relation должно ломать проверку. Тест, который не обнаруживает такую мутацию, не считается доказательством эквивалентности.

Этот этап ничего не удаляет, не отключает embedded reports и не меняет формат экспорта. Он только создаёт проверяемое условие для последующих изменений.

### 9.4. Доказательный индекс на основе `stateAxes`

Новый task-specific индекс с 63 заранее записанными вердиктами не создаётся. Он повторил бы основную проблему семи встроенных отчётов: направлял бы анализ предвычисленными диагнозами и занимал место в контексте.

Компактный доказательный индекс строится как проекция уже существующих `stateAxes` из incident timeline. Включаются все четырнадцать осей без произвольного подмножества:

- `submission`;
- `generationStart`;
- `answerIdentity`;
- `observedGeneration`;
- `textEvolution`;
- `answerCompleteness`;
- `extraction`;
- `verification`;
- `completionDetection`;
- `completionEvidenceTier`;
- `observationReliability`;
- `finalization`;
- `terminalMode`;
- `terminationCause`.

Плоский `stateAxes` сохраняется для совместимости. Рядом добавляется `stateAxesProvenance`, чтобы значение оси нельзя было ошибочно принять за непосредственное наблюдение:

```json
{
  "answerCompleteness": {
    "layer": "inference",
    "basisEventIds": ["event-id"],
    "ruleId": "completion-evidence-tier-threshold",
    "derivationVersion": "axis-provenance-version"
  }
}
```

Допустимые слои согласуются с существующей моделью происхождения (`fact`, `inference`, `decision`, при необходимости `audit`), а не сводятся декларативно к «нейтральным фактам». Слой определяется применённой ветвью правила и источниками конкретного значения. Одна и та же ось может иметь разный слой в разных инцидентах.

`basisEventIds` содержит только точные события, действительно участвовавшие в вычислении значения или ограничившие допустимый вывод. Текущий общий `fieldProvenance`, который консервативно связывает поле со всеми событиями подходящих типов в scope, используется как инфраструктурная основа, но не считается достаточным доказательством точной причинности.

Значение оси и его provenance вычисляются одновременно в одной ветви `deriveAxes` либо в общем вызываемом им чистом ядре. Восстанавливать basis позднее по типам событий запрещено: это создаёт приблизительную, а не причинную связь. Для каждой записи обязательны `ruleId` и `derivationVersion`; ссылки проверяются валидатором, а вся проекция участвует в semantic/artifact hash.

`readerGuidance` хранится отдельно от фактов и осей. Его текст:

- поступает только из версионированной константы кода;
- никогда не формируется из prompt, ответа, DOM или других данных прогона;
- маркируется как guidance, а не evidence;
- содержит правило, что отсутствие события не доказывает отрицательный результат;
- имеет version/hash и проверяется по allowlist валидатором.

Внешний потребитель не должен доверять одному лишь тексту `readerGuidance` внутри неизвестного файла. Доверие появляется только после проверки контейнера и его хешей доверенным валидатором; без неё guidance считается недоверенными данными артефакта.

### 9.5. Контейнер `canonical-evidence`

Минимальный обязательный состав без потери исходных доказательств:

```text
schemaVersion
containerType = canonical-evidence
exportId / createdAt / exportMode
run state and expected/terminal/pending models
sharedConfig and runtime RUN_CONFIG_RECORDED
full dependencyRegistry snapshot
generatorVersion / reportVersion / policy identity
ledger with all canonical events
compact incident index with all stateAxes and stateAxesProvenance
versioned readerGuidance
attachments and omissions
source snapshot boundary and diagnosticUsability
ledger/registry/attachments/artifact hashes
privacy/redaction declaration
```

Он не содержит `reports` и полного `derivedViews`. Компактная проекция `stateAxes` не является восьмым диагностическим отчётом и не содержит task-specific verdict. Предварительная оценка самой проекции с точными basis-ссылками — около 11–12 КБ, всего контейнера — около 443 КБ вместо 774 КБ. Это измерение, не контракт и не основание менять режим по умолчанию.

### 9.6. Почему registry обязателен

Отчёт является функцией не только журнала, но и:

- dependency registry;
- policy thresholds;
- generator/report version;
- алгоритма incident selection;
- алгоритма derive axes и evidence closure.

Текущий registry — `6.7.0`. Один лишь журнал не гарантирует исторически точное воспроизведение. Canonical evidence поэтому обязан хранить полный registry snapshot и его hash.

Встроенный registry всё равно не делает произвольный будущий код автоматически совместимым со старым алгоритмом. Офлайн builder вводит режимы:

- `exact-reproduction` — generator/registry поддерживаются и совпадают;
- `legacy-reproduction` — в коде есть явно сохранённый адаптер старой версии;
- `reinterpretation` — сознательный пересчёт новыми правилами, результат маркируется новым registry/generator;
- `unsupported` — точное построение невозможно, инструмент отказывается делать вид, что отчёт воспроизведён.

Несовпадение нельзя молча превращать в текущий verdict.

### 9.7. Офлайн CLI

Добавить один CLI поверх существующего shared builder:

```bash
node scripts/build-proof-telemetry-report.js telemetry.json --list-incidents
node scripts/build-proof-telemetry-report.js telemetry.json --task=cutted --model=Gemini
node scripts/build-proof-telemetry-report.js telemetry.json --task=no-delivery --incident=<id>
node scripts/build-proof-telemetry-report.js telemetry.json --all
```

CLI обязан:

1. определить вид контейнера;
2. проверить hashes, schema, privacy и snapshot boundary;
3. проверить registry/generator compatibility;
4. показать доступные incidents;
5. не выбирать неоднозначный incident молча;
6. вызвать тот же `buildStandaloneReport` или `buildAllPresets`;
7. валидировать полученный артефакт;
8. записать provenance исходного canonical file;
9. никогда не изменять исходный файл.

### 9.8. Ключ кэша

Если отчёты кэшируются, ключ обязан включать:

```text
sourceLedgerHash
registryHash
generatorVersion
reportVersion
reportType
incidentId
modelId
reproductionMode
```

Кэш не входит в источник истины и может быть удалён без потери доказательств.

### 9.9. Обратимость

Для одного frozen ledger должны выполняться:

```text
canonicalProjection(allPresets.report[task], incident)
  == canonicalProjection(standaloneReport(task, incident))
  == buildIncidentReportSemantics(events, incident, task)
```

Для canonical evidence:

```text
build(canonicalEvidence, task, incident)
  == recorded semantic projection from full forensic
```

Сравнение выполняется по смыслу, а не по JSON-форме.

Дополнительно для каждого incident должно выполняться:

```text
canonicalEvidence.stateAxes
  == fullForensic.derivedViews['incident-timeline'].stateAxes

all stateAxesProvenance.basisEventIds
  resolve to events inside the declared incident/sibling scope
```

### 9.10. UI и режим по умолчанию

Сначала canonical evidence появляется как отдельный явно названный вариант. Full forensic остаётся текущим эталоном. Решение о default принимается только после parity, offline reproducibility и полевой проверки.

### 9.11. Ошибки и ограничения

- Invalid ledger/hash: построение прекращается.
- Missing registry: разрешён только просмотр событий; exact report запрещён.
- Unknown registry/generator: явный `unsupported` либо маркированная reinterpretation.
- Missing evidence: verdict становится unknown/bounded, а не false.
- Missing attachment: записывается limitation.
- Ambiguous incident: CLI требует `--incident`.
- Worker/CLI failure: исходный canonical file остаётся пригодным и неизменным.

## 10. Измерение избыточности без удаления

Создать анализатор, который отдельно считает:

- исходные и производные байты;
- статические registry/config bytes;
- повторяющиеся envelope fields;
- точные и семантические повторы;
- normal observer intervals;
- lease pairs;
- двойные report references;
- legacy-only и proof-only данные.

Для observer health, observation frames и focus leases сначала строятся дополнительные агрегированные проекции. Исходные события сохраняются до доказательства диагностической эквивалентности и отдельного решения.

## 11. Производительность полного экспорта

Измеряемые стадии:

1. snapshot request;
2. persistence boundary;
3. structured clone в worker;
4. incident index;
5. derived views;
6. каждый report type;
7. hashes;
8. redaction;
9. serialization;
10. worker response;
11. Blob/download.

Метрики самого экспорта не записываются в журнал до фиксации его snapshot. Тест закрепляет инвариант: экспорт не может увеличивать очередь, которую сам ожидает.

Поддерживаются progress, cancel, single-flight, per-stage deadline, общий deadline, worker termination, Blob cleanup и canonical recovery artifact.

## 12. Fixtures и испытания

Минимум 13 сценариев:

- полный успех;
- cutted;
- false-success;
- old-answer;
- no-delivery;
- prompt-not-inserted;
- prompt-not-sent;
- late-end;
- несколько attempts/incidents;
- экспорт активного запуска;
- экспорт при занятой persistence queue;
- перезапуск service worker;
- post-terminal growth/отсутствующий terminal.

Performance-набор: 500, 2 000, 5 000 и 10 000 событий; несколько одновременных экспортов; worker crash; malformed event; missing registry; memory pressure.

## 13. Ворота

1. **Inventory complete** — все producers/stores/consumers описаны.
2. **Baseline reproducible** — fixtures и hashes воспроизводимы.
3. **Capability parity** — legacy-уникальные возможности сохранены.
4. **Shared semantics** — embedded и standalone используют или доказывают одну семантическую проекцию.
5. **Axis provenance** — все четырнадцать `stateAxes` имеют проверяемые layer, rule/version и точные basis-ссылки; мутационные тесты обнаруживают ложную причинность.
6. **Offline reproducibility** — canonical evidence строит валидный отчёт без расширения и исходного запуска.
7. **Diagnostic parity** — семь диагнозов не стали слабее.
8. **Performance/recovery** — предельный экспорт ограничен и всегда отдаёт артефакт.
9. **Field validation** — реальные запуски не дают необъяснённых расхождений.
10. **Explicit approval** — изменение default или отключение старого механизма разрешено отдельно.

## 14. Последовательность реализации и Git-дисциплина

Каждый пункт — отдельный коммит, рискованные направления — отдельные ветки и теги:

1. Этот план и baseline. - Done.
2. Event registry и capability matrix. - Done.
3. Fixtures и measurement script. - Done.
4. Schema detection/fail-closed для replay harness. - Done.
5. Active-run completeness schema. - Done.
6. Embedded/standalone semantic comparator. - Done.
7. Контракт всех `stateAxes`, точный `stateAxesProvenance` и проверка basis-ссылок. - Done.
8. Общее incident semantics ядро. - Done.
9. Canonical evidence schema/builder/validator и доверенный `readerGuidance`.
10. Offline report CLI.
11. UI-вариант canonical evidence.
12. Shadow Timeline и proof-based MD.
13. Stress/performance/recovery gates.
14. Полевые проверки.

Ни один этап этого документа сам по себе не разрешает удалять legacy buffer, `stageTimeline`, `decisionLedger`, `legacyDebugRing`, старые exporter/replay модули, embedded reports или full forensic режим.

# Пакет реализации proof-oriented telemetry

Основной документ: `SPECIFICATION.md`.

- `all-presets.example.json` — пример дедуплицированного контейнера.
- `schemas/` — JSON Schemas.
- `registry/report-dependency-registry.json` — единый реестр количественных escalation rules.
- `presets/*.example.json` — семь текущих standalone reports.

Примеры используют конкретные синтетические данные и помечены `exportIntegrity.sampleData=true`.

## Статус реализации

Версия `2.81.167` унифицирует terminal и recovery measurements. Audit сравнивает
`normalizedLength/normalizedHash` только при одинаковой версии нормализации;
transport-only recovery не выдаётся за наблюдение ответа. Registry `6.4.0`,
report `3.4.0`, generator `2.4.0`.

Версия `2.81.166` разделяет occurrence и cause для `False success`: доказанный
post-terminal рост подтверждает incident, а отсутствие completion hypothesis
ограничивает только объяснение причины. Registry `6.3.0`, report `3.3.0`,
generator `2.3.0`.

Версия `2.81.165` уточняет границу `No delivery`/`Cutted`: один hash mismatch
при непустом пригодном answer остаётся `unknown`. Положительный verdict требует
independent unusability, empty/wrong-card outcome либо классифицированный
непригодный content. Registry `6.2.0`, report `3.2.0`, generator `2.2.0`.

Версия `2.81.164` завершает product cutover. Registry `6.1.0`, report `3.1.0`
и generator `2.1.0` заменяют `Empty` на `No delivery` в текущем UI, All tasks,
standalone generator и dependency registry. Старые Empty reports registries
5.6.0–6.0.0 направляются в frozen legacy contract с проверкой registry hash и
не переинтерпретируются актуальной семантикой.

Версия `2.81.163` вводит shadow preset `No delivery`. Registry `6.0.0`, report
`3.0.0` и generator `2.0.0` разделяют доказательство occurrence и объяснение
cause, связывают source и expected card через attempt/payload identity и общую
нормализацию, публикуют evaluation boundary/resolution и четыре независимые
cause axes. `Empty` временно сохраняется; оба reports используют один ledger,
а расхождения записываются для cutover review.

Версия `2.81.157` реализует третью итерацию semantic review. Registry `5.6.0`,
report `2.8.0` и generator `1.9.0` вводят настоящее post-failure absence window,
candidate-bound Late end с первой активной eligibility-границей, canonical
fallback и typed/canonical conflict invariant, incident-local embedded
completeness/event selection, conditional submit evidence, финальную границу
Cutted и явные refutation models. Weak comparability больше не даёт strong
confirmation. Все W1–W12 закреплены adversarial regression matrix.

Версия `2.81.156` реализует вторую итерацию semantic review. Registry `5.5.0`,
report `2.7.0` и generator `1.8.0` добавляют task-local verdict preservation,
`supported_but_incomplete`, graded measurement comparability, evidence
supersession, reliable absence windows, policy-relative Late end, локальные
invariant impacts, настоящую prior-incident slot lane и полные refutation/
sibling relation contracts. Все семь standalone examples подтверждают свой
диагноз, не используют full-incident fallback и проходят независимую проверку.

Версия `2.81.155` реализует результаты независимого cross-review V1–V21.
Registry `5.4.0`, report `2.6.0` и generator `1.7.0` включают composite verdict,
fact/temporal slot rules, verdict-preserving compaction, candidate continuity,
явную prior-incident lane для Old answer, refutation predicates, effective-slot
coverage и точный field provenance. All tasks и семь standalone examples
проходят schema, replay, hash, slot и verdict validation.

В версии `2.81.150` добавлен отдельный `Prompt not inserted`: runtime сохраняет
typed failure вставки prompt в composer и отличает её от последующего сбоя
отправки. Подтверждённая отправка, генерация, extraction или SUCCESS служат
counter-evidence; отсутствие наблюдений остаётся `unknown`.

В версии `2.81.149` applicability и sufficiency вычисляются по точному incident
scope одинаково в embedded и standalone reports. `REPORT_CONTRACTS` является
единственным источником event types, slots, `requiredIf` и predicates.
Accepted extraction, submission counter-evidence, audit tri-state и policy wait
устраняют ложные подтверждения; proof-role compaction сохраняет границы,
экстремумы и provenance без фиксированного лимита размера.

В версии `2.81.144` slot sufficiency была отделена от semantic applicability и
введены исполняемые tri-state predicates (`confirmed`, `not_confirmed`,
`unknown`).

В версии `2.81.143` восемь технически пересекавшихся Tasks заменены шестью
пользовательскими диагнозами: `Cutted`, `False success`, `Old answer`, `Empty`,
`Prompt not sent`, `Late end`. `Late end` содержит измеренный
`stableToTerminalMs`; запись canonical events при этом не дублируется.

В версии `2.81.142` legacy operational stream удалён из canonical ingress:
polling агрегируется в interval summaries, неизвестные labels уходят в bounded
debug ring, metadata/clock стали compact, а embedded indexes используют seq.

В версии `2.81.141` zero-match Task больше не блокирует export: создаётся
валидный `insufficient` report с incident anchor и explicit missing slots.

Версия `2.81.140` завершает incident cutover: два UI-фильтра, отдельный export
на каждый matching incident, schema 6 segmented runtime и strict standalone
validation являются основной системой; legacy proof storage удалён.

В версии `2.81.139` proof history разделена по IndexedDB stores и читается по
run/incident indexes; `chrome.storage.local` содержит только compact pointer.

В версии `2.81.138` offline validator независимо пересобирает schema, S01–S20,
slots, replay и hashes; optimizer сохраняет core evidence при любом overflow.

В версии `2.81.137` standalone reports строятся напрямую из одного incident
closure; axes/replay имеют field provenance, а размер является measurement-only.

В версии `2.81.136` добавлены incident index, evidence-slot resolver и
materialized closure с обязательным `includedFor` для каждого события.

В версии `2.81.135` runtime сохраняет typed transitions, выполняет per-signal
no-op suppression и закрывает observation intervals при navigation/restart.

В версии `2.81.134` runtime ledger переведён на schema 6: append-only lifecycle,
non-reused run generations, global ingestion order, clock epochs, tri-state
duration comparisons и degraded interval closure при worker restart.

В версии `2.81.133` опубликован executable schema 6 event contract и единый
runtime registry typed evidence slots для всех восьми задач. Policy использует
typed facts, а legacy labels преобразуются только одним migration adapter.

Начиная с версии расширения `2.81.131` реализованы native schema 5 ledger,
independent axes, T0–T4 policy/replay, terminal lineage, post-terminal audit,
forensic omissions, шесть embedded reports, All-presets export и offline
validator. Каждая задача также экспортируется как bounded standalone report с
минимальным evidence closure и без повторяющихся event copies. JSON export
использует только native ledger; legacy telemetry сохранена исключительно для
Timeline/Markdown UI.

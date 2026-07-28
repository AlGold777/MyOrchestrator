# Пакет реализации proof-oriented telemetry

Основной документ: `SPECIFICATION.md`.

- `all-presets.example.json` — пример дедуплицированного контейнера.
- `schemas/` — JSON Schemas.
- `registry/report-dependency-registry.json` — единый реестр количественных escalation rules.
- `presets/*.example.json` — восемь заполненных standalone reports.

Примеры используют конкретные синтетические данные и помечены `exportIntegrity.sampleData=true`.

## Статус реализации

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
forensic omissions, восемь embedded reports, All-presets export и offline
validator. Каждая задача также экспортируется как bounded standalone report с
минимальным evidence closure и без повторяющихся event copies. JSON export
использует только native ledger; legacy telemetry сохранена исключительно для
Timeline/Markdown UI.

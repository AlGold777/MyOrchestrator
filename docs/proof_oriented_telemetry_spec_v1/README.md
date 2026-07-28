# Пакет реализации proof-oriented telemetry

Основной документ: `SPECIFICATION.md`.

- `all-presets.example.json` — пример дедуплицированного контейнера.
- `schemas/` — JSON Schemas.
- `registry/report-dependency-registry.json` — единый реестр количественных escalation rules.
- `presets/*.example.json` — восемь заполненных standalone reports.

Примеры используют конкретные синтетические данные и помечены `exportIntegrity.sampleData=true`.

## Статус реализации

Начиная с версии расширения `2.81.131` реализованы native schema 5 ledger,
independent axes, T0–T4 policy/replay, terminal lineage, post-terminal audit,
forensic omissions, восемь embedded reports, All-presets export и offline
validator. Каждая задача также экспортируется как bounded standalone report с
минимальным evidence closure и без повторяющихся event copies. JSON export
использует только native ledger; legacy telemetry сохранена исключительно для
Timeline/Markdown UI.

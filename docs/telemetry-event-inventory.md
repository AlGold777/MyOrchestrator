# Реестр событий и матрица возможностей телеметрии

Исполняемый источник истины находится в `shared/proof-telemetry-inventory.js`.

Реестр описывает для каждого канонического типа события:

- производителей;
- обязательный envelope и поля идентичности;
- получателей и политику хранения;
- sampling;
- критичность;
- потребителей, включая диагностические отчёты.

Матрица возможностей отдельно фиксирует состояние legacy export, schema 6, JSON, Markdown, Timeline и digest для десяти диагностически важных сценариев. Значения имеют только четыре допустимых состояния: `supported`, `partial`, `unsupported`, `unknown`.

Тест `tests/proof-telemetry-inventory.test.js` запрещает незарегистрированные канонические типы событий и зависимости отчётов. Добавление нового события требует сначала описать его контракт в реестре.

Общие сценарии находятся в `tests/fixtures/proof-telemetry-scenario-matrix.js`. Размер и повторяющиеся структуры измеряются без изменения артефакта:

```bash
npm run measure:telemetry -- telemetry-all-presets.json
```

`shared/log-replay-harness.js` принимает legacy-массив, grouped legacy export, массив schema 6, all-presets или standalone report. Формат определяется до replay; смешанные и неизвестные данные отклоняются без интерпретации.

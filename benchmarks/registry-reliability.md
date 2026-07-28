# Registry reliability gate

Этот протокол закрывает V1 раздела III. Он измеряет надёжность извлечения
checkpoint-дельт до включения registry по умолчанию.

## Матрица

Выполнить по три завершённых запуска каждого пресета, всего девять запусков:

| Топология | Пресет | Запусков |
|---|---|---:|
| Duel | Long | 3 |
| Triad | Verdict | 3 |
| Multi | Verdict | 3 |

Перед серией:

1. Перезагрузить расширение и открыть залогиненные вкладки всех выбранных
   провайдеров.
2. Включить registry/checkpoint policy для тестового запуска. Не менять
   настройки или состав участников внутри одной серии.
3. Для каждого запуска сохранить `runId`, topology, preset, модели,
   `checkpointStats`, `registry.violations` и trace-события
   `ANSWER_REJECTED`.

## Сбор метрик

Для каждого запуска зафиксировать:

```text
attempted         = checkpointStats.attempted
parsed            = checkpointStats.parsed
parseFailed       = checkpointStats.parseFailed
deltasProposed    = checkpointStats.deltasProposed
deltasApplied     = checkpointStats.deltasApplied
deltasRejected    = checkpointStats.deltasRejected
```

Рассчитать:

```text
parseRate         = parsed / attempted                         (если attempted > 0)
anchorRejectRate  = deltasRejected / deltasProposed             (если proposed > 0)
```

`deltasRejected` считать именно по отклонениям anchor-валидации, а не по
любому нарушению схемы. Для каждого `registry.violations` сгруппировать
`code`/`reasonCode` и выписать три наиболее частых кода. Нулевые знаменатели
пометить `not measurable`, не считать их успешным результатом.

После девяти запусков посчитать агрегаты по всей серии теми же формулами и
отдельно сохранить таблицу по пресетам:

| Пресет | attempted | parsed | parse-rate | proposed | anchor-rejected | reject-rate | top-3 violations |
|---|---:|---:|---:|---:|---:|---:|---|
| Duel Long |  |  |  |  |  |  |  |
| Triad Verdict |  |  |  |  |  |  |  |
| Multi Verdict |  |  |  |  |  |  |  |
| Итого |  |  |  |  |  |  |  |

## Решение гейта

Гейт проходит только если одновременно выполняются оба условия:

- `parse-rate >= 0.80`;
- `anchorRejectRate <= 0.25`.

При успехе включить registry по умолчанию для пресетов с checkpoint policy,
сохранив действующие opt-out переключатели. При провале оставить registry
выключенным по умолчанию, уточнить checkpoint prompt, затем провести одну
повторную серию. После второй неудачи остановить включение и передать числа и
топ-3 нарушений на пересмотр.

## Артефакт результата

Результат серии добавить в `docs/disput-docs/reports/D18_section-three-report.md`: таблицу с числами,
решение `pass`/`fail`/`not measured`, дату, commit-free версию расширения и
ссылки на сохранённые run artifacts. До появления залогиненных вкладок статус
должен оставаться `not measured`; unit-тесты не являются заменой live-gate.

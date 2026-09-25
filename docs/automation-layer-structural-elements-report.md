# Отчёт по структурной разметке Automation Layer

Контракт: `AL-STRUCT-1`

В этой реализации **весь предложенный набор структурной разметки включён в обязательный response contract**. Ничего из структурной разметки сознательно не исключено.

## Обязательные блоки каждого ответа модели

| Блок | Что покрывает |
|---|---|
| `passport` | contract identity, stage, accountable input IDs |
| `outputs` | stable output ID, type, version, основной content |
| `annotations` | typed semantic markers: FACT, ASSUMPTION, CONSTRAINT, DECISION, RISK, EVIDENCE, FINDING, CONFLICT, OPEN, DEFERRED, CHANGE, BASELINE, VERIFIED, REJECTED, SUPERSEDED |
| `trace` | provenance / lineage: какой output произведён из каких inputs |
| `input_fate` | disposition каждого входа: CONSUMED, PRESERVED, REJECTED, SUPERSEDED, NOT_USED |
| `changes` | mutation semantics: SYNTHESIZED, MERGED, REVISED и другие применимые изменения |
| `completion` | terminal marker, output manifest, output count, EMPTY_BY_DESIGN, anomalies |

## Runtime-only структурные поля

Поля, которые модель не должна придумывать, добавляет Automation Controller:

- `run_id`
- `model`
- `round`
- `prompt_hash`
- `payload_hash`

Они отображаются вместе со структурой ответа и попадают в audit, но остаются системными данными.

## Round 1

Accountable input:

`ORIGINAL_REQUEST`

Модель обязана:

- вернуть JSON по `AL-STRUCT-1`;
- создать минимум один `ANSWER` output;
- связать его через `trace` с `ORIGINAL_REQUEST`;
- указать fate исходного input;
- завершить ответ `completion.status = COMPLETE`.

Обычный неструктурированный prose больше не принимается.

## Round 2

Accountable inputs:

- `ORIGINAL_REQUEST`
- `ROUND1_<MODEL_A>`
- `ROUND1_<MODEL_B>`

Round 2 получает именно структурированные Round 1 objects.

Модель обязана показать lineage и fate для всех трёх inputs. Это позволяет проверить, что второй этап действительно использовал оба исходных ответа и исходный запрос.

## Typed annotations

Все типы структурных маркеров поддерживаются единым массивом `annotations`.

Это сделано намеренно, чтобы не превращать каждый ответ в десятки пустых секций. Например, если в ответе нет риска, объект `RISK` не создаётся; это не означает, что элемент разметки исключён из контракта.

## Validation

Ответ принимается только если validator подтверждает:

- contract и stage;
- coverage всех accountable inputs;
- output ID/type/version/content;
- допустимые annotation types;
- provenance coverage;
- input fate coverage;
- changes array;
- terminal completion;
- output manifest/count.

При нарушении ответ получает `STRUCTURE_INVALID` и не участвует в следующем этапе.

## Итог

Структурная разметка реализована полностью, но компактно:

```text
passport
outputs
annotations
trace
input_fate
changes
completion
+ runtime integrity metadata
```

То есть разметка присутствует физически в каждом принятом ответе, проверяется машинно и видна пользователю в сворачиваемом блоке `Structure`.

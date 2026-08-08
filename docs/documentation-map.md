# Documentation map

Этот файл — единственная карта документации всего проекта. Он отвечает на
вопрос «куда заносить новую информацию» и не допускает появления параллельных
карт по отдельным разделам.

## Правило выбора документа

| Если нужно описать… | Канонический документ | Не дублировать в… |
|---|---|---|
| Общий runtime, назначение системы, модули и команды | [project-overview.md](project-overview.md) | README, changelog, отчёты |
| Структуру каталогов и состав файлов | [project-structure.md](project-structure.md) | архитектурные спецификации |
| Выбор моделей на главной странице, model tabs, tab ownership и dispatch | [model-tabs-architecture.md](model-tabs-architecture.md) | project-overview, operational guides |
| Полный порядок foreground visits, focus ownership, lease, quota и recovery | [model-tabs-architecture.md#pages-visit](model-tabs-architecture.md#pages-visit) | timing-документы, telemetry history |
| Все текущие числовые тайминги, retry/backoff и wait budgets | [timings-settings.md](timings-settings.md) | model-tabs-architecture, changelog |
| Исторический снимок timing-настроек | [timings-settings - jul24.md](<timings-settings - jul24.md>) | текущая спецификация |
| Общая telemetry главной страницы: текущая схема, экспорт и диагностика | [telemetry.md](telemetry.md) | архитектура, changelog |
| Нормативные proof-oriented telemetry contracts, план и примеры отчётов | [proof-telemetry-run-lifecycle-contract.md](proof-telemetry-run-lifecycle-contract.md), [proof-telemetry-clock-contract.md](proof-telemetry-clock-contract.md), [temetria-plan-2026-08-28.md](temetria-plan-2026-08-28.md), [proof_oriented_telemetry_spec_v1/README.md](proof_oriented_telemetry_spec_v1/README.md) | telemetry history, архитектура |
| Полнота извлечения ответа: принципы, состояние фаз и журнал отвергнутых решений | [answer-completeness-handoff.md](answer-completeness-handoff.md) | changelog, telemetry, live-answer-skeletons |
| Каталог внешних идей по доказательству состояния на чужой странице | [review->LLM-pages.md](<review->LLM-pages.md>) | answer-completeness-handoff |
| Отложенные альтернативы определению окончания генерации | [answers-detection-alternativa.md](answers-detection-alternativa.md) | review->LLM-pages, answer-completeness-handoff |
| Контракт результата run: типы, лестница P0–P4, наблюдение транспорта | [run-result-contract.md](run-result-contract.md) | answer-completeness-handoff, answers-detection-alternativa |
| Актуальная нормативная документация Disput | [disput/README-disput.md](disput/README-disput.md) | старый архив |
| Universal pipeline и lifecycle owner Disput | [disput/orchestrator-contract-v1.0.md](disput/orchestrator-contract-v1.0.md), [disput/PLAN-universal-pipeline-v3.0.md](disput/PLAN-universal-pipeline-v3.0.md) | README, telemetry history |
| Disput UI/runtime corrections и synthesis insertion | [disput/TZ-runtime-ui-corrections-v1.0.md](disput/TZ-runtime-ui-corrections-v1.0.md), [disput/TZ-synthesis-insertion-v1.1.md](disput/TZ-synthesis-insertion-v1.1.md) | model-tabs-architecture |
| Semantic layer ownership, durability, planner и projection | [disput/ADR-002-semantic-layer-ownership.md](disput/ADR-002-semantic-layer-ownership.md), phase-документы в [disput/](disput/) | старые планы и архив |
| Disput telemetry, trace privacy, redaction и export boundary | [disput/README-disput.md](disput/README-disput.md), [disput/PLAN-semantic-layer-v1.0.md](disput/PLAN-semantic-layer-v1.0.md) | general telemetry history |
| Реализовано, доказательства и открытые обязательства Disput | [disput/EVIDENCE-MATRIX-v3.0.md](disput/EVIDENCE-MATRIX-v3.0.md), [disput/OPEN-ITEMS-v3.0.md](disput/OPEN-ITEMS-v3.0.md) | changelog |
| Selector health, overrides и ручная настройка селекторов | [selectors-tab-first-run-guide.md](selectors-tab-first-run-guide.md), [devtools-selectors-user-guide.md](devtools-selectors-user-guide.md) | model-tabs-architecture |
| Storage и ручная диагностика вкладок | [storage-tab-guide.md](storage-tab-guide.md) | model-tabs-architecture |
| Добавление новой модели | [add-new-model-spec.md](add-new-model-spec.md) | provider-specific заметки |
| Что изменилось, когда и в каких файлах | [CHANGELOG.md](CHANGELOG.md) | нормативные документы |
| Навигация по документации | этот файл | остальные документы |

## Нормативность

- `model-tabs-architecture.md` — контракт главной страницы, вкладок моделей и
  Pages Visit.
- `timings-settings.md` — единственный текущий перечень числовых таймингов.
- `telemetry.md` — контракт и диагностика общей telemetry главной страницы.
- `proof-telemetry-run-lifecycle-contract.md` и
  `proof-telemetry-clock-contract.md` — нормативные lifecycle/clock contracts;
  schema 6 events исполняются внутри schema 5 export-container compatibility
  envelope. `temetria-plan-2026-08-28.md` фиксирует implementation gates.
- `answer-completeness-handoff.md` — четыре принципа доказательства полноты ответа,
  состояние фаз, открытые пункты и обоснования отвергнутых альтернатив. Читать перед
  любой правкой резолвера узла, структурного инварианта или проекции статуса.
- `disput/README-disput.md` — точка входа и каталог актуальной документации
  Disput; это не отдельная общепроектная карта.
- `disput/` содержит текущие Disput-контракты, планы и evidence; новые
  нормативные документы в других каталогах не создаются.
- `disput-old/` — архив, не источник требований к текущему runtime.
- `CHANGELOG.md` — история, а не текущая спецификация.

## Как документировать изменение

1. Найти владельца по таблице выше и обновить один нормативный документ.
2. Если изменились архитектурная граница, telemetry/privacy или timing,
   обновить соответствующий раздел владельца в том же change set.
3. Добавить краткую запись в [CHANGELOG.md](CHANGELOG.md), если изменение
   меняет runtime или публичный контракт.
4. Открытые задачи помещать в [disput/OPEN-ITEMS-v3.0.md](disput/OPEN-ITEMS-v3.0.md)
   или соответствующий существующий отчёт, не создавая новую карту.
5. После переименования или удаления проверить ссылки командой `rg` и через
   поиск по старому имени.

## Источники истины

Исполняемый код и тесты имеют приоритет над prose. Документация фиксирует
контракт и навигацию, но не подменяет executable validation. Исторические
аудиты, snapshots и архивы сохраняются для контекста и не должны описывать
новую текущую политику.

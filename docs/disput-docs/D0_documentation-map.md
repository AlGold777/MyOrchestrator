# D0. Карта документации Disput

Этот файл — единственная точка входа в документацию Disput. Вся документация
Disput, отчёты и архив требований находятся внутри `docs/disput-docs/`, но это
разные классы материалов. Нормативная документация — D0–D11, D21 и F0.
Отчёты, планы и незавершённая работа находятся в `reports/`. История изменений
всего проекта находится только в [docs/CHANGELOG.md](../CHANGELOG.md).

## Рекомендуемый порядок

| № | Документ | Владеет вопросом |
|---:|---|---|
| D0 | этот файл | навигация, нормативность, правила сопровождения |
| D1 | [Общее описание](D1_disput-system-overview.md) | смысл системы, предметная модель, принципы и non-goals |
| D2 | [Архитектура](D2_disput-architecture.md) | модули, ownership, plan, runtime, state и terminal flow |
| D3 | [Границы архитектуры](D3_disput-architecture-boundaries.md) | допустимые зависимости UI, application, protocol и effects |
| D4 | [Профили и FreeTalk](D4_pipeline-profiles-and-freetalk.md) | schema профиля, расширения, FreeTalk и совместимость |
| F0 | [FreeTalk](F0_freetalk.md) | главный pipeline: смысл, цикл, триггеры, карта, роли и завершение |
| D5 | [Prompt system](D5_disput-prompt-system.md) | Task/Stage/Action, PromptCompiler, контекст, acceptance и word limit |
| D6 | [Карта, правила и решения](D6_state-map-rules-and-decisions.md) | DebateCase, StateDelta, RuleEngine, DecisionRequest, progress и ModelSignal |
| D7 | [Telemetry](D7_disput-telemetry.md) | trace schema, correlation, privacy, диагностика и экспорт |
| D8 | [Duel](D8_duel-protocol.md) | исполняемый контракт двух участников |
| D9 | [Triad](D9_triad-protocol.md) | волны трёх участников и checkpoint |
| D10 | [Multi](D10_multi-protocol.md) | группы произвольного числа участников |
| D11 | [Round plans](D11_debate-round-plans.md) | канонические планы Verdict и Red Team |
| D21 | [Справочник реализации](D21_disput-implementation-reference.md) | фактические модули, UI, хранилища, команды, экспорты и проверки |
| — | [Отчёты и планы](reports/) | планы внедрения, prompt-аудиты, эксперименты и открытые задачи; D20 описывает будущий движок «Обсуждение темы» |
| — | `F0_freetalk-prototype.html` | ранний исследовательский макет; не является нормативным описанием текущего UI |
| D90+ | [Архив требований](archive/disput/D90_historical-requirements-index.md) | исходные ТЗ; не нормативны для runtime |

## Источники истины

- Концепция и термины — D1.
- Реальные границы кода и ownership — D2 и D3.
- Общие механизмы, одинаковые для topology, — D4–D7.
- Отличия алгоритмов Duel/Triad/Multi — D8–D10.
- Состав встроенных раундов — только D11.
- История всех изменений — [docs/CHANGELOG.md](../CHANGELOG.md); незавершённая работа — `reports/D19_disput-next-steps.md`.
- Точные schema и значения по умолчанию окончательно определяет код и тесты. Документация объясняет контракт, но не подменяет executable validation.

## Как документировать изменение

1. Обновить ровно один нормативный документ-владелец.
2. Если меняется ownership или поток состояния, также обновить D2/D3.
3. Если меняется событие, диагностика или privacy boundary, обновить D7.
4. Добавить одну запись в [docs/CHANGELOG.md](../CHANGELOG.md): причина, изменение, ключевые файлы, проверка.
5. Оставшуюся работу записать в `reports/D19_disput-next-steps.md`; выполненный пункт оттуда удалить.
6. Не переносить новые решения в D90+ и не создавать параллельную спецификацию.
7. D21 обновляется при изменении фактического состава модулей, UI-команд, хранилищ или тестовых гарантий.
8. После переименования проверить все Markdown-ссылки и поиск по старому имени.

## Нормативность и история

D1–D11, D21 и F0 описывают текущую систему. Материалы в `reports/` дают историю
работы, планы и результаты экспериментов, но не могут отменять текущие
контракты. Общепроектный `docs/CHANGELOG.md` фиксирует изменения, но не является
спецификацией.
При противоречии отчёта и нормативного документа действует нормативный
документ и код текущей версии.

## Документы проекта вне Disput

Общие документы проекта не получают префикс `D`: `project-overview.md`, `project-structure.md`, `model-tabs-architecture.md`, `timing-map.md`, provider/selector/storage guides, `telemetry.md`, каталоги `stabilization/` и `graph-mode/`. Они могут ссылаться на Disput, но не владеют его протоколами.

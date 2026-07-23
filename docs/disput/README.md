# Disput — актуальная нормативная документация

`docs/disput/` — единственный источник актуальных требований, контрактов и
доказательств готовности Disput. Архив расположен отдельно в
[`../disput-old/`](../disput-old/) и не задаёт требования к текущей реализации.

## Нормативные документы

1. [Universal pipeline plan](PLAN-universal-pipeline-v3.0.md) — решения, статус, release-задачи и gates.
2. [Orchestrator contract](orchestrator-contract-v1.0.md) — единственный lifecycle owner.
3. [Plan revision specification](plan-revision-specification-v1.0.md) — immutable-команды и revisions.
4. [ADR-001: Universal-only cutover](ADR-001-universal-only-cutover.md) — принятое решение об отсутствии legacy fallback.
5. [Evidence matrix](EVIDENCE-MATRIX-v3.0.md) — требование → код → тест → release gate.
6. [Незавершённые обязательства](OPEN-ITEMS-v3.0.md) — открытые P0/P1/P2 и критерии их закрытия.

## Обязательная дисциплина изменений

Любое изменение Disput, включая документацию, выполняется одним атомарным
change set:

1. увеличивается версия в `manifest.json` и `package.json`;
2. добавляется верхняя запись в `docs/CHANGELOG.md`;
3. обновляется этот каталог: контракт, план и/или evidence matrix по затронутой области;
4. добавляются или обновляются детерминированные тесты;
5. в evidence matrix фиксируется фактический статус: `implemented`, `partial`,
   `planned` или `not-applicable`.

Новый материал не может вводить альтернативный executor, фиксированную форму
разговора или второй источник lifecycle state.

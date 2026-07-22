# D14. Prompt audit — baseline report

Дата: 2026-07-16. Scope: Z1–Z2 статический аудит. Z3–Z5 частично заблокированы отсутствием залогиненных вкладок LLM в текущей среде. Prompt builders и runtime не исправлялись.

## Z1. Инвентаризация

| ID | Источник | Назначение |
|---|---|---|
| P1 | `disput/debate-prompt-catalog.js:7-18` | роли и миссии Duel/Triad/Multi |
| P2 | `disput/debate-prompt-catalog.js:42-70` | renderTemplate и round filter |
| P3 | `disput/debate-prompt-catalog.js:73-119` | Duel final word, moderator summary, final synthesis |
| P4 | `disput/debate-prompt-catalog.js:122-171` | Multi waves и final synthesis |
| P5 | `disput/disput-massage.js:11-166` | Duel init/turn/envelope |
| P6 | `disput/triad-massage.js:25-229` | Triad init/wave/final/checkpoint |
| P7 | `disput/triad-massage.js:235-264` | checkpoint JSON parser |
| P8 | `disput/debate-engine.js:329-380` | fallback builders; при наличии шаблонов P5 делегирование |
| P9 | `disput/pipeline-presets.js:177-185` | 9 roundPlan-артефактов и режимы пресетов |
| P10 | `results.js:300-350,1055-1080,3269-3356` | общие judge prompts и UI-описания Debate |
| P11 | `prompts.json` | general judge/evaluation prompts; вне protocol catalog |
| P12 | `system_templates/*.json` | general templates; вне protocol catalog |

### Фактические миссии

| Пресеты | suffix/class | Миссия |
|---|---|---|
| Duel/Triad/Multi Verdict | Verdict/standard | verdict |
| Duel/Triad/Multi Red Team | Red Team/medium | red_team |
| Duel/Triad/Multi Long | Long/infinite | long; Multi Long отключён |

### Находки

| ID | Место | Критичность | Категория | Наблюдение и рекомендация | Связь |
|---|---|---|---|---|---|
| F-01 | P3/P4 | high | языки | Финальные промпты английские, роли/миссии/Triad — русские; согласовать единый язык. | T2/T9 |
| F-02 | P2/P4 | high | артефакты | Имена roundPlan (`claim_ledger`, `weighted_synthesis` и др.) передаются без определения формата. | T1 |
| F-03 | P4:133-145 | med | generic stages | После первой волны одна общая инструкция critique/improve для разных фаз. | T2 |
| F-04 | P1:31-40 | med | роли | Пустые `interaction_*` роли чередуются critical/meta; для 4+ моделей роли повторяются. | T2.5 |
| F-05 | P1:42-48 | med | rendering | `renderTemplate` заменяет только переданные ключи; unknown `{key}` остаётся буквально. | T1/T5 |
| F-06 | P5/P6 | med | артефакты | `roundOutputs` называют artifacts, но не задают структуру каждого. | T1 |
| F-07 | P9 vs P3-P6 | med | length | `length` хранится в preset, но builders его не получают. | T5 |
| F-08 | P5 vs P8 | low | drift | Fallback envelope почти дублирует P5; остаётся потенциальная точка дрейфа. | T2; новое |
| F-09 | P6:197-227 vs P7:235-264 | high | checkpoint | Prompt требует только JSON; parser принимает внешний текст через диапазон первой `{`–последней `}`. Несколько блоков и вложенные фигурные блоки хрупки. | V1 |
| F-10 | P3/P4 | med | contract | Синтез требует resolved/unresolved/assumptions, но обязательные секции не проверяются. | T9/V1 |
| F-11 | P6:222-227 | med | contradiction | `closed/refuted` разрешены, но запрещены без свежей опоры; условие не закреплено схемой. | V1 |
| F-12 | P6:174, P4:155 | low | language | Роль checkpoint явно отделена от вердикта, Multi synthesizer не получает явного требования русского ответа. | V1/T2 |

`prompts.json` и `system_templates/` оставлены в инвентаризации, но исключены из protocol findings: это общий evaluation/template UI.

## Z2–Z3

Матрица и фиксированные задачи находятся в [D15](D15_prompt-audit-tasks.md). В текущей среде нет доступа к залогиненным вкладкам провайдеров и UI-браузеру, поэтому 14 auto и 2 manual прогона не выполнены. Кабинетные находки не считаются подтверждёнными живыми ответами.

## Z5. Калибровка

- **T1:** первыми определить все artifact ids из `pipeline-presets.js`, особенно `claim_ledger`, `positions_map`, `failure_modes`, `final_verdict`.
- **T2/T2.5:** baseline подтверждает смешение языков и generic-инструкции; рекомендуется единый русский контракт с явными фазами.
- **T5:** `length` не виден в builders; передачу лимитов нужно проверить трассировкой.
- **T8:** fixed presets имеют `runPolicy: auto`; manual остаётся открытым до живого прогона.
- **T9/U1:** final synthesis не требует отдельными секциями minority, unresolved и `synthesis_inference`.
- **V1:** checkpoint prompt строгий, parser tolerant; числовые parse/reject метрики возможны только после Z3.
- **T12:** tasks.md и будущие traces должны стать baseline «до правок».

## Рекомендуемый порядок после Z3

1. Согласовать язык prompt contracts.
2. Определить artifact schemas (T1).
3. Развести generic stage prompts (T2/T2.5).
4. Добавить synthesis sections и validator (T9).
5. Уточнить checkpoint parser после измерений V1.

Открытые решения: русский язык — рекомендуется; registry по умолчанию до V1 — не рекомендуется; manual fixed presets — оставить экспериментом до Z3.

## Post-audit implementation review — 2026-07-17 / 2.80.222

Реальный Triad Red Team прогон, переданный после baseline-аудита, завершился на
проверке плана: сначала отсутствовали участники `r1…r4/final`, затем validator
не знал `independent_retest`. Следовательно, этот файл не является наблюдением
качества prompt outputs: модели не прошли полную причинную цепочку. Ошибки
классифицированы как compilation/config defects и исправлены в compiler,
presets, artifact registry и runners.

Статус кабинетных находок после реализации:

| Finding | Статус 2.80.222 |
|---|---|
| F-02/F-06 | закрыто: каждый round artifact имеет purpose/format/completion и validator guard. |
| F-03 | закрыто: stage phase выводится из outputs; добавлена отдельная retest-фаза. |
| F-04 | закрыто: роли повторяются на N моделей, все Multi-критики планируются. |
| F-09/F-11 | инструментировано: parse failures и rejected deltas измеряются; числовой V1 gate ещё не проведён. |
| F-10 | закрыто: единые обязательные synthesis sections, один repair и явное событие после miss. |
| F-01/F-12 | частично: contracts содержат русские нормативные секции, но часть служебных инструкций остаётся двуязычной; функционального конфликта тесты не выявили. |
| F-05/F-07/F-08 | не изменяет текущий protocol gate; сохраняется как предмет отдельной prompt-quality серии. |

## Prompt pack 2.0 — 2026-07-19

F-01 и F-07 закрыты в коде: предметные prompt contracts приведены к
русскому task-first формату, а числовое значение `debate-length-select`
передаётся в participant, service, final, synthesis и audit builders как
максимум слов. Отдельный контракт закреплён в
[`D5_disput-prompt-system.md`](../D5_disput-prompt-system.md). Живая матрица Z3–Z5 по-прежнему
не заменяется unit/integration-проверками.

Z3–Z5 остаются незавершёнными не из-за кода, а потому что матрица требует 14
auto + 2 manual живых прогонов с залогиненными провайдерами. Один compilation-
failed run не заменяет эту выборку. До неё baseline-задачи и порядок ответов из
[D15](D15_prompt-audit-tasks.md) остаются неизменными.

## Prompt runtime 3.0 — 2026-07-19

Статический follow-up после архитектурного review закрыл системные причины
перегруженных и нетрассируемых запросов:

- задача, этап и действие представлены отдельными версионированными
  `TaskContract`, `StageContract` и `ActionContract`;
- единый `PromptCompiler` собирает запрос через pack `3.0.0` и сохраняет
  воспроизводимый fingerprint;
- `ContextBroker` выбирает контекст по target/provenance/relevance, резервирует
  место под ответ и маркирует model/document content как недоверенный;
- acceptance учитывает класс задачи, поэтому короткий прямой ответ допустим,
  а лимит слов, обязательные секции и JSON проверяются явно;
- audit использует строгий JSON-контракт, repair ограничен одной попыткой;
- extraction больше не может напрямую менять карту: `StateDelta` требует
  source event, точную цитату, confidence и актуальные sequence/revision;
- FreeTalk выбирает разрешённые профилем действия и capability-/independence-
  aware модель, фиксируя degraded routing.

Покрытие добавлено в `tests/debate-prompt-runtime-v3.test.js` и полном Jest.
Это закрывает статическую реализацию, но не заменяет Z3–Z5: качество ответов,
устойчивость provider extraction и сравнительное преимущество проверяются
только живой матрицей.

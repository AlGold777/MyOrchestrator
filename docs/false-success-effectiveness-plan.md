# `false-success`: проверенный план повышения эффективности

Дата проверки: 2026-07-30. База реализации: `426dcd9`.

План основан на альтернативном документе
`.claude/worktrees/telemetry-presets-review-dd0c79/docs/false-success-effectiveness-plan.md`,
но его фактические утверждения повторно проверены на текущем коде исполнением
цепочки runtime → canonical event → native ledger companions → evidence slots →
diagnostic verdict.

## 1. Поправки к исходному плану

1.1. D1 подтверждён: явный typed-факт `ANSWER_COMPLETE_DETECTED` конфликтует с
каноническим состоянием `evaluated`, которое является лишь значением по
умолчанию. Такой конфликт ошибочно блокирует все presets.

1.2. D2 подтверждён: штатный post-terminal `ANSWER_GENERATING` становится
`GENERATION_SIGNAL_CHANGED`, а обязательный слот `post_terminal_mutation`
принимает только `TEXT_STATE_CHANGED`. Отсутствие completion evidence ошибочно
блокирует уже доказанный occurrence.

1.3. D3 уточнён. Имена измерений действительно расходятся, однако
`ANSWER_LENGTH_DECREASED` нельзя превращать в отрицательный аудит False success:
уменьшение или промежуточный frame не доказывает, что последующего роста не
будет. Consumer должен принимать унифицированные `normalizedLength` и
`normalizedHash`, а отрицательный verdict допускается только после закрытия
окна наблюдения.

1.4. D4 подтверждён: `MODEL_FINAL` публикует `answerLen`, но не плоские
нормализованные hash/length/version, поэтому замена текста той же длины не
сравнивается надёжно.

1.5. D5 в исходной формулировке неверен. `LATE_COLLECT_DECISION_TRACE` уже
публикует `textLength/textHash`, а `ANSWER_SOURCE_MATERIALIZED` публикует
`normalizedLength/normalizedHash/normalizationVersion`. Потеря происходит в
`ProofTelemetryAudit.planAfterEvent`, который не читает `normalizedLength` и не
признаёт часть recovery labels наблюдениями. Добавлять ещё один producer до
исправления consumer не требуется.

1.6. D6-D10 подтверждены с оговоркой: legacy `buildLedger` остаётся
compatibility-путём и не должен синтезировать native companions задним числом;
он обязан явно сообщать limitation.

1.7. Утверждение «`normalizedLength` отсутствует в коде» удалено как неверное.
Поле уже используется source, commit и render evidence.

## 2. План реализации

2.1. Устранить ложные typed/canonical конфликты, когда canonical state получен
из fallback, сохранив обнаружение конфликтов двух явных утверждений. — Done

2.2. Разделить доказательство occurrence False success и объяснение причины:
post-terminal рост закрывается штатным post-terminal generation/frame evidence;
completion hypothesis остаётся объясняющим, но не блокирующим слотом. — Done

2.3. Добавить temporal-правила для `generation_state` и
`post_terminal_mutation`; pre-terminal события не закрывают post-terminal слот.
— Done

2.4. Научить post-terminal audit сравнивать `normalizedLength` и
`normalizedHash`, проверяя совместимость normalization version. — Done

2.5. Добавить нормализованные length/hash/version в `MODEL_FINAL`, используя
уже вычисленное accepted-answer proof, без повторной нормализации. — Done

2.6. Признать только содержательные recovery/source события post-terminal
наблюдениями. Transport-only `MATERIALIZE_RECOVERY_VISIT_RESULT` без текста не
должен подтверждать или опровергать рост. — Done

2.7. Передавать immutable identity lifecycle tracker во все события:
runSessionId, dispatchId, generationEpoch, turnAnchor/candidateId и доступную
navigation lineage. Background не должен заменять присутствующую identity
текущим dispatch. — Done

2.8. Ограничить audit одной navigation lineage. При доказанной смене document
или navigation epoch результат `unknown`, а не `contradicted`. — Done

2.9. Реализовать ограниченное post-terminal окно наблюдения со снимками на
1/3/8/15/30 секундах и явным закрытием `unchanged | changed | unavailable`.
До закрытия окна отсутствие роста остаётся `unknown`. — Done

2.10. Legacy export явно сообщает limitation `native_post_terminal_audit_absent`
и не делает вид, что отсутствие companion является отрицательным доказательством.
— Done

2.11. Добавить регрессионную матрицу: штатный прогон, реальный рост,
фон/тротлинг, recovery, повтор dispatch, SPA, вложения и закрытие вкладки.
— Done

2.12. Обновить telemetry docs, changelog, manifest/package version и примеры
контракта. — Done

## 3. Зафиксированные продуктовые значения реализации

3.1. Preset отвечает на вопрос о росте, а не о любой замене текста. Hash-only
замена сохраняется как отдельное доказательство изменения, но сама по себе не
подтверждает False success.

3.2. Сохраняется текущий порог существенного роста `0.5%`; его изменение не
входит в эту реализацию.

3.3. Хранятся длина, версия нормализации и privacy-safe hash; сырой текст и DOM
не добавляются.

3.4. SPA-навигация разрывает аудит, если continuity текущего document/turn не
доказана.

3.5. Закрытие вкладки даёт `unknown`, а не подтверждение или опровержение.

3.6. Окно длится 30 секунд: оно покрывает паузы генерации длиннее исходных
8 секунд, при этом сохраняет ограниченный объём — пять снимков на прогон.

## 4. Критерий завершения

Каждый пункт 2.1-2.12 отмечен `Done`. Профильный gate: 13 suites / 132 tests;
полный gate: 190 suites / 1358 tests. Оба зелёные. Версия `2.81.169`, registry
`6.6.0`, report `3.6.0`, generator `2.6.0` синхронизированы; изменения разделены
на самостоятельные коммиты.

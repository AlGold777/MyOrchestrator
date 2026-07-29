# No delivery: план proof-oriented telemetry preset

Дата: 2026-07-29  
Статус: согласованный план реализации; выполнение начато.

## 1. Назначение

`No delivery` отвечает на один пользовательский вопрос:

> Почему ответ текущего запроса материализовался на стороне provider, но
> правильный результат не оказался в карточке этой модели и этого запроса?

Это сквозной диагноз разрыва цепочки доставки, а не новое имя для пустого
extraction. Проверяемая цепочка:

`ответ материализован → замечен → выбран → извлечён → проверен → передан → сохранён → показан`

Preset обязан одновременно:

1. доказать наблюдаемую материализацию ответа текущего запроса, не приписывая
   системе знание о внутреннем состоянии модели;
2. доказать отсутствие правильного результата в ожидаемой карточке;
3. определить последний доказанно успешный этап и первый доказанно неуспешный;
4. не выдавать отсутствие телеметрии за доказательство сбоя;
5. сформировать минимальный отчёт, достаточный для независимой проверки вывода.

## 2. Границы диагноза

### 2.1. Входит в No delivery

1. Видимый ответ существует, extraction вернул пусто.
2. Вместо ответа извлечено техническое сообщение, placeholder, prompt echo или
   другой непригодный контент.
3. Выбран неправильный DOM-узел или неправильный candidate.
4. Извлечён правильный ответ, но transport до background не завершился.
5. Background получил ответ, но он не был принят или сохранён.
6. Ответ сохранён, но правильная карточка не обновилась.
7. Ответ прикреплён к другой модели, карточке, dispatch или generation epoch.
8. Автоматический pipeline завершил задачу без ответа, а последующее recovery
   нашло ответ текущего запроса.
9. Ответ исчез или был заменён между наблюдением и extraction.
10. Ответ находится в iframe, Shadow DOM, virtualized container, attachment,
    canvas или другом источнике, который текущий extraction не материализовал.

### 2.2. Не входит без дополнительных доказательств

1. Модель не получила prompt — это `Prompt not sent`.
2. Prompt не попал в composer — это `Prompt not inserted`.
3. Нет доказательства, что ответ текущего запроса материализовался на provider
   surface — No delivery остаётся `unknown`, даже если карточка пуста.
4. В карточку пришёл правильный текущий ответ, но только его часть — основной
   диагноз `Cutted`; No delivery используется лишь если результат непригоден как
   ответ целиком.
5. В карточку пришёл полный предыдущий ответ — `Old answer` является причиной,
   а No delivery может быть следствием отсутствия правильного текущего ответа.
6. `SUCCESS` поставлен до продолжения роста ответа — это `False success`;
   No delivery добавляется только если правильная финальная версия не дошла до
   карточки.
7. На странице есть только provider error/rate-limit и нет доказанного ответа —
   это failure генерации/provider, а не No delivery.

### 2.3. Отношения с другими presets

`No delivery` — outcome diagnosis. `Old answer`, `Cutted` и будущие более узкие
диагнозы могут объяснять его причину. Arbitration не должна объявлять их
взаимоисключающими автоматически.

Предлагаемые отношения:

| Связка | Отношение |
|---|---|
| Old answer → No delivery | causal: правильный текущий ответ не доставлен |
| extraction empty/wrong node → No delivery | causal subtype внутри No delivery |
| transport/storage/render failure → No delivery | causal subtype внутри No delivery |
| Cutted ↔ No delivery | обычно alternative; co-occurring только для непригодного результата |
| False success → No delivery | causal только если финальная версия отсутствует в карточке |
| Prompt not sent ↔ No delivery | mutually exclusive при доказанной материализации current-dispatch ответа |

## 3. Два независимых результата

Нельзя снова смешивать факт проблемы с полнотой объяснения её причины.

### 3.1. occurrenceVerdict

Отвечает: доказана ли недоставка?

- `confirmed`: ответ текущего запроса доказан, а правильный результат в карточке
  доказанно отсутствует, непригоден или не соответствует source evidence;
- `not_confirmed`: правильный ответ текущего запроса доказанно доставлен в
  правильную карточку;
- `unknown`: неизвестно существование ответа либо неизвестно состояние карточки.

### 3.2. causeVerdict

Отвечает: доказан ли конкретный виновный этап?

- `confirmed`: есть смежные успешная и неуспешная границы одной lineage;
- `supported_but_incomplete`: причина поддерживается, но одна граница или
  causal edge отсутствует;
- `unknown`: недоставка доказана, но локализовать этап нельзя;
- `not_applicable`: occurrence refuted.

Сильный `occurrenceVerdict=confirmed` не должен понижаться только потому, что
причина неизвестна. В отчёте допустим честный результат: «No delivery доказан;
виновный этап неизвестен».

### 3.3. Итоговый diagnosticVerdict

Для совместимости с текущим форматом:

- `confirmed`, если occurrence подтверждён;
- `supported_but_incomplete`, если occurrence имеет положительную поддержку,
  но не доказана одна из двух критических сторон: source answer или card state;
- `not_confirmed`, если доставка доказана;
- `unknown`, если нет достаточных данных даже о факте проблемы.

`causeVerdict` публикуется отдельно и не подменяет `diagnosticVerdict`.

### 3.4. Evaluation boundary и resolution

Каждый verdict привязан к `evaluationBoundaryId` и
`evaluationBoundaryType ∈ {automatic_terminal, delivery_deadline,
recovery_completed, incident_close}`. Текущее состояние публикуется отдельно как
`resolutionState ∈ {unresolved, resolved_by_recovery, resolved_by_retry,
unknown_persistence}`. Позднее исправление не переписывает исторический вывод:
«не доставлено на automatic terminal; восстановлено recovery через N мс».

## 4. Граф границ доставки

Каждый этап имеет входную границу, выходную границу и точную identity.

| Этап | Вход | Успешный выход | Возможный сбой |
|---|---|---|---|
| S0 Dispatch | prompt подготовлен | отправка принята | относится к Prompt presets |
| S1 Generation | prompt принят | current answer существует | generation/provider failure |
| S2 Observation | answer существует | candidate замечен observer | observer/selector/navigation |
| S3 Selection | candidates известны | current candidate выбран | ambiguous/wrong/stale candidate |
| S4 Extraction | candidate выбран | raw content получен | empty/unsupported DOM/non-text |
| S5 Verification | raw content получен | content признан правильным | technical/prompt echo/prior/invalid |
| S6 Transport | verified payload готов | background подтвердил тот же payload | message loss/timeout/hash mismatch |
| S7 Commit | payload принят | state/storage read-back совпал | reject/overwrite/write failure |
| S8 Render | commit подтверждён | правильная карточка показывает payload | wrong card/stale UI/render failure |

Эти стадии являются словарём наблюдаемых границ, а не обязательной линейной
машиной. Реальный pipeline образует граф: retry, fallback, recovery и
supersession создают отдельные attempt paths. Причина определяется внутри одной
доказанной path как диапазон `lastSuccessfulBoundary →
firstObservedUnsuccessfulBoundary`. Если path identity или промежуточная
граница отсутствует, причина остаётся `supported_but_incomplete` либо `unknown`.

## 5. Таксономия причин

Причины должны быть стабильными machine-readable codes, а не свободным текстом.

Нормативный результат содержит четыре независимые оси:

1. `failureStageCode` — наблюдаемая граница или диапазон сбоя;
2. `mechanismCauseCode` — только доказанный механизм;
3. `observabilityLimitationCodes[]` — пробелы observer/clock/identity;
4. `recoveryFindingCode` — результат recovery, но не причина сбоя.

Перечни ниже являются backlog кандидатов, а не стартовым registry. В первой
реализации разрешены только шесть кодов с исполнимыми контрактами:
`extraction_empty`, `extraction_unsupported_source`,
`delivery_rejected_post_terminal`, `delivery_rejected_correlation`,
`commit_overwritten`, `card_render_empty`. `observer_gap` относится к
`observabilityLimitationCodes`, а `manual_recovery_found_answer` — к
`recoveryFindingCode`.

### 5.1. Observation

- `observer_unavailable`
- `observer_gap`
- `document_replaced`
- `navigation_changed`
- `selector_missed_answer`
- `virtualized_answer_not_materialized`
- `unsupported_dom_boundary`

### 5.2. Candidate selection

- `candidate_not_found`
- `candidate_ambiguous`
- `wrong_candidate_selected`
- `stale_candidate_selected`
- `candidate_replaced_before_extraction`
- `candidate_dispatch_mismatch`

### 5.3. Extraction

- `extraction_empty`
- `extraction_failed`
- `wrong_node`
- `prompt_echo_extracted`
- `technical_message_extracted`
- `placeholder_extracted`
- `previous_answer_extracted`
- `non_text_content_dropped`
- `content_lost_during_normalization`

### 5.4. Transport

- `delivery_message_not_sent`
- `delivery_ack_timeout`
- `delivery_payload_rejected`
- `delivery_hash_mismatch`
- `receiver_context_lost`

### 5.5. Commit and persistence

- `answer_commit_rejected`
- `answer_overwritten`
- `storage_write_failed`
- `storage_readback_mismatch`
- `terminal_lock_rejected_answer`
- `dispatch_state_closed_early`

### 5.6. Card rendering

- `card_not_found`
- `wrong_card_updated`
- `card_render_empty`
- `card_render_stale`
- `card_hash_mismatch`
- `render_suppressed_by_terminal_state`

### 5.7. Recovery evidence

- `automatic_recovery_found_answer`
- `manual_recovery_found_answer`
- `recovery_found_wrong_dispatch`
- `recovery_identity_unproven`
- `recovery_result_not_committed`

## 6. Identity contract

Каждое доказательство MUST содержать или наследовать:

1. `runSessionId`;
2. `runGeneration`;
3. `modelId`;
4. `dispatchId`;
5. `generationEpoch`, если известен;
6. `candidateId`, начиная с observation;
7. `documentInstanceId` и `navigationEpoch` для DOM evidence;
8. `cardId` или стабильный card binding для commit/render;
9. `payloadEvidenceId` для transport/commit/render;
10. `turnId` либо privacy-safe turn anchor, если provider поддерживает его.

Нельзя связывать этапы только по `modelId` или времени. Неизвестный identity
компонент не равен совпадению. Explicit supersession обязана ссылаться на
предыдущий candidate/payload/card binding.

Минимальная attempt identity вводится до instrumentation: `dispatchId`,
`attemptId`/`sourceRevisionId`, `payloadEvidenceId` и normalization identity.
Без неё две передачи одного и того же hash в одном dispatch причинно
неразличимы.

## 7. Общая версионированная нормализация

До первого hash-сравнения source, extraction, transport, commit и render MUST
использовать одну shared-функцию нормализации. Результат включает
`normalizationVersion`; разные версии дают `incomparable`, а не mismatch.

Для сравнения source, extraction, transport, commit и card используются:

- нормализованная длина;
- privacy-safe content hash;
- structural fingerprint;
- content class;
- candidate/dispatch identity;
- признак наличия non-text blocks;
- версия normalization/classification algorithm.

Raw prompt и raw answer в proof report не экспортируются. Наличие версии в
event envelope без общей функции не считается выполнением контракта.

## 8. События, которые можно переиспользовать

Из `Empty` и текущей системы полезны:

1. `GENERATION_START_EVALUATED`;
2. `GENERATION_SIGNAL_CHANGED`;
3. `TEXT_STATE_CHANGED`;
4. `STABILITY_INTERVAL_CLOSED`;
5. `CANDIDATE_SET_CHANGED`;
6. `CANDIDATE_IDENTITY_INFERRED`;
7. `EXTRACTION_COMPLETED`;
8. `STRUCTURAL_VERIFICATION_EVALUATED`;
9. `ANSWER_COMPLETENESS_EVALUATED`;
10. `PAGE_HEALTH_OBSERVED`;
11. `OBSERVER_HEALTH_INTERVAL_CLOSED`;
12. `MODEL_TERMINAL_RECORDED`;
13. `MISSING_EVIDENCE_RECORDED`.

Их семантика должна быть сужена: один lifecycle label не может называться
`EXTRACTION_COMPLETED`, если extraction фактически не происходил.

## 9. Новые или разделённые telemetry events

Названия являются контрактным предложением для review, не кодом.

### 9.1. Observation and candidate

1. `ANSWER_SOURCE_MATERIALIZED`
   - source proof level: `direct_preterminal|direct_postterminal|
     retrospective_identity_proven|inferred|unproven`;
   - dispatch/attempt/candidate identity, normalized length/hash;
   - provider-observed boundary; событие не утверждает внутреннее создание
     ответа моделью.
2. `ANSWER_CANDIDATE_OBSERVED`
   - candidate identity, role, visibility, DOM fingerprint, length/hash;
   - first/last observed monotonic time;
   - current-dispatch evidence.
3. `ANSWER_CANDIDATE_INVALIDATED`
   - replacement/removal/navigation reason;
   - superseded candidate reference.

### 9.2. Extraction

4. `EXTRACTION_ATTEMPTED`
   - strategy, selector version, candidate ID, source kind;
   - attempt number и causal refs.
5. `EXTRACTION_COMPLETED`
   - outcome: `completed|empty|failed|unsupported`;
   - mode: `primary|fallback|recovery` — mode не подменяет outcome;
   - raw/normalized lengths and hashes;
   - extracted content class.
6. `EXTRACTED_CONTENT_CLASSIFIED`
   - `answer|empty|technical_message|provider_error|prompt_echo|previous_answer|
     placeholder|non_text|ambiguous`;
   - classifier version и evidence refs.

### 9.3. Transport

7. `ANSWER_DELIVERY_ATTEMPTED`
   - payloadEvidenceId, sender, receiver, length/hash.
8. `ANSWER_DELIVERY_ACKNOWLEDGED`
   - receiver-observed length/hash and accepted/rejected outcome.
9. `ANSWER_DELIVERY_REJECTED`
   - existing `SENDER_*_REJECTED` и `LIFECYCLE_CORRELATION_REJECTED`
     переиспользуются после исправления canonical semantics;
   - `post_terminal_noise` получает явное экспортируемое событие;
   - reason, attempt/payload identity, безопасные length/hash.
10. `ANSWER_DELIVERY_FAILED`
   - explicit transport error/timeout/context loss.

### 9.4. Commit and render

11. `ANSWER_COMMIT_EVALUATED`
   - accepted/rejected, state transition, previous value, reason.
12. `ANSWER_PERSISTENCE_CONFIRMED`
    - write/read-back identity and hash.
13. `ANSWER_CARD_RENDER_EVALUATED`
    - expected card ID;
    - observed card content class, length/hash;
    - `matched|empty|stale|wrong_card|mismatched`.

### 9.5. Recovery

14. `ANSWER_RECOVERY_REQUESTED`
    - automatic/manual;
    - user action: `get_it|status_indicator_double_click|other`;
    - pre-recovery terminal state.
15. `ANSWER_RECOVERY_COMPLETED`
    - found/not found;
    - candidate/dispatch proof;
    - recovered length/hash;
    - whether commit and render subsequently succeeded.

`MATERIALIZE_RECOVERY_CONTEXT`, `...START`, `...VISIT_RESULT`, `...REJECTED`
остаются recovery lifecycle events и не должны автоматически превращаться в
`EXTRACTION_COMPLETED`.

## 10. Typed fact contract

Typed facts должны разделять независимые измерения:

- `kind`: extraction, delivery, commit, render, recovery, observation;
- `outcome`: completed, failed, empty, rejected, matched;
- `mode`: primary, fallback, automatic_recovery, manual_recovery;
- `health`: reliable, degraded, unavailable;
- `boundary`: opened, closed.

`fallback` — mode, а не противоположность `completed`. `observed` и `closed`
также не обязаны противоречить друг другу: это health/state и boundary разных
осей. Typed/canonical conflict разрешён только при конфликте значений одной оси.

## 11. Evidence slots No delivery

### 11.1. Critical slots для occurrence

1. `incident_identity`
   - точная dispatch/model/run identity.
2. `generated_answer`
   - доказательство существования current answer;
   - generation/text/candidate evidence либо identity-proven recovery.
3. `expected_card`
   - однозначная карточка назначения.
4. `card_delivery_outcome`
   - card empty/wrong/unusable/mismatched либо independent delivery failure.
5. `source_to_card_comparison`
   - сопоставимые identity, normalization version, length/hash/content class.

### 11.2. Required slots для cause

6. `source_observation`
7. `candidate_selection`
8. `extraction_attempt`
9. `extraction_outcome`
10. `content_verification`
11. `transport_outcome`
12. `commit_outcome`
13. `render_outcome`
14. `terminal_boundary`

Эти slots определяют cause completeness, но их отсутствие не должно отменять
уже доказанный occurrence.

### 11.3. Conditional slots

15. `observer_context` — при degraded/unavailable observation.
16. `navigation_context` — при document/navigation change.
17. `non_text_content` — при attachment/canvas/code-only response.
18. `recovery_evidence` — если recovery запускался.
19. `prior_incident_evidence` — если найден previous answer.
20. `missing_evidence` — если обязательное наблюдение невозможно.

## 12. Applicability и refutation

### 12.1. Positive applicability

Требуются все условия:

1. current answer creation имеет положительное доказательство;
2. expected card identity известна;
3. card не содержит сопоставимый правильный current answer;
4. source/card comparison не нарушает incident scope;
5. результат не объясняется только отсутствием наблюдений.

### 12.2. Independent refutation

No delivery опровергается независимым доказательством:

1. render evaluation нашла правильную expected card;
2. card payload identity совпала с current dispatch/candidate;
3. normalized hash совпал с accepted source payload;
4. content class = `answer`;
5. card result признан пригодным.

`refutationModel` должен быть `independent_delivery_confirmation`, а не
логическим дополнением одного derived boolean.

### 12.3. Unknown

`unknown` обязателен, если:

- ответ не доказан;
- card state не наблюдался;
- source/card hashes несопоставимы;
- recovery не доказал current-dispatch identity;
- observer имел незакрытый gap;
- card ID неоднозначен;
- события принадлежат разным incident/document generations.

## 13. Recovery как ретроспективное доказательство

Manual recovery не должно автоматически подтверждать No delivery.

Recovery подтверждает существование ответа, только если доказаны:

1. current `dispatchId` или turn anchor;
2. candidate lineage;
3. отсутствие prompt echo/previous answer;
4. source hash/length/content class;
5. момент recovery относительно ошибочного terminal;
6. состояние карточки до и после recovery.

Если recovery впервые увидело ответ после terminal, вывод формулируется точно:
«ответ существовал при recovery и не был доставлен до recovery». Нельзя без
дополнительной temporal evidence утверждать, что полный ответ существовал до
terminal.

## 14. Temporal и causal invariants

1. Generation evidence не может ссылаться на событие после extraction без
   explicit retrospective recovery semantics.
2. Candidate selection следует после candidate observation.
3. Extraction attempt следует после выбора того же candidate.
4. Extraction completion ссылается на attempt и candidate.
5. Delivery acknowledgment следует после delivery attempt и совпадает по
   payloadEvidenceId.
6. Commit следует после accepted delivery либо явно описывает direct path.
7. Render evaluation следует после commit и относится к expected card.
8. Recovery after terminal разрешено, но должно ссылаться на terminal и
   исходный incident.
9. Navigation/document replacement разрывает DOM comparability без explicit
   lineage.
10. Card snapshot до commit не может опровергать последующий delivery failure.
11. Повторная попытка не стирает предыдущий proven failure без explicit
    supersession.
12. Каждое нарушение локализуется в report types, slots и derived fields.

## 15. Cause resolution

Cause resolver обходит causal edges конкретной attempt path, а не глобальный
список стадий, и возвращает:

- `lastSuccessfulStage`;
- `firstObservedUnsuccessfulStage`;
- `failureRange`;
- `failureStageCode`;
- `mechanismCauseCode`;
- `observabilityLimitationCodes`;
- `recoveryFindingCode`;
- `causeVerdict`;
- supporting event IDs;
- missing boundary;
- alternative causes, которые нельзя исключить.

Примеры:

| Доказательства | Вывод |
|---|---|
| candidate observed, extraction empty | `extraction_empty`, confirmed |
| extraction hash есть, delivery ack отсутствует | transport cause unknown, если нет closed timeout |
| delivery failed explicitly | `delivery_message_not_sent`, confirmed |
| commit hash совпал, card empty | `card_render_empty`, confirmed |
| automatic terminal NO_SEND, manual recovery нашло current answer | No delivery confirmed; cause зависит от stage boundaries |
| card содержит previous answer, current source доказан | Old answer cause; No delivery consequence |

## 16. Минимальность отчёта

Standalone No delivery report включает только:

1. выбранный incident scope;
2. source-answer proof boundary;
3. expected-card identity boundary;
4. по одной первой/последней значимой границе каждого наблюдавшегося stage;
5. first failure и last success;
6. independent counter-evidence;
7. recovery boundary, если она влияет на вывод;
8. recursive evidence/causation refs;
9. нарушения и missing evidence, влияющие на occurrence или cause.

Не включаются:

- все polling events;
- все recovery lifecycle messages;
- одинаковые повторные extraction attempts без изменения outcome;
- события других dispatch/generation epochs;
- системные события без causal relation;
- rebuildable derived data.

Каждое включённое событие получает `includedFor`, например:

- `occurrence:generated_answer`;
- `occurrence:card_missing`;
- `cause:last_success:extraction`;
- `cause:first_failure:transport`;
- `counterevidence:card_delivery`;
- `recovery:manual_latest`;
- `evidence-ref:<eventId>`.

Размер не является целевой метрикой. Цель — минимальная proof closure при полной
доказательности occurrence и заявленной cause.

## 17. Report structure

В `reportDescriptor` нужны:

- `reportType: no-delivery`;
- primary question;
- applicability;
- diagnostic/occurrence verdict;
- cause verdict;
- completeness отдельно для occurrence и cause;
- dependency registry version/hash;
- limitations.

В `diagnosticSummary`:

- `deliveryStages`;
- `lastSuccessfulStage`;
- `firstObservedUnsuccessfulStage` и `failureRange`;
- четыре независимые cause axes;
- `causeAlternatives`;
- `evaluationBoundary` и `resolutionState`;
- evidence slots;
- card/source comparison;
- recovery interpretation.

Вывод для пользователя должен формироваться как одна причинная фраза:

> Ответ Claude текущего dispatch материализовался на provider surface,
> extraction получил его, но background отклонил payload; на границе automatic
> terminal карточка осталась пустой.

Если причина не доказана:

> Ответ Claude существовал и не дошёл до карточки; этап потери определить по
> имеющейся телеметрии нельзя.

## 18. Работа с текущим Empty

### 18.1. Что переносится

1. `generation_observed` → `generated_answer/source_observation`.
2. `extraction_result` → attempt/outcome stages.
3. `candidate_selection` сохраняется и усиливается identity contract.
4. `text_boundary` используется как source proof.
5. `structural_verification` становится content verification.
6. `observer_context` остаётся conditional.
7. `empty_result` и `wrong_node` становятся cause codes.

### 18.2. Что не переносится без исправления

1. Один boolean `extractionProblemEvidence`.
2. Общая логика для `empty_result` и `wrong_node` без отдельных доказательств.
3. Любое сопоставление `/EXTRACT|MATERIALIZE|RESPONSE/ → EXTRACTION_COMPLETED`.
4. Последняя extraction attempt как автоматически принятая.
5. `fallback` как outcome вместо mode.
6. Подтверждение по одному факту пустого extraction без source-answer proof.

### 18.3. Удаление Empty

`Empty` удаляется только после окончания dual-run и проверки исторической
совместимости. Старые артефакты сохраняют `reportType=empty`; validator читает
их по старой registry/report version и не переинтерпретирует как No delivery.

## 19. Миграция

### Phase A. Contract review

1. Согласовать определение usable card result.
2. Согласовать occurrence/cause verdict separation.
3. Согласовать stage taxonomy и cause codes.
4. Провести adversarial review контракта до реализации.

### Phase B. Instrumentation

5. Удалить broad canonical mapping и исправить semantics существующих
   `SENDER_*_REJECTED`/`LIFECYCLE_CORRELATION_REJECTED`, чтобы они немедленно
   перестали подделывать submission/text evidence.
6. Разделить recovery lifecycle и extraction outcome.
7. Ввести shared normalization function с версией до hash-сравнений.
8. Добавить attempt/payload identity от content script до card render.
9. Ввести source, reception, commit и render boundaries без изменения UI.
10. Проверить privacy, volume и event deduplication.

### Phase C. Shadow preset

11. Добавить `no-delivery` в registry, но не показывать пользователю.
12. Строить его параллельно с `Empty` на одинаковых incidents.
13. Сравнивать occurrence, cause, size и missing evidence.
14. Собирать реальные расхождения Empty/No delivery.

### Phase D. Product cutover

15. Добавить `No delivery` в Task filter/export.
16. Оставить `Empty` как deprecated alias до конца commit/render shadow phase.
17. Обновить All tasks, standalone schema, validator, generator и examples.
18. Обновить документацию, manifest/package versions и changelog.

### Phase E. Removal

19. Убедиться, что No delivery покрывает все подтверждённые Empty fixtures.
20. Удалить Empty из UI и текущего registry.
21. Сохранить legacy validator/registry для старых файлов.
22. Удалить Empty-specific derived fields только после отсутствия consumers.

### 19.1. Нормативный порядок исполнения

Статус меняется на `Done` только после прохождения указанной приёмки.

1. Исправить определение observable claim и evaluation boundary. — Done
2. Санировать broad mapping и неизвестные runtime labels. — Done
3. Исправить canonical semantics rejection-событий. — Done
4. Разделить extraction attempt/outcome/mode. — Done
5. Ввести shared versioned normalization. — Done
6. Ввести раннюю attempt/payload identity. — Done
7. Ввести `ANSWER_SOURCE_MATERIALIZED`. — Pending
8. Инструментировать reception/rejection, включая post-terminal. — Pending
9. Ввести единого владельца commit evidence. — Pending
10. Инструментировать expected-card render evidence. — Pending
11. Реализовать occurrence contract с evaluation boundary/resolution state. — Pending
12. Реализовать attempt graph и четыре независимые cause axes. — Pending
13. Запустить shadow comparison с `Empty`. — Pending
14. Переключить UI/export на `No delivery`, сохранить legacy validation и
    удалить текущий `Empty`. — Pending
15. Обновить версии/документацию и пройти полный regression gate. — Pending

## 20. Test matrix

Для каждого сценария проверяются `confirmed`, `not_confirmed`, `unknown`, scope,
minimal closure и offline replay.

### 20.1. Positive occurrence

1. Generated text → extraction empty.
2. Generated text → technical message extracted.
3. Generated text → wrong candidate.
4. Verified extraction → delivery failure.
5. Delivery ACK → commit rejected.
6. Commit confirmed → expected card empty.
7. Correct answer committed to wrong card.
8. Automatic failure → manual recovery finds current answer.
9. DOM candidate removed between observation and extraction.
10. Non-text answer discarded.

### 20.2. Refutation

11. Source, extraction, transport, commit and card hashes match.
12. Recovery finds the same answer already present in the card.
13. Card is initially empty but later confirmed before terminal.

### 20.3. Unknown

14. Empty card without generation evidence.
15. Materialized current-dispatch answer without card observation.
16. Recovery text without current-dispatch identity.
17. Source/card normalization versions differ.
18. Observer gap covers the suspected failure.
19. Navigation breaks candidate lineage.
20. Multiple cards without expected-card identity.

### 20.4. Cross-preset arbitration

21. Confirmed Prompt not sent makes No delivery not applicable unless independent
    evidence nevertheless proves current-dispatch answer materialization.
22. Old answer causes No delivery of current answer.
23. Cutted remains primary for usable partial delivery.
24. False success causes No delivery of the final version.
25. No delivery occurrence remains confirmed when cause is unknown.

### 20.5. Historical and export safety

26. Legacy Empty artifact validates under its original registry version.
27. Dual-run does not duplicate canonical events.
28. Standalone report excludes unrelated incidents.
29. Every materialized event has a reason.
30. Raw answer/prompt and secrets do not enter the report.
31. Repeated polling and recovery messages compact without semantic loss.
32. Materialized report reproduces full-incident occurrence and cause verdicts.

## 21. Acceptance criteria

No delivery готов к замене Empty, когда:

1. Все stage events имеют строгую typed/canonical семантику.
2. Occurrence и cause verdict вычисляются независимо.
3. Manual recovery корректно доказывает только то, что действительно наблюдала.
4. No delivery не подтверждается по одной пустой карточке.
5. Правильная доставка является independent refutation.
6. Ни один recovery lifecycle event не маскируется под extraction.
7. Все 32 сценария test matrix проходят.
8. На production fixtures нет cross-incident/candidate/card contamination.
9. Standalone closure сохраняет verdict и содержит причины включения событий.
10. All tasks хранит canonical events один раз.
11. Offline validator независимо пересобирает occurrence, cause и slots.
12. Все реальные Empty-инциденты классифицированы No delivery либо явно
    признаны не относящимися к нему.
13. После migration window Empty удалён из текущего UI/registry без потери
    поддержки исторических exports.
14. Rejection events не удовлетворяют submission/text-evolution slots.
15. Hash comparison использует одну shared normalization implementation;
    разные версии дают `incomparable`.
16. Attempt graph различает повторную передачу одинакового payload.

## 22. Вопросы для adversarial review Claude

1. Достаточно ли определения «usable correct card result», чтобы развести No
   delivery и Cutted без семантического overlap?
2. Может ли occurrence быть confirmed при unknown cause, или текущий единый
   diagnosticVerdict требует иной совместимости?
3. Какие доказательства позволяют recovery утверждать, что ответ существовал
   до terminal, а не появился только после него?
4. Достаточна ли независимая card hash confirmation для refutation?
5. Как доказать expected-card identity при UI rerender и смене DOM node?
6. Какие stage boundaries можно получить без чрезмерного объёма telemetry?
7. Где нужны closed negative-observation intervals вместо event absence?
8. Следует ли Old answer быть cause subtype No delivery или независимым
   co-occurring diagnosis?
9. Какие cause codes нельзя надёжно различить по текущему runtime?
10. Может ли payload hash меняться на normalization/render stages без ложного
    mismatch, и как версионировать такую трансформацию?
11. Какие invariants должны блокировать только cause, но не occurrence?
12. Какие контрпримеры всё ещё позволяют подтвердить No delivery по чужому
    answer/card/recovery evidence?

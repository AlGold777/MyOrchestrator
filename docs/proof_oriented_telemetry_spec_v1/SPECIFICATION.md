# Proof-oriented telemetry — спецификация, готовая к реализации

**Версия документа:** 1.0  
**Версия канонической схемы:** 5.0  
**Область:** Chrome MV3-расширение, отправляющее один запрос в GPT, Gemini, Claude, Grok, Z.ai, Qwen, DeepSeek, Le Chat и Perplexity.

Термины **MUST**, **MUST NOT**, **SHOULD**, **MAY** являются нормативными.

---

# Часть I. Системное описание

## 1. Целевые свойства

Система MUST независимо устанавливать:

1. произошло ли действие отправки;
2. приняла ли платформа запрос;
3. началась ли генерация;
4. какой answer candidate относится к текущему `dispatch`;
5. была ли генерация активна, временно спокойна, завершена или ненаблюдаема;
6. является ли доступный текст полным;
7. наблюдался ли конец напрямую, был выведен эвристически или остался недоказанным;
8. почему финализация разрешена, заблокирована либо выполнена принудительно;
9. какой текст извлечён и принят;
10. подтвердили ли последующие наблюдения terminal decision.

Итоговый `status` является только projection независимых осей. Он MUST NOT заменять их.

## 2. Компоненты runtime

| Компонент | Ответственность | Допустимые слои записи |
|---|---|---|
| Platform adapter | Селекторы, page type, platform IDs, platform-specific signals | FACT |
| Dispatch observer | Baseline, submit action, acceptance evidence | FACT |
| Observation scheduler | Foreground lease, очередь, starvation, observer health | FACT/SYSTEM |
| Candidate registry | Логическая идентичность assistant-кандидатов через DOM rerender | FACT/INFERENCE |
| Generation observer | Atomic frames, transitions, mutations, text evolution | FACT |
| Inference engine | Submission, identity, generation, completeness, completion hypotheses | INFERENCE |
| Policy engine | Rules, blockers, warnings, override authorization | DECISION |
| Terminal executor | Terminal projection, retry, recovery, supersession | ACTION |
| Audit engine | Post-terminal audit, replay, optional ground truth | AUDIT |
| Report builder | Восемь диагностических views и All-presets | Только derived data |
| Export coordinator | Freeze, flush, hashes, invariants, serialization | SYSTEM/AUDIT |

## 3. Слои хранения

### 3.1. Canonical Decision Ledger

Единственный источник истины. Append-only. Содержит неизменяемые события слоёв `fact`, `inference`, `decision`, `action`, `audit`, `system`.

### 3.2. Derived Diagnostic Views

Детерминированно вычисляются из ledger. MUST NOT изменять runtime state. Каждый view содержит:

- `generatorVersion`;
- `ledgerHash`;
- `eventRefs` либо `derivedFromSeq`;
- вычисленные данные.

### 3.3. Forensic Attachments

Создаются только по anomaly trigger. Допустимые типы:

- redacted DOM fragment;
- selector candidate list;
- extended mutation trace;
- optional network trace;
- screenshot reference;
- content-script failure context.

Attachment MUST быть отредактирован до сохранения и адресоваться по content hash.

## 4. Канонический envelope события

```ts
interface TelemetryEvent<TPayload extends object> {
  schemaVersion: 5;
  eventId: string;
  eventType: string;
  layer: "fact" | "inference" | "decision" | "action" | "audit" | "system";
  seq: number;
  wallTs: number;
  monoMs: number;
  runSessionId: string;
  modelId?: string;
  dispatchId?: string;
  generationEpoch?: number;
  tabId?: number;
  documentInstanceId?: string;
  navigationEpoch?: number;
  conversationId?: string | null;
  turnId?: string;
  candidateId?: string;
  captureId?: string;
  causationId?: string;
  correlationId?: string;
  producer: { component: string; version: string };
  payload: TPayload;
  evidenceRefs?: string[];
}
```

Правила:

- `eventId` и `seq` MUST быть уникальны внутри run;
- `seq` MUST монотонно возрастать;
- длительности MUST вычисляться по `monoMs`;
- `wallTs` используется только для внешней корреляции;
- событие после записи MUST быть неизменяемым;
- отсутствующие optional fields SHOULD не сериализоваться;
- каждый `evidenceRef` MUST существовать в совместимом correlation scope.

## 5. Независимые оси состояния

```ts
interface ModelStateAxes {
  submission:
    | "not_attempted" | "attempted" | "evidence_partial"
    | "confirmed" | "failed" | "unknown";

  generationStart:
    | "not_evaluated" | "not_started" | "started"
    | "failed" | "unknown" | "unobservable";

  answerIdentity:
    | "none" | "candidate" | "current_dispatch"
    | "stale" | "ambiguous" | "rejected";

  observedGeneration:
    | "not_started" | "active" | "quiescent"
    | "inactive" | "unknown" | "unobservable";

  textEvolution:
    | "none" | "changing" | "stable" | "regressed" | "restarted";

  answerCompleteness:
    | "not_evaluated" | "probably_complete" | "probably_truncated"
    | "verified_complete" | "verified_truncated" | "unknown";

  extraction:
    | "none" | "candidate" | "exact" | "fallback" | "ambiguous" | "failed";

  verification:
    | "none" | "pending" | "verified" | "rejected" | "stale" | "unknown";

  completionDetection:
    | "not_evaluated" | "probably_active" | "probably_complete"
    | "inferred_complete" | "provider_complete"
    | "inconclusive" | "contradicted";

  completionEvidenceTier: 0 | 1 | 2 | 3 | 4;

  observationReliability:
    | "reliable" | "degraded" | "stale" | "unavailable";

  finalization:
    | "not_evaluated" | "blocked" | "retry_scheduled"
    | "allowed" | "accepted" | "failed";

  terminalMode:
    | "none" | "automatic" | "forced" | "recovery" | "manual";

  terminationCause:
    | "provider_completed" | "user_cancelled" | "platform_error"
    | "network_error" | "extension_timeout" | "policy_forced"
    | "recovery" | "unknown";
}
```

Запрещённые неявные переходы:

- `terminalMode=forced` MUST NOT устанавливать `completionDetection=inferred_complete`;
- `extraction=exact` MUST NOT устанавливать `answerCompleteness=verified_complete`;
- `textEvolution=stable` MUST NOT самостоятельно доказывать completion;
- `terminalOutcome=SUCCESS` MUST NOT изменять completion state;
- отсутствие сигнала при `observationReliability=unavailable` MUST интерпретироваться как `unknown`, а не `absent`.

## 6. Tiers доказательства окончания

| Tier | Семантика | Допустимые основания |
|---|---|---|
| T0 | Доказательство отсутствует | observer unavailable, нет signal history |
| T1 | Слабая эвристика | timeout, length threshold, только stability |
| T2 | Согласованные косвенные сигналы | stable hash, mutation idle, composer ready, loading absent; все сигналы свежие |
| T3 | Сильный platform UI transition | Stop `present→absent`, streaming `true→false`, completion controls появились; candidate verified |
| T4 | Коррелированный provider terminal signal | явный finish event/reason или terminal marker; одно закрытие соединения недостаточно |

Default: `automaticMinimumEvidenceTier=3`.

## 7. Значения сигналов и надёжность наблюдения

```ts
type SignalValue = "present" | "absent" | "unknown" | "stale" | "not_applicable";
```

`absent` может использоваться как сильное evidence только при выполненной, свежей и надёжной проверке.

`OBSERVATION_FRAME_CAPTURED` MUST включать:

- `captureStartedMonoMs`, `captureCompletedMonoMs`;
- `checkedAtMonoMs` каждого сигнала;
- `maximumSignalSkewMs`;
- tab active/visible/discarded;
- document visibility;
- content-script availability;
- snapshot age;
- timer throttling suspicion;
- focus/lease owner;
- page health;
- candidate-set reference;
- mutation counters;
- время последней релевантной mutation.

Frame с `maximumSignalSkewMs` выше policy threshold MUST NOT участвовать в automatic completion proof.

## 8. Каноническая цепочка событий

```text
RUN_CONFIG_RECORDED
→ SELECTOR_CANARY_REFERENCE
→ OBSERVATION_SCHEDULER_TIMELINE
→ PAGE_CONTEXT_OBSERVED
→ PAGE_HEALTH_OBSERVED
→ OBSERVER_HEALTH_OBSERVED
→ OBSERVER_HEALTH_INTERVAL_CLOSED
→ OPTIONAL_NETWORK_FACTS
→ DISPATCH_BASELINE_CAPTURED
→ SUBMIT_ACTION_OBSERVED
→ SUBMISSION_EVIDENCE_CHANGED
→ SUBMISSION_INFERRED
→ OBSERVATION_FRAME_CAPTURED
→ CANDIDATE_SET_CHANGED
→ CANDIDATE_IDENTITY_INFERRED
→ GENERATION_SIGNAL_CHANGED
→ TEXT_STATE_CHANGED
→ STABILITY_INTERVAL_CLOSED
→ ANSWER_COMPLETENESS_EVALUATED
→ GENERATION_STATE_INFERRED
→ STRUCTURAL_VERIFICATION_EVALUATED
→ COMPLETION_HYPOTHESIS_EVALUATED
→ MISSING_EVIDENCE_RECORDED
→ FINALIZATION_POLICY_EVALUATED
→ POLICY_OVERRIDE_APPLIED, если применимо
→ DECISION_RECORDED
→ MODEL_TERMINAL_RECORDED
→ POST_TERMINAL_AUDIT_COMPLETED
→ DERIVED_REPORTS_BUILT
→ REPLAY_VALIDATION_RECORDED
→ OPTIONAL GROUND_TRUTH_LABEL_ADDED
```

## 9. Обязательный каталог event types

### 9.1. System и observation

`RUN_CONFIG_RECORDED`, `SELECTOR_CANARY_RESULT`, `OBSERVATION_SLOT_REQUESTED`, `OBSERVATION_SLOT_GRANTED`, `OBSERVATION_SLOT_DENIED`, `OBSERVATION_SLOT_BACKOFF`, `OBSERVATION_SLOT_RELEASED`, `PAGE_CONTEXT_OBSERVED`, `PAGE_HEALTH_OBSERVED`, `OBSERVER_HEALTH_OBSERVED`, `OBSERVER_HEALTH_INTERVAL_CLOSED`.

Operational ticks MUST NOT be wrapped one-for-one as
`OBSERVER_HEALTH_OBSERVED`. Known proof facts enter the canonical ledger;
repeated operational signals become interval summaries; unknown legacy labels
enter a bounded debug ring outside proof export.

### 9.2. Dispatch

`DISPATCH_BASELINE_CAPTURED`, `SUBMIT_ACTION_OBSERVED`, `SUBMISSION_EVIDENCE_CHANGED`, `SUBMISSION_INFERRED`.

### 9.3. Generation и identity

`OBSERVATION_FRAME_CAPTURED`, `GENERATION_START_EVALUATED`, `CANDIDATE_SET_CHANGED`, `CANDIDATE_IDENTITY_INFERRED`, `GENERATION_SIGNAL_CHANGED`, `GENERATION_STATE_INFERRED`.

### 9.4. Text и extraction

`TEXT_STATE_CHANGED`, `STABILITY_INTERVAL_CLOSED`, `EXTRACTION_COMPLETED`, `ANSWER_COMPLETENESS_EVALUATED`, `STRUCTURAL_VERIFICATION_EVALUATED`.

### 9.5. Completion и finalization

`COMPLETION_HYPOTHESIS_EVALUATED`, `MISSING_EVIDENCE_RECORDED`, `FINALIZATION_POLICY_EVALUATED`, `TERMINAL_DEADLINE_REACHED`, `POLICY_OVERRIDE_APPLIED`, `DECISION_RECORDED`, `DECISION_SUPERSEDED`, `MODEL_TERMINAL_RECORDED`.

### 9.6. Audit и integrity

`POST_TERMINAL_AUDIT_COMPLETED`, `GROUND_TRUTH_LABEL_ADDED`, `SELECTOR_FORENSIC_SNAPSHOT_CAPTURED`, `REPLAY_VALIDATION_RECORDED`, `EXPORT_AUDIT_RECORDED`.

## 10. Инварианты

| ID | Правило |
|---|---|
| S01 | `eventId` и `seq` уникальны; `seq` монотонен. |
| S02 | Каждый `evidenceRef` разрешается в существующее событие. |
| S03 | Evidence chain имеет совместимые run/model/dispatch/document transition/generation epoch. |
| S04 | FACT содержит только наблюдение; INFERENCE — вычисленный вывод; DECISION — policy result; ACTION — выполненное действие; AUDIT — последующую проверку. |
| S05 | Ledger append-only и immutable. |
| S06 | Каждый `MODEL_TERMINAL_RECORDED` ссылается на принятый `DECISION_RECORDED`. |
| S07 | Forced/recovery/manual terminal имеет `POLICY_OVERRIDE_APPLIED` либо специальное recovery decision. |
| S08 | Summary и report выводятся из одного ledger boundary. |
| S09 | Экспорт использует единый `ledgerCompleteThroughSeq`. |
| S10 | `absent` считается сильным evidence только при fresh reliable check. |
| S11 | Accepted candidate связан с baseline, turn anchor, conversation и generation epoch. |
| S12 | Automatic SUCCESS требует `submission=confirmed` и `answerIdentity=current_dispatch`. |
| S13 | Stability не доказывает completion или completeness самостоятельно. |
| S14 | Forced terminal не переписывает completion detection. |
| S15 | Accepted answer ниже T4 требует post-terminal audit либо явную запись о невозможности аудита. |
| S16 | Standalone report содержит self-description, compatibility keys и evaluated escalation rules. |
| S17 | Static config хранится один раз на export. |
| S18 | Attachment редактируется до persistence и адресуется по content hash. |
| S19 | Old decision не изменяется; replacement оформляется через `DECISION_SUPERSEDED`. |
| S20 | Missing evidence фиксируется явно и не преобразуется в отрицательное evidence. |

## 11. Default policy

Automatic finalization SHOULD требовать одновременно:

- `submission=confirmed`;
- `answerIdentity=current_dispatch`;
- надёжное и свежее observation;
- отсутствие fresh active-generation blocker;
- успешную structural verification;
- evidence tier не ниже policy minimum;
- зафиксированные hash и length принятого текста;
- отсутствие unresolved high-severity contradiction.

Forced finalization MAY принять текст с меньшим evidence только если:

- automatic branch явно заблокирован;
- timeout/recovery trigger записан;
- waived rules и residual risk записаны;
- completion state не переписан;
- mode равен `forced`, `recovery` или `manual`;
- post-terminal audit запланирован либо его невозможность зафиксирована.

## 12. Emission policy

Событие MUST создаваться при:

- первом наблюдении;
- изменении сигнала;
- изменении candidate set;
- изменении text hash, существенном length change, regression или restart;
- открытии/закрытии stability interval;
- изменении verification/completeness result;
- изменении policy rule result;
- terminal action;
- contradiction/anomaly;
- редком heartbeat для нетерминальной модели без иных событий.

Запрещено писать:

- одинаковый stable/pending event каждый poll;
- отдельный selector miss на каждую проверку;
- no-op projection;
- изменение только timestamp;
- повторяющийся static context;
- full prompt/answer и произвольный DOM text по умолчанию.

## 13. Privacy и retention

По умолчанию сохраняются:

- text hash, normalized hash, length;
- ограниченные structural fingerprints;
- redacted URL hash;
- allowlisted DOM attributes;
- policy/event metadata.

По умолчанию запрещены:

- auth tokens, cookies, credentials;
- unredacted URL и query parameters;
- произвольный DOM text;
- full prompt/answer вне отдельного secure diagnostic mode.

Рекомендуемые defaults:

- raw forensic ring buffer — 24 часа;
- anomaly attachment — 7 дней;
- canonical ledger/report — product telemetry retention.

## 14. Критерии готовности

Offline validator MUST уметь:

1. восстановить каждую ось на любом `seq`;
2. разделить FACT/INFERENCE/DECISION/ACTION/AUDIT;
3. восстановить submission proof и answer identity;
4. повторно вычислить generation state, completeness и evidence tier;
5. повторно вычислить finalization policy и получить recorded decision;
6. проверить override и terminal lineage;
7. определить влияние scheduler/observer degradation;
8. выявить post-terminal change;
9. построить все шесть reports из ledger;
10. детерминированно вычислить `requestIf`;
11. отклонить несовместимые reports;
12. построить summaries без mutable summary state;
13. получить совпадающие replay hashes;
14. проверить atomic export и budgets;
15. пройти сценарии: normal completion, temporary pause, same-length hash change, stale baseline, prompt echo, multiple candidates, background throttling, selector failure, forced timeout, post-terminal growth, SPA navigation, export активного run, replay mismatch.

---

# Часть II. Контейнер All-presets

## 15. Режимы сериализации

### 15.1. Standalone preset

Standalone report MUST материализовать минимальный event subset, достаточный для независимого анализа одного файла.

### 15.2. Embedded preset

Внутри All-presets report MUST содержать только compact `eventSeqs`, derived
data и self-description. UUID `eventId` остаётся в canonical events и на
standalone/external boundaries, но не повторяется во внутренних индексах.
Canonical events, shared config и attachments хранятся один раз.

## 16. Top-level структура

```json
{
  "schemaVersion": "5.0",
  "containerType": "all-presets",
  "exportId": "...",
  "manifest": {},
  "crossReportCompatibility": {},
  "sharedConfig": {},
  "ledger": {},
  "derivedViews": {},
  "reports": {},
  "attachments": {},
  "exportAudit": {}
}
```

## 17. `manifest`

MUST содержать:

- время создания и encoding;
- content index;
- шесть report types и версии схем;
- правила deduplication;
- privacy mode;
- size budget;
- overflow policy;
- compression/dictionary metadata, если применимо;
- omission records для недоступного optional content.

Не дублируются:

- canonical event;
- shared config;
- attachment с тем же content hash;
- common analysis instructions;
- dependency registry.

## 18. `crossReportCompatibility`

Exact-match keys:

- `runSessionId`;
- `modelId`;
- `dispatchId`;
- `generationEpoch`;
- `ledgerHash`;
- `exportBoundary.ledgerCompleteThroughSeq`.

`documentInstanceId` и `navigationEpoch` могут отличаться только при явном transition proof `home→conversation` либо SPA navigation.

Режимы:

- `same_export`;
- `same_ledger`;
- `correlated_transition`;
- `incompatible`.

Analyzer MUST NOT объединять несовместимые reports.

## 19. `sharedConfig`

Хранится один раз:

- extension/schema/adapter/selector versions;
- policy ID/hash и thresholds;
- decision/summary/replay engine versions;
- platform capabilities;
- privacy/redaction policy;
- dependency registry snapshot;
- common analysis instructions.

## 20. `ledger`

MUST содержать:

- encoding: `inline-json`, `ndjson`, `ndjson-gzip` либо chunk refs;
- first/last seq;
- event count;
- ledger hash;
- ordered immutable events или chunks.

Chunked mode MUST содержать ordered chunk hashes и root hash.

## 21. `derivedViews`

```json
{
  "viewType": "cutted",
  "derivedFromEventSeqs": [17, 18, 19],
  "generatorVersion": "summary-builder@5",
  "ledgerHash": "sha256:...",
  "data": {}
}
```

Рекомендуемые views:

- model timeline;
- signal timeline;
- text hash/length series;
- stability intervals;
- candidate lineage;
- submission proof;
- completion proof;
- extraction coverage;
- scheduler summary;
- selector summary;
- terminal lineage;
- post-terminal audit.

## 22. `reports`

Map с шестью пользовательскими диагностическими ключами:

```text
cutted
false-success
old-answer
empty
prompt-not-sent
late-end
```

Embedded report содержит:

- `reportDescriptor` с `reportMode=embedded-in-all-presets`;
- diagnostic summary;
- релевантные state axes;
- `eventRefs`;
- `derivedViewRef`;
- sibling rules и evaluations;
- `analysisInstructionsRef`.

Canonical events внутри embedded report MUST отсутствовать.

## 23. `attachments`

Attachment хранится один раз в `attachments.byId`. Одинаковый content hash MUST ссылаться на один объект. Неполученный attachment фиксируется через omission record:

```json
{
  "attachmentType": "redacted-dom-fragment",
  "reason": "capture unavailable",
  "impact": "hidden node structure cannot be verified"
}
```

## 24. `exportAudit`

Atomic sequence:

1. freeze export boundary;
2. flush pending writers;
3. record `ledgerCompleteThroughSeq`;
4. build views и reports;
5. validate schemas и invariants;
6. replay inferences и decisions;
7. compute section hashes;
8. serialize;
9. compute final size;
10. release freeze.

MUST содержать:

- export boundary;
- hashes ledger/sharedConfig/views/reports/attachments/container;
- schema validation result;
- invariant violations;
- replay result;
- recorded и recomputed decision hashes;
- size и budget result.

## 25. Size budgets

| Объект | Default target |
|---|---:|
| Standalone preset | 10–40 KB; максимум 60 KB без attachment |
| Manifest + shared config | ≤20 KB |
| Core ledger на модель | ≤40 KB |
| Все derived views на run | ≤80 KB |
| Один forensic attachment | ≤50 KB |
| Default total attachments | ≤200 KB |
| Normal All-presets для 9 моделей, minified | ≤350 KB без full text/attachments |
| Normal All-presets, gzip | ≤120 KB |
| Hard default container limit | 1 MB |

Overflow order:

1. удалить rebuildable derived detail;
2. externalize optional attachment с hash и omission/external reference;
3. агрегировать repeated checks;
4. сохранить canonical proof events и replayability.

Core evidence MUST NOT удаляться только ради budget.

---

# Часть III. Общий контракт standalone report

## 26. Envelope

```json
{
  "schemaVersion": "5.0",
  "fileKind": "diagnostic-report",
  "reportDescriptor": {
    "reportId": "...",
    "reportType": "...",
    "reportVersion": "1.0.0",
    "title": "...",
    "primaryQuestion": "...",
    "canDiagnose": [],
    "cannotDiagnoseAlone": [],
    "completeness": {
      "level": "complete|partial|insufficient",
      "evidenceCoveragePct": 0,
      "missingCriticalEvidence": false,
      "missingItems": [],
      "safeConclusions": [],
      "blockedConclusions": []
    },
    "reportMode": "standalone",
    "dependencyRegistryVersion": "1.0.0",
    "dependencyRegistryHash": "sha256:..."
  },
  "correlation": {},
  "reportCatalogSnapshot": [],
  "diagnosticSummary": {},
  "stateAxes": {},
  "eventSelection": {
    "includedEventTypes": [],
    "eventRefs": [],
    "materializedEvents": []
  },
  "derivedViews": {},
  "contradictions": [],
  "missingEvidence": [],
  "siblings": [],
  "analysisInstructions": {},
  "crossReportCompatibility": {},
  "attachments": [],
  "exportIntegrity": {}
}
```

## 27. Predicate language `requestIf`

```json
{
  "path": "$.derivedViews.completionEvidenceTier",
  "operator": "lt",
  "value": 3
}
```

Поддерживаются: `eq`, `ne`, `in`, `not_in`, `lt`, `lte`, `gt`, `gte`, `exists`, `missing`.

Rule содержит `any` и/или `all`. Exporter MUST вычислить rule и добавить:

```json
{
  "evaluation": {
    "matched": true,
    "predicateResults": [
      {
        "predicate": {},
        "observedValue": 1,
        "matched": true
      }
    ]
  }
}
```

## 28. Anti-loop и escalation

- `maxEscalationDepth=2`;
- не запрашивать already provided report;
- не запрашивать already requested report;
- каждый запрос MUST разрешать новый именованный вопрос;
- matched required report блокирует только final causal verdict;
- established facts и bounded diagnosis MAY выдаваться до эскалации.

## 29. Общие `analysisInstructions`

LLM MUST:

- считать report partial view;
- не считать missing signal отсутствующим;
- разделять FACT/INFERENCE/DECISION/ACTION/AUDIT;
- ссылаться на `eventId` в технических выводах;
- указывать observation reliability;
- проверить все `requestIf`;
- запросить matched required reports перед final causal verdict;
- отклонить incompatible reports;
- сформировать разделы: `Established facts`, `Bounded diagnosis`, `Contradictions`, `Missing evidence`, `Required additional reports`, `Final causal verdict`.

---

# Часть IV. Шесть пользовательских диагностических файлов

Технические аспекты не становятся отдельными presets, если они отвечают на
один пользовательский вопрос. Completion proof, forced policy и terminal
lineage поэтому объединены в `false-success`; candidate identity и extraction
lineage используются внутри проблемно-ориентированных отчётов.

## 29. Semantic applicability contract

Evidence-slot sufficiency и applicability MUST оцениваться независимо:

- sufficiency отвечает, доступны ли необходимые доказательства;
- applicability отвечает, подтверждают ли они выбранную проблему;
- заполненные слоты MUST NOT автоматически означать обнаруженную проблему.

Каждый report MUST содержать `reportDescriptor.applicability` со статусом:

- `confirmed` — все applicability predicates известны и выполнены;
- `not_confirmed` — хотя бы один известный predicate опровергает проблему;
- `unknown` — проблема не опровергнута, но хотя бы один обязательный predicate
  нельзя вычислить.

Операторы `eq`, `ne`, `in`, `not_in`, `lt`, `lte`, `gt`, `gte` MUST возвращать
`known=false, matched=false` для отсутствующего или `null` значения. Missing
observation нельзя превращать в positive anomaly. Исключение составляют только
явные операторы `exists` и `missing`.

| Report | Обязательные applicability predicates |
|---|---|
| `cutted` | `terminalOutcome == SUCCESS` и `incompleteCaptureEvidence == true` |
| `false-success` | `terminalOutcome == SUCCESS`, completed post-terminal audit и `postTerminalGrowthProven == true` |
| `old-answer` | `oldAnswerEvidence == true` на основании accepted-answer dispatch mismatch |
| `empty` | `generationTextObserved == true` и `extractionProblemEvidence == true` |
| `prompt-not-sent` | `promptNotSentEvidence == true` из typed failed submission |
| `late-end` | `lateEndEvidence == true`: policy решила ждать, clocks сопоставимы и последующей мутации не было |

Sibling rule MUST использовать только positive anomaly fact либо известную
положительную величину. Предикаты вида `identity != current_dispatch` запрещены,
поскольку unknown identity не является доказательством старого ответа.

Derived view и applicability MUST вычисляться отдельно для каждого точного
incident scope `(runSessionId, runGeneration, modelId, dispatchId,
generationEpoch)`. Platform status является только явной агрегацией incident
results. Событие другого dispatch не может участвовать в predicates.

Embedded и standalone reports MUST использовать один `REPORT_CONTRACTS` как
источник event types, evidence slots, `requiredIf` и applicability. Conditional
slot становится `required` только при выполненном `requiredIf`; иначе его
отсутствие не уменьшает sufficiency.

`stableToTerminalMs` MUST вычисляться только в общей producer monotonic epoch
или общей worker ingest epoch. Wall-clock subtraction и замена несопоставимого
интервала нулём запрещены.

## 30. `cutted`

**Primary question:** почему зафиксирован `SUCCESS`, а текст явно неполный?

Сопоставляет зафиксированный текст с максимальной наблюдавшейся длиной только
до terminal boundary,
границей extraction, completeness evidence, terminal decision и
policy evidence. Длина extraction берётся только из принятого extraction event
и не подменяется terminal length. Диагностирует обрезку сохранённого ответа, но не подмену
ответом другого запроса — это задача `old-answer`.

Critical evidence: `MODEL_TERMINAL_RECORDED`, text evolution и explicit
completeness/audit evidence. Одного события SUCCESS недостаточно.

## 31. `false-success`

**Primary question:** почему система решила «готово», а ответ продолжил расти?

Объединяет прежние `true-completion`, `forced-success` и
`forced-finalization`: показывает признаки активности, основание completion,
policy/override, terminal decision и рост текста после terminal.

Critical evidence: SUCCESS terminal и `POST_TERMINAL_AUDIT_COMPLETED` с
положительным text-length growth. Hash-only mutation и text mutation до
terminal не подходят. Отсутствующий/невозможный audit даёт `unknown`, а
измеренный нулевой growth — `not_confirmed`.

## 32. `old-answer`

**Primary question:** почему принят текст от предыдущего запроса?

Проверяет dispatch baseline, candidate lineage и identity, принадлежность
выбранного DOM-блока текущему turn, extraction result и structural verification.

Событие о том, что stale candidate был корректно отклонён, не подтверждает Old
answer. Нужна identity принятого answer evidence: alternate dispatch ID либо
explicit `previous_dispatch|stale_accepted` extraction identity. Explicit
`current_dispatch` имеет приоритет; строковое сравнение разрешено только после
нормализации обоих известных dispatch identifiers.

## 33. `empty`

**Primary question:** почему генерация была, но extraction вернул пусто или не
тот узел?

Связывает доказательство начавшейся генерации с candidate selection, text
boundaries, extraction result, structural verification и observer health.

Анализируется extraction, на который ссылается terminal/decision provenance,
а не последнее событие по порядку. Подтверждение имеет две явные ветки:
`empty_result` (failed/zero length) и `wrong_node` (непустой, но rejected,
ambiguous или stale candidate). Успешный verified current-dispatch extraction
опровергает Empty; неоднозначный выбор остаётся `unknown`.

## 34. `prompt-not-sent`

**Primary question:** почему модель не получила запрос?

Проверяет dispatch baseline, submit action, внешние признаки принятия запроса,
page context и observer health. Отсутствующее acceptance evidence обозначается
как неизвестное, а не автоматически как доказательство неотправки.

Confirmed submission, наблюдавшаяся генерация, непустой принятый extraction или
SUCCESS terminal явно опровергают preset. Partial/absent/unavailable observation
даёт `unknown`; только typed failed submission без counter-evidence подтверждает
проблему.

## 35. `late-end`

**Primary question:** текст давно стабилен — почему система ждала ещё `N`
секунд?

Отчёт вычисляет `stableToTerminalMs` между последним подтверждённым
`STABILITY_INTERVAL_CLOSED` и `MODEL_TERMINAL_RECORDED`, но подтверждает preset
только при явном `DECISION_RECORDED.accepted=false` после stability boundary.
Любая последующая text mutation или active-generation signal инвалидирует
интервал. Произвольный глобальный millisecond threshold запрещён: отчёт
показывает фактическую policy-задержку конкретного incident.

Интервал обязан иметь `stableToTerminalClockBasis=producer_monotonic` либо
`ingest_monotonic`; при разных epochs значение остаётся `null`.

Связанные диагнозы сохраняют фактически истинную applicability. Registry задаёт
`primaryDiagnosis`, `causedBy` и `explanationRole`: например, False success
может быть причиной, а Cutted — последствием. Arbitration MUST NOT превращать
истинный consequence в `not_confirmed`.

Standalone closure MUST минимизировать повторы по доказательной роли, сохраняя
первую/последнюю границу, экстремумы измерений, смены typed state и явные
`evidenceRefs`/causation. Фиксированный лимит числа событий запрещён.

---

# Часть V. Файлы реализации

```text
SPECIFICATION.md
all-presets.example.json
schemas/
  telemetry-event.schema.json
  diagnostic-report.schema.json
  all-presets.schema.json
registry/
  report-dependency-registry.json
presets/
  cutted.example.json
  false-success.example.json
  old-answer.example.json
  empty.example.json
  prompt-not-sent.example.json
  late-end.example.json
```

Каждый example содержит конкретные числовые значения, events, state axes, evaluated sibling rules, required reports, compatibility и integrity. Данные являются синтетическими, что явно отмечено `exportIntegrity.sampleData=true`; они не выдаются за production telemetry.

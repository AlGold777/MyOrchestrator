# Disput — незавершённые обязательства

**Версия:** 3.0  
**Дата сверки:** 2026-07-24
**Статус продукта:** не release-ready.

Это полный release register для universal pipeline. Пункт нельзя считать
закрытым без реализации, детерминированного target test, evidence ID и
обновления [evidence matrix](EVIDENCE-MATRIX-v3.0.md).

`Owner` и `Reviewer` указаны ролями, пока конкретные имена не назначены.
`pending` означает, что наличие кода или ADR само по себе не является
доказательством выполнения.

## P0 — блокирует релиз

| ID | Незавершённый результат | Status | Owner | Reviewer | Gate | Evidence ID | Target test |
|---|---|---|---|---|---|---|---|
| P0-R1 | Browser recovery equivalence: 4+ участников, parallel stage, pause/reload, no duplicate dispatch, equal StateMap/artifacts | partial | Runtime owner | Release reviewer | C | EVID-R1 | Browser recovery E2E |
| P0-R2 | Browser transport races: delayed/duplicate final, timeout→late success, abort batch, tab loss, partial failure, cancel during synthesis | partial | Transport owner | Runtime owner | C | EVID-R2 | Browser transport-race suite |
| P0-R3 | Human-decision DOM surface with request ID, reason, options, affected stage and reload recovery | partial | UI owner | Product owner | C | EVID-R3 | DOM decision recovery E2E |
| P0-R4 | Full ownership/lease lifecycle: acquire, renew, fence, release, expiry takeover, cross-context invalidation, read-only old owner | partial | Runtime owner | Release reviewer | C | EVID-R4 | Two-context ownership E2E |
| P0-R5 | Release rollback/canary: previous package, schema compatibility, incident procedure, named stop criteria | partial | Release Engineering | Product owner | E | EVID-R5 | Rollback and canary drill |
| P0-R6 | Event-log integrity and replay equivalence: continuity, semantic conflict, duplicate/no-op replay, corrupted snapshot/event handling | partial | Observability owner | Runtime owner | B/C | EVID-R6 | Replay corruption/recovery E2E |
| P0-R7 | Semantic commit/no-op/version integrity: no-op delta semantics, expected-version enforcement, atomic commit, terminal evidence. Unit coverage now includes stage-count-scoped planning decisions and completed planned-stage dedup; full suite remains open. **Причины зафиксированы как S-01/S-04/S-05/S-09 в [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md); закрывается фазами 1–4** | partial | State owner | Disput Architecture | B | EVID-R7 | StateDelta/StateMap semantic-integrity suite |
| P0-R10 | Семантический слой: единственный владелец артефактов, lifecycle артефакта, видимая пользователю карта, резолюционные goals. Решения — [ADR-002](ADR-002-semantic-layer-ownership.md); findings S-01…S-22 и фазы — [PLAN-semantic-layer-v1.0](PLAN-semantic-layer-v1.0.md) | partial | State owner | Disput Architecture | B/C | EVID-R10 | Phase 0 characterization + target suites; cross-context durability and browser recovery remain open |
| P0-R8 | Universal-only removal decision: Product-owner sign-off and accepted big-bang cutover risk | claimed by ADR, evidence pending | Disput Architecture | Product owner | A/E | ADR001-P | Signed ADR approval record |
| P0-R9 | Storage compatibility/data rollback policy: versioned migrations, failed migration recovery, export/snapshot restore, no destructive downgrade | planned | Runtime/Data owner | Release reviewer | E | ADR001-S | Storage compatibility and rollback test |

## P1 — требуется до расширенного production rollout

| ID | Незавершённый результат | Status | Owner | Reviewer | Gate | Evidence ID | Target test |
|---|---|---|---|---|---|---|---|
| P1-C1 | Все persisted-data migrations: custom configs, run snapshots, revisions, trace, participant state and unknown-field policy | partial | Runtime/Data owner | Release reviewer | E | EVID-C1 | Migration matrix + idempotent reload suite |
| P1-T1 | Telemetry allowlist, redaction, dashboards, alert thresholds, canary cohort and named owner | planned | Observability owner | Product owner | E | EVID-T1 | Telemetry policy/alert tests |
| P1-S1 | StateMap conflict UI with provenance and persisted human action | planned | UI owner | State owner | B | EVID-S1 | StateMap conflict E2E |
| P1-G1 | Resource limits for stages/calls/retries/time/context/corrections with typed degradation evidence | planned | Runtime owner | Product owner | E | EVID-G1 | Budget exhaustion suite |

## P2 — качество эксплуатации

| ID | Незавершённый результат | Status | Owner | Reviewer | Gate | Evidence ID | Target test |
|---|---|---|---|---|---|---|---|
| P2-P1 | Capacity measurements for 1/4/8/16 participants and 10/50/200 artifacts | planned | Performance owner | Runtime owner | E | EVID-P1 | Capacity benchmark |
| P2-A1 | Accessibility/operator UX: keyboard, focus, live regions, contrast and degraded-result explanations | planned | UI owner | Product owner | D | EVID-A1 | Accessibility/manual acceptance |

## Legacy removal boundary

Возврат Multi, Triad, Duel или другого legacy executor запрещён ADR-001. Но
текущий статус этого решения — **claimed by ADR, evidence pending** до закрытия
`ADR001-P`, `ADR001-R`, `ADR001-S` и `P0-R8/P0-R9`. Совместимость относится к
данным, а не к восстановлению старой execution semantics.

## Правило закрытия

Закрывая строку, change set обязан увеличить версию манифеста и пакета,
добавить changelog entry, обновить этот документ и evidence matrix, приложить
target test и явно назвать пройденный release gate.

## Остаток после change set 2.81.46

Change set 2.81.46 не закрывает следующие пункты: P0-R1 (browser recovery),
P0-R4 (cross-context lease invalidation), P0-R6 (полная replay equivalence),
P0-R9 (storage rollback policy), P0-R10 (browser proof семантического слоя),
а также P1-C1 (полная migration matrix). Они остаются `partial`/`planned` до
появления перечисленных в таблицах evidence и target tests.

## Аудит реализации 2.81.47 — обязательные исправления

Повторная проверка production-path выявила дополнительные незакрытые дефекты.
До их устранения фазы 1–8 не считаются реализованными, даже при зелёном общем
Jest:

| ID | Severity | Осталось исправить | Критерий закрытия |
|---|---|---|---|
| SEM-A01 | P0 | Canonical Orchestrator стартует с `caseVersion = 1`, CaseStore — с `0`; первая delta получает `CASE_VERSION_STALE` | Integration test с `enableCanonicalStore: true` сохраняет первый артефакт |
| SEM-A02 | P0 | UI и Application создают разные экземпляры CaseStore | В production-композиции один store передан как `semanticStore` и как источник UI |
| SEM-A03 | P0 | Multi-artifact delta использует один correlation для разных changes и конфликтует внутри batch | Delta с двумя артефактами коммитится атомарно; replay возвращает один batch receipt |
| SEM-A04 | P0 | После semantic batch StateMap не пересобирается; failure-path повторяет commit по одной delta | Один persist, одна проекция, без partial retry |
| SEM-A05 | P0 | `DebateOrchestratorPersistence` не загружен HTML и остаётся memory Map | Реальный durable adapter подключён и проходит reload/cross-context E2E |
| SEM-A06 | P0 | Human action обращается к удалённой переменной `at`; closure actions потеряли изменение target status | DOM-test всех human actions без exception и с canonical semantic effect |
| SEM-A07 | P0 | Phase 5–6 не завершена: StateMap остаётся v3, независимый `stateMapVersion` сохранён, `recorded` contradiction/dissent не actionable | Contract v4 и Planner integration tests закрывают S-03/S-09 |
| SEM-A08 | P1 | `startUniversal` всегда вызывает `create`, перезаписывая persisted case вместо recovery | Reload загружает существующий case и сохраняет version/artifacts |
| SEM-A09 | P1 | Не обеспечен инвариант единственного активного `synthesis_conclusion`; batch validation зависит от порядка | Lifecycle и prospective-state tests зелёные |
| SEM-A10 | P1 | Миграция legacy artifact array сохраняет массив и ломает target lookup | Array→map migration проходит validateCase и повторный reload |
| SEM-A11 | P1 | Phase 0 suite содержит 4 общих теста вместо E-01…E-09 и не запускает canonical production wiring | Все обязательные evidence/target scenarios существуют и покрывают production path |
| SEM-A12 | P1 | `ADD_CONSTRAINT` меняет только runtime copy, затем semantic commit `SET_STATUS` заменяет её persisted case без constraint | Constraint сохраняется canonical change kind и переживает reload |
| SEM-A13 | P0 | `startRun` гидратирует canonical case, но оставляет StateMap пустой до следующей semantic delta | Existing case с артефактами проецируется до первого Planner tick |

Источник проверки: ручные воспроизводимые Node-сценарии canonical commit,
multi-artifact batch, actionable projection и legacy migration; полный Jest
остаётся зелёным, что подтверждает именно пробел покрытия.

### Статус исправлений 2.81.49

- **Закрыты:** SEM-A01, SEM-A02, SEM-A03, SEM-A04 и SEM-A06. Добавлен
  `tests/semantic-layer-canonical-integration.test.js`, который проверяет
  canonical version 0, общий CaseStore, атомарную multi-artifact delta,
  немедленную проекцию и human-action bridge.
- **SEM-A07 частично закрыт:** `DebateStateMap.VERSION = 4`, creation-status
  `recorded` для contradiction/dissent теперь actionable и порождает Planner
  goals. Удаление независимого `stateMapVersion` (S-09) остаётся открытым.
- **SEM-A08 частично закрыт:** `startUniversal` загружает существующий case и не
  вызывает безусловный `create`; полный reload/recovery E2E остаётся открытым.
- **Остаются открыты:** SEM-A05, остаток SEM-A07/S-09, browser-часть SEM-A08,
  SEM-A09, SEM-A10, расширение Phase 0 до полной матрицы SEM-A11, а также
  найденные повторным аудитом SEM-A12 и SEM-A13.

### Статус стабилизационного комплекса 2.81.51

- **Закрыты SEM-A05, SEM-A07, SEM-A08, SEM-A09, SEM-A10, SEM-A11,
  SEM-A12 и SEM-A13.**
- `startRun` и recovery проецируют canonical case до Planner; независимого
  `stateMapVersion` больше нет.
- Constraints, supersede и merge проходят только через canonical CaseStore;
  batch валидируется по prospective state; активный final только один.
- Legacy `artifacts[]` мигрирует в map и стабильно проходит повторный reload.
- Phase 0 содержит всю матрицу E-01…E-09.
- OrchestratorPersistence v2 durable между page contexts; Web Locks и
  `leaseRevision` обеспечивают fencing.
- Browser E2E подтвердил `pause → reload → continue`: case/artifacts/StateMap
  совпадают, dispatch остаётся единственным; конкурентный context получает
  `LEASE_HELD`.

### Что ещё осталось сделать после 2.81.51

Эти пункты не входят в закрытый стабилизационный комплекс и остаются
нормативно открытыми:

1. **P0-R6 / P1:** полная replay equivalence из event log без пригодного snapshot.
2. **P1:** publication cursor (`lastPublishedSequence`) и идемпотентная
   post-commit доставка внешним consumers.
3. **P1:** интерактивный browser E2E реального StateMap drawer: human action →
   reload → Planner observation.
4. **P1-C1:** полная историческая migration matrix: unknown fields,
   rollback/export и fixtures всех прежних schema versions. Array→map и
   idempotent reload уже закрыты.

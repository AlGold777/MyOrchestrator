# Disput — незавершённые обязательства

**Версия:** 3.0  
**Дата сверки:** 2026-07-23  
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
| P0-R7 | Semantic commit/no-op/version integrity: no-op delta semantics, expected-version enforcement, atomic commit, terminal evidence. Unit coverage now includes stage-count-scoped planning decisions and completed planned-stage dedup; full suite remains open | partial | State owner | Disput Architecture | B | EVID-R7 | StateDelta/StateMap semantic-integrity suite |
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

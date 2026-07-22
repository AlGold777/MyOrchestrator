# Disput Evolution — Universal Discussion Engine

Нормативные документы (Slice A, утверждены):

1. [technical-architecture-roadmap-v1.0.md](technical-architecture-roadmap-v1.0.md) — целевая архитектура, Strangler Fig slices A–M.
2. [legacy-capability-extraction-contract-v1.1.md](legacy-capability-extraction-contract-v1.1.md) — порядок извлечения capabilities и удаления legacy.
3. [orchestrator-contract-v1.0.md](orchestrator-contract-v1.0.md) — lifecycle owner.
4. [planner-contract-v1.0.md](planner-contract-v1.0.md) — decision owner (rule-based MVP).
5. [plan-revision-specification-v1.0.md](plan-revision-specification-v1.0.md) — immutable plan revisions.

## Новый execution path (модули)

| Компонент | Файл | Роль |
|---|---|---|
| Policies + Validation Contract | `disput/debate-policies.js` | единый источник правил конфигурации UI/runtime |
| Plan Revision | `disput/debate-plan-revision.js` | immutable revisions, команды, dependency closure |
| Planner | `disput/debate-planner.js` | rule-based, deterministic, PlanningDecision |
| Stage Executor | `disput/debate-stage-executor.js` | исполнение StageInstance, adapters |
| Orchestrator | `disput/debate-orchestrator.js` | lease, lifecycle FSM, pause/continue, recovery |

## Slice status

| Slice | Статус |
|---|---|
| A — Contracts | DONE |
| B — DebateCase-first | PARTIAL (новый path создаёт DebateCase до run; legacy path не переведён) |
| C — StageExecutor | DONE (новый модуль; dynamic runner ещё не делегирует) |
| D — Rule-based Planner | DONE (модуль + тесты) |
| E — Persistent Pause/Continue | DONE в новом path (persisted events + snapshot rebuild) |
| F — Human Participant | DONE в новом path (human adapter, awaiting_participant, submitParticipantResponse) |
| G — Plan Revisions | DONE |
| H — Canvas Command Surface | PARTIAL (командная поверхность в DebateApplication; UI Canvas не переведён) |
| I/J/K — Legacy migrations | NOT STARTED (capabilities реализованы в новом executor; production switch за флагом) |
| L — Legacy Removal | BLOCKED removal gate (см. ledgers) |
| M — Enforcement | PARTIAL (gate-тест для новых модулей; полный repo-gate после Slice L) |

Ledgers: [ledgers/](ledgers/)

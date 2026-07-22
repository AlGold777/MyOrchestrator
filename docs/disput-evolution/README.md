# Disput Evolution

Текущая архитектура имеет один production execution path.

Нормативные документы:

1. [Final implementation plan](PLAN-universal-pipeline-v3.0.md) — решения, статус, оставшиеся release-задачи и gates.
2. [Orchestrator contract](orchestrator-contract-v1.0.md) — единственный lifecycle owner.
3. [Plan revision specification](plan-revision-specification-v1.0.md) — immutable commands and revisions.
4. [Architecture](../disput-docs/D1_universal-pipeline-architecture.md) — ownership, stages, StateMap, synthesis and failure semantics.

Новые документы не должны вводить альтернативный executor, фиксированную форму разговора или второй источник lifecycle state.

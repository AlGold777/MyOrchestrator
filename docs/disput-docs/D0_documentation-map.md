# Disput: authoritative documentation

Disput has one execution architecture: the universal pipeline.

- [System architecture](D1_universal-pipeline-architecture.md) defines the runtime, state, invariants, ownership and failure semantics.
- [Implementation plan](../disput-evolution/PLAN-universal-pipeline-v3.0.md) defines completed work, remaining work, verification gates and Definition of Done.

Code and automated tests are executable truth. If prose conflicts with a tested invariant, the invariant wins and the document must be corrected in the same change.

Documentation rules:

1. Do not describe fixed participant counts or named execution modes.
2. Do not add a second runner, lifecycle store, synthesizer path or terminal owner.
3. Describe behavior as planner decisions, stage contracts, StateMap transitions and policies.
4. Every new persisted event must have schema, reducer, replay, telemetry and tests.
5. Every new stage purpose must have PromptPack, acceptance, artifact and failure contracts.

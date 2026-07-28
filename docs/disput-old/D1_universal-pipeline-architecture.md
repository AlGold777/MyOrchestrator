# Universal pipeline architecture

## 1. Purpose

Disput turns a user task and an arbitrary set of participants into a controlled sequence of evidence-producing stages. The engine does not encode a conversation shape. It decides the next useful operation from the current StateMap, policies, capabilities, resource budget and human commands.

The canonical flow is:

```text
User task + participants + policies
        ↓
DebateCase + TaskContract
        ↓
Planner → immutable PlanRevision
        ↓
Orchestrator → StageInstance lifecycle
        ↓
StageExecutor → participant attempts
        ↓
accepted response → Artifact(s) → StateDelta
        ↓
atomic commit → new DebateCase version → StateMap
        ↓
rules / next planning decision / terminal decision
```

## 2. Ownership

| Concern | Sole owner |
|---|---|
| User-facing start, pause, continue, cancel and plan commands | `DebateApplication` |
| Next semantic operation | `DebatePlanner` |
| Run lifecycle and stage scheduling | `DebateOrchestrator` |
| Dispatch, retry and response acceptance | `DebateStageExecutor` |
| Canonical facts and provenance | `DebateCase` plus `StateDelta` |
| Read projection for planning and UI | `DebateStateMap` |
| UI aggregate and event history | `DebateRunStore` |
| Prompt assembly | `DebatePromptCompiler` plus `DebatePromptPack` |
| Browser transport | transport port supplied at composition root |
| Final terminal transition | application/orchestrator boundary |

No UI handler may directly execute semantic stages. No participant adapter may mutate DebateCase. No planner decision may bypass a PlanRevision.

## 3. Participants

Participants are data, not topology slots. Each participant has an identity, type, model or human adapter, capabilities, availability and execution history. Cardinality is validated only by `DebatePolicies`.

The planner may assign:

- one participant to a sequential stage;
- several participants to one parallel stage;
- a specialist to research or verification;
- a synthesizer to consolidation;
- an independent auditor to validation;
- a human to a decision or contribution stage.

Participant failure is local unless policy says the run cannot remain epistemically valid. A failed participant is never silently treated as a valid empty answer.

## 4. Stage contract

Every executable stage must identify:

- `stageInstanceId` and source `plannedStageId`;
- purpose and requested capabilities;
- participants and dispatch mode;
- input artifact IDs and expected StateMap version;
- expected output artifact types;
- prompt and output contracts;
- completion policy;
- retry and failure policy;
- resource budget;
- visibility and provenance metadata.

Supported semantic purposes include participant analysis, critique, research, verification, synthesis, synthesis audit and synthesis correction. New purposes require end-to-end contracts; adding a string to the planner is insufficient.

## 5. Parallel execution

A parallel stage dispatches one native batch. Results are all-settled and retain a per-participant outcome. Accepted responses are converted into independent deltas anchored to the same expected case version.

The commit boundary applies compatible deltas atomically. A stale or conflicting delta is rejected explicitly and replanned. Partial success is allowed only when completion policy and epistemic policy both permit it.

## 6. Canonical artifact path

Raw model text is never the canonical state. The only semantic write path is:

```text
response
  → acceptance verdict
  → one or more typed artifacts with provenance
  → proposed StateDelta anchored to expected sequence/version
  → validation
  → atomic commit
  → projected StateMap
```

One response may create several linked artifacts. Links, dissent, evidence gaps and minority positions are preserved. Every artifact traces back to run, stage, participant, attempt and source text anchor.

## 7. Synthesis correctness

Synthesis is a versioned artifact, not a terminal string. An audit names the exact synthesis artifact it evaluates.

- `pass` validates only that artifact version.
- `issues_found` creates a correction stage.
- correction emits a new synthesis artifact ID.
- the corrected artifact must be audited again.
- a prior audit can never validate a later correction.

Completion that requires synthesis is forbidden until the current synthesis artifact has a passing audit or an explicit policy records why audit independence was impossible.

## 8. Lifecycle and cancellation

The run lifecycle is owned by the orchestrator. Pause is persisted and takes effect at a safe boundary. Continue checks the expected revision. Cancel propagates through one abort tree and produces one terminal result.

Terminal outcomes are idempotent. A completed, failed or cancelled run cannot transition to another terminal outcome. Late transport responses are recorded as rejected evidence and cannot reopen the run.

## 9. Human intervention

Human actions are commands against an expected plan or case revision. Supported commands include inserting a stage, changing a pending participant, changing policy, requesting synthesis, requesting audit, pausing, continuing, cancelling and resolving a decision request.

Commands are validated, persisted and auditable. They never mutate hidden page-local protocol state.

## 10. Production composition

Production startup fails closed when required ports are absent. The required semantic ports include batch dispatch, response acceptance, prompt compilation, artifact extraction, delta proposal, atomic delta commit and StateMap projection.

Tests may explicitly opt into incomplete wiring only for isolated unit behavior. Production cannot use that escape hatch.

## 11. Observability

Every event carries run, plan revision, stage, participant and attempt correlation where applicable. Telemetry distinguishes dispatch failure, timeout, rejection, retry, participant unavailability, stale delta, conflict, degraded completion, audit failure and cancellation.

The UI is a projection. Reload recovery reconstructs state from persisted canonical stores and events, never from DOM classes.


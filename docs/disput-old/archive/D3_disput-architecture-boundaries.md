# D3. Disput architecture boundaries

This document is the owner for layer ownership and the UI/runtime boundary.

| Layer | Owns | Must not do |
|---|---|---|
| Protocol | `debate-protocols.js`, topology FSM/runtime reducers | Read DOM or decide provider dispatch details |
| Planning | `debate-plan-compiler.js`, `debate-plan-validator.js` | Dispatch models or mutate UI state |
| Orchestration | topology runners and `debate-run-services.js` | Invent a second terminal state outside the run store |
| Transport | `background/*`, provider/content adapters | Decide epistemic meaning of a completed run |
| State | `debate-run-store.js`, trace schema and event stream | Derive UI-only labels from DOM |
| Projection | `debate-projections.js`, trace projections and view-models | Dispatch, mutate protocol state, or infer phases from raw DOM |
| Profile | `debate-profile-schema.js`, prompt pack and profile store | Bind a role permanently to one provider or bypass engine compatibility |
| Case | `debate-case-schema.js`, `debate-case-store.js` | Accept stale/duplicate/orphan changes or overwrite history |
| State map | `debate-state-map.js`, state-map view | Invoke an LLM or decide protocol continuation |
| Rule engine | `debate-rule-engine.js`, profile rule instances | Mutate case, DOM or fixed topology while in shadow mode |
| Decisions | `debate-decision-request.js`, RunStore events, case bridge | Reduce a contextual fork to an unlogged boolean |
| Rule history | `debate-rule-history.js` | Automatically rewrite production rules from its own metrics |
| Model signal | `debate-model-signal.js` | Create artifacts, readiness, progress or flow decisions |
| FreeTalk orchestration | trigger catalog, queue, protocol and runner | Trust model self-reports as terminal truth or spend reserved finalization budget |

Protocol decisions are added to the protocol/planning layer and reach the UI as
explicit state or projection fields. New UI code may render `currentStageId`,
`status`, `approval`, `degradedMode`, `epistemicOutcome`, and audit results, but
must not recalculate completion or topology rules from counters.

The compiled plan is the declared stage graph; runners remain the orchestration
compatibility layer until all legacy topology paths are migrated to one executor.

The page composition root may bridge accepted runtime events into `DebateCase`
and human UI actions back into explicit commands. The map view receives a
projection and callbacks; it never owns the case. A thematic profile may add
types, roles, axes, triggers, tools and map sections only through the extension
contract. Shared provenance, acceptance, dissent preservation, terminal map and
human stop invariants cannot be replaced by a profile.

`results.js` may bridge rule/decision events into RunStore and accepted human
decisions into DebateCase. It does not evaluate epistemic meaning. Fixed
topology runners call the shared checkpoint; their rules remain observational
until a separately versioned profile explicitly enables control.

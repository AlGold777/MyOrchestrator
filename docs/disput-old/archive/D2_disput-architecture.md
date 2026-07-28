# D2. Disput architecture

## Status

This document describes the production architecture after the Debate runtime
and application-orchestration decomposition. `results.js` remains the page
composition root and DOM adapter, but it is no longer the owner of protocol
definitions, topology sequencing, persistent or volatile run state, prompt
policy, presets, transport, sessions or export formatting.

В срезе 2.81.01 immutable plan является проверяемым контрактом для stage id,
участников, артефактов и failure policy. Три topology runner всё ещё исполняют
собственные совместимые циклы; переход на один универсальный StageExecutor не
завершён и не должен подразумеваться этой спецификацией. Общие acceptance,
correlation, context-budget, service-role и audit правила уже централизованы.

Prompt execution использует типизированные Task/Stage/Action contracts,
relevance- и trust-aware ContextBroker и единый PromptCompiler. Смысловые
изменения проходят через anchored StateDelta до попадания в DebateCase; ответы
моделей и UI не являются самостоятельными владельцами карты.

FreeTalk MVP добавляет поверх этой основы профили pipeline, канонический
`DebateCase` и детерминированную карту состояния. FreeTalk уже запускается через
`DebateApplication`, но Duel/Triad/Multi всё ещё исполняются своими runners;
единый профильный StageExecutor для них остаётся открытой миграцией.

## Dependency direction

```text
Debate UI
  -> DebateController (view-model selectors)
  -> DebateRenderer (DOM adapter)
  -> DebateSessionsStore
  -> DebateExport

Debate application orchestration
  -> DebateApplication (topology-neutral lifecycle facade)
  -> DuelRunner / TriadRunner / MultiRunner
  -> DebateRunServices (filters, checkpoints, terminal outputs)
  -> DebateExecutionContext (abort, approval waiters, locks)
  -> DebateRunStore (canonical run aggregate + event stream)
  -> DebateProtocols (uniform Duel/Triad/Multi contract)
  -> DebatePromptCatalog
  -> DebateRegistry
  -> DebateTransport (port)

DebateTransport
  -> extension messages
  -> background PipelineMessageHandlers
  -> PipelineFSM / PipelineRunState
  -> provider dispatch and content adapters
```

Dependencies point down this list. Protocol modules do not access DOM, Chrome
APIs or background globals. Background modules do not import Debate topology,
speaker or prompt concepts.

## Production module map

| Layer | Current modules |
|---|---|
| Protocols/FSM | `disput/debate-runtime.js`, `disput/triad-runtime.js`, `disput/multi-runtime.js`, `disput/debate-protocols.js` |
| Application lifecycle | `disput/debate-application.js`, `disput/debate-execution-context.js` |
| Execution planning | `disput/debate-stage-types.js`, `disput/debate-plan-compiler.js`, `disput/debate-plan-validator.js` |
| Prompt contracts/compiler | `disput/debate-contracts.js`, `disput/debate-context-broker.js`, `disput/debate-prompt-pack.js`, `disput/debate-prompt-compiler.js`, `disput/debate-response-acceptance.js` |
| Profiles/capabilities | `disput/debate-profile-schema.js`, `disput/debate-capability-registry.js`, `disput/pipeline-profile-store.js` |
| Canonical case/map | `disput/debate-case-schema.js`, `disput/debate-case-store.js`, `disput/debate-state-delta.js`, `disput/debate-state-map.js`, `results/disput-state-map-view.js` |
| Rules and decisions | `disput/debate-rule-engine.js`, `disput/debate-decision-request.js`, `disput/debate-rule-history.js`, `disput/debate-model-signal.js` |
| Trigger orchestration | `disput/free-talk-runtime.js`, `disput/free-talk-protocol.js`, `disput/free-talk-runner.js` |
| Topology orchestration | `disput/duel-runner.js`, `disput/triad-runner.js`, `disput/multi-runner.js` |
| Shared run services | `disput/debate-run-services.js` |
| Run state/projections | `disput/debate-run-store.js`, `disput/debate-projections.js`, `shared/debate-schema.js` |
| Disput observability | `disput/debate-trace-schema.js`, `disput/debate-trace-store.js`, `disput/debate-trace-projections.js`, `results/debate-telemetry-view.js` |
| Presets/prompts/registry | `disput/pipeline-presets.js`, `disput/debate-prompt-catalog.js`, `disput/disput-massage.js`, `disput/triad-massage.js`, `disput/debate-registry.js` |
| UI composition | `results.js`, `results/debate-controller.js`, `results/debate-renderer.js`, `results/debate-sessions-store.js`, `results/debate-plan-view-model.js` |
| Transport/export | `results/debate-transport.js`, `results/debate-export.js` |
| Background boundary | `background/pipeline-run-state.js`, `background/pipeline-message-handlers.js`, `background/message-router.js`, `background/job-orchestrator.js` |

The files in this table are the production owners. Legacy names such as a
background Debate executor are historical references only and must not be
reintroduced.

## Application orchestration

### Declared plan and current execution boundary

The selected saved pipeline is compiled before any browser effect into one
immutable `DebateExecutionPlan`. The plan is the single behavioral contract
shared by validation, UI projections, persistence/recovery and diagnostics.
Topology runners currently remain the effect-sequencing compatibility layer,
but must resolve stage participants and failure policy from that compiled plan.

The plan contains an ordered stage graph. Every stage has a stable `stageId`,
`kind`, visibility/role, participants, prompt contract, input and output
artifact ids, continuation policy, tab policy, completion/failure policy and
next-stage relation. Public model turns, round filters, registry checkpoints,
final words and optional final synthesis are explicit stages. Filter/checkpoint and the
single audit-correction dispatch remain shared service effects invoked by the
runners; moving every such effect into a universal executor is tracked as a
separate architecture task.

```text
Pipeline preset + explicit user overrides
  -> DebatePlanCompiler
  -> DebatePlanValidator
  -> immutable DebateExecutionPlan
       -> DebateOrchestrator / StageExecutor
       -> DebateRunStore + recovery
       -> Debate UI projection
       -> stage-aware telemetry
```

The compiler is the only place where preset defaults and user overrides are
resolved. In particular, `runPolicy`, round/wave count, participant roles,
synthesizer, explicitly selected auditor and tab policy are frozen in the plan. During a run, DOM controls
are projections and cannot silently switch an Auto preset to Manual or alter
its stage count. A user override remains valid only when it is explicit in the
compiled plan and visible in the run summary.

For fixed Verdict and Red Team presets, `protocol.roundPlan.length` is the
canonical runtime round count; a hidden or stale round selector cannot shorten
the plan. All fixed built-in presets default to `runPolicy: auto` so rounds
continue without pauses. An explicit Manual override is frozen into
the compiled plan and uses the same approval waiter between waves; it is not
inferred from stale UI state. Open-ended Long presets may additionally take a
finite or infinite limit from the live control.

The main comparison Send action never starts Debate or navigates to the Debate
page. Duel/Triad/Multi start only from explicit Debate/Pipeline controls. The
main page may display saved pipeline configuration, but persisted scheme or
active-pipeline state cannot be interpreted as permission to start a Debate.

The plan validator rejects a run before tabs open when the stage graph is
incomplete, a required artifact has no producer, a required participant is
absent, a declared synthesis is unreachable, dispatch identities
collide, or a retry/subsequent stage violates its tab policy.

### Stage execution boundary

`DebateOrchestrator` advances only by consuming the current plan stage,
recording its typed result and following the declared transition. A stage
executor may build a prompt and call the model-session port, but it cannot
choose an undeclared next stage. Prompt builders remain pure and cannot open
tabs, mutate protocol state or control continuation.

Each model dispatch carries at least:

```text
runId + planId + stageId + participantId + attemptId + promptFingerprint
```

This identity distinguishes an opening position, a later opponent response and
a retry even when their visible text is similar. Recovery resumes collection
for the persisted stage when submit is already confirmed; it must not infer a
new protocol action and resend the prompt.

Tab acquisition is a shared model-session capability used by both the main
page and Debate. Stages declare `create`, `reuse_participant_session`,
`reuse_if_valid`, `isolated` or `api` policy. Initial participant stages may
create sessions. Later turns, filters, final words, synthesis and retries reuse
their participant session unless the compiled plan explicitly declares
isolation. Topology runners never pass an ad-hoc `forceNewTabs` decision.

Service stages have explicit roles such as `filter`, `checkpoint` and
`synthesizer`. They are not rendered as ordinary participant answers and are
not invisible: the UI shows their progress in a compact system-stage or round-
artifact projection. Thus the same ordered plan explains what the user sees,
what runtime executes and what telemetry exports.

Debate observability is an append-only side projection and cannot influence
this execution boundary. Its schema, correlation, health rules, Disput tab and
exports are owned by [D7_disput-telemetry.md](D7_disput-telemetry.md).

`disput/debate-application.js` is the only topology-neutral entry point for a
run. It owns `start`, `pause`, `resume`, approval, cancellation, recovery and
disposal commands, selects the runner from the normalized topology and records
application lifecycle events in `DebateRunStore`.

The topology runners own effect sequencing but not protocol truth:

- `DuelRunner` owns parallel A0/B0 opening dispatch, approved-turn routing,
  retry/pause policy, final words and optional synthesis;
- `TriadRunner` owns init/wave dispatch, the wave barrier, checkpoint cadence,
  wave advancement, final words and optional synthesis;
- `MultiRunner` owns all waves, manual continuation points, filters and the
  optional synthesis phase.

All three runners depend on the existing FSM/protocol, prompt and registry
modules. They receive browser/page capabilities through one explicit `deps`
object and do not read DOM, `window` or Chrome APIs directly.

Participant dropout is one shared application contract, not three unrelated
error branches. A topology runner detects an unusable/missing response and
reports the failed and remaining participants through
`resolveParticipantDropout`. The page adapter owns the two-way user decision:
continue with the reduced participant set or stop the run. The runner then
applies that decision through its protocol/FSM state, records dropped models
and re-plans all later effects from the reduced set; it must never silently
keep dispatching to a failed model. `None` is preserved through dropout;
an explicitly selected Synthesizer is never silently replaced. Если эта модель
недоступна, `retry` повторяет запрос ей же, `stop` отменяет run, а `continue`
честно завершает run без synthesis и сохраняет ответы/карту. A stop decision
transitions both protocol state and the aggregate `DebateRunStore` to
`cancelled`.

`disput/debate-run-services.js` owns behavior shared across topologies:
correlated round-filter dispatch, Duel/Triad/Multi registry checkpoints,
synthesis audit and idempotent terminal-output acceptance. Strict exactly-once
delivery through third-party web interfaces is not claimed. It is not another
state owner.

The shared dispatch boundary in `results.js::runModelBatch` preserves the
caller-provided `stageAttemptId`, returns the same `pipelineContext`, applies
participant anonymization and enforces `DebateContextBudget` before transport.
It emits a collected response as non-accepted evidence; only the topology or
service acceptance point emits `accepted: true`. `DebateRunStore` then owns the
durable key `stageId:participant -> attemptId`; another accepted attempt is
rejected after reload as well as in the current process.

`DebateContextAssembly` declares stage visibility. Participant waves receive
their own line, the last foreign wave and filtered state according to policy;
final synthesis and synthesis audit receive structured parts rather than an
unbounded transcript. Budget overflow replaces covered history with explicit
markers before any final truncation and produces a diagnostic event plus a
user warning.

`DebateServiceRoles` preserves the explicitly selected Synthesizer and Auditor
once per run; it does not infer either role from participant order. The selected synthesizer performs the final
synthesis, round filters and registry checkpoints. The auditor is a separate
model only when explicitly selected for SynthesisAudit; it does not replace
the synthesizer and does not perform ordinary extraction. Risk-based
SynthesisAudit may issue one corrective dispatch; the original draft and the
audit are retained in the terminal projection.

`results.js` materializes the page configuration and adapters, constructs the
application/runners and exposes the temporary external compatibility entry
point `window.runPipeline`. That global is a delegation shim only; it contains
no runtime sequencing.

## State ownership

### Version and migration policy

`disput/debate-version-manifest.js` is the runtime source for implementation,
protocol, plan, case, profile, prompt-pack, state-map, run-store and trace
schema versions. Release 2.81.01 stamps `protocol=5`, `planSchema=3`,
`caseSchema=2`, `profileSchema=3`, `promptPack=3`
(`promptPackVersion=3.0.0`, `disput-core@3.0.0`), `stateMap=3`,
`runStoreSchema=4`, `traceSchema=3` and schema `1` for Task/Stage/Action
contracts, PromptCompiler, ContextBroker, StateDelta and CapabilityRegistry.
Protocol is
incremented when phase/mandatory-output semantics change; plan schema when the
compiled graph meaning changes; run-store schema when persisted state/event
interpretation changes. A snapshot from a newer run-store schema is rejected
as `saved_by_newer_version`; an older snapshot is hydrated with
`versions.migratedFrom`. Case/profile stores migrate supported older schemas
before validation; incompatible prompt-pack id/version is rejected before a
model dispatch.

Protocol 5 добавляет типизированные `DecisionRequest`, объяснимый rule trace,
окно содержательного прогресса и диагностический `ModelSignal`. Эти данные
принадлежат RunStore; они проецируются в карту, но не создают второй case.

### DebateCase and state-map ownership

`DebateRunStore` owns execution lifecycle, compiled prompt records, proposed /
accepted / rejected deltas, human decisions and its event stream. `DebateCase`
owns source events, durable epistemic artifacts and append-only snapshots. A
bridge at the page composition root accepts only correlated, provenance-anchored
changes into the case; no UI component writes case fields directly.
`DebateStateMap` is a pure replayable projection of the case or compatible run
aggregate. Structure, Graf, comparison and export consume that projection and
cannot decide continuation.

FreeTalk is trigger-driven: accepted case changes produce deterministic tasks;
the queue applies deduplication, cooldown, budget, concurrency and loop guards.
Only the runner dispatches selected tasks. Model self-reports do not close the
case. Human decisions enter as provenance-bearing artifacts. The complete
contract is [D4_pipeline-profiles-and-freetalk.md](D4_pipeline-profiles-and-freetalk.md).

### HTML export naming contract

HTML export names are part of the user-facing Debate/UI contract. A standalone
model response exported from the main page uses the model name in brackets and
the compact local timestamp: `GPT jul26 21-14.html`. A standalone model card
exported from the active Debate feed prefixes the same model/timestamp pair
with the user-assigned active Debate name: `Debate name - GPT jul26
21-14.html`.

The active Debate name is read from the selected session tab, using its full
user-assigned title. For a standalone approved Debate card, the `HH-MM` part
is read from `.debate-model-card.is-approved .debate-model-card-title-main
.debate-inline-time`, i.e. from the time the response was received in the
feed, not from the export click time. Unsafe filename characters are
normalized before the name components are assembled. The all-feed export keeps
its existing filename contract; this rule applies only to standalone
model-card exports.

### Run aggregate

`disput/debate-run-store.js` owns the lifecycle of the active run:

- run/session identity;
- immutable preset snapshot;
- topology and protocol state reference;
- execution and approval state;
- canonical lifecycle/domain event stream;
- terminal outcome and recovery metadata.

All top-level run statuses are derived from events. `debateRunState` and
`pipelineRunActive` remain page rendering projections. `window.__serialDebateState`,
`window.__triadState` and `window.__multiPipelineState` are read-only getters
over the aggregate protocol state; they are not writable or persistence
authorities.

Every protocol transition is routed through the topology-neutral facade and
recorded as `PROTOCOL_STATE_SYNCED`. `protocolRevision` makes hidden page-only
FSM mutations observable and gives recovery a precise persisted checkpoint.

### Volatile execution state

`DebateExecutionContext` owns resources which cannot be persisted:

- the active `AbortController` and signal;
- the current approval resolver/rejecter and cleanup callback;
- in-flight locks and tracked promises;
- run-scoped cleanup callbacks.

Replacing or disposing the context aborts and cleans the previous run. These
handles never live in `DebateRunStore`, and `results.js` does not maintain a
second set of approval resolver variables.

### Protocol state

`disput/debate-protocols.js` exposes the same contract for every topology:

```js
createState(config)
reduce(state, event)
planNextEffects(state)
buildPrompt(effect, context)
isTerminal(state)
```

The implementations are backed by:

- `DebateFSM` for Duel A/B phase, turn accounting and the canonical
  `retainParticipant` reduction when one side drops;
- `TriadFSM` for three-model wave barriers and `retainParticipants` reduction;
- `MultiFSM` for multi-model waves and mandatory synthesis.

FSM transitions mutate their protocol state for compatibility. The application
runners immediately synchronize each transition to the run aggregate; side
effects remain outside the FSM contract.

When a protocol state reaches `cancelled` through a runner transition,
`DebateRunStore.PROTOCOL_STATE_SYNCED` also closes the aggregate lifecycle:
status, execution, approval and completion timestamp are updated together. This
prevents a user-selected stop from being reclassified by the page-level
launcher as `RUN_FAILED`.

### Event projections

Moderator turns, model turns, verdicts, registry changes and timeline entries
are recorded in the run event stream. `DebateProjections` derives turns,
sessions and timeline views from that stream. The existing `DebateEngine`
transcript and card/message maps are compatibility projections and export
formats, not independent runtime engines.

### Background state

Background owns delivery, not debate semantics:

- `PipelineRunState` constructs execution state;
- `PipelineFSM` owns dispatch/control transitions and derives aggregate
  completion from all required model finals;
- `PipelineMessageHandlers` owns cancellation and control messages;
- `TabMapManager` is the only writer of model-to-tab bindings;
- `ModelRunState` is the only writer of per-model status transitions;
- job orchestration owns the active-run snapshot, collection, versioned
  persistence and provider recovery; `RecoveryPolicy` owns automatic recovery
  decisions.

This is ownership per fact, not one global physical store. Provider DOM
evidence remains authoritative in the content runtime, while background is
authoritative for accepted run state and terminal decisions. Compatibility
fields exposed to older UI code are read-only projections.

`pipelineRunId`, `pipelineRoundId` and `pipelineBatchId` correlate page protocol
effects with background execution. Background must not inspect topology roles,
round prompts or registry artifacts.

Debate uses the same `START_FULLPAGE_PROCESS`, `TabMapManager` and provider
dispatch path as the main page. A batch may carry `promptsByModel`; the
background resolves that map at the final dispatch boundary for every model,
including Round 1, recovery, collection retry and manual resend. The shared
`prompt` is only a compatibility fallback and must never replace an available
model-specific prompt. A Debate run may request fresh tabs for its initial
batch; later Duel turns, Triad waves/finalization and Multi waves/synthesis
reuse the model bindings owned by background. Topology runners do not own or
cache browser tab ids. This reuse rule is strict: `forceNewTabs` is allowed for
the first opening/init wave only, while all later approved turns, critique
waves, final words and synthesis dispatches stay on the already bound tabs.

Accepted answers have two equivalent delivery channels from background to the
page: the live `LLM_PARTIAL_RESPONSE`/final message and the durable answer in
`GLOBAL_STATE_BROADCAST`. The latter must hydrate both the visible Debate card
and `pipelineWaiter`; otherwise a missed live message leaves the topology
runner blocked despite a persisted terminal answer. A status-indicator recovery
request first republishes the accepted answer for the active run, then may scan
the provider DOM for a newer candidate. The DOM scan is an upgrade mechanism,
not a prerequisite for restoring already accepted state. `results.js` therefore
feeds `GLOBAL_STATE_ANSWER_RECOVERY` into the same final-answer waiter path used
by live completion events instead of treating global-state hydration as
UI-only decoration.

The shared completion path requires the same full identity on dispatch,
lifecycle completion and answer events: run/dispatch ids plus tab session,
content-script instance and navigation sequence. `ContentUtils` decorates
`LLM_RESPONSE_READY` at emission time. Trusted background DOM recovery copies
the active model entry identity into the recovered finalization event. Identity
validation remains fail-closed for provider-tab messages; recovery code must
not satisfy it by weakening or bypassing the validator. Collection and replay
paths must preserve that identity as well, so a recovered final answer reaches
the same bound Debate card instead of becoming an uncorrelated terminal event.

## Presets and prompts

`PipelinePresets` is the only built-in preset catalog. It owns topology,
duration, limits, termination/finalization/checkpoint policy, reasoning budget,
round plans and built-in UI defaults. `pipelineStore` persists only materialized
configurations and user overrides.

`DebateContracts` owns typed task, stage and action semantics.
`DebateContextBroker` selects bounded, provenance-aware context and separates
model/document text as untrusted data. `DebatePromptPack` owns versioned
wording, while `DebatePromptCompiler` is the shared composition boundary and
emits the prompt fingerprint and response validator contract.
`DebatePromptCatalog`, `DisputMessageTemplates` and `TriadMessageTemplates`
remain compatibility builders for old call sites and shared service helpers;
new execution semantics must not be added to them. Duel, Triad, Multi and
FreeTalk all route production prompts through the compiler when the v3 modules
are loaded. Prompt compilation is pure, receives explicit context and does not
read DOM state. The full prompt contract is in
[D5_disput-prompt-system.md](D5_disput-prompt-system.md).

## Registry

Production uses the topology-neutral `DebateRegistry` API. `TriadRegistry` is a
compatibility name for the shared implementation. The registry validates every
artifact/trigger anchor against the raw event that supplied it. Checkpoint
output cannot directly mutate protocol truth without passing this validation.

The persisted UI setting migrated from `llmCodexTriadRegistry.v1` to
`llmCodexDebateRegistry.v1`; the old value is read once for compatibility.

## Recovery

`DebateTransport` persists the aggregate in `chrome.storage.session`, preserving
Sets used by protocol states. On page recreation, an active aggregate is
rehydrated into a technical pause. Resume performs a controlled restart using
the persisted topic, preset and selected models after cancelling any orphaned
background dispatch. This avoids accepting a response for a waiter that no
longer exists after page destruction.

Completed/error/cancelled aggregates remain available for inspection but are
never resumed.

## Terminal flow

Successful Duel, Triad and Multi runs share one terminal sequence:

1. mark the protocol terminal;
2. synchronize the protocol snapshot and aggregate status;
3. notify the background Pipeline FSM with `COMPLETED`;
4. execute selected Notes/JSON/HTML outputs once per run;
5. release page runtime resources.

Rejections and failures after `STARTING` always emit `FAILED` or `CANCELLED` to
both the aggregate and background control layer.

## Invariants

1. Duel cannot route a public turn until A0 and B0 are both captured.
2. Triad advances only after its wave barrier is complete.
3. Multi always owns explicit wave and synthesis phases through `MultiFSM`.
4. A new run replaces the previous run event stream.
5. UI controls are a projection of aggregate status.
6. Page protocol state and background dispatch state share correlation IDs but
   never share topology semantics.
7. Stale cancellation cannot terminate a different active run.
8. Exported HTML sanitizes executable markup defensively.

## Testing strategy

- FSM, protocol facade, aggregate, projections, prompts and presets are tested
  without the DOM.
- application, execution context, shared run services and all three topology
  runners have focused DOM-free tests.
- plan compiler/validator tests assert exact built-in stage traces, terminal
  reachability, explicit system stages and tab reuse policy; the plan view-model
  is tested independently from the DOM.
- prompt-runtime tests cover task classification, reproducible fingerprints,
  context trust/budget, strict acceptance, anchored StateDelta, capability
  routing, profile trigger allowlists and schema migration.
- controller/session/export modules have focused jsdom tests.
- transport and background handlers use mock ports/storage.
- `results-debate-favorites.test.js` exercises the composed production page,
  including Duel dispatch/cancel, transcript, presets, builder and UI state.

## Migration guardrails

The extraction from the legacy `results.js` monolith is deliberately staged:

- behavior is characterized per topology and per stage immediately before that
  stage is moved; one giant DOM characterization suite is not a prerequisite;
- runners receive one explicit capability `deps` object. Separate formal ports
  are introduced only when a capability needs an independent lifecycle or
  contract; the current extension has no bundler-level module loader that would
  justify six manually ordered port files;
- existing `window.runPipeline` callers remain supported through a temporary
  delegation shim, while all new sequencing belongs to `DebateApplication`;
- main-page Send has no Debate navigation or auto-run capability. It owns only
  the ordinary comparison dispatch. Opening and starting Duel/Triad/Multi is an
  explicit Debate/Pipeline control action; Debate intent must never be inferred
  from persisted scheme or active-pipeline state on the main page;
- source-based regression tests must follow the production owner after a move
  (`DuelRunner`, `DebateRunStore`, transport or adapter), and every migration
  stage must leave a bisectable green test commit.

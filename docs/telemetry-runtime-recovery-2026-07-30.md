# Telemetry runtime recovery review — 2026-07-30

## Scope

The review correlates `telemetry-all-presets-1785437684427.json` from extension
2.81.182 with the exact 2.81.182 source line. The artifact is structurally
valid through ledger sequence 74, but its export barrier timed out with 630
queued mutations. It therefore proves the recorded dispatch prefix, not the
absence of later generation, extraction, terminal or delivery activity.

## Findings and change plans

### P0-1 — persistence backlog drops the live suffix from export

Evidence: `barrierTimedOut=true`, `queuedMutationCount=630`, and no ledger event
after 28.2 seconds although the snapshot froze at 191.2 seconds. The ledger
serialized a separate durable transaction for every asynchronous mutation
batch.

Plan and implementation: coalesce all mutations that arrive during an active
persistence transaction, apply them in ingestion order, and commit the batch in
one transaction. Resolve callers only after the shared durable boundary is
committed. Stress coverage verifies a complete dispatch-to-terminal chain.

### P0-2 — stale committed fallback is presented as a normal export

Evidence: after a two-second timeout the router returned `snapshotCommitted`,
and the UI downloaded it while saying that the queue continued in background.

Plan and implementation: wait for a bounded ten-second queue-drained barrier.
On timeout return a retryable `proof_telemetry_snapshot_incomplete` result and
do not create a JSON download. Surface queued and pending counts to the user.

### P1-1 — dispatch identity is not propagated through proof events

Evidence: the runtime increments `entry.generationEpoch`, but 2.81.182 dispatch,
page and confirmation events in the artifact have no generation epoch. The
dispatch metadata also had no stable attempt identifier. Every incident reports
`attempt_identity_missing`.

Plan and implementation: create `dispatchIdentityMeta` once per dispatch with
run, dispatch, generation and attempt identifiers. Store it in
`lastDispatchMeta` and propagate it through page readiness, content commands,
baseline, submission, source, extraction and delivery events.

### P1-2 — the pre-dispatch baseline is fire-and-forget

Evidence: several baselines arrive after pending/rejection events and four
providers have no baseline in the frozen prefix. Every adapter called
`reportDispatchBaseline` without awaiting the background acknowledgement.

Plan and implementation: all nine provider adapters await baseline delivery
before performing Send. Failure remains best-effort and does not leak answer
content, but ordering is now deterministic when background is available.

### P1-3 — accepted submission can regress to pending

Evidence: Qwen records `PROMPT_SUBMITTED_ACCEPTED` followed by
`PROMPT_SUBMITTED_PENDING` for the same dispatch. The skip-wait path writes
pending after command delivery even if content confirmed synchronously.

Plan and implementation: query the entry and dispatch registry immediately
before the pending transition and suppress it when the exact dispatch is
already confirmed.

### P1-4 — validated lifecycle answer has no extraction boundary

Evidence: the runtime intentionally stopped mapping the ambiguous
`LLM_RESPONSE_READY` label directly to extraction, but its validated branch did
not emit the replacement `ANSWER_EXTRACTION_COMPLETED` fact. Consequently the
extraction slot can remain empty even when a current answer was validated.

Plan and implementation: after materialization validation, emit an explicit
accepted extraction fact with current-dispatch identity, normalized length/hash
and the same payload evidence ID as source and delivery acknowledgement.

### P1-5 — runtime and export policy identifiers disagree

Evidence: `RUN_CONFIG_RECORDED` says `proof-default-v2`, while
`sharedConfig.policy` says `proof-default-v1`.

Plan and implementation: derive exported policy metadata from the immutable
runtime configuration event. Publish an audit comparison of runtime and export
policy IDs and reserve invariant S21 for a disagreement.

### P1-6 — repeated aliases are serialized as circular data

Evidence: the artifact contains 16 literal `[CIRCULAR]` values. The redactor's
global `WeakSet` treats reuse of a shared limitations object as recursion.

Plan and implementation: track only objects on the current ancestor path and
remove them after each subtree. True self-cycles remain bounded; ordinary
aliases serialize as complete independent JSON values.

### P1-7 — structural validity is confused with diagnostic usability

Evidence: schema validation, hashes and replay are valid even though the source
snapshot is incomplete. Those checks correctly prove internal consistency but
not evidence completeness.

Plan and implementation: add an independent `diagnosticUsability` audit with
complete/incomplete status and explicit barrier, queued-mutation and pending
record limitations. Keep schema validity separate.

### P2-1 — all seven user diagnoses are unknown in the supplied artifact

This is a consequence, not seven proven provider defects. `Cutted`,
`False success`, `Late end` and `No delivery` have no complete critical proof;
`Old answer` has only partial baseline context; prompt diagnoses have dispatch
context but no reliable closed absence window. DeepSeek's
`LIFECYCLE_CORRELATION_REJECTED` is a concrete correlation failure, not proof
that the user-facing card was empty.

Plan: recover the transport, identity and extraction boundaries above, then
capture a fresh run. Diagnose provider-specific gaps only from that new
queue-drained artifact. Do not reinterpret unknown as failure.

## Acceptance gates

1. A high-rate asynchronous stream commits with a bounded number of writes.
2. A snapshot contains baseline, submit, generation, observation, extraction,
   decision and terminal events with one exact identity.
3. Export cannot download while the durable barrier is incomplete.
4. Accepted submission never regresses to pending.
5. Runtime and exported policy identifiers match.
6. Shared aliases do not become `[CIRCULAR]`; true cycles remain bounded.
7. Diagnostic usability is reported independently of JSON/schema validity.

## Control export 1785440659712 (v2.81.185)

The fresh export confirms that the transport fixes work: the snapshot boundary
is `queue_drained`, the barrier did not time out, there are no queued or pending
records, policy IDs agree, and repeated aliases are no longer serialized as
`[CIRCULAR]`. Diagnostic usability is therefore reported as complete.

It also exposes the next semantic defects. The strict validator rejects two
unscoped selector-forensic companions under S03 and classifies their audit layer
as invalid under S04. Finalization and terminal events frequently lose
`generationEpoch`; baseline facts do not retain it consistently. Canonical
terminal events can also inherit a candidate-identity typed fact from legacy
metadata, while finalization remains `unknown`. Finally, delivery identifiers
whose names end in `Id` are discarded unless they happen to match the generic
compaction expression.

Implementation in v2.81.187 makes the canonical event type authoritative for
typed facts, assigns forensic snapshots to the audit layer, suppresses
evidence-linked forensic companions without dispatch scope, propagates the
active epoch/attempt into baseline and final boundaries, and explicitly retains
delivery proof IDs. A new runtime export is still required to measure provider
coverage; the old artifact cannot be repaired retroactively.

The control export also contains baselines for only six of nine providers.
Reinspection found that the adapters awaited `reportDispatchBaseline`, but the
helper returned a boolean immediately after queuing `chrome.runtime.sendMessage`.
Version 2.81.188 turns that helper into an acknowledgement promise with a bounded
1.5 second fail-open timeout, so the existing adapter awaits now enforce the
intended pre-Send ordering.

The control run's `No delivery` coverage is zero and contains no
`ANSWER_SOURCE_MATERIALIZED` facts even though terminal paths report non-empty
answer lengths. Version 2.81.189 emits source-materialization and extraction
facts from the common normalized response boundary, deduplicated by dispatch,
attempt and payload proof. This covers direct provider paths that never pass
through the lifecycle router branch.

Version 2.81.190 also closes the validator-parity gap: the runtime export audit
now evaluates S03 exact evidence scope and S04 canonical event layer using the
same rules as the offline validator. Internal `schemaValidation.valid` can no
longer remain true for an artifact that the shipped CLI rejects on those rules.

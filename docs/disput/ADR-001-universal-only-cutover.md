# ADR-001 — Universal-only cutover

**Status:** Architecture decision accepted; Product-owner sign-off pending evidence  
**Date:** 2026-07-23  
**Decision owner:** Disput architecture

## Context

The former product contained named execution topologies and their dedicated
runners. They duplicated lifecycle and persistence semantics and made a run's
real owner ambiguous. The current product requirement is a single universal
pipeline whose participant count, ordering and batching are policy data.

## Decision

Disput has exactly one production execution path:

`DebateApplication → Planner → DebateOrchestrator → StageExecutor → Artifact → StateDelta → StateMap`.

Deprecated named topologies, their executors, registries, loaders, UI selectors
and feature switches are removed. There is no runtime fallback, shadow switch
or compatibility path that can execute them. Historical documentation is kept
only under `docs/disput-old/` for reference.

This is an explicit big-bang cutover decision. The accepted risk is that a
release with the universal engine must be operationally correct before rollout;
the product does not retain a second executor as an emergency compatibility
route. Architecture accepts this direction, but the Product-owner sign-off is a
release evidence item and is not implied by this document's existence.

## Consequences

- Rollback is a release-artifact rollback, not routing to a second engine.
- Rollback uses the signed previous extension package and is tested by restoring
  it against the current persisted data before release approval.
- Persisted data policy is forward-compatible migration only: every migration
  is versioned, idempotent, preserves unknown data for inspection, and has an
  explicit recovery/export path. No migration may delete data or recreate a
  legacy executor. A failed migration blocks startup and leaves the previous
  snapshot recoverable; data rollback is restore-from-snapshot/export, not an
  in-place destructive downgrade.
- Persisted legacy configuration may be translated into universal configuration
  data, but never regains legacy execution semantics.
- Release remains blocked until the P0 universal recovery, race, human-decision
  and rollback gates pass. The absence of a legacy fallback does not waive those
  gates.
- Any future request for another executor requires a new ADR and a full
  architecture review; it cannot be added as a compatibility shortcut.

## Superseded material

Historical removal gates that required retaining legacy runtime paths are
superseded by this ADR. They remain archived, rather than silently deleted, so
their rationale can be audited without becoming an active requirement.

## Required approvals and evidence

| Evidence ID | Required approval/evidence | Status | Owner | Reviewer |
|---|---|---|---|---|
| ADR001-A | Architecture acceptance of universal-only big-bang cutover | accepted in this ADR | Disput Architecture | Product owner |
| ADR001-P | Product-owner acceptance of cutover risk | pending | Product owner | Release reviewer |
| ADR001-R | Signed previous release artifact and rollback drill | pending | Release Engineering | Disput Architecture |
| ADR001-S | Storage compatibility and failed-migration recovery test | pending | Runtime/Data owner | Release reviewer |

# ADR-001 — Universal-only cutover

**Status:** Accepted  
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

## Consequences

- Rollback is a release-artifact rollback, not routing to a second engine.
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

// DebateOrchestrator — lifecycle owner for one discussion run (Orchestrator Contract v1.0).
// Planner decides. Orchestrator coordinates. Executor executes.
(function initDebateOrchestrator(root) {
  'use strict';

  const LIFECYCLE = Object.freeze({
    CREATED: 'CREATED', STARTING: 'STARTING', RUNNING: 'RUNNING',
    PAUSE_REQUESTED: 'PAUSE_REQUESTED', QUIESCING: 'QUIESCING', PAUSED: 'PAUSED',
    RECONCILING: 'RECONCILING', FINALIZING: 'FINALIZING',
    COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', FAILED: 'FAILED'
  });

  const TERMINAL = new Set([LIFECYCLE.COMPLETED, LIFECYCLE.CANCELLED, LIFECYCLE.FAILED]);
  const NO_LEASE_RENEWAL = new Set([LIFECYCLE.PAUSED, ...TERMINAL]);

  const arr = (value) => Array.isArray(value) ? value : [];
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

  function createOrchestrator(deps = {}) {
    const planner = deps.planner;
    const executor = deps.executor;
    const revisions = deps.revisionStore;
    if (!planner || typeof planner.evaluate !== 'function') throw new Error('Orchestrator requires a Planner');
    if (!executor || typeof executor.execute !== 'function') throw new Error('Orchestrator requires a StageExecutor');
    if (!revisions) throw new Error('Orchestrator requires a PlanRevision store');
    const now = deps.now || (() => Date.now());
    const nowIso = () => new Date(now()).toISOString();
    const leaseTtlMs = Number(deps.leaseTtlMs || 30000);
    const ownerId = String(deps.ownerId || `owner-${Math.random().toString(36).slice(2, 10)}`);
    const persistence = deps.persistence || createMemoryPersistence();
    const commitStateDelta = deps.commitStateDelta || null;
    const projectStateMap = deps.projectStateMap || ((state) => state.stateMap);

    // ---- Persistent run state (event-sourced; snapshot is a materialized checkpoint) ----
    const state = {
      runId: '',
      lifecycle: LIFECYCLE.CREATED,
      caseVersion: 0,
      stateMapVersion: 0,
      debateCase: null,
      stateMap: {},
      openGoals: [],
      stages: [],           // StageInstances (all)
      events: [],           // append-only event log
      eventSequence: 0,
      decisions: {},        // planningDecisionId -> decision (idempotent commit)
      participantStatus: {}, // participantId -> runtime availability projection
      configuredParticipants: [],
      activeParticipants: [],
      droppedParticipants: [],
      pendingInterventions: [],
      lateResponses: [],
      pausePolicy: null,
      finalization: null,
      totalStagesExecuted: 0,
      stagnationSignals: { consecutiveNoStateDelta: 0, unchangedStateMapCount: 0, repeatedActionCount: 0 },
      recentActionFingerprints: []
    };
    let lease = null;
    let tickInFlight = false;
    let quiescePromise = null;
    let abortController = deps.AbortController ? new deps.AbortController() : (typeof AbortController !== 'undefined' ? new AbortController() : null);

    function createMemoryPersistence() {
      const store = { events: [], snapshots: [], lease: null };
      return {
        appendEvent: (event) => { store.events.push(clone(event)); },
        loadEvents: (afterSequence = 0) => store.events.filter((e) => e.eventSequence > afterSequence).map(clone),
        saveSnapshot: (snapshot) => { store.snapshots.push(clone(snapshot)); },
        loadLatestSnapshot: () => clone(store.snapshots[store.snapshots.length - 1] || null),
        readLease: () => clone(store.lease),
        writeLease: (value) => { store.lease = clone(value); return true; },
        compareAndSetLease: (expectedVersion, value) => {
          if (Number(store.lease?.leaseRevision || store.lease?.version || 0) !== Number(expectedVersion || 0)) return false;
          store.lease = clone(value);
          return true;
        }
      };
    }

    const fatal = (reason, detail) => {
      state.lifecycle = LIFECYCLE.FAILED;
      emit('RUN_FAILED', { reason, detail, fatal: true });
      return { ok: false, fatal: true, reason };
    };

    function emit(type, payload = {}) {
      state.eventSequence += 1;
      const event = {
        eventId: `${state.runId}:${state.eventSequence}`,
        eventSequence: state.eventSequence,
        runId: state.runId,
        ownerId,
        caseVersion: state.caseVersion,
        planRevisionId: revisions.getActive?.()?.revisionId || null,
        type,
        payload: clone(payload),
        timestamp: nowIso()
      };
      state.events.push(event);
      persistence.appendEvent(event);
      deps.emit?.(type, event);
      return event;
    }

    function initializeParticipants(participants = []) {
      state.configuredParticipants = arr(participants).map((participant) => String(participant?.participantId || '')).filter(Boolean);
      state.droppedParticipants = state.configuredParticipants
        .filter((participantId) => state.participantStatus[participantId]?.available === false)
        .map((participantId) => ({ participantId, ...clone(state.participantStatus[participantId]) }));
      const dropped = new Set(state.droppedParticipants.map((participant) => participant.participantId));
      state.activeParticipants = state.configuredParticipants.filter((participantId) => !dropped.has(participantId));
    }

    // ---- Lease (§6) ----
    function notifyLease(change) {
      try { deps.onLeaseChange?.(clone(change)); } catch (_) {}
      try { persistence.publishLeaseChange?.(clone(change)); } catch (_) {}
    }
    function acquireLease() {
      const existing = persistence.readLease?.();
      const expired = !existing || existing.expiresAt <= now() || existing.ownerId === ownerId;
      if (!expired) return { ok: false, code: 'LEASE_HELD', holder: existing.ownerId };
      const previousRevision = Number(existing?.leaseRevision || existing?.version || 0);
      lease = {
        runId: state.runId, ownerId,
        acquiredAt: now(), expiresAt: now() + leaseTtlMs,
        leaseRevision: previousRevision + 1,
        // `version` remains for stored snapshots created before leaseRevision.
        version: previousRevision + 1
      };
      const committed = typeof persistence.compareAndSetLease === 'function'
        ? persistence.compareAndSetLease(previousRevision, lease)
        : persistence.writeLease?.(lease);
      if (!committed) { lease = null; return { ok: false, code: 'LEASE_RACE' }; }
      notifyLease({ type: 'LEASE_ACQUIRED', lease });
      return { ok: true, lease };
    }
    function renewLease() {
      if (!lease || NO_LEASE_RENEWAL.has(state.lifecycle)) return false;
      const current = persistence.readLease?.();
      if (!current || current.ownerId !== ownerId
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        lease = null;
        return false;
      }
      lease = { ...lease, expiresAt: now() + leaseTtlMs };
      if (!persistence.writeLease?.(lease)) { lease = null; return false; }
      notifyLease({ type: 'LEASE_RENEWED', lease });
      return true;
    }
    function assertLease() {
      const current = persistence.readLease?.();
      if (!current || !lease || current.ownerId !== ownerId || current.expiresAt <= now()
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        return { ok: false, code: 'LEASE_LOST' };
      }
      return { ok: true };
    }
    function releaseLease(reason = 'released') {
      const current = persistence.readLease?.();
      if (!lease || !current || current.ownerId !== ownerId
        || Number(current.leaseRevision || current.version || 0) !== Number(lease.leaseRevision || lease.version || 0)) {
        lease = null;
        return false;
      }
      const released = { ...lease, releasedAt: now(), releaseReason: reason };
      const committed = typeof persistence.compareAndSetLease === 'function'
        ? persistence.compareAndSetLease(Number(lease.leaseRevision || lease.version || 0), null)
        : persistence.writeLease?.(null);
      lease = null;
      if (!committed) return false;
      notifyLease({ type: 'LEASE_RELEASED', lease: released });
      return true;
    }
    function handleLeaseLost(reason = 'lease_lost') {
      if (state.lifecycle === LIFECYCLE.RUNNING || state.lifecycle === LIFECYCLE.STARTING) {
        abortController?.abort?.(reason);
        state.lifecycle = LIFECYCLE.PAUSED;
        emit('LEASE_LOST', { reason });
      }
      lease = null;
      return { ok: false, code: 'LEASE_LOST' };
    }

    // ---- Snapshot (§15) ----
    function buildSnapshot() {
      return {
        runId: state.runId,
        snapshotVersion: 2,
        eventSequence: state.eventSequence,
        debateCase: clone(state.debateCase),
        activePlanRevisionId: revisions.getActive?.()?.revisionId || null,
        revisions: revisions.getLineage?.().map(clone) || [],
        activeStages: clone(state.stages.filter((s) => !['completed', 'failed', 'cancelled', 'stale'].includes(s.status))),
        stages: clone(state.stages),
        openGoals: clone(state.openGoals),
        runLifecycle: state.lifecycle,
        caseVersion: state.caseVersion,
        stateMapVersion: state.stateMapVersion,
        stateMap: clone(state.stateMap),
        participantStatus: clone(state.participantStatus),
        configuredParticipants: clone(state.configuredParticipants),
        activeParticipants: clone(state.activeParticipants),
        droppedParticipants: clone(state.droppedParticipants),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        totalStagesExecuted: state.totalStagesExecuted,
        stagnationSignals: clone(state.stagnationSignals),
        createdAt: nowIso()
      };
    }

    // ---- Planner tick (§9) ----
    function plannerInput() {
      const active = revisions.getActive?.();
      return {
        runId: state.runId,
        caseVersion: state.caseVersion,
        stateMapVersion: state.stateMapVersion,
        activePlanRevisionId: active?.revisionId,
        activePlanRevision: active,
        debateCase: state.debateCase,
        stateMap: state.stateMap,
        openGoals: clone(state.openGoals),
        resolvedGoals: [],
        activeStages: clone(state.stages.filter((s) => !['completed', 'failed', 'cancelled', 'stale'].includes(s.status))),
        stageHistory: clone(state.stages),
        availableParticipants: arr(state.debateCase?.participants).map((p) => ({
          participantId: p.participantId, type: p.type || 'llm', provider: p.provider,
          capabilities: p.capabilities || [],
          serviceOnly: p.serviceOnly === true,
          available: p.available !== false && state.participantStatus[p.participantId]?.available !== false,
          capacity: p.capacity ?? 1
        })),
        participantCapabilities: Object.fromEntries(arr(state.debateCase?.participants).map((p) => [p.participantId, p.capabilities || []])),
        policies: state.debateCase?.policies || {},
        budgets: state.debateCase?.policies?.budgets || {},
        totalStagesExecuted: state.totalStagesExecuted,
        stagnationSignals: clone(state.stagnationSignals),
        recentActionFingerprints: state.recentActionFingerprints.slice(),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        ruleSetVersion: planner.ruleSetVersion,
        currentTime: nowIso()
      };
    }

    async function plannerTick() {
      if (state.lifecycle !== LIFECYCLE.RUNNING) return { ok: false, code: 'NOT_RUNNING' };
      if (tickInFlight) return { ok: false, code: 'TICK_IN_FLIGHT' };
      const leaseCheck = assertLease();
      if (!leaseCheck.ok) return leaseCheck;
      tickInFlight = true;
      try {
        emit('PLANNING_STARTED', {});
        const input = plannerInput();
        let decision;
        try {
          decision = planner.evaluate(input);
        } catch (error) {
          emit('PLANNING_FAILED', { reason: error?.message });
          return { ok: false, code: 'PLANNING_FAILED', reason: error?.message };
        }
        // Stale check (§9.2): versions must be unchanged at commit time.
        if (decision.inputCaseVersion !== state.caseVersion
          || decision.inputStateMapVersion !== state.stateMapVersion
          || decision.inputPlanRevisionId !== revisions.getActive?.()?.revisionId) {
          emit('PLANNING_DECISION_STALE', { decisionId: decision.decisionId });
          return { ok: false, code: 'PLANNING_DECISION_STALE' };
        }
        if (state.lifecycle !== LIFECYCLE.RUNNING) {
          emit('PLANNING_DECISION_STALE', { decisionId: decision.decisionId, reason: 'lifecycle_changed' });
          return { ok: false, code: 'PLANNING_DECISION_STALE' };
        }
        if (state.decisions[decision.decisionId]) {
          return { ok: true, decision: state.decisions[decision.decisionId], deduplicated: true };
        }
        state.decisions[decision.decisionId] = decision;
        emit('PLANNING_COMPLETED', { decisionId: decision.decisionId, type: decision.type, rationaleCode: decision.rationaleCode });
        return { ok: true, decision };
      } finally {
        tickInFlight = false;
      }
    }

    // ---- Stage creation (§10) ----
    function createStages(decision) {
      const active = revisions.getActive?.();
      const created = [];
      for (const proposed of arr(decision.proposedStages)) {
        const stageInstanceId = `stage-${state.runId}-${state.stages.length + created.length + 1}`;
        // Idempotent creation: one stage per (decisionId, proposedStageId).
        const duplicate = state.stages.find((s) => s.createdByDecisionId === decision.decisionId && s.proposedStageId === proposed.proposedStageId);
        if (duplicate) { created.push(duplicate); continue; }
        const stage = {
          stageInstanceId,
          proposedStageId: proposed.proposedStageId,
          plannedStageId: proposed.plannedStageId || null,
          runId: state.runId,
          planRevisionId: active?.revisionId,
          createdByDecisionId: decision.decisionId,
          goalIds: arr(proposed.goalIds),
          purpose: proposed.purpose,
          participants: arr(proposed.participantIds).map((id) => {
            const definition = arr(state.debateCase?.participants).find((p) => p.participantId === id);
            const binding = arr(proposed.participantBindings).find((item) => item?.participantId === id) || {};
            return { participantId: id, type: definition?.type || 'llm', model: definition?.model || id, promptId: binding.promptId || null };
          }),
          inputArtifactIds: arr(proposed.inputArtifactIds),
          expectedOutputs: arr(proposed.expectedArtifactTypes),
          dispatchMode: proposed.dispatchMode || 'single',
          completionMode: proposed.completionMode || 'all',
          visibilityPolicy: proposed.visibilityPolicy || { mode: 'public' },
          outputIntent: proposed.outputIntent,
          terminalPolicy: proposed.terminalPolicy,
          auditPolicy: proposed.auditPolicy,
          inputSelector: proposed.inputSelector,
          status: 'pending',
          attempt: 1
        };
        state.stages.push(stage);
        created.push(stage);
        emit('STAGE_CREATED', { stageInstanceId, decisionId: decision.decisionId, purpose: stage.purpose, participants: stage.participants.map((p) => p.participantId) });
        stage.goalIds.forEach((goalId) => {
          const goal = state.openGoals.find((g) => g.goalId === goalId);
          if (goal) goal.status = 'assigned';
        });
      }
      return created;
    }

    // ---- Commit transaction (§12) ----
    function commitStageResult(stage, result) {
      // Atomic semantic commit: artifacts + goal update + case version + terminal status.
      for (const failure of arr(result.terminalFailures)) {
        const participantId = String(failure.participantId || '');
        if (!participantId || state.participantStatus[participantId]?.available === false) continue;
        state.participantStatus[participantId] = {
          available: false,
          terminal: true,
          reasonCode: failure.reasonCode || 'terminal_transport_failure',
          stageInstanceId: failure.stageId || stage.stageInstanceId,
          attemptId: failure.attemptId || '',
          recordedAt: nowIso()
        };
        initializeParticipants(state.debateCase?.participants);
        emit('PARTICIPANT_UNAVAILABLE', { participantId, ...state.participantStatus[participantId] });
      }
      const applied = [];
      const baseCaseVersion = state.caseVersion;
      const workingState = {
        ...state,
        debateCase: clone(state.debateCase),
        stateMap: clone(state.stateMap),
        caseVersion: baseCaseVersion,
        stateMapVersion: state.stateMapVersion
      };
      for (const delta of arr(result.proposedStateDeltas)) {
        emit('STATE_DELTA_PROPOSED', { stageInstanceId: stage.stageInstanceId, delta });
        const expected = delta.expectedCaseVersion;
        if (expected != null && expected !== baseCaseVersion) {
          emit('STATE_DELTA_STALE', { stageInstanceId: stage.stageInstanceId, expected, actual: baseCaseVersion });
          continue;
        }
        let outcome = { applied: true, stateMap: workingState.stateMap };
        if (commitStateDelta) outcome = commitStateDelta({ state: workingState, stage, delta }) || outcome;
        if (outcome.applied === false) {
          emit('STATE_DELTA_REJECTED', { stageInstanceId: stage.stageInstanceId, reason: outcome.reason });
          continue;
        }
        applied.push(delta);
        workingState.stateMap = outcome.stateMap || projectStateMap(workingState) || workingState.stateMap;
      }
      const meaningful = applied.length > 0;
      if (meaningful) {
        state.debateCase = workingState.debateCase;
        state.stateMap = workingState.stateMap;
        state.caseVersion = baseCaseVersion + 1;
        state.stateMapVersion += 1;
        if (state.debateCase) state.debateCase.version = state.caseVersion;
        applied.forEach((delta) => emit('STATE_DELTA_APPLIED', {
          stageInstanceId: stage.stageInstanceId, deltaId: delta.deltaId || '', caseVersion: state.caseVersion
        }));
        state.stagnationSignals.consecutiveNoStateDelta = 0;
        state.stagnationSignals.unchangedStateMapCount = 0;
      } else {
        state.stagnationSignals.consecutiveNoStateDelta += 1;
        state.stagnationSignals.unchangedStateMapCount += 1;
        emit('NO_STATE_CHANGE', { stageInstanceId: stage.stageInstanceId });
      }
      const fingerprint = `${stage.purpose}|${arr(stage.inputArtifactIds).join(',')}`;
      if (state.recentActionFingerprints.includes(fingerprint)) state.stagnationSignals.repeatedActionCount += 1;
      else state.stagnationSignals.repeatedActionCount = 0;
      state.recentActionFingerprints = [...state.recentActionFingerprints, fingerprint].slice(-6);

      stage.goalIds.forEach((goalId) => {
        const goal = state.openGoals.find((g) => g.goalId === goalId);
        if (!goal) return;
        // Goal resolves only via committed StateDelta satisfying its criteria (Planner §6.6).
        if (meaningful && result.executionStatus === 'completed') goal.status = 'resolved';
        else if (result.executionStatus === 'completed' || result.executionStatus === 'partial') goal.status = 'open';
        else goal.status = 'open';
      });
      stage.status = result.executionStatus === 'completed' ? 'completed'
        : result.executionStatus === 'partial' ? 'completed'
        : result.executionStatus === 'cancelled' ? 'cancelled' : 'failed';
      state.totalStagesExecuted += 1;
      emit('STAGE_COMPLETED', { stageInstanceId: stage.stageInstanceId, executionStatus: result.executionStatus, meaningfulDelta: meaningful });
    }

    async function executeStage(stage) {
      if (stage.status !== 'pending') return null;
      const activeRevisionId = revisions.getActive?.()?.revisionId;
      if (stage.planRevisionId !== activeRevisionId) {
        stage.status = 'stale';
        emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'revision_superseded' });
        return null;
      }
      stage.status = 'running';
      emit('STAGE_STARTED', { stageInstanceId: stage.stageInstanceId });
      // Universal Production Wiring: executor needs the canonical state snapshot to
      // compile a real prompt / extract artifacts, not just an abort signal.
      const executionContext = {
        signal: abortController?.signal,
        debateCase: state.debateCase,
        stateMap: state.stateMap,
        openGoals: state.openGoals,
        constraints: arr(state.debateCase?.constraints),
        attachments: arr(state.debateCase?.attachments),
        caseVersion: state.caseVersion,
        stateMapVersion: state.stateMapVersion,
        planRevisionId: activeRevisionId
      };
      const result = await executor.execute(stage, executionContext);
      // A slow provider response must not be committed by a former owner after
      // another context has fenced it out or the lease has expired.
      const leaseCheck = assertLease();
      if (!leaseCheck.ok) {
        stage.status = 'stale';
        emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'lease_lost_after_dispatch' });
        return handleLeaseLost('lease_lost_after_dispatch');
      }
      if (result.executionStatus === 'awaiting_participant') {
        stage.status = 'awaiting_participant';
        emit('STAGE_AWAITING_PARTICIPANT', { stageInstanceId: stage.stageInstanceId, participants: result.awaitingParticipants });
        return result;
      }
      // Pause policies (§13): finish_received_only rejects semantic commit of in-flight work.
      if (state.lifecycle === LIFECYCLE.QUIESCING && state.pausePolicy === 'finish_received_only') {
        state.lateResponses.push({ stageInstanceId: stage.stageInstanceId, result: clone(result) });
        stage.status = 'stale';
        emit('LATE_RESPONSE_RECORDED', { stageInstanceId: stage.stageInstanceId });
        return result;
      }
      commitStageResult(stage, result);
      return result;
    }

    // ---- Main loop step: one tick + execution of created stages ----
    async function step() {
      const tick = await plannerTick();
      if (!tick.ok) return tick;
      const decision = tick.decision;
      switch (decision.type) {
        case 'CREATE_STAGES': {
          const stages = createStages(decision);
          for (const stage of stages) {
            if (state.lifecycle !== LIFECYCLE.RUNNING) break;
            const execution = await executeStage(stage);
            if (execution?.ok === false) return execution;
          }
          return { ok: true, decision, executed: stages.map((s) => s.stageInstanceId) };
        }
        case 'REQUEST_HUMAN_DECISION':
          emit('PLANNING_HUMAN_DECISION_REQUIRED', { request: decision.humanDecisionRequest });
          state.pendingHumanDecision = decision.humanDecisionRequest;
          return { ok: true, decision };
        case 'FINALIZE':
          return finalize(decision.finalizationDecision || { reason: 'REQUIRED_GOALS_RESOLVED', finalizationMode: 'STATE_MAP' });
        case 'WAIT':
        case 'NO_OP':
          emit('PLANNING_NO_ACTION', { type: decision.type, rationaleCode: decision.rationaleCode });
          return { ok: true, decision };
        default:
          return fatal('UNKNOWN_DECISION_TYPE', decision.type);
      }
    }

    async function runLoop(maxSteps = 50) {
      let steps = 0;
      while (state.lifecycle === LIFECYCLE.RUNNING && steps < maxSteps) {
        steps += 1;
        if (!renewLease()) return handleLeaseLost('lease_renewal_failed');
        const outcome = await step();
        if (!outcome.ok) return outcome;
        const type = outcome.decision?.type;
        if (['WAIT', 'NO_OP', 'REQUEST_HUMAN_DECISION'].includes(type)) return outcome;
        if (state.finalization) return outcome;
      }
      return { ok: true, code: steps >= maxSteps ? 'STEP_BUDGET_REACHED' : 'STOPPED' };
    }

    // ---- Finalization (§18) ----
    function finalize(finalizationDecision) {
      if (state.finalization) {
        emit('DUPLICATE_FINALIZATION_REJECTED', {});
        return { ok: true, deduplicated: true, finalization: state.finalization };
      }
      state.lifecycle = LIFECYCLE.FINALIZING;
      emit('RUN_FINALIZATION_STARTED', { reason: finalizationDecision.reason, mode: finalizationDecision.finalizationMode });
      state.finalization = {
        ...finalizationDecision,
        finalStateMap: clone(state.stateMap),
        unresolvedGoalIds: state.openGoals.filter((g) => g.status !== 'resolved').map((g) => g.goalId),
        finalizedAt: nowIso()
      };
      state.lifecycle = LIFECYCLE.COMPLETED;
      persistence.saveSnapshot(buildSnapshot());
      emit('RUN_COMPLETED', { reason: finalizationDecision.reason });
      releaseLease('terminal_completed');
      return { ok: true, finalization: state.finalization };
    }

    // ---- Reconciliation shared by continue/recover (§14.2) ----
    function reconcile() {
      state.lifecycle = LIFECYCLE.RECONCILING;
      emit('RECONCILING_STARTED', {});
      // Late responses: commit or discard against current revision.
      for (const late of state.lateResponses.splice(0)) {
        const stage = state.stages.find((s) => s.stageInstanceId === late.stageInstanceId);
        if (!stage) continue;
        if (stage.planRevisionId === revisions.getActive?.()?.revisionId) {
          commitStageResult(stage, late.result);
          emit('LATE_RESPONSE_RECONCILED', { stageInstanceId: stage.stageInstanceId });
        } else {
          stage.status = 'stale';
          emit('LATE_RESPONSE_DISCARDED', { stageInstanceId: stage.stageInstanceId, reason: 'revision_superseded' });
        }
      }
      // Interventions become goals/constraints before the next Planner tick (§16).
      for (const intervention of state.pendingInterventions.splice(0)) {
        applyIntervention(intervention);
        emit('INTERVENTION_APPLIED', { interventionId: intervention.interventionId });
      }
      // Stage invalidation against active revision.
      const activeRevisionId = revisions.getActive?.()?.revisionId;
      for (const stage of state.stages) {
        if (['pending', 'awaiting_participant', 'running'].includes(stage.status) && stage.planRevisionId !== activeRevisionId) {
          stage.status = 'stale';
          stage.goalIds.forEach((goalId) => {
            const goal = state.openGoals.find((g) => g.goalId === goalId);
            if (goal && goal.status !== 'resolved') goal.status = 'open';
          });
          emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'reconciliation' });
        }
      }
      state.stateMap = projectStateMap(state) || state.stateMap;
      emit('RECONCILING_COMPLETED', {});
    }

    function applyIntervention(intervention) {
      const payload = intervention.payload || {};
      switch (intervention.type) {
        case 'ADD_CONSTRAINT':
          if (state.debateCase) state.debateCase.constraints = [...arr(state.debateCase.constraints), payload.constraint];
          break;
        case 'CORRECT_FACT':
        case 'ADD_CLARIFICATION':
          state.openGoals.push({
            goalId: `goal-intervention-${intervention.interventionId}`,
            type: 'recheck_conclusion', targetArtifactIds: arr(payload.artifactIds),
            status: 'open', priority: 70, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'REQUEST_VERIFICATION':
          state.openGoals.push({
            goalId: `goal-verify-${intervention.interventionId}`,
            type: 'verify_claim', targetArtifactIds: arr(payload.artifactIds),
            status: 'open', priority: 75, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'REQUEST_SYNTHESIS':
          state.openGoals.push({
            goalId: `goal-synthesis-${intervention.interventionId}`,
            type: 'produce_synthesis', targetArtifactIds: [],
            status: 'open', priority: 80, humanRequested: true,
            createdFromEventId: intervention.interventionId, createdAt: nowIso()
          });
          break;
        case 'CANCEL_GOAL': {
          const goal = state.openGoals.find((g) => g.goalId === payload.goalId);
          if (goal) goal.status = 'cancelled';
          break;
        }
        case 'STOP_RUN':
          finalize({ reason: 'MANUAL_STOP', finalizationMode: payload.finalizationMode || 'STATE_MAP', humanApprovalRequired: false });
          break;
        default: break;
      }
      state.caseVersion += 1;
      state.stateMapVersion += 1;
    }

    // ---- Public API (§5) ----
    const api = Object.freeze({
      LIFECYCLE,
      getState: () => ({
        runId: state.runId, lifecycle: state.lifecycle, caseVersion: state.caseVersion,
        stateMapVersion: state.stateMapVersion,
        activePlanRevisionId: revisions.getActive?.()?.revisionId || null,
        stages: clone(state.stages), openGoals: clone(state.openGoals),
        events: state.events.slice(), finalization: clone(state.finalization),
        pendingHumanDecision: clone(state.pendingHumanDecision || null),
        stateMap: clone(state.stateMap), participantStatus: clone(state.participantStatus),
        configuredParticipants: clone(state.configuredParticipants), activeParticipants: clone(state.activeParticipants),
        droppedParticipants: clone(state.droppedParticipants)
      }),
      getOwnerId: () => ownerId,

      async startRun(command = {}) {
        if (state.lifecycle !== LIFECYCLE.CREATED) return { ok: false, code: 'ALREADY_STARTED' };
        // DebateCase and initial revision exist before runtime (Roadmap §6.1).
        if (!command.debateCase) return { ok: false, code: 'DEBATE_CASE_REQUIRED' };
        state.runId = String(command.runId || command.debateCase.caseId || `run-${now()}`);
        const leased = acquireLease();
        if (!leased.ok) return leased;
        state.debateCase = clone(command.debateCase);
        state.caseVersion = Number(state.debateCase.version || 1);
        state.openGoals = clone(arr(command.debateCase.openGoals));
        initializeParticipants(state.debateCase.participants);
        state.stateMap = clone(command.stateMap || {});
        state.stateMapVersion = 1;
        if (!revisions.getActive?.()) {
          revisions.initialize({
            runId: state.runId,
            createdBy: 'system',
            executionPolicies: command.debateCase.policies || {},
            plannedStages: arr(command.plannedStages)
          });
        }
        state.lifecycle = LIFECYCLE.STARTING;
        emit('RUN_CREATED', {});
        emit('RUN_START_REQUESTED', {});
        state.lifecycle = LIFECYCLE.RUNNING;
        emit('RUN_STARTED', {});
        const outcome = command.deferExecution ? { ok: true } : await runLoop(command.maxSteps);
        return { ok: true, runId: state.runId, outcome, lifecycle: state.lifecycle };
      },

      async requestPause(command = {}) {
        if (state.lifecycle !== LIFECYCLE.RUNNING) return { ok: false, code: 'NOT_RUNNING' };
        state.pausePolicy = command.policy || state.debateCase?.policies?.pause?.mode || 'finish_current_stage';
        state.lifecycle = LIFECYCLE.PAUSE_REQUESTED;
        emit('PAUSE_REQUESTED', { policy: state.pausePolicy, requestedBy: command.requestedBy });
        state.lifecycle = LIFECYCLE.QUIESCING;
        emit('RUN_QUIESCING', {});
        if (state.pausePolicy === 'cancel_active_dispatch') {
          abortController?.abort?.('pause');
          state.stages.forEach((stage) => {
            if (stage.status === 'running') { stage.status = 'cancelled'; emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'pause' }); }
          });
        }
        if (quiescePromise) await quiescePromise.catch(() => {});
        const stillRunning = state.stages.some((s) => s.status === 'running');
        if (!stillRunning) {
          state.lifecycle = LIFECYCLE.PAUSED;
          persistence.saveSnapshot(buildSnapshot());
          emit('RUN_PAUSED', {});
          releaseLease('paused');
        }
        if (abortController && state.pausePolicy === 'cancel_active_dispatch' && deps.AbortController) {
          abortController = new deps.AbortController();
        }
        return { ok: true, lifecycle: state.lifecycle };
      },

      async requestContinue(command = {}) {
        if (state.lifecycle !== LIFECYCLE.PAUSED) return { ok: false, code: 'NOT_PAUSED' };
        emit('CONTINUE_REQUESTED', { requestedBy: command.requestedBy });
        const leased = acquireLease();
        if (!leased.ok) return leased;
        if (command.expectedCaseVersion != null && command.expectedCaseVersion !== state.caseVersion) {
          return { ok: false, code: 'CASE_VERSION_STALE' };
        }
        reconcile();
        state.lifecycle = LIFECYCLE.RUNNING;
        emit('RUN_RESUMED', {});
        const outcome = command.deferExecution ? { ok: true } : await runLoop(command.maxSteps);
        return { ok: true, outcome, lifecycle: state.lifecycle };
      },

      async requestCancel(command = {}) {
        if (TERMINAL.has(state.lifecycle)) return { ok: false, code: 'ALREADY_TERMINAL' };
        abortController?.abort?.('cancel');
        state.stages.forEach((stage) => {
          if (['pending', 'running', 'awaiting_participant'].includes(stage.status)) {
            stage.status = 'cancelled';
            emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'run_cancelled' });
          }
        });
        state.lifecycle = LIFECYCLE.CANCELLED;
        persistence.saveSnapshot(buildSnapshot());
        emit('RUN_CANCELLED', { reason: command.reason || 'cancelled' });
        releaseLease('terminal_cancelled');
        return { ok: true, lifecycle: state.lifecycle };
      },

      // Human participant response for an awaiting stage (Roadmap §8.2).
      async submitParticipantResponse(command = {}) {
        const stage = state.stages.find((s) => s.stageInstanceId === command.stageInstanceId);
        if (!stage) return { ok: false, code: 'STAGE_NOT_FOUND' };
        if (stage.status !== 'awaiting_participant') return { ok: false, code: 'STAGE_NOT_AWAITING' };
        const participantId = String(command.participantId || '');
        if (!stage.participants.some((p) => p.participantId === participantId)) return { ok: false, code: 'PARTICIPANT_NOT_ASSIGNED' };
        const duplicate = state.events.some((e) => e.type === 'PARTICIPANT_RESPONSE_SUBMITTED'
          && e.payload.stageInstanceId === stage.stageInstanceId && e.payload.participantId === participantId);
        if (duplicate) return { ok: false, code: 'DUPLICATE_RESPONSE' };
        emit('PARTICIPANT_RESPONSE_SUBMITTED', { stageInstanceId: stage.stageInstanceId, participantId });
        const artifacts = deps.extractArtifacts?.({ stage, participant: { participantId }, text: command.text }) || [];
        const result = {
          stageInstanceId: stage.stageInstanceId,
          executionStatus: 'completed',
          attempts: [{ participantId, status: 'accepted', attempts: 1 }],
          acceptedResponses: [{ participantId, text: String(command.text || ''), artifacts }],
          proposedStateDeltas: command.stateDelta ? [command.stateDelta] : (deps.proposeStateDelta ? [deps.proposeStateDelta({ stage, participant: { participantId }, text: command.text, artifacts })].filter(Boolean) : []),
          awaitingParticipants: [], failedParticipants: []
        };
        commitStageResult(stage, result);
        state.pendingHumanDecision = null;
        if (state.lifecycle === LIFECYCLE.RUNNING && !command.deferExecution) await runLoop(command.maxSteps);
        return { ok: true, stageInstanceId: stage.stageInstanceId };
      },

      // Control intervention — distinct from participant response (Roadmap §8.3).
      async submitIntervention(command = {}) {
        const intervention = {
          interventionId: String(command.interventionId || `intervention-${now()}`),
          type: command.type, payload: command.payload || {},
          targets: command.targets || 'all', visibility: command.visibility || 'public'
        };
        const duplicate = state.events.some((e) => e.type === 'INTERVENTION_RECORDED' && e.payload.interventionId === intervention.interventionId);
        if (duplicate) return { ok: false, code: 'DUPLICATE_INTERVENTION' };
        emit('INTERVENTION_RECORDED', intervention);
        if (state.lifecycle === LIFECYCLE.PAUSED || state.lifecycle === LIFECYCLE.RUNNING) {
          if (state.lifecycle === LIFECYCLE.RUNNING) {
            const runningStages = state.stages.filter((s) => s.status === 'running');
            runningStages.forEach((stage) => emit('STAGE_MARKED_STALE_AFTER_COMPLETION', { stageInstanceId: stage.stageInstanceId }));
          }
          applyIntervention(intervention);
          emit('INTERVENTION_APPLIED', { interventionId: intervention.interventionId });
          if (state.lifecycle === LIFECYCLE.RUNNING && !command.deferExecution) await runLoop(command.maxSteps);
        } else {
          state.pendingInterventions.push(intervention);
        }
        return { ok: true, interventionId: intervention.interventionId };
      },

      resolveHumanDecision(command = {}) {
        if (!state.pendingHumanDecision) return { ok: false, code: 'NO_PENDING_DECISION' };
        const request = state.pendingHumanDecision;
        if (String(command.requestId || '') !== String(request.requestId || '')) return { ok: false, code: 'DECISION_REQUEST_STALE' };
        if (command.expectedCaseVersion != null && Number(command.expectedCaseVersion) !== state.caseVersion) return { ok: false, code: 'CASE_VERSION_STALE' };
        if (command.expectedPlanRevisionId != null && command.expectedPlanRevisionId !== revisions.getActive?.()?.revisionId) return { ok: false, code: 'REVISION_STALE' };
        if (Array.isArray(request.options) && !request.options.some((option) => option.id === command.optionId)) return { ok: false, code: 'DECISION_OPTION_INVALID' };
        emit('HUMAN_DECISION_RECORDED', { requestId: request.requestId, optionId: command.optionId });
        state.pendingHumanDecision = null;
        if (request.type === 'APPROVE_FINALIZATION' && command.optionId === 'finalize') {
          return finalize({ reason: 'MANUAL_STOP', finalizationMode: 'STATE_MAP', humanApprovalRequired: false });
        }
        return { ok: true };
      },

      // Plan revision activation (§17): delegates to revision store, then invalidates + replans.
      async activatePlanRevision(commandOrCommands, context = {}) {
        const activeStages = state.stages.filter((s) => ['pending', 'running', 'awaiting_participant'].includes(s.status));
        const result = revisions.submit(commandOrCommands, { ...context, activeStages, stageHistory: state.stages });
        if (!result.ok) {
          emit('PLAN_REVISION_REJECTED', { code: result.code });
          return result;
        }
        emit('PLAN_REVISION_ACTIVATED', { revisionId: result.revision.revisionId, revisionNumber: result.revision.revisionNumber });
        for (const item of result.stageInvalidation) {
          const stage = state.stages.find((s) => s.stageInstanceId === item.stageInstanceId);
          if (!stage) continue;
          if (item.invalidation === 'CANCELLED' && stage.status === 'pending') {
            stage.status = 'cancelled';
            emit('STAGE_CANCELLED', { stageInstanceId: stage.stageInstanceId, reason: 'revision' });
          } else if (item.invalidation === 'STALE' && stage.status === 'pending') {
            stage.status = 'stale';
            stage.goalIds.forEach((goalId) => {
              const goal = state.openGoals.find((g) => g.goalId === goalId);
              if (goal && goal.status !== 'resolved') goal.status = 'open';
            });
            emit('STAGE_STALE', { stageInstanceId: stage.stageInstanceId, reason: 'revision' });
          } else if (stage.status === 'running' && item.invalidation !== 'UNCHANGED') {
            // Running stages follow the revision's runningStagePolicy (§17.2); default FINISH.
            emit('RUNNING_STAGE_POLICY_APPLIED', { stageInstanceId: stage.stageInstanceId, policy: result.runningStagePolicy });
            if (result.runningStagePolicy === 'CANCEL') { abortController?.abort?.('revision'); stage.status = 'cancelled'; }
            if (result.runningStagePolicy === 'IGNORE_RESULT') stage.ignoreResult = true;
          }
        }
        state.caseVersion += 1;
        if (state.lifecycle === LIFECYCLE.RUNNING && !context.deferExecution) await runLoop(context.maxSteps);
        return result;
      },

      // Recovery (§15.4): snapshot + replay; idempotent.
      async recoverRun(command = {}) {
        const snapshot = persistence.loadLatestSnapshot?.();
        if (snapshot) {
          state.runId = snapshot.runId;
          state.debateCase = clone(snapshot.debateCase);
          state.caseVersion = snapshot.caseVersion;
          state.stateMapVersion = snapshot.stateMapVersion;
          state.stateMap = clone(snapshot.stateMap || {});
          state.participantStatus = clone(snapshot.participantStatus || {});
          state.configuredParticipants = clone(snapshot.configuredParticipants || []);
          state.activeParticipants = clone(snapshot.activeParticipants || []);
          state.droppedParticipants = clone(snapshot.droppedParticipants || []);
          state.pendingHumanDecision = clone(snapshot.pendingHumanDecision || null);
          // Migration for snapshots written before participant collections existed.
          if (!state.configuredParticipants.length) initializeParticipants(state.debateCase?.participants);
          state.openGoals = clone(snapshot.openGoals);
          state.stages = clone(snapshot.stages || snapshot.activeStages);
          state.eventSequence = snapshot.eventSequence;
          state.totalStagesExecuted = snapshot.totalStagesExecuted || 0;
          state.stagnationSignals = clone(snapshot.stagnationSignals) || state.stagnationSignals;
          state.lifecycle = snapshot.runLifecycle;
          revisions.hydrate?.({ revisions: snapshot.revisions });
        } else if (command.runId) {
          state.runId = String(command.runId);
        } else {
          return { ok: false, code: 'NOTHING_TO_RECOVER' };
        }
        const replayed = persistence.loadEvents?.(snapshot?.eventSequence || 0) || [];
        for (const event of replayed) {
          // Event replay validation: sequence must be continuous (§19.2 fatal otherwise).
          if (event.eventSequence <= (snapshot?.eventSequence || 0)) continue;
          if (event.eventSequence !== state.eventSequence + 1 && state.eventSequence >= (snapshot?.eventSequence || 0)) {
            if (event.eventSequence > state.eventSequence + 1) return fatal('CORRUPTED_EVENT_SEQUENCE', { expected: state.eventSequence + 1, actual: event.eventSequence });
          }
          state.eventSequence = Math.max(state.eventSequence, event.eventSequence);
        }
        const leased = acquireLease();
        if (!leased.ok) return leased;
        emit('RUN_RECOVERED', { fromSnapshot: Boolean(snapshot), replayedEvents: replayed.length });
        if (!TERMINAL.has(state.lifecycle)) {
          if (state.lifecycle !== LIFECYCLE.PAUSED) {
            reconcile();
            state.lifecycle = LIFECYCLE.RUNNING;
            emit('RUN_RESUMED', {});
            if (!command.deferExecution) await runLoop(command.maxSteps);
          }
        }
        return { ok: true, lifecycle: state.lifecycle };
      },

      async finalizeRun(command = {}) {
        return finalize({
          reason: command.reason || 'MANUAL_STOP',
          finalizationMode: command.finalizationMode || 'STATE_MAP',
          humanApprovalRequired: false
        });
      },

      buildSnapshot,
      _internals: deps.exposeInternals ? { state, plannerInput, plannerTick, step, runLoop, reconcile, acquireLease, renewLease, assertLease, releaseLease } : undefined
    });
    return api;
  }

  const api = Object.freeze({ LIFECYCLE, createOrchestrator });
  root.DebateOrchestrator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

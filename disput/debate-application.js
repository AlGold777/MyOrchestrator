// Topology-neutral application boundary for Debate orchestration.
(function initDebateApplication(root) {
  'use strict';

  const RunStore = root.DebateRunStore || (typeof require === 'function' ? require('./debate-run-store') : null);
  const Protocols = root.DebateProtocols || (typeof require === 'function' ? require('./debate-protocols') : null);
  const ProtocolTransitionService = root.DebateProtocolTransitionService || (typeof require === 'function' ? require('./debate-protocol-transition-service') : null);
  const ExecutionContext = root.DebateExecutionContext || (typeof require === 'function' ? require('./debate-execution-context') : null);
  const PlanCompiler = root.DebatePlanCompiler || (typeof require === 'function' ? require('./debate-plan-compiler') : null);
  const EvolutionFlags = root.DisputEvolutionFlags || (typeof require === 'function' ? require('./disput-evolution-flags') : null);
  const Policies = root.DebatePolicies || (typeof require === 'function' ? require('./debate-policies') : null);
  const PlanRevision = root.DebatePlanRevision || (typeof require === 'function' ? require('./debate-plan-revision') : null);
  const Planner = root.DebatePlanner || (typeof require === 'function' ? require('./debate-planner') : null);
  const StageExecutor = root.DebateStageExecutor || (typeof require === 'function' ? require('./debate-stage-executor') : null);
  const Orchestrator = root.DebateOrchestrator || (typeof require === 'function' ? require('./debate-orchestrator') : null);

  const makeFallbackId = () => `debate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  function createApplication(options = {}) {
    const store = options.store || RunStore?.createStore?.();
    if (!store) throw new Error('DebateApplication requires DebateRunStore');
    const protocols = options.protocols || Protocols;
    const deps = Object.freeze({ ...(options.deps || {}) });
    const runners = { ...(options.runners || {}) };
    const execution = options.execution || ExecutionContext?.createExecutionContext?.({
      AbortController: deps.AbortController
    });
    if (!execution) throw new Error('DebateApplication requires DebateExecutionContext');

    const topologyOf = (value) => protocols?.topologyOf?.(value) || String(value || 'duel');
    const dispatch = (type, payload = {}) => store.dispatch({ type, payload });
    const event = RunStore?.EVENTS || {};
    const isCancellation = (error, signal) => error?.name === 'AbortError'
      || signal?.aborted === true
      || execution?.signal?.()?.aborted === true;
    const syncProtocolTransition = (topology, protocolState, type, reason) => {
      if (!protocolState || RunStore?.isTerminal?.(store.getState())) return protocolState;
      if (!ProtocolTransitionService?.applyProtocolTransition) {
        throw new Error('PROTOCOL_TRANSITION_SERVICE_UNAVAILABLE');
      }
      return ProtocolTransitionService.applyProtocolTransition({
        protocol: protocols?.getProtocol?.(topology),
        protocolState,
        event: { type, payload: { reason } },
        getProtocolRevision: () => store.getState()?.protocolRevision ?? null,
        syncState: (next, transitionReason, syncOptions = {}) => {
          dispatch(event.PROTOCOL_STATE_SYNCED, {
            protocolState: next,
            reason: transitionReason,
            protocolStatus: String(next.status || ''),
            ...(syncOptions.expectedProtocolRevision == null
              ? {}
              : { expectedProtocolRevision: Number(syncOptions.expectedProtocolRevision) })
          });
          return store.getState().protocolState;
        },
        reason: `APPLICATION_${type}`
      });
    };

    // --- Universal engine path (Roadmap Slices B–H, behind flags; legacy stays primary) ---
    let universal = null;
    let universalRevisions = null;
    const universalEnabled = () => options.universalEngine === true || EvolutionFlags?.enabled?.('universalEngine') === true;
    const universalModulesReady = () => Boolean(Policies && PlanRevision && Planner && StageExecutor && Orchestrator);

    function normalizeParticipants(config = {}) {
      const source = Array.isArray(config.participants) && config.participants.length
        ? config.participants
        : (Array.isArray(config.models) && config.models.length
          ? config.models
          : (Array.isArray(config.selectedModels) ? config.selectedModels : []));
      return source.map((entry) => typeof entry === 'string'
        ? { participantId: entry, type: 'llm', model: entry, capabilities: ['position', 'critique', 'response', 'verification', 'synthesis', 'audit'] }
        : { type: 'llm', capabilities: ['position', 'critique', 'response', 'verification', 'synthesis', 'audit'], ...entry, participantId: entry.participantId || entry.model });
    }

    // Universal Production Wiring Contract: when the flag is genuinely enabled (not a
    // test exercising dispatch/validation in isolation), every port the executor/
    // orchestrator need for a real semantic commit must be present. Without this gate,
    // missing commitStateDelta/extractArtifacts/proposeStateDelta silently degrade to
    // permissive built-in fallbacks (see debate-stage-executor.js, debate-orchestrator.js)
    // that report success without any real state change — the worst class of bug: a run
    // that looks completed but produced nothing. Tests opt out explicitly via
    // options.allowIncompleteWiring; production callers must wire all ports for real.
    function assertProductionWiringComplete(options, deps) {
      if (!universalEnabled() || options.allowIncompleteWiring) return;
      const missing = [];
      if (!options.stageExecutor) {
        if (!options.adapters?.llm && typeof deps.runModelBatch !== 'function') missing.push('runModelBatch');
        if (typeof deps.acceptResponse !== 'function') missing.push('acceptResponse');
        if (typeof (options.compilePrompt || deps.compilePrompt) !== 'function') missing.push('compilePrompt');
        if (typeof (options.extractArtifacts || deps.extractArtifacts) !== 'function') missing.push('extractArtifacts');
        if (typeof (options.proposeStateDelta || deps.proposeStateDelta) !== 'function') missing.push('proposeStateDelta');
      }
      if (typeof (options.commitStateDelta || deps.commitStateDelta) !== 'function') missing.push('commitStateDelta');
      if (typeof (options.projectStateMap || deps.projectStateMap) !== 'function') missing.push('projectStateMap');
      if (missing.length) {
        const error = new Error(`UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE: missing required production port(s): ${missing.join(', ')}`);
        error.code = 'UNIVERSAL_PRODUCTION_WIRING_INCOMPLETE';
        error.missingPorts = missing;
        throw error;
      }
    }

    function createUniversalRun(config = {}) {
      if (!universalModulesReady()) throw new Error('Universal engine modules are unavailable');
      assertProductionWiringComplete(options, deps);
      const policies = Policies.resolve(config.policies || {});
      const participants = normalizeParticipants(config);
      // Single validation contract shared with UI (Extraction Contract §18).
      const validation = Policies.validateConfiguration({ participants }, policies);
      if (!validation.valid) return { ok: false, code: 'CONFIGURATION_INVALID', validation };
      const runId = String(config.runId || deps.createId?.('debate') || makeFallbackId());
      // Slice B: DebateCase is created before the runtime starts.
      const debateCase = {
        caseId: runId,
        version: 1,
        topic: { title: String(config.topic || config.pipelineNameText || '') },
        problemSpec: config.problemSpec || null,
        taskContract: config.taskContract || null,
        constraints: Array.isArray(config.constraints) ? config.constraints.slice() : [],
        attachments: Array.isArray(config.attachments || config.attachmentsPayload) ? (config.attachments || config.attachmentsPayload).slice() : [],
        participants,
        artifacts: [], relations: [],
        openGoals: Array.isArray(config.openGoals) ? config.openGoals.slice() : participants.map((p, index) => ({
          goalId: `goal-position-${p.participantId}`,
          type: 'establish_position', targetArtifactIds: [], status: 'open',
          priority: 50, createdFromEventId: 'initial_configuration', createdAt: new Date().toISOString(), order: index
        })).slice(0, 1),
        sourceEvents: [],
        policies,
        lifecycle: 'created'
      };
      universalRevisions = PlanRevision.createRevisionStore({
        emit: (type, payload) => dispatch(event.TIMELINE_EVENT_RECORDED, { kind: type, ...payload }),
        validateDraft: options.validateRevisionDraft
      });
      const adapters = StageExecutor.createAdapterRegistry({
        human: StageExecutor.createHumanAdapter(),
        ...(typeof deps.runModelBatch === 'function' ? { llm: StageExecutor.createLlmAdapter({ runModelBatch: deps.runModelBatch }) } : {}),
        ...(options.adapters || {})
      });
      const executor = options.stageExecutor || StageExecutor.createStageExecutor({
        adapters,
        acceptResponse: deps.acceptResponse,
        compilePrompt: options.compilePrompt || deps.compilePrompt,
        repairPrompt: options.repairPrompt || deps.repairPrompt,
        extractArtifacts: options.extractArtifacts || deps.extractArtifacts,
        proposeStateDelta: options.proposeStateDelta || deps.proposeStateDelta,
        retryPolicy: policies.retry,
        emit: (type, payload) => dispatch(event.TIMELINE_EVENT_RECORDED, { kind: type, ...payload })
      });
      universal = Orchestrator.createOrchestrator({
        planner: options.planner || Planner.createPlanner(),
        executor,
        revisionStore: universalRevisions,
        persistence: options.persistence,
        commitStateDelta: options.commitStateDelta || deps.commitStateDelta,
        projectStateMap: options.projectStateMap || deps.projectStateMap,
        extractArtifacts: options.extractArtifacts || deps.extractArtifacts,
        proposeStateDelta: options.proposeStateDelta || deps.proposeStateDelta,
        AbortController: deps.AbortController,
        emit: (type, payload) => dispatch(event.TIMELINE_EVENT_RECORDED, { kind: type, ...payload }),
        exposeInternals: options.exposeInternals
      });
      return { ok: true, orchestrator: universal, debateCase, validation, runId };
    }

    const revisionCommand = (commandType, payload, meta = {}) => ({
      commandId: meta.commandId || `command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expectedRevisionId: meta.expectedRevisionId || universalRevisions?.getActive?.()?.revisionId,
      commandType,
      payload,
      createdBy: meta.createdBy || 'human',
      timestamp: new Date().toISOString()
    });

    const api = Object.freeze({
      getState: () => store.getState(),
      subscribe: (listener) => store.subscribe(listener),
      getExecutionContext: () => execution,
      // Universal engine surface (flag-gated).
      isUniversalEngineEnabled: universalEnabled,
      validateConfiguration(config = {}) {
        if (!Policies) throw new Error('DebatePolicies unavailable');
        return Policies.validateConfiguration({ participants: normalizeParticipants(config) }, Policies.resolve(config.policies || {}));
      },
      async startUniversal(config = {}) {
        const created = createUniversalRun(config);
        if (!created.ok) return created;
        const maxSteps = config.maxSteps ?? created.debateCase.policies?.budgets?.maxTotalStages;
        const started = await created.orchestrator.startRun({
          runId: created.runId, debateCase: created.debateCase,
          stateMap: config.stateMap, deferExecution: config.deferExecution, maxSteps
        });
        return { ...started, validation: created.validation, orchestrator: created.orchestrator };
      },
      getOrchestrator: () => universal,
      getActiveRevision: () => universalRevisions?.getActive?.() || null,
      insertStage: (stage, meta) => universal?.activatePlanRevision(revisionCommand('INSERT_STAGE', { stage, runningStagePolicy: meta?.runningStagePolicy }, meta), meta),
      removePlannedStage: (plannedStageId, meta) => universal?.activatePlanRevision(revisionCommand('REMOVE_PENDING_STAGE', { plannedStageId }, meta), meta),
      changeParticipant: (payload, meta) => universal?.activatePlanRevision(revisionCommand('CHANGE_PARTICIPANT', payload, meta), meta),
      changePolicy: (payload, meta) => universal?.activatePlanRevision(revisionCommand('CHANGE_EXECUTION_POLICY', payload, meta), meta),
      requestSynthesis: (payload, meta) => universal?.activatePlanRevision(revisionCommand('REQUEST_SYNTHESIS', payload || {}, meta), meta),
      requestAudit: (payload, meta) => universal?.activatePlanRevision(revisionCommand('REQUEST_AUDIT', payload || {}, meta), meta),
      insertHumanStage: (stage, meta) => universal?.activatePlanRevision(revisionCommand('INSERT_HUMAN_STAGE', { stage }, meta), meta),
      submitIntervention: (command) => universal?.submitIntervention(command),
      submitParticipantResponse: (command) => universal?.submitParticipantResponse(command),
      pauseRun: (command) => universal?.requestPause(command || {}),
      continueRun: (command) => universal?.requestContinue(command || {}),
      registerRunner(topology, runner) {
        runners[topologyOf(topology)] = runner;
        return api;
      },
      async start(config = {}) {
        if (universalEnabled() && universalModulesReady()) return api.startUniversal(config);
        const topology = topologyOf(config.topology || config.preset);
        const runner = runners[topology];
        if (!runner || typeof runner.start !== 'function') {
          if (typeof deps.legacyStart === 'function') return deps.legacyStart(config);
          throw new Error(`Debate runner is unavailable: ${topology}`);
        }
        const runId = String(config.runId || deps.createId?.('debate') || makeFallbackId());
        const executionPlan = config.executionPlan || PlanCompiler?.compile?.({
          ...config,
          runId,
          runPolicy: config.runPolicy || config.presetConfig?.runPolicy || config.preset?.runPolicy,
          roundLimit: config.presetConfig?.roundLimit,
          synthesizer: config.synthesizer
        });
        if (!executionPlan) throw new Error('Debate execution plan is unavailable');
        execution.begin(runId, config.execution);
        dispatch(event.START_REQUESTED, {
          runId,
          sessionId: config.sessionId,
          topology,
          preset: config.preset || null,
          executionPlan,
          config: config.persistedConfig || config,
          protocolState: config.protocolState || null
        });
        try {
          return await runner.start({
            ...config,
            executionPlan,
            auto: executionPlan.runPolicy === 'auto',
            synthesizer: executionPlan.synthesizer,
            runId,
            topology,
            store,
            protocols,
            execution,
            deps
          });
        } catch (error) {
          const cancelled = isCancellation(error, config.signal);
          const failedState = store.getState();
          const protocolState = failedState?.protocolState;
          const protocolEvent = cancelled ? 'CANCELLED' : 'FAILED';
          const reason = error?.message || String(error || (cancelled ? 'cancelled' : 'debate_failed'));
          if (protocolState) syncProtocolTransition(topology, protocolState, protocolEvent, reason);
          if (!RunStore?.isTerminal?.(store.getState())) {
            dispatch(cancelled ? event.CANCEL_REQUESTED : event.RUN_FAILED, { reason });
          }
          if (cancelled) {
            return Object.freeze({ ok: false, cancelled: true, runId, status: 'cancelled', reason });
          }
          throw error;
        }
      },
      startFromPage(...args) {
        if (typeof deps.startFromPage === 'function') return deps.startFromPage(...args);
        if (typeof deps.legacyStart === 'function') return deps.legacyStart(...args);
        return api.start(args[0] || {});
      },
      pause(reason = 'moderator_pause') {
        const runner = runners[topologyOf(store.getState()?.topology)];
        runner?.pause?.({ reason, store, execution, deps });
        dispatch(event.PAUSE_REQUESTED, { reason });
        return store.getState();
      },
      resume() {
        const runner = runners[topologyOf(store.getState()?.topology)];
        runner?.resume?.({ store, execution, deps });
        dispatch(event.RESUME_REQUESTED);
        return store.getState();
      },
      approveTurn(turn) {
        const resolved = execution.resolveApproval(turn);
        if (resolved) dispatch(event.APPROVAL_GRANTED, { turn });
        return resolved;
      },
      rejectTurn(reason) {
        return execution.rejectApproval(reason || new Error('Debate turn rejected'));
      },
      async cancel(reason = 'cancelled') {
        const state = store.getState();
        const topology = topologyOf(state?.topology);
        const runner = runners[topology];
        execution.abort(reason);
        await runner?.cancel?.({ reason, state, store, execution, deps });
        const protocolState = store.getState()?.protocolState;
        if (protocolState) syncProtocolTransition(topology, protocolState, 'CANCELLED', reason);
        if (!RunStore?.isTerminal?.(store.getState())) dispatch(event.CANCEL_REQUESTED, { reason });
        await deps.cancelTransport?.(state?.runId, reason);
        return store.getState();
      },
      recover(snapshot) {
        const recovered = RunStore?.hydrate?.(snapshot) || snapshot;
        store.replace(recovered);
        dispatch(event.TECHNICAL_PAUSE, { reason: 'page_recovered' });
        return store.getState();
      },
      dispose(reason = 'application_disposed') {
        execution.dispose(reason);
      }
    });

    return api;
  }

  const api = Object.freeze({ createApplication });
  root.DebateApplication = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

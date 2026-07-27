(async function runSemanticRecoveryFixture() {
  'use strict';
  const runId = 'browser-semantic-recovery';
  const resultNode = document.getElementById('result');
  const params = new URLSearchParams(location.search);
  const phase = params.get('phase') || 'start';
  const participantIds = ['alpha', 'beta', 'gamma', 'delta'];
  const caseStorage = {
    async get(key) { return { [key]: JSON.parse(localStorage.getItem(key) || 'null') }; },
    async set(values) { Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value))); },
    async remove(key) { localStorage.removeItem(key); }
  };
  const write = (value) => {
    resultNode.textContent = JSON.stringify(value);
    resultNode.dataset.status = value.ok ? 'ok' : 'error';
  };
  try {
    const persistence = DebateOrchestratorPersistence.createPersistence({ runId });
    const semanticStore = DebateCaseStore.createStore({ storage: caseStorage });
    const revisions = DebatePlanRevision.createRevisionStore({});
    const planner = {
      ruleSetVersion: 'browser-e2e-v1',
      evaluate(input) {
        return {
          decisionId: `browser-decision-${input.caseVersion}`,
          type: 'CREATE_STAGES',
          rationaleCode: 'BROWSER_E2E',
          inputCaseVersion: input.caseVersion,
          inputStateMapIdentity: {
            sourceCaseVersion: input.stateMap.sourceCaseVersion,
            projectorVersion: input.stateMap.projectorVersion
          },
          inputPlanRevisionId: input.activePlanRevisionId,
          proposedStages: [{
            proposedStageId: 'browser-stage', purpose: 'position',
            participantIds, goalIds: [], dispatchMode: 'parallel',
            completionMode: 'all'
          }]
        };
      }
    };
    const adapters = DebateStageExecutor.createAdapterRegistry({
      llm: {
        type: 'llm',
        async dispatch({ participant }) {
        const dispatchCount = Number(localStorage.getItem('browserSemanticDispatchCount') || 0) + 1;
        localStorage.setItem('browserSemanticDispatchCount', String(dispatchCount));
          return { status: 'received', text: `answer:${participant.participantId}` };
        }
      }
    });
    const executor = DebateStageExecutor.createStageExecutor({
      adapters,
      retryPolicy: { maxAttempts: 1, delayMs: 0 },
      extractArtifacts({ participant }) {
        return [{
          id: `browser-claim-${participant.participantId}`,
          type: 'claim', status: 'asserted',
          title: `Survives reload: ${participant.participantId}`,
          provenance: { source: 'browser-e2e', participantId: participant.participantId }
        }];
      },
      proposeStateDelta({ participant, artifacts, context }) {
        return {
          deltaId: `browser-delta-${participant.participantId}`,
          expectedCaseVersion: context.caseVersion,
          participantId: participant.participantId,
          artifacts
        };
      }
    });
    const orchestrator = DebateOrchestrator.createOrchestrator({
      planner, executor, revisionStore: revisions, persistence, semanticStore,
      projectStateMap: DebateArtifactPipeline.projectStateMap,
      ownerId: ['start', 'fence-leader'].includes(phase) ? 'browser-owner-a' : 'browser-owner-b'
    });
    if (phase === 'start' || phase === 'fence-leader') {
      persistence.clear();
      localStorage.removeItem('browserSemanticDispatchCount');
      await semanticStore.create({
        caseId: runId,
        participants: participantIds.map((participantId) => ({
          participantId, type: 'llm', capabilities: []
        }))
      });
      const started = await orchestrator.startRun({
        runId, debateCase: semanticStore.getState(),
        maxSteps: phase === 'start' ? 1 : undefined,
        deferExecution: phase === 'fence-leader'
      });
      if (phase === 'start') await orchestrator.requestPause({ requestedBy: 'browser-e2e' });
      const state = orchestrator.getState();
      write({
        ok: started.ok, phase, lifecycle: state.lifecycle,
        caseVersion: state.caseVersion,
        artifactIds: Object.keys(state.stateMap.artifacts || {}),
        sourceCaseVersion: state.stateMap.sourceCaseVersion,
        projectorVersion: state.stateMap.projectorVersion,
        dispatchCount: Number(localStorage.getItem('browserSemanticDispatchCount') || 0)
      });
    } else if (phase === 'recover') {
      await semanticStore.load(runId);
      const recovered = await orchestrator.recoverRun({ deferExecution: true });
      const continued = await orchestrator.requestContinue({ deferExecution: true });
      const state = orchestrator.getState();
      write({
        ok: recovered.ok && continued.ok, phase, lifecycle: state.lifecycle,
        caseVersion: state.caseVersion,
        artifactIds: Object.keys(state.stateMap.artifacts || {}),
        sourceCaseVersion: state.stateMap.sourceCaseVersion,
        projectorVersion: state.stateMap.projectorVersion,
        dispatchCount: Number(localStorage.getItem('browserSemanticDispatchCount') || 0),
        duplicateDispatch: Number(localStorage.getItem('browserSemanticDispatchCount') || 0) !== participantIds.length
      });
    } else if (phase === 'fence-contender') {
      await semanticStore.load(runId);
      const started = await orchestrator.startRun({ runId, debateCase: semanticStore.getState(), deferExecution: true });
      write({
        ok: started.ok === false && started.code === 'LEASE_HELD',
        phase, rejected: !started.ok, code: started.code,
        dispatchCount: Number(localStorage.getItem('browserSemanticDispatchCount') || 0)
      });
    }
  } catch (error) {
    write({ ok: false, phase, error: String(error?.stack || error) });
  }
})();

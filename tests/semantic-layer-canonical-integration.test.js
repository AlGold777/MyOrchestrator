const fs = require('fs');
const path = require('path');
const Application = require('../disput/debate-application');
const CaseStore = require('../disput/debate-case-store');
const Pipeline = require('../disput/debate-artifact-pipeline');
const Planner = require('../disput/debate-planner');

function createCanonicalRun(artifacts) {
  const semanticStore = CaseStore.createStore();
  const planner = {
    ruleSetVersion: 'semantic-test',
    evaluate(input) {
      return {
        decisionId: `decision-${input.caseVersion}`,
        type: 'CREATE_STAGES', rationaleCode: 'SEMANTIC_TEST',
        inputCaseVersion: input.caseVersion,
        inputStateMapIdentity: {
          sourceCaseVersion: input.stateMap.sourceCaseVersion,
          projectorVersion: input.stateMap.projectorVersion
        },
        inputPlanRevisionId: input.activePlanRevisionId,
        proposedStages: [{ proposedStageId: 'semantic-stage', purpose: 'position', participantIds: ['alpha'], goalIds: [] }]
      };
    }
  };
  const stageExecutor = {
    async execute(stage, context) {
      return {
        stageInstanceId: stage.stageInstanceId,
        executionStatus: 'completed', terminalFailures: [],
        proposedStateDeltas: [{ deltaId: 'semantic-delta', expectedCaseVersion: context.caseVersion, participantId: 'alpha', artifacts }]
      };
    }
  };
  const application = Application.createApplication({
    semanticStore, planner, stageExecutor,
    projectStateMap: Pipeline.projectStateMap,
    allowIncompleteWiring: true
  });
  return { application, semanticStore };
}

describe('semantic layer canonical production path', () => {
  test('SEM-A13 projects a loaded canonical case before the first Planner tick', async () => {
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: 'canonical-start-projection',
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }],
      artifacts: {
        existing: { id: 'existing', type: 'claim', status: 'asserted', title: 'Already persisted', provenance: { source: 'test' } }
      }
    });
    const observed = [];
    const planner = {
      ruleSetVersion: 'semantic-start-test',
      evaluate(input) {
        observed.push(input);
        return {
          decisionId: 'decision-start-projection', type: 'WAIT', rationaleCode: 'OBSERVED',
          inputCaseVersion: input.caseVersion,
          inputStateMapIdentity: {
            sourceCaseVersion: input.stateMap.sourceCaseVersion,
            projectorVersion: input.stateMap.projectorVersion
          },
          inputPlanRevisionId: input.activePlanRevisionId
        };
      }
    };
    const application = Application.createApplication({
      semanticStore, planner,
      stageExecutor: { execute: jest.fn() },
      projectStateMap: Pipeline.projectStateMap,
      allowIncompleteWiring: true
    });
    await application.start({
      runId: 'canonical-start-projection', models: ['alpha'],
      policies: { participants: { min: 1, max: 8 } }, maxSteps: 1
    });
    expect(observed[0].stateMap.claims).toEqual([expect.objectContaining({ id: 'existing' })]);
    expect(observed[0].stateMap).toMatchObject({
      sourceCaseVersion: semanticStore.getState().caseVersion,
      projectorVersion: 4
    });
  });

  test('first canonical delta starts at version zero and updates the projection', async () => {
    const artifact = { id: 'claim-1', type: 'claim', status: 'asserted', title: 'Claim', owner: 'alpha', provenance: { source: 'test' } };
    const { application, semanticStore } = createCanonicalRun([artifact]);
    const result = await application.start({ runId: 'canonical-first-delta', models: ['alpha'], policies: { participants: { min: 1, max: 8 } }, maxSteps: 1 });
    expect(result.ok).toBe(true);
    expect(semanticStore.getState().artifacts['claim-1']).toBeTruthy();
    expect(application.getOrchestrator().getState()).toMatchObject({ caseVersion: 1, stateMap: { claims: [expect.objectContaining({ id: 'claim-1' })] } });
  });

  test('multi-artifact delta commits once without correlation conflict or partial retry', async () => {
    const artifacts = [
      { id: 'claim-a', type: 'claim', status: 'asserted', title: 'A', owner: 'alpha', provenance: { source: 'test' } },
      { id: 'claim-b', type: 'claim', status: 'asserted', title: 'B', owner: 'alpha', provenance: { source: 'test' } }
    ];
    const { application, semanticStore } = createCanonicalRun(artifacts);
    await application.start({ runId: 'canonical-batch', models: ['alpha'], policies: { participants: { min: 1, max: 8 } }, maxSteps: 1 });
    const state = application.getOrchestrator().getState();
    expect(Object.keys(semanticStore.getState().artifacts).sort()).toEqual(['claim-a', 'claim-b']);
    expect(semanticStore.getState().caseVersion).toBe(2);
    expect(state.stateMap.claims).toHaveLength(2);
    expect(state.events.filter((event) => event.type === 'STATE_DELTA_REJECTED')).toHaveLength(0);
    expect(state.events.filter((event) => event.type === 'STATE_DELTA_PROPOSED')).toHaveLength(1);
  });

  test('mixed duplicate and changed batch reports each operation and remains meaningful', async () => {
    const semanticStore = CaseStore.createStore();
    const repeated = {
      id: 'claim-repeated', type: 'claim', status: 'asserted', title: 'Repeated',
      owner: 'alpha', provenance: { source: 'test' }
    };
    await semanticStore.create({
      caseId: 'canonical-mixed-batch',
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }]
    });
    await semanticStore.commit({
      expectedCaseVersion: 0,
      changes: [{
        kind: 'UPSERT_ARTIFACT',
        artifact: repeated,
        correlationId: 'mixed-delta:artifact:claim-repeated',
        actor: 'alpha'
      }]
    });
    const planner = {
      ruleSetVersion: 'mixed-batch-test',
      evaluate(input) {
        return {
          decisionId: 'decision-mixed-batch', type: 'CREATE_STAGES', rationaleCode: 'TEST',
          inputCaseVersion: input.caseVersion,
          inputStateMapIdentity: {
            sourceCaseVersion: input.stateMap.sourceCaseVersion,
            projectorVersion: input.stateMap.projectorVersion
          },
          inputPlanRevisionId: input.activePlanRevisionId,
          proposedStages: [{ proposedStageId: 'mixed-stage', purpose: 'position', participantIds: ['alpha'], goalIds: [] }]
        };
      }
    };
    const stageExecutor = {
      execute: async (stage, context) => ({
        stageInstanceId: stage.stageInstanceId,
        executionStatus: 'completed',
        terminalFailures: [],
        proposedStateDeltas: [{
          deltaId: 'mixed-delta',
          expectedCaseVersion: context.caseVersion,
          participantId: 'alpha',
          artifacts: [
            repeated,
            {
              id: 'claim-new', type: 'claim', status: 'asserted', title: 'New',
              owner: 'alpha', provenance: { source: 'test' }
            }
          ]
        }]
      })
    };
    const application = Application.createApplication({
      semanticStore, planner, stageExecutor,
      projectStateMap: Pipeline.projectStateMap,
      allowIncompleteWiring: true
    });
    await application.start({
      runId: 'canonical-mixed-batch',
      models: ['alpha'],
      policies: { participants: { min: 1, max: 8 } },
      maxSteps: 1
    });
    const state = application.getOrchestrator().getState();
    const report = state.events.find((event) => event.type === 'STATE_COMMIT_REPORTED').payload.report;
    expect(report).toMatchObject({ committed: true, changed: true, recoveryReplay: false });
    expect(report.operations).toEqual([
      expect.objectContaining({ artifactId: 'claim-repeated', duplicate: true, changed: false }),
      expect.objectContaining({ artifactId: 'claim-new', duplicate: false, changed: true })
    ]);
    expect(state.events.filter((event) => event.type === 'STATE_DELTA_APPLIED')).toHaveLength(1);
    expect(semanticStore.getState().caseVersion).toBe(2);
  });

  test('a new synthesis conclusion canonically supersedes the previous active conclusion', async () => {
    const semanticStore = CaseStore.createStore();
    await semanticStore.create({
      caseId: 'canonical-synthesis-lifecycle',
      participants: [{ participantId: 'alpha', type: 'llm', capabilities: [] }],
      artifacts: {
        old: { id: 'old', type: 'synthesis_conclusion', status: 'accepted', title: 'Old', provenance: { source: 'test' } }
      }
    });
    const planner = {
      ruleSetVersion: 'synthesis-lifecycle',
      evaluate(input) {
        return {
          decisionId: 'decision-synthesis-lifecycle', type: 'CREATE_STAGES', rationaleCode: 'TEST',
          inputCaseVersion: input.caseVersion,
          inputStateMapIdentity: {
            sourceCaseVersion: input.stateMap.sourceCaseVersion,
            projectorVersion: input.stateMap.projectorVersion
          },
          inputPlanRevisionId: input.activePlanRevisionId,
          proposedStages: [{ proposedStageId: 'synthesis', purpose: 'synthesis', participantIds: ['alpha'], goalIds: [] }]
        };
      }
    };
    const stageExecutor = {
      execute: async (stage, context) => ({
        stageInstanceId: stage.stageInstanceId, executionStatus: 'completed', terminalFailures: [],
        proposedStateDeltas: [{
          deltaId: 'new-synthesis', expectedCaseVersion: context.caseVersion, participantId: 'alpha',
          artifacts: [{ id: 'new', type: 'synthesis_conclusion', status: 'accepted', title: 'New', provenance: { source: 'test' } }]
        }]
      })
    };
    const application = Application.createApplication({
      semanticStore, planner, stageExecutor,
      projectStateMap: Pipeline.projectStateMap,
      allowIncompleteWiring: true
    });
    await application.start({
      runId: 'canonical-synthesis-lifecycle', models: ['alpha'],
      policies: { participants: { min: 1, max: 8 } }, maxSteps: 1
    });
    expect(semanticStore.getState().artifacts.old).toMatchObject({ status: 'superseded', supersededBy: 'new' });
    expect(application.getOrchestrator().getState().stateMap.finalArtifactIds).toEqual(['new']);
  });

  test('recorded contradiction and dissent are actionable and produce planner goals', () => {
    const map = Pipeline.projectStateMap({ caseId: 'actionable-case', artifacts: {
      claim: { id: 'claim', type: 'claim', status: 'asserted', title: 'Claim', provenance: { source: 'test' } },
      contradiction: { id: 'contradiction', type: 'contradiction', status: 'recorded', title: 'Contradiction', targetId: 'claim', provenance: { source: 'test' } },
      dissent: { id: 'dissent', type: 'dissent', status: 'recorded', title: 'Dissent', targetId: 'claim', provenance: { source: 'test' } }
    } });
    const goals = Planner.deriveGoals({ stateMap: map, openGoals: [], policies: {}, currentTime: 'now' });
    expect(map.version).toBe(4);
    expect(map.actionableContradictions).toHaveLength(1);
    expect(map.actionableDissent).toHaveLength(1);
    expect(goals.map((goal) => goal.type)).toEqual(expect.arrayContaining(['resolve_contradiction', 'examine_dissent']));
  });

  test('results human-action bridge uses the generated intervention id and shared semantic store', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(source).toContain('semanticStore: debateCaseStore');
    expect(source).toContain('decisionId: interventionId');
    expect(source).not.toContain('decisionId: `human:${at}`');
  });

  test('SEM-A12 persists ADD_CONSTRAINT canonically and survives store reload', async () => {
    const { application, semanticStore } = createCanonicalRun([]);
    await application.start({
      runId: 'canonical-constraint', models: ['alpha'],
      policies: { participants: { min: 1, max: 8 } }, deferExecution: true
    });
    const result = await application.getOrchestrator().submitIntervention({
      interventionId: 'constraint-iv',
      type: 'ADD_CONSTRAINT',
      payload: { constraint: { text: 'Use only primary sources' } },
      deferExecution: true
    });
    expect(result.ok).toBe(true);
    expect(semanticStore.getState().constraints).toEqual([
      expect.objectContaining({ constraintId: 'constraint-constraint-iv', text: 'Use only primary sources' })
    ]);
    const reloaded = CaseStore.createStore();
    await reloaded.load('canonical-constraint');
    expect(reloaded.getState().constraints[0]).toMatchObject({
      constraintId: 'constraint-constraint-iv', text: 'Use only primary sources'
    });
  });
});

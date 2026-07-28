const Planner = require('../disput/debate-planner');
const Policies = require('../disput/debate-policies');

const input = (resource, limit = 1) => {
  const metrics = {
    stages: { totalStagesExecuted: limit },
    model_calls: { totalModelCalls: limit },
    human_waits: { humanWaits: limit },
    retry_attempts: { retryAttempts: limit },
    context_tokens: { contextTokens: limit },
    corrections: { totalCorrections: limit },
    estimated_cost: { estimatedCost: limit },
    elapsed_time_ms: { elapsedTimeMs: limit }
  }[resource];
  const policyKey = {
    stages: 'maxTotalStages',
    model_calls: 'maxModelCalls',
    human_waits: 'maxHumanWaits',
    retry_attempts: 'maxRetryAttempts',
    context_tokens: 'maxContextTokens',
    corrections: 'maxCorrections',
    estimated_cost: 'maxEstimatedCost',
    elapsed_time_ms: 'maxElapsedTimeMs'
  }[resource];
  return {
    runId: `budget-${resource}`, caseVersion: 0,
    activePlanRevisionId: 'rev-budget',
    activePlanRevision: { revisionId: 'rev-budget', plannedStages: [] },
    stateMap: { claims: [{ id: 'c1', status: 'asserted' }], projectorVersion: 4, sourceCaseVersion: 0 },
    openGoals: [{ goalId: 'g1', type: 'verify_claim', targetArtifactIds: ['c1'], status: 'open', required: true, priority: 10 }],
    activeStages: [], stageHistory: [],
    availableParticipants: [{ participantId: 'alpha', available: true, capabilities: [], capacity: 1 }],
    participantCapabilities: { alpha: [] },
    policies: Policies.resolve({
      finalization: { mode: 'on_budget_exhaustion' },
      budgets: { [policyKey]: limit }
    }),
    budgets: { [policyKey]: limit },
    currentTime: '2026-07-24T00:00:00.000Z',
    ...metrics
  };
};

describe('P1-G1 resource limits and typed degradation evidence', () => {
  test.each([
    'stages', 'model_calls', 'human_waits', 'retry_attempts',
    'context_tokens', 'corrections', 'estimated_cost', 'elapsed_time_ms'
  ])('%s exhaustion finalizes with typed evidence', (resource) => {
    const decision = Planner.evaluate(input(resource));
    expect(decision).toMatchObject({
      type: 'FINALIZE',
      rationaleCode: 'BUDGET_EXHAUSTED',
      finalizationDecision: {
        reason: 'BUDGET_EXHAUSTED',
        degradationEvidence: [expect.objectContaining({
          type: 'budget_exhausted', resource, actual: 1, limit: 1, severity: 'limitation'
        })]
      }
    });
  });

  test('manual policy requests a human decision but retains typed degradation context', () => {
    const manual = input('context_tokens');
    manual.policies = Policies.resolve({
      finalization: { mode: 'manual' },
      budgets: { maxContextTokens: 1 }
    });
    const decision = Planner.evaluate(manual);
    expect(decision).toMatchObject({
      type: 'REQUEST_HUMAN_DECISION',
      rationaleCode: 'BUDGET_EXHAUSTED_MANUAL_POLICY'
    });
  });

  test('configuration rejects negative or non-finite budget limits', () => {
    const verdict = Policies.validateConfiguration(
      { participants: [{ participantId: 'alpha' }] },
      Policies.resolve({ budgets: { maxCorrections: -1, maxContextTokens: 'not-a-number' } })
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.filter((error) => error.code === 'BUDGET_LIMIT_INVALID')).toHaveLength(2);
  });
});

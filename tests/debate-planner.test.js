const Planner = require('../disput/debate-planner');
const Policies = require('../disput/debate-policies');

const baseInput = (overrides = {}) => ({
  runId: 'run-1',
  caseVersion: 1,
  activePlanRevisionId: 'rev-0',
  debateCase: {},
  stateMap: {},
  openGoals: [],
  resolvedGoals: [],
  activeStages: [],
  availableParticipants: [
    { participantId: 'alpha', provider: 'p1', capabilities: [], available: true, capacity: 2 },
    { participantId: 'beta', provider: 'p2', capabilities: [], available: true, capacity: 2 }
  ],
  participantCapabilities: {},
  policies: Policies.defaults(),
  budgets: { maxStagesPerTick: 2, maxConcurrentStages: 4 },
  ruleSetVersion: '1.0.0',
  currentTime: '2026-07-22T00:00:00.000Z',
  ...overrides
});

const goal = (overrides = {}) => ({
  goalId: 'g1', type: 'verify_claim', targetArtifactIds: ['claim:1'], status: 'open',
  priority: 50, createdFromEventId: 'e1', createdAt: '2026-07-22T00:00:00.000Z', ...overrides
});

describe('Planner Contract v1.0 — determinism', () => {
  test('identical input produces identical decision (§3.3)', () => {
    const input = baseInput({ openGoals: [goal()] });
    const a = Planner.evaluate(input);
    const b = Planner.evaluate(baseInput({ openGoals: [goal()] }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('decision is immutable and carries full version metadata (§23)', () => {
    const decision = Planner.evaluate(baseInput({ openGoals: [goal()] }));
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.ruleSetVersion).toBe('1.0.0');
    expect(decision.plannerAlgorithmVersion).toBeTruthy();
    expect(decision.utilityFormulaVersion).toBeTruthy();
    expect(decision.inputCaseVersion).toBe(1);
    expect(decision.inputPlanRevisionId).toBe('rev-0');
  });

  test('exact tie is resolved lexicographically by goalId (§9.4)', () => {
    const input = baseInput({
      budgets: { maxStagesPerTick: 1 },
      openGoals: [
        goal({ goalId: 'z-goal', targetArtifactIds: ['claim:z'] }),
        goal({ goalId: 'a-goal', targetArtifactIds: ['claim:a'] })
      ]
    });
    const decision = Planner.evaluate(input);
    expect(decision.selectedGoalIds).toEqual(['a-goal']);
  });
});

describe('Planner — derived goals (§7)', () => {
  test('derives goals from state map conditions', () => {
    const input = baseInput({
      stateMap: {
        claims: [{ id: 'c1', status: 'unsupported' }, { id: 'c2', status: 'supported', revision: { status: 'untested' } }],
        evidence: [{ id: 'e1', status: 'disputed' }],
        objections: [{ id: 'o1', severity: 'blocking', status: 'unresolved' }],
        contradictions: [{ id: 'x1', status: 'open' }],
        questions: [{ id: 'q1', status: 'open' }],
        dissent: [{ id: 'd1', status: 'unexamined' }]
      }
    });
    const derived = Planner.deriveGoals(input);
    const types = derived.map((g) => g.type);
    expect(types).toEqual(expect.arrayContaining([
      'verify_claim', 'test_revision', 'verify_evidence', 'resolve_objection',
      'resolve_contradiction', 'answer_open_question', 'examine_dissent'
    ]));
  });

  test('a resolved derived goal is re-derived before finalization while its condition remains true', () => {
    const input = baseInput({
      openGoals: [{
        goalId: 'derived:verify_claim:c1',
        type: 'verify_claim',
        targetArtifactIds: ['c1'],
        status: 'resolved',
        derived: true
      }],
      stateMap: { claims: [{ id: 'c1', status: 'unsupported' }] }
    });
    const decision = Planner.evaluate(input);
    expect(decision.type).toBe('CREATE_STAGES');
    expect(decision.selectedGoalIds).toContain('derived:verify_claim:c1');
  });

  test('derived condition evaluator reuses derivation and rejects non-derived goal types', () => {
    const input = baseInput({ stateMap: { claims: [{ id: 'c1', status: 'unsupported' }] } });
    expect(Planner.evaluateDerivedGoalCondition({
      goalId: 'derived:verify_claim:c1', type: 'verify_claim', targetArtifactIds: ['c1'], derived: true
    }, input)).toMatchObject({ evaluable: true, active: true });
    expect(Planner.evaluateDerivedGoalCondition({
      goalId: 'manual:produce', type: 'produce_synthesis', targetArtifactIds: []
    }, input)).toMatchObject({ evaluable: false, active: null });
  });

  test('context pressure derives compact_context goal (§20)', () => {
    const derived = Planner.deriveGoals(baseInput({ stateMap: { contextPressure: 0.95 } }));
    expect(derived.map((g) => g.type)).toContain('compact_context');
  });

  test('synthesis readiness requires no blockers and policy permission (§18)', () => {
    const ready = Planner.deriveGoals(baseInput({ stateMap: { claims: [{ id: 'c1', status: 'supported' }] } }));
    expect(ready.map((g) => g.type)).toContain('produce_synthesis');
    const blocked = Planner.deriveGoals(baseInput({
      stateMap: { claims: [{ id: 'c1', status: 'supported' }], objections: [{ id: 'o1', severity: 'blocking', status: 'unresolved' }] }
    }));
    expect(blocked.map((g) => g.type)).not.toContain('produce_synthesis');
    const forbidden = Planner.deriveGoals(baseInput({
      stateMap: { claims: [{ id: 'c1', status: 'supported' }] },
      policies: Policies.resolve({ finalization: { synthesis: 'none' } })
    }));
    expect(forbidden.map((g) => g.type)).not.toContain('produce_synthesis');
  });

  test('explicit synthesis stage suppresses the goal-derived synthesis path', () => {
    const derived = Planner.deriveGoals(baseInput({
      activePlanRevision: {
        plannedStages: [{ plannedStageId: 'final-synthesis', purpose: 'synthesis', status: 'pending' }]
      },
      stateMap: { claims: [{ id: 'c1', status: 'supported' }] }
    }));
    expect(derived.map((g) => g.type)).not.toContain('produce_synthesis');
  });

  test('audit goal derives only when synthesis exists without valid audit (§19)', () => {
    const derived = Planner.deriveGoals(baseInput({
      stateMap: { synthesisArtifactId: 'syn-1' },
      policies: Policies.resolve({ finalization: { audit: 'required' } })
    }));
    expect(derived.map((g) => g.type)).toContain('audit_output');
  });

  test('failed audit derives synthesis correction instead of another audit', () => {
    const derived = Planner.deriveGoals(baseInput({
      stateMap: {
        synthesisArtifactId: 'syn-1', currentSynthesisAuditId: 'audit-1',
        currentSynthesisAuditVerdict: 'issues_found', validAuditArtifactId: ''
      },
      policies: Policies.resolve({ finalization: { audit: 'required' } })
    }));
    expect(derived).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'correct_synthesis', targetArtifactIds: ['syn-1', 'audit-1'] })
    ]));
    expect(derived.map((g) => g.type)).not.toContain('audit_output');
  });

  test('goal deduplication against open goals and active stages (§6.5)', () => {
    const candidates = [
      { goalId: 'derived:verify_claim:c1', type: 'verify_claim', targetArtifactIds: ['c1'] },
      { goalId: 'derived:verify_claim:c2', type: 'verify_claim', targetArtifactIds: ['c2'] }
    ];
    const open = [{ goalId: 'g-old', type: 'verify_claim', targetArtifactIds: ['c1'], status: 'in_progress' }];
    const stages = [{ goalIds: ['derived:verify_claim:c2'] }];
    expect(Planner.dedupeGoals(candidates, open, stages)).toHaveLength(0);
  });
});

describe('Planner — selection, conflicts, participants', () => {
  test('final planned synthesis waits for ordinary goals, then preserves the assigned participant', () => {
    const plannedStage = {
      plannedStageId: 'final-synthesis',
      purpose: 'synthesis',
      status: 'pending',
      participantIds: ['beta'],
      activationPolicy: 'finalization_ready',
      outputIntent: 'candidate_final',
      terminalPolicy: 'eligible_for_finalization'
    };
    const activePlanRevision = { plannedStages: [plannedStage], metadata: {} };
    const before = Planner.evaluate(baseInput({
      activePlanRevision,
      openGoals: [goal({ type: 'establish_position', targetArtifactIds: [] })]
    }));
    expect(before.proposedStages[0].plannedStageId).toBeUndefined();
    expect(before.proposedStages[0].purpose).toBe('position');

    const ready = Planner.evaluate(baseInput({ activePlanRevision, openGoals: [] }));
    expect(ready.type).toBe('CREATE_STAGES');
    expect(ready.rationaleCode).toBe('PLANNED_STAGE_READY');
    expect(ready.proposedStages[0]).toMatchObject({
      plannedStageId: 'final-synthesis',
      purpose: 'synthesis',
      participantIds: ['beta'],
      outputIntent: 'candidate_final',
      terminalPolicy: 'eligible_for_finalization',
      participantSelectionRationale: 'PLAN_REVISION_ASSIGNMENT'
    });
  });

  test('planned stage never silently reassigns an unavailable participant', () => {
    const decision = Planner.evaluate(baseInput({
      activePlanRevision: {
        metadata: {},
        plannedStages: [{
          plannedStageId: 'final-synthesis', purpose: 'synthesis', status: 'pending',
          participantIds: ['missing'], activationPolicy: 'immediate'
        }]
      }
    }));
    expect(decision.type).toBe('WAIT');
    expect(decision.rationaleCode).toBe('PLANNED_STAGE_PARTICIPANT_UNAVAILABLE');
    expect(decision.suppressedRules[0]).toMatchObject({
      plannedStageId: 'final-synthesis',
      participantId: 'missing'
    });
  });

  test('completed plannedStageId is not executed twice', () => {
    const decision = Planner.evaluate(baseInput({
      activePlanRevision: {
        metadata: {},
        plannedStages: [{
          plannedStageId: 'final-synthesis', purpose: 'synthesis', status: 'pending',
          participantIds: ['alpha'], activationPolicy: 'immediate'
        }]
      },
      stageHistory: [{ plannedStageId: 'final-synthesis', status: 'completed' }]
    }));
    expect(decision.type).toBe('NO_OP');
    expect(decision.rationaleCode).toBe('AWAITING_MANUAL_FINALIZATION');
  });

  test('CREATE_STAGES has utility breakdown and fired rules for every selected goal (§9.3)', () => {
    const decision = Planner.evaluate(baseInput({ openGoals: [goal()] }));
    expect(decision.type).toBe('CREATE_STAGES');
    expect(decision.utilityBreakdown).toHaveLength(1);
    expect(decision.utilityBreakdown[0]).toMatchObject({ goalId: 'g1' });
    expect(decision.utilityBreakdown[0].total).toEqual(expect.any(Number));
    expect(decision.firedRules[0].targetGoalIds).toEqual(['g1']);
    expect(decision.proposedStages[0].purpose).toBe('verification');
  });

  test('blocker outranks non-blocker (§26.4)', () => {
    const decision = Planner.evaluate(baseInput({
      budgets: { maxStagesPerTick: 1 },
      openGoals: [
        goal({ goalId: 'g-verify', type: 'verify_claim', priority: 50 }),
        goal({ goalId: 'g-objection', type: 'resolve_objection', priority: 50, targetArtifactIds: ['o1'] })
      ]
    }));
    expect(decision.selectedGoalIds).toEqual(['g-objection']);
    const suppressedIds = decision.suppressedRules.flatMap((s) => s.targetGoalIds);
    expect(suppressedIds).toContain('g-verify');
  });

  test('artifact conflict serializes goals; compatible goals run in parallel (§10)', () => {
    const conflicting = Planner.evaluate(baseInput({
      openGoals: [
        goal({ goalId: 'g1', targetArtifactIds: ['c1'] }),
        goal({ goalId: 'g2', type: 'resolve_objection', targetArtifactIds: ['c1'] })
      ]
    }));
    expect(conflicting.selectedGoalIds).toHaveLength(1);
    const compatible = Planner.evaluate(baseInput({
      openGoals: [
        goal({ goalId: 'g1', targetArtifactIds: ['c1'] }),
        goal({ goalId: 'g2', targetArtifactIds: ['c2'] })
      ]
    }));
    expect(compatible.selectedGoalIds).toHaveLength(2);
  });

  test('dependency ordering suppresses dependent goal (§10.4)', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [
        goal({ goalId: 'g-a' }),
        goal({ goalId: 'g-b', targetArtifactIds: ['c2'], blockedByGoalIds: ['g-a'] })
      ]
    }));
    expect(decision.selectedGoalIds).toEqual(['g-a']);
    expect(decision.suppressedRules.find((s) => s.targetGoalIds.includes('g-b')).suppressionReason).toBe('DEPENDENCY_NOT_READY');
  });

  test('independent verifier preferred over artifact author (§12.3)', () => {
    const decision = Planner.evaluate(baseInput({
      stateMap: { artifactAuthors: { 'claim:1': 'alpha' } },
      openGoals: [goal()]
    }));
    expect(decision.proposedStages[0].participantIds).toEqual(['beta']);
  });

  test('degraded independence is marked when only the author remains (§12.4)', () => {
    const decision = Planner.evaluate(baseInput({
      availableParticipants: [{ participantId: 'alpha', available: true, capacity: 2 }],
      stateMap: { artifactAuthors: { 'claim:1': 'alpha' } },
      openGoals: [goal()]
    }));
    expect(decision.proposedStages[0].degradedIndependence).toBe(true);
    expect(decision.proposedStages[0].participantSelectionRationale).toBe('DEGRADED_INDEPENDENCE');
  });

  test('participant capacity is enforced (§12.6)', () => {
    const decision = Planner.evaluate(baseInput({
      availableParticipants: [{ participantId: 'alpha', available: true, capacity: 1 }],
      activeStages: [{ stageInstanceId: 's1', status: 'running', participants: ['alpha'], goalIds: [] }],
      openGoals: [goal()]
    }));
    expect(decision.type).toBe('WAIT');
    expect(decision.suppressedRules[0].suppressionReason).toBe('PARTICIPANT_UNAVAILABLE');
  });

  test('required capability filters participants (§12.2)', () => {
    const decision = Planner.evaluate(baseInput({
      availableParticipants: [
        { participantId: 'alpha', capabilities: ['synthesis'], available: true, capacity: 1 },
        { participantId: 'beta', capabilities: [], available: true, capacity: 1 }
      ],
      openGoals: [goal({ requiredCapabilities: ['synthesis'], targetArtifactIds: [] })]
    }));
    expect(decision.proposedStages[0].participantIds).toEqual(['alpha']);
  });
});

describe('Planner — human, stagnation, budgets, finalization', () => {
  test('request_human_judgment goal yields blocking REQUEST_HUMAN_DECISION without stages (§13.3)', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [goal({ goalId: 'g-h', type: 'request_human_judgment', targetArtifactIds: [] }), goal({ goalId: 'g2' })]
    }));
    expect(decision.type).toBe('REQUEST_HUMAN_DECISION');
    expect(decision.humanDecisionRequest.blocking).toBe(true);
    expect(decision.proposedStages).toBeUndefined();
  });

  test('stagnation with auto policy finalizes; manual policy asks human (§14, §17)', () => {
    const stagnant = {
      stagnationSignals: { consecutiveNoStateDelta: 5, unchangedStateMapCount: 5, repeatedActionCount: 5 },
      recentActionFingerprints: ['verify_claim|claim:1'],
      openGoals: [goal()]
    };
    const auto = Planner.evaluate(baseInput({ ...stagnant, policies: Policies.resolve({ finalization: { mode: 'on_stagnation' } }) }));
    expect(auto.type).toBe('FINALIZE');
    expect(auto.finalizationDecision.reason).toBe('STAGNATION');
    const manual = Planner.evaluate(baseInput({ ...stagnant, policies: Policies.resolve({ finalization: { mode: 'manual' } }) }));
    expect(manual.type).toBe('REQUEST_HUMAN_DECISION');
  });

  test('budget exhaustion finalizes without synthesis (§16.3, §17.4)', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [goal()],
      budgets: { maxTotalStages: 3 },
      totalStagesExecuted: 3,
      policies: Policies.resolve({ finalization: { mode: 'on_budget_exhaustion' } })
    }));
    expect(decision.type).toBe('FINALIZE');
    expect(decision.finalizationDecision.reason).toBe('BUDGET_EXHAUSTED');
    expect(['STATE_MAP', 'ARTIFACTS_ONLY']).toContain(decision.finalizationDecision.finalizationMode);
  });

  test('no actionable goals with resolved requirements finalizes without synthesis (§17.4)', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [goal({ status: 'resolved' })],
      policies: Policies.resolve({ finalization: { mode: 'after_required_goals' } })
    }));
    expect(decision.type).toBe('FINALIZE');
    expect(decision.finalizationDecision.finalizationMode).toBe('ARTIFACTS_ONLY');
  });

  test('unresolved required goal blocks auto finalization (§17.5)', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [goal({ status: 'blocked', required: true })],
      policies: Policies.resolve({ finalization: { mode: 'after_required_goals' } })
    }));
    expect(decision.type).toBe('NO_OP');
    expect(decision.rationaleCode).toBe('REQUIRED_GOALS_BLOCKED');
  });

  test('WAIT while stages in flight and nothing actionable (§21.1)', () => {
    const decision = Planner.evaluate(baseInput({
      activeStages: [{ stageInstanceId: 's1', status: 'running', participants: ['alpha'], goalIds: ['g1'] }],
      openGoals: [goal({ status: 'in_progress' })]
    }));
    expect(decision.type).toBe('WAIT');
  });

  test('maxStagesPerTick caps selection with BUDGET_EXCEEDED suppression (§10.3)', () => {
    const decision = Planner.evaluate(baseInput({
      budgets: { maxStagesPerTick: 1, maxConcurrentStages: 10 },
      openGoals: [goal({ goalId: 'g1', targetArtifactIds: ['c1'] }), goal({ goalId: 'g2', targetArtifactIds: ['c2'] })]
    }));
    expect(decision.selectedGoalIds).toHaveLength(1);
    expect(decision.suppressedRules.some((s) => s.suppressionReason === 'BUDGET_EXCEEDED')).toBe(true);
  });

  test('cancelled goals from revision metadata are excluded', () => {
    const decision = Planner.evaluate(baseInput({
      openGoals: [goal()],
      activePlanRevision: { metadata: { cancelledGoalIds: ['g1'] } }
    }));
    expect(decision.consideredGoalIds).not.toContain('g1');
  });
});

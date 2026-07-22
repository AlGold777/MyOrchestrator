const Types = require('../disput/debate-stage-types');
const Validator = require('../disput/debate-plan-validator');
const Compiler = require('../disput/debate-plan-compiler');

const roundPlan = (count) => Array.from({ length: count }, (_, index) => ({
  round: index + 1,
  outputs: [`artifact_${index + 1}`]
}));

describe('DebatePlanCompiler', () => {
  test('Duel Verdict compiles the exact visible and service-stage trace', () => {
    const plan = Compiler.compile({
      runId: 'duel-1',
      topology: 'duel',
      runPolicy: 'auto',
      forceNewTabs: true,
      scenario: { modelA: 'Le Chat', modelB: 'Perplexity' },
      synthesizer: 'Claude',
      presetConfig: { presetId: 'DUEL_STANDARD', topology: 'duel', roundLimit: 3, roundPlan: roundPlan(3) }
    });

    expect(plan.runPolicy).toBe('auto');
    expect(plan.stages.map((stage) => stage.stageId)).toEqual([
      'r1:openings', 'r1:filter',
      'r2:turn:1', 'r2:turn:2', 'r2:filter',
      'r3:turn:1', 'r3:turn:2', 'r3:filter',
      'final:words', 'final:synthesis'
    ]);
    expect(plan.stages[0].tabPolicy).toBe(Types.TAB_POLICIES.CREATE);
    expect(plan.stages.slice(1).every((stage) => stage.tabPolicy !== Types.TAB_POLICIES.CREATE)).toBe(true);
    expect(plan.stages.find((stage) => stage.stageId === 'r1:filter')).toMatchObject({
      visibility: Types.VISIBILITY.SYSTEM,
      participants: ['Claude']
    });
    expect(plan.stages.filter((stage) => stage.kind === Types.KINDS.ROUND_FILTER)
      .every((stage) => stage.participants.length === 1 && stage.participants[0] === 'Claude')).toBe(true);
    expect(plan.stages.find((stage) => stage.kind === Types.KINDS.FINAL_SYNTHESIS).participants).toEqual(['Claude']);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.stages)).toBe(true);
    expect(Validator.validate(plan)).toEqual({ ok: true, errors: [] });
  });

  test('Triad Red Team freezes manual continuation and schedules stage roles', () => {
    const plan = Compiler.compile({
      runId: 'triad-1',
      topology: 'triad',
      runPolicy: 'manual',
      selectedModels: ['GPT', 'Gemini', 'Perplexity'],
      synthesizer: 'Claude',
      presetConfig: {
        presetId: 'TRIAD_STANDARD', topology: 'triad', roundLimit: 4,
        roundPlan: [
          { round: 1, outputs: ['proposal', 'attack_surface_map'] },
          { round: 2, outputs: ['counterexamples'] },
          { round: 3, outputs: ['patch_map'] },
          { round: 4, outputs: ['independent_retest', 'retest_report'] }
        ],
        roles: ['critical', 'critical', 'meta'],
        stageRoles: { 1: ['meta', 'critical', 'critical'], 2: ['critical', 'critical'], 3: ['meta'], 4: ['critical'] }
      }
    });

    expect(plan.stages.map((stage) => stage.stageId)).toEqual([
      'r1:wave', 'r1:filter', 'r2:wave', 'r2:filter',
      'r3:wave', 'r3:filter', 'r4:wave', 'r4:filter',
      'final:words', 'final:synthesis'
    ]);
    expect(plan.stages.find((stage) => stage.stageId === 'r2:wave').continuation).toBe(Types.CONTINUATION.APPROVAL);
    expect(plan.stages.find((stage) => stage.stageId === 'r2:wave').participants).toEqual(['GPT', 'Gemini']);
    expect(plan.stages.find((stage) => stage.stageId === 'r3:wave').participants).toEqual(['Perplexity']);
    expect(plan.stages.find((stage) => stage.stageId === 'r4:wave').participants).toEqual(['Gemini']);
    expect(plan.stages.find((stage) => stage.stageId === 'final:synthesis').outputs)
      .toEqual(['final:residual_risk_ranking', 'final:red_team_verdict']);
    expect(plan.stages.at(-1)).toMatchObject({
      kind: Types.KINDS.FINAL_SYNTHESIS,
      participants: ['Claude'],
      nextStageId: null
    });
    expect(Validator.validate(plan).warnings || []).not.toContain('retest_not_independent');
  });

  test('no audit stage created — auditor selector removed, audit goes through Planner/StageExecutor', () => {
    const plan = Compiler.compile({
      runId: 'triad-audit', topology: 'triad', runPolicy: 'auto',
      selectedModels: ['A', 'B', 'C'], synthesizer: 'S', problemSpec: { taskType: 'red_team' },
      presetConfig: {
        presetId: 'TRIAD_STANDARD', topology: 'triad', roundLimit: 1,
        roundPlan: roundPlan(1), synthesisAudit: 'required'
      }
    });
    expect(plan.stages.some((stage) => stage.stageId === 'final:audit')).toBe(false);
  });

  test('Multi Red Team schedules every repeated critical role', () => {
    const plan = Compiler.compile({
      runId: 'multi-red-team', topology: 'multi', runPolicy: 'auto',
      selectedModels: ['A', 'B', 'C', 'D'], synthesizer: 'C',
      presetConfig: {
        presetId: 'MULTI_RED_TEAM', topology: 'multi', roundLimit: 4,
        roles: ['critical', 'critical', 'meta'],
        stageRoles: { 1: ['meta', 'critical', 'critical'], 2: ['critical', 'critical'], 3: ['meta'], 4: ['critical', 'critical'] },
        roundPlan: [
          { round: 1, outputs: ['proposal', 'attack_surface_map'] },
          { round: 2, outputs: ['counterexamples', 'failure_modes'] },
          { round: 3, outputs: ['patch_map'] },
          { round: 4, outputs: ['independent_retest', 'retest_report'] }
        ]
      }
    });
    expect(plan.roles.D).toBe('critical');
    expect(Compiler.stageById(plan, 'r1:wave').participants).toEqual(['C', 'A', 'B', 'D']);
    expect(Compiler.stageById(plan, 'r4:wave').participants.slice().sort()).toEqual(['A', 'B', 'D']);
    expect(Compiler.stageById(plan, 'final:synthesis').outputs)
      .toEqual(['final:residual_risk_ranking', 'final:red_team_verdict']);
    expect(Validator.validate(plan).warnings || []).not.toContain('retest_not_independent');
  });

  test('FreeTalk compiles a trigger loop without a fixed round schedule', () => {
    const plan = Compiler.compile({
      runId: 'free-talk-1', topology: 'free_talk', runPolicy: 'auto',
      selectedModels: ['A', 'B', 'C', 'D'], synthesizer: 'A',
      presetConfig: { presetId: 'FREE_TALK_MVP', topology: 'free_talk', roundLimit: null }
    });
    expect(plan.participants).toEqual(['A', 'B', 'C', 'D']);
    expect(plan.stages.map((stage) => stage.stageId)).toEqual([
      'free-talk:positions', 'free-talk:trigger-loop', 'final:synthesis'
    ]);
    expect(Compiler.stageById(plan, 'free-talk:trigger-loop')).toMatchObject({
      kind: Types.KINDS.DYNAMIC_ACTION,
      completionPolicy: 'any_answer',
      failurePolicy: 'skip_stage'
    });
    expect(Validator.validate(plan)).toEqual({ ok: true, errors: [] });
  });

  test('allows no synthesis and migrates legacy literal auto to None', () => {
    const base = {
      runId: 'explicit-synth', topology: 'free_talk', runPolicy: 'auto',
      selectedModels: ['A', 'B'],
      presetConfig: { presetId: 'FREE_TALK_MVP', topology: 'free_talk', roundLimit: null }
    };
    const withoutSynthesis = Compiler.compile(base);
    expect(withoutSynthesis.synthesizer).toBe('');
    expect(withoutSynthesis.stages.map((stage) => stage.stageId)).toEqual(['free-talk:positions']);
    expect(Compiler.compile({ ...base, synthesizer: 'auto' }).synthesizer).toBe('');
  });

  test('Triad resolves participants from the saved protocol/model stack fallback', () => {
    const plan = Compiler.compile({
      runId: 'triad-saved-selection',
      topology: 'triad',
      runPolicy: 'auto',
      synthesizer: 'Claude',
      presetConfig: {
        presetId: 'TRIAD_STANDARD',
        topology: 'triad',
        roundLimit: 4,
        roundPlan: roundPlan(4),
        protocol: { selectedModels: ['Claude', 'GPT', 'Gemini'] }
      }
    });

    expect(plan.participants).toEqual(['Claude', 'GPT', 'Gemini']);
    expect(plan.stages.filter((stage) => /^r[1-4]:wave$/.test(stage.stageId))
      .every((stage) => stage.participants.length === 3)).toBe(true);
    expect(plan.stages.find((stage) => stage.stageId === 'final:words').participants)
      .toEqual(['Claude', 'GPT', 'Gemini']);
  });

  test('validator rejects hidden gaps and duplicated stage identities', () => {
    const verdict = Validator.validate({
      planId: 'broken', topology: 'duel', runPolicy: 'auto', synthesizer: 'S',
      stages: [
        { stageId: 'same', kind: Types.KINDS.PUBLIC_TURN, participants: ['A'], inputs: ['missing'], outputs: [], tabPolicy: Types.TAB_POLICIES.CREATE, nextStageId: 'same' },
        { stageId: 'same', kind: Types.KINDS.PUBLIC_TURN, participants: ['B'], inputs: [], outputs: [], tabPolicy: Types.TAB_POLICIES.CREATE, nextStageId: null }
      ]
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors).toEqual(expect.arrayContaining([
      'artifact_without_producer:same:missing',
      'stage_id_duplicate:same',
      'final_synthesis_count:0',
      'final_synthesis_not_terminal'
    ]));
  });
});

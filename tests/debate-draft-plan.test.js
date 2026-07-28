const DraftPlan = require('../disput/debate-draft-plan');

describe('DraftPlan — persistent Canvas execution graph', () => {
  test('materializes Canvas rounds and final synthesis as one ordered graph', () => {
    const plan = DraftPlan.createCanvasPlan({
      planId: 'p1', synthesizer: 'Claude',
      rounds: [
        { plannedStageId: 'canvas-r1', purpose: 'position', participantIds: ['GPT', 'Gemini'] },
        { plannedStageId: 'canvas-r2', purpose: 'response', participantIds: ['Claude'] }
      ]
    });
    expect(plan.plannedStages.map((stage) => stage.plannedStageId)).toEqual(['canvas-r1', 'canvas-r2', 'planned-final-synthesis']);
    expect(plan.plannedStages[1].upstream).toEqual(['canvas-r1']);
    expect(plan.plannedStages[2]).toMatchObject({ participantIds: ['Claude'], upstream: ['canvas-r2'], outputIntent: 'candidate_final' });
  });

  test('inserts a working synthesis and atomically rewires the downstream stage', () => {
    const original = DraftPlan.createCanvasPlan({
      synthesizer: 'Claude',
      rounds: [
        { plannedStageId: 'canvas-r1', participantIds: ['GPT'] },
        { plannedStageId: 'canvas-r2', participantIds: ['Gemini'] }
      ]
    });
    const result = DraftPlan.insertSynthesis(original, { afterPlannedStageId: 'canvas-r1', participantIds: ['Claude'], plannedStageId: 'checkpoint-1' });
    expect(result.ok).toBe(true);
    expect(result.plan.plannedStages.map((stage) => stage.plannedStageId)).toEqual(['canvas-r1', 'checkpoint-1', 'canvas-r2', 'planned-final-synthesis']);
    expect(result.stage).toMatchObject({ outputIntent: 'working_synthesis', terminalPolicy: 'continue', assignmentPolicy: 'explicit_required' });
    expect(result.plan.plannedStages.find((stage) => stage.plannedStageId === 'canvas-r2').upstream).toEqual(['checkpoint-1']);
    expect(original.plannedStages.find((stage) => stage.plannedStageId === 'canvas-r2').upstream).toEqual(['canvas-r1']);
  });

  test('rejects an explicit synthesis without a participant or an unknown insertion point', () => {
    const plan = DraftPlan.createCanvasPlan({ rounds: [{ plannedStageId: 'canvas-r1', participantIds: ['GPT'] }] });
    expect(DraftPlan.insertSynthesis(plan, { afterPlannedStageId: 'missing', participantIds: ['Claude'] }))
      .toMatchObject({ ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'INVALID_INSERTION_POINT' });
    expect(DraftPlan.insertSynthesis(plan, { afterPlannedStageId: 'canvas-r1', participantIds: [] }))
      .toMatchObject({ ok: false, code: 'SEMANTIC_INVALID', reasonCode: 'SYNTHESIS_PARTICIPANT_REQUIRED' });
  });

  test('detects a dependency cycle before a DraftPlan can start a run', () => {
    const plan = DraftPlan.normalize({
      plannedStages: [
        { plannedStageId: 'a', purpose: 'position', participantIds: ['GPT'], upstream: ['b'] },
        { plannedStageId: 'b', purpose: 'response', participantIds: ['Claude'], upstream: ['a'] }
      ]
    });
    expect(DraftPlan.validate(plan)).toMatchObject({ valid: false, errors: expect.arrayContaining([
      expect.objectContaining({ code: 'DEPENDENCY_CYCLE' })
    ]) });
  });
});

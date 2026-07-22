// Pure UI projection for a compiled Debate execution plan.
(function initDebatePlanViewModel(root) {
  'use strict';

  const LABELS = Object.freeze({
    opening_batch: 'Opening positions',
    public_turn: 'Debate turn',
    wave_batch: 'Debate wave',
    round_filter: 'System round analysis',
    checkpoint: 'Registry checkpoint',
    final_words: 'Final words',
    final_synthesis: 'Final synthesis',
    synthesis_audit: 'Synthesis audit'
  });

  function project(run = {}) {
    const plan = run.executionPlan || null;
    const stages = Array.isArray(plan?.stages) ? plan.stages : [];
    const currentIndex = Math.max(0, stages.findIndex((stage) => stage.stageId === run.currentStageId));
    const current = stages[currentIndex] || null;
    const next = current ? stages[currentIndex + 1] || null : null;
    const describe = (stage) => stage ? {
      stageId: stage.stageId,
      label: LABELS[stage.kind] || stage.kind,
      round: Number(stage.round || 0),
      system: stage.visibility === 'system',
      participants: (stage.participants || []).slice()
    } : null;
    return Object.freeze({
      planId: String(plan?.planId || ''),
      runPolicy: String(plan?.runPolicy || ''),
      currentIndex: current ? currentIndex : -1,
      totalStages: stages.length,
      current: describe(current),
      next: describe(next),
      epistemicOutcome: String(run.epistemicOutcome || ''),
      degradedMode: run.degradedMode || null,
      processAudit: run.processAudit || null,
      statusText: current
        ? `${plan.runPolicy === 'auto' ? 'Auto' : 'Manual'} · ${LABELS[current.kind] || current.kind} · ${currentIndex + 1}/${stages.length}`
        : ''
    });
  }

  const api = Object.freeze({ project });
  root.DebatePlanViewModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

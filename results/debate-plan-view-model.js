// Pure UI projection for a compiled Debate execution plan.
(function initDebatePlanViewModel(root) {
  'use strict';

  const LABELS = Object.freeze({
    participant: 'Participant analysis',
    critique: 'Critique',
    research: 'Research',
    synthesis: 'Synthesis',
    audit: 'Synthesis audit',
    correct_synthesis: 'Synthesis correction'
  });

  function project(run = {}) {
    const plan = run.executionPlan || null;
    const stages = Array.isArray(plan?.stages) ? plan.stages : [];
    const currentIndex = Math.max(0, stages.findIndex((stage) => stage.stageId === run.currentStageId));
    const current = stages[currentIndex] || null;
    const next = current ? stages[currentIndex + 1] || null : null;
    const describe = (stage) => stage ? {
      stageId: stage.stageId,
      label: LABELS[stage.purpose || stage.kind] || stage.purpose || stage.kind,
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
        ? `${plan.runPolicy === 'auto' ? 'Auto' : 'Manual'} · ${LABELS[current.purpose || current.kind] || current.purpose || current.kind} · ${currentIndex + 1}/${stages.length}`
        : ''
    });
  }

  const api = Object.freeze({ project });
  root.DebatePlanViewModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

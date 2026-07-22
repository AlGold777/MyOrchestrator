(function initDisputEvolutionFlags(root) {
  'use strict';
  const STORAGE_KEY = 'disputEvolutionFlagsV1';
  const AUDIT_KEY = 'disputEvolutionFlagAuditV1';
  const DEFAULTS = Object.freeze({
    stateMapReadOnly: true, liveStateMap: true, pipelineProfiles: true, triggers: true, freeTalkMvp: true,
    // Strangler Fig slice flags (Technical Architecture Roadmap v1.0 §15). Off by default:
    // legacy path stays primary until each slice passes its removal gate.
    caseFirstRuntime: false,       // disput.case_first_runtime (Slice B)
    stageExecutorDynamic: false,   // disput.stage_executor_dynamic (Slice C)
    rulePlanner: false,            // disput.rule_planner (Slice D)
    persistedPause: false,         // disput.persisted_pause (Slice E)
    humanParticipant: false,       // disput.human_participant (Slice F)
    planRevisions: false,          // disput.plan_revisions (Slice G)
    canvasCommands: false,         // disput.canvas_commands (Slice H)
    parallelExecutor: false,       // disput.parallel_executor (Slice I)
    sequentialExecutor: false,     // disput.sequential_executor (Slice J)
    universalEngine: false         // full Orchestrator–Planner–Executor path
  });
  function read() {
    try { return { ...DEFAULTS, ...(JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '{}')) }; }
    catch (_) { return { ...DEFAULTS }; }
  }
  function enabled(name) { return read()[name] !== false; }
  function audit(name, value) {
    try {
      const entries = JSON.parse(root.localStorage?.getItem(AUDIT_KEY) || '[]');
      entries.push({ at: new Date().toISOString(), event: 'feature_flag_changed', name: String(name), enabled: Boolean(value) });
      root.localStorage?.setItem(AUDIT_KEY, JSON.stringify(entries.slice(-100)));
    } catch (_) {}
  }
  function set(name, value) { if (!(name in DEFAULTS)) throw new Error(`Unknown Disput evolution flag: ${name}`); const flags = read(); flags[name] = Boolean(value); root.localStorage?.setItem(STORAGE_KEY, JSON.stringify(flags)); audit(name, value); return flags; }
  function getAudit() { try { return JSON.parse(root.localStorage?.getItem(AUDIT_KEY) || '[]'); } catch (_) { return []; } }
  const api = Object.freeze({ STORAGE_KEY, AUDIT_KEY, DEFAULTS, read, enabled, set, getAudit });
  root.DisputEvolutionFlags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

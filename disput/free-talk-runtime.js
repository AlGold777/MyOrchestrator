(function initFreeTalkRuntime(root) {
  'use strict';
  const VERSION = 3;
  const RuleEngine = root.DebateRuleEngine || (typeof require === 'function' ? require('./debate-rule-engine') : null);
  const TRIGGERS = RuleEngine?.CATALOG || Object.freeze({});

  const taskKey = (task) => `${task.triggerId}:${task.targetId || 'run'}`;
  function createState(seed = {}) {
    return {
      version: VERSION, status: 'idle', seq: 0, queue: [], completed: [], active: [], disabledTriggers: [], allowedTriggers: [], rules: [], ruleTrace: [], progressWindow: [], progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' }, lastProgressAt: 0, cooldowns: {}, loopCounts: {}, maxParallel: 2,
      ...seed,
      queue: Array.isArray(seed.queue) ? seed.queue.slice() : [],
      completed: Array.isArray(seed.completed) ? seed.completed.slice() : [],
      active: Array.isArray(seed.active) ? seed.active.slice() : [],
      disabledTriggers: Array.isArray(seed.disabledTriggers) ? seed.disabledTriggers.slice() : [],
      allowedTriggers: Array.isArray(seed.allowedTriggers) ? seed.allowedTriggers.slice() : [],
      rules: Array.isArray(seed.rules) ? seed.rules.slice() : [],
      ruleTrace: Array.isArray(seed.ruleTrace) ? seed.ruleTrace.slice() : [],
      progressWindow: Array.isArray(seed.progressWindow) ? seed.progressWindow.slice() : [],
      progressPolicy: { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request', ...(seed.progressPolicy || {}) },
      cooldowns: { ...(seed.cooldowns || {}) }, loopCounts: { ...(seed.loopCounts || {}) },
      budget: { used: 0, limit: null, reserved: 0, ...(seed.budget || {}) }
    };
  }
  function evaluateDetailed(map = {}, state = {}) {
    const allowed = new Set(state.allowedTriggers || []); const disabled = new Set(state.disabledTriggers || []);
    const configuredRules = state.rules?.length ? state.rules : state.allowedTriggers?.length ? state.allowedTriggers : null;
    const rules = configuredRules?.filter((raw) => {
      const id = String(typeof raw === 'string' ? raw : raw.triggerId || raw.id || '').toUpperCase();
      return (!allowed.size || allowed.has(id)) && !disabled.has(id);
    }) ?? null;
    return RuleEngine.evaluate(map, state, rules);
  }
  const evaluate = (map = {}, state = {}) => evaluateDetailed(map, state).tasks.slice();
  const utility = (task, map = {}) => RuleEngine.utility(task, map);
  function enqueue(current, candidates = []) {
    const state = createState(current); const known = new Set([...state.queue, ...state.active].map(taskKey));
    candidates.forEach((item) => {
      const key = taskKey(item); if (known.has(key)) return; known.add(key);
      const loops = Number(state.loopCounts[key] || 0); if (loops >= Math.max(1, Number(item.maxExecutions || 3))) return;
      state.seq += 1; state.queue.push({ ...item, id: `ft-task-${state.seq}`, status: item.mode === 'ask-human' ? 'awaiting_confirmation' : 'pending', createdAt: Date.now(), explanation: `${item.role} включён: ${item.reason}` });
    });
    state.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    return state;
  }
  function plan(map, current) {
    const evaluated = evaluateDetailed(map, current);
    const state = enqueue(current, evaluated.tasks);
    state.ruleTrace = state.ruleTrace.concat(evaluated.traces).slice(-300);
    state.queue = state.queue.map((task) => ({ ...task, utility: utility(task, map) })).sort((a, b) => b.utility - a.utility || b.priority - a.priority || a.createdAt - b.createdAt);
    const availableFor = (task) => state.budget.limit == null || state.budget.used + Number(task?.cost || 0) <= Math.max(0, state.budget.limit - state.budget.reserved);
    const candidates = state.queue.filter((task) => task.status === 'pending' && availableFor(task));
    const batch = [];
    for (const task of candidates) {
      if (batch.length >= Math.max(1, Number(state.maxParallel) || 1)) break;
      if (!batch.some((entry) => entry.targetId === task.targetId || entry.role === task.role)) batch.push(task);
    }
    const blockedByBudget = state.queue.some((task) => task.status === 'pending') && !candidates.length;
    return { state, next: batch[0] || null, batch, awaitingHuman: state.queue.filter((task) => task.status === 'awaiting_confirmation'), blockedByBudget, traces: evaluated.traces };
  }
  function settle(current, task, outcome = 'completed', meta = {}) {
    const state = createState(current); const key = taskKey(task);
    state.queue = state.queue.filter((item) => item.id !== task.id); state.active = state.active.filter((item) => item.id !== task.id);
    state.completed.push({ ...task, status: outcome, completedAt: Date.now(), stateChanged: meta.stateChanged === true, delta: meta.delta || null, degradedReasons: Array.isArray(meta.degradedReasons) ? meta.degradedReasons.slice() : [] });
    state.loopCounts[key] = Number(state.loopCounts[key] || 0) + 1;
    state.cooldowns[key] = state.seq + Math.max(0, Number(task.cooldown ?? 2));
    if (['completed', 'completed_no_delta', 'completed_degraded'].includes(outcome)) state.budget.used += Number(task.cost || 0);
    const progress = { taskId: task.id, ruleId: task.ruleId, triggerId: task.triggerId, stateChanged: meta.stateChanged === true, outcome, at: Date.now() };
    state.progressWindow = state.progressWindow.concat(progress).slice(-Math.max(1, Number(state.progressPolicy?.windowSize || 3)));
    if (progress.stateChanged) state.lastProgressAt = progress.at;
    return state;
  }
  function confirm(current, taskId, resolution) {
    const state = createState(current); const task = state.queue.find((item) => item.id === taskId); if (!task) return state;
    const effect = typeof resolution === 'boolean' ? (resolution ? 'execute_action' : 'reject_action') : String(resolution?.effect || resolution || 'reject_action');
    if (['execute_action', 'continue_one_step'].includes(effect)) task.status = 'pending';
    else if (effect === 'synthesize_now') { state.queue = state.queue.filter((item) => item.id !== task.id); state.forceSynthesis = true; state.stopReason = 'human_requested_synthesis'; }
    else return settle(state, task, effect === 'accept_as_limitation' ? 'accepted_as_limitation' : 'rejected_by_human');
    return state;
  }
  const api = Object.freeze({ VERSION, TRIGGERS, createState, evaluate, evaluateDetailed, utility, enqueue, plan, settle, confirm, taskKey });
  root.FreeTalkRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

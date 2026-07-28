(function initDebateProblemSpec(root) {
  'use strict';
  const TYPES = Object.freeze({ analysis: /сравн|анализ|оцени|разбер/i, factual: /правда ли|факт|проверь|доказ/i, decision: /выбери|стоит ли|решени|рекоменд/i, red_team: /red[ -]?team|атак|уязвим|риск/i, creative: /придумай|создай|предложи|идея/i });
  const OUTPUTS = Object.freeze({ analysis: 'структурированное сравнение с критериями', factual: 'проверяемые утверждения с основаниями', decision: 'рекомендация с аргументами и ограничениями', red_team: 'ранжированный список рисков с оценкой', creative: 'набор вариантов с обоснованием', other: 'ясный ответ по теме' });
  function extract({ topic = '', moderatorMessage = '', preset = {} } = {}) {
    const source = `${topic} ${moderatorMessage}`.trim();
    const suffix = String(preset?.reasoningBudget?.comparableSuffix || '').toLowerCase();
    const taskType = suffix.includes('red') ? 'red_team' : Object.entries(TYPES).find(([, re]) => re.test(source))?.[0] || 'other';
    const first = String(topic).split(/[.!?\n]/).map((x) => x.trim()).find(Boolean) || '';
    const constraints = source.split(/[.!?\n]/).map((x) => x.trim()).filter((x) => /^(не |без |только |учти )/i.test(x));
    const evidenceMode = taskType === 'factual' ? 'required' : ['analysis', 'decision', 'red_team'].includes(taskType) ? 'preferred' : 'none';
    return Object.freeze({ objective: first.slice(0, 200), taskType, constraints: Object.freeze(Array.from(new Set(constraints))), requiredOutput: OUTPUTS[taskType] || OUTPUTS.other, evidenceMode });
  }
  function renderProblemSpec(spec = {}) { return ['ProblemSpec:', `Цель: ${spec.objective || 'не определено'}`, `Тип задачи: ${spec.taskType || 'other'}`, `Требуемый выход: ${spec.requiredOutput || OUTPUTS.other}`, `Режим доказательств: ${spec.evidenceMode || 'none'}`, `Ограничения: ${(spec.constraints || []).join('; ') || 'нет'}`].join('\n'); }
  const api = Object.freeze({ TYPES, OUTPUTS, extract, renderProblemSpec }); root.DebateProblemSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

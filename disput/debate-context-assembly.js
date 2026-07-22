(function initDebateContextAssembly(root) {
  'use strict';
  const VISIBILITY_RULES = Object.freeze({
    participant_wave: ['topic', 'own_position', 'last_filter', 'last_wave_peers'],
    duel_turn: ['topic', 'opponent_last', 'last_filter'],
    round_filter: ['topic', 'current_round_turns', 'last_filter'],
    final_words: ['own_line', 'all_filters'],
    final_synthesis: ['all_filters', 'final_words', 'last_wave'],
    synthesis_audit: ['verdict', 'all_filters', 'final_words']
  });
  function assemble({ stageKind = '', stagePhase = '', state = {}, policy = 'filtered' } = {}) {
    const topology = String(stageKind).includes('duel') ? 'duel' : String(stageKind).includes('triad') ? 'triad' : 'multi';
    const key = stageKind || (topology === 'multi' ? 'participant_wave' : 'duel_turn'); const allowed = VISIBILITY_RULES[key] || VISIBILITY_RULES.participant_wave;
    const all = [];
    const add = (id, label, text, priority = 'normal') => { if (text) all.push({ id, label, text: String(text), priority }); };
    add('topic', 'Тема', state.topic || state.problemSpec?.objective);
    add('problemSpec', 'ProblemSpec', state.problemSpecText || state.config?.problemSpecText);
    add('own_position', 'Своя позиция', state.ownPosition, 'high');
    add('own_line', 'Своя линия', state.ownLine || state.ownPosition, 'high');
    add('opponent_last', 'Последний ответ оппонента', state.opponentLast, 'high');
    add('last_filter', 'Последний фильтр', state.roundFilters?.at?.(-1)?.text, 'high');
    add('last_wave_peers', 'Последняя волна', state.responsesByWave?.at?.(-1)?.map?.((x) => x.text).join('\n'), 'normal');
    add('all_filters', 'Все фильтры', (state.roundFilters || []).map((x) => x.text).join('\n'), 'high');
    add('final_words', 'Финальные слова', Object.values(state.finalWords || {}).join('\n'), 'high');
    add('last_wave', 'Последняя волна', state.responsesByWave?.at?.(-1)?.map?.((x) => x.text).join('\n'), 'normal');
    add('verdict', 'Черновик вердикта', state.synthesisText || state.finalVerdict, 'high');
    if (policy === 'full_history') add('full_history', 'Полная история', (state.responsesByWave || []).flat().map((x) => x.text).join('\n'), 'low');
    const parts = all.filter((item) => allowed.includes(item.id) || item.id === 'full_history');
    const omitted = all.filter((item) => !parts.includes(item)).map((item) => ({ id: item.id, reason: 'context_omitted_by_policy' }));
    return { topology, stagePhase, parts, omitted };
  }
  const api = Object.freeze({ VISIBILITY_RULES, assemble }); root.DebateContextAssembly = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

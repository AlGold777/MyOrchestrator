(function initDebateEpistemicOutcome(root) {
  'use strict';
  const MARKERS = Object.freeze({ insufficient_evidence: /недостаточно (данных|доказательств|источников)|insufficient evidence/i, external_verification_required: /требуется проверка внешн|нужна внешняя проверка|external verification/i, inconclusive: /не могу сделать вывод|вывод невозможен|inconclusive/i });
  function section(text, name) { const match = String(text || '').match(new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$)`, 'im')); return (match?.[1] || '').trim(); }
  function derive({ synthesisText = '', state = {} } = {}) {
    const signals = []; const degraded = state.degradedMode || (state.droppedModels || []).length;
    if (degraded) signals.push('protocol_degraded');
    const auditFailures = (state.processAudit?.checks || []).filter((item) => item.verdict === 'fail').map((item) => item.id);
    if (auditFailures.length) signals.push(...auditFailures.map((id) => `${id}:fail`));
    const unresolved = section(synthesisText, 'Нерешённые вопросы'); const verdict = section(synthesisText, 'Вердикт'); const confidence = section(synthesisText, 'Уверенность');
    if (MARKERS.external_verification_required.test(`${unresolved}\n${confidence}`)) { signals.push('external_verification_required'); return { outcome: degraded ? 'protocol_degraded' : 'external_verification_required', signals }; }
    if (MARKERS.insufficient_evidence.test(`${unresolved}\n${confidence}`)) { signals.push('insufficient_evidence'); return { outcome: degraded ? 'protocol_degraded' : 'insufficient_evidence', signals }; }
    if (!verdict || MARKERS.inconclusive.test(verdict)) { signals.push('inconclusive'); return { outcome: degraded ? 'protocol_degraded' : 'inconclusive', signals }; }
    if (unresolved && !/^нет[.\s]*$/i.test(unresolved) && unresolved.length > verdict.length) { signals.push('unresolved_questions'); return { outcome: degraded ? 'protocol_degraded' : 'partially_resolved', signals }; }
    return { outcome: degraded ? 'protocol_degraded' : auditFailures.length ? 'partially_resolved' : 'resolved', signals };
  }
  const api = Object.freeze({ MARKERS, derive }); root.DebateEpistemicOutcome = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

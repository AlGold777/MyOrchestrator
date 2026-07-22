(function initDebateModelSignal(root) {
  'use strict';
  const VERSION = 1;
  const TYPES = Object.freeze(['new_claim', 'objection', 'evidence', 'revision', 'dissent', 'no_progress', 'ready']);
  const TAG = /<disput-signal>\s*([\s\S]*?)\s*<\/disput-signal>/i;
  const instruction = () => 'Необязательно: в самом конце добавь <disput-signal>{"type":"new_claim|objection|evidence|revision|dissent|no_progress|ready","confidence":0..1,"targetId":"","reason":"до 12 слов"}</disput-signal>. Этот сигнал лишь диагностический.';
  function validate(signal = {}) {
    const errors = [];
    if (!TYPES.includes(signal.type)) errors.push('model_signal_type_invalid');
    if (!Number.isFinite(Number(signal.confidence)) || Number(signal.confidence) < 0 || Number(signal.confidence) > 1) errors.push('model_signal_confidence_invalid');
    if (String(signal.reason || '').split(/\s+/).filter(Boolean).length > 12) errors.push('model_signal_reason_too_long');
    return Object.freeze({ ok: errors.length === 0, errors });
  }
  function extract(text = '') {
    const source = String(text || ''); const match = source.match(TAG);
    if (!match) return Object.freeze({ text: source.trim(), signal: null, errors: [] });
    let signal = null; let errors = [];
    try { signal = JSON.parse(match[1]); errors = validate(signal).errors; } catch (_) { errors = ['model_signal_json_invalid']; }
    return Object.freeze({ text: source.replace(match[0], '').trim(), signal: errors.length ? null : Object.freeze({ schemaVersion: VERSION, type: signal.type, confidence: Number(signal.confidence), targetId: String(signal.targetId || ''), reason: String(signal.reason || '') }), errors });
  }
  const api = Object.freeze({ VERSION, TYPES, instruction, validate, extract });
  root.DebateModelSignal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

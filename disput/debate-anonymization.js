(function initDebateAnonymization(root) {
  'use strict';
  const MODEL_NAME_VARIANTS = Object.freeze({ GPT: ['GPT', 'ChatGPT', 'OpenAI'], Claude: ['Claude', 'Anthropic'], Gemini: ['Gemini', 'Google Gemini'] });
  function createAliasMap(models = []) { const map = {}; models.forEach((model, index) => { map[String(model)] = `Участник ${String.fromCharCode(65 + index)}`; }); return Object.freeze(map); }
  function anonymizeText(text, map = {}) {
    const replacements = Object.entries(map).flatMap(([name, alias]) => {
      const variants = MODEL_NAME_VARIANTS[name] || MODEL_NAME_VARIANTS[String(name).split(/\s+/)[0]] || [];
      return Array.from(new Set([name, ...variants])).map((variant) => [variant, alias]);
    }).sort((a, b) => b[0].length - a[0].length);
    return replacements.reduce((out, [name, alias]) => out.split(name).join(alias), String(text || ''));
  }
  function deanonymizeText(text, map = {}) { return Object.entries(map).reduce((out,[name,alias]) => out.split(alias).join(name), String(text || '')); }
  const api = Object.freeze({ MODEL_NAME_VARIANTS, createAliasMap, anonymizeText, deanonymizeText, anonymize: anonymizeText, deanonymize: deanonymizeText }); root.DebateAnonymization = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

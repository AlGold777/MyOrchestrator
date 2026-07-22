// shared/judge-prompt-builder.js
// Builds bounded judge prompts with nonce-delimited response blocks.
(function initJudgePromptBuilder(root) {
  'use strict';

  const DEFAULT_MAX_CHARS_PER_ANSWER = 12000;
  const DEFAULT_MAX_TOTAL_CHARS = 36000;

  function makeNonce() {
    return Math.random().toString(36).slice(2, 10);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
  }

  function defaultIsErrorOutput(output) {
    if (output == null) return true;
    if (typeof output === 'object') return output.ok === false;
    if (typeof output === 'string') {
      const trimmed = output.trim();
      if (!trimmed) return true;
      return /^error\s*:/i.test(trimmed);
    }
    return false;
  }

  function truncateText(text, maxChars) {
    if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
      return { text, truncated: false };
    }
    return {
      text: `${text.slice(0, Math.max(0, maxChars))}\n[...truncated ${text.length - maxChars} chars]`,
      truncated: true
    };
  }

  function buildResponsesList(responses, options = {}) {
    const orderedNames = Array.isArray(options.orderedNames) ? options.orderedNames : null;
    const maxCharsPerAnswer = Number.isFinite(options.maxCharsPerAnswer)
      ? options.maxCharsPerAnswer
      : DEFAULT_MAX_CHARS_PER_ANSWER;
    const maxTotalChars = Number.isFinite(options.maxTotalChars)
      ? options.maxTotalChars
      : DEFAULT_MAX_TOTAL_CHARS;
    const isErrorOutput = typeof options.isErrorOutput === 'function'
      ? options.isErrorOutput
      : defaultIsErrorOutput;
    const nonce = options.nonce || makeNonce();
    const entries = [];
    let totalChars = 0;
    let truncatedTotal = false;

    const names = orderedNames || (responses && typeof responses === 'object' ? Object.keys(responses) : []);
    names.forEach((name, index) => {
      const raw = Array.isArray(responses) ? responses[index]?.output : responses?.[name];
      if (isErrorOutput(raw)) return;
      const normalized = normalizeText(typeof raw === 'object' ? (raw.text || raw.answer || '') : raw);
      if (!normalized) return;
      const capped = truncateText(normalized, maxCharsPerAnswer);
      const header = `<<<RESPONSE ${nonce} ${name} START>>>`;
      const footer = `<<<RESPONSE ${nonce} ${name} END>>>`;
      const block = `${header}\n${capped.text}\n${footer}`;
      if (totalChars + block.length > maxTotalChars) {
        truncatedTotal = true;
        return;
      }
      totalChars += block.length;
      entries.push({ name, text: capped.text, truncated: capped.truncated, block });
    });

    return {
      list: entries.map((entry) => entry.block).join('\n\n'),
      count: entries.length,
      nonce,
      truncatedTotal,
      entries
    };
  }

  function buildJudgeEvaluationPrompt(systemPromptText = '', originalPrompt = '', responsesList = '', template = '') {
    const trimmedSystemPrompt = normalizeText(systemPromptText);
    const trimmedOriginalPrompt = normalizeText(originalPrompt);
    const trimmedResponses = normalizeText(responsesList);
    const fallbackTemplate = normalizeText(template);

    if (!trimmedSystemPrompt) {
      return (fallbackTemplate || 'Compare the following responses to the question: "{originalPrompt}".\n\nResponses for analysis:\n\n{responsesList}\n\nSelect the best response, briefly explain why, and present the result as a structured bulleted list.')
        .replace('{originalPrompt}', trimmedOriginalPrompt)
        .replace('{responsesList}', trimmedResponses)
        .trim();
    }

    let promptBody = trimmedSystemPrompt;
    const hasOriginalPlaceholder = promptBody.includes('{originalPrompt}');
    const hasResponsesPlaceholder = promptBody.includes('{responsesList}');

    if (hasOriginalPlaceholder) {
      promptBody = promptBody.replace('{originalPrompt}', trimmedOriginalPrompt);
    }
    if (hasResponsesPlaceholder) {
      promptBody = promptBody.replace('{responsesList}', trimmedResponses);
    }

    const parts = [promptBody];
    if (!hasOriginalPlaceholder && trimmedOriginalPrompt) {
      parts.push(`User request:\n${trimmedOriginalPrompt}`);
    }
    if (!hasResponsesPlaceholder && trimmedResponses) {
      parts.push(`Responses for analysis:\n\n${trimmedResponses}`);
    }
    return parts.join('\n\n').trim();
  }

  const api = Object.freeze({
    buildResponsesList,
    buildJudgeEvaluationPrompt,
    defaultIsErrorOutput
  });
  root.JudgePromptBuilder = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

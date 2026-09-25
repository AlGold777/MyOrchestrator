(function initAutomationCore(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AutomationLayerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.1.0';
  const STRUCTURE_CONTRACT_ID = 'AL-STRUCT-1';

  const CONTROL_TO_MODEL = Object.freeze({
    chatgpt: 'GPT',
    gpt: 'GPT',
    claude: 'Claude',
    gemini: 'Gemini',
    grok: 'Grok',
    lechat: 'Le Chat',
    'le chat': 'Le Chat',
    qwen: 'Qwen',
    deepseek: 'DeepSeek',
    perplex: 'Perplexity',
    perplexity: 'Perplexity',
    zai: 'Z.ai',
    'z.ai': 'Z.ai',
    kimi: 'Kimi'
  });

  const ANNOTATION_TYPES = Object.freeze([
    'FACT','ASSUMPTION','CONSTRAINT','DECISION','RISK','EVIDENCE','FINDING',
    'CONFLICT','OPEN','DEFERRED','CHANGE','BASELINE','VERIFIED','REJECTED','SUPERSEDED'
  ]);

  const DEFAULT_SYNTHESIS_INSTRUCTION = [
    'Проанализируй оба полученных ответа на исходный запрос и сформируй собственный улучшенный итоговый ответ.',
    'Учитывай сильные стороны обоих ответов, устраняй ошибки и противоречия, не своди задачу к голосованию между ними.',
    'Ответь непосредственно на исходный запрос пользователя.'
  ].join(' ');

  const STRUCTURE_INSTRUCTION = [
    'Return ONLY one JSON object. No markdown fence and no prose outside JSON.',
    'Required top-level fields: passport, outputs, annotations, trace, input_fate, changes, completion.',
    'passport: {"contract":"AL-STRUCT-1","stage":"ROUND_1 or ROUND_2","input_ids":[...]}.',
    'outputs: [{"id":"OUT-1","type":"ANSWER","version":1,"content":"..."}].',
    'annotations: array of typed structural notes. type must be one of: ' + ANNOTATION_TYPES.join(', ') + '. Use [] when none apply.',
    'trace: [{"output_id":"OUT-1","source_ids":[...]}].',
    'input_fate: one entry per input: {"input_id":"...","disposition":"CONSUMED|PRESERVED|REJECTED|SUPERSEDED|NOT_USED","output_ids":["OUT-1"]}.',
    'changes: structural mutations such as SYNTHESIZED, MERGED, REVISED or [] when none apply.',
    'completion: {"status":"COMPLETE","empty_by_design":false,"anomalies":[]}.'
  ].join('\n');

  function canonicalModelName(value) {
    const key = String(value || '').trim().toLowerCase();
    return CONTROL_TO_MODEL[key] || String(value || '').trim();
  }

  function selectedModelsFromValues(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map(canonicalModelName)
      .filter(Boolean)));
  }

  function buildRoundOnePrompt(originalPrompt) {
    const original = String(originalPrompt || '').trim();
    if (!original) throw new Error('missing_original_prompt');
    return [
      'AUTOMATION LAYER — ROUND 1',
      '',
      STRUCTURE_INSTRUCTION,
      '',
      'INPUT IDS: ORIGINAL_REQUEST',
      '',
      'ORIGINAL USER REQUEST:',
      '<<<ORIGINAL_REQUEST>>>',
      original,
      '<<<END_ORIGINAL_REQUEST>>>'
    ].join('\n');
  }

  function deterministicCombine(modelOrder, answers) {
    if (!Array.isArray(modelOrder) || modelOrder.length !== 2) {
      throw new Error('exactly_two_models_required');
    }
    return modelOrder.map((model, index) => {
      const structure = answers?.[model]?.structure || null;
      const raw = structure ? JSON.stringify(structure) : String(answers?.[model]?.raw || answers?.[model]?.text || '').trim();
      if (!raw) throw new Error(`missing_answer:${model}`);
      return [
        `===== SOURCE ${index + 1}: ROUND1_${model.toUpperCase().replace(/[^A-Z0-9]+/g, '_')} =====`,
        raw,
        `===== END SOURCE ${index + 1} =====`
      ].join('\n');
    }).join('\n\n');
  }

  function buildRoundTwoPrompt({ originalPrompt, modelOrder, answers, instruction }) {
    const original = String(originalPrompt || '').trim();
    if (!original) throw new Error('missing_original_prompt');
    const combined = deterministicCombine(modelOrder, answers);
    const task = String(instruction || DEFAULT_SYNTHESIS_INSTRUCTION).trim();
    const sourceIds = modelOrder.map((model) => `ROUND1_${model.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
    return [
      'AUTOMATION LAYER — ROUND 2',
      '',
      STRUCTURE_INSTRUCTION.replace('ROUND_1 or ROUND_2', 'ROUND_2'),
      '',
      `INPUT IDS: ORIGINAL_REQUEST, ${sourceIds.join(', ')}`,
      '',
      'ORIGINAL USER REQUEST:',
      '<<<ORIGINAL_REQUEST>>>',
      original,
      '<<<END_ORIGINAL_REQUEST>>>',
      '',
      'STRUCTURED ROUND 1 ANSWERS:',
      '<<<SOURCE_ANSWERS>>>',
      combined,
      '<<<END_SOURCE_ANSWERS>>>',
      '',
      'TASK:',
      task,
      '',
      'Round 2 trace and input_fate must explicitly account for ORIGINAL_REQUEST and both ROUND1 source IDs.'
    ].join('\n');
  }

  function stripJsonFence(raw) {
    const text = String(raw || '').trim();
    const match = text.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
    return match ? match[1].trim() : text;
  }

  function validateStructuredAnswer(raw, expectedStage, expectedInputIds) {
    let value;
    try {
      value = JSON.parse(stripJsonFence(raw));
    } catch (_) {
      return { ok: false, reason: 'STRUCTURE_INVALID_JSON' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'STRUCTURE_NOT_OBJECT' };

    const required = ['passport','outputs','annotations','trace','input_fate','changes','completion'];
    for (const key of required) if (!(key in value)) return { ok: false, reason: `STRUCTURE_MISSING_${key.toUpperCase()}` };

    const passport = value.passport || {};
    if (passport.contract !== STRUCTURE_CONTRACT_ID) return { ok: false, reason: 'STRUCTURE_BAD_CONTRACT' };
    if (String(passport.stage || '').toUpperCase() !== String(expectedStage || '').toUpperCase()) return { ok: false, reason: 'STRUCTURE_BAD_STAGE' };
    if (!Array.isArray(passport.input_ids)) return { ok: false, reason: 'STRUCTURE_BAD_INPUT_IDS' };

    const expected = Array.from(new Set(expectedInputIds || []));
    const actualIds = new Set(passport.input_ids.map(String));
    if (expected.some((id) => !actualIds.has(String(id)))) return { ok: false, reason: 'STRUCTURE_INPUT_COVERAGE' };

    if (!Array.isArray(value.outputs) || value.outputs.length < 1) return { ok: false, reason: 'STRUCTURE_NO_OUTPUT' };
    const output = value.outputs[0] || {};
    if (!output.id || String(output.type || '').toUpperCase() !== 'ANSWER' || Number(output.version) < 1) {
      return { ok: false, reason: 'STRUCTURE_BAD_OUTPUT' };
    }
    const content = String(output.content || '').trim();
    if (!content) return { ok: false, reason: 'STRUCTURE_EMPTY_CONTENT' };

    if (!Array.isArray(value.annotations)) return { ok: false, reason: 'STRUCTURE_BAD_ANNOTATIONS' };
    for (const item of value.annotations) {
      if (!item || !ANNOTATION_TYPES.includes(String(item.type || '').toUpperCase())) {
        return { ok: false, reason: 'STRUCTURE_BAD_ANNOTATION_TYPE' };
      }
    }

    if (!Array.isArray(value.trace) || !value.trace.some((x) => String(x?.output_id || '') === String(output.id))) {
      return { ok: false, reason: 'STRUCTURE_BAD_TRACE' };
    }
    const traceSources = new Set(value.trace.flatMap((x) => Array.isArray(x?.source_ids) ? x.source_ids.map(String) : []));
    if (expected.some((id) => !traceSources.has(String(id)))) return { ok: false, reason: 'STRUCTURE_TRACE_COVERAGE' };

    if (!Array.isArray(value.input_fate)) return { ok: false, reason: 'STRUCTURE_BAD_INPUT_FATE' };
    const fateIds = new Set(value.input_fate.map((x) => String(x?.input_id || '')));
    if (expected.some((id) => !fateIds.has(String(id)))) return { ok: false, reason: 'STRUCTURE_FATE_COVERAGE' };

    if (!Array.isArray(value.changes)) return { ok: false, reason: 'STRUCTURE_BAD_CHANGES' };
    if (!value.completion || String(value.completion.status || '').toUpperCase() !== 'COMPLETE') {
      return { ok: false, reason: 'STRUCTURE_NOT_COMPLETE' };
    }
    if (typeof value.completion.empty_by_design !== 'boolean' || !Array.isArray(value.completion.anomalies)) {
      return { ok: false, reason: 'STRUCTURE_BAD_COMPLETION' };
    }

    return {
      ok: true,
      structure: value,
      content,
      summary: {
        contract: STRUCTURE_CONTRACT_ID,
        outputs: value.outputs.length,
        annotations: value.annotations.length,
        changes: value.changes.length,
        completion: 'COMPLETE'
      }
    };
  }

  function terminalStatus(entry) {
    return String(entry?.finalStatus || entry?.modelRunState?.terminalStatus || entry?.status || '').trim().toUpperCase();
  }

  function isTerminalEntry(entry) {
    return Boolean(entry?.finalStatusRecorded || entry?.modelRunState?.terminalState === 'TERMINAL');
  }

  function stageRunId(runId, round) {
    return `${String(runId || '')}:R${Number(round || 0)}`;
  }

  function matchingJobState(jobState, runId, round) {
    const session = jobState?.session || {};
    const ctx = session.pipelineContext || {};
    const contextMatch = String(ctx.automationRunId || '') === String(runId || '')
      && Number(ctx.automationRound || 0) === Number(round || 0)
      && String(ctx.sourceView || '') === 'automation';
    const persistedMatch = String(session.pipelineRunId || '') === stageRunId(runId, round);
    return contextMatch || persistedMatch;
  }

  function collectNewTerminalEvents({ jobState, runId, round, models, seenKeys }) {
    if (!matchingJobState(jobState, runId, round)) return [];
    const seen = seenKeys instanceof Set ? seenKeys : new Set(seenKeys || []);
    const output = [];
    (models || []).forEach((model) => {
      const entry = jobState?.llms?.[model];
      if (!entry || !isTerminalEntry(entry)) return;
      const finalizedAt = Number(entry.finalizedAt || jobState?.session?.completedAt || Date.now());
      const status = terminalStatus(entry) || 'ERROR';
      const dispatchId = String(entry?.answerCommitEvidence?.dispatchId || entry?.confirmedDispatchId || entry?.lastDispatchMeta?.dispatchId || '');
      const key = [round, model, dispatchId || finalizedAt, status].join('|');
      if (seen.has(key)) return;
      output.push({
        key, round: Number(round), model, finalizedAt, status,
        success: status === 'SUCCESS' && Boolean(String(entry.answer || '').trim()),
        answer: String(entry.answer || '').trim(),
        reason: String(entry.statusReason || entry.responseMeta?.failureType || entry.responseMeta?.completionReason || '').trim(),
        dispatchId: dispatchId || null,
        requestId: entry.requestId || null,
        source: entry.responseMeta?.source || entry.responseMeta?.answerSource || null
      });
    });
    return output.sort((a, b) => a.finalizedAt !== b.finalizedAt
      ? a.finalizedAt - b.finalizedAt
      : String(a.model).localeCompare(String(b.model)));
  }

  function expectedInputIds(round, models) {
    if (Number(round) === 1) return ['ORIGINAL_REQUEST'];
    return ['ORIGINAL_REQUEST', ...(models || []).map((model) => `ROUND1_${String(model).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`)];
  }

  function localTime(timestamp, locale) {
    return new Date(Number(timestamp || Date.now())).toLocaleTimeString(locale || undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function buildResultText(state) {
    const models = Array.isArray(state?.models) ? state.models : [];
    const r1 = state?.rounds?.['1']?.answers || {};
    const r2 = state?.rounds?.['2']?.answers || {};
    const lines = [
      'Automation Layer — Web Runtime integration test',
      `Run ID: ${state?.runId || ''}`,
      `Models: ${models.join(', ')}`,
      '',
      '===== ORIGINAL USER REQUEST =====',
      String(state?.originalPrompt || ''),
      '',
      '===== ROUND 1 ====='
    ];
    models.forEach((model) => lines.push('', `--- ${model} ---`, String(r1?.[model]?.text || '')));
    lines.push('', '===== ROUND 2 =====');
    models.forEach((model) => lines.push('', `--- ${model} ---`, String(r2?.[model]?.text || '')));
    return lines.join('\n') + '\n';
  }

  function buildAuditObject(state) {
    return {
      schemaVersion: 2,
      contract: STRUCTURE_CONTRACT_ID,
      runId: state?.runId || null,
      phase: state?.phase || null,
      startedAt: state?.startedAt || null,
      completedAt: state?.completedAt || null,
      models: Array.isArray(state?.models) ? state.models.slice() : [],
      originalPromptHash: state?.originalPromptHash || null,
      rounds: state?.rounds || {},
      feed: state?.feed || [],
      journal: state?.journal || []
    };
  }

  return Object.freeze({
    VERSION,
    STRUCTURE_CONTRACT_ID,
    ANNOTATION_TYPES,
    DEFAULT_SYNTHESIS_INSTRUCTION,
    STRUCTURE_INSTRUCTION,
    CONTROL_TO_MODEL,
    canonicalModelName,
    selectedModelsFromValues,
    buildRoundOnePrompt,
    deterministicCombine,
    buildRoundTwoPrompt,
    validateStructuredAnswer,
    expectedInputIds,
    terminalStatus,
    isTerminalEntry,
    stageRunId,
    matchingJobState,
    collectNewTerminalEvents,
    localTime,
    buildResultText,
    buildAuditObject
  });
});

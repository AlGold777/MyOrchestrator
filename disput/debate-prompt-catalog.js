// Pure prompt catalog shared by every Debate topology.
(function initDebatePromptCatalog(root) {
  'use strict';

  const text = (value) => String(value == null ? '' : value).trim();
  const Artifacts = root.DebateArtifactDefinitions || (typeof require === 'function' ? require('./debate-artifact-definitions') : null);

  function normalizeMaxWords(value) {
    const raw = text(value).toLowerCase();
    if (!raw || ['inf', 'infinite', 'infinity', '∞', 'unlimited'].includes(raw)) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function wordLimitLine(value, { json = false } = {}) {
    const limit = normalizeMaxWords(value);
    if (!limit) return '';
    return json
      ? `Суммарный текст в JSON — не более ${limit} слов.`
      : `Твой ответ — не более ${limit} слов.`;
  }

  function resolveDiscussionTopic({ topic = '', moderatorMessage = '' } = {}) {
    return text(moderatorMessage) || text(topic) || 'Тема не указана';
  }

  const PARTICIPANT_ROLES = Object.freeze({
    critical: 'Критик: ищи слабые места, контрпримеры и недостающие доказательства.',
    meta: 'Синтезатор: соединяй только то, что выдержало проверку; отделяй факты от выводов.',
    expert: 'Эксперт: давай проверяемые утверждения; не выдавай предположения за факты.',
    provocateur: 'Провокатор: проверяй очевидное крайними сценариями и контрпримерами.'
  });

  const STAGE_TASKS = Object.freeze({
    opening: 'Сформулируй независимую позицию. Назови допущения, риски и конкретные критерии решения. Не ссылайся на ответы, которых ещё не видел.',
    critique: 'Атакуй позиции по существу, а не улучшай собственный ответ. Цитируй утверждение, назови тип уязвимости и дай контрпример. Не вводи новую собственную позицию.',
    defence: 'Ответь на каждое возражение: прими его с revision, опровергни с основанием или пометь открытым вопросом. Перечисли, что изменилось в позиции и почему.',
    retest: 'Проверяй только заявленные патчи. Для каждого вынеси: снято, не снято или появилось новое. Не изобретай новые атаки.',
    resolution: 'Сведи проверенные материалы. Обязательно добавь секцию «Эволюция позиции»: что сохранено, что изменено и какое возражение или основание вызвало каждое изменение.'
  });
  const KNOWN_PROMPT_CONTRACTS = Object.freeze(['duel_openings', 'duel_public_turn', 'duel_final_words', 'duel_final_synthesis', 'round_filter', 'triad_openings', 'triad_wave', 'triad_final_words', 'triad_final_synthesis', 'multi_openings', 'multi_wave', 'multi_final_words', 'multi_final_synthesis', 'free_talk_positions', 'free_talk_dynamic_action', 'free_talk_final_synthesis', 'synthesis_audit']);
  function buildSynthesisAuditPrompt({ verdict = '', roundFilters = [], finalWords = [], contextParts = [], maxWords } = {}) {
    const assembled = Array.isArray(contextParts) && contextParts.length
      ? contextParts.map((part) => `## ${part.label || part.id}\n${part.text}`).join('\n\n')
      : [verdict, roundFilters.join('\n'), finalWords.join('\n')].join('\n\n');
    return [
      'Ты — независимый аудитор. Проверь итог против предоставленного состояния дела.',
      'Ищи только проверяемые проблемы: неподдержанные выводы, потерянное меньшинство, незакрытые blockers, искажённые ограничения или ложную определённость.',
      'Верни ТОЛЬКО JSON: {"verdict":"pass|issues_found","issues":[{"code":"unsupported|minority_lost|blocker_open|constraint_lost|false_certainty","artifactIds":["id"],"explanation":"кратко"}]}. При pass массив issues должен быть пустым.',
      wordLimitLine(maxWords, { json: true }), assembled
    ].filter(Boolean).join('\n\n');
  }
  const SYNTHESIS_REQUIRED_SECTIONS = Object.freeze(['Вердикт', 'Что устояло', 'Позиции меньшинства', 'Нерешённые вопросы', 'Выводы синтезатора [synthesis_inference]', 'Уверенность и основания']);
  function resolveStagePhase({ roundOutputs = [], round = 1 } = {}) {
    const ids = (roundOutputs || []).map(String);
    if (!ids.length) return Number(round) <= 1 ? 'opening' : (Number(round) % 2 === 0 ? 'critique' : 'defence');
    if (ids.some((id) => ['proposal'].includes(id))) return 'opening';
    if (ids.some((id) => ['independent_retest', 'retest_report', 'self_retest'].includes(id))) return 'retest';
    if (ids.some((id) => ['positions_map', 'attack_surface_map', 'positions_cluster_map', 'attack_vector_map'].includes(id))) return 'opening';
    if (ids.some((id) => ['challenge_map', 'adversarial_review', 'evidence_gaps', 'hidden_assumptions', 'counterexamples', 'cross_review_matrix', 'outlier_review', 'parallel_adversarial_review'].includes(id))) return 'critique';
    if (ids.some((id) => ['defence_retest', 'failure_modes', 'conflict_resolution', 'systemic_failure_modes'].includes(id))) return 'defence';
    if (ids.some((id) => /(_verdict|resolution_map|risk_ranking|residual_risk_ranking|severity_ranking|weighted_synthesis|final_verdict)$/.test(id))) return 'resolution';
    return 'critique';
  }
  function validateRequiredSections(value, required = SYNTHESIS_REQUIRED_SECTIONS) {
    const headers = new Set(String(value || '').split(/\r?\n/).map((line) => line.replace(/^#+\s*/, '').trim().toLowerCase().replace(/[.:!?]/g, '')));
    return (Array.isArray(required) ? required : []).filter((section) => !headers.has(String(section).toLowerCase().replace(/[.:!?]/g, '')));
  }
  function validateSynthesisSections(value) { return validateRequiredSections(value, SYNTHESIS_REQUIRED_SECTIONS); }
  function assertBlindOpening(promptsByModel = {}, openingTexts = {}) {
    const entries = Object.entries(openingTexts || {});
    for (const [model, prompt] of Object.entries(promptsByModel || {})) {
      for (const [other, answer] of entries) {
        if (model !== other && String(answer || '').trim().slice(0, 80) && String(prompt || '').includes(String(answer).trim().slice(0, 80))) {
          throw new Error(`blind_opening_violation:${model}:${other}`);
        }
      }
    }
    return true;
  }

  const PROTOCOL_MISSIONS = Object.freeze({
    verdict: 'Цель: получить обоснованный вердикт, а не согласие любой ценой.',
    red_team: 'Цель: найти и проверить реальные уязвимости.',
    long: 'Цель: углублять тему, фиксировать прогресс и не повторяться.'
  });

  function resolveProtocolMission(preset = {}) {
    const suffix = String(preset?.reasoningBudget?.comparableSuffix || preset?.comparableSuffix || '').toLowerCase();
    if (suffix.includes('red')) return PROTOCOL_MISSIONS.red_team;
    if (suffix.includes('long')) return PROTOCOL_MISSIONS.long;
    if (suffix.includes('verdict')) return PROTOCOL_MISSIONS.verdict;
    const budgetClass = String(preset?.reasoningBudget?.class || '').toLowerCase();
    if (budgetClass === 'medium') return PROTOCOL_MISSIONS.red_team;
    if (budgetClass === 'infinite') return PROTOCOL_MISSIONS.long;
    return PROTOCOL_MISSIONS.verdict;
  }

  function resolveParticipantRoleText(value, index = 0) {
    const raw = text(value).toLowerCase();
    if (!raw) return index % 2 === 1 ? PARTICIPANT_ROLES.meta : PARTICIPANT_ROLES.critical;
    if (raw.includes('critical') || raw.includes('crit') || raw.includes('критик') || raw.includes('критич')) return PARTICIPANT_ROLES.critical;
    if (raw.includes('meta') || raw.includes('synthes') || raw.includes('синтез')) return PARTICIPANT_ROLES.meta;
    if (raw === 'expert' || raw.includes('эксперт')) return PARTICIPANT_ROLES.expert;
    if (raw.includes('provoc') || raw.includes('провокатор')) return PARTICIPANT_ROLES.provocateur;
    if (!raw.startsWith('interaction_')) return text(value);
    return index % 2 === 1 ? PARTICIPANT_ROLES.meta : PARTICIPANT_ROLES.critical;
  }

  function renderTemplate(template = '', values = {}) {
    let output = String(template || '');
    Object.entries(values || {}).forEach(([key, value]) => {
      output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    });
    return output;
  }

  function formatRoundFilters(roundFilters = []) {
    return (Array.isArray(roundFilters) ? roundFilters : [])
      .filter((entry) => entry?.text)
      .map((entry) => `## R${entry.round}: ${(entry.outputs || []).join(' + ')}\n${entry.text}`)
      .join('\n\n');
  }

  function buildRoundFilter({ topic, topology, round, outputs = [], turns = [], previousFilter = '', maxWords } = {}) {
    return [
      `Тема: ${text(topic)}`,
      `Раунд R${Number(round) || 0}; режим ${text(topology)}.`,
      `Собери артефакты:\n${Artifacts?.renderArtifactSpec(outputs) || (outputs || []).join(', ')}.`,
      '',
      'Ты — фильтр состояния, а не участник спора. Не добавляй свою позицию.',
      'Сохрани доказательства, сильные позиции меньшинства и нерешённые вопросы. Число голосов не является доказательством.',
      'Верни короткий раздел для каждого запрошенного артефакта.',
      wordLimitLine(maxWords),
      previousFilter ? `Прежнее состояние:\n${previousFilter}` : '',
      '',
      'Ответы раунда:',
      (turns || []).map((turn) => `### ${turn.model}\n${text(turn.text)}`).join('\n\n')
    ].filter(Boolean).join('\n');
  }

  function buildDuelFinalWord({ state, modelName, template = '', fallbackTopic = '', maxWords } = {}) {
    if (!state) return '';
    const isA = modelName === state.modelA;
    const role = isA ? state.roleA : state.roleB;
    const base = `Тема: ${state.topic || fallbackTopic}`;
    const ownTurns = (state.eventLog || [])
      .filter((event) => event.model === modelName && ['opening', 'public'].includes(event.phase))
      .map((event) => event.text)
      .join('\n\n');
    return `${base}\n\nДай финальную позицию: что сохранилось, что изменилось и какой аргумент вызвал каждое изменение. Отдельно укажи нерешённые вопросы.\n${wordLimitLine(maxWords || state.maxWords)}\n\nТвои прежние реплики:\n${ownTurns}\n\nСостояние раундов:\n${formatRoundFilters(state.roundFilters)}`;
  }

  function buildDuelModeratorSummary({ state, template = '', fallbackTopic = '', roundLimit = '' } = {}) {
    if (!state || !template) return '';
    return renderTemplate(template, {
      pipelineName: state.topic || fallbackTopic,
      modelA: state.modelA,
      modelB: state.modelB,
      roleA: state.roleA || 'Участник диспута',
      roleB: state.roleB || 'Участник диспута',
      N: roundLimit
    });
  }

  function buildDuelFinalSynthesis(state = {}) {
    const allPublicTurns = (state.eventLog || []).filter((event) => event.phase === 'public');
    const selectedTurns = state.presetConfigSnapshot?.contextPolicy === 'filtered' ? allPublicTurns.slice(-2) : allPublicTurns;
    const publicTurns = selectedTurns
      .map((event) => `### ${event.model}\n${event.text}`)
      .join('\n\n');
    const redTeamFinal = (state.presetConfigSnapshot?.roundPlan || []).some((entry) =>
      (entry.outputs || []).some((id) => /attack|retest|failure_mode/i.test(String(id))));
    return [
      `Тема: ${state.topic}.`,
      'Ты — итоговый синтезатор. Сделай вывод из материалов спора; число голосов не является доказательством.',
      'Обязательные разделы:',
      SYNTHESIS_REQUIRED_SECTIONS.map((section) => `## ${section}`).join('\n'),
      'Сохрани сильные позиции меньшинства с автором. Свои новые выводы помещай только в synthesis_inference.',
      wordLimitLine(state.maxWords),
      'В «Что устояло» кратко укажи, как изменилась позиция каждого участника.',
      redTeamFinal ? 'Для Red Team ранжируй остаточные риски; непроверенный патч не считай защитой.' : '',
      (state.presetConfigSnapshot?.roundPlan || []).some((entry) => (entry.outputs || []).includes('self_retest'))
        ? 'Ограничение Red Team: retest не был независимым — автор патчей проверял себя сам; отрази это в остаточных рисках.' : '',
      '',
      'Состояние раундов:',
      formatRoundFilters(state.roundFilters),
      '',
      'Реплики:',
      publicTurns,
      '',
      `Финальное слово — ${state.modelA}:\n${state.finalWordA || '(нет)'}`,
      `Финальное слово — ${state.modelB}:\n${state.finalWordB || '(нет)'}`
    ].join('\n');
  }

  function buildMultiWave({ topic, wave, maxWaves, modelName, role, mission = '', previousTurns = [], roundOutputs = [], previousFilter = '', problemSpec = '', contextParts = [], convergenceWarning = '', maxWords } = {}) {
    const context = previousTurns.length
      ? previousTurns.map((turn) => `### ${turn.model}\n${text(turn.text)}`).join('\n\n')
      : (contextParts.length ? contextParts.map((part) => `### ${part.label || part.id}\n${text(part.text)}`).join('\n\n') : 'Предыдущих ответов нет.');
    const normalizedRole = String(role || '').toLowerCase();
    const redTeamOpening = Number(wave) === 1 && roundOutputs.includes('proposal')
      ? (normalizedRole.includes('синтез') || normalizedRole.includes('meta')
        ? 'Ты — автор предложения. Не выполняй работу критиков.'
        : 'Ты — критик. Построй независимую карту атак; не переписывай предложение.')
      : '';
    const crossRetest = resolveStagePhase({ roundOutputs, round: wave }) === 'retest'
      ? 'Независимо проверь патчи по чужим атакам. Для каждого: снято / не снято / появилось новое.'
      : '';
    return [
      `Тема: ${text(topic)}`,
      `Раунд ${wave} из ${maxWaves}.`,
      role ? `Твоя функция: ${role}` : '',
      'Задача:',
      STAGE_TASKS[resolveStagePhase({ roundOutputs, round: wave })],
      wordLimitLine(maxWords),
      redTeamOpening,
      crossRetest,
      roundOutputs.length
        ? `Нужные артефакты:\n${Artifacts?.renderArtifactSpec(roundOutputs) || roundOutputs.join(', ')}.`
        : '',
      previousFilter ? `Прежнее состояние:\n${previousFilter}` : '',
      convergenceWarning ? `Сигнал системы: ${convergenceWarning}` : '',
      '',
      'Контекст:',
      context,
      resolveStagePhase({ roundOutputs, round: wave }) === 'resolution' ? '## Эволюция позиции\n- Сохранил: …\n- Изменил: тезис → изменение\n- Причина каждого изменения: …' : '',
      'Не повторяй уже сказанное.'
    ].filter(Boolean).join('\n\n');
  }

  function buildMultiFinalSynthesis({ topic, synthesizer, turns = [], roundFilters = [], finalInstruction = '', problemSpec = '', contextParts = [], maxWords } = {}) {
    const responses = turns.length
      ? turns.map((turn) => `## ${turn.model}\n${text(turn.text)}`).join('\n\n')
      : contextParts.length ? contextParts.map((part) => `## ${part.label || part.id}\n${text(part.text)}`).join('\n\n') : 'Нет пригодных ответов.';
    const redTeamFinal = roundFilters.some((entry) => (entry.outputs || []).some((id) => /attack|retest|failure_mode/i.test(String(id))));
    return [
      `Тема: ${text(topic)}`,
      'Ты — итоговый синтезатор.',
      finalInstruction || 'Final synthesis: agreed points, disputed points, and next step.',
      '',
      'Обязательные разделы:',
      SYNTHESIS_REQUIRED_SECTIONS.map((section) => `## ${section}`).join('\n'),
      'Консенсус не является доказательством. Сохрани позиции меньшинства с автором; свои новые выводы помещай только в synthesis_inference.',
      wordLimitLine(maxWords),
      'В секции «Что устояло» включи эволюцию позиции каждого участника: сохранил / изменил / причина изменения.',
      redTeamFinal ? 'Для Red Team ранжируй остаточные риски после независимого ретеста.' : '',
      '',
      'Состояние раундов:',
      formatRoundFilters(roundFilters) || '(none)',
      '',
      'Ответы участников:',
      responses
    ].join('\n');
  }

  const api = Object.freeze({
    PARTICIPANT_ROLES,
    normalizeMaxWords,
    wordLimitLine,
    resolveDiscussionTopic,
    PROTOCOL_MISSIONS,
    resolveProtocolMission,
    resolveParticipantRoleText,
    renderTemplate,
    formatRoundFilters,
    buildRoundFilter,
    buildDuelFinalWord,
    buildDuelModeratorSummary,
    buildDuelFinalSynthesis,
    buildMultiWave,
    buildMultiFinalSynthesis, STAGE_TASKS, KNOWN_PROMPT_CONTRACTS, SYNTHESIS_REQUIRED_SECTIONS,
    resolveStagePhase, validateRequiredSections, validateSynthesisSections, assertBlindOpening, buildSynthesisAuditPrompt
  });
  root.DebatePromptCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

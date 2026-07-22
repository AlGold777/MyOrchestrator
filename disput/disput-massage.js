(function initDisputMessageTemplates(root) {
  'use strict';

  const DEFAULT_SERIAL_FORMAT = 'Ясный, структурированный ответ.';
  const Artifacts = root.DebateArtifactDefinitions || (typeof require === 'function' ? require('./debate-artifact-definitions') : null);
  const Catalog = root.DebatePromptCatalog || (typeof require === 'function' ? require('./debate-prompt-catalog') : null);
  const getCatalog = () => root.DebatePromptCatalog || Catalog;
  const getArtifacts = () => root.DebateArtifactDefinitions || Artifacts;

  function normalizeText(value, fallback = '') {
    const text = String(value || '').trim();
    return text || fallback;
  }

  const topicOf = (pipelineName, moderatorMessage) => getCatalog()?.resolveDiscussionTopic?.({ topic: pipelineName, moderatorMessage })
    || normalizeText(moderatorMessage, normalizeText(pipelineName, 'Тема не указана'));
  const limitLine = (maxWords) => {
    const catalogLine = getCatalog()?.wordLimitLine?.(maxWords);
    if (catalogLine) return catalogLine;
    const parsed = Number.parseInt(String(maxWords || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? `Твой ответ — не более ${parsed} слов.` : '';
  };

  function buildInitAPrompt({
    pipelineName = '',
    modelB = '',
    roleA = '',
    mission = '',
    roundOutputs = [],
    format = DEFAULT_SERIAL_FORMAT,
    moderatorMessage = '', problemSpec = '', maxWords
  } = {}) {
    return [
      'Ты участвуешь в дискуссии с другими LLM. Ты ещё не видишь их позиций, и они не видят твою.',
      'Сейчас подготовь стартовую позицию в виде ясного и понятного ответа.',
      `Тема дискуссии: ${topicOf(pipelineName, moderatorMessage)}`,
      'Задача:',
      '1. Сформулируй свою позицию.',
      '2. Выдели 2–4 ключевых тезиса.',
      '3. Приведи аргументы к каждому тезису.',
      limitLine(maxWords)
    ].filter(Boolean).join('\n');
  }

  function buildInitBPrompt({
    pipelineName = '',
    modelA = '',
    roleB = '',
    mission = '',
    roundOutputs = [],
    format = DEFAULT_SERIAL_FORMAT,
    moderatorMessage = '', problemSpec = '', maxWords
  } = {}) {
    return buildInitAPrompt({ pipelineName, moderatorMessage, maxWords });
  }

  function buildStandardTurnPrompt({
    pipelineName = '',
    roleY = '',
    modelX = '',
    mission = '',
    previousModelText = '',
    moderatorText = '',
    registryContext = '',
    primaryTrigger = '',
    previousFilter = '',
    roundOutputs = [],
    stagePhase = '',
    maxWords
  } = {}) {
    const parts = [`Тема: ${topicOf(pipelineName, '')}`];

    parts.push(
      `Предыдущая позиция (${normalizeText(modelX, 'участник')}):`,
      normalizeText(previousModelText, 'Ответ оппонента отсутствует.'),
      ''
    );

    if (normalizeText(moderatorText)) {
      parts.push('Новое указание модератора:', normalizeText(moderatorText), '');
    }

    if (normalizeText(previousFilter)) {
      parts.push('# Отфильтрованное состояние предыдущего раунда:', normalizeText(previousFilter), '');
    }

    if (Array.isArray(roundOutputs) && roundOutputs.length) {
      parts.push(`# Обязательные filter-artifacts этого раунда:\n${getArtifacts()?.renderArtifactSpec(roundOutputs) || roundOutputs.join(', ')}.`, 'Структурируй ответ так, чтобы фильтр мог собрать эти артефакты.', '');
    }

    if (normalizeText(registryContext)) {
      parts.push('# Состояние диспута, отслеженное системой:', normalizeText(registryContext), '');
    }

    if (normalizeText(primaryTrigger)) {
      parts.push('# Приоритетное системное указание:', normalizeText(primaryTrigger), '');
    }

    const phase = stagePhase || getCatalog()?.resolveStagePhase({ roundOutputs }) || 'critique';
    const legacyTurn = !stagePhase && !roundOutputs.length
      ? '1. Атакуй самое слабое место в аргументах оппонента: логическую уязвимость, подмену понятий или недостающий факт. Цитируй атакуемый фрагмент.\n2. Дай контраргументы от своей позиции, не повторяя уже сказанного тобой.\n3. Укажи, с чем из сказанного оппонентом ты согласен, если такое есть.'
      : getCatalog()?.STAGE_TASKS?.[phase] || 'Атакуй аргументы оппонента, назови основание и открытые вопросы.';
    parts.push('Твоя задача:', legacyTurn, limitLine(maxWords));

    return parts.join('\n');
  }

  function buildSerialDebateEnvelope({
    topic = '',
    role = '',
    format = DEFAULT_SERIAL_FORMAT,
    opponentText = '',
    moderatorMessage = '',
    isFinalRound = false
  } = {}) {
    const safeFormat = normalizeText(format, DEFAULT_SERIAL_FORMAT);
    return [
      '[DEBATE CONTEXT]',
      'Тема дебатов:',
      normalizeText(topic, 'Не указана.'),
      '',
      'Твоя роль:',
      normalizeText(role, 'Участник диспута.'),
      '',
      'Формат ответа:',
      safeFormat,
      '',
      isFinalRound ? '[ФИНАЛЬНЫЙ РАУНД]\nЭто последний раунд диспута. Нужно подвести итог своей позиции, ответить на ключевой аргумент оппонента и сформулировать финальный вывод.\n' : '',
      '[ОТВЕТ ОППОНЕНТА]',
      normalizeText(opponentText, 'Отсутствует. Это первый ход диспута.'),
      '',
      '[СООБЩЕНИЕ МОДЕРАТОРА]',
      normalizeText(moderatorMessage, 'Продолжай диспут по заданной теме.')
    ].filter((line) => line !== '').join('\n');
  }

  const api = Object.freeze({
    DEFAULT_SERIAL_FORMAT,
    buildInitAPrompt,
    buildInitBPrompt,
    buildStandardTurnPrompt,
    buildSerialDebateEnvelope
  });

  root.DisputMessageTemplates = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

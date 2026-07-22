// Compiles a saved pipeline and explicit run overrides into one executable plan.
(function initDebatePlanCompiler(root) {
  'use strict';

  const Types = root.DebateStageTypes || (typeof require === 'function' ? require('./debate-stage-types') : null);
  const Validator = root.DebatePlanValidator || (typeof require === 'function' ? require('./debate-plan-validator') : null);
  const Contracts = root.DebateContracts || (typeof require === 'function' ? require('./debate-contracts') : null);
  const { KINDS, ROLES, VISIBILITY, CONTINUATION, TAB_POLICIES } = Types;

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };
  const cleanModels = (models) => Array.from(new Set((Array.isArray(models) ? models : []).map((item) => String(item || '').trim()).filter(Boolean)));
  const outputIds = (roundPlan, round) => {
    const entry = (Array.isArray(roundPlan) ? roundPlan : []).find((item) => Number(item?.round) === Number(round));
    return (Array.isArray(entry?.outputs) ? entry.outputs : []).map((id) => `r${round}:${String(id)}`);
  };
  function participantsForRound({ participants = [], roles = [], stageRoles = null, round = 1, outputs = [], topology = '' } = {}) {
    const requested = stageRoles?.[String(round)] || stageRoles?.[round];
    if (!Array.isArray(requested) || !requested.length) return participants.slice();
    const used = new Set();
    const isIndependentRetest = outputs.some((id) => /independent_retest|retest_report/i.test(String(id)));
    const selected = requested.map((requestedRole, requestedIndex) => {
      const role = String(requestedRole || '').toLowerCase();
      const indexes = participants.map((_, index) => index)
        .filter((index) => String(roles[index] || '').toLowerCase() === role && !used.has(index));
      const index = isIndependentRetest && role === 'critical' && topology !== 'multi' ? indexes.at(-1) : indexes[0];
      const fallbackIndex = participants.findIndex((_, candidate) => !used.has(candidate));
      const selectedIndex = index == null ? fallbackIndex : index;
      if (selectedIndex < 0) return '';
      used.add(selectedIndex);
      return participants[selectedIndex] || participants[requestedIndex] || '';
    }).filter(Boolean);
    if (topology === 'multi') {
      const requestedRoles = new Set(requested.map((role) => String(role || '').toLowerCase()));
      participants.forEach((participant, index) => {
        if (!used.has(index) && requestedRoles.has(String(roles[index] || '').toLowerCase())) {
          used.add(index);
          selected.push(participant);
        }
      });
    }
    return selected;
  }

  function makeStage(input) {
    return {
      stageId: input.stageId,
      kind: input.kind,
      role: input.role || ROLES.PARTICIPANT,
      visibility: input.visibility || VISIBILITY.PUBLIC,
      round: Number(input.round || 0),
      participants: cleanModels(input.participants),
      promptContract: String(input.promptContract || ''),
      inputs: Array.isArray(input.inputs) ? input.inputs.slice() : [],
      outputs: Array.isArray(input.outputs) ? input.outputs.slice() : [],
      continuation: input.continuation || CONTINUATION.AUTO,
      tabPolicy: input.tabPolicy || TAB_POLICIES.REUSE_PARTICIPANT_SESSION,
      completionPolicy: input.completionPolicy || 'all_required_answers',
      failurePolicy: input.failurePolicy || 'fail_run',
      purpose: String(input.purpose || ''),
      nextStageId: null
    };
  }
  const purposeFor = (kind) => ({
    opening_batch: 'Получить независимые исходные позиции участников.',
    wave_batch: 'Провести заданную фазу межмодельной проверки.',
    public_turn: 'Продолжить Duel с учётом текущего контекста.',
    round_filter: 'Собрать определённые артефакты раунда.',
    final_words: 'Получить финальное слово каждого участника.',
    final_synthesis: 'Синтезировать проверенный финальный вердикт.',
    synthesis_audit: 'Независимо проверить трассируемость и полноту финального синтеза.'
  }[kind] || 'Выполнить стадию Debate согласно контракту.');

  function compile(input = {}) {
    const preset = input.presetConfig || input.preset || {};
    const topology = String(input.topology || preset.topology || 'duel');
    const stackModels = preset.modelStacks?.['r1-models']?.items
      || preset.modelStacks?.['r1_models']?.items
      || [];
    const modelSources = [
      input.selectedModels,
      input.participants,
      input.models,
      preset.selectedModels,
      preset.participants,
      preset.protocol?.selectedModels,
      preset.protocol?.participants,
      stackModels.map((item) => item?.name || item?.model)
    ];
    const models = modelSources
      .find((source) => Array.isArray(source) && source.some((item) => String(item || '').trim()))
      || [];
    const normalizedModels = cleanModels(models);
    const scenario = input.scenario || {};
    const participants = topology === 'duel'
      ? cleanModels([scenario.modelA, scenario.modelB].filter(Boolean).length ? [scenario.modelA, scenario.modelB] : normalizedModels.slice(0, 2))
      : normalizedModels.slice(0, topology === 'triad' ? 3 : normalizedModels.length);
    const runPolicy = String(input.runPolicy || preset.runPolicy || 'manual') === 'auto' ? 'auto' : 'manual';
    const continuation = runPolicy === 'auto' ? CONTINUATION.AUTO : CONTINUATION.APPROVAL;
    const roundPlan = Array.isArray(preset.roundPlan) ? preset.roundPlan : [];
    const derivedDuelRounds = preset.turnLimit == null ? null : (Math.ceil(Number(preset.turnLimit) / 2) + 1);
    const configuredLimit = Number(
      preset.roundLimit
      || input.roundLimit
      || (topology === 'duel' ? derivedDuelRounds : preset.waveLimit)
      || 3
    );
    const roundLimit = Math.max(1, Math.min(50, Number.isFinite(configuredLimit) ? configuredLimit : 1));
    const isRedTeam = String(preset.reasoningBudget?.comparableSuffix || '').toLowerCase().includes('red')
      || roundPlan.some((entry) => (entry?.outputs || []).some((id) => /attack|retest|failure_mode/i.test(String(id))));
    const configuredSynthesizer = String(input.synthesizer || preset.synthesizer || '').trim();
    const synthesizer = configuredSynthesizer.toLowerCase() === 'auto' ? '' : configuredSynthesizer;
    const problemSpec = input.problemSpec || preset.problemSpec || {};

    const configuredParticipantRoles = Array.isArray(input.roles) && input.roles.length ? input.roles : (Array.isArray(preset.roles) ? preset.roles : []);
    const participantRoles = participants.map((_, index) => configuredParticipantRoles[index % Math.max(1, configuredParticipantRoles.length)] || 'participant');
    const openingTabPolicy = input.forceNewTabs === false ? TAB_POLICIES.REUSE_IF_VALID : TAB_POLICIES.CREATE;
    const stages = [];
    const addFilter = (round, sourceOutputs) => {
      if (!synthesizer) return;
      const outputs = outputIds(roundPlan, round);
      if (!outputs.length) return;
      stages.push(makeStage({
        stageId: `r${round}:filter`, kind: KINDS.ROUND_FILTER, role: ROLES.FILTER,
        visibility: VISIBILITY.SYSTEM, round, participants: [synthesizer],
        promptContract: 'round_filter', inputs: sourceOutputs, outputs,
        tabPolicy: TAB_POLICIES.REUSE_IF_VALID, purpose: purposeFor(KINDS.ROUND_FILTER)
      }));
    };

    if (topology === 'free_talk') {
      const openingOutputs = participants.map((_, index) => `r1:position:${index + 1}`);
      stages.push(makeStage({
        stageId: 'free-talk:positions', kind: KINDS.OPENING_BATCH, round: 1, participants,
        promptContract: 'free_talk_positions', outputs: openingOutputs, tabPolicy: openingTabPolicy,
        purpose: 'Получить независимые исходные позиции без ограничения числа участников.', failurePolicy: 'ask_user'
      }));
      if (synthesizer) stages.push(makeStage({
          stageId: 'free-talk:trigger-loop', kind: KINDS.DYNAMIC_ACTION, round: 2, participants,
          promptContract: 'free_talk_dynamic_action', inputs: openingOutputs, outputs: ['free-talk:state-map'],
          completionPolicy: 'any_answer', tabPolicy: TAB_POLICIES.REUSE_PARTICIPANT_SESSION,
          purpose: 'Выбирать следующий полезный вклад по состоянию карты и сработавшим триггерам.', failurePolicy: 'skip_stage'
        }));
    } else if (topology === 'duel') {
      const openingOutputs = participants.map((_, index) => `r1:opening:${index + 1}`);
      stages.push(makeStage({
        stageId: 'r1:openings', kind: KINDS.OPENING_BATCH, round: 1, participants,
        promptContract: 'duel_openings', outputs: openingOutputs, tabPolicy: openingTabPolicy, purpose: purposeFor(KINDS.OPENING_BATCH)
        ,failurePolicy: 'ask_user'
      }));
      addFilter(1, openingOutputs);
      for (let round = 2; round <= roundLimit; round += 1) {
        const turnOutputs = [];
        participants.slice().reverse().forEach((model, index) => {
          const output = `r${round}:turn:${index + 1}`;
          turnOutputs.push(output);
          stages.push(makeStage({
            stageId: `r${round}:turn:${index + 1}`, kind: KINDS.PUBLIC_TURN, round,
            participants: [model], promptContract: 'duel_public_turn', outputs: [output],
            continuation, tabPolicy: TAB_POLICIES.REUSE_PARTICIPANT_SESSION, purpose: purposeFor(KINDS.PUBLIC_TURN)
            ,failurePolicy: 'ask_user'
          }));
        });
        addFilter(round, turnOutputs);
      }
    } else {
      for (let round = 1; round <= roundLimit; round += 1) {
        const configuredOutputs = outputIds(roundPlan, round).map((id) => id.replace(/^r\d+:/, ''));
        const roundParticipants = participantsForRound({ participants, roles: participantRoles, stageRoles: preset.stageRoles, round, outputs: configuredOutputs, topology });
        const outputs = roundParticipants.map((_, index) => `r${round}:position:${index + 1}`);
        stages.push(makeStage({
          stageId: `r${round}:wave`, kind: round === 1 ? KINDS.OPENING_BATCH : KINDS.WAVE_BATCH,
          round, participants: roundParticipants, promptContract: round === 1 ? `${topology}_openings` : `${topology}_wave`,
          outputs, continuation: round === 1 ? CONTINUATION.AUTO : continuation,
          tabPolicy: round === 1 ? openingTabPolicy : TAB_POLICIES.REUSE_PARTICIPANT_SESSION, purpose: purposeFor(round === 1 ? KINDS.OPENING_BATCH : KINDS.WAVE_BATCH), failurePolicy: 'ask_user'
        }));
        addFilter(round, outputs);
      }
    }

    const allRoundArtifacts = stages.flatMap((stage) => stage.outputs);
    if (topology !== 'multi' && topology !== 'free_talk') {
      stages.push(makeStage({
        stageId: 'final:words', kind: KINDS.FINAL_WORDS, round: roundLimit + 1,
        participants, promptContract: `${topology}_final_words`, inputs: allRoundArtifacts,
        outputs: participants.map((_, index) => `final:word:${index + 1}`),
        tabPolicy: TAB_POLICIES.REUSE_PARTICIPANT_SESSION, purpose: purposeFor(KINDS.FINAL_WORDS), failurePolicy: 'ask_user'
      }));
    }
    const synthesisInputs = (topology === 'multi' || topology === 'free_talk') ? allRoundArtifacts : stages.at(-1).outputs;
    const finalSynthesisOutputs = isRedTeam
      ? ['final:residual_risk_ranking', 'final:red_team_verdict']
      : ['final:verdict'];
    if (synthesizer) stages.push(makeStage({
        stageId: 'final:synthesis', kind: KINDS.FINAL_SYNTHESIS, role: ROLES.SYNTHESIZER,
        visibility: VISIBILITY.PUBLIC, round: roundLimit + 2, participants: [synthesizer],
        promptContract: `${topology}_final_synthesis`, inputs: synthesisInputs,
        outputs: finalSynthesisOutputs, tabPolicy: TAB_POLICIES.REUSE_IF_VALID, purpose: purposeFor(KINDS.FINAL_SYNTHESIS)
        ,failurePolicy: 'ask_user'
      }));

    const operationFor = (stage) => {
      if (stage.kind === KINDS.OPENING_BATCH) return 'opening';
      if (stage.kind === KINDS.ROUND_FILTER) return 'round_filter';
      if (stage.kind === KINDS.FINAL_WORDS) return 'final_position';
      if (stage.kind === KINDS.FINAL_SYNTHESIS) return 'synthesis';
      if (stage.kind === KINDS.SYNTHESIS_AUDIT) return 'synthesis_audit';
      if (stage.kind === KINDS.DYNAMIC_ACTION) return 'critique';
      return 'critique';
    };
    stages.forEach((stage, index) => {
      stage.nextStageId = stages[index + 1]?.stageId || null;
      stage.stageContract = Contracts?.createStageContract?.({
        stageId: stage.stageId, operation: operationFor(stage), role: stage.role,
        purpose: stage.purpose, inputs: stage.inputs, outputs: stage.outputs,
        service: stage.visibility === VISIBILITY.SYSTEM,
        outputContract: { maxWords: input.maxWords || preset.length || null },
        failurePolicy: stage.failurePolicy
      }) || null;
    });

    const planSeed = String(input.planId || input.runId || `${preset.presetId || topology}:${roundLimit}:${runPolicy}`);
    const taskContract = input.taskContract || Contracts?.createTaskContract?.({
      rawRequest: input.pipelineNameText || input.moderatorEntryText || problemSpec.objective,
      objective: problemSpec.objective || input.pipelineNameText || input.moderatorEntryText,
      problemSpec, maxWords: input.maxWords || preset.length,
      runId: input.runId, profileId: preset.profileId || preset.presetId
    }) || null;
    const plan = deepFreeze({
      version: root.DebateVersionManifest?.getVersions?.().planSchema || 1,
      planId: `debate-plan:${planSeed}`,
      presetId: String(preset.presetId || ''),
      topology,
      runPolicy,
      roundLimit,
      participants,
      synthesizer,
      roles: Object.fromEntries(participants.map((model, index) => [model, participantRoles[index] || 'participant'])),
      acceptSelfRetest: Boolean(preset.acceptSelfRetest),
      reasoningBudget: preset.reasoningBudget || {},
      taskContract,
      promptPack: preset.promptPack || { id: 'disput-core', version: String(root.DebatePromptPack?.VERSION || '3.0.0') },
      contractVersions: { task: Number(Contracts?.VERSION || 0), stage: Number(Contracts?.VERSION || 0), promptCompiler: Number(root.DebatePromptCompiler?.VERSION || 0), contextBroker: Number(root.DebateContextBroker?.VERSION || 0) },
      stages
    });
    return Validator.assertValid(plan);
  }

  const stageById = (plan, stageId) => (plan?.stages || []).find((stage) => stage.stageId === stageId) || null;
  const api = Object.freeze({ compile, stageById });
  root.DebatePlanCompiler = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

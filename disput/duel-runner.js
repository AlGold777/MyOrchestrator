// Application-level sequencing for the Duel topology.
(function initDuelRunner(root) {
  'use strict';

  function createDuelRunner(deps = {}) {
    const acceptance = deps.acceptResponse || ((text) => ({ ok: Boolean(String(text || '').trim()) && !deps.isErrorOutput?.(String(text || '').trim()), reason: '' }));
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const timeline = typeof deps.timeline === 'function' ? deps.timeline : () => {};
    const stageEvent = (type, stageId, payload = {}) => deps.recordStageEvent?.(type, { stageId, ...payload });
    const transition = (state, type, payload = {}) => deps.transition?.(state, { type, payload }) || state;
    const resolveDropout = async (state, stageId, input) => {
      const policy = deps.stageById?.(state.executionPlan, stageId)?.failurePolicy || 'ask_user';
      if (policy === 'skip_stage') return 'continue';
      if (policy === 'fail_run') return 'stop';
      return deps.resolveParticipantDropout?.(input) || 'stop';
    };
    const stopAfterDropout = async (state, failedModels, stage) => {
      transition(state, 'CANCELLED', { reason: `participant_dropout:${stage}` });
      deps.recordRunFailure?.(`participant_dropout_user_stop:${stage}`);
      await deps.notifyControl?.('CANCELLED', { stage: 'cancelled', reason: 'participant_dropout_user_stop', failedModels });
      deps.notify?.(`Duel остановлен после выбытия: ${failedModels.join(', ')}.`, 'warn');
      return false;
    };
    const retainSingleParticipant = (state, modelName) => deps.fsm?.retainParticipant?.(state, modelName) || state;

    const runner = Object.freeze({
      async start(input = {}) {
        const scenario = input.scenario || {};
        if (!scenario.ok) {
          deps.notify?.(scenario.message || 'Invalid Duel scenario.', 'warn');
          deps.recordRunFailure?.('invalid_serial_scenario');
          await deps.notifyControl?.('FAILED', { stage: 'failed', reason: 'invalid_serial_scenario' });
          return false;
        }
        const explicitSynthesizer = String(input.synthesizer || '').trim();
        if (explicitSynthesizer.toLowerCase() === 'auto') return false;
        const state = deps.protocol?.createState?.() || deps.fsm?.createState?.();
        if (!state) throw new Error('Duel runtime is unavailable');
        const preset = input.presetConfig || {};
        state.active = true;
        state.runId = input.runContext?.pipelineRunId;
        state.sessionId = input.runContext?.sessionId;
        state.moderatorMessage = input.moderatorEntryText;
        state.participants = {
          A: { slot: 'A', model: '', role: '', openingTurnId: null, finalTurnId: null },
          B: { slot: 'B', model: '', role: '', openingTurnId: null, finalTurnId: null }
        };
        deps.fsm?.setParticipants?.(state, {
          modelA: scenario.modelA,
          modelB: scenario.modelB,
          roleA: scenario.roleA,
          roleB: scenario.roleB
        });
        state.modelA = state.participants?.A?.model || scenario.modelA;
        state.modelB = state.participants?.B?.model || scenario.modelB;
        state.roleA = state.participants?.A?.role || scenario.roleA;
        state.roleB = state.participants?.B?.role || scenario.roleB;
        state.topic = input.pipelineNameText;
        state.maxWords = input.maxWords;
        state.taskContract = input.taskContract || deps.createTaskContract?.({ rawRequest: input.pipelineNameText || input.moderatorEntryText, objective: input.pipelineNameText || input.moderatorEntryText, problemSpec: input.problemSpec, maxWords: input.maxWords, runId: state.runId, profileId: preset.profileId || preset.presetId }) || null;
        state.promptTrace = [];
        state.problemSpecText = input.problemSpecText || '';
        state.problemSpec = input.problemSpec || {};
        state.auditRequired = String(preset.synthesisAudit || '').toLowerCase() === 'required'
          || ['factual', 'red_team', 'decision'].includes(String(state.problemSpec.taskType || '').toLowerCase())
          || String(state.problemSpec.evidenceMode || '').toLowerCase() === 'required';
        state.presetId = preset.presetId;
        state.topology = preset.topology;
        state.duration = preset.duration;
        state.terminationOwner = preset.terminationOwner;
        state.checkpointPolicy = preset.checkpointPolicy;
        state.lastCheckpointAtTurn = 0;
        state.finalizationPolicy = preset.finalizationPolicy;
        state.presetConfigSnapshot = preset;
        state.executionPlan = input.executionPlan || null;
        state.roundFilters = [];
        deps.fsm?.beginOpenings?.(state);
        state.synthesizer = explicitSynthesizer;
        state.serviceRoles = deps.resolveServiceRoles?.({ preset, synthesizer: state.synthesizer }) || { synthesizer: state.synthesizer, auditor: '' };
        state.registry = input.registryEnabled ? deps.createRegistry?.({ mode: 'duel' }) || null : null;
        state.autoMode = input.executionPlan?.runPolicy === 'auto';
        state.turnLimit = preset.turnLimit;
        state.turns.publicTurnLimit = preset.turnLimit;
        state.round = 1;
        state.dispatchedTurns = 0;
        state.publicTurnsDispatched = 0;
        state.waitingApprovalModel = '';
        state.newPagesOpenedModels = new Set();
        deps.replaceAggregateState?.(state);
        deps.setState?.(state);
        deps.clearTimeline?.();

        const initialPrompt = deps.buildInitAPrompt?.({
          pipelineName: input.pipelineNameText,
          modelB: scenario.modelB,
          roleA: scenario.roleA,
          moderatorMessage: input.moderatorEntryText,
          problemSpec: input.problemSpecText,
          maxWords: state.maxWords
        });
        const silentInitBPrompt = deps.buildInitBPrompt?.({
          pipelineName: input.pipelineNameText,
          modelA: scenario.modelA,
          roleB: scenario.roleB,
          moderatorMessage: input.moderatorEntryText,
          problemSpec: input.problemSpecText,
          maxWords: state.maxWords
        });
        if (!initialPrompt || !silentInitBPrompt) {
          transition(state, 'FAILED', { reason: 'debate_template_unavailable' });
          deps.recordRunFailure?.('debate_template_unavailable');
          await deps.notifyControl?.('FAILED', { stage: 'failed', reason: 'debate_template_unavailable' });
          deps.notify?.('Dispute template is unavailable.', 'error');
          return false;
        }
        deps.appendModerator?.(input.moderatorEntryText);
        deps.renderCards?.(scenario.roleA, [scenario.modelA], { approvalSelectable: true });
        deps.clearModerator?.();
        timeline('Dispatch', { from: 'Moderator', to: `${scenario.modelA}+${scenario.modelB}`, note: 'параллельная инициализация A0+B0' });
        deps.syncVisualState?.();
        stageEvent('STAGE_STARTED', 'r1:openings', { kind: 'opening_batch', participants: [scenario.modelA, scenario.modelB] });
        stageEvent('BARRIER_OPENED', 'r1:openings', { participants: [scenario.modelA, scenario.modelB], expectedCount: 2 });
        const initResult = await deps.runModelBatch({
          prompt: initialPrompt,
          promptsByModel: { [scenario.modelA]: initialPrompt, [scenario.modelB]: silentInitBPrompt },
          models: [scenario.modelA, scenario.modelB],
          attachments: input.attachmentsPayload || [],
          forceNewTabs: input.forceNewTabs,
          useApiFallback: input.useApiFallback,
          context: { ...(input.makeBatchContext?.(1, 0) || {}), pipelineStageId: 'r1:openings' },
          signal: input.signal
        });
        deps.markNewPageOpened?.(state, scenario.modelA, input.forceNewTabs);
        deps.markNewPageOpened?.(state, scenario.modelB, input.forceNewTabs);

        const recordOpening = (slot, model, role, text) => {
          const turnId = `${state.runId}:opening:${slot}`;
          transition(state, slot === 'A' ? 'DUEL_OPENING_A' : 'DUEL_OPENING_B', { text, turnId });
          deps.fsm?.appendEvent?.(state, {
            turnId, phase: 'opening', slot, model, role, text, source: 'model', publicTurnIndex: null, round: null
          });
          deps.appendRegistryEvent?.(state.registry, { turnId, waveKey: 'duel-opening', model, text });
          return turnId;
        };
        const firstAnswer = String(initResult?.responses?.[scenario.modelA] || '').trim();
        const openingB = String(initResult?.responses?.[scenario.modelB] || '').trim();
          const openingByModel = {
            // Legacy source contract: [scenario.modelA]: !deps.isErrorOutput?.(firstAnswer) ? firstAnswer : ''
            // Legacy source contract: [scenario.modelB]: !deps.isErrorOutput?.(openingB) ? openingB : ''
          [scenario.modelA]: acceptance(firstAnswer, { kind: 'participant', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' }).ok ? firstAnswer : '',
          [scenario.modelB]: acceptance(openingB, { kind: 'participant', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' }).ok ? openingB : ''
        };
        const successfulModels = [scenario.modelA, scenario.modelB].filter((model) => openingByModel[model]);
        const failedModels = [scenario.modelA, scenario.modelB].filter((model) => !openingByModel[model]);
        successfulModels.forEach((model) => stageEvent('BARRIER_PARTICIPANT_READY', 'r1:openings', { model, answerLength: openingByModel[model].length }));
        failedModels.forEach((model) => stageEvent('BARRIER_PARTICIPANT_FAILED', 'r1:openings', { model, reason: 'no_usable_response' }));
        if (firstAnswer && openingByModel[scenario.modelA]) {
          recordOpening('A', scenario.modelA, scenario.roleA, firstAnswer);
          timeline('Response', { from: scenario.modelA, to: 'Moderator', note: firstAnswer.slice(0, 120) });
          deps.syncModeratorRoute?.(scenario.modelA);
        }
        if (openingB && openingByModel[scenario.modelB]) {
          recordOpening('B', scenario.modelB, scenario.roleB, openingB);
          timeline('Response', { from: scenario.modelB, to: 'Moderator', note: 'B0 сохранён как стартовая позиция' });
        }
        if (failedModels.length) {
          stageEvent('DROPOUT_DECISION_REQUESTED', 'r1:openings', { failedModels, remainingModels: successfulModels });
          failedModels.forEach((model) => timeline('Error', { model, note: 'no usable opening response' }));
          const decision = await resolveDropout(state, 'final:words', {
            topology: 'duel', stage: 'opening', failedModels, remainingModels: successfulModels
          }) || 'stop';
          stageEvent(decision === 'retry' ? 'DROPOUT_RETRY_SELECTED' : (decision === 'continue' ? 'DROPOUT_CONTINUE_SELECTED' : 'DROPOUT_STOP_SELECTED'), 'r1:openings', { failedModels, remainingModels: successfulModels });
          if (decision === 'retry') return runner.start(input);
          if (decision !== 'continue') return stopAfterDropout(state, failedModels, 'opening');
          retainSingleParticipant(state, successfulModels[0]);
          deps.syncState?.(state, 'DUEL_PARTICIPANTS_REDUCED');
          deps.notify?.(`Duel продолжен без: ${failedModels.join(', ')}. Переход к финальному слову.`, 'warn');
          stageEvent('STAGE_COMPLETED', 'r1:openings', { droppedModels: failedModels });
          return runner.requestFinalWords(state, input);
        }
        stageEvent('BARRIER_RELEASED', 'r1:openings', { participants: successfulModels, failedModels });
        stageEvent('STAGE_COMPLETED', 'r1:openings');
        const openingFilter = await deps.runRoundFilter?.({
          topic: state.topic,
          topology: 'duel',
          round: 1,
          outputs: deps.getRoundOutputs?.(preset, 1) || [],
          turns: [{ model: scenario.modelA, text: firstAnswer }, { model: scenario.modelB, text: openingB }],
          previousFilter: '',
          synthesizer: state.synthesizer,
          runId: state.runId,
          signal: input.signal,
          stageId: 'r1:filter'
        });
        if (openingFilter) state.roundFilters.push(openingFilter);
        deps.syncState?.(state, 'DUEL_OPENINGS_SYNCED');
        if (deps.fsm?.shouldAutoContinue?.(state, { auto: state.autoMode })) {
          return runner.routeApprovedTurn({ llmName: scenario.modelA, text: firstAnswer }, input);
        }
        state.waitingApprovalModel = scenario.modelA;
        return true;
      },

      async requestFinalWords(state, options = {}) {
        if (!state?.active || state.finalWordsRequested) return true;
        state.finalWordsRequested = true;
        stageEvent('STAGE_STARTED', 'final:words', { kind: 'final_words', participants: [state.modelA, state.modelB].filter(Boolean) });
        const finalModels = [state.modelA, state.modelB].filter(Boolean);
        const successfulFinalModels = [];
        for (const [index, modelName] of finalModels.entries()) {
          const prompt = deps.buildFinalWordPrompt?.(state, modelName);
          if (!prompt) continue;
          timeline('Dispatch', { from: 'Moderator', to: modelName, note: 'запрос финального слова' });
          const result = await deps.runModelBatch({
            prompt,
            models: [modelName],
            attachments: [],
            forceNewTabs: false,
            useApiFallback: options.useApiFallback !== false,
            context: {
              pipelineRunId: state.runId,
              pipelineRoundId: 'final',
              pipelineStageId: 'final:words',
              pipelineBatchId: `${state.runId}:final:${index}:${now()}`
            },
            signal: options.signal || null
          });
          let answer = String(result?.responses?.[modelName] || '').trim();
          let finalWordAttemptId = 'final:words:a1';
          let missing = deps.validateRequiredSections?.(answer, ['Эволюция позиции']) || [];
          if (answer && missing.length) {
            const repair = await deps.runModelBatch({ prompt: `${prompt}\nОтвет неполный. Повтори финальное слово и обязательно добавь секцию «## Эволюция позиции».`, models: [modelName], attachments: [], forceNewTabs: false, useApiFallback: options.useApiFallback !== false, generationProfile: 'long', context: { pipelineRunId: state.runId, pipelineStageId: 'final:words', stageAttemptId: 'final:words:a2' }, signal: options.signal || null });
            answer = String(repair?.responses?.[modelName] || '').trim();
            finalWordAttemptId = 'final:words:a2';
            missing = deps.validateRequiredSections?.(answer, ['Эволюция позиции']) || [];
            if (missing.length) stageEvent('MISSING_REQUIRED_ARTIFACT', 'final:words', { model: modelName, sections: missing });
          }
          const acceptedFinalWord = acceptance(answer, { kind: 'final_word', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
          if (acceptedFinalWord.ok) {
            deps.recordAcceptedResponse?.({ stageId: 'final:words', participant: modelName, attemptId: finalWordAttemptId, text: answer });
            successfulFinalModels.push(modelName);
            if (modelName === state.modelA) state.finalWordA = answer;
            if (modelName === state.modelB) state.finalWordB = answer;
            timeline('Response', { from: modelName, to: 'Moderator', note: 'финальное слово' });
          }
        }
        const failedFinalModels = finalModels.filter((modelName) => !successfulFinalModels.includes(modelName));
        if (failedFinalModels.length) {
          const decision = await resolveDropout(state, 'final:synthesis', {
            topology: 'duel', stage: 'final_words', failedModels: failedFinalModels,
            remainingModels: successfulFinalModels
          }) || 'stop';
          if (decision === 'retry') {
            stageEvent('DROPOUT_RETRY_SELECTED', 'final:words', { failedModels: failedFinalModels, remainingModels: successfulFinalModels });
            state.finalWordsRequested = false;
            return runner.requestFinalWords(state, options);
          }
          if (decision !== 'continue') return stopAfterDropout(state, failedFinalModels, 'final_words');
          retainSingleParticipant(state, successfulFinalModels[0]);
          deps.syncState?.(state, 'DUEL_PARTICIPANTS_REDUCED');
          deps.notify?.(`Duel продолжен без: ${failedFinalModels.join(', ')}${state.synthesizer ? '; затем будет выполнен синтез' : ''}.`, 'warn');
        }
        stageEvent('STAGE_COMPLETED', 'final:words');

        if (!state.synthesizer) {
          transition(state, 'COMPLETED', { reason: 'discussion_completed_without_synthesis' });
          timeline('Completed', { note: 'discussion completed without synthesis' });
          deps.recordFinalization?.({ synthesis: false, reason: 'synthesizer_none' });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: 'synthesizer_none' });
          await deps.handleTerminalOutputs?.(state, 'duel');
          deps.syncVisualState?.();
          return true;
        }

        let synthesizer = String(state.synthesizer || '').trim();
        let synthesisText = '';
        let synthesisAttemptNumber = 0;
        let acceptedSynthesisAttemptId = '';
        const attemptedSynthesizers = new Set();
        while (synthesizer && !attemptedSynthesizers.has(synthesizer)) {
          attemptedSynthesizers.add(synthesizer);
          synthesisAttemptNumber += 1;
          let synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
          stageEvent('STAGE_STARTED', 'final:synthesis', { kind: 'final_synthesis', participants: [synthesizer] });
          const synthesisResult = await deps.runModelBatch({
            prompt: deps.buildFinalSynthesisPrompt?.(state),
            models: [synthesizer],
            attachments: [],
            forceNewTabs: false,
            useApiFallback: options.useApiFallback !== false,
            generationProfile: 'long',
            context: {
              pipelineRunId: state.runId,
              pipelineRoundId: 'duel-final-synthesis',
              pipelineStageId: 'final:synthesis',
              pipelineBatchId: `${state.runId}:duel-final-synthesis:${now()}`,
              stageAttemptId: synthesisAttemptId
            },
            signal: options.signal || null
          });
          synthesisText = String(synthesisResult?.responses?.[synthesizer] || '').trim();
          let acceptedSynthesis = acceptance(synthesisText, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
          let missingSynthesis = deps.validateSynthesisSections?.(synthesisText) || [];
          if (acceptedSynthesis.ok && missingSynthesis.length) {
            synthesisAttemptNumber += 1;
            synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
            const repair = await deps.runModelBatch({
              prompt: `${deps.buildFinalSynthesisPrompt?.(state) || ''}\nОтвет не содержит обязательных секций: ${missingSynthesis.join(', ')}. Выдай полный синтез по заданной структуре.`,
              models: [synthesizer], attachments: [], forceNewTabs: false,
              useApiFallback: options.useApiFallback !== false, generationProfile: 'long',
              context: { pipelineRunId: state.runId, pipelineStageId: 'final:synthesis', stageAttemptId: synthesisAttemptId }, signal: options.signal || null
            });
            synthesisText = String(repair?.responses?.[synthesizer] || '').trim();
            acceptedSynthesis = acceptance(synthesisText, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
            missingSynthesis = deps.validateSynthesisSections?.(synthesisText) || [];
            if (missingSynthesis.length) stageEvent('MISSING_REQUIRED_ARTIFACT', 'final:synthesis', { sections: missingSynthesis });
          }
          if (acceptedSynthesis.ok) {
            acceptedSynthesisAttemptId = synthesisAttemptId;
            break;
          }
          const alternatives = [state.modelA, state.modelB]
            .filter((model) => model && model !== synthesizer && !attemptedSynthesizers.has(model));
          const decision = await resolveDropout(state, 'final:synthesis', {
            topology: 'duel', stage: 'final_synthesis', failedModels: [synthesizer], remainingModels: alternatives
          }) || 'stop';
          if (decision === 'retry') {
            stageEvent('DROPOUT_RETRY_SELECTED', 'final:synthesis', { failedModels: [synthesizer], remainingModels: alternatives });
            attemptedSynthesizers.delete(synthesizer);
            continue;
          }
          if (decision !== 'continue') return stopAfterDropout(state, [synthesizer], 'final_synthesis');
          state.droppedModels = Array.from(new Set([...(state.droppedModels || []), synthesizer]));
          stageEvent('STAGE_SKIPPED', 'final:synthesis', { reasonCode: 'selected_synthesizer_unavailable', participant: synthesizer });
          synthesizer = '';
          state.synthesizer = '';
          transition(state, 'COMPLETED', { reason: 'selected_synthesizer_unavailable' });
          deps.recordFinalization?.({ synthesis: false, reason: 'selected_synthesizer_unavailable' });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: 'selected_synthesizer_unavailable' });
          await deps.handleTerminalOutputs?.(state, 'duel');
          deps.syncVisualState?.();
          return true;
        }
        if (!acceptance(synthesisText, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }).ok) return stopAfterDropout(state, [synthesizer].filter(Boolean), 'final_synthesis');

        state.synthesisText = synthesisText;
        deps.recordAcceptedResponse?.({ stageId: 'final:synthesis', participant: synthesizer, attemptId: acceptedSynthesisAttemptId, text: synthesisText });
          stageEvent('STAGE_COMPLETED', 'final:synthesis');
          if (state.auditRequired && deps.runSynthesisAudit) {
            const auditor = state.serviceRoles?.auditor && state.serviceRoles.auditor !== synthesizer
              ? state.serviceRoles.auditor : '';
            if (!auditor) {
              stageEvent('STAGE_SKIPPED', 'final:audit', { reasonCode: 'auditor_not_selected' });
            } else {
            stageEvent('STAGE_STARTED', 'final:audit', { kind: 'synthesis_audit', participants: auditor ? [auditor] : [] });
            const audit = await deps.runSynthesisAudit({ auditorModel: auditor, synthesisText, roundFilters: state.roundFilters, finalWords: [state.finalWordA, state.finalWordB], context: { pipelineRunId: state.runId } });
            state.synthesisAudit = audit;
            if (audit.status === 'issues_found' && !state.synthesisAuditCorrected) {
              state.synthesisAuditCorrected = true;
              state.synthesisDraft = synthesisText;
              const repair = await deps.runModelBatch({ prompt: `${deps.buildFinalSynthesisPrompt?.(state) || ''}\nАудит нашёл проблемы:\n${audit.text}\nИсправь их и выдай полный синтез.`, models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: options.useApiFallback !== false, generationProfile: 'long', context: { pipelineRunId: state.runId, pipelineStageId: 'final:audit', stageAttemptId: 'final:audit:repair:a1' }, signal: options.signal || null });
              const corrected = String(repair?.responses?.[synthesizer] || '').trim();
              if (acceptance(corrected, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }).ok) {
                synthesisText = corrected;
                state.synthesisText = corrected;
                deps.recordAcceptedResponse?.({ stageId: 'final:audit', participant: synthesizer, attemptId: 'final:audit:repair:a1', text: corrected });
              }
            }
            stageEvent(audit.status === 'skipped' ? 'STAGE_SKIPPED' : 'STAGE_COMPLETED', 'final:audit', { reasonCode: audit.reason || audit.status });
            }
          }
        deps.appendVerdict?.(synthesisText, { title: 'Final Synthesis', source: `serial:${synthesizer}` });
        timeline('Verdict', { from: synthesizer, to: 'Moderator', note: 'Duel Final Synthesis' });
        transition(state, 'COMPLETED', { reason: 'final_synthesis_completed' });
        timeline('Completed', { note: `round limit reached (${deps.getRoundLimit?.()} rounds)` });
        await deps.notifyControl?.('COMPLETED', { stage: 'completed' });
        await deps.handleTerminalOutputs?.(state, 'duel');
        deps.syncVisualState?.();
        return true;
      },

      async runTurnWithRetry({ state, targetModel, prompt, contextParts = [], forceNewTabs, signal, useApiFallback = true }) {
        let lastError = null;
        const retryLimit = Math.max(0, Number(deps.autoRetryLimit || 0));
        const maxAttempts = state?.autoMode ? retryLimit + 1 : 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          if (attempt > 1) stageEvent('RECOVERY_ATTEMPT_STARTED', `r${state.round}:turn`, { model: targetModel, attempt, strategy: 'auto_retry' });
          try {
            const result = await deps.runModelBatch({
              prompt,
              models: [targetModel],
              attachments: [],
              forceNewTabs,
              useApiFallback,
              context: {
                pipelineRunId: state.runId,
                pipelineRoundId: `serial-r${state.round}`,
                pipelineStageId: `r${state.round}:turn:${(Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0) % 2) + 1}`,
                pipelineBatchId: `${state.runId}:serial:${now()}`,
                stageAttemptId: `r${state.round}:turn:${(Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0) % 2) + 1}:a${attempt}`,
                contextParts
              },
              signal
            });
            const correlation = deps.validateCorrelation?.(result?.pipelineContext || result?.context || {}, { pipelineRunId: state.runId, pipelineStageId: `r${state.round}:turn:${(Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0) % 2) + 1}`, stageAttemptId: `r${state.round}:turn:${(Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0) % 2) + 1}:a${attempt}` });
            if (correlation && !correlation.ok) { stageEvent(correlation.reason, `r${state.round}:turn`, { reasonCode: correlation.reason, field: correlation.field }); lastError = new Error(correlation.reason); continue; }
            const answer = String(result?.responses?.[targetModel] || '').trim();
            const accepted = acceptance(answer, { kind: 'participant', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' });
            if (accepted.ok) {
              const stageId = `r${state.round}:turn:${(Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0) % 2) + 1}`;
              deps.recordAcceptedResponse?.({ stageId, participant: targetModel, attemptId: `${stageId}:a${attempt}`, text: answer });
              if (attempt > 1) stageEvent('RECOVERY_ATTEMPT_SUCCEEDED', `r${state.round}:turn`, { model: targetModel, attempt, strategy: 'auto_retry' });
              return { ok: true, result, answer, attempts: attempt };
            }
            lastError = new Error(accepted.reason || 'empty_response');
            stageEvent('ANSWER_REJECTED', `r${state.round}:turn`, { model: targetModel, reasonCode: accepted.reason });
          } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw error;
            lastError = error;
          }
          if (attempt > 1) stageEvent('RECOVERY_ATTEMPT_FAILED', `r${state.round}:turn`, { model: targetModel, attempt, strategy: 'auto_retry', reason: lastError?.message || 'no_usable_response' });
          if (attempt < maxAttempts) {
            timeline('Retry', {
              model: targetModel,
              note: `auto retry ${attempt}/${retryLimit}: ${lastError?.message || 'no usable response'}`
            });
            deps.notify?.(`${targetModel}: retrying empty/error debate turn.`, 'warn');
            await deps.sleep?.(deps.autoRetryDelayMs || 0);
          }
        }
        return { ok: false, error: lastError, attempts: maxAttempts };
      },

      async routeApprovedTurn(initial = {}, options = {}) {
        let current = initial;
        while (true) {
          const state = deps.getState?.();
          const currentModel = String(current?.llmName || '').trim();
          const currentText = String(current?.text || '').trim();
          if (!state?.active || !currentText || !currentModel) return false;
          if (!deps.fsm?.canRoutePublic?.(state)) return false;
          if (state.waitingApprovalModel && state.waitingApprovalModel !== currentModel) return false;
          if (deps.fsm?.hasReachedTurnLimit?.(state)) return runner.requestFinalWords(state, options);

          const route = deps.prepareRoute?.(state, { currentModel, currentText });
          if (!route?.targetModel || !route.prompt) return false;
          transition(state, 'DUEL_TURN_ROUTED', { llmName: currentModel, targetModel: route.targetModel });
          state.lastText = currentText;
          const publicTurnIndex = Number(state.turns?.publicTurnsDispatched || state.publicTurnsDispatched || 0);
          state.round = route.protocolRound;
          deps.recordRoute?.(state, { ...route, currentModel, currentText, publicTurnIndex });
          timeline('Approved', { from: currentModel, to: 'Moderator', note: currentText.slice(0, 120) });
          timeline('Dispatch', { from: 'Moderator', to: route.targetModel, note: 'approved opponent answer + moderator header' });
          deps.renderCards?.(route.targetIsA ? state.roleA : state.roleB, [route.targetModel], { approvalSelectable: true });
          deps.syncVisualState?.();

          try {
            const stageId = `r${route.protocolRound}:turn:${(publicTurnIndex % 2) + 1}`;
            stageEvent('STAGE_STARTED', stageId, { kind: 'public_turn', participants: [route.targetModel] });
            const outcome = await runner.runTurnWithRetry({
              state,
              targetModel: route.targetModel,
              prompt: route.prompt,
              contextParts: route.contextParts || [],
              forceNewTabs: false,
              signal: options.signal || null,
              useApiFallback: options.useApiFallback !== false
            });
            deps.markNewPageOpened?.(state, route.targetModel, false);
            if (!outcome.ok) {
              const reason = outcome.error?.message || 'no usable response';
              timeline('Error', { model: route.targetModel, note: `no usable response after ${outcome.attempts || 1} attempt(s): ${reason}` });
              const decision = await resolveDropout(state, stageId, {
                topology: 'duel', stage: `round_${route.protocolRound}`,
                failedModels: [route.targetModel], remainingModels: [currentModel]
              }) || 'stop';
              if (decision === 'retry') {
                stageEvent('DROPOUT_RETRY_SELECTED', stageId, { failedModels: [route.targetModel], remainingModels: [currentModel] });
                continue;
              }
              if (decision !== 'continue') return stopAfterDropout(state, [route.targetModel], `round_${route.protocolRound}`);
              retainSingleParticipant(state, currentModel);
              deps.syncState?.(state, 'DUEL_PARTICIPANTS_REDUCED');
              deps.setPaused?.(false, '');
              deps.notify?.(`Duel продолжен без ${route.targetModel}. Переход к финальному слову.`, 'warn');
              return runner.requestFinalWords(state, options);
            }

            const answer = outcome.answer;
            stageEvent('STAGE_COMPLETED', stageId);
            deps.recordAnswer?.(state, { ...route, currentModel, answer, publicTurnIndex });
            state.waitingApprovalModel = state.autoMode ? '' : route.targetModel;
            timeline('Response', { from: route.targetModel, to: 'Moderator', note: answer.slice(0, 120) });
            if (publicTurnIndex % 2 === 0) {
              const roundTurns = (state.eventLog || []).filter((event) => event.phase === 'public').slice(-2)
                .map((event) => ({ model: event.model, text: event.text }));
              const filter = await deps.runRoundFilter?.({
                topic: state.topic,
                topology: 'duel',
                round: route.protocolRound,
                outputs: route.roundOutputs,
                turns: roundTurns,
                previousFilter: route.previousFilter,
                synthesizer: state.synthesizer,
                runId: state.runId,
                signal: options.signal || null,
                stageId: `r${route.protocolRound}:filter`
                ,maxWords: state.maxWords
              });
              if (filter) state.roundFilters.push(filter);
            }
            await deps.runCheckpoint?.(state);
            deps.syncState?.(state, 'DUEL_TURN_ARTIFACTS_SYNCED');
            deps.syncVisualState?.();
            if (deps.fsm?.shouldAutoContinue?.(state, { auto: state.autoMode })) {
              if (options.isPaused?.()) {
                state.pendingAutoContinuation = { llmName: route.targetModel, text: answer };
                state.waitingApprovalModel = route.targetModel;
                deps.fsm?.markPaused?.(state);
                deps.syncState?.(state, 'DUEL_PAUSED_BY_MODERATOR');
                timeline('Paused', { note: 'auto debate paused by moderator' });
                deps.syncVisualState?.();
                return true;
              }
              current = { llmName: route.targetModel, text: answer };
              continue;
            }
            if (state.autoMode && deps.fsm?.hasReachedTurnLimit?.(state)) {
              await runner.requestFinalWords(state, options);
            }
            return true;
          } catch (error) {
            if (error?.name === 'AbortError' || options.signal?.aborted) throw error;
            timeline('Error', { model: route.targetModel, note: error?.message || 'dispatch failed' });
            const decision = await resolveDropout(state, stageId, {
              topology: 'duel', stage: `round_${route.protocolRound}`,
              failedModels: [route.targetModel], remainingModels: [currentModel]
            }) || 'stop';
            if (decision === 'retry') {
              stageEvent('DROPOUT_RETRY_SELECTED', stageId, { failedModels: [route.targetModel], remainingModels: [currentModel] });
              continue;
            }
            if (decision !== 'continue') return stopAfterDropout(state, [route.targetModel], `round_${route.protocolRound}`);
            retainSingleParticipant(state, currentModel);
            deps.syncState?.(state, 'DUEL_PARTICIPANTS_REDUCED');
            deps.setPaused?.(false, '');
            deps.notify?.(`Duel продолжен без ${route.targetModel}. Переход к финальному слову.`, 'warn');
            return runner.requestFinalWords(state, options);
          }
        }
      }
    });
    return runner;
  }

  const api = Object.freeze({ createDuelRunner });
  root.DuelRunner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

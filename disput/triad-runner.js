// Application-level sequencing for the Triad topology.
(function initTriadRunner(root) {
  'use strict';

  function createTriadRunner(deps = {}) {
    const acceptance = deps.acceptResponse || ((text) => ({ ok: Boolean(String(text || '').trim()) && !deps.isErrorOutput?.(String(text || '').trim()), reason: '' }));
    const timeline = typeof deps.timeline === 'function' ? deps.timeline : () => {};
    const stageEvent = (type, stageId, payload = {}) => deps.recordStageEvent?.(type, { stageId, ...payload });
    const transition = (state, type, payload = {}) => deps.transition?.(state, { type, payload }) || state;
    const resolveDropout = async (state, stageId, input) => {
      const policy = deps.stageById?.(state.executionPlan, stageId)?.failurePolicy || 'ask_user';
      if (policy === 'skip_stage') return 'continue';
      if (policy === 'fail_run') return 'stop';
      return deps.resolveParticipantDropout?.(input) || 'stop';
    };
    const selectStageModels = (state, round) => {
      const configuredRoles = state.presetConfigSnapshot?.stageRoles?.[String(round)];
      const roleNames = Array.isArray(configuredRoles) ? configuredRoles.map((role) => String(role || '').toLowerCase()) : [];
      const presetRoles = Array.isArray(state.presetConfigSnapshot?.roles) ? state.presetConfigSnapshot.roles : [];
      if (!roleNames.length) return state.models.slice();
      const outputs = deps.getRoundOutputs?.(state.presetConfigSnapshot, round) || [];
      const independentRetest = outputs.some((id) => /independent_retest|retest_report/i.test(String(id)));
      const used = new Set();
      return roleNames.map((role, requestedIndex) => {
        const candidates = state.models.filter((model, modelIndex) => String(presetRoles[modelIndex] || '').toLowerCase() === role && !used.has(model));
        const candidate = independentRetest && role === 'critical' ? candidates.at(-1) : candidates[0];
        const selected = candidate || state.models.find((model) => !used.has(model)) || state.models[requestedIndex];
        if (selected) used.add(selected);
        return selected;
      }).filter(Boolean);
    };
    const stopAfterDropout = async (state, failedModels, stage) => {
      transition(state, 'CANCELLED', { reason: `participant_dropout:${stage}` });
      await deps.notifyControl?.('CANCELLED', { stage: 'cancelled', reason: 'participant_dropout_user_stop', failedModels });
      deps.notify?.(`Triad остановлен после выбытия: ${failedModels.join(', ')}.`, 'warn');
      deps.finalizeRuntime?.();
      return false;
    };

    const runner = Object.freeze({
      async start(input = {}) {
        const selected = (input.selectedModels || []).slice(0, 3);
        if (selected.length < 3) {
          deps.notify?.('Triad: выберите минимум три модели в шапке.', 'warn');
          return false;
        }
        const explicitSynthesizer = String(input.synthesizer || '').trim();
        if (explicitSynthesizer.toLowerCase() === 'auto') return false;
        if (input.otherTopologyActive) {
          deps.notify?.('Диспут уже идёт. Остановите текущий, прежде чем начать новый.', 'warn');
          return false;
        }
        const state = deps.protocol?.createState?.() || null;
        if (!state) {
          deps.notify?.('Triad runtime is unavailable.', 'error');
          return false;
        }
        const preset = input.presetConfig || {};
        state.active = true;
        state.runId = input.runContext?.pipelineRunId;
        state.sessionId = input.runContext?.sessionId;
        state.moderatorMessage = input.moderatorEntryText;
        state.models = selected;
        state.role = input.role || '';
        state.topic = input.pipelineNameText;
        state.maxWords = input.maxWords;
        state.taskContract = input.taskContract || deps.createTaskContract?.({ rawRequest: input.pipelineNameText || input.moderatorEntryText, objective: input.pipelineNameText || input.moderatorEntryText, problemSpec: input.problemSpec, maxWords: input.maxWords, runId: state.runId, profileId: preset.profileId || preset.presetId }) || null;
        state.promptTrace = [];
        state.problemSpecText = input.problemSpecText || '';
        state.problemSpec = input.problemSpec || {};
        state.auditRequired = String(preset.synthesisAudit || '').toLowerCase() === 'required'
          || ['factual', 'red_team', 'decision'].includes(String(state.problemSpec.taskType || '').toLowerCase())
          || String(state.problemSpec.evidenceMode || '').toLowerCase() === 'required';
        state.presetId = preset.presetId || 'TRIAD_STANDARD';
        state.topology = preset.topology || 'triad';
        state.duration = preset.duration || 'fixed';
        state.terminationOwner = preset.terminationOwner || 'runtime';
        const configuredRounds = preset.waveLimit;
        state.maxWaves = configuredRounds == null ? input.defaultWaveLimit : Math.max(0, Number(configuredRounds) - 1);
        state.waveLimit = configuredRounds == null ? null : Math.max(0, Number(configuredRounds) - 1);
        state.completedWaves = 0;
        state.checkpointPolicy = preset.checkpointPolicy || state.checkpointPolicy;
        state.lastCheckpointAtWave = 0;
        state.finalizationPolicy = preset.finalizationPolicy || 'auto_after_limit';
        state.presetConfigSnapshot = preset;
        state.executionPlan = input.executionPlan || null;
        state.autoMode = input.auto;
        state.synthesizer = explicitSynthesizer;
        state.serviceRoles = deps.resolveServiceRoles?.({ preset, synthesizer: state.synthesizer }) || { synthesizer: state.synthesizer, auditor: '' };
        state.attachments = Array.isArray(input.attachmentsPayload) ? input.attachmentsPayload : [];
        state.finalWordsRequested = false;
        state.roundFilters = [];
        state.pendingWaveContinuation = null;
        state.newPagesOpenedModels = new Set();
        state.registry = input.registryEnabled ? deps.createRegistry?.({ mode: 'triad' }) || null : null;
        deps.fsm?.beginInitWave?.(state);
        transition(state, 'RUNNING');
        deps.replaceAggregateState?.(state);
        deps.setState?.(state);
        deps.clearTimeline?.();
        deps.setRunPresentation?.({ activeRole: state.role, maxTurns: state.waveLimit ?? 0 });
        deps.appendModerator?.(input.moderatorEntryText);
        deps.clearModerator?.();
        return runner.dispatchWave(state, 'init', input);
      },

      async dispatchWave(state, kind = 'init', options = {}) {
        const api = deps.templates;
        if (!state?.active || !api) return false;
        const isInit = kind === 'init';
        const waveNumber = isInit ? 0 : Number(state.wave || 0) + 1;
        const protocolRound = isInit ? 1 : waveNumber + 1;
        const attemptNumber = Math.max(1, Number(options.stageAttemptNumber || 1));
        const presetRoles = Array.isArray(state.presetConfigSnapshot?.roles) ? state.presetConfigSnapshot.roles : [];
        const models = selectStageModels(state, isInit ? 1 : protocolRound);
        const waveKey = isInit ? 'init-0' : `wave-${waveNumber}`;
        const moderatorText = isInit ? state.moderatorMessage : deps.getModeratorText?.();
        if (!isInit && moderatorText) {
          deps.appendModerator?.(moderatorText);
          deps.clearModerator?.();
        }
        const promptsByModel = {};
        const contextPartsByModel = {};
        models.forEach((modelName) => {
          const roundOutputs = deps.getRoundOutputs?.(state.presetConfigSnapshot, protocolRound) || [];
          const assembled = !isInit
            ? deps.assembleContext?.({ topology: 'triad', stageKind: 'participant_wave', stagePhase: deps.resolveStagePhase?.({ roundOutputs, round: protocolRound }) || 'critique', state: { ...state, ownPosition: state.positions?.[modelName] || '' }, policy: state.presetConfigSnapshot?.contextPolicy || 'filtered' }) || { parts: [], omitted: [] }
            : { parts: [], omitted: [] };
          assembled.omitted.forEach((item) => stageEvent('LEGACY_DIAGNOSTIC_EVENT', `r${protocolRound}:wave`, { reasonCode: item.reason, omittedId: item.id }));
          contextPartsByModel[modelName] = assembled.parts;
          const regView = !isInit && state.registry
            ? deps.serializeRegistryForModel?.(state.registry, modelName) || { context: '', primaryTrigger: '' }
            : { context: '', primaryTrigger: '' };
          const protocolMission = deps.getProtocolMission?.(state.presetConfigSnapshot) || '';
          const modelIndex = state.models.indexOf(modelName);
          const modelRole = deps.resolveRole?.(modelIndex, presetRoles[modelIndex]) || presetRoles[modelIndex] || state.role;
          const phase = isInit ? 'opening' : (deps.resolveStagePhase?.({ roundOutputs, round: protocolRound }) || 'critique');
          const operation = phase === 'defence' || phase === 'response' ? 'response' : phase === 'retest' ? 'verification' : phase === 'resolution' ? 'final_position' : phase === 'opening' ? 'opening' : 'critique';
          const action = operation === 'critique' ? { action: 'critique_claim', role: 'critic' } : operation === 'response' ? { action: 'resolve_blocker', role: 'defender' } : operation === 'verification' ? { action: 'recheck_revision', role: 'verifier' } : null;
          const stageTask = moderatorText && !isInit ? (deps.evolveTaskContract?.(state.taskContract, { currentInstruction: moderatorText }) || state.taskContract) : state.taskContract;
          const compiled = deps.compilePrompt?.({
            task: stageTask || { objective: state.topic, maxWords: state.maxWords }, action,
            profile: state.presetConfigSnapshot?.promptPack ? { promptPack: state.presetConfigSnapshot.promptPack } : null,
            stage: { stageId: `r${protocolRound}:wave`, operation, role: action?.role || 'participant', lens: modelRole, outputContract: { maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' } },
            model: modelName,
            contextParts: [
              ...assembled.parts,
              { id: 'registry', type: 'state', label: 'Состояние дела', text: regView.context, trust: 'system', priority: 'high' },
              { id: 'filter', type: 'state', label: 'Предыдущее состояние', text: state.roundFilters?.at?.(-1)?.text || '', trust: 'system' }
            ].filter((part) => part.text),
            turns: isInit ? [] : (deps.fsm?.opponentsFor?.(state, modelName) || []).map((turn, index) => ({ ...turn, turnId: turn.turnId || `peer-${index + 1}` }))
          });
          if (compiled) {
            state.promptTrace.push({ stageId: compiled.stage.stageId, model: modelName, fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, contextIds: compiled.context.parts.map((part) => part.id) });
            stageEvent('PROMPT_COMPILED', compiled.stage.stageId, { model: modelName, fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, contextIds: compiled.context.parts.map((part) => part.id) });
          }
          promptsByModel[modelName] = compiled?.prompt || (isInit
            ? api.buildTriadInitPrompt({
              topic: state.topic,
              problemSpec: state.problemSpecText,
              role: modelRole,
              mission: protocolMission,
              format: deps.getDefaultFormat?.(),
              moderatorMessage: state.moderatorMessage,
              roundOutputs,
              maxWords: state.maxWords
            })
            : api.buildTriadWavePrompt({
              topic: state.topic,
              problemSpec: state.problemSpecText,
              role: modelRole,
              mission: protocolMission,
              waveNumber,
              opponents: assembled.parts.length ? [] : deps.fsm?.opponentsFor?.(state, modelName),
              contextParts: assembled.parts,
              moderatorText,
              format: deps.getDefaultFormat?.(),
              registryContext: regView.context,
              primaryTrigger: regView.primaryTrigger,
              operationalSignals: regView.operationalSignals,
              roundOutputs,
              previousFilter: state.roundFilters?.at?.(-1)?.text || '',
              maxWords: state.maxWords
            }));
        });
        if (!isInit && state.registry) {
          deps.recordRegistryRoute?.(state.registry, {
            mode: 'triad', wave: waveNumber, fromModels: models, toModels: models,
            reason: 'wave_dispatch', primaryTriggerId: null
          });
        }
        const sanitizedMap = deps.sanitizePromptsByModel?.(promptsByModel) || promptsByModel;
        const openingTexts = isInit ? (state.positions || {}) : {};
        if (isInit && Object.values(openingTexts).some((value) => String(value || '').trim())) {
          deps.assertBlindOpening?.(promptsByModel, openingTexts);
        }
        if (!sanitizedMap || !models.every((modelName) => sanitizedMap[String(modelName).trim().toUpperCase()])) {
          transition(state, 'FAILED', { reason: 'prompt_sanitization_failed' });
          deps.notify?.('Triad: не удалось построить полную карту промптов волны.', 'error');
          deps.finalizeRuntime?.();
          return false;
        }
        state.currentWaveKind = isInit ? 'init' : 'wave';
        state.currentWaveKey = waveKey;
        state.waitingWaveApproval = !options.auto;
        timeline('Dispatch', {
          from: 'Moderator', to: models.join('+'),
          note: isInit ? 'триада: изолированная стартовая волна' : `триада: волна ${waveNumber}`
        });
        deps.renderCards?.(state.role, models, { approvalSelectable: !options.auto });
        deps.tagWaveCards?.(state, waveKey, models);
        deps.syncVisualState?.();
        const stageId = `r${protocolRound}:wave`;
        const stageAttemptId = `${stageId}:a${attemptNumber}`;
        stageEvent('STAGE_STARTED', stageId, { kind: isInit ? 'opening_batch' : 'wave_batch', participants: models });
        stageEvent('BARRIER_OPENED', stageId, { participants: models, expectedCount: models.length });
        const result = await deps.runModelBatch({
          prompt: sanitizedMap[String(models[0]).trim().toUpperCase()],
          promptsByModel,
          models,
          attachments: isInit ? (state.attachments || []) : [],
          forceNewTabs: isInit && options.forceNewTabs !== false,
          useApiFallback: options.useApiFallback !== false,
          generationProfile: 'long',
          context: {
            ...(deps.makeBatchContext?.(state, isInit ? 'triad-w0' : `triad-w${waveNumber}`) || {}),
            pipelineStageId: `r${protocolRound}:wave`,
            stageAttemptId
            ,contextPartsByModel
          },
          signal: options.signal || null
        });
        let usableCount = 0;
        const waveTurns = [];
        models.forEach((modelName) => {
          const answer = String(result?.responses?.[modelName] || '').trim();
          const correlation = deps.validateCorrelation?.(result?.contexts?.[modelName] || result?.pipelineContext || {}, { pipelineRunId: state.runId, pipelineStageId: stageId, stageAttemptId }) || { ok: true };
          const accepted = deps.acceptResponse?.(answer, { kind: 'participant', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer', isErrorOutput: deps.isErrorOutput }) || { ok: Boolean(answer) && !deps.isErrorOutput?.(answer) };
          if (correlation.ok && accepted.ok) {
            stageEvent('BARRIER_PARTICIPANT_READY', stageId, { model: modelName, answerLength: answer.length });
            usableCount += 1;
            waveTurns.push({ turnId: deps.makeTurnId?.(waveKey, modelName), model: modelName, text: answer });
          } else {
            stageEvent(correlation.ok ? 'BARRIER_PARTICIPANT_FAILED' : 'CORRELATION_REJECTED', stageId, { model: modelName, reason: correlation.ok ? (accepted.reason || 'no_usable_response') : correlation.reason });
            timeline('Error', { model: modelName, note: isInit ? 'no usable init response' : 'triad wave skipped by model' });
            if (!isInit) {
              deps.notify?.(`Triad: ${modelName} пропустила волну ${waveNumber}.`, 'warn');
              deps.markSkippedCard?.(state, modelName, waveKey);
            }
          }
        });
        const successfulModels = waveTurns.map((turn) => turn.model);
        const failedModels = models.filter((modelName) => !successfulModels.includes(modelName));
        if (failedModels.length) {
          const remainingModels = state.models.filter((modelName) => !failedModels.includes(modelName));
          stageEvent('DROPOUT_DECISION_REQUESTED', stageId, { failedModels, remainingModels });
          const decision = await resolveDropout(state, stageId, {
            topology: 'triad', stage: isInit ? 'opening' : `wave_${waveNumber}`,
            failedModels, remainingModels
          }) || 'stop';
          stageEvent(decision === 'retry' ? 'DROPOUT_RETRY_SELECTED' : (decision === 'continue' ? 'DROPOUT_CONTINUE_SELECTED' : 'DROPOUT_STOP_SELECTED'), stageId, { failedModels, remainingModels });
          if (decision === 'retry') {
            stageEvent('RECOVERY_ATTEMPT_STARTED', stageId, { attempt: attemptNumber + 1, strategy: 'manual_stage_retry' });
            return runner.dispatchWave(state, kind, { ...options, stageAttemptNumber: attemptNumber + 1 });
          }
          if (decision !== 'continue') return stopAfterDropout(state, failedModels, isInit ? 'opening' : `wave_${waveNumber}`);
          deps.fsm?.retainParticipants?.(state, remainingModels);
          deps.syncState?.(state, 'TRIAD_PARTICIPANTS_REDUCED');
          deps.notify?.(`Triad продолжен без: ${failedModels.join(', ')}.`, 'warn');
        }
        state.responsesByWave = Array.isArray(state.responsesByWave) ? state.responsesByWave : [];
        if (waveTurns.length) state.responsesByWave.push(waveTurns.slice());
        waveTurns.forEach(({ model, text }) => {
          transition(state, isInit ? 'TRIAD_INIT_ANSWER' : 'TRIAD_WAVE_ANSWER', { model, text, ...(isInit ? {} : { wave: waveNumber }) });
          deps.recordAcceptedResponse?.({ stageId, participant: model, attemptId: stageAttemptId, text });
          deps.appendFeed?.(model, text, '', { role: state.role, status: 'SUCCESS', finalStatus: 'SUCCESS' });
          timeline('Response', { from: model, to: 'Moderator', note: text.slice(0, 120) });
        });
        deps.tagWaveCards?.(state, waveKey, models);
        if (isInit && !deps.fsm?.allInitCaptured?.(state)) {
          transition(state, 'FAILED', { reason: 'triad_openings_incomplete' });
          deps.notify?.('Triad: не получены стартовые позиции всех трёх участников.', 'error');
          deps.finalizeRuntime?.();
          return false;
        }
        if (!isInit && usableCount === 0) {
          transition(state, 'FAILED', { reason: 'triad_wave_empty' });
          deps.notify?.('Triad: все три ответа волны пустые или ошибочные.', 'error');
          deps.finalizeRuntime?.();
          return false;
        }
        stageEvent('BARRIER_RELEASED', stageId, { participants: successfulModels, failedModels });
        stageEvent('STAGE_COMPLETED', stageId);
        const roundFilter = await deps.runRoundFilter?.({
          topic: state.topic,
          topology: 'triad',
          round: protocolRound,
          outputs: deps.getRoundOutputs?.(state.presetConfigSnapshot, protocolRound) || [],
          turns: waveTurns,
          previousFilter: state.roundFilters?.at?.(-1)?.text || '',
          synthesizer: state.synthesizer,
          runId: state.runId,
          signal: options.signal || null,
          stageId: `r${protocolRound}:filter`
        });
        if (roundFilter) state.roundFilters.push(roundFilter);
        const checkpointEvery = Number(state.checkpointPolicy?.everyWaves || 0);
        const checkpointDue = state.checkpointPolicy?.enabled && checkpointEvery > 0
          && protocolRound % checkpointEvery === 0 && protocolRound > Number(state.lastCheckpointAtWave || 0);
        if (options.registryEnabled && state.registry && checkpointDue) {
          await deps.runCheckpoint?.(state, { waveKey, waveNumber: protocolRound, turns: waveTurns });
        }
        deps.syncState?.(state, 'TRIAD_WAVE_ARTIFACTS_SYNCED');
        if (options.auto) {
          deps.markWaveCardsApproved?.(state, waveKey);
          return runner.completeBarrier(state, options);
        }
        deps.updateButtons?.();
        return true;
      },

      async finalize(state, options = {}) {
        if (!state?.active || state.finalWordsRequested) return true;
        state.finalWordsRequested = true;
        const api = deps.templates;
        if (api?.buildTriadFinalWordPrompt) {
          stageEvent('STAGE_STARTED', 'final:words', { kind: 'final_words', participants: state.models });
          stageEvent('BARRIER_OPENED', 'final:words', { participants: state.models, expectedCount: state.models.length });
          state.currentWaveKind = 'final';
          state.currentWaveKey = 'final';
          deps.syncVisualState?.();
          timeline('Dispatch', { from: 'Moderator', to: state.models.join('+'), note: 'триада: финальные слова' });
          deps.renderCards?.(state.role, state.models, { approvalSelectable: false });
          deps.tagWaveCards?.(state, 'final', state.models);
          const promptsByModel = Object.fromEntries(state.models.map((modelName) => [
            modelName,
            deps.compilePrompt?.({
              task: state.taskContract || { objective: state.topic, maxWords: state.maxWords },
              profile: state.presetConfigSnapshot?.promptPack ? { promptPack: state.presetConfigSnapshot.promptPack } : null,
              stage: { stageId: 'final:words', operation: 'final_position', role: 'participant', outputContract: { maxWords: state.maxWords, requiredSections: ['Эволюция позиции'] } },
              model: modelName,
              contextParts: [
                { id: 'own_position', type: 'turn', label: 'Последняя позиция', text: state.positions[modelName] || '', trust: 'model', priority: 'high' },
                { id: 'filtered_state', type: 'state', label: 'Состояние раундов', text: deps.formatRoundFilters?.(state.roundFilters) || '', trust: 'system', priority: 'high' }
              ]
            })?.prompt || api.buildTriadFinalWordPrompt({
              topic: state.topic,
              problemSpec: state.problemSpecText,
              position: state.positions[modelName] || '',
              filteredState: deps.formatRoundFilters?.(state.roundFilters) || '',
              maxWords: state.maxWords
            })
          ]));
          const result = await deps.runModelBatch({
            prompt: promptsByModel[state.models[0]],
            promptsByModel,
            models: state.models,
            attachments: [],
            forceNewTabs: false,
            useApiFallback: options.useApiFallback !== false,
            generationProfile: 'long',
            context: { ...(deps.makeBatchContext?.(state, 'triad-final') || {}), pipelineStageId: 'final:words' },
            signal: options.signal || null
          });
          const successfulFinalModels = [];
          for (const modelName of state.models) {
            let answer = String(result?.responses?.[modelName] || '').trim();
            let finalWordAttemptId = 'final:words:a1';
            const missing = deps.validateRequiredSections?.(answer, ['Эволюция позиции']) || [];
            if (answer && missing.length) {
              const repair = await deps.runModelBatch({
                prompt: `${promptsByModel[modelName]}\nОтвет неполный. Повтори финальное слово и обязательно добавь секцию «## Эволюция позиции».`,
                models: [modelName], attachments: [], forceNewTabs: false,
                useApiFallback: options.useApiFallback !== false, generationProfile: 'long',
                context: { ...(deps.makeBatchContext?.(state, 'triad-final-repair') || {}), pipelineStageId: 'final:words', stageAttemptId: 'final:words:a2' }, signal: options.signal || null
              });
              answer = String(repair?.responses?.[modelName] || '').trim();
              finalWordAttemptId = 'final:words:a2';
              if (deps.validateRequiredSections?.(answer, ['Эволюция позиции'])?.length) stageEvent('MISSING_REQUIRED_ARTIFACT', 'final:words', { model: modelName, sections: ['Эволюция позиции'] });
            }
            const accepted = acceptance(answer, { kind: 'final_word', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
            if (accepted.ok) {
              deps.recordAcceptedResponse?.({ stageId: 'final:words', participant: modelName, attemptId: finalWordAttemptId, text: answer });
              stageEvent('BARRIER_PARTICIPANT_READY', 'final:words', { model: modelName, answerLength: answer.length });
              successfulFinalModels.push(modelName);
              state.finalWords[modelName] = answer;
              deps.appendFeed?.(modelName, answer, '', {
                role: state.role,
                status: 'SUCCESS',
                finalStatus: 'SUCCESS'
              });
              timeline('Response', { from: modelName, to: 'Moderator', note: 'финальное слово' });
            }
            if (!accepted.ok) stageEvent('BARRIER_PARTICIPANT_FAILED', 'final:words', { model: modelName, reason: accepted.reason || 'no_usable_response' });
          }
          const failedFinalModels = state.models.filter((modelName) => !successfulFinalModels.includes(modelName));
          if (failedFinalModels.length) {
            stageEvent('DROPOUT_DECISION_REQUESTED', 'final:words', { failedModels: failedFinalModels, remainingModels: successfulFinalModels });
            const decision = await resolveDropout(state, 'final:words', {
              topology: 'triad', stage: 'final_words', failedModels: failedFinalModels,
              remainingModels: successfulFinalModels
            }) || 'stop';
            stageEvent(decision === 'retry' ? 'DROPOUT_RETRY_SELECTED' : (decision === 'continue' ? 'DROPOUT_CONTINUE_SELECTED' : 'DROPOUT_STOP_SELECTED'), 'final:words', { failedModels: failedFinalModels, remainingModels: successfulFinalModels });
            if (decision === 'retry') {
              state.finalWordsRequested = false;
              return runner.finalize(state, options);
            }
            if (decision !== 'continue') return stopAfterDropout(state, failedFinalModels, 'final_words');
            deps.fsm?.retainParticipants?.(state, successfulFinalModels);
            deps.syncState?.(state, 'TRIAD_PARTICIPANTS_REDUCED');
            deps.notify?.(`Triad продолжен без: ${failedFinalModels.join(', ')}${state.synthesizer ? '; затем будет выполнен синтез' : ''}.`, 'warn');
          }
          deps.markWaveCardsApproved?.(state, 'final');
          stageEvent('BARRIER_RELEASED', 'final:words', { participants: successfulFinalModels, failedModels: failedFinalModels });
          stageEvent('STAGE_COMPLETED', 'final:words');
        }

        let synthesizer = String(state.synthesizer || '').trim();
        if (synthesizer) {
          const finals = state.models.map((modelName) => ({
            model: modelName,
            text: state.finalWords[modelName] || state.positions[modelName] || ''
          })).filter((entry) => entry.text.trim());
          const prompt = deps.compilePrompt?.({
            task: state.taskContract || { objective: state.topic, maxWords: state.maxWords },
            profile: state.presetConfigSnapshot?.promptPack ? { promptPack: state.presetConfigSnapshot.promptPack } : null,
            stage: { stageId: 'final:synthesis', operation: 'synthesis', role: 'synthesizer', outputContract: { maxWords: state.maxWords, requiredSections: ['Вердикт', 'Что устояло', 'Позиции меньшинства', 'Нерешённые вопросы', 'Выводы синтезатора [synthesis_inference]', 'Уверенность и основания'] } },
            model: synthesizer,
            contextParts: [
              ...finals.map((entry, index) => ({ id: `final-${index + 1}`, type: 'turn', label: `Финальная позиция ${entry.model}`, text: entry.text, owner: entry.model, trust: 'model', priority: 'high' })),
              ...state.roundFilters.map((entry, index) => ({ id: `filter-${index + 1}`, type: 'state', label: `Фильтр R${entry.round || index + 1}`, text: entry.text, trust: 'system', priority: 'high' }))
            ]
          })?.prompt || api?.buildTriadSynthesisPrompt?.({
            topic: state.topic,
            problemSpec: state.problemSpecText,
            finals,
            roundFilters: state.roundFilters,
            maxWords: state.maxWords
          }) || '';
          if (prompt) {
            state.currentWaveKind = 'synthesis';
            state.currentWaveKey = 'synthesis';
            const attemptedSynthesizers = new Set();
            let synthesisAttemptNumber = 0;
            while (synthesizer && !attemptedSynthesizers.has(synthesizer)) {
              attemptedSynthesizers.add(synthesizer);
              synthesisAttemptNumber += 1;
              let synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
              stageEvent('STAGE_STARTED', 'final:synthesis', { kind: 'final_synthesis', participants: [synthesizer] });
              deps.syncVisualState?.();
              timeline('Dispatch', { from: 'Moderator', to: synthesizer, note: 'триада: синтез итогов' });
              deps.renderCards?.('synthesizer', [synthesizer], { approvalSelectable: false });
              deps.tagWaveCards?.(state, 'synthesis', [synthesizer]);
              const result = await deps.runModelBatch({
                prompt,
                models: [synthesizer],
                attachments: [],
                forceNewTabs: false,
                useApiFallback: options.useApiFallback !== false,
                generationProfile: 'long',
                context: { ...(deps.makeBatchContext?.(state, 'triad-synthesis') || {}), pipelineStageId: 'final:synthesis', stageAttemptId: synthesisAttemptId },
                signal: options.signal || null
              });
              let answer = String(result?.responses?.[synthesizer] || '').trim();
              let accepted = acceptance(answer, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
              let missing = deps.validateSynthesisSections?.(answer) || [];
              if (accepted.ok && missing.length) {
                synthesisAttemptNumber += 1;
                synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
                const repair = await deps.runModelBatch({
                  prompt: `${prompt}\nОтвет не содержит обязательных секций: ${missing.join(', ')}. Выдай полный синтез по заданной структуре.`,
                  models: [synthesizer], attachments: [], forceNewTabs: false,
                  useApiFallback: options.useApiFallback !== false, generationProfile: 'long',
                  context: { ...(deps.makeBatchContext?.(state, 'triad-synthesis-format-repair') || {}), pipelineStageId: 'final:synthesis', stageAttemptId: synthesisAttemptId },
                  signal: options.signal || null
                });
                answer = String(repair?.responses?.[synthesizer] || '').trim();
                accepted = acceptance(answer, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords });
                missing = deps.validateSynthesisSections?.(answer) || [];
                if (missing.length) stageEvent('MISSING_REQUIRED_ARTIFACT', 'final:synthesis', { sections: missing });
              }
              if (accepted.ok) {
                state.synthesisText = answer;
                deps.recordAcceptedResponse?.({ stageId: 'final:synthesis', participant: synthesizer, attemptId: synthesisAttemptId, text: answer });
                stageEvent('STAGE_COMPLETED', 'final:synthesis');
                timeline('Response', { from: synthesizer, to: 'Moderator', note: 'синтез итогов' });
                break;
              }
              const alternatives = state.models.filter((model) => model !== synthesizer && !attemptedSynthesizers.has(model));
              const decision = await resolveDropout(state, 'final:synthesis', {
                topology: 'triad', stage: 'final_synthesis', failedModels: [synthesizer], remainingModels: alternatives
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
              break;
            }
            deps.markWaveCardsApproved?.(state, 'synthesis');
          }
        }

        if (!synthesizer) {
          state.currentWaveKind = '';
          state.currentWaveKey = '';
          transition(state, 'COMPLETED', { reason: 'discussion_completed_without_synthesis' });
          timeline('Completed', { note: 'discussion completed without synthesis' });
          deps.recordFinalization?.({ synthesis: false, reason: 'synthesizer_none' });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: 'synthesizer_none' });
          await deps.handleTerminalOutputs?.(state, 'triad');
          deps.finalizeRuntime?.();
          return true;
        }
        if (!state.synthesisText) {
          return stopAfterDropout(state, [synthesizer].filter(Boolean), 'final_synthesis');
        }
        if (state.auditRequired && deps.runSynthesisAudit) {
          const auditor = state.serviceRoles?.auditor && state.serviceRoles.auditor !== synthesizer
            ? state.serviceRoles.auditor : '';
          if (!auditor) {
            stageEvent('STAGE_SKIPPED', 'final:audit', { reasonCode: 'auditor_not_selected' });
          } else {
          stageEvent('STAGE_STARTED', 'final:audit', { kind: 'synthesis_audit', participants: auditor ? [auditor] : [] });
          const audit = await deps.runSynthesisAudit({ auditorModel: auditor, synthesisText: state.synthesisText, roundFilters: state.roundFilters, finalWords: Object.values(state.finalWords || {}), context: deps.makeBatchContext?.(state, 'triad-audit') });
          state.synthesisAudit = audit;
          if (audit.status === 'issues_found' && !state.synthesisAuditCorrected) {
            state.synthesisAuditCorrected = true;
            state.synthesisDraft = state.synthesisText;
            const repairBase = api?.buildTriadSynthesisPrompt?.({ topic: state.topic, problemSpec: state.problemSpecText, finals: Object.entries(state.finalWords || {}).map(([model, text]) => ({ model, text })), roundFilters: state.roundFilters, maxWords: state.maxWords }) || '';
            const repair = await deps.runModelBatch({ prompt: `${repairBase}\nАудит нашёл проблемы:\n${audit.text}\nИсправь их и выдай полный синтез.`, models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: options.useApiFallback !== false, generationProfile: 'long', context: { ...(deps.makeBatchContext?.(state, 'triad-synthesis-repair') || {}), pipelineStageId: 'final:audit', stageAttemptId: 'final:audit:repair:a1' }, signal: options.signal || null });
            const corrected = String(repair?.responses?.[synthesizer] || '').trim();
            if (acceptance(corrected, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }).ok) {
              state.synthesisText = corrected;
              deps.recordAcceptedResponse?.({ stageId: 'final:audit', participant: synthesizer, attemptId: 'final:audit:repair:a1', text: corrected });
            }
          }
          stageEvent(audit.status === 'skipped' ? 'STAGE_SKIPPED' : 'STAGE_COMPLETED', 'final:audit', { reasonCode: audit.reason || audit.status });
          }
        }
        deps.appendVerdict?.(state.synthesisText, { title: 'Final Synthesis', source: `triad:${synthesizer}` });
        state.currentWaveKind = '';
        state.currentWaveKey = '';
        transition(state, 'COMPLETED', { reason: 'final_synthesis_completed' });
        timeline('Completed', { note: `triad wave limit reached (${state.maxWaves})` });
        await deps.notifyControl?.('COMPLETED', { stage: 'completed' });
        await deps.handleTerminalOutputs?.(state, 'triad');
        deps.finalizeRuntime?.();
        return true;
      },

      async advance(state, options = {}) {
        if (!state?.active) return false;
        if (deps.hasReachedWaveLimit?.(state)) return runner.finalize(state, options);
        if (options.auto && options.paused) {
          state.pendingWaveContinuation = { wave: Number(state.wave || 0) + 1 };
          deps.markPaused?.(state);
          deps.syncState?.(state, 'TRIAD_PAUSED');
          timeline('Paused', { note: 'auto triad paused by moderator' });
          deps.updateButtons?.();
          return true;
        }
        transition(state, 'RUNNING');
        return typeof deps.dispatchWave === 'function'
          ? deps.dispatchWave('wave')
          : runner.dispatchWave(state, 'wave', options);
      },

      async completeBarrier(state, options = {}) {
        if (!state?.active || !state.currentWaveKind) return false;
        if (state.currentWaveKind === 'wave') transition(state, 'TRIAD_WAVE_COMPLETED');
        else state.waitingWaveApproval = false;
        state.currentWaveKind = '';
        state.currentWaveKey = '';
        return runner.advance(state, options);
      }
    });

    return runner;
  }

  const api = Object.freeze({ createTriadRunner });
  root.TriadRunner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

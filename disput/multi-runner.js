// Application-level sequencing for the Multi topology.
(function initMultiRunner(root) {
  'use strict';
  const Participants = root.DebateParticipantRegistry || (typeof require === 'function' ? require('./debate-participant-registry') : null);

  function createMultiRunner(deps = {}) {
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
    const selectStageModels = (activeModels, preset, wave, outputs) => {
      const configuredRoles = preset.stageRoles?.[String(wave)];
      const roleNames = Array.isArray(configuredRoles) ? configuredRoles.map((role) => String(role || '').toLowerCase()) : [];
      const presetRoles = Array.isArray(preset.roles) ? preset.roles : [];
      if (!roleNames.length) return activeModels.slice();
      const independentRetest = outputs.some((id) => /independent_retest|retest_report/i.test(String(id)));
      const used = new Set();
      const roleForModel = (model) => {
        const originalIndex = preset.selectedModels?.indexOf?.(model) ?? -1;
        const modelIndex = originalIndex >= 0 ? originalIndex : activeModels.indexOf(model);
        return String(presetRoles[modelIndex % Math.max(1, presetRoles.length)] || '').toLowerCase();
      };
      const selected = roleNames.map((role, requestedIndex) => {
        const candidates = activeModels.filter((model) => {
          return roleForModel(model) === role && !used.has(model);
        });
        const found = independentRetest && role === 'critical' && roleNames.length === 1 ? candidates.at(-1) : candidates[0];
        const selected = found || activeModels.find((model) => !used.has(model)) || activeModels[requestedIndex];
        if (selected) used.add(selected);
        return selected;
      }).filter(Boolean);
      const requestedRoleSet = new Set(roleNames);
      activeModels.forEach((model) => {
        if (!used.has(model) && requestedRoleSet.has(roleForModel(model))) {
          used.add(model);
          selected.push(model);
        }
      });
      return selected;
    };
    const stopAfterDropout = async (state, failedModels, stage) => {
      transition(state, 'CANCELLED', { reason: `participant_dropout:${stage}` });
      await deps.notifyControl?.('CANCELLED', { stage: 'cancelled', reason: 'participant_dropout_user_stop', failedModels });
      deps.notify?.(`Multi остановлен после выбытия: ${failedModels.join(', ')}.`, 'warn');
      deps.finalizeRuntime?.();
      return false;
    };

    return Object.freeze({
      async start(input = {}) {
        const selected = (input.selectedModels || []).slice();
        if (selected.length < 2) {
          deps.notify?.('Multi: выберите минимум две модели в шапке.', 'warn');
          return false;
        }
        const explicitSynthesizer = String(input.synthesizer || '').trim();
        if (explicitSynthesizer.toLowerCase() === 'auto') return false;
        if (input.otherTopologyActive) {
          deps.notify?.('Диспут уже идёт. Остановите текущий запуск перед новым.', 'warn');
          return false;
        }
        const preset = input.presetConfig || {};
        const runPolicy = input.executionPlan?.runPolicy || preset.runPolicy || 'manual';
        let synthesizer = explicitSynthesizer;
        let activeModels = selected.slice();
        const maxWaves = Math.max(1, Math.min(50, Number(preset.waveLimit ?? input.waveLimit) || 1));
        const state = deps.protocol.createState({
          runId: input.runContext?.pipelineRunId,
          sessionId: input.runContext?.sessionId,
          topic: input.pipelineNameText,
          role: input.role || '',
          models: selected,
          synthesizer,
          waveLimit: maxWaves,
          roundPlan: Array.isArray(preset.roundPlan) ? preset.roundPlan : [],
          presetId: preset.presetId || 'MULTI_STANDARD',
          duration: preset.duration || 'fixed',
          terminationOwner: preset.terminationOwner || 'runtime',
          finalizationPolicy: preset.finalizationPolicy || 'auto_after_limit',
          autoMode: runPolicy === 'auto'
        });
        Participants.initialize(state, selected);
        state.registry = input.registryEnabled ? deps.createRegistry?.({ mode: 'multi' }) || null : null;
        state.maxWords = input.maxWords;
        state.taskContract = input.taskContract || deps.createTaskContract?.({ rawRequest: input.pipelineNameText || input.moderatorEntryText, objective: input.pipelineNameText || input.moderatorEntryText, problemSpec: input.problemSpec, maxWords: input.maxWords, runId: state.runId, profileId: preset.profileId || preset.presetId }) || null;
        state.promptTrace = [];
        state.serviceRoles = deps.resolveServiceRoles?.({ preset, synthesizer }) || { synthesizer, auditor: '' };
        state.executionPlan = input.executionPlan || null;
        deps.setState?.(state);
        transition(state, 'RUNNING');
        deps.replaceAggregateState?.(state);
        deps.appendModerator?.(input.moderatorEntryText);
        deps.clearModerator?.();
        deps.setRunPresentation?.({ activeRole: input.role || '', maxTurns: maxWaves });

        let previousTurns = [];
        const stageAttempts = new Map();
            for (let wave = 1; wave <= maxWaves; wave += 1) {
              if (input.signal?.aborted) throw new DOMException('Pipeline run cancelled', 'AbortError');
              const roundOutputs = state.roundPlan.find((entry) => Number(entry?.round) === wave)?.outputs || [];
              const waveModels = selectStageModels(activeModels, { ...preset, selectedModels: selected }, wave, roundOutputs);
              transition(state, 'MULTI_BEGIN_WAVE', { wave });
          deps.syncVisualState?.();
              const promptsByModel = waveModels.reduce((acc, modelName, index) => {
            const assembled = deps.assembleContext?.({ topology: 'multi', stageKind: 'participant_wave', stagePhase: deps.resolveStagePhase?.({ roundOutputs, round: wave }) || (wave === 1 ? 'opening' : 'critique'), state, policy: preset.contextPolicy || 'filtered' }) || { parts: [], omitted: [] };
            assembled.omitted.forEach((item) => stageEvent('LEGACY_DIAGNOSTIC_EVENT', `r${wave}:wave`, { reasonCode: item.reason, omittedId: item.id }));
            const phase = deps.resolveStagePhase?.({ roundOutputs, round: wave }) || (wave === 1 ? 'opening' : 'critique');
            const operation = wave === 1 || phase === 'opening' ? 'opening' : phase === 'defence' || phase === 'response' ? 'response' : phase === 'retest' ? 'verification' : phase === 'resolution' ? 'final_position' : 'critique';
            const action = operation === 'critique' ? { action: 'critique_claim', role: 'critic' } : operation === 'response' ? { action: 'resolve_blocker', role: 'defender' } : operation === 'verification' ? { action: 'recheck_revision', role: 'verifier' } : null;
            const compiled = deps.compilePrompt?.({
              task: state.taskContract || { objective: state.topic, maxWords: state.maxWords }, action,
              profile: preset.promptPack ? { promptPack: preset.promptPack } : null,
              stage: { stageId: `r${wave}:wave`, operation, role: action?.role || 'participant', lens: deps.resolveRole?.(activeModels.indexOf(modelName)) || '', expectedArtifactTypes: roundOutputs, outputContract: { maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' } },
              model: modelName, contextParts: assembled.parts, turns: previousTurns
            });
            if (compiled) {
              state.promptTrace.push({ stageId: compiled.stage.stageId, model: modelName, fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, contextIds: compiled.context.parts.map((part) => part.id) });
              stageEvent('PROMPT_COMPILED', compiled.stage.stageId, { model: modelName, fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, contextIds: compiled.context.parts.map((part) => part.id) });
            }
            acc[modelName] = compiled?.prompt || deps.buildWavePrompt?.({
              topic: input.pipelineNameText,
              wave,
              maxWaves,
              modelName,
                  role: deps.resolveRole?.(activeModels.indexOf(modelName)) || '',
              mission: deps.getProtocolMission?.(preset) || '',
              previousTurns,
              roundOutputs,
              previousFilter: state.roundFilters.at(-1)?.text || '',
              convergenceWarning: state.convergenceWarning || ''
              ,problemSpec: input.problemSpecText || ''
              ,contextParts: assembled.parts
              ,maxWords: state.maxWords
            });
            return acc;
          }, {});
              const contextPartsByModel = Object.fromEntries(waveModels.map((modelName) => [modelName,
                deps.assembleContext?.({ topology: 'multi', stageKind: 'participant_wave', stagePhase: deps.resolveStagePhase?.({ roundOutputs, round: wave }), state, policy: preset.contextPolicy || 'filtered' })?.parts || []
              ]));
              if (wave === 1 && (state.responsesByWave?.[0] || []).length) {
                deps.assertBlindOpening?.(promptsByModel, Object.fromEntries(state.responsesByWave[0].map((entry) => [entry.model, entry.text])));
              }
              timeline('Dispatch', { from: 'Moderator', to: waveModels.join('+'), note: `multi wave ${wave}/${maxWaves}` });
              deps.renderCards?.(input.role || '', waveModels, { approvalSelectable: false });
          const stageId = `r${wave}:wave`;
              const attemptNumber = (stageAttempts.get(stageId) || 0) + 1;
              stageAttempts.set(stageId, attemptNumber);
              const stageAttemptId = `${stageId}:a${attemptNumber}`;
              stageEvent('STAGE_STARTED', stageId, { kind: wave === 1 ? 'opening_batch' : 'wave_batch', participants: waveModels });
              stageEvent('BARRIER_OPENED', stageId, { participants: waveModels, expectedCount: waveModels.length });
          const result = await deps.runModelBatch({
            prompt: promptsByModel[activeModels[0]],
            promptsByModel,
                models: waveModels,
            attachments: wave === 1 ? (input.attachmentsPayload || []) : [],
            forceNewTabs: wave === 1 && input.forceNewTabs,
            useApiFallback: input.useApiFallback,
            generationProfile: 'long',
            context: {
              ...(input.runContext || {}),
              pipelineStageId: `r${wave}:wave`,
              pipelineRoundId: `multi-r${wave}`,
              pipelineBatchId: `${state.runId}:multi-r${wave}:${now()}`,
              stageAttemptId
              ,contextPartsByModel
            },
            signal: input.signal
          });
              const terminalFailures = Participants.terminalFailures(result, { stageId, attemptId: stageAttemptId })
                .filter((failure) => waveModels.includes(failure.modelId));
              const failedModels = terminalFailures.map((failure) => failure.modelId);
              const waveTurns = waveModels.map((modelName) => ({
            model: modelName,
            text: String(result?.responses?.[modelName] || '').trim()
          })).filter((entry) => {
            if (failedModels.includes(entry.model)) return false;
            const verdict = acceptance(entry.text, { kind: 'participant', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' });
            const correlation = deps.validateCorrelation?.(result?.contexts?.[entry.model] || result?.pipelineContext || {}, { pipelineRunId: state.runId, pipelineStageId: stageId, stageAttemptId }) || { ok: true };
            if (!correlation.ok) { stageEvent('CORRELATION_REJECTED', stageId, { model: entry.model, reasonCode: correlation.reason }); return false; }
            if (!verdict.ok) stageEvent('ANSWER_REJECTED', `r${wave}:wave`, { model: entry.model, reasonCode: verdict.reason });
            return verdict.ok;
          });
          const successfulModels = waveTurns.map((turn) => turn.model);
          const remainingModels = activeModels.filter((model) => !failedModels.includes(model));
          waveTurns.forEach((turn) => stageEvent('BARRIER_PARTICIPANT_READY', stageId, { model: turn.model, answerLength: turn.text.length }));
          failedModels.forEach((model) => stageEvent('BARRIER_PARTICIPANT_FAILED', stageId, {
            model, terminal: true, reason: terminalFailures.find((failure) => failure.modelId === model)?.reasonCode || 'terminal_transport_failure'
          }));
          if (failedModels.length) {
            stageEvent('DROPOUT_DECISION_REQUESTED', stageId, { failedModels, remainingModels });
            const decision = await resolveDropout(state, stageId, {
              topology: 'multi', stage: `wave_${wave}`,
              failedModels, remainingModels
            }) || 'stop';
            stageEvent(decision === 'retry' ? 'DROPOUT_RETRY_SELECTED' : (decision === 'continue' ? 'DROPOUT_CONTINUE_SELECTED' : 'DROPOUT_STOP_SELECTED'), stageId, { failedModels, remainingModels });
            if (decision === 'retry') {
              stageEvent('RECOVERY_ATTEMPT_STARTED', stageId, { attempt: attemptNumber + 1, strategy: 'manual_stage_retry' });
              wave -= 1;
              continue;
            }
            if (decision !== 'continue') return stopAfterDropout(state, failedModels, `wave_${wave}`);
            const synthesizerWasParticipant = activeModels.includes(synthesizer);
            activeModels = Participants.markDropped(state, terminalFailures);
            state.models = activeModels.slice();
            // The selected synthesizer can be a service model outside the
            // participant pool. Preserve it unless that exact model failed as
            // a participant; otherwise a participant dropout must not silently
            // change who performs every filter/checkpoint/final synthesis.
            if (synthesizerWasParticipant && failedModels.includes(synthesizer)) synthesizer = activeModels[0] || '';
            state.synthesizer = synthesizer;
            deps.syncState?.(state, 'MULTI_PARTICIPANTS_REDUCED');
            deps.notify?.(`Multi продолжен без: ${failedModels.join(', ')}.`, 'warn');
          }
          waveTurns.forEach((entry) => {
            deps.recordAcceptedResponse?.({ stageId, participant: entry.model, attemptId: stageAttemptId, text: entry.text });
            deps.appendFeed?.(entry.model, entry.text, '', { role: input.role || '', status: 'SUCCESS', finalStatus: 'SUCCESS' });
            timeline('Response', { from: entry.model, to: 'Moderator', note: `multi wave ${wave}` });
          });
          transition(state, 'MULTI_WAVE_COMPLETED', { turns: waveTurns });
          previousTurns = waveTurns.length ? waveTurns : previousTurns;
          if (!waveTurns.length) throw new Error(`Multi wave ${wave} produced no usable responses`);
          stageEvent('BARRIER_RELEASED', stageId, { participants: successfulModels, failedModels });
          stageEvent('STAGE_COMPLETED', stageId);

          const roundFilter = await deps.runRoundFilter?.({
            topic: input.pipelineNameText,
            topology: 'multi',
            round: wave,
            outputs: deps.getRoundOutputs?.(preset, wave) || [],
            turns: waveTurns,
            previousFilter: state.roundFilters.at(-1)?.text || '',
            synthesizer,
            runId: state.runId,
            signal: input.signal,
            stageId: `r${wave}:filter`
          });
          if (roundFilter) state.roundFilters.push(roundFilter);
          if (state.registry) {
            await deps.runCheckpoint?.(state, { waveKey: state.currentWaveKey, waveNumber: wave, turns: waveTurns });
          }
          deps.syncState?.(state, 'MULTI_WAVE_ARTIFACTS_SYNCED');
          if (runPolicy === 'manual' || input.isPaused?.()) {
            await deps.waitForContinuation?.(input.signal, runPolicy === 'manual' ? `multi_r${wave}_approval` : 'multi_paused');
          }
        }

        if (!synthesizer) {
          timeline('Completed', { note: `multi wave limit reached (${maxWaves}); no synthesis requested` });
          transition(state, 'COMPLETED');
          deps.recordFinalization?.({ synthesis: false, reason: 'synthesizer_none' });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: 'synthesizer_none' });
          await deps.handleTerminalOutputs?.(state, 'multi');
          deps.finalizeRuntime?.();
          return true;
        }
        transition(state, 'MULTI_BEGIN_SYNTHESIS');
        deps.syncVisualState?.();
        const synthesisContext = deps.assembleContext?.({ topology: 'multi', stageKind: 'final_synthesis', stagePhase: 'resolution', state, policy: preset.contextPolicy || 'filtered' }) || { parts: [], omitted: [] };
        synthesisContext.omitted.forEach((item) => stageEvent('LEGACY_DIAGNOSTIC_EVENT', 'final:synthesis', { reasonCode: item.reason, omittedId: item.id }));
        // Full-history compatibility expression retained for source-level
        // contract tests; filtered presets intentionally select only last wave.
        // turns: state.responsesByWave.flat()
        const synthesisTurns = preset.contextPolicy === 'full_history'
          ? state.responsesByWave.flat()
          : (state.responsesByWave.at(-1) || []);
        let synthesisAnswer = '';
        let synthesisAttemptNumber = 0;
        let acceptedSynthesisAttemptId = '';
        const attemptedSynthesizers = new Set();
        while (synthesizer && !attemptedSynthesizers.has(synthesizer)) {
          attemptedSynthesizers.add(synthesizer);
          synthesisAttemptNumber += 1;
          let synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
          const synthesisPrompt = deps.compilePrompt?.({
            task: state.taskContract || { objective: state.topic, maxWords: state.maxWords },
            profile: preset.promptPack ? { promptPack: preset.promptPack } : null,
            stage: { stageId: 'final:synthesis', operation: 'synthesis', role: 'synthesizer', outputContract: { maxWords: state.maxWords, requiredSections: ['Вердикт', 'Что устояло', 'Позиции меньшинства', 'Нерешённые вопросы', 'Выводы синтезатора [synthesis_inference]', 'Уверенность и основания'] } },
            model: synthesizer,
            contextParts: synthesisContext.parts,
            turns: synthesisTurns
          })?.prompt || deps.buildFinalSynthesisPrompt?.({
            topic: input.pipelineNameText,
            synthesizer,
            turns: synthesisTurns,
            roundFilters: state.roundFilters
            ,problemSpec: input.problemSpecText || '',
            contextParts: synthesisContext.parts,
            maxWords: state.maxWords
          });
          timeline('Dispatch', { from: 'Moderator', to: synthesizer, note: 'multi: Final Synthesis' });
          deps.renderCards?.('synthesizer', [synthesizer], { approvalSelectable: false });
          stageEvent('STAGE_STARTED', 'final:synthesis', { kind: 'final_synthesis', participants: [synthesizer] });
          let synthesisResult = await deps.runModelBatch({
            prompt: synthesisPrompt,
            models: [synthesizer],
            attachments: [],
            forceNewTabs: false,
            useApiFallback: input.useApiFallback,
            generationProfile: 'long',
            context: {
              ...(input.runContext || {}),
              pipelineStageId: 'final:synthesis',
              pipelineRoundId: 'multi-synthesis',
              pipelineBatchId: `${state.runId}:multi-synthesis:${now()}`,
              stageAttemptId: synthesisAttemptId
              ,contextParts: synthesisContext.parts
            },
            signal: input.signal
          });
          let synthesisFailure = Participants.terminalFailures(synthesisResult, {
            stageId: 'final:synthesis', attemptId: synthesisAttemptId
          }).find((failure) => failure.modelId === synthesizer) || null;
          synthesisAnswer = String(synthesisResult?.responses?.[synthesizer] || '').trim();
          const missingSections = deps.validateSynthesisSections?.(synthesisAnswer) || [];
          if (synthesisAnswer && missingSections.length && !state.synthesisFormatRetried) {
            state.synthesisFormatRetried = true;
            synthesisAttemptNumber += 1;
            synthesisAttemptId = `final:synthesis:a${synthesisAttemptNumber}`;
            const repair = await deps.runModelBatch({
              prompt: `${synthesisPrompt}\nОтвет не содержит обязательных секций: ${missingSections.join(', ')}. Выдай полный синтез по заданной структуре.`,
              models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback,
              generationProfile: 'long', context: { ...(input.runContext || {}), pipelineStageId: 'final:synthesis', stageAttemptId: synthesisAttemptId }, signal: input.signal
            });
            synthesisResult = repair;
            synthesisFailure = Participants.terminalFailures(repair, {
              stageId: 'final:synthesis', attemptId: synthesisAttemptId
            }).find((failure) => failure.modelId === synthesizer) || null;
            synthesisAnswer = String(repair?.responses?.[synthesizer] || '').trim();
            if (deps.validateSynthesisSections?.(synthesisAnswer)?.length) stageEvent('MISSING_REQUIRED_ARTIFACT', 'final:synthesis', { sections: deps.validateSynthesisSections(synthesisAnswer) });
          }
          if (acceptance(synthesisAnswer, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }).ok) {
            acceptedSynthesisAttemptId = synthesisAttemptId;
            break;
          }
          if (!synthesisFailure) {
            stageEvent('SYNTHESIS_RESPONSE_REJECTED', 'final:synthesis', { model: synthesizer, reasonCode: 'no_usable_response' });
            transition(state, 'FAILED', { reason: 'synthesis_response_rejected' });
            deps.recordRunFailure?.('synthesis_response_rejected');
            await deps.notifyControl?.('FAILED', { stage: 'failed', reason: 'synthesis_response_rejected' });
            deps.finalizeRuntime?.();
            return false;
          }
          stageEvent('BARRIER_PARTICIPANT_FAILED', 'final:synthesis', {
            model: synthesizer, terminal: true, reason: synthesisFailure.reasonCode
          });
          const alternatives = activeModels.filter((model) => model !== synthesizer && !attemptedSynthesizers.has(model));
          const decision = await resolveDropout(state, 'final:synthesis', {
            topology: 'multi', stage: 'final_synthesis', failedModels: [synthesizer], remainingModels: alternatives
          }) || 'stop';
          if (decision === 'retry') {
            stageEvent('DROPOUT_RETRY_SELECTED', 'final:synthesis', { failedModels: [synthesizer], remainingModels: alternatives });
            attemptedSynthesizers.delete(synthesizer);
            continue;
          }
          if (decision !== 'continue') return stopAfterDropout(state, [synthesizer], 'final_synthesis');
          Participants.markDropped(state, [synthesisFailure]);
          stageEvent('STAGE_SKIPPED', 'final:synthesis', { reasonCode: 'selected_synthesizer_unavailable', participant: synthesizer });
          synthesizer = '';
          state.synthesizer = '';
          break;
        }
        if (!synthesizer) {
          timeline('Completed', { note: 'selected synthesizer unavailable; completed without synthesis' });
          transition(state, 'COMPLETED');
          deps.recordFinalization?.({ synthesis: false, reason: 'selected_synthesizer_unavailable' });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: 'selected_synthesizer_unavailable' });
          await deps.handleTerminalOutputs?.(state, 'multi');
          deps.finalizeRuntime?.();
          return true;
        }
        if (!synthesisAnswer || deps.isErrorOutput?.(synthesisAnswer)) return stopAfterDropout(state, [synthesizer].filter(Boolean), 'final_synthesis');
        transition(state, 'MULTI_SYNTHESIS_RECORDED', { text: synthesisAnswer });
        deps.recordAcceptedResponse?.({ stageId: 'final:synthesis', participant: synthesizer, attemptId: acceptedSynthesisAttemptId, text: synthesisAnswer });
        stageEvent('STAGE_COMPLETED', 'final:synthesis');
        const auditRequired = String(preset.synthesisAudit || '').toLowerCase() === 'required'
          || ['factual', 'red_team', 'decision'].includes(String(input.problemSpec?.taskType || '').toLowerCase())
          || String(input.problemSpec?.evidenceMode || '').toLowerCase() === 'required';
        if (auditRequired && deps.runSynthesisAudit) {
          const auditor = state.serviceRoles?.auditor && state.serviceRoles.auditor !== synthesizer
            ? state.serviceRoles.auditor : '';
          if (!auditor) {
            stageEvent('STAGE_SKIPPED', 'final:audit', { reasonCode: 'auditor_not_selected' });
          } else {
          stageEvent('STAGE_STARTED', 'final:audit', { kind: 'synthesis_audit', participants: auditor ? [auditor] : [] });
          const audit = await deps.runSynthesisAudit({ auditorModel: auditor, synthesisText: synthesisAnswer, roundFilters: state.roundFilters, finalWords: [], context: input.runContext });
          state.synthesisAudit = audit;
          if (audit.status === 'issues_found' && !state.synthesisAuditCorrected) {
            state.synthesisAuditCorrected = true;
            state.synthesisDraft = synthesisAnswer;
            const correction = await deps.runModelBatch({
              prompt: `${deps.buildFinalSynthesisPrompt?.({ topic: input.pipelineNameText, synthesizer, turns: synthesisTurns, roundFilters: state.roundFilters, problemSpec: input.problemSpecText || '', maxWords: state.maxWords }) || ''}\n\nАудит нашёл проблемы:\n${audit.text}\nИсправь только подтверждённые проблемы и выдай полный синтез по обязательным секциям.`,
              models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback,
              generationProfile: 'long', context: { ...(input.runContext || {}), pipelineStageId: 'final:audit', stageAttemptId: 'final:audit:repair:a1' }, signal: input.signal
            });
            const corrected = String(correction?.responses?.[synthesizer] || '').trim();
            const correctionAccepted = acceptance(corrected, { kind: 'synthesis', taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }).ok;
            if (correctionAccepted) {
              synthesisAnswer = corrected;
              deps.recordAcceptedResponse?.({ stageId: 'final:audit', participant: synthesizer, attemptId: 'final:audit:repair:a1', text: corrected });
            }
            state.synthesisAudit.correctionApplied = correctionAccepted;
          }
          stageEvent(audit.status === 'skipped' ? 'STAGE_SKIPPED' : 'STAGE_COMPLETED', 'final:audit', { reasonCode: audit.reason || audit.status });
          }
        }
        deps.appendVerdict?.(synthesisAnswer, { title: 'Final Synthesis', source: `multi:${synthesizer}` });
        timeline('Response', { from: synthesizer, to: 'Moderator', note: 'multi: Final Synthesis' });
        timeline('Completed', { note: `multi wave limit reached (${maxWaves})` });
        transition(state, 'COMPLETED');
        deps.recordFinalization?.({ synthesis: true });
        await deps.notifyControl?.('COMPLETED', { stage: 'completed' });
        await deps.handleTerminalOutputs?.(state, 'multi');
        deps.finalizeRuntime?.();
        return true;
      }
    });
  }

  const api = Object.freeze({ createMultiRunner });
  root.MultiRunner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

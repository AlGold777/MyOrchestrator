// Trigger-driven FreeTalk orchestration. The loop is bounded by meaningful work,
// cancellation and an optional resource budget, never by a round counter.
(function initFreeTalkRunner(root) {
  'use strict';
  const Catalog = root.DebatePromptCatalog || (typeof require === 'function' ? require('./debate-prompt-catalog') : null);
  const Contracts = root.DebateContracts || (typeof require === 'function' ? require('./debate-contracts') : null);
  const Compiler = root.DebatePromptCompiler || (typeof require === 'function' ? require('./debate-prompt-compiler') : null);
  const Capabilities = root.DebateCapabilityRegistry || (typeof require === 'function' ? require('./debate-capability-registry') : null);
  const Decisions = root.DebateDecisionRequest || (typeof require === 'function' ? require('./debate-decision-request') : null);
  const ModelSignal = root.DebateModelSignal || (typeof require === 'function' ? require('./debate-model-signal') : null);
  const Policies = root.DebatePolicies || (typeof require === 'function' ? require('./debate-policies') : null);
  const semanticOverlap = (left, right) => {
    const tokens = (value) => new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
    const a = tokens(left); const b = tokens(right);
    if (!a.size || !b.size) return 0;
    const common = Array.from(a).filter((token) => b.has(token)).length;
    return common / Math.max(1, Math.min(a.size, b.size));
  };

  function createFreeTalkRunner(deps = {}) {
    const transition = (state, type, payload = {}) => deps.transition?.(state, { type, payload }) || state;
    const stageEvent = (type, stageId, payload = {}) => deps.recordStageEvent?.(type, { stageId, ...payload });
    let signalMode = 'disabled';
    const acceptedText = (text, meta = {}) => {
      const extracted = ModelSignal?.extract?.(String(text || '')) || { text: String(text || '').trim(), signal: null, errors: [] };
      const clean = extracted.text;
      if (signalMode === 'shadow' && extracted.signal) stageEvent('MODEL_SIGNAL_OBSERVED', meta.stageId || '', { model: meta.model || '', signal: extracted.signal, shadow: true });
      if (signalMode === 'shadow' && extracted.errors?.length) stageEvent('MODEL_SIGNAL_INVALID', meta.stageId || '', { model: meta.model || '', errors: extracted.errors, shadow: true });
      const verdict = deps.acceptResponse?.(clean, { kind: 'participant', ...meta }) || { ok: Boolean(clean) };
      return verdict.ok ? clean : '';
    };
    const taskPrompt = ({ topic, task, map, previousTurns, maxWords }) => [
      `Тема: ${topic}`,
      `Твоя задача: ${task.actionContract?.instruction || task.reason || 'Внеси новый проверяемый вклад'}.`,
      `Почему она нужна: ${task.reason}`,
      task.targetId ? `Работай с элементом карты ${task.targetId}.` : '',
      `Состояние дела: claims ${map.stats?.claims || 0}; открыто ${map.stats?.open || 0}; blocking ${map.stats?.blockers || 0}; dissent ${map.stats?.dissent || 0}; evidence gaps ${map.stats?.evidenceGaps || 0}.`,
      `Защищённый контекст карты:\n${[
        ...(map.claims || []).slice(0, 10).map((item) => `[claim ${item.id}] ${item.title}`),
        ...(map.blockers || []).slice(0, 8).map((item) => `[BLOCKING ${item.id}] ${item.title}`),
        ...(map.dissent || []).slice(0, 8).map((item) => `[dissent ${item.id}] ${item.title}`),
        ...(map.axes || []).slice(0, 8).map((item) => `[axis ${item.id}] ${item.status}`)
      ].join('\n') || 'пока пуст'}`,
      previousTurns.length ? `Последние ответы:\n${previousTurns.slice(-4).map((turn) => `${turn.model}: ${turn.text}`).join('\n\n')}` : '',
      'Добавь только новую и проверяемую мысль. Не объявляй вопрос закрытым самостоятельно.',
      Catalog?.wordLimitLine?.(maxWords) || ''
    ].filter(Boolean).join('\n\n');
    const chooseModel = (task, map, models, cursor, synthesizer) => {
      const items = [...(map.claims || []), ...(map.objections || []), ...(map.evidence || []), ...(map.revisions || []), ...(map.dissent || [])];
      const targetOwner = String(items.find((item) => item.id === task.targetId)?.owner || '');
      const routed = deps.chooseModel?.({ task, models, owner: targetOwner, synthesizer }) || Capabilities?.choose?.({ models, owner: targetOwner, synthesizer, action: task.actionContract || task });
      if (routed?.model) return routed;
      const requiresIndependence = ['critic', 'verifier', 'arbiter', 'auditor'].includes(task.role);
      const candidates = models.filter((model) => (!requiresIndependence || model !== targetOwner) && (task.role !== 'auditor' || model !== synthesizer));
      const pool = candidates.length ? candidates : models;
      const model = pool[cursor % pool.length];
      return { model, degraded: candidates.length === 0 && requiresIndependence, degradedReasons: candidates.length === 0 && requiresIndependence ? ['independence_self_check'] : [], independence: { level: candidates.length ? 'different_author' : 'self' } };
    };

    const runner = Object.freeze({
      async start(input = {}) {
        let models = Array.from(new Set((input.selectedModels || []).map((model) => String(model || '').trim()).filter(Boolean)));
        if (models.length < 1) {
          deps.notify?.('FreeTalk: выберите хотя бы одну модель. Верхнего ограничения нет.', 'warn');
          return false;
        }
        const synthesizer = String(input.synthesizer || '').trim();
        if (synthesizer.toLowerCase() === 'auto') return false;
        const preset = input.presetConfig || {};
        const runPolicy = input.executionPlan?.runPolicy || preset.runPolicy || 'manual';
        signalMode = String(preset.policies?.modelSignals || preset.modelSignals || 'disabled');
        const taskContract = input.taskContract || deps.createTaskContract?.({
          ...(input.problemSpec || {}), rawRequest: input.pipelineNameText || input.moderatorEntryText,
          objective: input.pipelineNameText || input.moderatorEntryText, problemSpec: input.problemSpec,
          maxWords: input.maxWords, runId: input.runContext?.pipelineRunId || input.runId,
          profileId: preset.profileId || preset.presetId
        }) || Contracts?.createTaskContract?.({
          rawRequest: input.pipelineNameText || input.moderatorEntryText,
          objective: input.pipelineNameText || input.moderatorEntryText,
          problemSpec: input.problemSpec, maxWords: input.maxWords,
          runId: input.runContext?.pipelineRunId || input.runId,
          profileId: preset.profileId || preset.presetId
        });
        const state = deps.protocol.createState({
          runId: input.runContext?.pipelineRunId || input.runId,
          sessionId: input.runContext?.sessionId || input.sessionId,
          topic: taskContract?.objective || input.pipelineNameText,
          models,
          synthesizer,
          presetId: preset.presetId,
          profileId: preset.profileId || preset.presetId,
          registry: deps.createRegistry?.({ mode: 'free_talk' }) || null,
          triggerState: {
            budget: preset.resourceBudget || { used: 0, limit: null, reserved: 1 },
            allowedTriggers: Array.isArray(preset.triggers) ? preset.triggers.slice() : [],
            rules: Array.isArray(preset.rules) ? preset.rules.slice() : (Array.isArray(preset.triggers) ? preset.triggers.slice() : []),
            progressPolicy: preset.progressPolicy || { windowSize: 3, minChangedSteps: 1, fallback: 'decision_request' },
            decisionMode: preset.policies?.mode === 'auto' ? 'auto' : preset.policies?.mode === 'manual' ? 'manual' : 'assisted'
          }
        });
        state.executionPlan = input.executionPlan || null;
        state.taskContract = taskContract || null;
        state.maxWords = taskContract?.maxWords || input.maxWords;
        state.serviceMaxWords = preset.serviceMaxWords || null;
        state.promptTrace = [];
        state.degradedReasons = [];
        state.serviceRoles = deps.resolveServiceRoles?.({ preset, synthesizer }) || { synthesizer, auditor: '' };
        transition(state, 'RUNNING');
        deps.replaceAggregateState?.(state);
        deps.appendModerator?.(input.moderatorEntryText);
        deps.clearModerator?.();
        deps.setRunPresentation?.({ activeRole: 'FreeTalk', maxTurns: null });

        const checkAbort = () => {
          if (input.signal?.aborted) throw new DOMException('Pipeline run cancelled', 'AbortError');
        };
        const compilePrompt = (options) => {
          const compileInput = { ...options, profile: options.profile || (preset.promptPack ? { promptPack: preset.promptPack } : null) };
          const compiled = deps.compilePrompt?.(compileInput) || Compiler?.compile?.(compileInput);
          if (compiled) {
            state.promptTrace.push({ stageId: compiled.stage.stageId, model: options.model || '', fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, templateId: compiled.template.templateId, contextIds: compiled.context.parts.map((part) => part.id) });
            stageEvent('PROMPT_COMPILED', compiled.stage.stageId, { model: options.model || '', fingerprint: compiled.fingerprint, promptPack: compiled.promptPack, templateId: compiled.template.templateId, contextIds: compiled.context.parts.map((part) => part.id), omittedContextIds: compiled.context.omitted.map((part) => part.id) });
          }
          return compiled;
        };
        const repairInvalidBatch = async (result, compiledByModel, request = {}) => {
          const responses = { ...(result?.responses || {}) };
          const verdicts = {};
          const terminallyFailed = result?.failed && typeof result.failed === 'object' ? result.failed : {};
          const failed = Object.keys(compiledByModel || {}).filter((model) => {
            const compiled = compiledByModel[model];
            if (!compiled) return false;
            const responseText = ModelSignal?.extract?.(String(responses[model] || ''))?.text || String(responses[model] || '').trim();
            // Repair targets contract violations in an existing answer. A participant
            // settled as terminal failure (or with no text at all) has nothing to
            // repair — re-dispatching to it only re-enters the dead barrier.
            if (!responseText || terminallyFailed[model]) { verdicts[model] = { ok: false, reason: 'no_response' }; return false; }
            const verdict = deps.acceptResponse?.(responseText, { kind: 'participant', ...(compiled.validator || {}) }) || { ok: Boolean(responseText) };
            verdicts[model] = verdict;
            return !verdict.ok;
          });
          if (!failed.length || !Compiler?.repairPrompt) return { ...(result || {}), responses };
          const repairPrompts = Object.fromEntries(failed.map((model) => {
            const verdict = verdicts[model] || {};
            return [model, Compiler.repairPrompt(compiledByModel[model], [verdict.reason, ...(verdict.details?.missingSections || [])])];
          }));
          stageEvent('RESPONSE_CONTRACT_REPAIR', request.stageId || 'repair', { participants: failed, reasons: failed.map((model) => verdicts[model]?.reason || 'contract_violation') });
          const repaired = await deps.runModelBatch({
            ...request, prompt: repairPrompts[failed[0]], promptsByModel: repairPrompts,
            models: failed, attachments: [], forceNewTabs: false,
            context: { ...(request.context || {}), pipelineStageId: `${request.stageId || 'stage'}:repair`, stageAttemptId: `${request.stageId || 'stage'}:a2` }
          });
          Object.assign(responses, repaired?.responses || {});
          return { ...(result || {}), responses };
        };
        const runCheckpoint = async (turns, waveNumber, waveKey) => {
          const result = await deps.runCheckpoint?.(state, {
            waveNumber, waveKey,
            turns: turns.map((turn, index) => ({ ...turn, turnId: `${waveKey}:${index + 1}:${turn.model}` }))
          });
          deps.syncState?.(state, 'FREE_TALK_REGISTRY_UPDATED');
          return result || null;
        };

        checkAbort();
        const openingId = 'free-talk:positions';
        stageEvent('STAGE_STARTED', openingId, { kind: 'opening_batch', participants: models });
        deps.renderCards?.('FreeTalk · positions', models, { approvalSelectable: false });
        const openingCompiled = Object.fromEntries(models.map((model) => {
          const compiled = compilePrompt({
            task: state.taskContract || { objective: state.topic, maxWords: state.maxWords }, model,
            stage: { stageId: openingId, operation: 'opening', role: 'participant', outputContract: { maxWords: state.maxWords, allowShort: state.taskContract?.taskClass === 'direct_answer' } },
            map: {}, turns: [], limits: input.contextLimits
          });
          return [model, compiled];
        }));
        const withSignal = (prompt) => signalMode === 'shadow' && ModelSignal?.instruction ? `${prompt}\n\n${ModelSignal.instruction()}` : prompt;
        const openingPrompts = Object.fromEntries(models.map((model) => [model, withSignal(openingCompiled[model]?.prompt || [
          'Ты участвуешь в свободной дискуссии с другими LLM. Их позиции пока тебе неизвестны.',
          `Тема: ${state.topic}`,
          'Дай независимую стартовую позицию.', Catalog?.wordLimitLine?.(state.maxWords) || ''
        ].filter(Boolean).join('\n'))]));
        const retryPolicy = deps.resolveRetryPolicy?.({ input, preset, stageId: openingId })
          || Policies?.resolve?.(input.failurePolicy || preset.executionPolicies || {})?.retry;
        const maxOpeningAttempts = Number(retryPolicy?.maxAttempts);
        if (!Number.isInteger(maxOpeningAttempts) || maxOpeningAttempts < 1) {
          throw new Error('FREE_TALK_OPENING_RETRY_POLICY_INVALID');
        }
        state.openingRetryAttempts = 0;
        const configuredOpeningModels = models.slice();
        const openingResponses = {};
        let openingTurns = [];
        let failedOpeningModels = [];
        let terminalOpeningFailures = {};
        let openingDecision = 'continue';
        let attemptModels = configuredOpeningModels.slice();

        for (let attempt = 1; attempt <= maxOpeningAttempts; attempt += 1) {
          checkAbort();
          const attemptPrompts = Object.fromEntries(attemptModels.map((model) => [model, openingPrompts[model]]));
          let attemptResult = await deps.runModelBatch({
            prompt: attemptPrompts[attemptModels[0]], promptsByModel: attemptPrompts, models: attemptModels,
            attachments: input.attachmentsPayload || [], forceNewTabs: attempt === 1 ? input.forceNewTabs : false,
            useApiFallback: input.useApiFallback, generationProfile: 'long',
            context: {
              ...(input.runContext || {}), pipelineStageId: openingId, pipelineRoundId: 'free-talk-positions',
              pipelineBatchId: `${state.runId}:positions:a${attempt}:${Date.now()}`,
              stageAttemptId: `${openingId}:a${attempt}`
            },
            signal: input.signal
          });
          attemptResult = await repairInvalidBatch(attemptResult, Object.fromEntries(attemptModels.map((model) => [model, openingCompiled[model]])), {
            stageId: openingId, useApiFallback: input.useApiFallback, generationProfile: 'long', signal: input.signal,
            context: {
              ...(input.runContext || {}), pipelineRoundId: 'free-talk-positions',
              pipelineBatchId: `${state.runId}:positions:repair:a${attempt}:${Date.now()}`,
              stageAttemptId: `${openingId}:a${attempt}`
            }
          });
          Object.assign(openingResponses, attemptResult?.responses || {});
          terminalOpeningFailures = { ...terminalOpeningFailures, ...(attemptResult?.failed || {}) };
          openingTurns = configuredOpeningModels.map((model) => ({
            model,
            text: acceptedText(openingResponses[model], {
              ...(openingCompiled[model]?.validator || { taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }),
              model, stageId: openingId
            })
          })).filter((turn) => turn.text);
          openingTurns.forEach((turn) => { delete terminalOpeningFailures[turn.model]; });
          failedOpeningModels = configuredOpeningModels.filter((model) => !openingTurns.some((turn) => turn.model === model));
          if (!failedOpeningModels.length) break;

          const remainingModels = openingTurns.map((turn) => turn.model);
          failedOpeningModels.forEach((model) => stageEvent('BARRIER_PARTICIPANT_FAILED', openingId, {
            model, reason: terminalOpeningFailures[model] ? 'terminal_transport_failure' : 'no_usable_response', attempt
          }));
          const failurePolicy = deps.stageById?.(state.executionPlan, openingId)?.failurePolicy || 'ask_user';
          openingDecision = failurePolicy === 'fail_run' ? 'stop' : 'continue';
          if (failurePolicy === 'ask_user') {
            stageEvent('DROPOUT_DECISION_REQUESTED', openingId, { failedModels: failedOpeningModels, remainingModels, attempt });
            openingDecision = (await deps.resolveParticipantDropout?.({
              topology: 'free_talk', stage: 'positions',
              failedModels: failedOpeningModels, remainingModels, attempt, maxAttempts: maxOpeningAttempts
            })) || 'continue';
          }

          if (openingDecision === 'retry') {
            const retryableModels = failedOpeningModels.filter((model) => terminalOpeningFailures[model]);
            if (attempt >= maxOpeningAttempts || !retryableModels.length) {
              stageEvent('DROPOUT_RETRY_EXHAUSTED', openingId, {
                failedModels: failedOpeningModels, retryableModels, attempt, maxAttempts: maxOpeningAttempts
              });
              openingDecision = 'stop';
            } else {
              state.openingRetryAttempts += 1;
              stageEvent('DROPOUT_RETRY_SELECTED', openingId, {
                failedModels: failedOpeningModels, retryableModels, remainingModels, attempt, nextAttempt: attempt + 1
              });
              attemptModels = retryableModels;
              continue;
            }
          } else if (failurePolicy === 'ask_user') {
            stageEvent(openingDecision === 'continue' ? 'DROPOUT_CONTINUE_SELECTED' : 'DROPOUT_STOP_SELECTED', openingId, {
              failedModels: failedOpeningModels, remainingModels, attempt
            });
          }
          break;
        }

        // Barrier settlement: a terminally failed participant must not block the run.
        // The stage settles as degraded, the dropout is recorded, remaining
        // participants continue (failurePolicy: ask_user delegates to the shared
        // dropout resolver; without a resolver the run continues degraded instead of
        // silently staying in `running`).
        if (failedOpeningModels.length) {
          const remainingModels = openingTurns.map((turn) => turn.model);
          if (openingDecision !== 'continue') {
            transition(state, 'CANCELLED', { reason: 'participant_dropout:positions' });
            deps.recordRunFailure?.('participant_dropout_user_stop:positions');
            await deps.notifyControl?.('CANCELLED', { stage: 'cancelled', reason: 'participant_dropout_user_stop', failedModels: failedOpeningModels });
            deps.notify?.(`FreeTalk остановлен после выбытия: ${failedOpeningModels.join(', ')}.`, 'warn');
            deps.finalizeRuntime?.();
            return false;
          }
          if (!openingTurns.length) throw new Error('FreeTalk positions produced no usable responses');
          models = remainingModels;
          state.models = remainingModels;
          state.degradedReasons.push(`participant_dropout:${failedOpeningModels.join(',')}`);
          state.droppedModels = Array.from(new Set([...(state.droppedModels || []), ...failedOpeningModels]));
          deps.notify?.(`${failedOpeningModels.join(', ')} не ответил(и) после восстановления. Продолжаем с: ${remainingModels.join(', ')}.`, 'warn');
          deps.syncState?.(state, 'FREE_TALK_PARTICIPANTS_REDUCED');
        }
        openingTurns.forEach((turn) => deps.appendFeed?.(turn.model, turn.text, '', { role: 'position', status: 'SUCCESS', finalStatus: 'SUCCESS' }));
        transition(state, 'FREE_TALK_POSITIONS_COMPLETED', { turns: openingTurns, droppedModels: failedOpeningModels });
        stageEvent('STAGE_COMPLETED', openingId, { participants: openingTurns.map((turn) => turn.model), droppedModels: failedOpeningModels });
        await runCheckpoint(openingTurns, 1, 'free-talk-positions');

        if (!synthesizer) {
          state.stopReason = 'synthesizer_none';
          state.epistemicOutcome = 'inconclusive';
          transition(state, 'COMPLETED', { reason: state.stopReason, epistemicOutcome: state.epistemicOutcome });
          deps.recordFinalization?.({ synthesis: false, reason: state.stopReason, epistemicOutcome: state.epistemicOutcome, promptTrace: state.promptTrace });
          await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: state.stopReason });
          await deps.handleTerminalOutputs?.(state, 'free_talk');
          deps.finalizeRuntime?.();
          return true;
        }
        if (runPolicy === 'manual') await deps.waitForContinuation?.(input.signal, 'free_talk_positions_approval');

        let previousTurns = openingTurns.slice();
        let cursor = 0;
        let shouldSynthesize = false;
        let lastMapFingerprint = '';
        let unchangedMaps = 0;
        let finalMap = null;
        while (!shouldSynthesize) {
          checkAbort();
          if (input.isPaused?.()) await deps.waitForContinuation?.(input.signal, 'free_talk_paused');
          if (state.triggerState.forceSynthesis) { state.stopReason = state.stopReason || 'manual_synthesis'; shouldSynthesize = true; break; }
          const map = deps.projectStateMap?.({ runId: state.runId, sessionId: state.sessionId, config: { topic: state.topic }, protocolState: state }) || {};
          finalMap = map;
          const mapFingerprint = Contracts?.hash?.({
            readiness: map.readiness?.id,
            artifacts: [...(map.claims || []), ...(map.objections || []), ...(map.evidence || []), ...(map.revisions || []), ...(map.dissent || []), ...(map.contradictions || []), ...(map.openQuestions || [])]
              .map((item) => ({ id: item.id, status: item.status, title: item.title, targetId: item.targetId, revision: item.revision }))
              .sort((a, b) => String(a.id).localeCompare(String(b.id))),
            links: (map.links || []).map((link) => `${link.from}:${link.to}:${link.type}`).sort()
          }) || JSON.stringify({ stats: map.stats, readiness: map.readiness?.id, links: map.links?.length || 0 });
          unchangedMaps = mapFingerprint === lastMapFingerprint ? unchangedMaps + 1 : 0;
          lastMapFingerprint = mapFingerprint;
          const progressPolicy = state.triggerState.progressPolicy || { windowSize: 3, minChangedSteps: 1 };
          const progressWindow = (state.triggerState.progressWindow || []).slice(-Math.max(1, Number(progressPolicy.windowSize || 3)));
          const progressStagnant = progressWindow.length >= Math.max(1, Number(progressPolicy.windowSize || 3))
            && progressWindow.filter((item) => item.stateChanged).length < Math.max(1, Number(progressPolicy.minChangedSteps || 1));
          state.triggerState.stagnant = progressStagnant || unchangedMaps >= Math.max(2, Number(progressPolicy.windowSize || 3));
          state.triggerState.contextPressure = state.actionCount - Number(state.triggerState.lastContextCompactionAt || 0) >= 8;
          let planned = deps.planNext?.(map, state.triggerState) || { state: state.triggerState, next: null };
          state.triggerState = planned.state;
          (planned.traces || []).forEach((trace) => {
            stageEvent('RULE_EVALUATED', state.currentStageId || 'free-talk:rules', { ...trace, topology: 'free_talk', ruleMode: 'control' });
            stageEvent(trace.status === 'fired' ? 'RULE_FIRED' : 'RULE_SUPPRESSED', state.currentStageId || 'free-talk:rules', { ...trace, topology: 'free_talk', ruleMode: 'control' });
          });
          if (planned.awaitingHuman?.length) {
            const pending = planned.awaitingHuman[0];
            const request = Decisions?.forTask?.(pending, { runId: state.runId, stageId: `free-talk:action:${pending.id}`, mode: state.triggerState.decisionMode }) || pending;
            stageEvent('DECISION_REQUESTED', request.stageId || 'free-talk:decision', request);
            deps.syncState?.(state, 'FREE_TALK_AWAITING_HUMAN');
            const resolution = await deps.requestConfirmation?.(request, input.signal);
            const normalizedResolution = typeof resolution === 'boolean' ? Decisions?.resolve?.(request, resolution ? 'execute' : (request.options?.some((item) => item.id === 'defer') ? 'defer' : 'synthesize')) : resolution;
            if (normalizedResolution) stageEvent('DECISION_RESOLVED', request.stageId || 'free-talk:decision', normalizedResolution);
            state.triggerState = deps.confirmTask?.(state.triggerState, pending.id, normalizedResolution || false) || state.triggerState;
            deps.syncState?.(state, normalizedResolution?.effect === 'execute_action' ? 'FREE_TALK_ACTION_APPROVED' : 'FREE_TALK_DECISION_APPLIED');
            continue;
          }
          if (!planned.next && !state.triggerState.stagnant) {
            state.triggerState.stagnant = true;
            planned = deps.planNext?.(map, state.triggerState) || planned;
            state.triggerState = planned.state;
          }
          const task = planned.next;
          const actionTasks = (planned.batch || [task]).filter(Boolean).filter((entry) => !['synthesize', 'summarize_or_stop'].includes(entry.action));
          if (state.triggerState.stagnant && (!task || task.triggerId === 'STAGNATION' || !actionTasks.length) && !state.triggerState.forceSynthesis) {
            const request = Decisions?.forStagnation?.({ runId: state.runId, stageId: 'free-talk:stagnation', mode: state.triggerState.decisionMode, subjectId: state.runId }) || null;
            if (request) {
              stageEvent('DECISION_REQUESTED', request.stageId, request);
              const resolution = await deps.requestConfirmation?.(request, input.signal);
              if (resolution) stageEvent('DECISION_RESOLVED', request.stageId, resolution);
              if (resolution?.effect === 'continue_one_step') {
                unchangedMaps = 0; state.triggerState.stagnant = false; state.triggerState.seq += 1;
                const actionContract = Contracts?.createActionContract?.({ action: 'explore_new_angle', role: 'participant', reason: 'Модератор разрешил один дополнительный шаг после остановки прогресса.', expectedArtifactTypes: ['claim', 'open_question'], cost: 1 });
                state.triggerState.queue.push({ id: `ft-task-${state.triggerState.seq}`, ruleId: 'HUMAN_CONTINUE', triggerId: 'HUMAN_CONTINUE', targetId: state.runId, reason: 'Найди один новый угол, способный изменить карту.', role: 'participant', action: 'explore_new_angle', actionContract, expectedArtifactTypes: actionContract?.expectedArtifactTypes || [], independence: 'none', priority: 110, mode: 'automatic', cost: 1, cooldown: 0, maxExecutions: 1, status: 'pending', createdAt: Date.now(), explanation: 'Дополнительный шаг разрешён модератором.' });
                continue;
              }
              if (resolution?.effect === 'stop_run') { state.stopReason = 'stopped_by_moderator'; shouldSynthesize = false; deps.finalizeRuntime?.(); return false; }
              state.stopReason = resolution?.effect === 'accept_as_limitation' ? 'accepted_limitations' : 'stagnation';
              shouldSynthesize = true; break;
            }
          }
          if (!task || planned.blockedByBudget || !actionTasks.length) {
            state.stopReason = planned.blockedByBudget ? 'resource_budget_reserved_for_finalization' : (task?.triggerId || 'no_pending_work');
            shouldSynthesize = true;
            break;
          }
          const usedModels = new Set();
          const assignments = actionTasks.map((entry) => {
            let route = chooseModel(entry, map, models, cursor, synthesizer); cursor += 1;
            let model = route.model;
            if (usedModels.has(model)) {
              const alternate = models.find((candidate) => !usedModels.has(candidate));
              if (alternate) route = { ...route, model: alternate, degraded: route.degraded, degradedReasons: route.degradedReasons || [] };
              model = route.model;
            }
            usedModels.add(model);
            if (route.degraded) state.degradedReasons.push(...(route.degradedReasons || ['routing_degraded']));
            return { task: entry, model, route, stageId: `free-talk:action:${entry.id}` };
          });
          const taskIds = new Set(actionTasks.map((entry) => entry.id));
          state.triggerState.queue = state.triggerState.queue.filter((item) => !taskIds.has(item.id));
          state.triggerState.active = actionTasks.slice();
          assignments.forEach(({ task: entry, model, stageId }) => {
            transition(state, 'FREE_TALK_ACTION_STARTED', { task: entry });
            stageEvent('STAGE_STARTED', stageId, { kind: 'dynamic_action', participants: [model], triggerId: entry.triggerId, targetId: entry.targetId, explanation: entry.explanation });
          });
          const batchModels = assignments.map((entry) => entry.model);
          const compiledByModel = Object.fromEntries(assignments.map(({ task: entry, model, stageId }) => [model, compilePrompt({
            task: state.taskContract || { objective: state.topic, maxWords: state.maxWords },
            action: entry.actionContract || entry,
            stage: { stageId, operation: entry.actionContract?.operation, role: entry.role, targetId: entry.targetId, independence: entry.independence, expectedArtifactTypes: entry.expectedArtifactTypes, outputContract: { maxWords: state.maxWords, completion: entry.actionContract?.completion } },
            model, map, turns: previousTurns, limits: input.contextLimits
          })]));
          const promptsByModel = Object.fromEntries(assignments.map(({ task: entry, model }) => [model, withSignal(compiledByModel[model]?.prompt || taskPrompt({ topic: state.topic, task: entry, map, previousTurns, maxWords: state.maxWords }))]));
          deps.renderCards?.(`FreeTalk · ${actionTasks.map((entry) => entry.role).join(' + ')}`, batchModels, { approvalSelectable: false });
          let actionResult = await deps.runModelBatch({
            prompt: promptsByModel[batchModels[0]], promptsByModel, models: batchModels, attachments: [], forceNewTabs: false,
            useApiFallback: input.useApiFallback, generationProfile: 'long',
            context: { ...(input.runContext || {}), pipelineStageId: 'free-talk:dynamic-batch', pipelineRoundId: `free-talk-a${state.actionCount + 1}`, pipelineBatchId: `${state.runId}:action:${state.actionCount + 1}:${Date.now()}` },
            signal: input.signal
          });
          actionResult = await repairInvalidBatch(actionResult, compiledByModel, { stageId: 'free-talk:dynamic-batch', useApiFallback: input.useApiFallback, generationProfile: 'long', signal: input.signal, context: { ...(input.runContext || {}), pipelineRoundId: `free-talk-a${state.actionCount + 1}`, pipelineBatchId: `${state.runId}:action:repair:${Date.now()}` } });
          const acceptedTurns = []; const acceptedAssignments = [];
          for (const { task: entry, model, stageId } of assignments) {
            const answer = acceptedText(actionResult?.responses?.[model], { ...(compiledByModel[model]?.validator || { taskClass: state.taskContract?.taskClass, maxWords: state.maxWords }), model, stageId });
            if (!answer) {
              stageEvent('STAGE_FAILED', stageId, { reason: 'no_usable_response' });
              state.triggerState = deps.settleTask?.(state.triggerState, entry, 'failed') || state.triggerState;
              continue;
            }
            const turns = [{ model, text: answer }]; acceptedTurns.push(...turns); acceptedAssignments.push({ task: entry, model, stageId, turns });
            const normalizedAnswer = answer.replace(/\s+/g, ' ').trim().toLowerCase();
            state.triggerState.repetitionDetected = previousTurns.some((turn) => {
              const normalizedPrevious = turn.text.replace(/\s+/g, ' ').trim().toLowerCase();
              return normalizedPrevious === normalizedAnswer || semanticOverlap(normalizedPrevious, normalizedAnswer) >= 0.9;
            });
            deps.appendFeed?.(model, answer, '', { role: entry.role, status: 'SUCCESS', finalStatus: 'SUCCESS' });
            previousTurns.push(...turns);
            transition(state, 'FREE_TALK_ACTION_COMPLETED', { task: entry, turns });
            stageEvent('STAGE_COMPLETED', stageId, { triggerId: entry.triggerId, targetId: entry.targetId });
            if (entry.action === 'compact_context') {
              state.triggerState.lastContextCompactionAt = state.actionCount;
              state.triggerState.contextPressure = false;
            }
            if (entry.action === 'stop_repetition') state.triggerState.repetitionDetected = false;
          }
          let checkpoint = null;
          if (acceptedTurns.length) checkpoint = await runCheckpoint(acceptedTurns, state.actionCount + 1, `free-talk-action-${state.actionCount}`);
          const stateChanged = Number(checkpoint?.applied || 0) > 0 || Number(checkpoint?.delta?.counts?.total || 0) > 0;
          acceptedAssignments.forEach(({ task: entry }) => {
            const degraded = !checkpoint;
            state.triggerState = deps.settleTask?.(state.triggerState, entry, stateChanged ? 'completed' : degraded ? 'completed_degraded' : 'completed_no_delta', {
              stateChanged, delta: checkpoint?.delta || null, degradedReasons: degraded ? ['checkpoint_unavailable'] : []
            }) || state.triggerState;
          });
          stageEvent('PROGRESS_WINDOW_UPDATED', 'free-talk:progress', { window: state.triggerState.progressWindow || [], stateChanged, policy: state.triggerState.progressPolicy });
          if (stateChanged) state.triggerState.lastProgressAt = Date.now();
          state.triggerState.active = [];
          deps.syncState?.(state, 'FREE_TALK_ACTION_SETTLED');
          if (runPolicy === 'manual') await deps.waitForContinuation?.(input.signal, `free_talk_action_${state.actionCount}_approval`);
        }

        checkAbort();
        transition(state, 'FREE_TALK_SYNTHESIS_STARTED');
        stageEvent('STAGE_STARTED', 'final:synthesis', { kind: 'final_synthesis', participants: [synthesizer], reason: state.stopReason });
        const synthesisCompiled = compilePrompt({
          task: state.taskContract || { objective: state.topic, maxWords: state.maxWords },
          stage: { stageId: 'final:synthesis', operation: 'synthesis', role: 'synthesizer', outputContract: { maxWords: state.maxWords, requiredSections: Catalog?.SYNTHESIS_REQUIRED_SECTIONS || [] } },
          model: synthesizer, map: finalMap || {}, turns: previousTurns, limits: input.contextLimits
        });
        let synthesisPrompt = synthesisCompiled?.prompt || deps.buildFinalSynthesisPrompt?.({
          topic: state.topic, synthesizer, turns: previousTurns, roundFilters: state.roundFilters,
          problemSpec: input.problemSpecText || '', maxWords: state.maxWords
        }) || `Синтезируй обсуждение по теме: ${state.topic}`;
        let synthesisResult = await deps.runModelBatch({
          prompt: synthesisPrompt, models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback,
          generationProfile: 'long', context: { ...(input.runContext || {}), pipelineStageId: 'final:synthesis', pipelineRoundId: 'free-talk-synthesis', pipelineBatchId: `${state.runId}:synthesis:${Date.now()}` }, signal: input.signal
        });
        let synthesisRaw = String(synthesisResult?.responses?.[synthesizer] || '').trim();
        let synthesisVerdict = deps.acceptResponse?.(synthesisRaw, { kind: 'synthesis', ...(synthesisCompiled?.validator || {}), requiredSections: synthesisCompiled?.validator?.requiredSections || [] }) || { ok: Boolean(synthesisRaw) };
        if (!synthesisVerdict.ok && synthesisCompiled && Compiler?.repairPrompt) {
          synthesisPrompt = Compiler.repairPrompt(synthesisCompiled, [synthesisVerdict.reason, ...(synthesisVerdict.details?.missingSections || [])]);
          synthesisResult = await deps.runModelBatch({
            prompt: synthesisPrompt, models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback,
            generationProfile: 'long', context: { ...(input.runContext || {}), pipelineStageId: 'final:synthesis:repair', pipelineRoundId: 'free-talk-synthesis', pipelineBatchId: `${state.runId}:synthesis:repair:${Date.now()}` }, signal: input.signal
          });
          synthesisRaw = String(synthesisResult?.responses?.[synthesizer] || '').trim();
          synthesisVerdict = deps.acceptResponse?.(synthesisRaw, { kind: 'synthesis', ...(synthesisCompiled.validator || {}) }) || { ok: Boolean(synthesisRaw) };
        }
        let synthesis = synthesisVerdict.ok ? synthesisRaw : '';
        if (!synthesis) throw new Error('FreeTalk final synthesis produced no usable response');
        const auditor = state.serviceRoles?.auditor;
        if (auditor && typeof deps.runSynthesisAudit === 'function') {
          const audit = await deps.runSynthesisAudit({ topology: 'free_talk', auditorModel: auditor, synthesisText: synthesis, roundFilters: state.roundFilters || [], finalWords: [], maxWords: state.maxWords, context: input.runContext, signal: input.signal });
          state.synthesisAudit = audit;
          if (audit?.status === 'issues_found') {
            const correctionPrompt = `${synthesisPrompt}\n\nНезависимый аудит подтвердил следующие проблемы:\n${JSON.stringify(audit.issues?.length ? audit.issues : audit.text)}\n\nИсправь только подтверждённые проблемы и верни полный синтез.`;
            const corrected = await deps.runModelBatch({ prompt: correctionPrompt, models: [synthesizer], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback, generationProfile: 'long', context: { ...(input.runContext || {}), pipelineStageId: 'final:synthesis:audit-repair', pipelineRoundId: 'free-talk-synthesis', pipelineBatchId: `${state.runId}:synthesis:audit-repair:${Date.now()}` }, signal: input.signal });
            const correctedText = String(corrected?.responses?.[synthesizer] || '').trim();
            const correctedVerdict = deps.acceptResponse?.(correctedText, { kind: 'synthesis', ...(synthesisCompiled?.validator || {}) }) || { ok: Boolean(correctedText) };
            if (correctedVerdict.ok) synthesis = correctedText;
          }
        }
        transition(state, 'FREE_TALK_SYNTHESIS_RECORDED', { text: synthesis });
        deps.appendVerdict?.(synthesis, { title: 'FreeTalk Synthesis', source: `free_talk:${synthesizer}` });
        stageEvent('STAGE_COMPLETED', 'final:synthesis');
        const epistemicOutcome = state.stopReason === 'resource_budget_reserved_for_finalization' ? 'budget_limited'
          : state.stopReason === 'FACT_DISPUTE' ? 'blocked'
          : state.stopReason === 'STAGNATION' || state.stopReason === 'no_pending_work' ? 'stagnation'
            : finalMap?.readiness?.id === 'ready' ? 'resolved'
              : finalMap?.readiness?.id === 'limited' ? 'partial' : 'inconclusive';
        state.epistemicOutcome = epistemicOutcome;
        state.degradedReasons = Array.from(new Set(state.degradedReasons));
        transition(state, 'COMPLETED', { reason: state.stopReason, epistemicOutcome });
        deps.recordFinalization?.({ synthesis: true, reason: state.stopReason, epistemicOutcome, degradedReasons: state.degradedReasons, promptTrace: state.promptTrace });
        await deps.notifyControl?.('COMPLETED', { stage: 'completed', reason: state.stopReason });
        await deps.handleTerminalOutputs?.(state, 'free_talk');
        deps.finalizeRuntime?.();
        return true;
      }
    });
    return runner;
  }

  const api = Object.freeze({ createFreeTalkRunner });
  root.FreeTalkRunner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

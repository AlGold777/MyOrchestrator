// Shared side-effect services used by Duel, Triad and Multi runners.
(function initDebateRunServices(root) {
  'use strict';

  const Acceptance = root.DebateResponseAcceptance || (typeof require === 'function' ? require('./debate-response-acceptance') : null);
  const serviceWordBudget = (kind, requested) => {
    const value = Number.parseInt(String(requested || ''), 10);
    const preferred = { round_filter: 800, checkpoint: 1200, synthesis_audit: 600 }[kind] || 800;
    const minimum = { round_filter: 350, checkpoint: 700, synthesis_audit: 250 }[kind] || 250;
    const maximum = { round_filter: 2000, checkpoint: 2500, synthesis_audit: 1200 }[kind] || 2000;
    return Math.max(minimum, Math.min(maximum, Number.isFinite(value) && value > 0 ? value : preferred));
  };

  function createRunServices(deps = {}) {
    const completedOutputRuns = new Set();
    const maxOutputRuns = Math.max(10, Number(deps.maxOutputRuns || 100));
    const now = typeof deps.now === 'function' ? deps.now : Date.now;
    const timeline = typeof deps.timeline === 'function' ? deps.timeline : () => {};
    const accept = (text, meta) => deps.acceptResponse?.(text, typeof meta === 'string' ? { kind: meta } : meta)
      || { ok: Boolean(String(text || '').trim()) && !deps.isErrorOutput?.(String(text || '').trim()), reason: '' };

    return Object.freeze({
      async runRoundFilter(input = {}) {
        const {
          topic,
          topology = 'duel',
          round,
          outputs = [],
          turns = [],
          previousFilter = '',
          synthesizer,
          runId,
          signal,
          context = {},
          useApiFallback = true
        } = input;
        const serviceModel = String(synthesizer || '').trim();
        if (!outputs.length || !turns.length || !serviceModel) return null;
        if (typeof deps.runModelBatch !== 'function') throw new Error('Debate runModelBatch dependency is unavailable');
        const prompt = deps.promptCatalog?.buildRoundFilter?.({
          topic,
          topology,
          round,
          outputs,
          turns,
          previousFilter,
          maxWords: serviceWordBudget('round_filter', input.serviceMaxWords)
        });
        if (!String(prompt || '').trim()) throw new Error(`${topology} R${round} filter prompt is empty`);
        timeline('Dispatch', {
          from: 'System',
          to: serviceModel,
          note: `${topology}: filter R${round} (${outputs.join(', ')})`
        });
        const stageId = String(input.stageId || `r${round}:filter`);
        deps.recordEvent?.('STAGE_STARTED', {
          stageId,
          kind: 'round_filter',
          visibility: 'system',
          participants: [serviceModel]
        });
        const result = await deps.runModelBatch({
          prompt,
          models: [serviceModel],
          attachments: [],
          // A service stage is part of the same compiled run. The shared model
          // session layer may materialize the synthesizer when absent, but a
          // filter must never demand an isolated tab on its own.
          forceNewTabs: false,
          useApiFallback,
          generationProfile: 'long',
          context: {
            ...context,
            pipelineStageId: stageId,
            pipelineRoundId: `${topology}-filter-r${round}`,
            pipelineBatchId: `${runId}:${topology}:filter:r${round}:${now()}`
          },
          signal
        });
        const text = String(result?.responses?.[serviceModel] || '').trim();
        const accepted = accept(text, 'round_filter');
        if (!accepted.ok) {
          deps.recordEvent?.('ANSWER_REJECTED', { stageId, reasonCode: accepted.reason || 'empty_filter_result' });
          deps.recordEvent?.('STAGE_FAILED', { stageId, reason: accepted.reason || 'empty_filter_result' });
          throw new Error(`${topology} R${round} filter returned no usable result`);
        }
        timeline('Response', {
          from: serviceModel,
          to: 'System',
          note: `${topology}: filter R${round} ready`
        });
        outputs.forEach((artifactId) => deps.recordEvent?.('STAGE_ARTIFACT_PRODUCED', {
          stageId,
          artifactId,
          kind: 'round_filter',
          producer: serviceModel
        }));
        deps.recordEvent?.('STAGE_COMPLETED', { stageId, outputs: outputs.slice(), synthesizer: serviceModel });
        return { round, outputs: outputs.slice(), text, synthesizer: serviceModel };
      },

      async runCheckpoint(state, input = {}) {
        const registry = state?.registry;
        const templates = deps.triadTemplates;
        const turns = Array.isArray(input.turns) ? input.turns : [];
        if (!registry || !templates || !deps.registry || !turns.length) return null;
        turns.forEach(({ turnId, model, text }) => {
          deps.registry.appendEvent(registry, { turnId, waveKey: input.waveKey, model, text });
        });
        const synthesizer = String(input.synthesizer || state.synthesizer || '').trim();
        if (!synthesizer) return null;
        state.checkpointStats = { attempted: 0, parsed: 0, parseFailed: 0, deltasProposed: 0, deltasApplied: 0, deltasRejected: 0, ...(state.checkpointStats || {}) };
        state.checkpointStats.attempted += 1;
        try {
          const prompt = templates.buildTriadCheckpointPrompt({
            topic: state.topic,
            waveNumber: input.waveNumber,
            turns,
            registrySummary: deps.registry.summarizeForCheckpoint(registry),
            derivedSummary: deps.registry.summarizeDerivedForCheckpoint?.(registry) || '',
            fullContexts: deps.registry.consumePendingContextForCheckpoint?.(registry) || [],
            maxWords: serviceWordBudget('checkpoint', state.serviceMaxWords)
          });
          timeline('Dispatch', { from: 'System', to: synthesizer, note: `триада: checkpoint волны ${input.waveNumber}` });
          const result = await deps.runModelBatch({
            prompt,
            models: [synthesizer],
            attachments: [],
            forceNewTabs: false,
            useApiFallback: input.useApiFallback !== false,
            generationProfile: 'long',
            context: input.context,
            signal: input.signal || null
          });
          const parsed = templates.parseTriadCheckpointOutput(String(result?.responses?.[synthesizer] || ''));
          if (!parsed.ok) {
            state.checkpointStats.parseFailed += 1;
            deps.recordEvent?.('ANSWER_REJECTED', { stageId: `r${input.waveNumber}:checkpoint`, reasonCode: 'checkpoint_parse_failed' });
            timeline('Error', { note: `триада: checkpoint волны ${input.waveNumber} не разобран` });
            return null;
          }
          state.checkpointStats.parsed += 1;
          state.checkpointStats.deltasProposed += (parsed.artifacts || []).length;
          deps.recordEvent?.('STATE_DELTA_PROPOSED', { stageId: `r${input.waveNumber}:checkpoint`, deltaId: `${state.runId || 'run'}:${input.waveNumber}:checkpoint`, proposed: (parsed.artifacts || []).length, triggerCount: (parsed.triggers || []).length });
          const previousCheckpointId = registry.lastCheckpointId || '';
          const applied = deps.registry.ingestCheckpoint(registry, parsed, { wave: input.waveNumber });
          state.checkpointStats.deltasApplied += applied.applied || 0;
          state.checkpointStats.deltasRejected += applied.rejected || 0;
          deps.recordEvent?.((applied.applied || 0) > 0 ? 'STATE_DELTA_APPLIED' : 'STATE_DELTA_REJECTED', { stageId: `r${input.waveNumber}:checkpoint`, deltaId: `${state.runId || 'run'}:${input.waveNumber}:checkpoint`, applied: applied.applied || 0, rejected: applied.rejected || 0 });
          const delta = deps.registry.computeRoundDelta?.(registry, { sinceCheckpointId: previousCheckpointId, participantCount: turns.length }) || null;
          if (delta) { state.roundDeltas = Array.isArray(state.roundDeltas) ? state.roundDeltas : []; state.roundDeltas.push({ wave: input.waveNumber, delta }); }
          deps.recordEvent?.('REGISTRY_UPDATED', {
            topology: state.topology || 'triad',
            checkpoint: input.waveNumber,
            applied: applied.applied,
            actions: applied.actions, delta: delta?.counts || null
          });
          state.lastCheckpointAtWave = input.waveNumber;
          timeline('Response', {
            from: synthesizer,
            to: 'System',
            note: `реестр: +${applied.applied} артефактов, ${applied.actions} триггеров, focus ${applied.focus || 0}, ctx ${applied.contextRequests || 0}, ${applied.rejected} отклонено`
          });
          return applied;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          timeline('Error', { note: `триада: checkpoint волны ${input.waveNumber} — ${error?.message || 'сбой'}` });
          return null;
        }
      },

      async runDuelCheckpoint(state, input = {}) {
        const registry = state?.registry;
        const templates = deps.triadTemplates;
        const every = Math.max(1, Number(state?.checkpointPolicy?.everyPublicTurns) || 2);
        const publicTurns = Number(state?.turns?.publicTurnsDispatched || 0);
        if (!registry || !templates || !deps.registry || !state.checkpointPolicy?.enabled) return null;
        if (publicTurns <= 0 || publicTurns % every !== 0 || publicTurns <= Number(state.lastCheckpointAtTurn || 0)) return null;
        const synthesizer = String(input.synthesizer || state.synthesizer || '').trim();
        if (!synthesizer) return null;
        const turns = (state.eventLog || []).filter((event) => event.phase === 'public').slice(-every)
          .map((event) => ({ turnId: event.turnId, model: event.model, text: event.text }));
        if (!turns.length) return null;
        const prompt = templates.buildTriadCheckpointPrompt({
          topic: state.topic,
          waveNumber: publicTurns,
          turns,
          registrySummary: deps.registry.summarizeForCheckpoint(registry),
          derivedSummary: deps.registry.summarizeDerivedForCheckpoint?.(registry) || '',
          fullContexts: deps.registry.consumePendingContextForCheckpoint?.(registry) || [],
          maxWords: serviceWordBudget('checkpoint', state.serviceMaxWords)
        });
        timeline('Dispatch', { from: 'System', to: synthesizer, note: `duel: checkpoint после ${publicTurns} public turns` });
        const result = await deps.runModelBatch({
          prompt,
          models: [synthesizer],
          attachments: [],
          forceNewTabs: false,
          useApiFallback: input.useApiFallback !== false,
          generationProfile: 'long',
          context: {
            ...(input.context || {}),
            pipelineRoundId: `duel-checkpoint-${publicTurns}`,
            pipelineBatchId: `${state.runId}:duel-checkpoint:${publicTurns}`
          },
          signal: input.signal || null
        });
        const parsed = templates.parseTriadCheckpointOutput(String(result?.responses?.[synthesizer] || ''));
        state.checkpointStats = { attempted: 1, parsed: 0, parseFailed: 0, deltasProposed: 0, deltasApplied: 0, deltasRejected: 0, ...(state.checkpointStats || {}) };
        if (!parsed.ok) { state.checkpointStats.parseFailed += 1; deps.recordEvent?.('ANSWER_REJECTED', { stageId: `r${publicTurns}:checkpoint`, reasonCode: 'checkpoint_parse_failed' }); return null; }
        state.checkpointStats.parsed += 1;
        state.checkpointStats.deltasProposed += (parsed.artifacts || []).length;
        deps.recordEvent?.('STATE_DELTA_PROPOSED', { stageId: `r${publicTurns}:checkpoint`, deltaId: `${state.runId || 'run'}:${publicTurns}:checkpoint`, proposed: (parsed.artifacts || []).length, triggerCount: (parsed.triggers || []).length });
        const previousCheckpointId = registry.lastCheckpointId || '';
        const applied = deps.registry.ingestCheckpoint(registry, parsed, { wave: publicTurns });
        state.checkpointStats.deltasApplied += applied.applied || 0;
        state.checkpointStats.deltasRejected += applied.rejected || 0;
        deps.recordEvent?.((applied.applied || 0) > 0 ? 'STATE_DELTA_APPLIED' : 'STATE_DELTA_REJECTED', { stageId: `r${publicTurns}:checkpoint`, deltaId: `${state.runId || 'run'}:${publicTurns}:checkpoint`, applied: applied.applied || 0, rejected: applied.rejected || 0 });
        const delta = deps.registry.computeRoundDelta?.(registry, { sinceCheckpointId: previousCheckpointId, participantCount: turns.length }) || null;
        if (delta) { state.roundDeltas = Array.isArray(state.roundDeltas) ? state.roundDeltas : []; state.roundDeltas.push({ wave: publicTurns, delta }); }
        deps.recordEvent?.('REGISTRY_UPDATED', {
          topology: 'duel', checkpoint: publicTurns, applied: applied.applied, actions: applied.actions, delta: delta?.counts || null
        });
        state.lastCheckpointAtTurn = publicTurns;
        timeline('Response', {
          from: synthesizer,
          to: 'System',
          note: `duel registry: +${applied.applied} артефактов, ${applied.actions} триггеров`
        });
        return applied;
      },

      async runSynthesisAudit(input = {}) {
        const auditor = String(input.auditorModel || '').trim();
        if (!auditor || typeof deps.runModelBatch !== 'function' || !deps.promptCatalog?.buildSynthesisAuditPrompt) return { status: 'skipped', reason: 'no_independent_auditor' };
        const assembled = deps.assembleContext?.({
          topology: input.topology || 'multi', stageKind: 'synthesis_audit', stagePhase: 'resolution', policy: 'filtered',
          state: { synthesisText: input.synthesisText, roundFilters: input.roundFilters || [], finalWords: input.finalWords || [] }
        }) || { parts: [] };
        const prompt = deps.promptCatalog.buildSynthesisAuditPrompt({
          verdict: input.synthesisText,
          roundFilters: (input.roundFilters || []).map((item) => item.text || item),
          finalWords: input.finalWords || [], contextParts: assembled.parts,
          maxWords: serviceWordBudget('synthesis_audit', input.serviceMaxWords)
        });
        const result = await deps.runModelBatch({ prompt, models: [auditor], attachments: [], forceNewTabs: false, useApiFallback: input.useApiFallback !== false, generationProfile: 'long', context: { ...(input.context || {}), pipelineStageId: 'final:audit', stageAttemptId: 'final:audit:a1', contextParts: assembled.parts }, signal: input.signal || null });
        const text = String(result?.responses?.[auditor] || '').trim();
        const accepted = accept(text, { kind: 'synthesis_audit', outputKind: /^\s*\{/.test(text) ? 'json' : 'text', maxWords: serviceWordBudget('synthesis_audit', input.serviceMaxWords) });
        const audit = Acceptance?.parseAuditVerdict?.(text) || { ok: false, verdict: '' };
        return { status: accepted.ok && audit.ok ? audit.verdict : 'skipped', auditor, text, issues: audit.issues || [], reason: accepted.ok && audit.ok ? '' : (accepted.reason || 'invalid_audit_verdict') };
      },

      async handleTerminalOutputs(input = {}) {
        const runId = String(input.runId || input.state?.runId || '').trim();
        if (!runId || completedOutputRuns.has(runId)) return false;
        completedOutputRuns.add(runId);
        if (completedOutputRuns.size > maxOutputRuns) {
          completedOutputRuns.delete(completedOutputRuns.values().next().value);
        }
        try {
          const result = typeof input.buildResult === 'function'
            ? input.buildResult(input.state, input.topology)
            : input.result;
          await deps.handleOutputs?.(result, input.selection);
          return true;
        } catch (error) {
          deps.warn?.('[RESULTS] Debate terminal outputs failed', error);
          deps.notify?.('Debate completed, but one or more Output actions failed.', 'warn');
          return false;
        }
      },

      hasHandledTerminalOutputs(runId) {
        return completedOutputRuns.has(String(runId || '').trim());
      }
    });
  }

  const api = Object.freeze({ createRunServices, serviceWordBudget });
  root.DebateRunServices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

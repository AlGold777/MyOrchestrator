(() => {
  'use strict';

  const Core = globalThis.AutomationLayerCore;
  if (!Core) throw new Error('AutomationLayerCore is not loaded');

  const STORAGE_KEY = 'automationLayerWebRuntimeTest.v1';
  const PHASE = Object.freeze({
    IDLE: 'IDLE',
    ROUND1_DISPATCHING: 'ROUND 1 · DISPATCHING',
    ROUND1_RUNNING: 'ROUND 1 · RUNNING',
    ROUND1_COMPLETE: 'ROUND 1 · COMPLETE',
    ROUND2_DISPATCHING: 'ROUND 2 · DISPATCHING',
    ROUND2_RUNNING: 'ROUND 2 · RUNNING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED'
  });
  const ACTIVE_PHASES = new Set([
    PHASE.ROUND1_DISPATCHING,
    PHASE.ROUND1_RUNNING,
    PHASE.ROUND1_COMPLETE,
    PHASE.ROUND2_DISPATCHING,
    PHASE.ROUND2_RUNNING
  ]);

  const ui = {};
  let state = null;
  let transitionBusy = false;
  let reconcileBusy = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindUi();
    bindEvents();
    state = await loadState();
    render();
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    if (state && ACTIVE_PHASES.has(state.phase)) {
      await resumeRun();
    }
  }

  function bindUi() {
    ui.prompt = document.getElementById('prompt');
    ui.send = document.getElementById('send-button');
    ui.modelControls = Array.from(document.querySelectorAll('input[name="llm"]'));
    ui.status = document.getElementById('automation-status');
    ui.runId = document.getElementById('automation-run-id');
    ui.cancel = document.getElementById('automation-cancel');
    ui.downloadResult = document.getElementById('automation-download-result');
    ui.downloadAudit = document.getElementById('automation-download-audit');
    ui.feed = resolveExistingFeed();
    ui.feedSummary = document.getElementById('automation-feed-summary');
    ui.diagnostics = document.getElementById('automation-diagnostics-log');

    const missing = ['prompt', 'send', 'status', 'runId', 'cancel', 'downloadResult', 'downloadAudit', 'feed', 'diagnostics']
      .filter((name) => !ui[name]);
    if (missing.length) throw new Error(`automation_ui_missing: ${missing.join(', ')}`);
  }

  function resolveExistingFeed() {
    return document.querySelector(
      '[data-automation-feed], #automation-feed, .automation-feed, .messages-feed, .message-feed'
    );
  }

  function bindEvents() {
    ui.send.addEventListener('click', onSendClick);
    ui.cancel.addEventListener('click', () => cancelRun().catch(reportFatal));
    ui.downloadResult.addEventListener('click', () => downloadResult().catch(showError));
    ui.downloadAudit.addEventListener('click', () => downloadAudit().catch(showError));
  }

  async function onSendClick(event) {
    event.preventDefault();
    if (state && ACTIVE_PHASES.has(state.phase)) {
      showError('Automation run is already active.');
      return;
    }
    try {
      await startRun();
    } catch (error) {
      await reportFatal(error);
    }
  }

  async function startRun() {
    const originalPrompt = String(ui.prompt.value || '').trim();
    if (!originalPrompt) throw new Error('Enter a prompt.');

    const selected = Core.selectedModelsFromValues(
      ui.modelControls.filter((control) => control.checked).map((control) => control.value)
    );
    if (selected.length !== 2) throw new Error('Select exactly two models.');

    const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000);
    if (active?.active) {
      throw new Error('Another MyOrchestrator run is active. Finish or stop it before starting Automation.');
    }

    const runId = createRunId();
    state = {
      schemaVersion: 1,
      controllerVersion: Core.VERSION,
      architecture: 'event-driven-controller-over-existing-myorchestrator-runtime',
      runId,
      phase: PHASE.ROUND1_DISPATCHING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      originalPrompt,
      originalPromptHash: await sha256(originalPrompt),
      models: selected,
      synthesisInstruction: Core.DEFAULT_SYNTHESIS_INSTRUCTION,
      rounds: {
        '1': { promptHash: null, sessionId: null, answers: {}, terminalKeys: [] },
        '2': { promptHash: null, sessionId: null, answers: {}, terminalKeys: [] }
      },
      feed: [],
      journal: [],
      exportState: { resultDownloadedAt: null, auditDownloadedAt: null }
    };

    addSystemMessage('Round 1 started', 1);
    addJournal('RUN_CREATED', { models: selected, originalPromptHash: state.originalPromptHash });
    await persist();
    render();

    await dispatchRound(1, originalPrompt);
  }

  async function dispatchRound(round, prompt) {
    if (!state) return;
    await waitForBackgroundIdle(60000);

    const roundKey = String(round);
    const phaseDispatch = round === 1 ? PHASE.ROUND1_DISPATCHING : PHASE.ROUND2_DISPATCHING;
    const phaseRunning = round === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;

    state.phase = phaseDispatch;
    state.rounds[roundKey].promptHash = await sha256(prompt);
    addJournal('ROUND_DISPATCH_INTENT', {
      round,
      promptHash: state.rounds[roundKey].promptHash,
      models: state.models.slice()
    });
    await persist();
    render();

    const response = await runtimeMessage({
      type: 'START_FULLPAGE_PROCESS',
      prompt,
      selectedLLMs: state.models,
      forceNewTabs: true,
      useApiFallback: false,
      sourceView: 'automation',
      pipelineContext: {
        sourceView: 'automation',
        automationRunId: state.runId,
        automationRound: round,
        automationControllerVersion: Core.VERSION,
        automationModels: state.models.slice()
      }
    }, 60000);

    if (response?.success === false || (response?.status && response.status !== 'process_started')) {
      throw new Error(`Round ${round} dispatch failed: ${response?.errorCode || response?.error || response?.status || 'unknown'}`);
    }

    state.phase = phaseRunning;
    addJournal('ROUND_DISPATCH_ACCEPTED', { round });
    await persist();
    render();

    await reconcileJobState(await readJobState());
  }

  async function onStorageChanged(changes, areaName) {
    if (areaName !== 'local' || !changes.jobState || !state || !ACTIVE_PHASES.has(state.phase)) return;
    await reconcileJobState(await readJobState());
  }

  function onRuntimeMessage(message) {
    if (!state || !ACTIVE_PHASES.has(state.phase)) return;
    if (message?.type !== 'GLOBAL_STATE_BROADCAST') return;
    const entries = message?.state?.llms || {};
    const statuses = state.models
      .map((model) => `${model}: ${entries?.[model]?.status || '...'}`)
      .join(' · ');
    if (ui.feedSummary) ui.feedSummary.textContent = statuses;
  }

  async function reconcileJobState(jobState) {
    if (reconcileBusy || !state || !ACTIVE_PHASES.has(state.phase)) return;
    const round = activeRoundNumber();
    if (!round || !Core.matchingJobState(jobState, state.runId, round)) return;

    reconcileBusy = true;
    try {
      const roundState = state.rounds[String(round)];
      if (!roundState.sessionId && jobState?.session?.startTime) {
        roundState.sessionId = jobState.session.startTime;
        addJournal('ROUND_SESSION_BOUND', { round, sessionId: roundState.sessionId });
      }

      const events = Core.collectNewTerminalEvents({
        jobState,
        runId: state.runId,
        round,
        models: state.models,
        seenKeys: new Set(roundState.terminalKeys || [])
      });

      let terminalFailure = null;
      for (const event of events) {
        roundState.terminalKeys.push(event.key);
        if (event.success) {
          roundState.answers[event.model] = {
            text: event.answer,
            acceptedAt: new Date(event.finalizedAt).toISOString(),
            finalizedAt: event.finalizedAt,
            dispatchId: event.dispatchId,
            requestId: event.requestId,
            source: event.source
          };
          addModelMessage(event);
          addJournal('MODEL_ANSWER_ACCEPTED', {
            round,
            model: event.model,
            finalizedAt: event.finalizedAt,
            dispatchId: event.dispatchId,
            answerHash: await sha256(event.answer)
          });
        } else {
          addFailureMessage(event);
          addJournal('MODEL_TERMINAL_FAILURE', {
            round,
            model: event.model,
            finalizedAt: event.finalizedAt,
            status: event.status,
            reason: event.reason,
            dispatchId: event.dispatchId
          });
          terminalFailure = event;
        }
      }

      await persist();
      render();

      if (terminalFailure) {
        await failRun(
          `${terminalFailure.model} ended with ${terminalFailure.status}${terminalFailure.reason ? `: ${terminalFailure.reason}` : ''}`
        );
        return;
      }

      if (state.models.every((model) => Boolean(roundState.answers?.[model]?.text))) {
        if (round === 1) {
          await completeRoundOne();
        } else {
          await completeRun();
        }
      }
    } finally {
      reconcileBusy = false;
    }
  }

  async function completeRoundOne() {
    if (transitionBusy || !state || state.phase === PHASE.ROUND1_COMPLETE || activeRoundNumber() !== 1) return;
    transitionBusy = true;
    try {
      state.phase = PHASE.ROUND1_COMPLETE;
      addSystemMessage('Round 1 completed', 1);
      addJournal('ROUND_COMPLETED', { round: 1, models: state.models.slice() });
      await persist();
      render();

      const roundTwoPrompt = Core.buildRoundTwoPrompt({
        originalPrompt: state.originalPrompt,
        modelOrder: state.models,
        answers: state.rounds['1'].answers,
        instruction: state.synthesisInstruction
      });

      addSystemMessage('Round 2 started', 2);
      await persist();
      render();
      await dispatchRound(2, roundTwoPrompt);
    } catch (error) {
      await reportFatal(error);
    } finally {
      transitionBusy = false;
    }
  }

  async function completeRun() {
    if (transitionBusy || !state || state.phase === PHASE.COMPLETED) return;
    transitionBusy = true;
    try {
      state.phase = PHASE.COMPLETED;
      state.completedAt = new Date().toISOString();
      addSystemMessage('Run completed', 2);
      addJournal('RUN_COMPLETED', { completedAt: state.completedAt });
      await persist();
      render();

      await downloadResult();
      await downloadAudit();
      await persist();
      render();
    } catch (error) {
      await failRun(`Export failed: ${error?.message || String(error)}`);
    } finally {
      transitionBusy = false;
    }
  }

  async function failRun(reason) {
    if (!state) return;
    state.phase = PHASE.ERROR;
    state.completedAt = new Date().toISOString();
    addSystemMessage(`Run failed\n${reason}`, activeRoundNumber(), 'error');
    addJournal('RUN_FAILED', { reason });
    await persist();
    render();
  }

  async function cancelRun() {
    if (!state || !ACTIVE_PHASES.has(state.phase)) return;
    await runtimeMessage({ type: 'STOP_ALL', platforms: state.models }, 10000).catch(() => null);
    state.phase = PHASE.CANCELLED;
    state.completedAt = new Date().toISOString();
    addSystemMessage('Run cancelled', activeRoundNumber());
    addJournal('RUN_CANCELLED', {});
    await persist();
    render();
  }

  async function resumeRun() {
    const jobState = await readJobState();
    const round = activeRoundNumber();

    if (round && Core.matchingJobState(jobState, state.runId, round)) {
      await reconcileJobState(jobState);
      return;
    }

    if (state.phase === PHASE.ROUND1_COMPLETE) {
      const roundTwoPrompt = Core.buildRoundTwoPrompt({
        originalPrompt: state.originalPrompt,
        modelOrder: state.models,
        answers: state.rounds['1'].answers,
        instruction: state.synthesisInstruction
      });
      addSystemMessage('Round 2 resumed after page reload', 2);
      await persist();
      await dispatchRound(2, roundTwoPrompt);
      return;
    }

    if (state.phase === PHASE.ROUND1_DISPATCHING || state.phase === PHASE.ROUND2_DISPATCHING) {
      await sleep(1800);
      const retryJobState = await readJobState();
      const retryRound = activeRoundNumber();
      if (retryRound && Core.matchingJobState(retryJobState, state.runId, retryRound)) {
        state.phase = retryRound === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;
        await persist();
        render();
        await reconcileJobState(retryJobState);
        return;
      }

      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      const ctx = active?.pipelineContext || {};
      if (active?.active && String(ctx.automationRunId || '') === state.runId && Number(ctx.automationRound || 0) === retryRound) {
        state.phase = retryRound === 1 ? PHASE.ROUND1_RUNNING : PHASE.ROUND2_RUNNING;
        await persist();
        render();
        return;
      }

      if (!active?.active) {
        const prompt = retryRound === 1
          ? state.originalPrompt
          : Core.buildRoundTwoPrompt({
              originalPrompt: state.originalPrompt,
              modelOrder: state.models,
              answers: state.rounds['1'].answers,
              instruction: state.synthesisInstruction
            });
        addJournal('DISPATCH_RECOVERY_RETRY', { round: retryRound });
        await persist();
        await dispatchRound(retryRound, prompt);
        return;
      }
    }

    if (state.phase === PHASE.ROUND1_RUNNING || state.phase === PHASE.ROUND2_RUNNING) {
      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      const ctx = active?.pipelineContext || {};
      const expectedRound = activeRoundNumber();
      if (active?.active && String(ctx.automationRunId || '') === state.runId && Number(ctx.automationRound || 0) === expectedRound) {
        return;
      }
      await failRun('Automation state could not be reconciled with the background runtime after reload.');
    }
  }

  function activeRoundNumber() {
    if (!state) return null;
    if ([PHASE.ROUND1_DISPATCHING, PHASE.ROUND1_RUNNING, PHASE.ROUND1_COMPLETE].includes(state.phase)) return 1;
    if ([PHASE.ROUND2_DISPATCHING, PHASE.ROUND2_RUNNING].includes(state.phase)) return 2;
    return null;
  }

  function addModelMessage(event) {
    state.feed.push({
      id: createEventId('answer'),
      type: 'model',
      timestamp: event.finalizedAt,
      model: event.model,
      round: event.round,
      status: 'ACCEPTED',
      text: event.answer
    });
    sortFeed();
  }

  function addFailureMessage(event) {
    state.feed.push({
      id: createEventId('failure'),
      type: 'model',
      severity: 'error',
      timestamp: event.finalizedAt,
      model: event.model,
      round: event.round,
      status: event.status || 'ERROR',
      text: event.reason || 'Model run failed.'
    });
    sortFeed();
  }

  function addSystemMessage(text, round, severity) {
    state.feed.push({
      id: createEventId('system'),
      type: 'system',
      severity: severity || 'info',
      timestamp: Date.now(),
      model: 'SYSTEM',
      round: round || null,
      status: null,
      text: String(text || '')
    });
    sortFeed();
  }

  function sortFeed() {
    state.feed.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return Number(a.timestamp) - Number(b.timestamp);
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function addJournal(type, payload) {
    state.journal.push({
      seq: state.journal.length + 1,
      at: new Date().toISOString(),
      type,
      payload: payload || {}
    });
  }

  async function waitForBackgroundIdle(timeoutMs) {
    const deadline = Date.now() + Number(timeoutMs || 60000);
    while (Date.now() < deadline) {
      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 8000).catch(() => null);
      if (!active?.active) return;
      const ctx = active?.pipelineContext || {};
      if (
        state
        && String(ctx.automationRunId || '') === state.runId
        && Number(ctx.automationRound || 0) === 1
        && state.phase === PHASE.ROUND1_COMPLETE
      ) {
        await sleep(500);
        continue;
      }
      await sleep(700);
    }
    throw new Error('Background runtime did not become idle before the next automation stage.');
  }

  async function downloadResult() {
    if (!state) return;
    const text = Core.buildResultText(state);
    await downloadBlob(
      `automation-${safeFilePart(state.runId)}-result.txt`,
      text,
      'text/plain;charset=utf-8'
    );
    state.exportState.resultDownloadedAt = new Date().toISOString();
    addJournal('RESULT_EXPORTED', { filename: `automation-${safeFilePart(state.runId)}-result.txt` });
  }

  async function downloadAudit() {
    if (!state) return;
    const audit = Core.buildAuditObject(state);
    await downloadBlob(
      `automation-${safeFilePart(state.runId)}-audit.json`,
      JSON.stringify(audit, null, 2),
      'application/json;charset=utf-8'
    );
    state.exportState.auditDownloadedAt = new Date().toISOString();
    addJournal('AUDIT_EXPORTED', { filename: `automation-${safeFilePart(state.runId)}-audit.json` });
  }

  async function downloadBlob(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            reject(new Error(chrome.runtime.lastError?.message || 'download_failed'));
            return;
          }
          resolve(downloadId);
        });
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  async function readJobState() {
    if (globalThis.CompressedStorage?.get) {
      return await globalThis.CompressedStorage.get('jobState');
    }
    const raw = await chrome.storage.local.get('jobState');
    const value = raw?.jobState || null;
    if (typeof value === 'string' && value.startsWith('__LZ__')) {
      throw new Error('Compressed jobState cannot be decoded: CompressedStorage is unavailable.');
    }
    return value;
  }

  async function persist() {
    if (!state) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function loadState() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return data?.[STORAGE_KEY] || null;
  }

  function render() {
    const phase = state?.phase || PHASE.IDLE;
    ui.status.textContent = phase;
    ui.runId.textContent = state?.runId || 'No active run';
    ui.send.disabled = Boolean(state && ACTIVE_PHASES.has(state.phase));
    ui.cancel.disabled = !(state && ACTIVE_PHASES.has(state.phase));
    ui.downloadResult.disabled = !state || ![PHASE.COMPLETED, PHASE.ERROR, PHASE.CANCELLED].includes(state.phase);
    ui.downloadAudit.disabled = !state;

    if (state?.originalPrompt && !ui.prompt.value) ui.prompt.value = state.originalPrompt;

    renderFeed();
    renderDiagnostics();
  }

  function renderFeed() {
    ui.feed.textContent = '';
    const feed = state?.feed || [];
    feed.forEach((item) => {
      const article = document.createElement('article');
      article.className = `automation-message ${item.type || 'system'} ${item.severity === 'error' ? 'error' : ''}`;

      const header = document.createElement('div');
      header.className = 'automation-message-header';

      const model = document.createElement('span');
      model.className = 'automation-message-model';
      model.textContent = item.model || 'SYSTEM';

      const meta = document.createElement('span');
      meta.className = 'automation-message-meta';
      const parts = [Core.localTime(item.timestamp)];
      if (item.round) parts.push(`Round ${item.round}`);
      if (item.status) parts.push(item.status);
      meta.textContent = parts.join(' · ');

      const body = document.createElement('div');
      body.className = 'automation-message-body';
      body.textContent = item.text || '';

      header.append(model, meta);
      article.append(header, body);
      ui.feed.appendChild(article);
    });

    if (ui.feedSummary) {
      ui.feedSummary.textContent = feed.length
        ? `${feed.length} message${feed.length === 1 ? '' : 's'}`
        : 'No messages yet';
    }
    ui.feed.scrollTop = ui.feed.scrollHeight;
  }

  function renderDiagnostics() {
    if (!state) {
      ui.diagnostics.textContent = '';
      return;
    }
    ui.diagnostics.textContent = (state.journal || []).map((entry) =>
      `${String(entry.seq).padStart(3, '0')} ${entry.at} ${entry.type} ${JSON.stringify(entry.payload)}`
    ).join('\n');
    ui.diagnostics.scrollTop = ui.diagnostics.scrollHeight;
  }

  async function reportFatal(error) {
    console.error('[AutomationLayer]', error);
    if (state && ACTIVE_PHASES.has(state.phase)) {
      await failRun(error?.message || String(error));
    } else {
      showError(error?.message || String(error));
    }
  }

  function showError(message) {
    console.error('[AutomationLayer]', message);
    if (!state) return;
    addSystemMessage(String(message || 'Unknown error'), activeRoundNumber(), 'error');
    render();
  }

  function runtimeMessage(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Runtime message timeout: ${message.type}`));
      }, Number(timeoutMs || 10000));

      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    });
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function createRunId() {
    const suffix = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `AUTO-${Date.now()}-${suffix.toUpperCase()}`;
  }

  function createEventId(prefix) {
    const suffix = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
    return `${prefix}-${suffix}`;
  }

  function safeFilePart(value) {
    return String(value || 'run').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 100);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();

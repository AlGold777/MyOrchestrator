(() => {
  'use strict';

  const Protocol = globalThis.AutomationTestProtocol;
  if (!Protocol) throw new Error('AutomationTestProtocol is unavailable');

  const STORAGE_KEY = 'automationWebRuntimeSmoke.v21';
  const MAX_ATTEMPTS_PER_MODEL = 2;
  const POLL_INTERVAL_MS = 1200;
  const ROUND_TIMEOUT_MS = 15 * 60 * 1000;
  const DOWNLOAD_PREFIX = 'automation-v2.1-smoke';

  const terminalSuccess = new Set(['SUCCESS']);
  let state = null;
  let monitorTimer = null;
  let monitorBusy = false;

  const el = {};

  document.addEventListener('DOMContentLoaded', async () => {
    bindElements();
    el.synthesis.value = Protocol.DEFAULT_SYNTHESIS_INSTRUCTION;
    bindEvents();
    state = await loadState();
    if (state) {
      restoreFormFromState();
      render();
      if (isRunningPhase(state.phase) && state.currentAttempt) startMonitor();
    } else {
      render();
    }
  });

  function bindElements() {
    el.prompt = document.getElementById('automation-prompt');
    el.synthesis = document.getElementById('synthesis-instruction');
    el.run = document.getElementById('run-test');
    el.cancel = document.getElementById('cancel-test');
    el.downloadResult = document.getElementById('download-result');
    el.downloadAudit = document.getElementById('download-audit');
    el.phase = document.getElementById('phase-badge');
    el.runId = document.getElementById('run-id');
    el.error = document.getElementById('error-box');
    el.round1Models = document.getElementById('round1-models');
    el.round2Models = document.getElementById('round2-models');
    el.round1Combined = document.getElementById('round1-combined');
    el.round2Final = document.getElementById('round2-final');
    el.ledger = document.getElementById('ledger-view');
    el.modelChecks = Array.from(document.querySelectorAll('#model-grid input[type="checkbox"]'));
  }

  function bindEvents() {
    el.run.addEventListener('click', () => startNewTest().catch(failFatal));
    el.cancel.addEventListener('click', () => cancelTest().catch(failFatal));
    el.downloadResult.addEventListener('click', () => state?.resultText && downloadText(resultFilename(state), state.resultText));
    el.downloadAudit.addEventListener('click', () => state && downloadText(auditFilename(state), JSON.stringify(buildAuditExport(state), null, 2), 'application/json'));
    el.modelChecks.forEach((checkbox) => checkbox.addEventListener('change', enforceTwoModelSelection));
  }

  function enforceTwoModelSelection(event) {
    const checked = selectedModels();
    if (checked.length <= 2) return;
    event.target.checked = false;
    showError('Select exactly two models.');
  }

  function selectedModels() {
    return el.modelChecks.filter((box) => box.checked).map((box) => box.value);
  }

  async function startNewTest() {
    clearError();
    const prompt = el.prompt.value.trim();
    const models = selectedModels();
    if (!prompt) throw new Error('Enter a human request.');
    if (models.length !== 2) throw new Error('Select exactly two models.');

    const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 6000).catch(() => null);
    if (active?.active) throw new Error('Another MyOrchestrator run is active. Finish or stop it before this smoke test.');

    stopMonitor();
    state = {
      schemaVersion: 1,
      protocolVersion: Protocol.PROTOCOL_VERSION,
      runId: `AUTO-${Date.now()}-${randomToken('R')}`,
      phase: 'ROUND1_PREPARE',
      startedAt: new Date().toISOString(),
      completedAt: null,
      models,
      originalPrompt: prompt,
      originalPromptHash: await sha256(prompt),
      synthesisInstruction: el.synthesis.value.trim() || Protocol.DEFAULT_SYNTHESIS_INSTRUCTION,
      rounds: {
        1: createRoundState(),
        2: createRoundState()
      },
      currentAttempt: null,
      combinedRound1: '',
      resultText: '',
      ledger: []
    };
    await appendEvent('RUN_CREATED', {
      models,
      protocolVersion: state.protocolVersion,
      originalPromptHash: state.originalPromptHash
    });
    await saveState();
    render();
    await dispatchPendingModels(1, models);
  }

  function createRoundState() {
    return { status: 'PENDING', startedAt: null, completedAt: null, responses: {}, modelAttempts: {}, calls: {} };
  }

  async function dispatchPendingModels(roundNumber, models) {
    if (!state) return;
    const round = state.rounds[roundNumber];
    const eligible = models.filter((model) => Number(round.modelAttempts[model] || 0) < MAX_ATTEMPTS_PER_MODEL);
    if (!eligible.length) throw new Error(`Round ${roundNumber}: no retry budget remains.`);

    await waitUntilBackgroundIdle();

    const promptsByModel = {};
    const callMeta = {};
    for (const model of eligible) {
      const attemptNo = Number(round.modelAttempts[model] || 0) + 1;
      round.modelAttempts[model] = attemptNo;
      const callToken = randomToken('C');
      const attemptToken = `A${attemptNo}-${randomToken('T')}`;
      const prompt = roundNumber === 1
        ? Protocol.buildRoundOnePrompt({ modelName: model, userPrompt: state.originalPrompt, callToken, attemptToken })
        : Protocol.buildRoundTwoPrompt({
            modelName: model,
            originalPrompt: state.originalPrompt,
            combinedAnswers: state.combinedRound1,
            synthesisInstruction: state.synthesisInstruction,
            callToken,
            attemptToken
          });
      const [promptHash, callTokenHash, attemptTokenHash] = await Promise.all([
        sha256(prompt), sha256(callToken), sha256(attemptToken)
      ]);
      promptsByModel[model] = prompt;
      callMeta[model] = {
        model,
        attemptNo,
        callToken,
        attemptToken,
        callTokenHash,
        attemptTokenHash,
        promptHash,
        status: 'DISPATCHING'
      };
      round.calls[model] = callMeta[model];
    }

    if (!round.startedAt) round.startedAt = new Date().toISOString();
    round.status = 'RUNNING';
    state.phase = roundNumber === 1 ? 'ROUND1_RUNNING' : 'ROUND2_RUNNING';
    state.currentAttempt = {
      round: roundNumber,
      models: eligible,
      startedAt: Date.now(),
      deadlineAt: Date.now() + ROUND_TIMEOUT_MS
    };
    await appendEvent('ROUND_ATTEMPT_PREPARED', {
      round: roundNumber,
      models: eligible,
      calls: Object.fromEntries(eligible.map((model) => [model, publicCallMeta(callMeta[model])]))
    });
    await saveState();
    render();

    const response = await runtimeMessage({
      type: 'START_FULLPAGE_PROCESS',
      prompt: promptsByModel[eligible[0]],
      selectedLLMs: eligible,
      forceNewTabs: true,
      useApiFallback: false,
      promptsByModel,
      sourceView: 'automation',
      pipelineContext: {
        sourceView: 'automation',
        automationRunId: state.runId,
        automationRound: roundNumber,
        automationModels: eligible.slice(),
        protocolVersion: state.protocolVersion
      }
    }, 60000);

    if (response?.success === false || (response?.status && response.status !== 'process_started')) {
      throw new Error(`Round ${roundNumber} dispatch failed: ${response?.errorCode || response?.error || response?.status || 'unknown'}`);
    }

    eligible.forEach((model) => { round.calls[model].status = 'RUNNING'; });
    await appendEvent('ROUND_DISPATCHED', { round: roundNumber, models: eligible });
    await saveState();
    render();
    startMonitor();
  }

  function startMonitor() {
    stopMonitor();
    monitorTimer = setInterval(() => monitorCurrentAttempt().catch(failFatal), POLL_INTERVAL_MS);
    monitorCurrentAttempt().catch(failFatal);
  }

  function stopMonitor() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
  }

  async function monitorCurrentAttempt() {
    if (monitorBusy || !state?.currentAttempt) return;
    monitorBusy = true;
    try {
      const current = state.currentAttempt;
      if (Date.now() > current.deadlineAt) {
        await handleAttemptTerminal(null, 'round_timeout');
        return;
      }

      const stored = await chrome.storage.local.get('jobState');
      const jobState = stored?.jobState || null;
      const ctx = jobState?.session?.pipelineContext || {};
      if (ctx.automationRunId !== state.runId || Number(ctx.automationRound) !== Number(current.round)) return;

      let allTerminal = true;
      for (const model of current.models) {
        const entry = jobState?.llms?.[model];
        const call = state.rounds[current.round].calls[model];
        if (!entry) {
          allTerminal = false;
          if (call) call.status = 'WAITING_FOR_MODEL';
          continue;
        }
        const finalStatus = normalizeFinalStatus(entry);
        call.runtimeStatus = finalStatus || entry.status || 'RUNNING';
        call.status = entry.finalStatusRecorded ? finalStatus : (entry.status || 'RUNNING');
        if (!entry.finalStatusRecorded) allTerminal = false;
      }
      await saveState();
      render();
      if (allTerminal) await handleAttemptTerminal(jobState, null);
    } finally {
      monitorBusy = false;
    }
  }

  async function handleAttemptTerminal(jobState, forcedReason) {
    stopMonitor();
    const current = state.currentAttempt;
    if (!current) return;
    const roundNumber = current.round;
    const round = state.rounds[roundNumber];
    const retryModels = [];

    for (const model of current.models) {
      const call = round.calls[model];
      const entry = jobState?.llms?.[model] || null;
      const finalStatus = forcedReason ? 'ERROR' : normalizeFinalStatus(entry);
      const rawAnswer = String(entry?.answer || '').trim();
      let reason = forcedReason || null;
      let parsed = null;

      if (!reason && !terminalSuccess.has(finalStatus)) reason = `runtime_terminal_${finalStatus || 'unknown'}`;
      if (!reason && !rawAnswer) reason = 'empty_runtime_answer';
      if (!reason) {
        parsed = Protocol.parseFramedResponse(rawAnswer, call.callToken, call.attemptToken);
        if (!parsed.ok) reason = parsed.error;
      }

      if (!reason && parsed?.ok) {
        round.responses[model] = {
          model,
          content: parsed.content,
          finalStatus,
          attemptNo: call.attemptNo,
          promptHash: call.promptHash,
          capturedAt: new Date().toISOString()
        };
        call.status = 'ACCEPTED';
        call.callToken = null;
        call.attemptToken = null;
        await appendEvent('MODEL_RESPONSE_ACCEPTED', {
          round: roundNumber,
          model,
          attemptNo: call.attemptNo,
          promptHash: call.promptHash,
          callTokenHash: call.callTokenHash,
          attemptTokenHash: call.attemptTokenHash,
          contentHash: await sha256(parsed.content)
        });
      } else {
        call.status = 'REJECTED';
        call.error = reason || 'unknown';
        call.callToken = null;
        call.attemptToken = null;
        await appendEvent('MODEL_RESPONSE_REJECTED', {
          round: roundNumber,
          model,
          attemptNo: call.attemptNo,
          reason: call.error,
          runtimeStatus: finalStatus || null,
          promptHash: call.promptHash,
          callTokenHash: call.callTokenHash,
          attemptTokenHash: call.attemptTokenHash
        });
        if (Number(round.modelAttempts[model] || 0) < MAX_ATTEMPTS_PER_MODEL) retryModels.push(model);
      }
    }

    state.currentAttempt = null;
    await saveState();
    render();

    if (retryModels.length) {
      await appendEvent('ROUND_RETRY_SCHEDULED', { round: roundNumber, models: retryModels });
      await dispatchPendingModels(roundNumber, retryModels);
      return;
    }

    const missing = state.models.filter((model) => !round.responses[model]?.content);
    if (missing.length) {
      throw new Error(`Round ${roundNumber} failed after ${MAX_ATTEMPTS_PER_MODEL} attempts: ${missing.join(', ')}`);
    }

    round.status = 'COMPLETE';
    round.completedAt = new Date().toISOString();
    await appendEvent('ROUND_COMMITTED', {
      round: roundNumber,
      models: state.models,
      responseHashes: Object.fromEntries(await Promise.all(
        state.models.map(async (model) => [model, await sha256(round.responses[model].content)])
      ))
    });

    if (roundNumber === 1) {
      state.combinedRound1 = Protocol.combineAnswers(state.models, round.responses);
      state.phase = 'ROUND1_COMMITTED';
      await saveState();
      render();
      await dispatchPendingModels(2, state.models);
      return;
    }

    await completeRun();
  }

  async function completeRun() {
    state.completedAt = new Date().toISOString();
    state.phase = 'COMPLETED';
    state.resultText = Protocol.buildResultText({
      runId: state.runId,
      completedAt: state.completedAt,
      models: state.models,
      originalPrompt: state.originalPrompt,
      synthesisInstruction: state.synthesisInstruction,
      round1: state.rounds[1].responses,
      round2: state.rounds[2].responses
    });
    await appendEvent('RUN_COMMITTED', {
      round1Models: Object.keys(state.rounds[1].responses),
      round2Models: Object.keys(state.rounds[2].responses),
      resultHash: await sha256(state.resultText)
    });
    await saveState();
    render();
    await downloadText(resultFilename(state), state.resultText);
    await downloadText(auditFilename(state), JSON.stringify(buildAuditExport(state), null, 2), 'application/json');
  }

  async function waitUntilBackgroundIdle() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const active = await runtimeMessage({ type: 'GET_ACTIVE_RUN_STATE' }, 5000).catch(() => null);
      if (!active?.active) return;
      await sleep(600);
    }
    throw new Error('Background orchestrator did not become idle before next attempt.');
  }

  async function cancelTest() {
    if (!state || !isRunningPhase(state.phase)) return;
    await runtimeMessage({ type: 'STOP_ALL', platforms: state.models }, 8000).catch(() => null);
    stopMonitor();
    state.phase = 'CANCELLED';
    state.currentAttempt = null;
    await appendEvent('RUN_CANCELLED', {});
    await saveState();
    render();
  }

  function normalizeFinalStatus(entry) {
    return String(entry?.finalStatus || entry?.modelRunState?.terminalStatus || entry?.status || '').toUpperCase();
  }

  function publicCallMeta(call) {
    return {
      model: call.model,
      attemptNo: call.attemptNo,
      promptHash: call.promptHash,
      callTokenHash: call.callTokenHash,
      attemptTokenHash: call.attemptTokenHash,
      status: call.status
    };
  }

  async function appendEvent(type, payload) {
    if (!state) return;
    state.ledger.push({
      seq: state.ledger.length + 1,
      at: new Date().toISOString(),
      type,
      payload: payload || {}
    });
    await saveState();
  }

  async function saveState() {
    if (!state) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return stored?.[STORAGE_KEY] || null;
  }

  function restoreFormFromState() {
    if (!state) return;
    el.prompt.value = state.originalPrompt || '';
    el.synthesis.value = state.synthesisInstruction || Protocol.DEFAULT_SYNTHESIS_INSTRUCTION;
    el.modelChecks.forEach((box) => { box.checked = state.models?.includes(box.value) || false; });
  }

  function render() {
    const phase = state?.phase || 'IDLE';
    el.phase.textContent = phase;
    el.phase.className = `badge ${phase === 'COMPLETED' ? 'success' : (phase === 'ERROR' || phase === 'CANCELLED' ? 'error' : (phase === 'IDLE' ? 'idle' : 'running'))}`;
    el.runId.textContent = state?.runId || 'No active run';
    const running = isRunningPhase(phase);
    el.run.disabled = running;
    el.cancel.disabled = !running;
    el.downloadResult.disabled = !state?.resultText;
    el.downloadAudit.disabled = !state;
    if (state) {
      renderRound(1, el.round1Models);
      renderRound(2, el.round2Models);
      el.round1Combined.value = state.combinedRound1 || '';
      el.round2Final.value = state.models.map((model) => {
        const content = state.rounds?.[2]?.responses?.[model]?.content || '';
        return content ? `===== ${model} =====\n${content}` : '';
      }).filter(Boolean).join('\n\n');
      el.ledger.textContent = state.ledger.map(
        (event) => `${String(event.seq).padStart(3, '0')} ${event.at} ${event.type} ${JSON.stringify(event.payload)}`
      ).join('\n');
      el.ledger.scrollTop = el.ledger.scrollHeight;
    } else {
      el.round1Models.innerHTML = '';
      el.round2Models.innerHTML = '';
      el.round1Combined.value = '';
      el.round2Final.value = '';
      el.ledger.textContent = '';
    }
  }

  function renderRound(roundNumber, container) {
    const round = state?.rounds?.[roundNumber];
    container.innerHTML = '';
    (state?.models || []).forEach((model) => {
      const response = round?.responses?.[model];
      const call = round?.calls?.[model];
      const status = response ? 'ACCEPTED' : (call?.status || round?.status || 'PENDING');
      const row = document.createElement('div');
      row.className = 'model-status';
      const cls = status === 'ACCEPTED'
        ? 'status-ok'
        : (/REJECTED|ERROR|FAIL/.test(status) ? 'status-error' : 'status-running');
      row.innerHTML = `<strong>${escapeHtml(model)}</strong><span class="${cls}">${escapeHtml(status)}</span><span class="muted mono">attempt ${round?.modelAttempts?.[model] || 0}/${MAX_ATTEMPTS_PER_MODEL}</span>`;
      container.appendChild(row);
    });
  }

  function isRunningPhase(phase) {
    const value = String(phase || '');
    return value === 'ROUND1_PREPARE'
      || value === 'ROUND1_RUNNING'
      || value === 'ROUND1_COMMITTED'
      || value === 'ROUND2_RUNNING';
  }

  async function failFatal(error) {
    console.error('[automation]', error);
    stopMonitor();
    if (state) {
      state.phase = 'ERROR';
      state.currentAttempt = null;
      await appendEvent('RUN_FAILED', { error: error?.message || String(error) });
      await saveState();
    }
    showError(error?.message || String(error));
    render();
  }

  function showError(message) {
    el.error.hidden = false;
    el.error.textContent = message;
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = '';
  }

  function runtimeMessage(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Runtime message timed out: ${message.type}`));
      }, timeoutMs || 10000);
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
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function randomToken(prefix) {
    const raw = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${raw.toUpperCase()}`;
  }

  async function downloadText(filename, content, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
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

  function buildAuditExport(currentState) {
    return {
      schemaVersion: currentState.schemaVersion,
      protocolVersion: currentState.protocolVersion,
      runId: currentState.runId,
      phase: currentState.phase,
      startedAt: currentState.startedAt,
      completedAt: currentState.completedAt,
      models: currentState.models,
      originalPromptHash: currentState.originalPromptHash || null,
      rounds: {
        1: publicRound(currentState.rounds[1]),
        2: publicRound(currentState.rounds[2])
      },
      ledger: currentState.ledger
    };
  }

  function publicRound(round) {
    return {
      status: round.status,
      startedAt: round.startedAt,
      completedAt: round.completedAt,
      modelAttempts: round.modelAttempts,
      calls: Object.fromEntries(
        Object.entries(round.calls || {}).map(([model, call]) => [model, publicCallMeta(call)])
      ),
      responses: Object.fromEntries(
        Object.entries(round.responses || {}).map(([model, response]) => [model, {
          model,
          attemptNo: response.attemptNo,
          finalStatus: response.finalStatus,
          promptHash: response.promptHash,
          capturedAt: response.capturedAt,
          contentLength: response.content?.length || 0
        }])
      )
    };
  }

  function resultFilename(currentState) {
    return `${DOWNLOAD_PREFIX}-${safeFilePart(currentState.runId)}-result.txt`;
  }

  function auditFilename(currentState) {
    return `${DOWNLOAD_PREFIX}-${safeFilePart(currentState.runId)}-audit.json`;
  }

  function safeFilePart(value) {
    return String(value || 'run').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 96);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();

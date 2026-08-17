// background/evaluation-manager.js
// Evaluation flow and session shutdown helpers.

'use strict';

function startEvaluation(evalPrompt, evaluatorName = 'Claude', options = {}) {
  const { openEvaluatorTab = true } = options;
  globalThis.LLMLog?.debug?.(
    `[BACKGROUND] Starting evaluation in a ${openEvaluatorTab ? 'foreground' : 'background'} tab using ${evaluatorName}.`
  );

  if (!evalPrompt) {
    const llmNames = Object.keys(jobState.llms);
    const responseMap = {};
    llmNames.forEach((llmName) => {
      responseMap[llmName] = jobState.llms[llmName].answer;
    });
    const responses = self.JudgePromptBuilder?.buildResponsesList
      ? self.JudgePromptBuilder.buildResponsesList(responseMap, { orderedNames: llmNames })
      : { list: llmNames.map((llmName) => `<<<RESPONSE legacy ${llmName} START>>>\n${responseMap[llmName] || ''}\n<<<RESPONSE legacy ${llmName} END>>>`).join('\n\n') };
    evalPrompt = self.JudgePromptBuilder?.buildJudgeEvaluationPrompt
      ? self.JudgePromptBuilder.buildJudgeEvaluationPrompt('', jobState.prompt, responses.list)
      : `Compare ${llmNames.length} responses to the question: "${jobState.prompt}".\n\nResponses for analysis:\n\n${responses.list}\n\nSelect the best response, briefly explain why, and present the result as a bulleted list.`;
    evaluatorName = 'GPT';
  }

  const evaluatorUrls = {
    'GPT': 'https://chat.openai.com/',
    'Gemini': 'https://gemini.google.com/',
    'Claude': 'https://claude.ai/chat/new',
    'Grok': 'https://grok.com/',
    'Le Chat': 'https://chat.mistral.ai/chat/',
    'Qwen': 'https://chat.qwen.ai/',
    'DeepSeek': 'https://chat.deepseek.com/',
    'Perplexity': 'https://www.perplexity.ai/',
    'Z.ai': 'https://chat.z.ai/',
    'Kimi': 'https://www.kimi.ai/'
  };

  const url = evaluatorUrls[evaluatorName];
  if (!url) {
    const errorMsg = `Unknown evaluator '${evaluatorName}'. Cannot open tab.`;
    console.error(`[BACKGROUND] ${errorMsg}`);
    sendMessageToResultsTab({
      type: 'PROCESS_COMPLETE',
      finalAnswer: '',
      error: { type: 'unknown_evaluator', message: errorMsg }
    });
    return;
  }

  globalThis.LLMLog?.debug?.(`[BACKGROUND] Creating new tab for ${evaluatorName} at ${url}`);
  chrome.tabs.create({ url: url, active: openEvaluatorTab }, (tab) => {
    evaluatorTabId = tab.id;
    trackSessionTab(tab.id);
    globalThis.LLMLog?.debug?.(`[BACKGROUND] Created evaluation tab ${tab.id} for ${evaluatorName}.`);

    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Evaluation tab ${tabId} loaded.`);

        const readyTimeoutMs = self.ModelPolicy?.getPromptSubmitTimeoutMs
          ? self.ModelPolicy.getPromptSubmitTimeoutMs(evaluatorName, 20000)
          : 20000;
        const submitTimeoutMs = self.ModelPolicy?.getPromptSubmitTimeoutMs
          ? self.ModelPolicy.getPromptSubmitTimeoutMs(evaluatorName, 20000)
          : 20000;

        ReadySignalManager.waitForReady(tab.id, readyTimeoutMs)
          .then(() => {
          globalThis.LLMLog?.debug?.(`[BACKGROUND] Evaluation tab ${tab.id} ready, sending evaluation prompt.`);
          chrome.tabs.sendMessage(tab.id, {
            type: 'GET_ANSWER',
            prompt: evalPrompt,
            isEvaluator: true,
            isFireAndForget: false,
            promptSubmitTimeoutMs: submitTimeoutMs
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error(`[BACKGROUND] Error delivering evaluation prompt:`, chrome.runtime.lastError.message);
              sendMessageToResultsTab({
                type: 'PROCESS_COMPLETE',
                finalAnswer: '',
                error: {
                  type: 'evaluation_prompt_delivery_failed',
                  message: `Failed to deliver evaluation prompt (${chrome.runtime.lastError.message})`
                }
              });
            } else {
              globalThis.LLMLog?.debug?.('[BACKGROUND] Evaluation prompt delivered successfully.');
              sendMessageToResultsTab({ type: 'STARTING_EVALUATION' });
            }
          });
        })
          .catch((err) => {
            console.error('[BACKGROUND] Evaluation tab never became ready:', err?.message || err);
            sendMessageToResultsTab({
              type: 'PROCESS_COMPLETE',
              finalAnswer: '',
              error: {
                type: 'evaluator_not_ready',
                message: `Evaluator tab did not become ready (${err?.message || 'timeout'})`
              }
            });
          });

        chrome.tabs.onUpdated.removeListener(listener);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function handleEvaluatorResponse(finalAnswer) {
  globalThis.LLMLog?.debug?.(`[BACKGROUND] Received evaluator response:`, finalAnswer.substring(0, 100) + '...');

  sendMessageToResultsTab({
    type: 'PROCESS_COMPLETE',
    finalAnswer: finalAnswer
  });
}

function closeAllSessions() {
  globalThis.LLMLog?.debug?.('[BACKGROUND] Closing all active LLM tabs with cleanup...');
  stopHumanPresenceLoop();
  finalizeTabVisit('session_closed');
  humanPresencePaused = false;
  humanPresenceManuallyStopped = false;

  TabMapManager.entries().forEach(([llmName, tabId]) => {
    chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }, () => {
      if (chrome.runtime.lastError) {
        console.warn(`[BACKGROUND] Cleanup message failed for ${llmName}:`, chrome.runtime.lastError.message);
      }
    });
  });

  if (evaluatorTabId) {
    chrome.tabs.sendMessage(evaluatorTabId, { type: 'STOP_AND_CLEANUP' }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[BACKGROUND] Cleanup message failed for evaluator');
      }
    });
  }

  setTimeout(() => {
    const tabIdsToClose = TabMapManager.entries().map(([, id]) => id);

    if (evaluatorTabId) {
      tabIdsToClose.push(evaluatorTabId);
    }

    const closeEligibleTabs = async () => {
      const uniqueTabIds = Array.from(new Set(tabIdsToClose));
      const tabs = await Promise.all(uniqueTabIds.map((tabId) => getTabSafe(tabId)));
      const safeTabIds = tabs
        .filter((tab) => tab?.id && !isAppUiTab(tab))
        .map((tab) => tab.id);
      if (safeTabIds.length > 0) {
        chrome.tabs.remove(safeTabIds, () => {
          if (chrome.runtime.lastError) {
            console.error('[BACKGROUND] Error closing tabs:', chrome.runtime.lastError.message);
          } else {
            globalThis.LLMLog?.debug?.('[BACKGROUND] All LLM tabs have been closed.');
          }
        });
      }
    };
    closeEligibleTabs().catch((err) => {
      console.warn('[BACKGROUND] Failed to filter evaluation tabs before closing:', err);
    });

    // Purpose: reset tab tracking without throwing inside the timeout callback.
    TabMapManager.clear().catch((err) => {
      console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
    });
    evaluatorTabId = null;
    Object.keys(pingWindowByTabId).forEach(tabId => delete pingWindowByTabId[tabId]);
    Object.keys(llmActivityMap).forEach((tabId) => delete llmActivityMap[tabId]);
    clearActiveListeners();
    broadcastHumanVisitStatus();
  }, 500);
}

self.startEvaluation = startEvaluation;
self.handleEvaluatorResponse = handleEvaluatorResponse;
self.closeAllSessions = closeAllSessions;

globalThis.LLMLog?.debug?.('[EvaluationManager] Module loaded');

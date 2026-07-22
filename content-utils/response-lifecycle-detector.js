(function initResponseLifecycleDetector() {
  if (window.LLMExtension?.ResponseLifecycleDetector) return;

  const VERSION = '1.0.0';
  const BODY_MUTATION_THROTTLE_MS = 500;
  const ANSWER_GENERATING_TELEMETRY_THROTTLE_MS = 15000;
  const MIN_COMPLETE_CONFIDENCE = 0.75;
  const STUCK_BUSY_OVERRIDE_MIN_MS = 6000;
  const LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS = 800;
  const RESPONSE_LIFECYCLE_DEFAULTS = {
    enabled: true,
    answerStartTimeoutMs: 30000,
    answerCompleteTimeoutMs: 180000,
    stableMs: 1500,
    pollIntervalMs: 600,
    minCompleteConfidence: 0.75
  };
  const GENERATING_SELECTORS = [
    '[aria-label*="Stop" i]',
    '[aria-label*="Останов" i]',
    '[aria-label*="Detener" i]',
    '[aria-label*="Arrêter" i]',
    '[title*="Stop" i]',
    '[title*="Останов" i]',
    '[title*="Detener" i]',
    '[title*="Arrêter" i]',
    'button[data-testid*="stop" i]',
    '[aria-busy="true"]',
    '[data-loading="true"]',
    '[class*="loading" i]',
    '[class*="spinner" i]',
    '[class*="streaming" i]',
    '[class*="generating" i]',
    '[role="progressbar"]'
  ];

  const trackers = new Map();
  const registeredCandidates = new Map();
  let settingsPromise = null;
  let cachedSettings = null;
  let runtimePatched = false;
  let bodyMutationScheduledAt = 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isTrackerActive(tracker) {
    return !!tracker && tracker.state !== 'CANCELLED' && tracker.cancelledAt == null;
  }

  function trackerCancelledResult(tracker) {
    return {
      ok: false,
      state: 'CANCELLED',
      reason: tracker?.cancelReason || 'cancelled'
    };
  }

  function clearTrackerTimers(tracker) {
    if (!tracker) return;
    const pollTimers = Array.isArray(tracker.pollTimers) ? tracker.pollTimers : [];
    const timeoutTimers = Array.isArray(tracker.timeoutTimers) ? tracker.timeoutTimers : [];
    pollTimers.forEach((entry) => {
      try { clearTimeout(entry?.id ?? entry); } catch (_) {}
      try { entry?.resolve?.(false); } catch (_) {}
    });
    timeoutTimers.forEach((entry) => {
      try { clearTimeout(entry?.id ?? entry); } catch (_) {}
      try { entry?.resolve?.(false); } catch (_) {}
    });
    tracker.pollTimers = [];
    tracker.timeoutTimers = [];
  }

  function delayForTracker(tracker, ms, timerKind = 'poll') {
    if (!isTrackerActive(tracker)) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const timerId = setTimeout(() => {
        const list = timerKind === 'timeout' ? tracker.timeoutTimers : tracker.pollTimers;
        if (Array.isArray(list)) {
          const idx = list.findIndex((entry) => entry?.id === timerId || entry === timerId);
          if (idx !== -1) list.splice(idx, 1);
        }
        resolve(isTrackerActive(tracker));
      }, ms);
      const list = timerKind === 'timeout' ? tracker.timeoutTimers : tracker.pollTimers;
      if (Array.isArray(list)) {
        list.push({ id: timerId, resolve });
      }
    });
  }

  function elementRect(el) {
    try {
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return null;
      return {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    } catch (_) {
      return null;
    }
  }

  function isVisible(el) {
    const rect = elementRect(el);
    if (!el || !el.isConnected || !rect || rect.width <= 1 || rect.height <= 1) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (Number(style.opacity || '1') <= 0.05) return false;
    } catch (_) {}
    return true;
  }

  function isEditableElement(el) {
    if (!el || !isVisible(el)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.isContentEditable) return true;
    const tagName = String(el.tagName || '').toUpperCase();
    if (tagName === 'TEXTAREA') return true;
    if (tagName === 'INPUT') {
      const type = String(el.getAttribute?.('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url'].includes(type);
    }
    return String(el.getAttribute?.('role') || '').toLowerCase() === 'textbox';
  }

  function detectCheapComposerReadiness(tracker = null) {
    const active = document.activeElement;
    if (isEditableElement(active)) {
      return { composerReady: true, sendButtonReady: false, source: 'active_element' };
    }
    if (tracker?.composerEl && isEditableElement(tracker.composerEl)) {
      const sendButtonReady = !!(tracker.sendButtonEl?.isConnected && !tracker.sendButtonEl.disabled && isVisible(tracker.sendButtonEl));
      return { composerReady: true, sendButtonReady, source: 'tracker_composer' };
    }
    const vh = Math.max(1, window.innerHeight || document.documentElement?.clientHeight || 1);
    const candidates = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).slice(0, 60);
    const composer = candidates.find((el) => {
      const rect = elementRect(el);
      return isEditableElement(el) && rect && rect.top >= vh * 0.45;
    });
    if (composer) {
      return { composerReady: true, sendButtonReady: false, source: 'lower_viewport_candidate', composerEl: composer };
    }
    return { composerReady: false, sendButtonReady: false, source: 'inconclusive' };
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function shortHash(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  async function readStorage(key) {
    try {
      if (chrome?.storage?.local?.get) {
        const result = await chrome.storage.local.get({ [key]: null });
        return result?.[key] ?? null;
      }
    } catch (_) {}
    try {
      const raw = window.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function getSettings() {
    if (cachedSettings) return cachedSettings;
    if (!settingsPromise) {
      settingsPromise = readStorage('responseLifecycleDetectorSettings')
        .then((stored) => Object.assign({}, RESPONSE_LIFECYCLE_DEFAULTS, stored || {}))
        .catch(() => Object.assign({}, RESPONSE_LIFECYCLE_DEFAULTS))
        .then((settings) => {
          cachedSettings = settings;
          return settings;
        });
    }
    return settingsPromise;
  }

  function emitLifecycleTelemetry(event, payload = {}) {
    try {
      chrome.runtime.sendMessage({
        type: 'LLM_DIAGNOSTIC_EVENT',
        llmName: payload.modelName,
        event: {
          type: 'LIFECYCLE',
          label: event,
          level: payload.state === 'ERROR' ? 'warning' : 'info',
          details: `state=${payload.state || 'n/a'} textLength=${payload.textLength || 0}`,
          meta: {
            modelName: payload.modelName || null,
            state: payload.state || null,
            textLength: payload.textLength || 0,
            elapsedMs: payload.elapsedMs || 0,
            stableMs: payload.stableMs || 0,
            mutationCount: payload.mutationCount || 0,
            hasStopButton: !!payload.hasStopButton,
            hasLoadingIndicator: !!payload.hasLoadingIndicator,
            composerReady: !!payload.composerReady,
            sendButtonReady: !!payload.sendButtonReady,
            confidence: typeof payload.confidence === 'number' ? payload.confidence : null
          }
        }
      });
    } catch (_) {}
  }

  function isTextStable(previous, current, stableSince, stableMs) {
    const currentHash = shortHash(normalizeText(current || ''));
    const previousHash = previous?.hash || null;
    const previousLength = previous?.length || 0;
    const currentLength = normalizeText(current || '').length;
    if (currentHash !== previousHash || Math.abs(currentLength - previousLength) > 2) {
      return {
        stable: false,
        hash: currentHash,
        length: currentLength,
        stableSince: Date.now()
      };
    }
    return {
      stable: Date.now() - stableSince >= stableMs,
      hash: currentHash,
      length: currentLength,
      stableSince
    };
  }

  function detectGeneratingIndicators({ root = document }) {
    const indicators = [];
    const canQuery = !!(root && typeof root.querySelectorAll === 'function');
    let queriesAttempted = 0;
    let queriesFailed = 0;
    if (canQuery) {
      for (const selector of GENERATING_SELECTORS) {
        queriesAttempted += 1;
        try {
          const nodes = Array.from(root.querySelectorAll(selector)).filter((el) => isVisible(el));
          if (nodes.length) indicators.push(selector);
        } catch (_) { queriesFailed += 1; }
      }
    }
    // Localized stop labels (Останов/Detener/Arrêter) do not contain "stop"; without
    // matching them a present stop button would read as absent -> false completion.
    const hasStopButton = indicators.some((selector) => /stop|останов|detener|arrêter/i.test(selector));
    const hasLoadingIndicator = indicators.some((selector) => /busy|loading|spinner|generating/i.test(selector));
    const hasStreamingCursor = indicators.some((selector) => /streaming/i.test(selector));
    const hasProgressbar = indicators.some((selector) => /progressbar/i.test(selector));
    // Tri-state completion contract: the probe is trustworthy only if we could query the
    // DOM and not every query threw. When untrustworthy, "no stop button" means UNKNOWN,
    // not "generation finished" — so completion must NOT be inferred from absence
    // (unknown !== false). Genuine absence (probe ran, nothing matched) stays `false`.
    const probeTrusted = canQuery && queriesAttempted > 0 && queriesFailed < queriesAttempted;
    const stopButtonSignal = hasStopButton ? true : (probeTrusted ? false : 'unknown');
    return {
      hasStopButton,
      hasLoadingIndicator,
      hasStreamingCursor,
      hasProgressbar,
      stopButtonSignal,
      probeTrusted,
      indicators,
      diagnostics: {}
    };
  }

  async function getLatestAnswerSnapshot(modelName, traceId = null) {
    const resolver = window.LLMExtension?.SelectorResolverV2;
    const registered = registeredCandidates.get(modelName);
    const registeredMatchesTrace = !traceId || !registered?.traceId || String(registered.traceId) === String(traceId);
    if (registeredMatchesTrace && registered?.element?.isConnected) {
      const text = normalizeText(registered.element.innerText || registered.element.textContent || '');
      return {
        element: registered.element,
        text,
        textLength: text.length,
        method: registered.method || 'registered',
        traceId
      };
    }
    if (resolver?.resolveLatestAssistantAnswer) {
      const result = await resolver.resolveLatestAssistantAnswer({
        modelName,
        reason: 'collect',
        traceId
      });
      if (result?.ok && result.element) {
        const text = normalizeText(result.element.innerText || result.element.textContent || '');
        return {
          element: result.element,
          text,
          textLength: text.length,
          method: result.method || 'resolver',
          traceId
        };
      }
    }
    return {
      element: null,
      text: '',
      textLength: 0,
      method: 'none',
      traceId
    };
  }

  function attachTrackerObserver(tracker, target) {
    if (!tracker || !target || !target.isConnected) return false;
    if (tracker.observer) {
      try { tracker.observer.disconnect(); } catch (_) {}
      tracker.observer = null;
    }
    const observeTarget = target === document.body ? document.body : target;
    if (!observeTarget) return false;
    const observer = new MutationObserver(() => {
      const now = Date.now();
      if (observeTarget === document.body && now - bodyMutationScheduledAt < BODY_MUTATION_THROTTLE_MS) {
        return;
      }
      bodyMutationScheduledAt = now;
      tracker.lastMutationAt = now;
      tracker.mutationCount += 1;
    });
    observer.observe(observeTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });
    tracker.observer = observer;
    tracker.observedTarget = observeTarget;
    return true;
  }

  function registerAnswerCandidate({
    modelName,
    element,
    method,
    selector,
    score,
    confidence,
    traceId,
    observedAt
  }) {
    if (!modelName || !element) return false;
    registeredCandidates.set(modelName, {
      modelName,
      element,
      method: method || 'resolver',
      selector: selector || null,
      score: Number(score || 0),
      confidence: Number(confidence || 0),
      traceId: traceId || null,
      observedAt: observedAt || Date.now()
    });
    const tracker = trackers.get(modelName);
    if (tracker) {
      tracker.latestAnswerEl = element;
      attachTrackerObserver(tracker, element);
    }
    return true;
  }

  function createTracker({
    modelName,
    dispatchId = null,
    runSessionId = null,
    promptSubmittedAt = Date.now(),
    traceId = null,
    baselineSnapshot = null
  }) {
    return {
      modelName,
      dispatchId,
      runSessionId,
      traceId,
      startedAt: Date.now(),
      promptSubmittedAt,
      baselineElement: baselineSnapshot?.element || null,
      baselineTextHash: shortHash(normalizeText(baselineSnapshot?.text || '')),
      baselineTextLength: Number(baselineSnapshot?.textLength || 0),
      baselineCapturedAt: Date.now(),
      freshAnswerObserved: false,
      answerStartedAt: null,
      lastMutationAt: 0,
      lastTextChangeAt: 0,
      lastTextHash: null,
      lastTextLength: 0,
      stableSince: Date.now(),
      state: 'PROMPT_SUBMITTED',
      latestAnswerEl: null,
      latestAnswerText: '',
      mutationCount: 0,
      diagnostics: {},
      observer: null,
      observedTarget: null,
      pollTimers: [],
      timeoutTimers: [],
      finalReadinessCheckedAt: null,
      cancelledAt: null,
      cancelReason: null,
      cancelled: false
    };
  }

  async function waitForAnswerStart({
    modelName,
    promptSubmittedAt,
    timeoutMs = 30000,
    pollIntervalMs = 500,
    traceId = null
  }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tracker = trackers.get(modelName);
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      const snapshot = await getLatestAnswerSnapshot(modelName, traceId);
      const registered = registeredCandidates.get(modelName);
      if (snapshot.element && !tracker.latestAnswerEl) {
        tracker.latestAnswerEl = snapshot.element;
        attachTrackerObserver(tracker, snapshot.element);
      } else if (!tracker.latestAnswerEl && registered?.element) {
        tracker.latestAnswerEl = registered.element;
        attachTrackerObserver(tracker, registered.element);
      } else if (!tracker.latestAnswerEl) {
        attachTrackerObserver(tracker, document.body);
      }
      const textLength = snapshot.textLength || 0;
      const indicators = detectGeneratingIndicators({ modelName, root: document });
      const snapshotHash = shortHash(normalizeText(snapshot.text || ''));
      const newAnswerElement = !!snapshot.element && !!tracker.baselineElement && snapshot.element !== tracker.baselineElement;
      const firstAnswerElement = !!snapshot.element && !tracker.baselineElement;
      const baselineElementChanged = !!snapshot.element
        && snapshot.element === tracker.baselineElement
        && snapshotHash !== tracker.baselineTextHash
        && tracker.lastMutationAt > promptSubmittedAt;
      const generationSignal = indicators.hasStopButton
        || indicators.hasLoadingIndicator
        || indicators.hasStreamingCursor
        || indicators.hasProgressbar;
      const hasStarted = (textLength >= 1 && (newAnswerElement || firstAnswerElement || baselineElementChanged)) || generationSignal;
      if (hasStarted) {
        const answerStartedAt = Date.now();
        tracker.answerStartedAt = answerStartedAt;
        tracker.state = 'ANSWER_STARTED';
        tracker.latestAnswerText = snapshot.text;
        tracker.freshAnswerObserved = true;
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        emitLifecycleTelemetry('ANSWER_START_DETECTED', {
          modelName,
          state: 'ANSWER_STARTED',
          textLength,
          elapsedMs: answerStartedAt - promptSubmittedAt,
          mutationCount: tracker.mutationCount
        });
        return {
          ok: true,
          state: 'ANSWER_STARTED',
          answerStartedAt,
          latestAnswerEl: snapshot.element,
          textLength,
          diagnostics: { method: snapshot.method }
        };
      }
      if (!(await delayForTracker(tracker, pollIntervalMs, 'poll'))) {
        return trackerCancelledResult(tracker);
      }
    }
    return {
      ok: false,
      state: 'TIMEOUT',
      reason: 'answer_start_timeout'
    };
  }

  async function waitForAnswerComplete({
    modelName,
    timeoutMs = 180000,
    stableMs = 1500,
    pollIntervalMs = 600,
    traceId = null
  }) {
    const deadline = Date.now() + timeoutMs;
    let previous = { hash: null, length: 0 };
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const tracker = trackers.get(modelName);
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      const snapshot = await getLatestAnswerSnapshot(modelName, traceId);
      tracker.latestAnswerEl = snapshot.element || tracker.latestAnswerEl;
      tracker.latestAnswerText = snapshot.text;
      if (tracker.latestAnswerEl && (!tracker.observer || tracker.observedTarget !== tracker.latestAnswerEl)) {
        attachTrackerObserver(tracker, tracker.latestAnswerEl);
      }
      const stability = isTextStable(previous, snapshot.text, stableSince, stableMs);
      previous = { hash: stability.hash, length: stability.length };
      stableSince = stability.stableSince;
      tracker.lastTextHash = stability.hash;
      tracker.lastTextLength = stability.length;
      tracker.stableSince = stability.stableSince;
      const mutationQuiet = Date.now() - (tracker.lastMutationAt || 0) >= stableMs;
      let composerReady = false;
      let sendButtonReady = false;
      let indicators = {
        hasStopButton: false,
        hasLoadingIndicator: false,
        hasStreamingCursor: false,
        hasProgressbar: false,
        indicators: [],
        diagnostics: {}
      };
      if (stability.stable && !tracker.finalReadinessCheckedAt) {
        tracker.finalReadinessCheckedAt = Date.now();
        indicators = detectGeneratingIndicators({ modelName, root: document });
        const cheap = detectCheapComposerReadiness(tracker);
        composerReady = !!cheap.composerReady;
        sendButtonReady = !!cheap.sendButtonReady;
        if (cheap.composerEl) {
          tracker.composerEl = cheap.composerEl;
        }
        if (!composerReady) {
          const resolver = window.LLMExtension?.SelectorResolverV2;
          if (resolver?.resolveComposer) {
            try {
              const composer = await resolver.resolveComposer({
                modelName,
                reason: 'lifecycle_final_readiness',
                timeoutMs: LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
                preferCached: true,
                traceId
              });
              if (!isTrackerActive(tracker)) {
                return trackerCancelledResult(tracker);
              }
              composerReady = !!(composer?.ok && composer.element);
              tracker.composerEl = composer?.element || tracker.composerEl || null;
              if (composer?.ok && resolver.resolveSendButton) {
                const sendButton = await resolver.resolveSendButton({
                  modelName,
                  composerEl: composer.element,
                  reason: 'lifecycle_final_readiness',
                  timeoutMs: LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
                  preferCached: true,
                  traceId
                });
                if (!isTrackerActive(tracker)) {
                  return trackerCancelledResult(tracker);
                }
                sendButtonReady = !!(sendButton?.ok && sendButton.element && !sendButton.element.disabled);
                tracker.sendButtonEl = sendButton?.element || tracker.sendButtonEl || null;
              }
            } catch (_) {}
          }
        }
      } else if (tracker.finalReadinessCheckedAt) {
        const cheap = detectCheapComposerReadiness(tracker);
        composerReady = !!cheap.composerReady;
        sendButtonReady = !!cheap.sendButtonReady;
        indicators = detectGeneratingIndicators({ modelName, root: document });
      }
      const completionSignals = {
        textStable: !!stability.stable,
        // Only a *confirmed* absent stop button counts (stopButtonSignal === false).
        // An 'unknown' (untrusted probe) grants no completion credit.
        noStopButton: indicators.stopButtonSignal === false,
        stopButtonUnknown: indicators.stopButtonSignal === 'unknown',
        noLoadingIndicator: !indicators.hasLoadingIndicator && !indicators.hasProgressbar,
        composerReady,
        sendButtonReady,
        mutationQuiet
      };
      let confidence = 0;
      if (completionSignals.textStable) confidence += 0.35;
      if (completionSignals.noStopButton) confidence += 0.20; // unknown stop -> no credit
      if (completionSignals.noLoadingIndicator) confidence += 0.15;
      if (completionSignals.mutationQuiet) confidence += 0.15;
      if (completionSignals.composerReady) confidence += 0.10;
      if (completionSignals.sendButtonReady) confidence += 0.05;
      tracker.state = stability.stable && (indicators.hasLoadingIndicator || indicators.hasStopButton) ? 'GENERATING' : (stability.stable ? 'STABLE' : 'ANSWER_STARTED');
      if (stability.stable && (indicators.hasLoadingIndicator || indicators.hasStopButton)) {
        // Throttle: a stuck busy indicator over stable text used to emit this on every
        // poll tick (~50 identical events for DeepSeek in run 1781157526316), flooding
        // the diagnostics buffer and evicting terminal events before export.
        const lastGenerating = tracker.lastGeneratingTelemetry || null;
        const generatingChanged = !lastGenerating
          || lastGenerating.textLength !== snapshot.textLength
          || (Date.now() - lastGenerating.ts) >= ANSWER_GENERATING_TELEMETRY_THROTTLE_MS;
        if (generatingChanged) {
          tracker.lastGeneratingTelemetry = { textLength: snapshot.textLength, ts: Date.now() };
          emitLifecycleTelemetry('ANSWER_GENERATING', {
            modelName,
            state: 'GENERATING',
            textLength: snapshot.textLength,
            elapsedMs: Date.now() - tracker.promptSubmittedAt,
            mutationCount: tracker.mutationCount,
            hasStopButton: indicators.hasStopButton,
            hasLoadingIndicator: indicators.hasLoadingIndicator
          });
        }
      } else if (stability.stable) {
        emitLifecycleTelemetry('ANSWER_TEXT_STABLE', {
          modelName,
          state: 'STABLE',
          textLength: snapshot.textLength,
          elapsedMs: Date.now() - tracker.promptSubmittedAt,
          stableMs,
          mutationCount: tracker.mutationCount
        });
      }
      const textLength = snapshot.textLength || 0;
      // Decide completion by *what the text is*, not a blunt length>=20 (review P1.3).
      // The classifier accepts short-but-meaningful answers and rejects UI noise /
      // provider-error surfaces that pass the length bar. Falls back to length>=20 if
      // the classifier module is not present. (No prompt here, so prompt-echo is left
      // to the background/adapter guards.)
      const classifierApi = (typeof window !== 'undefined' && window.AnswerContentClassifier)
        || (typeof globalThis !== 'undefined' && globalThis.AnswerContentClassifier)
        || null;
      const contentEligible = classifierApi
        ? classifierApi.classify(snapshot.text || '', { minValid: 20 }).terminalEligible
        : (textLength >= 20);
      const stableForMs = Date.now() - stability.stableSince;
      const stuckBusyOverride = indicators.hasLoadingIndicator
        && !indicators.hasProgressbar
        && indicators.stopButtonSignal === false
        && completionSignals.mutationQuiet
        && stableForMs >= Math.max(4 * stableMs, STUCK_BUSY_OVERRIDE_MIN_MS);
      if (stuckBusyOverride) completionSignals.stuckBusyOverride = true;
      if (
        tracker.freshAnswerObserved &&
        contentEligible &&
        completionSignals.textStable &&
        indicators.stopButtonSignal === false &&
        (!indicators.hasLoadingIndicator || stuckBusyOverride) &&
        !indicators.hasProgressbar &&
        confidence >= MIN_COMPLETE_CONFIDENCE
      ) {
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        const completedAt = Date.now();
        tracker.state = 'COMPLETE';
        emitLifecycleTelemetry('ANSWER_COMPLETE_DETECTED', {
          modelName,
          state: 'COMPLETE',
          textLength,
          elapsedMs: completedAt - tracker.promptSubmittedAt,
          stableMs,
          mutationCount: tracker.mutationCount,
          hasStopButton: false,
          hasLoadingIndicator: false,
          composerReady,
          sendButtonReady,
          confidence
        });
        if (!isTrackerActive(tracker)) {
          return trackerCancelledResult(tracker);
        }
        try {
          chrome.runtime.sendMessage({
            type: 'LLM_RESPONSE_READY',
            llmName: modelName,
            meta: {
              dispatchId: tracker.dispatchId || null,
              runSessionId: tracker.runSessionId || null,
              sessionId: tracker.runSessionId || null,
              state: 'COMPLETE',
              confidence,
              textLength,
              completionSignals,
              completedAt
            }
          });
        } catch (_) {}
        return {
          ok: true,
          state: 'COMPLETE',
          completedAt,
          latestAnswerEl: snapshot.element,
          answerText: snapshot.text,
          textLength,
          confidence,
          completionSignals,
          diagnostics: {
            mutationCount: tracker.mutationCount
          }
        };
      }
      if (!(await delayForTracker(tracker, pollIntervalMs, 'poll'))) {
        return trackerCancelledResult(tracker);
      }
    }
    const tracker = trackers.get(modelName);
    if (!isTrackerActive(tracker)) {
      return trackerCancelledResult(tracker);
    }
    const latest = await getLatestAnswerSnapshot(modelName, traceId);
    const partial = !!normalizeText(latest.text);
    emitLifecycleTelemetry('ANSWER_COMPLETE_TIMEOUT', {
      modelName,
      state: 'TIMEOUT',
      textLength: latest.textLength,
      elapsedMs: Date.now() - (trackers.get(modelName)?.promptSubmittedAt || Date.now()),
      mutationCount: trackers.get(modelName)?.mutationCount || 0
    });
    if (partial) {
      emitLifecycleTelemetry('ANSWER_PARTIAL_ON_TIMEOUT', {
        modelName,
        state: 'TIMEOUT',
        textLength: latest.textLength,
        elapsedMs: Date.now() - (trackers.get(modelName)?.promptSubmittedAt || Date.now())
      });
    }
    return {
      ok: false,
      state: 'TIMEOUT',
      reason: 'answer_complete_timeout',
      latestAnswerText: latest.text,
      textLength: latest.textLength,
      partial,
      diagnostics: {
        partial,
        completionReason: partial ? 'streaming_incomplete' : 'hard_timeout',
        sanityWarnings: partial ? ['content_growing', 'hard_timeout'] : ['hard_timeout'],
        sanityConfidence: partial ? 0.5 : 0.2
      }
    };
  }

  async function startResponseLifecycleTracking({
    modelName,
    dispatchId = null,
    runSessionId = null,
    promptSubmittedAt = Date.now(),
    traceId = null
  }) {
    const settings = await getSettings();
    if (!settings.enabled || !modelName) return { ok: false, reason: 'lifecycle_disabled_or_missing_model' };
    stopResponseLifecycleTracking({ modelName, reason: 'new_dispatch' });
    const previouslyRegistered = registeredCandidates.get(modelName);
    if (previouslyRegistered?.traceId && traceId && String(previouslyRegistered.traceId) !== String(traceId)) {
      registeredCandidates.delete(modelName);
    }
    const baselineSnapshot = await getLatestAnswerSnapshot(modelName, traceId);
    const tracker = createTracker({ modelName, dispatchId, runSessionId, promptSubmittedAt, traceId, baselineSnapshot });
    trackers.set(modelName, tracker);
    const registered = registeredCandidates.get(modelName);
    if (registered?.element) {
      tracker.latestAnswerEl = registered.element;
      attachTrackerObserver(tracker, registered.element);
    } else {
      attachTrackerObserver(tracker, document.body);
    }
    waitForAnswerStart({
      modelName,
      promptSubmittedAt,
      timeoutMs: settings.answerStartTimeoutMs,
      pollIntervalMs: Math.min(settings.pollIntervalMs, 500),
      traceId
    }).then((startResult) => {
      if (!startResult?.ok) return startResult;
      if (!isTrackerActive(tracker)) {
        return trackerCancelledResult(tracker);
      }
      tracker.state = 'GENERATING';
      return waitForAnswerComplete({
        modelName,
        timeoutMs: settings.answerCompleteTimeoutMs,
        stableMs: settings.stableMs,
        pollIntervalMs: settings.pollIntervalMs,
        traceId
      });
    }).catch((err) => {
      emitLifecycleTelemetry('LIFECYCLE_TRACKING_ERROR', {
        modelName,
        state: 'ERROR',
        confidence: 0
      });
      try {
        chrome.runtime.sendMessage({
          type: 'LLM_DIAGNOSTIC_EVENT',
          llmName: modelName,
          event: {
            type: 'LIFECYCLE',
            label: 'LIFECYCLE_TRACKING_ERROR',
            level: 'warning',
            details: err?.message || String(err),
            meta: { modelName, traceId }
          }
        });
      } catch (_) {}
    });
    return { ok: true, tracker };
  }

  function stopResponseLifecycleTracking({
    modelName = null,
    dispatchId = null,
    runSessionId = null,
    reason = 'cancelled'
  } = {}) {
    let stopped = false;
    const shouldStop = (tracker) => {
      if (!tracker) return false;
      if (modelName && tracker.modelName !== modelName) return false;
      if (dispatchId && tracker.dispatchId !== dispatchId) return false;
      if (runSessionId && tracker.runSessionId !== runSessionId) return false;
      return true;
    };
    Array.from(trackers.entries()).forEach(([key, tracker]) => {
      if (!shouldStop(tracker)) return;
      if (!tracker.cancelledAt) {
        tracker.cancelledAt = Date.now();
      }
      tracker.cancelReason = reason;
      tracker.cancelled = true;
      tracker.state = 'CANCELLED';
      try { tracker.observer?.disconnect?.(); } catch (_) {}
      tracker.observer = null;
      clearTrackerTimers(tracker);
      if (tracker.diagnostics) {
        tracker.diagnostics.stopReason = reason;
      }
      trackers.delete(key);
      stopped = true;
    });
    return {
      ok: true,
      stopped,
      reason: stopped ? reason : 'no_active_tracker'
    };
  }

  async function maybePatchRuntimeMessaging() {
    if (runtimePatched) return;
    if (!chrome?.runtime?.sendMessage) return;
    runtimePatched = true;
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function patchedSendMessage(message, callback) {
      const cb = typeof callback === 'function' ? callback : null;
      if (message?.type === 'PROMPT_SUBMITTED' && message.llmName) {
        const result = originalSendMessage(message, cb);
        Promise.resolve().then(() => startResponseLifecycleTracking({
          modelName: message.llmName,
          dispatchId: message?.meta?.dispatchId || null,
          runSessionId: message?.meta?.runSessionId || message?.meta?.sessionId || null,
          promptSubmittedAt: Date.now(),
          traceId: message?.meta?.traceId || message?.meta?.dispatchId || null
        })).catch(() => {});
        return result;
      }
      if ((message?.type === 'LLM_RESPONSE' || message?.type === 'FINAL_LLM_RESPONSE') && message.llmName && !message.error) {
        const answerText = normalizeText(message.answer || '');
        if (answerText.length >= (window.LLMExtension?.SelectorResolverV2?.MIN_EXTRACTED_ANSWER_LENGTH_FOR_NO_FALLBACK || 80)) {
          return originalSendMessage(message, cb);
        }
        Promise.resolve().then(async () => {
          const resolver = window.LLMExtension?.SelectorResolverV2;
          if (!resolver?.resolveLatestAssistantAnswer) {
            return originalSendMessage(message, cb);
          }
          const result = await resolver.resolveLatestAssistantAnswer({
            modelName: message.llmName,
            reason: 'collect',
            traceId: message?.meta?.traceId || message?.meta?.dispatchId || null
          });
          if (result?.ok && result.element) {
            registerAnswerCandidate({
              modelName: message.llmName,
              element: result.element,
              method: result.method,
              selector: result.selector,
              score: result.score,
              confidence: result.confidence,
              traceId: message?.meta?.traceId || message?.meta?.dispatchId || null,
              observedAt: Date.now()
            });
            const fallbackText = normalizeText(result.element.innerText || result.element.textContent || '');
            if (fallbackText) {
              const nextMessage = Object.assign({}, message, {
                answer: fallbackText
              });
              return originalSendMessage(nextMessage, cb);
            }
          }
          return originalSendMessage(message, cb);
        }).catch(() => {
          originalSendMessage(message, cb);
        });
        return;
      }
      return originalSendMessage(message, cb);
    };
  }

  function installLifecycleStopListeners() {
    try {
      chrome.runtime.onMessage?.addListener?.((message) => {
        const stopTypes = new Set(['STOP_AND_CLEANUP', 'SESSION_EXPIRED', 'SPA_NAVIGATION']);
        if (stopTypes.has(message?.type)) {
          stopResponseLifecycleTracking({ reason: String(message.type).toLowerCase() });
        }
      });
    } catch (_) {}
    try {
      window.addEventListener('LLM_CODEX_SPA_NAVIGATION', () => {
        stopResponseLifecycleTracking({ reason: 'spa_navigation' });
      }, { passive: true });
    } catch (_) {}
    try {
      window.addEventListener('pagehide', () => {
        stopResponseLifecycleTracking({ reason: 'pagehide' });
      }, { passive: true });
    } catch (_) {}
  }

  async function runSelfTest() {
    const failures = [];
    try {
      const stable = isTextStable({ hash: 'a', length: 10 }, 'text', Date.now() - 2000, 1500);
      if (typeof stable.stable !== 'boolean') failures.push('isTextStable_invalid');
    } catch (err) {
      failures.push(`isTextStable_throw:${err?.message || err}`);
    }
    try {
      const indicators = detectGeneratingIndicators({ root: document });
      if (!indicators || typeof indicators !== 'object') failures.push('detectGeneratingIndicators_invalid');
    } catch (err) {
      failures.push(`detectGeneratingIndicators_throw:${err?.message || err}`);
    }
    return {
      ok: failures.length === 0,
      passed: failures.length ? 0 : 2,
      failed: failures.length,
      failures
    };
  }

  const ResponseLifecycleDetector = {
    createTracker,
    startResponseLifecycleTracking,
    stopResponseLifecycleTracking,
    detectGenerationState: detectGeneratingIndicators,
    detectGeneratingIndicators,
    detectCheapComposerReadiness,
    waitForAnswerStart,
    waitForAnswerComplete,
    isTextStable,
    isTrackerActive,
    getLatestAnswerSnapshot,
    registerAnswerCandidate,
    RESPONSE_LIFECYCLE_DEFAULTS,
    LIFECYCLE_READINESS_RESOLVER_TIMEOUT_MS,
    STUCK_BUSY_OVERRIDE_MIN_MS,
    version: VERSION,
    runSelfTest
  };

  window.LLMExtension = window.LLMExtension || {};
  window.LLMExtension.ResponseLifecycleDetector = ResponseLifecycleDetector;
  window.ResponseLifecycleDetector = ResponseLifecycleDetector;
  installLifecycleStopListeners();
  maybePatchRuntimeMessaging().catch(() => {});
})();

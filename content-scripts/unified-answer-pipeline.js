(function initUnifiedAnswerPipeline() {
  if (window.UnifiedAnswerPipeline) return;

  const Modules = window.UnifiedPipelineModules;
  const Config = window.AnswerPipelineConfig;
  const SelectorBundle = window.AnswerPipelineSelectors;
  const namespace = window.AnswerPipeline || {};
  const WatcherClass = namespace.UnifiedAnswerCompletionWatcher;
  const SanityCheckClass = namespace.SanityCheck;

  if (!Modules || !Config || !SelectorBundle || !WatcherClass || !SanityCheckClass) {
    console.error('[UnifiedAnswerPipeline] Missing dependencies:', {
      Modules: !!Modules,
      Config: !!Config,
      SelectorBundle: !!SelectorBundle,
      WatcherClass: !!WatcherClass,
      SanityCheckClass: !!SanityCheckClass
    });
    return;
  }
  console.log('[UnifiedAnswerPipeline] All dependencies loaded successfully');

  const {
    AdaptiveTimeoutManager,
    coordinationModes,
    selectMode,
    IntelligentRetryManager,
    ContinuousHumanActivity,
    MaintenanceScroll,
    ComprehensiveTelemetry,
    PerplexityStabilization,
    HumanSessionController
  } = Modules;
  const { PLATFORM_SELECTORS, detectPlatform } = SelectorBundle;

  const clone = (obj) => JSON.parse(JSON.stringify(obj || {}));

  const deepMerge = (target, source) => {
    if (!source) return target;
    Object.keys(source).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = deepMerge(target[key] || {}, value);
      } else {
        target[key] = value;
      }
    });
    return target;
  };

  const LOCAL_STATE_PREFIX = 'llm_ext_';
  const persistLocalState = (sessionId, payload = {}) => {
    if (!sessionId) return;
    try {
      const key = `${LOCAL_STATE_PREFIX}${sessionId}`;
      const prev = window.localStorage.getItem(key);
      const prevObj = prev ? JSON.parse(prev) : {};
      const merged = Object.assign({}, prevObj, payload, { ts: Date.now() });
      window.localStorage.setItem(key, JSON.stringify(merged));
    } catch (err) {
      console.warn('[Pipeline] persistLocalState failed', err);
    }
  };

  const sendTabState = (payload = {}) => {
    try {
      const platform = payload.platform || (typeof window.__PragmatistAdapter?.adapter?.name === 'string' ? window.__PragmatistAdapter.adapter.name : null);
      const sessionId = payload.sessionId || window.__PragmatistAdapter?.sessionId || null;
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      chrome.runtime?.sendMessage?.({
        type: 'STORE_TAB_STATE',
        state: Object.assign({ ts: Date.now(), platform, sessionId, visibilityState, hasFocus }, payload)
      }, () => chrome.runtime?.lastError);
    } catch (_) {}
  };

  // Purpose: emit pipeline phase telemetry to background diagnostics.
  const LLM_NAME_ALIASES = {
    chatgpt: 'GPT',
    gpt: 'GPT',
    gemini: 'Gemini',
    claude: 'Claude',
    grok: 'Grok',
    lechat: 'Le Chat',
    mistral: 'Le Chat',
    qwen: 'Qwen',
    deepseek: 'DeepSeek',
    perplexity: 'Perplexity',
    'z.ai': 'Z.ai',
    zai: 'Z.ai'
  };

  const resolveLlmName = (value) => {
    if (!value) return null;
    const raw = String(value).trim();
    const normalized = raw.toLowerCase();
    return LLM_NAME_ALIASES[normalized] || raw;
  };

  // v2.54.24 (2025-12-22 23:14 UTC): PIPELINE_EVENT wiring (Purpose: unify pipeline telemetry routing).
  const sendDiagnosticsEvent = (llmName, payload = {}) => {
    if (!llmName) return;
    const safeSend = window.ContentUtils?.safeRuntimeSendMessage;
    const message = { type: 'PIPELINE_EVENT', llmName, event: payload };
    if (safeSend) {
      safeSend(message);
      return;
    }
    if (!chrome?.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage(message, () => chrome.runtime?.lastError);
    } catch (_) {}
  };

  class UnifiedAnswerPipeline {
    constructor(platform, overrides = {}) {
      const normalizedPlatform = typeof platform === 'string' ? platform.toLowerCase() : platform;
      this.platform = normalizedPlatform || detectPlatform?.() || 'generic';
      const baseConfig = clone(Config);
      this.config = deepMerge(baseConfig, overrides);
      if (window.__PRAGMATIST_SPEED_MODE) {
        this.config.streaming = this.config.streaming || {};
        this.config.streaming.continuousActivity = Object.assign({}, this.config.streaming.continuousActivity, { enabled: false });
        this.config.streaming.initialScrollKick = Object.assign({}, this.config.streaming.initialScrollKick, { enabled: false });
      }
      const platformSelectors = PLATFORM_SELECTORS[this.platform];
      this.selectors = platformSelectors || PLATFORM_SELECTORS.generic || {};
      this.platformSelectorsMissing = !platformSelectors || !Object.keys(platformSelectors || {}).length;

      // F6: anchor to the assistant text already on the page before this run produces
      // an answer. On a conversation page (prompt sent into existing history) the
      // last-assistant selector resolves to the *previous* answer until the new one
      // renders; capturing it here lets finalization reject that stale answer for all
      // adapters instead of each adapter reinventing the guard. An explicit
      // `baselineText` override wins; otherwise we read the current last-assistant node.
      this.baselineAnswerSignature = '';
      try {
        if (typeof overrides.baselineText === 'string' && overrides.baselineText.trim()) {
          this.baselineAnswerSignature = this.normalizeAnswerSignature(overrides.baselineText);
        } else {
          const baselineEl = this.getAnswerElement();
          if (baselineEl) this.baselineAnswerSignature = this.normalizeAnswerSignature(this.extractText(baselineEl));
        }
      } catch (_) {
        this.baselineAnswerSignature = '';
      }

      // F6.2: positional turn anchor — how many answer candidates the page
      // already holds at dispatch time. Everything at or before this index is a
      // previous conversation turn; extraction may only prefer nodes appended
      // after it (see getAnswerElement). Exposed on window so the dispatch
      // baseline report can carry it to the background for the inline scans.
      this.anchorAnswerCount = 0;
      try {
        this.anchorAnswerCount = this.collectSortedAnswerCandidates().sorted.length;
      } catch (_) {
        this.anchorAnswerCount = 0;
      }
      try {
        window.__UnifiedPipelineTurnAnchor = {
          platform: this.platform,
          anchorAnswerCount: this.anchorAnswerCount,
          capturedAt: Date.now()
        };
      } catch (_) {}

      this.adaptiveTimeout = new AdaptiveTimeoutManager(this.config.streaming?.adaptiveTimeout);
      this.retryManager = new IntelligentRetryManager(this.config.streaming?.intelligentRetry);
      this.humanActivity = new ContinuousHumanActivity(this.config.streaming?.continuousActivity);
      this.tabProtector = Modules.TabProtector ? new Modules.TabProtector() : null;
      this._initHumanSession();
      this.maintenanceScroll = new MaintenanceScroll(this.config.streaming?.maintenanceScroll, this.humanSession);
      this.sanityCheck = new SanityCheckClass(this.config.finalization?.sanityCheck);
      this.telemetry = new ComprehensiveTelemetry();
      this.perplexityHelper = /perplexity/i.test(this.platform || '') ? new PerplexityStabilization() : null;
      this.answerWatcherClass = WatcherClass;
      this.sessionId = window.__PragmatistAdapter?.sessionId || this.telemetry?.traceId || `session-${Date.now()}`;
      this.llmName = resolveLlmName(this.config?.llmName || this.platform || window.__PragmatistAdapter?.adapter?.name);
      this.fsmState = 'INIT';
      this.state = {
        phase: 'idle',
        startTime: 0,
        phaseTimings: {},
        preparationResult: null,
        scrollResult: null,
        answerResult: null,
        finalizationResult: null,
        container: null,
        maintenanceResult: null,
        initialScrollKick: null
      };
      this._recoverLocalState();

      this.scrollToolkit = window.__UniversalScrollToolkit || null;
      this.lifecycle = window.HumanoidEvents || null;
      this.lifecycleTraceId = null;
      this.hardStopTriggered = false;
    }

    emitPipelineTelemetry(event, { details = '', meta = {}, level = 'info' } = {}) {
      if (!event) return;
      const llmName = this.llmName || resolveLlmName(this.config?.llmName || this.platform || window.__PragmatistAdapter?.adapter?.name);
      if (!llmName) return;
      sendDiagnosticsEvent(llmName, {
        ts: Date.now(),
        type: 'PIPELINE',
        label: event,
        details: details || '',
        level,
        meta: Object.assign({
          event,
          platform: this.platform,
          llmName,
          pipelineSessionId: this.sessionId
        }, meta || {})
      });
    }

    emitPipelineStep(step, { details = '', meta = {}, level = 'info' } = {}) {
      if (!step) return;
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      this.emitPipelineTelemetry('PIPELINE_STEP', {
        details,
        level,
        meta: Object.assign({ step, visibilityState, hasFocus }, meta || {})
      });
    }

    transitionState(nextState, meta = {}) {
      if (!nextState || this.fsmState === nextState) return;
      const prev = this.fsmState;
      this.fsmState = nextState;
      this.emitPipelineTelemetry('STATE_CHANGE', {
        meta: Object.assign({ from: prev, to: nextState }, meta || {})
      });
    }

    _recoverLocalState() {
      try {
        const keys = Object.keys(window.localStorage || {}).filter((k) => k.startsWith(LOCAL_STATE_PREFIX));
        if (!keys.length) return;
        const lastKey = keys.sort().slice(-1)[0];
        const cached = window.localStorage.getItem(lastKey);
        if (cached) {
          this.state.recoveredCache = JSON.parse(cached);
          this.telemetry.logPhase('cache_recovered', { key: lastKey });
        }
      } catch (err) {
        console.warn('[Pipeline] recoverLocalState failed', err);
      }
    }

    _initHumanSession() {
      const self = this;
      const cfg = Object.assign({
        onHardStop() {
          self.streamingTimedOut = true;
          self.hardStopTriggered = true;
        }
      }, this.config.streaming?.humanSession || {});
      this.humanSession = new HumanSessionController({
        continuousActivity: this.humanActivity,
        getHumanoid: () => window.Humanoid || null
      }, cfg);
      try {
        window.humanSessionController = this.humanSession;
      } catch (_) {}
    }

    async execute() {
      console.log(`[UnifiedAnswerPipeline] Execute called for platform: ${this.platform}`);
      
      if (this.platformSelectorsMissing) {
        const error = 'selectors_not_supported';
        console.error(`[UnifiedAnswerPipeline] FATAL: Platform selectors missing for ${this.platform}`);
        this.telemetry.logPhase('selectors_missing', { platform: this.platform, error });
        persistLocalState(this.sessionId, { platform: this.platform, status: 'error', phase: 'preparation', error });
        sendTabState({ status: 'error', phase: 'preparation', error, platform: this.platform, sessionId: this.sessionId });
        return this.handleError('preparation', error);
      }
      
      console.log(`[UnifiedAnswerPipeline] Starting pipeline execution for ${this.platform}`);
      this.transitionState('DISPATCHING', { phase: 'preparation' });
      this.emitPipelineStep('pipeline_start', { meta: { phase: 'preparation' } });

      this.state.phase = 'preparation';
      this.state.startTime = Date.now();
      this.telemetry.logPhase('pipeline_start', { platform: this.platform });
      this._lifecycleHeartbeat('pipeline_start', 0.05);
      persistLocalState(this.sessionId, { platform: this.platform, status: 'pipeline_start' });
      sendTabState({ status: 'pipeline_start', platform: this.platform, sessionId: this.sessionId });

      const lifecycle = this.lifecycle;
      if (lifecycle && !this.lifecycleTraceId) {
        this.lifecycleTraceId = lifecycle.start('pipeline', {
          platform: this.platform,
          mode: this.config.streaming?.coordinationMode
        });
      }

      let lifecycleStatus = 'error';
      let lifecycleHeartbeatInterval = null;
      if (this.lifecycleTraceId && lifecycle) {
        lifecycleHeartbeatInterval = setInterval(() => {
          lifecycle.heartbeat(this.lifecycleTraceId, null, { phase: this.state.phase });
        }, 7000);
      }

      try {
        const preparation = await this.runPreparationPhase();
        if (!preparation.success) {
          this._reportLifecycleError('preparation', preparation.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'preparation', error: preparation.error });
          sendTabState({ status: 'error', phase: 'preparation', error: preparation.error, sessionId: this.sessionId });
          return this.handleError('preparation', preparation.error);
        }
        this._lifecycleHeartbeat('preparation', 0.3);
        persistLocalState(this.sessionId, { status: 'streaming_start', phase: 'preparation_done' });
        sendTabState({ status: 'streaming_start', sessionId: this.sessionId });

        if (this.tabProtector) {
          const audioResult = this.tabProtector.start();
          if (audioResult?.ok) {
            this.emitPipelineTelemetry('AUDIO_CONTEXT_OK', {
              meta: { reason: audioResult?.reason || null }
            });
          } else {
            this.emitPipelineTelemetry('AUDIO_CONTEXT_FAIL', {
              level: 'warning',
              meta: { reason: audioResult?.reason || 'unknown' }
            });
          }
        }
        const streaming = await this.runStreamingPhase(preparation);
        if (!streaming.success) {
          this._reportLifecycleError('streaming', streaming.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'streaming', error: streaming.error });
          sendTabState({ status: 'error', phase: 'streaming', error: streaming.error, sessionId: this.sessionId });
          return this.handleError('streaming', streaming.error);
        }
        this._lifecycleHeartbeat('streaming', 0.7);

        const finalization = await this.runFinalizationPhase(streaming);
        if (!finalization.success) {
          this._reportLifecycleError('finalization', finalization.error);
          persistLocalState(this.sessionId, { status: 'error', phase: 'finalization', error: finalization.error });
          sendTabState({ status: 'error', phase: 'finalization', error: finalization.error, sessionId: this.sessionId });
          return this.handleError('finalization', finalization.error);
        }

        this.state.phase = 'complete';
        const report = this.telemetry.generateReport();
        this._lifecycleHeartbeat('finalization', 1);
        lifecycleStatus = 'success';
        this.transitionState('COLLECTING', { phase: 'finalization' });
        this.emitPipelineTelemetry('PIPELINE_COMPLETE', {
          level: 'success',
          meta: {
            duration: report.totalDuration,
            completionReason: report.completionReason,
            answerLength: finalization.answer?.length || 0
          }
        });
        this.transitionState('DONE', { phase: 'complete' });
        persistLocalState(this.sessionId, {
          status: 'complete',
          duration: report.totalDuration,
          answerLength: finalization.answer?.length || 0,
          completionReason: finalization.sanityCheck?.overallConfidence ? 'success' : report.completionReason
        });
        sendTabState({
          status: 'complete',
          duration: report.totalDuration,
          answerLength: finalization.answer?.length || 0,
          sessionId: this.sessionId,
          platform: this.platform
        });

        return {
          success: true,
          answer: finalization.answer,
          answerHtml: finalization.answerHtml,
          metadata: {
            traceId: report.traceId,
            platform: this.platform,
            duration: report.totalDuration,
            phases: report.phases,
            completionReason: report.completionReason,
            confidence: finalization.sanityCheck?.overallConfidence ?? report.confidence,
            preparation: this.state.preparationResult,
            scroll: this.state.scrollResult,
            answer: this.state.answerResult,
            maintenance: this.state.maintenanceResult,
            finalization: finalization,
            sanityCheck: finalization.sanityCheck,
            answerHtml: finalization.answerHtml
          }
        };
      } catch (error) {
        if (this.lifecycleTraceId && lifecycle) {
          lifecycle.error(this.lifecycleTraceId, error, true);
        }
        persistLocalState(this.sessionId, { status: 'error', phase: 'unexpected', error: error?.message || String(error) });
        sendTabState({ status: 'error', phase: 'unexpected', error: error?.message || String(error), sessionId: this.sessionId });
        return this.handleError('unexpected', error);
      } finally {
        if (this.tabProtector) {
          this.tabProtector.stop();
        }
        if (lifecycleHeartbeatInterval) {
          clearInterval(lifecycleHeartbeatInterval);
        }
        if (this.lifecycleTraceId && lifecycle) {
          lifecycle.stop(this.lifecycleTraceId, {
            status: lifecycleStatus,
            phase: this.state.phase
          });
          this.lifecycleTraceId = null;
        }
        this.humanSession.stopSession('pipeline-exit');
      }
    }

    async runPreparationPhase() {
      const phaseStart = Date.now();
      this.emitPipelineStep('preparation_start', { meta: { phase: 'preparation' } });
      this.telemetry.logPhase('preparation_start');
      const tabActive = await this.activateTab();
      if (!tabActive) {
        return { success: false, error: 'tab_activation_failed' };
      }
      this.telemetry.logPhase('tab_activated');

      const streamOk = await this.waitForStreamStart();
      if (!streamOk) {
        return { success: false, error: 'stream_start_timeout' };
      }

      const containerInfo = this.detectContainer();
      if (!containerInfo) {
        return { success: false, error: 'container_not_found' };
      }

      this.state.container = containerInfo;
      const duration = Date.now() - phaseStart;
      this.state.phaseTimings.preparation = duration;
      this.state.preparationResult = { success: true, duration, containerInfo };
      this.telemetry.logPhase('preparation_done', { duration });
      this.emitPipelineStep('preparation_done', { meta: { duration } });
      return this.state.preparationResult;
    }

    waitForStreamStart() {
      const selectors = this.selectors.streamStart?.length
        ? this.selectors.streamStart
        : this.getDefaultStreamStartSelectors();
      const platformPrep = this.config.platforms?.[this.platform]?.preparation || {};
      const timeout = platformPrep.streamStartTimeout || this.config.preparation?.streamStartTimeout || 45000;
      return new Promise((resolve) => {
        const hasFreshStart = () => {
          const candidates = this.collectSortedAnswerCandidates().sorted;
          if (candidates.length > Number(this.anchorAnswerCount || 0)) return true;
          const latest = candidates[candidates.length - 1] || null;
          const latestSignature = latest ? this.normalizeAnswerSignature(this.extractText(latest)) : '';
          if (latestSignature && latestSignature !== this.baselineAnswerSignature) return true;
          const asSelectorList = (value) => Array.isArray(value) ? value : (value ? [value] : []);
          const generationSelectors = [
            ...asSelectorList(this.selectors.generatingIndicators),
            ...asSelectorList(this.selectors.streaming),
            ...(Array.isArray(this.selectors.stopButton) ? this.selectors.stopButton : (this.selectors.stopButton ? [this.selectors.stopButton] : []))
          ];
          return generationSelectors.some((selector) => {
            const nodes = this.querySelectorAllSafe(selector);
            return nodes.some((node) => {
              try {
                const rect = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
              } catch (_) { return false; }
            });
          });
        };
        if (hasFreshStart()) {
          resolve(true);
          return;
        }

        const timer = setTimeout(() => {
          stopObserve();
          resolve(false);
        }, timeout);

        const stopObserve = window.ContentUtils?.observeMutations
          ? window.ContentUtils.observeMutations(document.body, { childList: true, subtree: true }, () => {
            if (hasFreshStart()) {
              clearTimeout(timer);
              stopObserve();
              resolve(true);
            }
          })
          : (() => () => {})();
      });
    }

    async activateTab() {
      if (this.config?.preparation?.allowTabActivation === false) return true;
      if (!document.hidden) return true;
      const timeoutMs = this.config.preparation?.tabActivationTimeout || 5000;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          document.removeEventListener('visibilitychange', handler);
          resolve(false);
        }, timeoutMs);

        const handler = () => {
          if (!document.hidden) {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', handler);
            resolve(true);
          }
        };

        document.addEventListener('visibilitychange', handler);

        try {
          chrome?.tabs?.getCurrent?.((tab) => {
            if (tab?.id) chrome.tabs.update(tab.id, { active: true });
          });
        } catch (_) {
          // ignore
        }
      });
    }

    detectContainer() {
      try {
        if (this.scrollToolkit) {
          const toolkit = new this.scrollToolkit();
          const candidates = toolkit.containerDetector?.findScrollable() || [];
          return candidates[0] || { element: window, type: 'window' };
        }
      } catch (err) {
        console.warn('[Pipeline] ScrollToolkit container detection failed', err);
      }
      const container = this.querySelectorSafe(this.selectors.answerContainer) || document.documentElement;
      return { element: container, type: container === window ? 'window' : 'container' };
    }

    async runStreamingPhase(prepResult) {
      const phaseStart = Date.now();
      this.state.phase = 'streaming';
      this.transitionState('GENERATING', { phase: 'streaming' });
      const expectedLength = this.config.streaming?.expectedLength || this.config.expectedLength || 'medium';
      const modeName = this.config.streaming?.coordinationMode || 'balanced';
      const configuredMode = coordinationModes[modeName] || selectMode({ expectedLength });
      this.telemetry.logPhase('streaming_start', { mode: modeName });
      this.emitPipelineStep('streaming_start', {
        meta: { mode: modeName }
      });

      this.humanSession.startSession();
      this.streamingTimedOut = false;
      //-- 1.1. Адаптивный timeout: учитываем скорость модели --//
const baseTimeouts = this.adaptiveTimeout.calculateTimeout(this.config.seedContent || '');
const modelSpeedMultiplier = (() => {
  const platformLower = this.platform.toLowerCase();
  const fastModels = ['chatgpt', 'gpt', 'perplexity'];
  if (fastModels.some(m => platformLower.includes(m))) {
    return 0.5; // Быстрые модели: 50% от базового timeout
  }
  if (platformLower.includes('claude')) {
    return 1.6; // Более медленная генерация: даем больше времени
  }
  return 1;
})();
const timeouts = {
  soft: baseTimeouts.soft * modelSpeedMultiplier,
  hard: baseTimeouts.hard * modelSpeedMultiplier
};
console.log(`[Pipeline] Timeouts for ${this.platform}: soft=${timeouts.soft}ms, hard=${timeouts.hard}ms`);
const watchdog = setTimeout(() => {
  this.streamingTimedOut = true;
}, timeouts.hard);

      this.humanActivity.startDuringWait();
      let guardInterval = null;
      const clearGuardInterval = () => {
        if (guardInterval) {
          clearInterval(guardInterval);
          guardInterval = null;
        }
      };

      try {
        await this.runInitialScrollKick(prepResult);
        const scrollPromise = this.runScrollSettlement(prepResult);
        const answerPromise = this.runAnswerCompletion(prepResult.containerInfo);

        //-- 2.1. Fallback: завершение по отсутствию изменений текста --//
const textStabilityMonitor = setInterval(() => {
  if (this.streamingTimedOut || this.hardStopTriggered) {
    clearInterval(textStabilityMonitor);
    return;
  }
  
  const currentAnswer = this.getAnswerElement();
  if (!currentAnswer) return;
  
  const currentText = this.extractText(currentAnswer);
  const currentLength = currentText.length;
  
  if (!this._lastAnswerLength) {
    this._lastAnswerLength = currentLength;
    this._lastAnswerChangeAt = Date.now();
    return;
  }
  
  // Text stability is weak evidence only; final completion is decided by the watcher/finalization phases.
  if (currentLength === this._lastAnswerLength) {
    const stableMs = Date.now() - this._lastAnswerChangeAt;
    if (stableMs >= 2000 && currentLength > 100) {
      console.log(`[Pipeline] Text stable evidence for ${stableMs}ms, length=${currentLength}`);
      clearInterval(textStabilityMonitor);
      window.dispatchEvent(new CustomEvent('LLM_ANSWER_STABLE', { 
        detail: { platform: this.platform, length: currentLength, stableMs, evidenceOnly: true } 
      }));
    }
  } else {
    this._lastAnswerLength = currentLength;
    this._lastAnswerChangeAt = Date.now();
  }
}, 500);

// Очистка при завершении streaming
this.humanSession.on?.('session-stop', () => clearInterval(textStabilityMonitor));

        let scrollResult;
        let answerResult;

          if (configuredMode.waitFor === 'both') {
            [scrollResult, answerResult] = await Promise.all([scrollPromise, answerPromise]);
          } else {
            const first = await Promise.race([
              scrollPromise.then((res) => {
                clearGuardInterval();
                return { type: 'scroll', res };
              }),
              answerPromise.then((res) => {
                clearGuardInterval();
                return { type: 'answer', res };
              }),
              new Promise((_, reject) => {
                guardInterval = setInterval(() => {
                  if (this.hardStopTriggered) {
                    clearGuardInterval();
                    reject(new Error('hard_stop'));
                  }
                }, 300);
              })
            ]);
          if (first?.type === 'scroll') {
            scrollResult = first.res;
            answerResult = await answerPromise;
          } else if (first?.type === 'answer') {
            answerResult = first.res;
            scrollResult = await scrollPromise;
          }
        }

        clearTimeout(watchdog);
        clearGuardInterval();
        this.humanActivity.stop();

        if (this.streamingTimedOut) {
          return { success: false, error: 'hard_timeout' };
        }

        this.state.scrollResult = scrollResult;
        this.state.answerResult = answerResult;

        if (!scrollResult?.success && !answerResult?.success) {
          return { success: false, error: 'streaming_incomplete' };
        }

        const duration = Date.now() - phaseStart;
        this.state.phaseTimings.streaming = duration;
        this.telemetry.logPhase('streaming_done', { duration });
        this.emitPipelineStep('streaming_done', { meta: { duration } });
        return { success: true, duration };
      } catch (error) {
        clearTimeout(watchdog);
        clearGuardInterval();
        this.humanActivity.stop();
        this.humanSession.stopSession('streaming-error');
        return { success: false, error: error.message || 'streaming_failed' };
      }
    }

    async runInitialScrollKick(prepResult) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_kick_skip', { reason: 'hard_stop' });
        return { ran: false, reason: 'hard_stop' };
      }
      if (!this.config.streaming?.initialScrollKick?.enabled) {
        return { ran: false, reason: 'disabled' };
      }
      if (!prepResult || !prepResult.containerInfo) {
        return { ran: false, reason: 'no_container' };
      }
      const delay = Number(this.config.streaming.initialScrollKick.delay) || 0;
      if (delay > 0) {
        await this.sleep(delay);
      }
      const target = prepResult.containerInfo.element || window;
      try {
        if (this.scrollToolkit) {
          const tk = new this.scrollToolkit({ logLevel: 'error' });
          await tk.scrollToBottom({ targetNode: target });
          this.state.initialScrollKick = { ran: true, tool: 'scrollToolkit' };
          this.telemetry.logPhase('scroll_kick', { tool: 'scrollToolkit' });
          return this.state.initialScrollKick;
        }
        const humanoid = window.Humanoid;
        if (humanoid?.humanScroll) {
          const el = target === window ? document.documentElement : target;
          const start = target === window ? window.scrollY : (target.scrollTop || 0);
          const height = el?.scrollHeight || document.documentElement.scrollHeight || 0;
          const view = el?.clientHeight || window.innerHeight || 0;
          const distance = Math.max(0, height - view - start);
          await humanoid.humanScroll(distance || 800, { targetNode: target, style: 'reading' });
          this.state.initialScrollKick = { ran: true, tool: 'humanoid' };
          this.telemetry.logPhase('scroll_kick', { tool: 'humanoid', distance });
          return this.state.initialScrollKick;
        }
        const el = target === window ? document.documentElement : target;
        if (el?.scrollTo) {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          this.state.initialScrollKick = { ran: true, tool: 'native' };
          this.telemetry.logPhase('scroll_kick', { tool: 'native' });
          return this.state.initialScrollKick;
        }
      } catch (err) {
        this.telemetry.logPhase('scroll_kick_error', { message: err.message });
        this.state.initialScrollKick = { ran: false, reason: err.message };
        return this.state.initialScrollKick;
      }
      this.state.initialScrollKick = { ran: false, reason: 'no_tool' };
      return this.state.initialScrollKick;
    }

    async runScrollSettlement(prepResult) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_settlement_skip', { reason: 'hard_stop' });
        return { success: false, reason: 'hard_stop' };
      }
      const { containerInfo } = prepResult;
      const target = containerInfo?.element ? containerInfo : { element: window, type: 'window' };
      const useRetry = this.config.streaming?.intelligentRetry?.enabled && this.scrollToolkit;

      if (!useRetry) {
        return this.performScrollAttempt(target);
      }

      let lastScrollHeight = this.getScrollHeight(target);
      for (let attempt = 1; attempt <= (this.retryManager.maxRetries || 5); attempt += 1) {
        const context = {
          lastScrollHeight,
          currentScrollHeight: this.getScrollHeight(target)
        };
        lastScrollHeight = context.currentScrollHeight;
        const attemptResult = await this.retryManager.retryWithBackoff(
          attempt,
          () => this.performScrollAttempt(target),
          context
        );

        this.telemetry.logPhase('streaming_scroll_attempt', {
          attempt,
          success: attemptResult?.success,
          growth: context.currentScrollHeight - context.lastScrollHeight
        });

        if (attemptResult?.success) {
          return Object.assign({ success: true, attempts: attempt }, attemptResult);
        }
      }
      return { success: false, reason: 'scroll_settlement_failed' };
    }

    async performScrollAttempt(target) {
      if (this.humanSession?.isHardStopped?.() || window.__LLMScrollHardStop) {
        this.telemetry.logPhase('scroll_attempt_skip', { reason: 'hard_stop' });
        return { success: false, reason: 'hard_stop' };
      }
      if (this.scrollToolkit) {
        const toolkit = new this.scrollToolkit({ logLevel: 'error' });
        const settled = await toolkit.scrollToBottom({ targetNode: target.element });
        return { success: settled, settled };
      }
      const el = target.element === window ? document.documentElement : target.element;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      return { success: true, reason: 'fallback' };
    }

    getScrollHeight(target) {
      const el = target?.element === window ? document.documentElement : target?.element;
      return el?.scrollHeight || document.documentElement.scrollHeight || 0;
    }

    async runAnswerCompletion(containerInfo) {
      if (!this.answerWatcherClass) {
        return { success: false, reason: 'watcher_missing' };
      }
      const watcher = new this.answerWatcherClass(this.platform, {
        completionCriteria: this.config.streaming?.completionCriteria,
        adaptiveTimeout: this.config.streaming?.adaptiveTimeout,
        humanSession: this.humanSession,
        llmName: this.llmName,
        verboseCriteria: this.config.streaming?.verboseCriteria === true ? true : undefined,
        baselineAnswerSignature: this.baselineAnswerSignature,
        anchorAnswerCount: this.anchorAnswerCount
      });
      const result = await watcher.waitForCompletion({ container: containerInfo });
      // v2.54.24 (2025-12-22 23:14 UTC): Stop-disappeared signal (Purpose: detect completion when stop hides).
      if (result?.reason === 'stop_disappeared') {
        this.emitPipelineTelemetry('STOP_DISAPPEARED', {
          meta: { duration: result.duration, criteriaMet: result.criteriaMet, confidence: result.confidence }
        });
      }
      return result;
    }

    async runFinalizationPhase() {
      const phaseStart = Date.now();
      this.state.phase = 'finalization';
      this.transitionState('FINALIZING', { phase: 'finalization' });
      this.telemetry.logPhase('finalization_start');
      this.emitPipelineStep('finalization_start', { meta: { phase: 'finalization' } });

      const maintenanceResult = await this.runMaintenanceScroll(this.state.container);
      this.state.maintenanceResult = maintenanceResult;

      const stable = await this.runFinalStabilityChecks();
      if (!stable) {
        this.telemetry.logPhase('finalization_unstable_answer', { platform: this.platform });
        return { success: false, error: 'answer_not_stable' };
      }
      let answer;
      let answerHtml = '';
      try {
        const extracted = await this.extractAnswerWithHtml();
        answer = extracted.text;
        answerHtml = extracted.html;
      } catch (err) {
        const message = err?.message || String(err) || 'answer_extract_failed';
        this.telemetry.logPhase('finalization_extract_failed', { message });
        return { success: false, error: message };
      }

      if (!String(answer || '').trim()) {
        this.telemetry.logPhase('finalization_empty_answer', { platform: this.platform });
        return { success: false, error: 'empty_answer' };
      }
      const providerErrorSurface = window.ContentUtils?.detectProviderErrorSurface?.();
      if (providerErrorSurface?.detected) {
        this.telemetry.logPhase('finalization_provider_error_surface', {
          platform: this.platform,
          selector: providerErrorSurface.selector || null,
          length: String(providerErrorSurface.text || '').length
        });
        return { success: false, error: 'provider_error_surface' };
      }
      if (this.isStaleBaselineAnswer(answer)) {
        // Only the pre-run (previous) answer is on the page; fail so the adapter
        // keeps waiting / falls back instead of returning the stale answer.
        this.telemetry.logPhase('finalization_stale_baseline', { platform: this.platform, length: answer.length });
        return { success: false, error: 'stale_baseline_answer' };
      }
      // Reject finals that are not actually answers (provider-error / UI-noise surfaces
      // that pass the length bar). No prompt here, so prompt-echo is left to the
      // adapter/background guards. Conservative: only fail on clearly non-eligible
      // classes, and only when the classifier module is present.
      const classifier = (typeof window !== 'undefined' && window.AnswerContentClassifier)
        || (typeof globalThis !== 'undefined' && globalThis.AnswerContentClassifier)
        || null;
      if (classifier) {
        const classification = classifier.classify(answer, { minValid: 20 });
        if (!classification.terminalEligible) {
          this.telemetry.logPhase('finalization_non_answer_content', {
            platform: this.platform,
            contentClass: classification.contentClass,
            length: answer.length
          });
          return { success: false, error: `non_answer_content:${classification.contentClass}` };
        }
      }
      const sanityCheck = await this.sanityCheck.execute({
        answer,
        scrollResult: this.state.scrollResult,
        answerResult: this.state.answerResult,
        platform: this.platform,
        llmName: this.config.llmName || this.platform
      });

      const duration = Date.now() - phaseStart;
      this.state.phaseTimings.finalization = duration;
      const selectorTier = this.lastAnswerSelectorTier || 'unknown';
      this.state.finalizationResult = {
        success: true, duration, answer, answerHtml, sanityCheck, stable,
        selectorTier, selectorUsed: this.lastAnswerSelector || null
      };
      this.telemetry.logPhase('finalization_done', { duration, sanityCheck, selectorTier });
      this.emitPipelineStep('finalization_done', {
        meta: { duration, answerLength: answer?.length || 0, sanityConfidence: sanityCheck?.overallConfidence ?? null, selectorTier }
      });
      // Observability for selector drift (review P1.1 + health->extraction follow-up):
      // a final answer coming from a generic/last-resort selector means the specific
      // platform selectors missed — a leading signal of selector breakage.
      if (selectorTier === 'last_resort_generic' || selectorTier === 'generic_markdown') {
        this.telemetry.logPhase('finalization_low_tier_selector', { selectorTier, selectorUsed: this.lastAnswerSelector || null });
      }

      return this.state.finalizationResult;
    }

    async runMaintenanceScroll(containerInfo) {
      if (!containerInfo || !this.config.streaming?.maintenanceScroll?.enabled) {
        return { ran: false, reason: 'disabled' };
      }
      try {
        return await this.maintenanceScroll.run(containerInfo);
      } catch (error) {
        return { ran: false, reason: error.message };
      }
    }

    async runFinalStabilityChecks() {
      const checks = this.config.finalization?.stabilityChecks || 3;
      const interval = this.config.finalization?.stabilityInterval || 800;
      let lastHash = '';
      let stableCount = 0;
      for (let i = 0; i < checks; i += 1) {
        const element = this.getAnswerElement();
        if (!element) return false;
        const hash = this.hashString(element.textContent || '');
        if (hash === lastHash) {
          stableCount += 1;
          if (stableCount >= checks - 1) return true;
        } else {
          stableCount = 0;
        }
        lastHash = hash;
        // eslint-disable-next-line no-await-in-loop
        await this.sleep(interval);
      }
      return false;
    }

    // Collect all answer candidates in document order. Shared by getAnswerElement
    // and the turn-anchor capture so both see the same candidate space.
    collectSortedAnswerCandidates() {
      const circuit = (typeof window !== 'undefined' && window.SelectorCircuit) || null;
      const allSelectors = [];
      if (this.selectors.lastMessage) {
        if (Array.isArray(this.selectors.lastMessage)) allSelectors.push(...this.selectors.lastMessage);
        else allSelectors.push(this.selectors.lastMessage);
      }
      if (this.config.answerSelectors) allSelectors.push(...this.config.answerSelectors);
      // P1.1: respect the selector circuit — skip selectors a prior run disabled after
      // repeated misses (selector-health -> extraction). Safe no-op when the circuit is
      // empty. Keep the original index for tier classification.
      const selectors = allSelectors
        .map((selector, index) => ({ selector, index }))
        .filter(({ selector }) => !circuit || circuit.shouldUse(selector, this.platform, 'answer') !== false);
      const candidates = [];
      const seen = new Set();
      const matchedIndices = new Set();

      // Track which selector first matched each candidate so we can tag the chosen
      // answer's selector tier (review P1.1). Earlier selectors in the ordered list are
      // more specific (primary) -> later ones are generic/last-resort.
      const selectorByElement = new Map();
      const pushUnique = (el, selector, index) => {
        if (!el || el.nodeType !== 1) return;
        if (seen.has(el)) return;
        seen.add(el);
        if (!selectorByElement.has(el)) selectorByElement.set(el, { selector, index });
        candidates.push(el);
      };

      const totalSelectors = allSelectors.length;
      for (const { selector, index } of selectors) {
        const nodes = this.querySelectorAllSafe(selector);
        if (nodes && nodes.length) {
          matchedIndices.add(index);
          nodes.forEach((el) => pushUnique(el, selector, index));
          continue;
        }
        const single = this.querySelectorSafe(selector);
        if (single) matchedIndices.add(index);
        pushUnique(single, selector, index);
      }
      const sorted = candidates.slice().sort((a, b) => {
        if (a === b) return 0;
        try {
          const pos = a.compareDocumentPosition(b);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        } catch (_) {}
        return 0;
      });
      return { sorted, selectorByElement, matchedIndices, selectors, totalSelectors };
    }

    getAnswerElement(opts = {}) {
      const reportHealth = opts.reportHealth === true;
      const circuit = (typeof window !== 'undefined' && window.SelectorCircuit) || null;
      const { sorted, selectorByElement, matchedIndices, selectors, totalSelectors } = this.collectSortedAnswerCandidates();
      const candidates = sorted;

      // At finalize (answer is present), feed the circuit: success for the selector that
      // produced the accepted answer; failure for any higher-priority selector that
      // matched nothing while a lower-priority one won — that is selector drift, and
      // after `threshold` consecutive misses the circuit disables it (auto-demotion).
      const reportToCircuit = (winnerIndex) => {
        if (!reportHealth || !circuit || winnerIndex == null) return;
        for (const { selector, index } of selectors) {
          if (index === winnerIndex) circuit.report(selector, this.platform, 'answer', true);
          else if (index < winnerIndex && !matchedIndices.has(index)) circuit.report(selector, this.platform, 'answer', false);
        }
      };

      const recordTier = (el) => {
        const info = selectorByElement.get(el) || null;
        this.lastAnswerSelector = info?.selector || null;
        this.lastAnswerSelectorTier = this.classifySelectorTier(info?.selector, info?.index, totalSelectors);
        reportToCircuit(info?.index);
      };

      if (!candidates.length) {
        this.lastAnswerSelector = null;
        this.lastAnswerSelectorTier = null;
        return null;
      }
      const normalizeText = (node) => String(node?.innerText || node?.textContent || '').trim();

      // F6.2: positional turn anchor. anchorAnswerCount is the number of answer
      // candidates that already existed on the page when this dispatch started;
      // those nodes are previous conversation turns by definition. When new
      // nodes appeared, restrict the pick to them — this rejects not only the
      // immediately-previous answer (the signature baseline covers that) but
      // ANY older turn (run 1782945983672: a 13037-char answer several turns up
      // was re-picked as the current run's answer). When no new node exists yet
      // (provider streams into the pre-existing node, or the answer has not
      // rendered), keep the legacy last-node behaviour — the signature baseline
      // still guards that path.
      const anchorCount = Number(this.anchorAnswerCount || 0);
      let pool = sorted;
      this.lastAnswerPositionalFiltered = false;
      if (anchorCount > 0 && sorted.length > anchorCount) {
        pool = sorted.slice(anchorCount);
        this.lastAnswerPositionalFiltered = true;
      }

      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const el = pool[i];
        const text = normalizeText(el);
        if (text && text.length >= 5) { recordTier(el); return el; }
      }
      const fallbackEl = pool[pool.length - 1] || null;
      if (fallbackEl) recordTier(fallbackEl);
      return fallbackEl;
    }

    // Classify the selector that produced the answer into a trust tier (review P1.1).
    // index 0 = the most specific platform selector; the generic DOM selectors
    // (.prose / article / [class*="markdown"] / main) are last-resort.
    classifySelectorTier(selector, index, total) {
      if (!selector) return 'unknown';
      const s = String(selector).toLowerCase();
      if (/\.prose|^article$|\barticle\b|\[class\*="markdown"\]|(^|\s)main(\s|$)|generic/.test(s)) {
        return 'last_resort_generic';
      }
      if (index === 0) return 'primary_assistant';
      if (typeof total === 'number' && total > 0 && index >= total - 2) return 'generic_markdown';
      return 'secondary_platform_specific';
    }

    async extractAnswer() {
      const element = this.getAnswerElement();
      if (!element) throw new Error('answer_element_missing');
      if (this.perplexityHelper) {
        const stable = await this.perplexityHelper.waitForStabilization(element);
        return stable.text.trim();
      }
      return this.extractText(element);
    }

    async extractAnswerWithHtml() {
      // reportHealth: this is the finalize extraction (answer present), so it is safe to
      // feed the selector circuit with success/drift signals here.
      const element = this.getAnswerElement({ reportHealth: true });
      if (!element) throw new Error('answer_element_missing');
      let text = '';
      if (this.perplexityHelper) {
        const stable = await this.perplexityHelper.waitForStabilization(element);
        text = stable.text.trim();
      } else {
        text = this.extractText(element);
      }
      const html = this.extractHtml(element);
      return { text, html };
    }

    extractHtml(element) {
      if (!element) return '';
      try {
        const builder = window.ContentUtils?.buildInlineHtml;
        if (typeof builder === 'function') {
          return String(builder(element, { includeRoot: true }) || '').trim();
        }
        const clone = element.cloneNode(true);
        return String(clone.outerHTML || '').trim();
      } catch (_) {
        return '';
      }
    }

    // Normalized form used only for the stale-baseline comparison (F6): collapse
    // whitespace and lowercase so cosmetic differences don't defeat the guard.
    normalizeAnswerSignature(text) {
      return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // True when the extracted answer is the pre-run baseline (the previous answer
    // on a conversation page) rather than a freshly generated one.
    isStaleBaselineAnswer(answer) {
      if (!this.baselineAnswerSignature) return false;
      const candidate = this.normalizeAnswerSignature(answer);
      if (!candidate) return false;
      return candidate === this.baselineAnswerSignature;
    }

    extractText(element) {
      if (!element) return '';
      const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
      try {
        const cloneEl = element.cloneNode(true);
        cloneEl.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]').forEach((el) => el.remove());
        cloneEl.querySelectorAll('button, [role="button"], .toolbar, .actions, script, style, svg, canvas, noscript').forEach((el) => el.remove());
        const shallow = normalize(cloneEl.textContent || '');
        if (shallow) return shallow;
      } catch (_) {
        // ignore and fall back to deep extraction
      }

      const direct = normalize(element?.innerText || element?.textContent || '');
      if (direct) return direct;

      const shouldSkip = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (!tag) return false;
        if ([
          'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS',
          'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
          'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'FORM'
        ].includes(tag)) return true;
        const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
        if (cls && (cls.includes('toolbar') || cls.includes('actions') || cls.includes('controls'))) return true;
        return false;
      };

      const collectFromRoot = (root, maxChars = 200000) => {
        if (!root) return '';
        let out = '';
        try {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
              const value = node?.nodeValue;
              if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              if (shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
              const style = window.getComputedStyle?.(parent);
              if (style && (style.display === 'none' || style.visibility === 'hidden')) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            }
          });

          while (walker.nextNode()) {
            out += `${walker.currentNode.nodeValue} `;
            if (out.length >= maxChars) break;
          }
        } catch (_) {}
        return normalize(out);
      };

      let combined = '';
      const append = (chunk) => {
        const next = normalize(chunk);
        if (!next) return;
        combined = normalize(`${combined} ${next}`);
      };

      try {
        if (element?.shadowRoot) {
          append(collectFromRoot(element.shadowRoot));
        }
      } catch (_) {}
      if (combined) return combined;

      try {
        const nodes = Array.from(element.querySelectorAll?.('*') || []);
        let inspected = 0;
        for (const node of nodes) {
          if (inspected >= 60) break;
          if (!node || !node.shadowRoot) continue;
          inspected += 1;
          append(collectFromRoot(node.shadowRoot, 80000));
          if (combined.length > 800) break;
        }
      } catch (_) {}

      if (combined) return combined;
      return collectFromRoot(element);
    }

    hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return hash.toString(36);
    }

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    getDefaultStreamStartSelectors() {
      return [
        '[data-testid=\"conversation-turn\"]',
        '.chat-message',
        'article',
        '[data-scroll-anchor]'
      ];
    }

    querySelectorSafe(selector) {
      if (!selector) return null;
      try {
        return document.querySelector(selector);
      } catch (err) {
        console.warn('[Pipeline] Invalid selector', selector, err);
        return null;
      }
    }

    querySelectorAllSafe(selector) {
      if (!selector) return [];
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch (err) {
        console.warn('[Pipeline] Invalid selector (all)', selector, err);
        return [];
      }
    }

    _lifecycleHeartbeat(phase, progress) {
      if (this.lifecycle && this.lifecycleTraceId) {
        this.lifecycle.heartbeat(this.lifecycleTraceId, progress, { phase });
      }
    }

    _reportLifecycleError(phase, message) {
      if (this.lifecycle && this.lifecycleTraceId) {
        const err = new Error(message || phase);
        this.lifecycle.error(this.lifecycleTraceId, err, false);
      }
    }

    handleError(phase, error) {
      this.state.phase = 'error';
      this.transitionState('ERROR', { phase });
      const payload = {
        success: false,
        error: {
          phase,
          message: typeof error === 'string' ? error : error.message
        }
      };
      this.telemetry.logPhase('pipeline_error', payload.error);
      const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
      const hasFocus = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : null;
      this.emitPipelineTelemetry('PIPELINE_ERROR', {
        level: 'error',
        meta: { phase, message: payload.error.message, visibilityState, hasFocus }
      });
      return payload;
    }
  }

  window.UnifiedAnswerPipeline = UnifiedAnswerPipeline;
})();

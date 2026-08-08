(function () {
  const CHANNEL = 'humanoid-fetch-monitor';

  // The bridge runs in the main world, where the isolated-world `window` of a
  // content script is not visible. The init payload therefore travels on the
  // injected element itself; the old `window.__HFM_INIT__` assignment never
  // reached the bridge, which is why the hook was installed but silent.
  function buildInitPayload(modelName, platform) {
    const semantics = window.ProviderStreamSemantics || null;
    const profile = semantics?.getProfile?.(platform || modelName) || null;
    const serializePatterns = (list = []) => list.map((entry) => ({
      kind: entry.kind || 'stream_done_token',
      source: entry.pattern.source,
      flags: entry.pattern.flags,
      terminalReason: entry.terminalReason || 'STOP'
    }));
    return {
      channel: CHANNEL,
      model: modelName,
      platform: platform || null,
      generationPatterns: (profile?.generation || []).map((pattern) => ({
        kind: 'generation_endpoint',
        source: pattern.source,
        flags: pattern.flags
      })),
      terminalPatterns: semantics ? serializePatterns(semantics.GENERIC_TERMINAL_PATTERNS) : [],
      finishReasonPattern: semantics
        ? { source: /"(?:finish_reason|finishReason|stop_reason|stopReason)"\s*:\s*"([a-z_\-]+)"/i.source, flags: 'i' }
        : null,
      finishReasonMap: semantics?.FINISH_REASON_MAP || {},
      streamContentTypes: semantics?.STREAM_CONTENT_TYPES || [],
      // Recorded so a run can tell "no generation endpoint is known for this
      // platform" apart from "the endpoint was known and stayed quiet".
      hasGenerationContract: !!(profile?.generation || []).length
    };
  }

  function injectMainWorldHook(modelName, platform) {
    if (!document.documentElement) return null;
    const payload = buildInitPayload(modelName, platform);
    try {
      const script = document.createElement('script');
      script.dataset.hfmInit = JSON.stringify(payload);
      script.src = chrome.runtime.getURL('content-scripts/fetch-monitor-bridge.js');
      script.async = false;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.addEventListener('load', () => script.remove(), { once: true });
      return payload;
    } catch (err) {
      console.warn('[fetch-monitor] Failed to inject bridge', err);
      return null;
    }
  }

  const streamListeners = new Set();

  window.setupHumanoidFetchMonitor = function setupHumanoidFetchMonitor(modelName, handler, options = {}) {
    if (!modelName) return;
    const guardKey = `__humanoidFetchBridge_${modelName}`;
    const alreadyInstalled = !!window[guardKey];
    if (!alreadyInstalled) {
      window[guardKey] = true;
      const payload = injectMainWorldHook(modelName, options.platform || null);
      window.__humanoidFetchMonitorInit = payload;
      window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.source !== CHANNEL) return;
        const data = event.data;
        if (Array.isArray(data.models) && !data.models.includes(modelName)) return;
        if (data.kind === 'stream') {
          streamListeners.forEach((listener) => {
            try { listener(data); } catch (_) {}
          });
          return;
        }
        (window.__humanoidFetchMonitorHandlers || []).forEach((entry) => {
          if (entry.modelName !== modelName) return;
          try { entry.handler(data); } catch (_) {}
        });
      });
    }
    if (typeof handler === 'function') {
      const handlers = window.__humanoidFetchMonitorHandlers = window.__humanoidFetchMonitorHandlers || [];
      // One failure handler per model, as before: two adapters registering the
      // same rate-limit callback must not report the limit twice.
      if (!handlers.some((entry) => entry.modelName === modelName)) {
        handlers.push({ modelName, handler });
      }
    }
  };

  // Transport observation subscription, separate from the failure handler so
  // that adapters keep their existing rate-limit callback unchanged.
  window.onHumanoidStreamEvent = function onHumanoidStreamEvent(listener) {
    if (typeof listener !== 'function') return () => {};
    streamListeners.add(listener);
    return () => streamListeners.delete(listener);
  };

  window.humanoidFetchMonitorState = function humanoidFetchMonitorState() {
    const payload = window.__humanoidFetchMonitorInit || null;
    return {
      injected: !!payload,
      hasGenerationContract: !!payload?.hasGenerationContract,
      platform: payload?.platform || null
    };
  };
})();

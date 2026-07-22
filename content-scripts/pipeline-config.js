(function initAnswerPipelineConfig() {
  if (window.AnswerPipelineConfig) return;

  // ---- Short profile (default): the existing generation-wait timings. ----
  const CONFIG = {
    preparation: {
      tabActivationTimeout: 3000,
      allowTabActivation: false,
      streamStartTimeout: 30000,
      streamStartPollInterval: 100
    },
    streaming: {
      coordinationMode: 'balanced',
      platformOverrides: {
        chatgpt: {
          maintenanceScroll: { enabled: false },
          continuousActivity: { enabled: false },
          initialScrollKick: { enabled: true, delay: 1000 }
        }
      },
      adaptiveTimeout: {
        short: { maxChars: 500, timeout: 20000 },
        medium: { maxChars: 2000, timeout: 45000 },
        long: { maxChars: 5000, timeout: 90000 },
        veryLong: { maxChars: Infinity, timeout: 180000 },
        softExtension: 30000,
        hardMax: 180000
      },
      intelligentRetry: {
        enabled: true,
        maxRetries: 5,
        backoffSequence: [300, 600, 1200, 2000, 2000],
        noGrowthThreshold: 2
      },
      initialScrollKick: {
        enabled: true,
        delay: 0
      },
      settlementWatcher: {
        idleThreshold: 2000,
        maxDuration: 45000
      },
      completionCriteria: {
        completionSignalEnabled: true,
        mutationIdle: 3000,
        scrollStable: 4000,
        contentStable: 3000,
        contentStableChecks: 3,
        contentStableDelta: 5,
        copyButtonSignalEnabled: true,
        copyButtonRequiresStableText: true,
        copyButtonMinAnswerLength: 80,
        copyButtonMaxDistancePx: 900,
        minMetCriteria: 3,
        stopButtonCheckMode: 'fresh',
        stopButtonCacheMaxAgeMs: 3000,
        checkInterval: 1000
      },
      // v2.54.24 (2025-12-22 23:14 UTC): Verbose criteria logging (Purpose: toggle detailed completion logs).
      verboseCriteria: true,
      continuousActivity: {
        enabled: true,
        interval: 5000,
        scrollRange: [50, 200],
        pauseBetweenMoves: 3000
      },
      maintenanceScroll: {
        enabled: true,
        checkInterval: 3000,
        growthThreshold: 50,
        scrollStep: 120,
        idleThreshold: 5000,
        maxDuration: 20000
      }
    },
    finalization: {
      stabilityChecks: 3,
      stabilityInterval: 2000,
      sanityCheck: {
        enabled: true,
        warnOnHardTimeout: true,
        warnOnActiveIndicators: true,
        recentGrowthWindow: 2000,
        recentGrowthThreshold: 10
      }
    },
    telemetry: {
      enabled: true,
      useTraceId: true,
      sendToBackground: true,
      consoleLog: false,
      sessionStorage: false,
      sessionStorageKey: '__answer_pipeline_telemetry'
    },
    platforms: {
      deepseek: {
        preparation: { streamStartTimeout: 45000 }
      },
      perplexity: {
        preparation: { streamStartTimeout: 20000 }
      }
    }
  };

  // ---- Long profile overrides: patiently wait for long answers (~6-8 min). ----
  // Only the generation-wait knobs are scaled (~x2.5 on the ceilings) plus a bit
  // more stability before declaring a turn complete. Everything not listed here
  // keeps its Short value.
  const LONG_OVERRIDES = {
    preparation: { streamStartTimeout: 60000 },
    streaming: {
      adaptiveTimeout: {
        short: { timeout: 50000 },
        medium: { timeout: 112000 },
        long: { timeout: 225000 },
        veryLong: { timeout: 450000 },
        softExtension: 75000,
        hardMax: 450000
      },
      intelligentRetry: {
        maxRetries: 8,
        backoffSequence: [500, 1000, 2000, 3000, 4000, 5000, 5000, 5000],
        noGrowthThreshold: 4
      },
      settlementWatcher: {
        idleThreshold: 3500,
        maxDuration: 120000
      },
      completionCriteria: {
        mutationIdle: 4500,
        scrollStable: 6000,
        contentStable: 4500,
        contentStableChecks: 4
      },
      maintenanceScroll: {
        maxDuration: 60000
      }
    },
    finalization: {
      stabilityChecks: 4,
      stabilityInterval: 2500
    }
  };

  const STORAGE_KEY = 'longGenerationMode';
  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));
  // Pristine Short snapshot to restore from when switching long -> short.
  const SHORT_SNAPSHOT = clone(CONFIG);

  const deepAssign = (target, source) => {
    Object.keys(source || {}).forEach((key) => {
      const value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
          target[key] = {};
        }
        deepAssign(target[key], value);
      } else {
        target[key] = value;
      }
    });
    return target;
  };

  let activeProfile = 'short';

  // Mutates AnswerPipelineConfig in place so consumers that read it fresh on each
  // run (the answer watcher / finalizer) pick up the active profile.
  function applyTimingProfile(profile) {
    const next = profile === 'long' ? 'long' : 'short';
    deepAssign(CONFIG, clone(SHORT_SNAPSHOT));
    if (next === 'long') {
      deepAssign(CONFIG, LONG_OVERRIDES);
    }
    activeProfile = next;
    return activeProfile;
  }

  function getTimingProfile() {
    return activeProfile;
  }

  window.AnswerPipelineConfig = CONFIG;
  window.AnswerPipelineTiming = Object.freeze({
    applyTimingProfile,
    getTimingProfile,
    SHORT_SNAPSHOT,
    LONG_OVERRIDES
  });

  // In a model tab (content-script world) keep the active profile synced to the
  // Long checkbox on the results page via chrome.storage.local. Read once on load
  // and react to live toggles.
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(STORAGE_KEY, (data) => {
        try { applyTimingProfile(data && data[STORAGE_KEY] ? 'long' : 'short'); } catch (_) {}
      });
      chrome.storage.onChanged?.addListener?.((changes, area) => {
        if (area !== 'local' || !changes || !changes[STORAGE_KEY]) return;
        try { applyTimingProfile(changes[STORAGE_KEY].newValue ? 'long' : 'short'); } catch (_) {}
      });
    }
  } catch (_) {}
})();

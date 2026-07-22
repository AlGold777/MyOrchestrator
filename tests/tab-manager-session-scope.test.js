const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TAB_MANAGER_PATH = path.join(__dirname, '..', 'background', 'tab-manager.js');
const TAB_MANAGER_SOURCE = fs.readFileSync(TAB_MANAGER_PATH, 'utf8');

function createTabManagerSandbox({ queryTabs = [], storageInitial = {}, healthPingReady = false } = {}) {
  const telemetry = [];
  const storageState = { ...storageInitial };
  const listeners = {
    tabUpdated: [],
    tabRemoved: [],
    tabActivated: [],
    windowFocus: [],
    actionClicked: [],
    installed: [],
    startup: []
  };

  const chrome = {
    storage: {
      local: {
        get(key, cb) {
          if (typeof cb === 'function') {
            cb({ [key]: storageState[key] });
            return undefined;
          }
          return Promise.resolve({ [key]: storageState[key] });
        },
        set(obj) {
          Object.assign(storageState, obj || {});
          return Promise.resolve();
        }
      }
    },
    tabs: {
      query(queryInfo, cb) {
        cb(queryTabs.map((tab) => ({ ...tab })));
      },
      get(tabId, cb) {
        const tab = queryTabs.find((entry) => entry.id === tabId) || null;
        cb(tab ? { ...tab } : null);
      },
      create(_options, cb) {
        cb({ id: 999, url: 'https://chatgpt.com/', windowId: 1, index: 0, status: 'complete' });
      },
      update(_tabId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      reload(_tabId, cb) {
        if (typeof cb === 'function') cb();
      },
      sendMessage(_tabId, message, cb) {
        if (typeof cb === 'function') {
          cb(healthPingReady && message?.type === 'HEALTH_CHECK_PING'
            ? { type: 'HEALTH_CHECK_PONG', llmName: 'Perplexity' }
            : null);
        }
        return Promise.resolve();
      },
      onUpdated: {
        addListener(fn) {
          listeners.tabUpdated.push(fn);
        },
        removeListener(fn) {
          listeners.tabUpdated = listeners.tabUpdated.filter((entry) => entry !== fn);
        }
      },
      onRemoved: {
        addListener(fn) {
          listeners.tabRemoved.push(fn);
        }
      },
      onActivated: {
        addListener(fn) {
          listeners.tabActivated.push(fn);
        }
      }
    },
    windows: {
      update(_windowId, _options, cb) {
        if (typeof cb === 'function') cb();
      },
      WINDOW_ID_NONE: -1,
      onFocusChanged: {
        addListener(fn) {
          listeners.windowFocus.push(fn);
        }
      }
    },
    action: {
      onClicked: {
        addListener(fn) {
          listeners.actionClicked.push(fn);
        }
      }
    },
    scripting: {
      executeScript: jest.fn(async () => [{ result: { composerHasDraft: false, stopVisible: false, modalVisible: false } }])
    },
    runtime: {
      lastError: null,
      getURL(file) {
        return `chrome-extension://test/${file}`;
      },
      onInstalled: {
        addListener(fn) {
          listeners.installed.push(fn);
        }
      },
      onStartup: {
        addListener(fn) {
          listeners.startup.push(fn);
        }
      }
    }
  };

  const context = {
    console,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Array,
    Object,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    URL,
    navigator: { deviceMemory: 8 },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    chrome,
    self: {},
    TimingConfig: {
      getTiming(_key, fallback) {
        return fallback;
      }
    },
    sessionTabIds: new Set(),
    SESSION_TAB_IDS_KEY: 'llm_session_tab_ids_v1',
    sessionTabsLoaded: false,
    llmTabMap: {},
    jobState: {
      session: {
        boundTabIds: [1001]
      },
      llms: {
        GPT: { tabId: null }
      }
    },
    LLM_TARGETS: {
      GPT: {
        queryPatterns: ['*://chatgpt.com/*'],
        attachUrlAllowPrefixes: ['https://chatgpt.com/']
      },
      Perplexity: {
        queryPatterns: ['*://www.perplexity.ai/*'],
        attachUrlAllowPrefixes: ['https://www.perplexity.ai/']
      }
    },
    emitTelemetry(llmName, label, payload = {}) {
      telemetry.push({ llmName, label, payload });
    },
    prepareTabForUse: jest.fn(() => Promise.resolve()),
    initRequestMetadata: jest.fn(),
    broadcastHumanVisitStatus: jest.fn(),
    broadcastGlobalState: jest.fn(),
    removeActiveListenerForTab: jest.fn(),
    dispatchPromptToTab: jest.fn(),
    saveJobState: jest.fn(),
    activeListeners: new Map(),
    pingWindowByTabId: {},
    pingStartByTabId: {},
    resultsTabId: null,
    resultsWindowId: null,
    autoFocusNewTabsEnabled: false,
    promptDispatchInProgress: 0
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(TAB_MANAGER_SOURCE, context, { filename: 'background/tab-manager.js' });

  return { context, telemetry };
}

describe('tab-manager session scoping', () => {
  test('resolveTabForLlmName does not fall back to global tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const resolved = await new Promise((resolve) => {
      context.resolveTabForLlmName('GPT', resolve);
    });

    expect(resolved).toBeNull();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        })
      ])
    );
  });

  test('tryAttachExistingTab rejects foreign eligible tabs when run scope is active', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/foreign',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello');

    expect(attached).toBe(false);
    expect(context.prepareTabForUse).not.toHaveBeenCalled();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'RUN_SCOPE_BLOCKED'
        }),
        expect.objectContaining({
          llmName: 'GPT',
          label: 'ATTACH_REJECTED'
        })
      ])
    );
  });

  test('tryAttachExistingTab can globally reuse latest model tab when explicitly allowed', async () => {
    const now = Date.now();
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://chatgpt.com/c/older',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: now - 1000
        },
        {
          id: 2003,
          url: 'https://chatgpt.com/c/newer',
          windowId: 7,
          index: 1,
          status: 'complete',
          lastAccessed: now
        }
      ]
    });

    const attached = await context.tryAttachExistingTab('GPT', 'hello', [], { allowGlobalReuse: true });

    expect(attached).toBe(true);
    expect(context.prepareTabForUse).toHaveBeenCalledWith(2003, 'GPT');
    expect(context.dispatchPromptToTab).toHaveBeenCalledWith('GPT', 2003, 'hello', [], 'attach_existing');
    expect(context.jobState.session.boundTabIds).toContain(2003);
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'TAB_ATTACHED',
          payload: expect.objectContaining({
            meta: expect.objectContaining({
              runScope: 'global'
            })
          })
        })
      ])
    );
  });

  test('resolveTabForLlmName revalidates cached tab before returning it', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      queryTabs: [
        {
          id: 2002,
          url: 'https://example.com/not-chatgpt',
          windowId: 7,
          index: 0,
          status: 'complete',
          lastAccessed: Date.now()
        }
      ]
    });
    context.llmTabMap.GPT = 2002;
    context.jobState.session.boundTabIds = [2002];

    const resolved = await new Promise((resolve) => {
      context.resolveTabForLlmName('GPT', resolve);
    });

    expect(resolved).toBeNull();
    expect(context.llmTabMap.GPT).toBeUndefined();
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          llmName: 'GPT',
          label: 'TAB_READY_FAIL',
          payload: expect.objectContaining({
            details: 'tab_ineligible'
          })
        })
      ])
    );
  });

  test('Perplexity can dispatch when Chrome stays loading but its content script is ready', async () => {
    const { context, telemetry } = createTabManagerSandbox({
      healthPingReady: true,
      queryTabs: [
        {
          id: 4001,
          url: 'https://www.perplexity.ai/',
          windowId: 8,
          index: 0,
          status: 'loading',
          lastAccessed: Date.now()
        }
      ]
    });

    const readiness = await context.ensureTabReadyForDispatch(4001, 'Perplexity', { reason: 'round1' });

    expect(readiness.ok).toBe(true);
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Perplexity',
        label: 'TAB_READY_CONTENT_SCRIPT',
        payload: expect.objectContaining({ details: 'browser_status_loading' })
      })
    ]));
  });

  test('TabMapManager.load drops app UI tabs from persisted llmTabMap', async () => {
    const { context } = createTabManagerSandbox({
      storageInitial: {
        llmTabMap: { GPT: 3001 }
      },
      queryTabs: [
        {
          id: 3001,
          url: 'chrome-extension://test/pipeline_panel.html',
          windowId: 1,
          index: 0,
          status: 'complete'
        }
      ]
    });

    await context.TabMapManager.load();

    expect(context.llmTabMap.GPT).toBeUndefined();
    expect(context.TabMapManager.get('GPT')).toBeNull();
  });
});

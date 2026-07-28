const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HUMAN_PRESENCE_PATH = path.join(__dirname, '..', 'background', 'human-presence.js');
const HUMAN_PRESENCE_SOURCE = fs.readFileSync(HUMAN_PRESENCE_PATH, 'utf8');
const VISIT_POLICY_PATH = path.join(__dirname, '..', 'shared', 'visit-policy.js');
const VISIT_POLICY_SOURCE = fs.readFileSync(VISIT_POLICY_PATH, 'utf8');

const flushPromises = async (cycles = 1) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

function createHumanPresenceSandbox() {
  const telemetry = [];
  const diagnostics = [];
  const tabVisitTracker = {
    tabId: null,
    llmName: null,
    startedAt: 0,
    source: null,
    snapshot: null
  };
  const jobState = {
    session: {
      selectedModels: ['GPT', 'Claude'],
      startTime: 1000,
      roundsInProgress: false
    },
    llms: {
      GPT: { status: 'GENERATING', humanVisitDurations: [] },
      Claude: { status: 'GENERATING', humanVisitDurations: [] }
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
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: {},
    self: {},
    jobState,
    tabVisitTracker,
    browserHasFocus: true,
    promptDispatchInProgress: 0,
    chrome: {
      runtime: {
        sendMessage(_payload, cb) {
          if (typeof cb === 'function') cb();
        },
        lastError: null
      },
      tabs: {
        query(_query, cb) {
          cb([]);
        },
        get(_tabId, cb) {
          cb({ id: _tabId, windowId: 1 });
        },
        update(_tabId, _update, cb) {
          if (typeof cb === 'function') cb();
        },
        sendMessage(_tabId, _payload, cb) {
          if (typeof cb === 'function') cb();
        }
      },
      windows: {
        update(_windowId, _update, cb) {
          if (typeof cb === 'function') cb();
        }
      },
      scripting: {
        executeScript() {
          return Promise.resolve();
        }
      }
    },
    TabMapManager: {
      entries() {
        return [];
      },
      getNameByTabId(tabId) {
        if (tabId === 101) return 'GPT';
        if (tabId === 202) return 'Claude';
        return null;
      }
    },
    SUCCESS_STATUSES: ['SUCCESS', 'DONE'],
    isValidTabId(tabId) {
      return Number.isInteger(tabId) && tabId > 0;
    },
    emitTelemetry(llmName, label, payload = {}) {
      telemetry.push({ llmName, label, payload });
    },
    broadcastDiagnostic(llmName, payload = {}) {
      diagnostics.push({ llmName, payload });
    },
    broadcastHumanVisitStatus: jest.fn(),
    focusResultsTab: jest.fn(),
    saveJobState: jest.fn(),
    performTabHumanSimulation: jest.fn(() => Promise.resolve())
  };
  context.self = context;

  vm.createContext(context);
  vm.runInContext(VISIT_POLICY_SOURCE, context, { filename: 'shared/visit-policy.js' });
  vm.runInContext(HUMAN_PRESENCE_SOURCE, context, { filename: 'background/human-presence.js' });

  return { context, telemetry, diagnostics, tabVisitTracker, jobState };
}

describe('human presence tab lease arbitration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-08T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('denies competing non-user lease while active lease is within TTL', () => {
    const { context, telemetry, diagnostics, tabVisitTracker } = createHumanPresenceSandbox();

    expect(context.startTabVisit(101, 'GPT', 'automation_focus')).toBe(true);
    expect(context.startTabVisit(202, 'Claude', 'human_visit')).toBe(false);

    expect(tabVisitTracker.tabId).toBe(101);
    expect(tabVisitTracker.llmName).toBe('GPT');
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', label: 'LEASE_GRANTED' }),
      expect.objectContaining({ llmName: 'Claude', label: 'LEASE_DENIED' })
    ]));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'Claude',
        payload: expect.objectContaining({ label: 'LEASE_DENIED' })
      })
    ]));
  });

  test('allows user focus to preempt active automation lease', () => {
    const { context, telemetry, tabVisitTracker, jobState } = createHumanPresenceSandbox();

    expect(context.startTabVisit(101, 'GPT', 'automation_focus')).toBe(true);
    expect(context.startTabVisit(202, 'Claude', 'user_focus')).toBe(true);

    expect(tabVisitTracker.tabId).toBe(202);
    expect(tabVisitTracker.llmName).toBe('Claude');
    expect(jobState.llms.GPT.humanVisitDurations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'tab_switch', source: 'automation_focus' })
    ]));
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', label: 'LEASE_RELEASED' }),
      expect.objectContaining({ llmName: 'Claude', label: 'LEASE_GRANTED' })
    ]));
  });

  test('expires active lease before granting next automation lease', () => {
    const { context, telemetry, tabVisitTracker } = createHumanPresenceSandbox();

    expect(context.startTabVisit(101, 'GPT', 'automation_focus')).toBe(true);
    jest.setSystemTime(new Date(Date.now() + context.TAB_LEASE_TTL_MS + 1));
    expect(context.startTabVisit(202, 'Claude', 'automation_focus')).toBe(true);

    expect(tabVisitTracker.tabId).toBe(202);
    expect(tabVisitTracker.llmName).toBe('Claude');
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({ llmName: 'GPT', label: 'LEASE_EXPIRED' }),
      expect.objectContaining({ llmName: 'GPT', label: 'LEASE_RELEASED' }),
      expect.objectContaining({ llmName: 'Claude', label: 'LEASE_GRANTED' })
    ]));
  });

  test('returns interrupted automation visit summary as short visit', async () => {
    const { context, telemetry, diagnostics, jobState } = createHumanPresenceSandbox();

    const visitPromise = context.visitTabWithAutomation('GPT', 101, {
      dwellMs: 3000,
      scrollDurationMs: 1200,
      reason: 'forced_test_visit',
      sessionId: 1000
    });

    await flushPromises(4);
    jest.advanceTimersByTime(400);
    context.handleTabActivation(202, 1);
    jest.advanceTimersByTime(3000);

    const summary = await visitPromise;

    expect(summary).toEqual(expect.objectContaining({
      llmName: 'GPT',
      tabId: 101,
      shortVisit: true,
      usefulVisit: false,
      retryable: true,
      reason: 'tab_switch'
    }));
    expect(jobState.llms.GPT.lastAutomationVisitSummary).toEqual(expect.objectContaining({
      shortVisit: true,
      reason: 'tab_switch'
    }));
    expect(jobState.llms.GPT.shortHumanVisitDurations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'tab_switch' })
    ]));
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'GPT',
        payload: expect.objectContaining({ label: 'TAB_VISIT_SHORT' })
      })
    ]));
    expect(telemetry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        llmName: 'GPT',
        label: 'HUMAN_VISIT_END',
        payload: expect.objectContaining({
          meta: expect.objectContaining({ shortVisit: true, usefulVisit: false })
        })
      })
    ]));
  });

  test('programmatic tab focus is ignored as user focus and consumed once', () => {
    const { context, telemetry } = createHumanPresenceSandbox();

    expect(context.markProgrammaticTabFocus(101, 'human_visit_activate', { llmName: 'GPT' })).toBe(true);
    expect(telemetry.some((entry) => entry.label === 'PROGRAMMATIC_FOCUS_START')).toBe(true);

    telemetry.length = 0;
    context.handleTabActivation(101, 1);
    expect(telemetry.some((entry) => entry.label === 'TAB_ACTIVATION_IGNORED_PROGRAMMATIC')).toBe(true);

    // The mark is single-use: a subsequent real activation is no longer ignored.
    telemetry.length = 0;
    context.handleTabActivation(101, 1);
    expect(telemetry.some((entry) => entry.label === 'TAB_ACTIVATION_IGNORED_PROGRAMMATIC')).toBe(false);
  });
});

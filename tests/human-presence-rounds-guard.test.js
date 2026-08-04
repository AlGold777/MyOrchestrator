const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HUMAN_PRESENCE_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'human-presence.js'), 'utf8');
const VISIT_POLICY_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'visit-policy.js'), 'utf8');
const ORCHESTRATOR_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');

const pumpLoop = async (cycles = 50) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
    jest.advanceTimersByTime(200);
  }
};

function createSandbox() {
  const visited = [];
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
    tabVisitTracker: { tabId: null, llmName: null, startedAt: 0, source: null, snapshot: null },
    browserHasFocus: true,
    promptDispatchInProgress: 0,
    chrome: {
      runtime: { sendMessage(_p, cb) { if (typeof cb === 'function') cb(); }, lastError: null },
      tabs: {
        query(_q, cb) { cb([]); },
        get(tabId, cb) { cb({ id: tabId, windowId: 1 }); },
        update(tabId, _u, cb) { visited.push(tabId); if (typeof cb === 'function') cb(); },
        sendMessage(_t, _p, cb) { if (typeof cb === 'function') cb(); }
      },
      windows: { update(_w, _u, cb) { if (typeof cb === 'function') cb(); } },
      scripting: { executeScript: () => Promise.resolve() }
    },
    TabMapManager: {
      entries: () => [['GPT', 101], ['Claude', 202]],
      get: (llmName) => (llmName === 'GPT' ? 101 : (llmName === 'Claude' ? 202 : null)),
      getNameByTabId: (tabId) => (tabId === 101 ? 'GPT' : (tabId === 202 ? 'Claude' : null))
    },
    SUCCESS_STATUSES: ['SUCCESS', 'DONE'],
    isValidTabId: (tabId) => Number.isInteger(tabId) && tabId > 0,
    emitTelemetry: () => {},
    broadcastDiagnostic: () => {},
    broadcastHumanVisitStatus: jest.fn(),
    focusResultsTab: jest.fn(),
    saveJobState: jest.fn(),
    performTabHumanSimulation: jest.fn(() => Promise.resolve())
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(VISIT_POLICY_SOURCE, context, { filename: 'shared/visit-policy.js' });
  vm.runInContext(HUMAN_PRESENCE_SOURCE, context, { filename: 'background/human-presence.js' });
  return { context, jobState, visited };
}

describe('human presence yields to the dispatch rounds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-04T05:25:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('the loop is not scheduled while rounds are running', () => {
    const { context, jobState } = createSandbox();
    jobState.session.roundsInProgress = true;

    context.scheduleHumanPresenceLoop(true);

    expect(context.humanPresenceActive).not.toBe(true);
    jest.advanceTimersByTime(30000);
    expect(context.tabVisitTracker.tabId).toBeNull();
  });

  test('the loop does visit tabs while nothing else owns focus', async () => {
    const { context, visited } = createSandbox();

    context.scheduleHumanPresenceLoop(true);
    await pumpLoop();

    expect(visited.length).toBeGreaterThan(0);
  });

  test('a running loop stops visiting tabs once a run takes over focus', async () => {
    const { context, jobState, visited } = createSandbox();

    context.scheduleHumanPresenceLoop(true);
    expect(context.humanPresenceActive).toBe(true);

    // The run starts after the loop is already scheduled.
    jobState.session.roundsInProgress = true;
    await pumpLoop();

    expect(visited).toEqual([]);
    expect(context.tabVisitTracker.tabId).toBeNull();
  });

  test('an in-flight dispatch also holds the loop back', async () => {
    const { context, visited } = createSandbox();

    context.scheduleHumanPresenceLoop(true);
    context.promptDispatchInProgress = 1;
    await pumpLoop();

    expect(visited).toEqual([]);
  });
});

describe('rounds release tab focus before starting the human loop', () => {
  test('the rounds flag is cleared before the post-round loop is scheduled', () => {
    const startIndex = ORCHESTRATOR_SOURCE.indexOf('// Запускаем supervisor и human presence ПОСЛЕ всех rounds');
    expect(startIndex).toBeGreaterThan(-1);
    const section = ORCHESTRATOR_SOURCE.slice(startIndex, startIndex + 600);
    expect(section.indexOf('roundsInProgress = false')).toBeGreaterThan(-1);
    expect(section.indexOf('roundsInProgress = false')).toBeLessThan(section.indexOf('scheduleHumanPresenceLoop(true)'));
  });
});

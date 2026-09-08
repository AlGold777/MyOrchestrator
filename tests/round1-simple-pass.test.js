/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../background/dispatch-coordinator'), 'utf8');
const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');

function setup(names, send) {
  const events = [];
  const sessionStorage = {};
  const c = { console, Date, Promise, setTimeout, clearTimeout,
    jobState: {session: {startTime:1}, llms: Object.fromEntries(names.map((name,i) => [name,
      {tabId:i+1, lastDispatchMeta:{dispatchId:name, runSessionId:1}}]))},
    dispatchSleepMs: ms => new Promise(resolve => setTimeout(resolve,ms)),
    saveJobState: async () => {}, emitTelemetry: jest.fn(),
    activateTabForDispatch: async id => {events.push(['focus',id,Date.now()]);return true;},
    chrome: {runtime:{}, storage: {session: {
      set: jest.fn(async values => Object.assign(sessionStorage, structuredClone(values))),
      get: jest.fn(async keys => Object.fromEntries(keys.map(key => [key, sessionStorage[key]])))
    }}, tabs:{sendMessage: (id,msg,cb) => {events.push(['command',id,Date.now()]);send?.(c,id,msg,cb);}}},
    orderRound1Models: ns => ns, isSessionActive: id => id === c.jobState.session.startTime,
    isFinalizedEntry: e => !!e.finalizedAt, resolveBoundTabIdForOrchestrator: (_,e) => e.tabId,
    isValidTabId: Number.isInteger, getTabSafe: async () => ({url:'https://example.com'}),
    initRequestMetadata: jest.fn(), resolvePromptForDispatch: (_,p) => p,
    emitModelRoundTelemetry: jest.fn(), endBudgetPhase: jest.fn(),
    ROUND1_BEFORE_SEND_MS:2000, ROUND1_POST_SEND_MS:5000, ROUND1_PROGRESS_FOCUS_EXTENSION_MS:0,
    resolveRound1PostCommandFocusHoldMs: () => 0};
  c.self=c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(require.resolve('../background/dispatch-intent-store'), 'utf8'), c);
  vm.runInContext(source.slice(source.indexOf('async function dispatchSimpleFirstPass'),source.indexOf('async function dispatchPromptToTab')),c);
  vm.runInContext('var promptDispatchFocusMutex = Promise.resolve();\n'+source.slice(
    source.indexOf('function withPromptDispatchFocusLock'),source.indexOf('function resolvePromptSubmitted')),c);
  const start = orch.indexOf('async function dispatchRound1Sequentially');
  vm.runInContext(orch.slice(start,orch.indexOf('\nasync function ',start+10)),c);
  c.dispatchPromptToTab = (name,id,p,attachments,_,options) => c.dispatchSimpleFirstPass(name,id,p,attachments,c.jobState.llms[name],options);
  return {c,events};
}

function useFullCoordinator(c) {
  Object.assign(c, {
    isTransientBlockerDispatchSuspended: () => false,
    resolveDispatchFlags: () => ({isSent:false,isInProgress:false}),
    isTerminalLlmEntry: () => false,
    stopHumanPresenceLoop: jest.fn(),
    getPromptSubmitTimeoutMs: () => 30000,
    schedulePromptDispatchSupervisor: jest.fn(),
    broadcastDiagnostic: jest.fn(), scheduleDispatchRetry: jest.fn(),
    promptDispatchInProgress: 0,
    ensureTabReadyForDispatch: jest.fn(() => new Promise(() => {}))
  });
  vm.runInContext(fs.readFileSync(require.resolve('../utils/safe-mutex'), 'utf8'), c);
  c.dispatchMutexManager = new c.MutexManager();
  vm.runInContext(fs.readFileSync(require.resolve('../background/dispatch-state-machine'), 'utf8'), c);
  c.resolveDispatchFlags = c.getDispatchFlags;
  vm.runInContext(source.slice(source.indexOf('async function withPromptDispatchLock'),
    source.indexOf('\nfunction withPromptDispatchFocusLock')), c);
  vm.runInContext(source.slice(source.indexOf('async function dispatchPromptToTab'),
    source.indexOf('\nconst TRANSIENT_BLOCKER_TRANSPORT_TTL_MS')), c);
}

beforeEach(() => {jest.useFakeTimers();jest.setSystemTime(1000);});
afterEach(() => jest.useRealTimers());

test('all models get one ordered command after 2s; next focus is 5s after command regardless of Send telemetry', async () => {
  const {c,events} = setup(['GPT','DeepSeek','Kimi'],(c,id,msg,cb) => {
    cb({accepted:true,dispatchId:msg.meta.dispatchId});
    setTimeout(() => {c.jobState.llms[msg.meta.dispatchId].providerSendActionObservedDispatchId=msg.meta.dispatchId;},300);
  });
  const run = c.dispatchRound1Sequentially(['GPT','DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(22000);
  expect(await run).toBe(true);
  expect(events).toEqual([
    ['focus',1,1000],['command',1,3000],
    ['focus',2,8000],['command',2,10000],
    ['focus',3,15000],['command',3,17000]
  ]);
});

test('a silent page gets no retries and cannot hold the rest of the pass', async () => {
  const {c,events}=setup(['DeepSeek','Kimi'],(c,id,msg) => {
    if(id===2)c.jobState.llms.Kimi.providerSendActionObservedDispatchId=msg.meta.dispatchId;
  });
  const run=c.dispatchRound1Sequentially(['DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(25000);
  await run;
  expect(events).toEqual([['focus',1,1000],['command',1,3000],['focus',2,8000],['command',2,10000]]);
  expect(c.jobState.llms.DeepSeek.firstPassResult.outcome).toBe('send_unconfirmed');
});

test('Stop during the initial pause sends no command and visits no further model', async () => {
  const {c,events}=setup(['DeepSeek','Kimi']);
  const run=c.dispatchRound1Sequentially(['DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(1000);
  c.jobState.session.startTime=2;
  await jest.advanceTimersByTimeAsync(1000);
  expect(await run).toBe(false);
  expect(events).toEqual([['focus',1,1000]]);
});

test('attachments are deferred without sending an incomplete text-only request', async () => {
  const {c,events}=setup(['Kimi']);
  const result=await c.dispatchSimpleFirstPass('Kimi',1,'8 / 4',[{name:'data.txt'}],c.jobState.llms.Kimi,{});
  expect(result.reason).toBe('attachments_require_round2');
  expect(events).toEqual([]);
});

test('the whole dispatch path visits ten models every 7s with silent ACKs and continuous provider progress', async () => {
  const names = ['GPT','Claude','Gemini','Qwen','DeepSeek','Kimi','Grok','Perplexity','Le Chat','Z.ai'];
  const {c,events}=setup(names,(c,id,msg) => {
    const entry = c.jobState.llms[names[id-1]];
    // Neither a callback nor Send telemetry arrives. Progress continues after
    // the slot ends, as on a slow provider. It must not extend/reacquire focus.
    for (let delay=1000; delay<=12000; delay+=1000) setTimeout(() => {
      entry.providerDispatchStageDispatchId=msg.meta.dispatchId;
      entry.providerDispatchStage='composer_editing';
      entry.providerDispatchStageAt=Date.now();
      entry.providerComposerTransactionActive=true;
    }, delay);
  });
  useFullCoordinator(c);
  const run=c.dispatchRound1Sequentially(names,'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(70000);
  expect(await run).toBe(true);
  expect(events).toEqual(names.flatMap((_,i) => [
    ['focus',i+1,1000+i*7000], ['command',i+1,3000+i*7000]
  ]));
  expect(c.ensureTabReadyForDispatch).not.toHaveBeenCalled();
  expect(c.scheduleDispatchRetry).not.toHaveBeenCalled();
  expect(c.promptDispatchInProgress).toBe(0);
  expect(c.emitModelRoundTelemetry.mock.calls.filter(call => call[3]==='dispatch preparation failed')).toEqual([]);
});

test('stalled full-state storage cannot skip models or delay their foreground slots', async () => {
  const {c,events}=setup(['DeepSeek','Kimi']);
  useFullCoordinator(c);
  c.saveJobState = () => new Promise(() => {});
  const run=c.dispatchRound1Sequentially(['DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(14000);
  expect(await run).toBe(true);
  expect(events).toEqual([['focus',1,1000],['command',1,3000],['focus',2,8000],['command',2,10000]]);
  expect(c.chrome.storage.session.set).toHaveBeenCalledTimes(2);
});

test('a failed intent write never sends and reports the exact deferral instead of a sent command', async () => {
  const {c,events}=setup(['Kimi']);
  c.chrome.storage.session.set.mockRejectedValue(new Error('unavailable'));
  const result=await c.dispatchSimpleFirstPass('Kimi',1,'8 / 4',[],c.jobState.llms.Kimi,{});
  expect(result.reason).toBe('checkpoint_not_ready');
  expect(events).toEqual([]);
  expect(c.emitTelemetry).toHaveBeenCalledWith('Kimi','ROUND1_SIMPLE_DISPATCH_RESULT',expect.objectContaining({
    meta:expect.objectContaining({stage:'first_pass_deferred',outcome:'checkpoint_not_ready',commandIssued:false})
  }));
  await c.dispatchRound1Sequentially(['Kimi'],'8 / 4',[],1);
  expect(c.emitModelRoundTelemetry).toHaveBeenCalledWith('Kimi',1,'END','dispatch deferred before command',expect.objectContaining({
    meta:expect.objectContaining({commandIssued:false,reason:'checkpoint_not_ready'})
  }));
});

test('a stalled intent write is bounded and its late completion cannot send an old command', async () => {
  const {c,events}=setup(['DeepSeek','Kimi']);
  let release;
  c.chrome.storage.session.set.mockImplementationOnce(() => new Promise(resolve => {release=resolve;}));
  const run=c.dispatchRound1Sequentially(['DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(9000);
  expect(await run).toBe(true);
  release();
  await jest.advanceTimersByTimeAsync(2000);
  expect(events).toEqual([['focus',2,3000],['command',2,5000]]);
});

test('a late command acceptance neither revisits the old page nor resets the current visit', async () => {
  const {c,events}=setup(['DeepSeek','Kimi'],(_,id,msg,cb) => {
    setTimeout(() => cb({accepted:true,dispatchId:msg.meta.dispatchId}),9000);
  });
  useFullCoordinator(c);
  const run=c.dispatchRound1Sequentially(['DeepSeek','Kimi'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(14000);
  expect(await run).toBe(true);
  expect(events).toEqual([['focus',1,1000],['command',1,3000],['focus',2,8000],['command',2,10000]]);
  expect(c.jobState.llms.DeepSeek.lastCommandAcceptedAt).toBe(12000);
});

test('closing the visit preserves the state of a provider already generating', async () => {
  const {c}=setup(['DeepSeek'],(c,id,msg) => {
    const machine = c.getDispatchFlags('DeepSeek').machine;
    machine.submit(); machine.sent(); machine.stream();
    c.jobState.llms.DeepSeek.providerSendActionObservedDispatchId=msg.meta.dispatchId;
  });
  useFullCoordinator(c);
  const run=c.dispatchRound1Sequentially(['DeepSeek'],'8 / 4',[],1);
  await jest.advanceTimersByTimeAsync(7000);
  expect(await run).toBe(true);
  expect(c.getDispatchFlags('DeepSeek').state).toBe('STREAMING');
});

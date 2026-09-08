/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const storeSource = fs.readFileSync(require.resolve('../background/dispatch-intent-store'), 'utf8');
const orch = fs.readFileSync(require.resolve('../background/job-orchestrator'), 'utf8');

function setup(records = {}) {
  const c = {Date, setTimeout, clearTimeout, console: {error:jest.fn()}, chrome: {storage: {session: {
    set: jest.fn(async values => Object.assign(records,structuredClone(values))),
    get: jest.fn(async keys => Object.fromEntries(keys.map(key => [key,records[key]])))
  }}}};
  c.self=c; vm.createContext(c); vm.runInContext(storeSource,c);
  return c;
}
const attempt = (epoch=1, run=42) => ({tabId:10,generationEpoch:epoch,dispatchAttempts:epoch,lastDispatchAt:1000,
  lastDispatchMeta:{runSessionId:run,dispatchId:`Kimi:${run}:${epoch}`,generationEpoch:epoch,attemptId:`attempt:${epoch}`}});

test('a new worker restores command ownership from the journal over an older full snapshot', async () => {
  const records={};
  await setup(records).DispatchIntentStore.persist('Kimi',10,attempt());
  const fresh=setup(records);
  const state={session:{startTime:42},llms:{Kimi:{tabId:10},DeepSeek:{tabId:11}}};
  await fresh.DispatchIntentStore.restore(state);
  expect(state.llms.Kimi).toMatchObject({
    lastDispatchMeta:{dispatchId:'Kimi:42:1'},generationEpoch:1,dispatchAttempts:1,
    dispatchCheckpoint:{phase:'command_intent'},awaitingSubmitConfirmation:true
  });
  // Exercise the actual resume gate: the uncertain command is skipped and the
  // previously unvisited model is still dispatched.
  Object.assign(fresh,{jobState:state,orderRound1Models:n=>n,isSessionActive:()=>true,isFinalizedEntry:()=>false,
    resolveBoundTabIdForOrchestrator:(_,e)=>e.tabId,isValidTabId:Number.isInteger,
    emitModelRoundTelemetry:jest.fn(),getTabSafe:async()=>({url:'https://example.com'}),
    initRequestMetadata:jest.fn(),resolvePromptForDispatch:(_,p)=>p,dispatchPromptToTab:jest.fn(),endBudgetPhase:jest.fn(),
    ROUND1_BEFORE_SEND_MS:2000,ROUND1_POST_SEND_MS:5000});
  const start=orch.indexOf('async function dispatchRound1Sequentially');
  vm.runInContext(orch.slice(start,orch.indexOf('\nasync function ',start+10)),fresh);
  await fresh.dispatchRound1Sequentially(['Kimi','DeepSeek'],'8 / 4',[],42,{resume:true});
  expect(fresh.dispatchPromptToTab.mock.calls.map(call=>call[0])).toEqual(['DeepSeek']);
});

test.each(['different_run','newer_attempt','confirmed','terminal'])('journal does not overwrite %s state',async kind=>{
  const c=setup();
  await c.DispatchIntentStore.persist('Kimi',10,attempt());
  const state={session:{startTime:kind==='different_run'?43:42},llms:{Kimi:attempt(kind==='newer_attempt'?2:1)}};
  if(kind==='confirmed')state.llms.Kimi.promptSubmittedAt=1200;
  if(kind==='terminal')state.llms.Kimi.finalStatusRecorded=true;
  const before=structuredClone(state);
  await c.DispatchIntentStore.restore(state);
  expect(state).toEqual(before);
});

test('a failed journal read cannot publish or resume the stale full snapshot',async()=>{
  const c=setup();
  const original={llms:{}};
  Object.assign(c,{jobState:original,CompressedStorage:{get:async()=>({session:{startTime:42},llms:{Kimi:{}}})},
    rehydrateActiveJobRuntime:jest.fn(),broadcastHumanVisitStatus:jest.fn()});
  c.chrome.storage.session.get.mockRejectedValue(new Error('read_failed'));
  vm.runInContext(orch.slice(orch.indexOf('async function loadJobState'),orch.indexOf('\nfunction getActivePipelineControlState')),c);
  await expect(c.loadJobState()).rejects.toThrow('read_failed');
  expect(c.jobState).toBe(original);
  expect(c.rehydrateActiveJobRuntime).not.toHaveBeenCalled();
});

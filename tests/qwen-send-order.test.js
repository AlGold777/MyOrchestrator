/** @jest-environment node */
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync(require.resolve('../content-scripts/content-qwen'),'utf8');
function setup(accepted) {
  const messages=[];
  const document={querySelector:()=>({})};
  const button={disabled:false,click:jest.fn(()=>{if(accepted)messages.push('8 / 4');})};
  const c={Date,console,document,KeyboardEvent:class {},sleep:ms=>new Promise(r=>setTimeout(r,ms)),
    resolveQwenChatRoot:()=>({detached:true}),getUserMessages:root=>root===document?messages:[],
    normalizeForComparison:s=>String(s).trim(),extractMessageText:s=>s,
    resolveSendButton:async()=>button,isSafeQwenSendControl:b=>b===button && !b.disabled,
    discoverComposer:()=>null, readComposerValue:i=>i.value,
    hasQwenGenerationSignal:()=>false, emitDiagnostic:jest.fn(),
    qwenHumanClick:jest.fn(async b=>b.click())};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function sendComposer'),source.indexOf('  function asSelectorArray')),c);
  return {c,button,messages};
}
afterEach(()=>jest.useRealTimers());
test('ignored first click retries the unchanged attached draft with the refreshed Send control',async()=>{
  jest.useFakeTimers();
  const {c,button,messages}=setup(false);
  const live={isConnected:true,value:'8 / 4'};
  c.discoverComposer=()=>live;
  const fresh={disabled:false,click:jest.fn(()=>messages.push('8 / 4'))};
  c.resolveSendButton=jest.fn().mockResolvedValueOnce(button).mockResolvedValue(fresh);
  c.isSafeQwenSendControl=b=>Boolean(b && !b.disabled);
  const pending=c.sendComposer(live,{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(6500);
  await expect(pending).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
  expect(c.qwenHumanClick).toHaveBeenCalledWith(fresh);
  expect(fresh.click).toHaveBeenCalledTimes(1);
});
test.each(['empty','changed','detached','generating','new-turn','disabled'])('does not retry an ambiguous draft: %s',async reason=>{
  jest.useFakeTimers();
  const {c,button,messages}=setup(false);
  c.discoverComposer=()=>({isConnected:reason!=='detached',value:reason==='empty'?'':reason==='changed'?'edited':'8 / 4'});
  c.hasQwenGenerationSignal=()=>reason==='generating';
  button.click.mockImplementation(()=>{
    if(reason==='new-turn')messages.push('another message');
    if(reason==='disabled')button.disabled=true;
  });
  const pending=c.sendComposer({},{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(6500);
  await rejected;
  expect(button.click).toHaveBeenCalledTimes(1);
  expect(c.qwenHumanClick).not.toHaveBeenCalled();
});
test('clicks immediately and confirms the new user turn after the original scope is replaced',async()=>{
  const {c,button}=setup(true);
  await expect(c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4',scope:{detached:true}})).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
});
test('an unrelated spinner or disabled button cannot confirm Send or cause a second click',async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(false);
  button.click.mockImplementation(()=>{button.disabled=true;});
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(6500);
  await rejected;
  expect(button.click).toHaveBeenCalledTimes(1);
});
test('visible Send bypasses a stalled selector service',async()=>{
  const button={};
  const finder=jest.fn(()=>new Promise(()=>{}));
  const c={window:{SelectorFinder:{findOrDetectSelector:finder}},document:{querySelector:()=>button},
    isSafeQwenSendControl:b=>b===button,console};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function resolveSendButton'),source.indexOf('  function requestSubmitNearComposer')),c);
  expect(await c.resolveSendButton(null)).toBe(button);
  expect(finder).not.toHaveBeenCalled();
});

test('Send enabled after paste is clicked during the foreground slot despite a stalled finder',async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(true);
  button.disabled=true;
  c.document.querySelector=()=>button;
  c.document.querySelectorAll=()=>[];
  c.isSafeQwenSendControl=b=>b===button && !b.disabled;
  c.window={SelectorFinder:{findOrDetectSelector:jest.fn(()=>new Promise(()=>{}))}};
  vm.runInContext(source.slice(source.indexOf('  async function resolveSendButton'),source.indexOf('  function requestSubmitNearComposer')),c);
  setTimeout(()=>{button.disabled=false;},300);
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(500);
  await expect(pending).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
  expect(c.window.SelectorFinder.findOrDetectSelector).not.toHaveBeenCalled();
});

test('a failure before submission cannot enter last-chance extraction of an old answer',async()=>{
  const error={type:'selector_not_found',message:'No composer'};
  const activity={heartbeat:jest.fn(),error:jest.fn()};
  const c={Date,console,MODEL:'Qwen',window:{},
    runLifecycle:(_name,_context,run)=>run(activity),buildLifecycleContext:()=>({}),
    metricsCollector:{startOperation:()=>1,recordError:jest.fn(),endOperation:jest.fn()},
    sleep:async()=>{},discoverComposer:()=>{throw error;},
    waitForQwenReply:jest.fn(async()=> 'Old answer'),sendResult:jest.fn()};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function injectAndGetResponse'),source.indexOf('  let currentRequestContext')),c);
  await expect(c.injectAndGetResponse('8 / 4')).rejects.toEqual(error);
  expect(c.waitForQwenReply).not.toHaveBeenCalled();
  expect(c.sendResult).toHaveBeenCalledWith('No composer',false,expect.anything(),error);
});

test('old conversation answers cannot confirm failed keyboard submission',async()=>{
  jest.useFakeTimers();
  const {c}=setup(false);
  c.resolveSendButton=async()=>null;
  c.requestSubmitNearComposer=()=>false;
  c.startDriftFallback=()=>{};
  c.hasQwenGenerationSignal=jest.fn(()=>true);
  c.getAssistantMessages=jest.fn(()=>['Old answer']);
  c.isQwenAnswerCandidate=()=>true;
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(c.hasQwenGenerationSignal).not.toHaveBeenCalled();
  expect(c.getAssistantMessages).not.toHaveBeenCalled();
});

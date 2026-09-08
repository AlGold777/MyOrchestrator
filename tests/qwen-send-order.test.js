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
    resolveSendButton:async()=>button,isSafeQwenSendControl:b=>b===button};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function sendComposer'),source.indexOf('  function asSelectorArray')),c);
  return {c,button};
}
afterEach(()=>jest.useRealTimers());
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

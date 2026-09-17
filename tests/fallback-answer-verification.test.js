/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const Verification = require('../shared/answer-verification');
const source = fs.readFileSync(require.resolve('../content-scripts/unified-answer-pipeline'), 'utf8');
const methods = source.slice(source.indexOf('    async verifyFallbackAnswer('), source.indexOf('    // Collect all answer candidates'));

function setup(overrides = {}) {
  const c = {window:{AnswerVerification:Verification}};
  vm.createContext(c);
  vm.runInContext(`this.Pipeline = class { ${methods} };`, c);
  const pipeline = new c.Pipeline();
  let i = 0;
  Object.assign(pipeline, {
    config:{finalization:{stabilityChecks:3,stabilityInterval:1}},
    sleep:async()=>{},emitPipelineTelemetry:()=>{},hashString:text=>`hash:${text}`,
    isStaleBaselineAnswer:()=>false,
    captureAnswerStructureSnapshot:()=>({
      runSessionId:1,dispatchId:'Claude:1:1',generationEpoch:1,turnAnchor:0,
      observedAt:++i,selectedHash:'hash:full answer',selectedLength:11,
      selectedNodeKey:'answer',candidateSetHash:'set',messageRootHash:'root',
      generationActive:false,resolution:'exact',structuralComplete:true,nodes:[],
      ...overrides
    })
  });
  return pipeline;
}

test('a stable exact fallback carries structural and dispatch proof', async()=>{
  expect(await setup().verifyFallbackAnswer('full answer')).toMatchObject({
    verified:true,dispatchId:'Claude:1:1',turnAnchor:0,generationActive:false,structuralComplete:true
  });
});
test.each([
  [{generationActive:true},'full answer','generation_still_active'],
  [{generationActive:null},'full answer','generation_inactive_unproven'],
  [{dispatchId:null},'full answer','identity_missing:dispatchId'],
  [{structuralComplete:false,structuralIssues:['omitted_block']},'full answer','omitted_block'],
  [{},'full','fallback_text_mismatch']
])('unproven or truncated fallback remains rejected: %s',async(overrides,text,reason)=>{
  const result=await setup(overrides).verifyFallbackAnswer(text);
  expect(result.verified).toBe(false);expect(Array.from(result.reasons)).toContain(reason);
});
test('a previous-turn baseline is not promoted by stable DOM',async()=>{
  const p=setup();p.isStaleBaselineAnswer=()=>true;
  expect(await p.verifyFallbackAnswer('full answer')).toMatchObject({verified:false,reasons:['stale_baseline_answer']});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,LlmAdapter} from '@deepseek-ai/dsh-llm';
import {createNativeModelPort} from '../plugin/native-model.mjs';
const input={stage:'prose',system:'Synthetic only',input:'Hello',context:{runId:'synthetic',requestId:'q',attemptId:'a'}};
function fixture(options={}){
 const calls=[],reserves=[],settles=[],gates=[],traces=[];let current={provider:'synthetic-provider',model:'model-a'};
 const llm={async resolveModelInfo(provider,id){return {provider,id,name:id,...options.info};},async *stream(o){calls.push(o);if(options.stream)yield* options.stream(o,calls.length);else{yield {type:'text-delta',index:0,text:'A synthetic answer'};yield {type:'usage',usage:{inputTokens:4,outputTokens:3,cost:options.cost}};yield {type:'finish',reason:{kind:'stop'}};}}};
 const usageLedger={async reserve(r){reserves.push(r);return 'usage-'+reserves.length;},async settle(id,r){settles.push({id,...r});}};
 const generationGate={async reserve(r){gates.push(r);return 'gate-'+gates.length;},async settle(){}};
 const port=createNativeModelPort({llm,agentDefaultModel:{currentSelection:()=>({...current})},usageLedger,generationGate,onTrace:r=>traces.push(r),...options.port});
 return {port,calls,reserves,settles,gates,traces,llm,usageLedger,setCurrent:x=>current=x};
}
test('A1 native reads current DSH selection every call, reports actual capabilities and unknown response/cost',async()=>{
 const f=fixture();const d=await f.port.describe();assert.equal(d.selectionSource,'dsh_current_selection');assert.equal(f.reserves.length,0);
 const a=await f.port.generate(input);assert.equal(a.model,'synthetic-provider/model-a');assert.equal(a.route.responseModel,null);assert.equal(a.route.responseModelSource,'not_reported');assert.equal(a.route.usageSource,'dsh_sdk_usage');assert.equal(a.attempts[0].actualCostUsd,null);assert(!Object.hasOwn(f.calls[0],'maxTokens'));assert.equal(a.route.effective.maxTokens,null);assert(!Object.hasOwn(f.calls[0],'reasoningEffort'));
 f.setCurrent({provider:'second',model:'model-b'});assert.equal((await f.port.generate(input)).model,'second/model-b');assert.equal(f.gates.length,2);
});
test('A1 stage/run/config precedence is explicit and no auto router',async()=>{
 const f=fixture({port:{selection:{provider:'config',model:'base'},stageSelections:{prose:{provider:'config',model:'stage'}}}});
 assert.equal((await f.port.generate(input)).model,'config/stage');
 assert.equal((await f.port.generate({...input,context:{modelSelection:{provider:'run',model:'base'}}})).model,'run/base');
 assert.equal((await f.port.generate({...input,context:{modelSelection:{provider:'run',model:'base'},stageModelSelections:{prose:{provider:'run',model:'stage'}}}})).model,'run/stage');
});
test('A1 default reasoning follows resolved DSH capabilities; explicit unsupported rejects before dispatch',async()=>{
 const f=fixture({info:{reasoning:{efforts:[{id:'low'}],defaultEffort:'low'}}});
 assert.equal((await f.port.generate(input)).route.effective.reasoningEffort,'low');
 await assert.rejects(f.port.generate({...input,context:{modelSelection:{provider:'p',model:'m',reasoningEffort:'off'}}}),{code:'UNSUPPORTED_REASONING_EFFORT'});assert.equal(f.calls.length,1);
});
test('A1 missing selection never falls back to DeepSeek',async()=>{
 const f=fixture();const p=createNativeModelPort({llm:f.llm,usageLedger:f.usageLedger});
 await assert.rejects(p.generate(input),{code:'MODEL_SELECTION_REQUIRED'});assert.equal(f.calls.length,0);
});
test('A1 cancel releases caller and rejects late SDK results even if stream ignores abort',async()=>{
 let release;const wait=new Promise(r=>release=r);const f=fixture({stream:async function*(){await wait;yield {type:'text-delta',index:0,text:'late'};yield {type:'finish',reason:{kind:'stop'}};}});
 const controller=new AbortController(),promise=f.port.generate({...input,signal:controller.signal});await delay(15);controller.abort();
 await assert.rejects(promise,{code:'CANCELLED',category:'cancelled'});assert.equal(f.settles.length,1);assert.equal(f.settles[0].status,'cancelled');release();await delay(15);assert.equal(f.settles.length,1);assert.equal(f.traces.length,1);
});
test('A1 timeout bounds a stuck stream; late finish cannot become accepted output',async()=>{
 let release;const wait=new Promise(r=>release=r);const f=fixture({port:{timeoutMs:20},stream:async function*(){await wait;yield {type:'block-end',index:0,block:{type:'text',text:'too late'}};yield {type:'finish',reason:{kind:'stop'}};}});
 await assert.rejects(f.port.generate(input),{code:'MODEL_TIMEOUT'});release();await delay(15);assert.equal(f.settles[0].status,'failed');assert.equal(f.calls.length,1);
});
test('A1 one transport retry has separate durable reservations and same selected model',async()=>{
 const f=fixture({port:{technicalRetries:1},stream:async function*(_o,n){if(n===1)yield {type:'finish',reason:{kind:'error',failure:{code:'HTTP_503',message:'SECRET'}}};else{yield {type:'text-delta',index:0,text:'ok'};yield {type:'finish',reason:{kind:'stop'}};}}});
 const r=await f.port.generate(input);assert.equal(r.attempts.length,2);assert.deepEqual(f.reserves.map(x=>x.retry),[0,1]);assert.equal(f.gates.length,2);assert.notEqual(f.reserves[0].requestId,f.reserves[1].requestId);assert(!JSON.stringify(r).includes('SECRET'));
});
test('A1 malformed tool JSON and authentication never retry',async()=>{
 for(const mode of ['json','auth']){
 const f=fixture({port:{technicalRetries:1},stream:async function*(){if(mode==='json'){yield {type:'block-end',index:0,block:{type:'tool-call',id:'x',name:'t',arguments:'bad'}};yield {type:'finish',reason:{kind:'tool-calls'}};}else yield {type:'finish',reason:{kind:'error',failure:{code:'AUTH',message:'PRIVATE'}}};}});
 await assert.rejects(f.port.generate({...input,stage:'director'}),{code:mode==='json'?'INVALID_TOOL_ARGUMENTS':'AUTH'});assert.equal(f.calls.length,1);
 }
});
test('A1 configured retry is bounded and each failed attempt counts',async()=>{
 const f=fixture({port:{technicalRetries:1},stream:async function*(){throw Error('raw-private-provider-message');}});
 await assert.rejects(f.port.generate(input),e=>e.code==='MODEL_TRANSPORT_ERROR'&&e.attempts.length===2&&!e.message.includes('raw-private'));assert.equal(f.gates.length,2);
 assert.throws(()=>createNativeModelPort({llm:f.llm,usageLedger:f.usageLedger,technicalRetries:2}));
});
test('A1 durable gate refusal cannot dispatch a model',async()=>{
 const f=fixture({port:{generationGate:{async reserve(){throw Object.assign(Error(),{code:'GENERATION_LIMIT_REACHED'});},async settle(){}}}});
 await assert.rejects(f.port.generate(input),{code:'GENERATION_LIMIT_REACHED',category:'persistence'});assert.equal(f.calls.length,0);
});
test('A1 journal settle failure is persistence failure and cannot consume retry',async()=>{
 const ledger={async reserve(){return 'x';},async settle(){throw Error('disk full');}};
 const f=fixture({port:{usageLedger:ledger,technicalRetries:1}});await assert.rejects(f.port.generate(input),{code:'MODEL_JOURNAL_SETTLE_FAILED',category:'persistence'});assert.equal(f.calls.length,1);
});
test('A1 SDK explicit response model is distinct; unproven SDK cost is never actual billing',async()=>{
 const f=fixture({stream:async function*(){yield {type:'text-delta',index:0,text:'ok',responseModel:'server-version'};yield {type:'usage',usage:{inputTokens:1,outputTokens:2,cost:0.001}};yield {type:'finish',reason:{kind:'stop'}};}});
 const r=await f.port.generate(input);assert.equal(r.route.responseModel,'server-version');assert.equal(r.route.effective.model,'model-a');assert.equal(r.attempts[0].actualCostUsd,null);
});
test('A1 finish replay extracts only validated responseModel and discards all hidden metadata',async()=>{
 const f=fixture({stream:async function*(){yield {type:'text-delta',index:0,text:'public answer'};yield {type:'usage',usage:{inputTokens:2,outputTokens:3,cost:0}};yield {type:'finish',reason:{kind:'stop'},replayState:{response:{kind:'pi-ai',version:2,model:'model-a',responseModel:'actual-response-version',providerThinkingLevel:'PRIVATE_THINKING'},blocks:[{thoughtSignature:'PRIVATE_SIGNATURE',text:'PRIVATE_REASONING'}]}};}});
 const r=await f.port.generate(input);assert.equal(r.route.responseModel,'actual-response-version');assert.equal(r.route.responseModelSource,'sdk_response_replay_metadata');assert.equal(r.attempts[0].actualCostUsd,null);
 assert(!JSON.stringify([r,f.traces,f.settles]).includes('PRIVATE_'));assert(!JSON.stringify(r).includes('replayState'));
});
test('A1 replay identity ignores malformed, empty, and overlong model values',async()=>{
 for(const responseModel of [null,{},'', '  ', 'x'.repeat(161)]){
  const f=fixture({stream:async function*(){yield {type:'text-delta',index:0,text:'ok'};yield {type:'finish',reason:{kind:'stop'},replayState:{response:{responseModel}}};}});
  const r=await f.port.generate(input);assert.equal(r.route.responseModel,null);assert.equal(r.route.responseModelSource,'not_reported');
 }
});
test('A1 opaque thought-bearing tool id metadata never reaches Director handoff',async()=>{
 const f=fixture({stream:async function*(){yield {type:'block-end',index:0,block:{type:'tool-call',id:'call1__thought__PRIVATE',name:'consult_character',arguments:'{"characterId":"kalt"}'}};yield {type:'finish',reason:{kind:'tool-calls'}};}});
 const r=await f.port.generate({...input,stage:'director'});assert.equal(r.toolCalls[0].id,'call1');assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('A1 real shipped DSH LlmRuntime prepared-call routing with synthetic adapter and no network',async()=>{
 const ctx=new Context();await ctx.plugin(LlmRuntime);let dispatched;
 class Adapter extends LlmAdapter{
  async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:16384,reasoning:{efforts:[{id:'low',name:'Low'}],defaultEffort:'low'},toolUpdate:'addition-only'};}
  async *stream(options){dispatched=options;yield {type:'block-end',index:0,block:{type:'text',text:'offline'}};yield {type:'finish',reason:{kind:'stop'}};}
 }
 ctx.llm.registerAdapter(['synthetic-route'],new Adapter());
 try{
  const f=fixture();const port=createNativeModelPort({llm:ctx.llm,agentDefaultModel:{currentSelection:()=>({provider:'synthetic-route',model:'capability-model'})},usageLedger:f.usageLedger});
  const r=await port.generate(input);assert.equal(r.text,'offline');assert.equal(dispatched.reasoningEffort,'low');assert.equal(dispatched.maxTokens,16384);assert.equal(r.route.outputBudget.snapshotBound,true);assert.equal(r.route.responseModel,null);assert.equal(r.route.effective.model,'capability-model');assert(!Object.hasOwn(dispatched,'toolHistory'));
 }finally{await ctx.fiber.dispose();}
});

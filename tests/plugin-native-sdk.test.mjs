// Real shipped DSH SDK, synthetic adapter only: no credentials, network, or campaign ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,LlmAdapter} from '@deepseek-ai/dsh-llm';
import {DeepSeekAdapter,resolveAdapterOptions} from '@deepseek-ai/dsh-llm-deepseek';
import {createNativeModelPort as createPort} from '../plugin/native-model.mjs';
// Milestone A requires explicit DSH selection/capabilities in synthetic fixtures.
function createNativeModelPort(args){
  const llm=args.llm;
  if(!llm.resolveModelInfo)llm.resolveModelInfo=async()=>({reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}});
  return createPort({...args,agentDefaultModel:{currentSelection:()=>({provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off'})}});
}


async function fixture(toolUpdate='addition-only',register=true){
  const ctx=new Context();await ctx.plugin(LlmRuntime);let dispatches=0,lastOptions;
  class OfflineAdapter extends LlmAdapter{
    async resolveModel(provider,id){return {provider,id,name:id,...toolUpdate===null?{}:{toolUpdate},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
    async *stream(options){dispatches++;lastOptions=options;yield {type:'block-end',index:0,block:{type:'text',text:'Offline synthetic response'}};yield {type:'finish',reason:{kind:'stop'}};}
  }
  if(register)ctx.llm.registerAdapter(['deepseek-official'],new OfflineAdapter());
  return {ctx,dispatches:()=>dispatches,lastOptions:()=>lastOptions};
}
const options={provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',messages:[{role:'user',content:[{type:'text',text:'Synthetic'}]}],tools:[],maxTokens:128};

test('FORMAL DeepSeekAdapter + LlmRuntime OFFLINE: inherited DSH 12000 reaches Messages payload, SSE usage translated',async()=>{
  const ctx=new Context();await ctx.plugin(LlmRuntime);const originalFetch=globalThis.fetch;let request;
  const events=[{type:'message_start',message:{usage:{input_tokens:10}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Offline full response'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3000}},{type:'message_stop'}];
  globalThis.fetch=async(url,options)=>{request={url,body:JSON.parse(options.body)};return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});};
  const connection=resolveAdapterOptions({thinking:'disabled',reasoningEffort:'off',maxTokens:12000,baseURL:'https://api.deepseek.com/anthropic'});
  ctx.llm.registerAdapter(['deepseek-official'],new DeepSeekAdapter({options:()=>connection,resolveAuth:async()=>({headers:{Authorization:'Bearer SYNTHETIC_REDACTION_FIXTURE_000000'}}),resolveUserId:()=> 'scean-r2-offline',prepareExtensions:async()=>({fields:{},accept:async()=>{}})}));
  const ends=[];const usageLedger={async reserve(){return 'offline';},async settle(id,r){ends.push(r);}};
  try{
    const result=await createNativeModelPort({llm:ctx.llm,usageLedger}).generate({stage:'prose',system:'Offline',input:'Synthetic'});
    assert.equal(request.url,'https://api.deepseek.com/anthropic/v1/messages');assert.equal(request.body.max_tokens,12000);assert.equal(request.body.thinking.type,'disabled');assert.equal(result.route.outputBudget.sdkResolvedMaxTokens,12000);assert.equal(result.route.outputBudget.providerFinalMaxTokens,null);
    assert.equal(result.text,'Offline full response');assert.equal(result.usage.outputTokens,3000);assert.equal(ends[0].actualCostUsd,null);
  }finally{globalThis.fetch=originalFetch;await ctx.fiber.dispose();}
});

test('RP inherited DSH default permits complete output; context and journal have no price reservation',async()=>{
  const requests=[],starts=[],ends=[];
  const llm={async resolveModelInfo(){return {defaultMaxTokens:16000,reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};},async *stream(options){requests.push(options);yield {type:'block-end',index:0,block:{type:'text',text:'word '.repeat(3000)}};yield {type:'usage',usage:{inputTokens:40,outputTokens:3000}};yield {type:'finish',reason:{kind:'stop'}};}};
  const usageLedger={async reserve(r){starts.push(r);return 'id';},async settle(id,r){ends.push(r);}};
  const port=createNativeModelPort({llm,usageLedger});
  const r=await port.generate({stage:'prose',system:'Synthetic',input:'x',context:{runId:'r',attemptId:'a',requestId:'q'}});
  assert.equal(r.usage.outputTokens,3000);assert.equal(requests[0].maxTokens,16000);assert.equal(starts[0].meta.attemptId,'a');assert.equal(Object.hasOwn(starts[0],'maxCostUsd'),false);assert.equal(ends[0].actualCostUsd,null);
  await port.generate({stage:'director',system:'Synthetic',input:'x'});assert.equal(requests[1].maxTokens,16000);
});

test('R2 native truncation is a safe explicit failure, partial output never returned',async()=>{
  const ends=[];const budget={async reserve(){return 'id';},async settle(_id,r){ends.push(r);}};
  const llm={async *stream(){yield {type:'text-delta',index:0,text:'partial'};yield {type:'usage',usage:{outputTokens:2048}};yield {type:'finish',reason:{kind:'max-tokens',failure:{message:'SECRET'}}};}};
  const port=createNativeModelPort({llm,budget,maxTokens:2048});
  await assert.rejects(port.generate({stage:'prose',system:'x',input:'x'}),e=>e.code==='MODEL_OUTPUT_TRUNCATED'&&!e.message.includes('SECRET'));
  assert.equal(ends[0].status,'failed');assert.equal(ends[0].usage.outputTokens,2048);
});

test('R2 native provider exceptions omit raw message and do not auto retry',async()=>{
  let starts=0;const budget={async reserve(){starts++;return 'id';},async settle(){}};
  const port=createNativeModelPort({budget,llm:{async *stream(){throw new Error('secret-key-DO-NOT-LOG');}}});
  await assert.rejects(port.generate({stage:'prose',system:'x',input:'x'}),e=>e.code==='MODEL_TRANSPORT_ERROR'&&!e.message.includes('secret-key'));
  assert.equal(starts,1);
});

test('R2 native preserves canonical SDK failure code without raw provider message',async()=>{
  for(const code of ['AUTH','QUOTA','RATE_LIMIT','SERVER','TRANSPORT','MALFORMED_RESPONSE','HTTP_418']){
    const usageLedger={async reserve(){return 'id';},async settle(){}};
    const llm={async *stream(){yield {type:'finish',reason:{kind:'error',failure:{code,message:'Bearer PRIVATE_TOKEN'}}};}};
    await assert.rejects(createNativeModelPort({llm,usageLedger}).generate({stage:'prose',system:'x',input:'x'}),e=>e.code===code&&!e.message.includes('PRIVATE_TOKEN'));
  }
});

test('FORMAL SDK OFFLINE: legacy array toolHistory deterministically produces UNKNOWN before dispatch',async()=>{
  const f=await fixture();try{
    const chunks=[];for await(const chunk of f.ctx.llm.stream({...options,toolHistory:[]}))chunks.push(chunk);
    assert.equal(chunks.length,1);assert.equal(chunks[0].reason.kind,'error');assert.equal(chunks[0].reason.failure.code,'UNKNOWN');
    assert.match(chunks[0].reason.failure.message,/some/);assert.equal(f.dispatches(),0);
  }finally{await f.ctx.fiber.dispose();}
});
test('FORMAL SDK OFFLINE: absent provider yields NO_ADAPTER rather than UNKNOWN',async()=>{
  const f=await fixture('addition-only',false);try{
    const chunks=[];for await(const chunk of f.ctx.llm.stream(options))chunks.push(chunk);
    assert.equal(chunks[0].reason.failure.code,'NO_ADAPTER');assert.equal(f.dispatches(),0);
  }finally{await f.ctx.fiber.dispose();}
});
for(const mode of ['addition-only','in-history',null])test(`FORMAL SDK OFFLINE: native port reaches synthetic adapter with ${mode??'legacy'} tool mode`,async()=>{
  const f=await fixture(mode);const reservations=[],settlements=[];
  const budget={async reserve(request){reservations.push(request);return 'offline-only';},async settle(id,result){settlements.push({id,...result});}};
  try{
    const port=createNativeModelPort({llm:f.ctx.llm,budget,maxTokens:128});
    const result=await port.generate({stage:'director',system:'Synthetic contract test',input:{playerInput:'Water'},tools:[{type:'function',function:{name:'consult_character',description:'Synthetic',parameters:{type:'object',properties:{characterId:{type:'string'}}}}}]});
    assert.equal(result.text,'Offline synthetic response');assert.equal(f.dispatches(),1);
    assert.equal(f.lastOptions().tools[0].name,'consult_character');assert.equal(f.lastOptions().reasoningEffort,'off');
    assert.equal(reservations.length,1);assert.equal(settlements.length,1);assert.equal(settlements[0].status,'completed');
    assert.equal(Object.hasOwn(f.lastOptions(),'toolHistory'),false);
  }finally{await f.ctx.fiber.dispose();}
});

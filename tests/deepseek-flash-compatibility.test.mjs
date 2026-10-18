// Actual shipped adapter and LlmRuntime; all transport/auth data is a synthetic fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime} from '@deepseek-ai/dsh-llm';
import {DeepSeekAdapter,resolveAdapterOptions} from '@deepseek-ai/dsh-llm-deepseek';
import {createNativeModelPort} from '../plugin/native-model.mjs';

async function fixture(){
 const ctx=new Context();await ctx.plugin(LlmRuntime);let authCalls=0;
 const options=resolveAdapterOptions({baseURL:'https://api.deepseek.com/anthropic'});
 const adapter=new DeepSeekAdapter({options:()=>options,resolveAuth:async()=>{authCalls++;return {headers:{Authorization:'Bearer SYNTHETIC_COMPATIBILITY_ONLY'}};},resolveUserId:()=> 'compatibility-fixture',prepareExtensions:async()=>({fields:{},accept:async()=>{}})});
 ctx.llm.registerAdapter(['deepseek-official'],adapter);
 const ledger={async reserve(){return 'synthetic';},async settle(){}};
 const port=createNativeModelPort({llm:ctx.llm,usageLedger:ledger,selection:{provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off'}});
 return {ctx,port,authCalls:()=>authCalls};
}

test('shipped Flash alias capabilities resolve without authentication or network dispatch',async()=>{
 const f=await fixture();const oldFetch=globalThis.fetch;globalThis.fetch=()=>assert.fail('Capability lookup must not dispatch');
 try{
  const model=await f.ctx.llm.resolveModelInfo('deepseek-official','deepseek-flash');
  assert.equal(model.id,'deepseek-flash');assert.equal(model.context.contextWindow,1000000);
  assert.equal(model.defaultMaxTokens,256000);assert.equal(model.toolUpdate,'addition-only');assert.equal(model.systemPromptUpdate,'in-history');
  assert.deepEqual(model.reasoning.efforts.map(x=>x.id),['off','low','high','max']);
  const described=await f.port.describe({stage:'prose'});assert.equal(described.requested.model,'deepseek-flash');assert.equal(described.capabilities.outputLimit,8192);assert.equal(described.capabilities.contextWindow,1000000);
  assert.equal(f.authCalls(),0);
 }finally{globalThis.fetch=oldFetch;await f.ctx.fiber.dispose();}
});

test('native stable Flash alias reaches the real Messages adapter with stage limits and synthetic SSE',async()=>{
 const f=await fixture();const oldFetch=globalThis.fetch;const requests=[];
 const events=[{type:'message_start',message:{usage:{input_tokens:11}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Offline compatibility response'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}},{type:'message_stop'}];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/anthropic/v1/messages');requests.push(JSON.parse(options.body));return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});};
 try{
  for(const stage of ['director','prose']){
   const result=await f.port.generate({stage,system:'Synthetic compatibility contract',input:{synthetic:true},...(stage==='director'?{tools:[{name:'consult_character',description:'Synthetic tool',parameters:{type:'object',properties:{characterId:{type:'string'}}}}]}:{})});
   assert.equal(result.text,'Offline compatibility response');assert.equal(result.route.requested.model,'deepseek-flash');assert.equal(result.route.effective.model,'deepseek-flash');assert.equal(result.usage.outputTokens,3);
  }
  assert.deepEqual(requests.map(x=>x.model),['deepseek-flash','deepseek-flash']);assert.deepEqual(requests.map(x=>x.max_tokens),[4096,8192]);assert(requests.every(x=>x.thinking.type==='disabled'));
  assert.equal(requests[0].tools[0].name,'consult_character');assert.equal(f.authCalls(),2);
 }finally{globalThis.fetch=oldFetch;await f.ctx.fiber.dispose();}
});

test('unsupported reasoning remains rejected before provider dispatch',async()=>{
 const f=await fixture();const oldFetch=globalThis.fetch;globalThis.fetch=()=>assert.fail('Rejected reasoning must not dispatch');
 try{
  const port=createNativeModelPort({llm:f.ctx.llm,usageLedger:{async reserve(){assert.fail('No reservation');},async settle(){}},selection:{provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'unreviewed'}});
  await assert.rejects(port.generate({stage:'prose',system:'Synthetic',input:'Synthetic'}),{code:'UNSUPPORTED_REASONING_EFFORT'});assert.equal(f.authCalls(),0);
 }finally{globalThis.fetch=oldFetch;await f.ctx.fiber.dispose();}
});

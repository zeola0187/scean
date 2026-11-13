// Actual rc.3 adapter, synthetic event iterator only. No provider/auth network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installOutputDefaultGuard,methodHash} from './guard.mjs';
const sdk=process.env.SDK_ROOT??path.resolve(import.meta.dirname,'../..');
const {PiAiAdapter}=await import(pathToFileURL(path.join(sdk,'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')));
const pin=JSON.parse(await fs.readFile(new URL('./sdk-pin.json',import.meta.url)));
const zero={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const user={role:'user',content:[{type:'text',text:'Synthetic prefix'}]};
async function run({guarded,api='anthropic-messages',messages=[user],system='Synthetic system',manual=false}={}){
 const model={provider:'openrouter',id:'synthetic/rc3',name:'Synthetic',api,baseUrl:'https://offline.invalid',input:['text'],reasoning:manual,contextWindow:32768,maxTokens:4096,cost:zero.cost};
 const profile={modelErrors:new Map(),configuredMaxTokens:new Map(),headers:{},streamIdleTimeoutMs:1000,cacheRetention:'none'};
 const profiles=new Map([['openrouter',profile]]),captured=[],omitted=[];
 const adapter=new PiAiAdapter({profiles:()=>profiles,resolveApiKey:async()=> 'SYNTHETIC_ONLY',onThinkingOmitted:r=>omitted.push(r)});
 adapter.snapshot={profiles,models:{getModel:()=>model,async *streamSimple(m,context,options){
  captured.push({context:structuredClone(context),payload:await options.onPayload?.({max_tokens:4096,model:m.id})??{max_tokens:4096,model:m.id}});
  yield {type:'done',message:{role:'assistant',api,provider:m.provider,model:m.id,content:[{type:'thinking',thinking:'Synthetic reasoning',thinkingSignature:'synthetic-signature'},{type:'text',text:'OK'}],usage:zero,stopReason:'stop',timestamp:0}};
 }}};
 const handle=guarded?installOutputDefaultGuard(adapter,{expectedMethodHash:pin.adapterMethodSha256}):null;
 if(handle)assert(handle.active);
 const chunks=[];for await(const c of adapter.stream({provider:model.provider,model:model.id,system,messages,...manual?{reasoningEffort:'low'}:{}}))chunks.push(c);
 handle?.dispose();assert.equal(captured.length,1);assert.equal(chunks.at(-1).reason.kind,'stop');
 return {captured,omitted,replay:chunks.at(-1).replayState};
}
function assistant(replay){return {role:'assistant',content:[{type:'reasoning',text:'Synthetic reasoning'},{type:'text',text:'OK'}],source:{provider:'openrouter',model:'synthetic/rc3',replayState:replay}};}
test('rc.3 guard pins the changed method and refuses the previous rc.1 fingerprint',()=>{
 assert.equal(pin.sdkVersion,'0.2.2-rc.3');assert.equal(methodHash(PiAiAdapter.prototype.streamWithSnapshot),pin.adapterMethodSha256);
 const adapter=new PiAiAdapter({profiles:()=>new Map(),resolveApiKey:async()=> 'SYNTHETIC_ONLY'}),before=adapter.streamWithSnapshot;
 const refused=installOutputDefaultGuard(adapter,{expectedMethodHash:'b4a3fcd54df44e557cba3c5f76e7098e984322c0b614c217e87e9afd2fb41199'});
 assert.equal(refused.active,false);assert.equal(adapter.streamWithSnapshot,before);
});
test('rc.3 prefix digest and matching signed thinking survive guard wrapping unchanged',async()=>{
 const first=await run({guarded:false});assert.match(first.replay.response.prefixDigest,/^[a-f0-9]{64}$/);
 const messages=[user,assistant(first.replay),{role:'user',content:[{type:'text',text:'Continue synthetic'}]}];
 const original=await run({messages}),guarded=await run({messages,guarded:true});
 assert.deepEqual(guarded,original);assert.equal(original.omitted.length,0);
 assert.equal(original.captured[0].context.messages[1].content[0].thinkingSignature,'synthetic-signature');
});
test('rc.3 changed-prefix and legacy missing-digest omission remain SDK-owned and identical',async()=>{
 const first=await run({});
 for(const legacy of [false,true]){
  const replay=structuredClone(first.replay);if(legacy)delete replay.response.prefixDigest;
  const options={messages:[user,assistant(replay),{role:'user',content:[{type:'text',text:'Continue synthetic'}]}],system:legacy?'Synthetic system':'Changed synthetic system'};
  const original=await run(options),guarded=await run({...options,guarded:true});
  assert.deepEqual(guarded,original);assert.equal(original.omitted[0].count,1);
  assert.deepEqual(original.captured[0].context.messages[1].content,[{type:'text',text:'OK'}]);
 }
});
test('OpenRouter completions preserve rc.3 replay while only the implicit output field is removed',async()=>{
 const first=await run({api:'openai-completions'}),messages=[user,assistant(first.replay),{role:'user',content:[{type:'text',text:'Continue synthetic'}]}];
 const original=await run({api:'openai-completions',messages}),guarded=await run({api:'openai-completions',messages,guarded:true});
 assert.deepEqual(guarded.captured[0].context,original.captured[0].context);assert.deepEqual(guarded.replay,original.replay);
 assert.equal(original.captured[0].payload.max_tokens,4096);assert.deepEqual(guarded.captured[0].payload,{model:'synthetic/rc3'});
});

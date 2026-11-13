import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sdkRoot=process.env.SDK_ROOT??path.resolve(import.meta.dirname,'../..');
const loadSdk=name=>import(pathToFileURL(path.join(sdkRoot,'node_modules/@deepseek-ai',name,'lib/index.js')));
const {PiAiAdapter:Original}=await loadSdk('dsh-llm-pi-ai');
const adapterFile=await fs.realpath(path.join(sdkRoot,'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'));
const piRoot=path.resolve(path.dirname(adapterFile),'../../../@earendil-works/pi-ai/dist');
const {streamSimple}=await import(pathToFileURL(path.join(piRoot,'api/openai-completions.js')));
const {normalizeContext}=await import(pathToFileURL(path.join(piRoot,'utils/transcript.js')));
import {pathToFileURL} from 'node:url';
const reviewedHash='b4a3fcd54df44e557cba3c5f76e7098e984322c0b614c217e87e9afd2fb41199';
class Candidate extends Original {constructor(...args){super(...args);const h=installOutputDefaultGuard(this,{expectedMethodHash:reviewedHash});assert(h.active);}}
import {installOutputDefaultGuard,methodHash} from './guard.mjs';
import {activate,apply as applyBridge} from './index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const {Context}=await loadSdk('cordis');
const {LlmRuntime}=await loadSdk('dsh-llm');

const sdkPin=JSON.parse(await fs.readFile(new URL('./sdk-pin.json',import.meta.url),'utf8'));
assert.equal(methodHash(Original.prototype.streamWithSnapshot),sdkPin.adapterMethodSha256);
assert.equal(createHash('sha256').update(await fs.readFile(adapterFile)).digest('hex'),sdkPin.sdkModuleSha256);
console.log('SDK under test:',sdkRoot,'pi-ai',JSON.parse(await fs.readFile(path.join(piRoot,'../package.json'),'utf8')).version);
const hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const text='中文傳輸測試。'.repeat(30000);
const modelFor=provider=>({provider,id:'z-ai/glm-5.3',name:'Synthetic transport fixture',api:'openai-completions',baseUrl:'https://offline.invalid/v1',input:['text'],reasoning:false,contextWindow:1048576,maxTokens:943718,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsDeveloperRole:false,thinkingFormat:'openrouter',supportsStrictMode:true}});
function fixture(Adapter,{provider='openrouter',configuredMaxTokens,modelMaxTokens,oracleInput=182509}={}){
 const model={...modelFor(provider),...modelMaxTokens===undefined?{}:{maxTokens:modelMaxTokens}},calls=[];
 const profile={modelErrors:new Map(),configuredMaxTokens:new Map(configuredMaxTokens===undefined?[]:[[model.id,configuredMaxTokens]]),headers:{},streamIdleTimeoutMs:5000,cacheRetention:'none'};
 const profiles=new Map([[provider,profile]]);
 const fakeFetch=async(_url,init)=>{
  const payload=JSON.parse(init.body),limit=payload.max_completion_tokens??payload.max_tokens??8192;
  calls.push({payload,limit});
  if(oracleInput+limit>model.contextWindow)return new Response(JSON.stringify({error:{code:400,message:`This endpoint's maximum context length is ${model.contextWindow} tokens. However, you requested about ${oracleInput+limit} tokens (${oracleInput} in messages, ${limit} in completion).`}}),{status:400,headers:{'content-type':'application/json'}});
  const chunk=(delta,finish)=>({id:'synthetic-completion',object:'chat.completion.chunk',created:0,model:model.id,choices:[{index:0,delta,finish_reason:finish}]});
  const final={...chunk({},'stop'),usage:{prompt_tokens:oracleInput,completion_tokens:1,total_tokens:oracleInput+1}};
  const body=[chunk({role:'assistant',content:'OK'},null),final].map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n';
  return new Response(body,{status:200,headers:{'content-type':'text/event-stream'}});
 };
 const adapter=new Adapter({profiles:()=>profiles,resolveApiKey:async()=> 'synthetic-offline-only'});
 adapter.snapshot={profiles,models:{getModel:(p,id)=>p===provider&&id===model.id?model:undefined,streamSimple:(m,context,options)=>streamSimple(m,normalizeContext(context),{...options,fetch:fakeFetch,maxRetries:0})}};
 const options={provider,model:model.id,system:'Verify transport only. Reply OK.',messages:[{role:'user',content:[{type:'text',text}]}],tools:[]};
 return{adapter,calls,model,profile,profiles,options,async run(overrides={}){const chunks=[];for await(const c of adapter.stream({...options,...overrides}))chunks.push(c);return{chunks,finish:chunks.findLast(c=>c.type==='finish')?.reason};}};
}

test('new official SDK reproduces combined-context rejection; reviewed guard removes implicit output default',async()=>{
 const a=fixture(Original),b=fixture(Candidate),old=await a.run(),fixed=await b.run();
 assert.equal(old.finish.kind,'error');assert.equal(old.finish.failure.code,'CONTEXT_WINDOW_EXCEEDED');
 assert.equal(a.calls.length,1);assert.equal(a.calls[0].payload.max_completion_tokens,943718);
 assert.equal(fixed.finish.kind,'stop');assert.equal(b.calls.length,1);assert(!Object.hasOwn(b.calls[0].payload,'max_tokens'));assert(!Object.hasOwn(b.calls[0].payload,'max_completion_tokens'));
 assert.equal(hash(a.calls[0].payload.messages),hash(b.calls[0].payload.messages));assert.equal(hash(a.calls[0].payload.tools),hash(b.calls[0].payload.tools));
 assert.deepEqual(Object.fromEntries(Object.entries(a.calls[0].payload).filter(([k])=>!['max_tokens','max_completion_tokens'].includes(k))),b.calls[0].payload);
});

test('explicit output settings and existing background-stage limits are preserved exactly',async()=>{
 for(const limit of [2048,32768,131072]){
  const f=fixture(Candidate),r=await f.run({maxTokens:limit});assert.equal(r.finish.kind,'stop');assert.equal(f.calls.length,1);assert.equal(f.calls[0].payload.max_completion_tokens,limit);
 }
});

test('configured model default is preserved even for direct adapter callers',async()=>{
 const f=fixture(Candidate,{configuredMaxTokens:131072,modelMaxTokens:131072}),r=await f.run();
 assert.equal(r.finish.kind,'stop');assert.equal(f.calls[0].payload.max_completion_tokens,131072);
 const info=await f.adapter.resolveModel('openrouter',f.model.id);assert.equal(info.defaultMaxTokens,131072);
});

test('non-OpenRouter providers retain their previous default-output payload',async()=>{
 for(const provider of ['deepseek','custom-compatible']){
  const a=fixture(Original,{provider,modelMaxTokens:8192,oracleInput:500}),b=fixture(Candidate,{provider,modelMaxTokens:8192,oracleInput:500});
  assert.equal((await a.run()).finish.kind,'stop');assert.equal((await b.run()).finish.kind,'stop');assert.deepEqual(a.calls[0].payload,b.calls[0].payload);
 }
});

test('full system/user text and tool schemas are unchanged and no extra request is dispatched',async()=>{
 const tool={name:'check_status',description:'Read a synthetic status.',parameters:{type:'object',properties:{id:{type:'string'}},required:['id']}};
 const a=fixture(Original),b=fixture(Candidate);await a.run({tools:[tool]});const result=await b.run({tools:[tool]});
 assert.equal(result.finish.kind,'stop');assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);
 assert.deepEqual(a.calls[0].payload.messages,b.calls[0].payload.messages);assert.deepEqual(a.calls[0].payload.tools,b.calls[0].payload.tools);assert.equal(b.calls[0].payload.tools[0].function.name,'check_status');
});

test('prepared adapter handle keeps its captured configuration across later profile replacement',async()=>{
 const f=fixture(Candidate),prepared=await f.adapter.prepareCall('openrouter',f.model.id);
 f.adapter.config.profiles=()=>new Map([['openrouter',{...f.profile,configuredMaxTokens:new Map([[f.model.id,2048]])}]]);
 const chunks=[];for await(const c of prepared.stream(f.options))chunks.push(c);
 assert.equal(chunks.findLast(c=>c.type==='finish').reason.kind,'stop');assert.equal(f.calls.length,1);assert(!Object.hasOwn(f.calls[0].payload,'max_completion_tokens'));
});

test('explicit overflowing limits still fail once; candidate does not conceal the provider rejection or automatically retry',async()=>{
 const f=fixture(Candidate),r=await f.run({maxTokens:943718});assert.equal(r.finish.kind,'error');assert.equal(r.finish.failure.code,'CONTEXT_WINDOW_EXCEEDED');assert.equal(f.calls.length,1);
});

test('reversible instance guard matches the SDK source candidate without changing catalog, input, credentials, or the shared model collection',async()=>{
 const f=fixture(Original),before=f.adapter.streamWithSnapshot,models=f.adapter.snapshot.models,stream=models.streamSimple,omissions=[];
 const guard=installOutputDefaultGuard(f.adapter,{expectedMethodHash:methodHash(before),onOmission:r=>omissions.push(r)});
 assert(guard.active);assert.equal((await f.run()).finish.kind,'stop');assert.equal(f.calls.length,1);assert(!Object.hasOwn(f.calls[0].payload,'max_completion_tokens'));
 assert.equal(models.streamSimple,stream);assert.equal(f.adapter.snapshot.models,models);assert.deepEqual(omissions,[{provider:'openrouter',model:f.model.id,removedMaxTokens:943718}]);
 guard.dispose();assert.equal(f.adapter.streamWithSnapshot,before);assert(!Object.hasOwn(f.adapter,'streamWithSnapshot'));
 assert.equal((await f.run()).finish.failure.code,'CONTEXT_WINDOW_EXCEEDED');
});

test('instance guard preserves explicit/default limits, other providers, and rejects unknown SDK method fingerprints',async()=>{
 for(const settings of [{provider:'deepseek',modelMaxTokens:8192,oracleInput:500},{configuredMaxTokens:131072,modelMaxTokens:131072},{}]){
  const f=fixture(Original,settings),original=f.adapter.streamWithSnapshot,guard=installOutputDefaultGuard(f.adapter,{expectedMethodHash:methodHash(original)});
  const r=await f.run(settings.provider||settings.configuredMaxTokens?{}:{maxTokens:2048});assert.equal(r.finish.kind,'stop');assert(f.calls[0].payload.max_tokens||f.calls[0].payload.max_completion_tokens);guard.dispose();
 }
 const f=fixture(Original),before=f.adapter.streamWithSnapshot,bad=installOutputDefaultGuard(f.adapter,{expectedMethodHash:'unknown'});assert.equal(bad.active,false);assert.equal(f.adapter.streamWithSnapshot,before);
});

test('guard disposal never overwrites a later SDK or plugin replacement',()=>{
 const f=fixture(Original),guard=installOutputDefaultGuard(f.adapter,{expectedMethodHash:methodHash(f.adapter.streamWithSnapshot)}),replacement=()=>{};
 f.adapter.streamWithSnapshot=replacement;guard.dispose();assert.equal(f.adapter.streamWithSnapshot,replacement);
});

async function addonFixture(t,options={}){
 const base=path.join(import.meta.dirname,'.test-addon');await fs.mkdir(base,{recursive:true});const home=await fs.mkdtemp(path.join(base,'case-'));
 const prior=process.env.DSH_HOME;process.env.DSH_HOME=home;t.after(()=>{if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;});
 const f=fixture(Original,options),events=new Map();
 const ctx={llm:{registration:()=>({adapter:f.adapter}),resolveModelInfo:(p,id)=>f.adapter.resolveModel(p,id),stream:o=>f.adapter.stream(o)},on:(event,fn)=>events.set(event,fn)};
 return{...f,home,ctx,events};
}
test('addon activates on the actual registered adapter, runs one synthetic check, and never repeats it after restart',async t=>{
 const f=await addonFixture(t),before=f.adapter.streamWithSnapshot,handle=await activate(f.ctx,{verifyOnce:'offline-proof'}),result=await handle.waitForVerification();
 assert.equal(result.status,'passed');assert.equal(result.storyRunUsed,false);assert.equal(result.automaticRetries,0);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].payload.messages.at(-1).content,'Confirm the transport is working. Reply OK.');
 assert(!Object.hasOwn(f.calls[0].payload,'max_completion_tokens'));f.events.get('llm/adapters-updated')();await handle.waitForVerification();assert.equal(f.calls.length,1);
 await handle.dispose();assert.equal(f.adapter.streamWithSnapshot,before);
 const restarted=await activate(f.ctx,{verifyOnce:'offline-proof'}),old=await restarted.waitForVerification();assert.equal(old.status,'passed');assert.equal(f.calls.length,1);await restarted.dispose();
});

test('a failed synthetic verification is durably recorded without a retry or story mutation',async t=>{
 const f=await addonFixture(t,{oracleInput:1048577}),h=await activate(f.ctx,{verifyOnce:'offline-failure'}),r=await h.waitForVerification();
 assert.equal(r.status,'failed');assert.equal(r.failureCode,'CONTEXT_WINDOW_EXCEEDED');assert.equal(f.calls.length,1);await h.dispose();
 const next=await activate(f.ctx,{verifyOnce:'offline-failure'});await next.waitForVerification();assert.equal(f.calls.length,1);await next.dispose();
});

test('unknown SDK method leaves the provider untouched and never admits a verification call',async t=>{
 const f=await addonFixture(t);f.adapter.streamWithSnapshot=function(){throw Error('Do not call unknown SDK');};const before=f.adapter.streamWithSnapshot;
 const h=await activate(f.ctx,{verifyOnce:'offline-unknown'});assert.equal(await h.waitForVerification(),null);assert.equal(f.calls.length,0);assert.equal(f.adapter.streamWithSnapshot,before);await h.dispose();
});

test('real Cordis and LlmRuntime registration admit the addon and exactly one synthetic SDK stream',async t=>{
 const f=await addonFixture(t),ctx=new Context();await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter(['openrouter'],f.adapter);
 assert.equal(ctx.llm.registration('openrouter').adapter,f.adapter);
 const handle=await activate(ctx,{verifyOnce:'real-context-proof'}),r=await handle.waitForVerification();
 assert.equal(r.status,'passed');assert.equal(f.calls.length,1);assert.equal(r.storyRunUsed,false);await handle.dispose();await ctx.fiber.dispose();
});

test('normal Cordis plugin loading and disposal preserve the actual adapter and one-time verification',async t=>{
 const f=await addonFixture(t),ctx=new Context();t.after(()=>ctx.fiber.dispose());await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter(['openrouter'],f.adapter);const original=f.adapter.streamWithSnapshot;
 await ctx.plugin({name:'transport-guard-fixture',inject:['llm'],apply:applyBridge},{verifyOnce:'plugin-lifecycle-proof'});
 const target=path.join(f.home,'scean-openrouter-output-default/verification-plugin-lifecycle-proof.json');let receipt;
 for(let i=0;i<300;i++){try{receipt=JSON.parse(await fs.readFile(target,'utf8'));if(['passed','failed'].includes(receipt.status))break;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}await new Promise(r=>setTimeout(r,5));}
 assert.equal(receipt?.status,'passed');assert.equal(f.calls.length,1);await ctx.fiber.dispose();await new Promise(r=>setImmediate(r));assert.equal(f.adapter.streamWithSnapshot,original);
});

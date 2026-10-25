// Actual shipped SDK and deterministic transports only. No credentials or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,LlmAdapter,LlmError} from '@deepseek-ai/dsh-llm';
import {createNativeModelPort} from '../plugin/native-model.mjs';
import {RP_MODEL_STAGES} from '../core/contracts.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {publicInspection} from '../core/inspection.mjs';
import {createHistoryFixture} from '../fixtures/synthetic-history-c.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function sdkFixture(t,portOptions={}){
  const ctx=new Context();await ctx.plugin(LlmRuntime);t.after(()=>ctx.fiber.dispose());
  const settings=new Map([['a',{maxTokens:12000,efforts:['off','low'],effort:'low',contextWindow:65536}],['b',{maxTokens:24000,efforts:['off','high'],effort:'high',contextWindow:131072}]]);
  const proposals=[],calls=[],reserves=[],settles=[],traces=[];let current={provider:'offline-a',model:'a'},active;
  const f={settings,proposals,calls,reserves,settles,traces,ctx,beforeReserve:null,handler:async()=>({text:'Synthetic complete response'}),setCurrent:value=>{current=value;},save:(id,value)=>settings.set(id,{...settings.get(id),...value})};
  const modelInfo=(provider,id,s)=>({provider,id,name:id,context:{contextWindow:s.contextWindow},...s.maxTokens===undefined?{}:{defaultMaxTokens:s.maxTokens},reasoning:{efforts:s.efforts.map(id=>({id,name:id})),defaultEffort:s.effort}});
  class Adapter extends LlmAdapter{
    async resolveModel(provider,id){return modelInfo(provider,id,settings.get(id));}
    async prepareCall(provider,id){
      const captured=structuredClone(settings.get(id));
      return {model:modelInfo(provider,id,captured),stream:async function*(options){
        calls.push({options,captured});const reply=await f.handler(active,options,captured);
        for(const call of reply.toolCalls??[])yield {type:'block-end',index:0,block:{type:'tool-call',id:call.id,name:call.name,arguments:JSON.stringify(call.arguments)}};
        if(reply.text)yield {type:'block-end',index:1,block:{type:'text',text:reply.text}};
        yield {type:'usage',usage:reply.usage??{inputTokens:6,outputTokens:4,totalTokens:10}};
        yield {type:'finish',reason:{kind:reply.finishKind??(reply.toolCalls?.length?'tool-calls':'stop')}};
      }};
    }
  }
  ctx.llm.registerAdapter(['offline-a','offline-b'],new Adapter());
  const llm={resolveModelInfo:(...args)=>ctx.llm.resolveModelInfo(...args),stream:(...args)=>ctx.llm.stream(...args),prepareCall:(config,...args)=>{proposals.push(structuredClone(config));return ctx.llm.prepareCall(config,...args);}};
  const ledger={async reserve(row){reserves.push(row);await f.beforeReserve?.();return 'offline-'+reserves.length;},async settle(id,row){settles.push({id,...row});}};
  const port=createNativeModelPort({llm,agentDefaultModel:{currentSelection:()=>({...current})},usageLedger:ledger,onTrace:row=>traces.push(row),...portOptions});
  f.port=port;f.run=async(stage,extra={})=>{active={stage,system:'Synthetic system',input:'Synthetic input',...extra};return port.generate(active);};
  f.enginePort={describe:(...args)=>port.describe(...args),generate:request=>{active=request;return port.generate(request);}};
  return f;
}

test('all RP paths, including Writer and local repair, omit former plugin/stage caps and inherit the exact prepared SDK value',async t=>{
  const f=await sdkFixture(t,{maxTokens:99,stageMaxTokens:{director:101,character:102,adjudicate:103,draft:104,prose:105,post_stat:106,writer:107,writer_repair:108}});
  assert.deepEqual(RP_MODEL_STAGES,['director','character','adjudicate','draft','prose','prose_repair','writer','writer_repair','post_stat']);
  for(const stage of RP_MODEL_STAGES){const r=await f.run(stage);assert.equal(r.route.effective.maxTokens,12000,stage);assert.equal(r.route.outputBudget.sdkResolvedMaxTokens,12000);assert.equal(r.route.outputBudget.adapterDefaultApplied,true);assert.equal(r.route.outputBudget.snapshotBound,true);assert.equal(r.route.outputBudget.policy,'dsh_rp_inheritance');assert.equal(r.attempts[0].finishKind,'stop');}
  assert(f.proposals.every(p=>!Object.hasOwn(p,'maxTokens')));assert(f.calls.every(c=>c.options.maxTokens===12000&&c.options.reasoningEffort==='low'));assert.equal(f.reserves.length,RP_MODEL_STAGES.length);
});

test('saving DSH model defaults affects the next request and description, without reconstructing the port',async t=>{
  const f=await sdkFixture(t);assert.equal((await f.port.describe()).capabilities.outputLimit,12000);
  await f.run('post_stat');f.save('a',{maxTokens:20000});assert.equal((await f.port.describe()).capabilities.outputLimit,20000);
  const next=await f.run('post_stat');assert.equal(next.route.effective.maxTokens,20000);assert.deepEqual(f.calls.map(c=>c.options.maxTokens),[12000,20000]);
});

test('an already prepared request keeps its route/defaults while a later call follows new DSH settings',async t=>{
  const f=await sdkFixture(t),entered=deferred(),release=deferred();
  f.beforeReserve=async()=>{entered.resolve();await release.promise;};
  const pending=f.run('draft');await entered.promise;f.save('a',{maxTokens:40000});f.setCurrent({provider:'offline-b',model:'b',reasoningEffort:'high'});release.resolve();
  const first=await pending;assert.equal(first.route.effective.model,'a');assert.equal(first.route.effective.maxTokens,12000);assert.equal(f.calls[0].captured.maxTokens,12000);
  f.beforeReserve=null;const second=await f.run('draft');assert.equal(second.route.effective.model,'b');assert.equal(second.route.effective.maxTokens,24000);assert.equal(second.route.effective.reasoningEffort,'high');
});

test('provider reasoning validation stays SDK-owned; unsupported explicit effort never reserves or dispatches',async t=>{
  const f=await sdkFixture(t);f.setCurrent({provider:'offline-a',model:'a',reasoningEffort:'high'});
  await assert.rejects(f.run('director'),{code:'UNSUPPORTED_REASONING_EFFORT'});assert.equal(f.reserves.length,0);assert.equal(f.calls.length,0);
  f.setCurrent({provider:'offline-b',model:'b'});const r=await f.run('director');assert.equal(r.route.effective.reasoningEffort,'high');assert.equal(r.route.parameterSource.reasoningEffort,'dsh_model_default');
});

test('undisclosed output capacity stays omitted/unknown through the real SDK, without resurrecting 4096',async t=>{
  const f=await sdkFixture(t);f.save('a',{maxTokens:undefined});const d=await f.port.describe({stage:'prose'});assert.equal(d.capabilities.outputLimit,null);assert.equal(d.capabilities.outputLimitSource,'adapter_default_unknown');
  const r=await f.run('prose');assert(!Object.hasOwn(f.proposals[0],'maxTokens'));assert(!Object.hasOwn(f.calls[0].options,'maxTokens'));assert.equal(r.route.effective.maxTokens,null);assert.equal(r.route.outputBudget.providerFinalMaxTokens,null);assert.equal(f.reserves[0].meta.maxTokens,null);
});

test('native chapter/summary/rerank default and configured budgets are unchanged despite larger DSH settings',async t=>{
  const defaults=await sdkFixture(t),configured=await sdkFixture(t,{maxTokens:2000,stageMaxTokens:{chapter_rerank:512}});
  for(const stage of ['summary','chapter_analysis','chapter_summary','chapter_rerank']){
    assert.equal((await defaults.run(stage)).route.effective.maxTokens,4096,stage);
    assert.equal((await configured.run(stage)).route.effective.maxTokens,stage==='chapter_rerank'?512:2000,stage);
  }
  assert(defaults.proposals.every(p=>p.maxTokens===4096));assert.equal((await configured.run('director')).route.effective.maxTokens,12000);
});

test('invalid SDK output metadata fails before reserve/dispatch rather than inventing a fallback',async t=>{
  const f=await sdkFixture(t);f.save('a',{maxTokens:-1});
  await assert.rejects(f.port.describe(),{code:'INVALID_MODEL_MAX_TOKENS'});
  await assert.rejects(f.run('prose'),{code:'INVALID_MODEL_MAX_TOKENS'});
  assert.equal(f.calls.length,0);assert.equal(f.reserves.length,0);
});

test('SDK-resolved cap is not falsely labelled as the provider final wire ceiling; private metadata is discarded',async t=>{
  const f=await sdkFixture(t);let privateWireLimit;f.handler=async(_request,options)=>{privateWireLimit=Math.min(options.maxTokens,700);return {text:'Complete after an adapter-side adjustment',usage:{inputTokens:10,outputTokens:privateWireLimit,totalTokens:10+privateWireLimit}};};
  const r=await f.run('prose');assert.equal(r.route.outputBudget.sdkResolvedMaxTokens,12000);assert.equal(r.route.outputBudget.providerFinalMaxTokens,null);assert.equal(r.route.outputBudget.providerFinalSource,'not_exposed_by_sdk');
  assert.equal(privateWireLimit,700);assert.equal(r.usage.outputTokens,700);
  assert(!JSON.stringify([r,f.reserves,f.settles,f.traces]).includes('PRIVATE_'));
});

test('truncation preserves safe finish/usage but never returns partial output or technically retries',async t=>{
  const f=await sdkFixture(t,{technicalRetries:1});f.handler=async()=>({text:'PRIVATE_INCOMPLETE_JSON',finishKind:'max-tokens',usage:{inputTokens:7,outputTokens:12000,totalTokens:12007}});
  await assert.rejects(f.run('post_stat'),e=>{assert.equal(e.code,'MODEL_OUTPUT_TRUNCATED');assert.equal(e.attempts[0].finishKind,'max-tokens');assert.equal(e.attempts[0].usage.outputTokens,12000);assert.equal(e.attempts[0].route.outputBudget.sdkResolvedMaxTokens,12000);assert(!JSON.stringify(e.attempts).includes('PRIVATE_'));return true;});
  assert.equal(f.calls.length,1);assert.equal(f.settles[0].status,'failed');
});

test('provider hard-context failure remains a single rejected dispatch with no invented quota',async t=>{
  const f=await sdkFixture(t,{technicalRetries:1});f.handler=async()=>{throw new LlmError('PRIVATE_PROVIDER_BODY','CONTEXT_WINDOW_EXCEEDED');};
  await assert.rejects(f.run('director'),e=>e.code==='CONTEXT_WINDOW_EXCEEDED'&&!e.message.includes('PRIVATE_'));assert.equal(f.calls.length,1);assert.equal(f.settles[0].status,'failed');
});

test('isolated Core/Store flow reconciles changed prepared budgets on failure and success without committing truncation',async t=>{
  const temporary=fileURLToPath(new URL('../evidence/rp-output-inheritance/',import.meta.url));await mkdir(temporary,{recursive:true});
  const f=await sdkFixture(t),history=await createHistoryFixture({root:await mkdtemp(temporary+'history-')}),oracle=history.model;let fail=true;
  f.handler=async request=>request.stage==='post_stat'&&fail?{text:'PRIVATE_PARTIAL_STATE',finishKind:'max-tokens',usage:{inputTokens:8,outputTokens:18000,totalTokens:18008}}:oracle.generate(request);
  const originalDescribe=f.enginePort.describe;f.enginePort.describe=async args=>{const result=await originalDescribe(args);if(args.stage==='post_stat')f.save('a',{maxTokens:18000});return result;};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store:history.store,model:f.enginePort,memory:history.memory}),before=await history.store.read(history.run.runId);
  await assert.rejects(engine.turn({runId:history.run.runId,requestId:'truncated-state',input:'Synthetic offline continuation'}),{code:'MODEL_OUTPUT_TRUNCATED'});
  assert.deepEqual(await history.store.read(history.run.runId),before);
  const failed=(await history.store.readAttempts(history.run.runId)).at(-1).stages.at(-1);assert.equal(failed.stage,'post_stat');assert.equal(failed.contextBudget.outputReserve,18000);assert.equal(failed.contextBudget.outputReservePhase,'sdk_prepared');assert.equal(failed.contextBudget.sdkFinishKind,'max-tokens');assert.equal(failed.contextBudget.actualUsage.outputTokens,18000);assert.equal(failed.contextBudget.providerFinalOutputReserve,null);
  const projected=publicInspection(await engine.inspect(history.run.runId));assert(!JSON.stringify(projected).includes('PRIVATE_PARTIAL_STATE'));assert(!JSON.stringify(projected).includes('SYNTHETIC_KALT_PRIVATE_CALIBRATION'));
  fail=false;const result=await engine.turn({runId:history.run.runId,requestId:'complete-state',input:'Synthetic offline continuation'});assert.equal(result.version,1);const completed=(await history.store.readAttempts(history.run.runId)).find(a=>a.attemptId===result.trace.attemptId),postStat=completed.stages.find(s=>s.stage==='post_stat');assert.equal(postStat.contextBudget.outputReserve,18000);assert.equal(postStat.contextBudget.sdkFinishKind,'stop');
  assert.deepEqual((await history.store.read(history.run.runId)).snapshot,before.snapshot);
});

test('Single Writer runs the complete scheduler through the actual SDK port with three inherited dispatches',async t=>{
  const temporary=fileURLToPath(new URL('../evidence/rp-output-inheritance/',import.meta.url));await mkdir(temporary,{recursive:true});
  const f=await sdkFixture(t),history=await createHistoryFixture({root:await mkdtemp(temporary+'single-')}),seen=[];
  f.handler=async request=>{seen.push({stage:request.stage,input:structuredClone(request.input)});if(request.stage==='director')return {text:JSON.stringify({handoffVersion:1,sceneIntent:'An ordinary supported exchange.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]})};if(request.stage==='writer')return {text:'A synthetic character waits beside the workbench.'};if(request.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};assert.fail('Unexpected fixed or supplemental stage '+request.stage);};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store:history.store,model:f.enginePort,memory:history.memory});await engine.updateWritingMode({runId:history.run.runId,mode:'single_writer',expectedRevision:0,operationId:'single-sdk'});
  const result=await engine.turn({runId:history.run.runId,requestId:'single-sdk',input:'Synthetic ordinary continuation'});
  assert.deepEqual(seen.map(x=>x.stage),['director','writer','post_stat']);assert.equal(f.reserves.length,3);assert.equal(f.settles.length,3);assert(f.calls.every(x=>x.options.maxTokens===12000&&x.options.reasoningEffort==='low'));assert.equal(seen[1].input.writingSkill.id,'single-writer');
  const attempt=(await engine.inspect(history.run.runId)).attempts.at(-1),writer=attempt.stages.find(x=>x.stage==='writer');assert.deepEqual(writer.prompt.input,seen[1].input);assert.equal(writer.contextBudget.outputSnapshotBound,true);assert.equal(writer.contextBudget.outputReserve,12000);assert.equal(result.body,seen[2].input.finalBody);assert.equal(attempt.stages.find(x=>x.stage==='validation').modelCall,false);
});

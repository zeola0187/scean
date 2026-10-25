import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,LlmAdapter,LlmError} from '@deepseek-ai/dsh-llm';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {modelPreferences,readModelSettings} from '../core/model-routing.mjs';
import {AgentModelRouting} from '../plugin/agent-models.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {characterAdviceOutputContract} from '../core/character-advice.mjs';
import {generatePlayerIdeas,IDEA_CATEGORIES} from '../core/player-ideas.mjs';
import {configuredChapterPorts} from '../adapters/chapter-providers.mjs';
import {updateSummary,closeChapter} from '../core/narrative.mjs';
import {backfillChapterSummary} from '../core/chapter-summary.mjs';

const selection=model=>({provider:model==='a'?'route-a':'route-b',model});

test('integrated routed Single Writer preserves strict handoff, same-call annotations and final commit identity after tools',async t=>{
 const f=await setup(t,{single:true});f.withTools=true;const body='Alpha says "Ready."';
 f.reply=(stage,input)=>stage==='director'?JSON.stringify(input.handoffContract.example):stage==='writer'?JSON.stringify({sceanWriter:1,finalBody:body,dialogue:[{kind:'speech',speakerId:'alpha',text:'"Ready."'}]}):undefined;
 await f.save({director:selection('a'),character:selection('b'),writer:selection('c'),stat:selection('b')});const result=await f.turn();
 assert.deepEqual(f.calls.map(c=>[c.stage,c.model]),[['director','a'],['character','b'],['character','b'],['adjudicate','b'],['director','a'],['writer','c'],['post_stat','b']]);
 const d=f.calls.filter(c=>c.stage==='director').at(-1),w=f.calls.find(c=>c.stage==='writer'),post=f.calls.at(-1),run=await f.store.read(f.run.runId),turn=run.turns[0],attempt=(await f.store.readAttempts(run.runId))[0];
 assert(!Object.hasOwn(d.input.handoffContract,'statement'));assert.equal(d.input.handoffContract.schema.additionalProperties,false);assert(d.input.handoffContract.example.knownFacts.length);assert(w.input.outputContract.schema.required.includes('dialogue'));assert.equal(result.body,body);assert.equal(post.input.finalBody,body);assert.equal(post.input.bodyHash,turn.bodyHash);assert.equal(turn.dialoguePresentation.bodyHash,turn.bodyHash);assert.equal(turn.dialoguePresentation.commitId,result.commitId);assert.equal(attempt.dialoguePresentation.status,'accepted');
 assert(!JSON.stringify(w.input).includes('OWNER_CANARY_'));assert(!Object.hasOwn(post.input,'dialogue'));assert.equal(f.calls.filter(c=>c.stage==='writer').length,1);
});
test('integrated routed annotation omission degrades once and same request never switches models or regenerates a committed body',async t=>{
 const f=await setup(t,{single:true});await f.save({writer:selection('b'),stat:selection('c')});const result=await f.turn();const attempt=(await f.store.readAttempts(f.run.runId))[0];assert.equal(attempt.dialoguePresentation.status,'not_provided');assert.deepEqual(f.calls.map(c=>[c.stage,c.model]),[['director','a'],['writer','b'],['post_stat','c']]);
 await f.save({writer:selection('c')});const count=f.calls.length;assert.deepEqual(await f.turn(),result);assert.equal(f.calls.length,count);assert.equal((await f.store.read(f.run.runId)).turns.length,1);
});
test('integrated routed invalid Director field reports a safe path before Writer without another generation',async t=>{
 const f=await setup(t,{single:true});await f.save({director:selection('b'),writer:selection('c')});f.reply=(stage,input)=>stage==='director'?JSON.stringify({...input.handoffContract.example,statement:{text:'Unallowed.',sourceRefs:['input']}}):undefined;
 await assert.rejects(f.turn(),e=>e.code==='WRITER_HANDOFF_INVALID'&&e.validation.path==='/statement');assert.deepEqual(f.calls.map(c=>[c.stage,c.model]),[['director','b']]);assert.equal(f.reserves.length,1);assert.equal(f.settles.length,1);assert.equal((await f.store.read(f.run.runId)).turns.length,0);
});
const snapshot=()=>({schemaVersion:1,cardId:'routing-fixture',revision:1,card:{name:'Synthetic routing'},worldbook:{entries:[]},preset:{},characters:['alpha','beta'].map(id=>({id,name:'Same visible name',description:'Actor '+id,private:{secret:'OWNER_CANARY_'+id}}))});
const handoff=()=>JSON.stringify({handoffVersion:1,sceneIntent:'Synthetic continuation',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]});
async function setup(t,{single=false,technicalRetries=0}={}){
 const base=path.resolve('.test-temp/routing');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'case-'));
 const ctx=new Context();await ctx.plugin(LlmRuntime);t.after(()=>ctx.fiber.dispose());
 const f={root,ctx,calls:[],reserves:[],settles:[],current:selection('a'),catalog:new Set(['a','b','c']),hook:null,failStage:null,withTools:false,epoch:0,chapter:{mode:'legacy',revision:0},defaults:12000};let active;
 class Adapter extends LlmAdapter{
  providerInfo(id){return{id,name:id};}
  async listModels(provider){return [...f.catalog].filter(id=>(id==='a')===(provider==='route-a')).map(id=>({provider,id,name:'Synthetic '+id,apiKey:'SECRET_CATALOG_CANARY'}));}
  async resolveModel(provider,id){if(f.infoError)throw new LlmError('PRIVATE_CONFIG_BODY',f.infoError);if(!f.catalog.has(id))throw new LlmError('PRIVATE_UNKNOWN','UNKNOWN_MODEL');return {provider,id,name:id,context:{contextWindow:1000000},defaultMaxTokens:f.defaults,reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}};}
  async *stream(o){const stage=active.stage,input=active.input;f.calls.push({stage,provider:o.provider,model:o.model,maxTokens:o.maxTokens,system:o.system,input:structuredClone(input),frozen:Object.isFrozen(o)&&Object.isFrozen(o.messages)});await f.hook?.(stage,o);
   if(f.failStage===stage){f.failStage=null;throw new LlmError('PRIVATE_FAILURE','SERVER');}
   let answer='Synthetic complete prose.',tools=[];
   if(stage==='director'){if(f.withTools&&!input.conversation.length)tools=['alpha','beta'].map(id=>({id:'ask-'+id,name:'consult_character',arguments:{characterId:id,question:'Consult '+id}})).concat({id:'ask-stat',name:'adjudicate_action',arguments:{action:'Wait',mode:'query'}});else if(input.handoffContract)answer=handoff();}
   if(stage==='character')answer=JSON.stringify(characterAdviceOutputContract(input.character.id).example);
   if(stage==='post_stat')answer=JSON.stringify({contractVersion:2,stateChanges:[],memories:[]});
   if(stage==='ideas')answer=JSON.stringify({ideas:IDEA_CATEGORIES.map((category,i)=>({category,text:'Idea '+i}))});
   if(stage==='chapter_rerank')answer=JSON.stringify({rankings:[]});
   if(['writer_repair','prose_repair'].includes(stage))answer=JSON.stringify({bodyHash:input.bodyHash,edits:input.ranges.map(r=>({start:r.start,end:r.end,replacement:'Invented'}))});
   if(f.reply)answer=await f.reply(stage,input)??answer;
   yield{type:'block-end',index:0,block:{type:'text',text:tools.length?'':answer}};
   for(const [i,tool]of tools.entries())yield{type:'block-end',index:i+1,block:{type:'tool-call',...tool,arguments:JSON.stringify(tool.arguments)}};
   yield{type:'usage',usage:{inputTokens:10,outputTokens:5,totalTokens:15}};yield{type:'finish',reason:{kind:tools.length?'tool-calls':'stop'}};
  }
 }
 f.registration=ctx.llm.registerAdapter(['route-a','route-b'],new Adapter());
 f.store=new DurableStore({root:path.join(root,'store')});
 f.routing=new AgentModelRouting({llm:ctx.llm,agentDefaultModel:{currentSelection:()=>f.current},store:f.store,chapterSelection:()=>f.chapter});
 ctx.on('llm/adapters-updated',()=>{f.routing.epoch++;});
 const port=createNativeModelPort({llm:ctx.llm,agentDefaultModel:{currentSelection:()=>f.current},routing:f.routing,technicalRetries,usageLedger:{async reserve(r){f.reserves.push(structuredClone(r));await f.beforeReserve?.();return 'r-'+f.reserves.length;},async settle(id,r){f.settles.push({id,...r});}}});
 f.model={...port,generate:args=>{active=args;return port.generate(args);}};
 f.engine=new SceanEngine({store:f.store,model:f.model,memory:new Memory(),unconfiguredWritingMode:single?'single_writer':'current'});
 f.run=await f.engine.createRun({snapshot:snapshot()});
 f.save=async(roles,scope='@global',extra={})=>{const current=await readModelSettings(f.store,scope);return f.routing.save({scope,roles:modelPreferences(roles),expectedRevision:current.revision,operationId:'save-'+(scope==='@global'?'global':scope)+'-'+current.revision,...extra});};
 f.turn=(requestId='turn-a')=>f.engine.turn({runId:f.run.runId,requestId,input:'Consult the synthetic actors.'});
 return f;
}
test('catalog/save/reload expose only existing routes; no generation, keys or canonical mutation',async t=>{
 const f=await setup(t),before=await fs.readFile(f.store.currentFile(f.run.runId));const catalog=await f.routing.catalog();assert.equal(catalog.providers.length,2);assert(!JSON.stringify(catalog).includes('SECRET_'));
 await f.save({writer:selection('b')});await f.save({stat:selection('c')},f.run.runId);const status=await f.routing.status(f.run.runId);assert.equal(status.effective.writer.model,'b');assert.equal(status.effective.stat.model,'c');assert.equal(status.effective.character.model,'a');assert.equal(status.settings.revision,1);assert.deepEqual(await fs.readFile(f.store.currentFile(f.run.runId)),before);assert.equal(f.calls.length,0);assert.equal(f.reserves.length,0);
 const reloaded=new AgentModelRouting({llm:f.ctx.llm,store:f.store,agentDefaultModel:{currentSelection:()=>f.current}});assert.equal((await reloaded.status(f.run.runId)).settings.roles.stat.model,'c');
});
test('revision, idempotency, field validation and unavailable catalog fail before provider dispatch',async t=>{
 const f=await setup(t);const saved=await f.save({writer:selection('b')});f.catalog.delete('b');assert.deepEqual(await f.routing.save({scope:'@global',roles:modelPreferences({writer:selection('b')}),expectedRevision:0,operationId:saved.operationId}),saved);
 await assert.rejects(f.routing.save({scope:'@global',roles:{},expectedRevision:0,operationId:'stale'}),{code:'VERSION_CONFLICT'});
 await assert.rejects(f.save({writer:selection('b')}),{code:'UNKNOWN_MODEL'});await assert.rejects(f.save({writer:{provider:'missing',model:'a'}}),{code:'NO_ADAPTER'});assert.throws(()=>modelPreferences({provider:'forbidden'}));assert.equal(f.calls.length,0);
});
test('four Agent roles route separately; multiple characters share the Character route and private packets stay isolated',async t=>{
 const f=await setup(t);f.withTools=true;await f.save({director:selection('a'),character:selection('b'),writer:selection('c'),stat:selection('b')});await f.turn();
 for(const c of f.calls){assert.equal(c.model,({director:'a',character:'b',adjudicate:'b',draft:'c',prose:'c',post_stat:'b'})[c.stage]);assert(c.frozen);assert(!c.system.includes('GLOBAL_PROMPT_CANARY'));}
 assert.equal(f.calls.filter(c=>c.stage==='character').length,2);for(const c of f.calls.filter(c=>c.stage==='character'))assert(!JSON.stringify(c.input).includes('OWNER_CANARY_'+(c.input.character.id==='alpha'?'beta':'alpha')));
 assert(f.reserves.every(r=>r.meta.routePinHash&&Number.isInteger(r.meta.globalRevision)));const attempt=(await f.store.readAttempts(f.run.runId))[0];assert(attempt.modelRouting.hash);assert(attempt.stages.filter(s=>s.result?.route).every(s=>s.result.route.routePinHash===attempt.modelRouting.hash));
});
test('single Writer and Stat follow role routes without adding a model call',async t=>{
 const f=await setup(t,{single:true});await f.save({writer:selection('b'),stat:selection('c')});await f.turn();assert.deepEqual(f.calls.map(c=>[c.stage,c.model]),[['director','a'],['writer','b'],['post_stat','c']]);
});
test('saving global/local/DSH settings in-flight affects next request only; durable retry keeps the old route',async t=>{
 const f=await setup(t);await f.save({writer:selection('b')});f.failStage='post_stat';let changed=false;
 f.hook=async stage=>{if(stage==='director'&&!changed){changed=true;await f.save({writer:selection('c')});await f.save({stat:selection('c')},f.run.runId);f.current=selection('c');}};
 await assert.rejects(f.turn('request-fixed'),{code:'SERVER'});assert.equal((await f.store.read(f.run.runId)).turns.length,0);const first=f.calls.length;await f.turn('request-fixed');assert(f.calls.slice(first).every(c=>c.model===({director:'a',draft:'b',prose:'b',post_stat:'a'})[c.stage]));
 const second=f.calls.length;await f.turn('request-new');assert(f.calls.slice(second).every(c=>c.model==='c'));
 const committed=f.calls.length;await f.turn('request-new');assert.equal(f.calls.length,committed);
});
test('technical retry retains route and effective defaults after DSH settings change; errors never expose raw text',async t=>{
 const f=await setup(t,{technicalRetries:1});f.failStage='prose';f.hook=async stage=>{if(stage==='prose'){f.current=selection('c');f.defaults=24000;}};await f.turn();const calls=f.calls.filter(c=>c.stage==='prose');assert.equal(calls.length,2);assert(calls.every(c=>c.model==='a'&&c.maxTokens===12000));
});
test('model disappears mid-request: UNKNOWN_MODEL, no silent fallback, no technical retry or canonical commit',async t=>{
 const f=await setup(t,{technicalRetries:1});f.hook=async stage=>{if(stage==='director')f.catalog.delete('a');};const before=await fs.readFile(f.store.currentFile(f.run.runId));await assert.rejects(f.turn(),{code:'UNKNOWN_MODEL'});assert.deepEqual(f.calls.map(c=>c.stage),['director']);assert.deepEqual(await fs.readFile(f.store.currentFile(f.run.runId)),before);
});
test('prepared handle detects registry changes during reservation and does not dispatch',async t=>{
 const f=await setup(t);f.beforeReserve=()=>{f.routing.epoch++;};await assert.rejects(f.turn(),{code:'MODEL_CATALOG_CHANGED'});assert.equal(f.calls.length,0);assert.equal(f.settles.length,1);
});
test('pin checkpoint failure and corrupted pin stop before model work',async t=>{
 const f=await setup(t);const atomic=f.store.atomic.bind(f.store);f.store.atomic=async(file,...args)=>{if(file.includes('model-route-pins'))throw Object.assign(Error('disk'),{code:'EIO'});return atomic(file,...args);};await assert.rejects(f.turn('pin-failure'),{code:'EIO'});assert.equal(f.calls.length,0);f.store.atomic=atomic;
 const pin=await f.model.captureRoutes({run:f.run,requestId:'corrupt',kind:'turn'});await fs.writeFile(path.join(f.store.runDir(f.run.runId),'model-route-pins/turn-corrupt.json'),JSON.stringify({...pin,globalRevision:999}));await assert.rejects(f.turn('corrupt'),{code:'MODEL_ROUTE_PIN_CORRUPT'});assert.equal(f.calls.length,0);
});
test('ideas accepts Run stage override and uses one pinned separate call',async t=>{
 const f=await setup(t);const run=await f.engine.createRun({snapshot:snapshot(),stageModelSelections:{ideas:selection('b')}});await f.engine.turn({runId:run.runId,requestId:'seed-story',input:'Synthetic start'});const before=await f.store.read(run.runId);f.calls.length=0;f.current=selection('c');await generatePlayerIdeas(f.engine,{runId:run.runId,expectedHead:before.head,expectedVersion:before.version,requestId:'ideas-pinned'});assert.deepEqual(f.calls.map(c=>[c.stage,c.model]),[['ideas','b']]);assert.equal((await f.store.read(run.runId)).version,before.version);
});
test('rerank has one existing global authority and its DSH route is pinned through current-selection changes',async t=>{
 const f=await setup(t);f.chapter={mode:'dsh_model',provider:'route-b',model:'b',revision:2};await f.save({summary:selection('c')});const pin=await f.model.captureRoutes({run:f.run,requestId:'rerank-fixed'});assert.equal(pin.routes.chapter_rerank.requested.model,'b');assert.equal(pin.routes.chapter_summary.requested.model,'c');f.chapter={mode:'dsh_current',revision:3};f.current=selection('c');const context={runId:f.run.runId,requestId:'rerank-fixed',routePin:pin};const ports=configuredChapterPorts({settings:{runtime:async()=>f.chapter},nativeModel:f.model,usageLedger:{}});await ports.rerankModel.generate({stage:'chapter_rerank',system:'Synthetic',input:{},context});assert.equal(f.calls[0].model,'b');assert.equal((await f.model.captureRoutes({run:f.run,requestId:'rerank-new'})).routes.chapter_rerank.requested.model,'c');
});
test('operator and card-scope gates protect new global and per-Run actions',async t=>{
 const f=await setup(t);const host=await new SceanHost({engine:f.engine,modelRouting:f.routing,root:path.join(f.root,'host')}).init();t.after(()=>host.close());const auth={principal:{},allowGlobalSettings:true};
 assert.equal((await host.request({action:'agentModelDefaults'})).error.code,'MODEL_SETTINGS_DENIED');assert.equal((await host.request({action:'agentModels',runId:f.run.runId})).error.code,'MODEL_SETTINGS_DENIED');
 const status=await host.request({action:'agentModelDefaults'},null,auth);assert(status.ok);const scoped={...auth,requireCardScope:true,resolveCardScope:()=>null};assert.equal((await host.request({action:'agentModels',runId:f.run.runId},null,scoped)).error.code,'CARD_CONTEXT_REQUIRED');assert.equal(f.calls.length,0);
});
test('direct LLM middleware observes immutable SCEAN Prompt and never assembles Session instructions',async t=>{
 const f=await setup(t);let seen=0,assemblies=0;f.ctx.provide('systemPrompt',{assemble(){assemblies++;throw Error('GLOBAL_PROMPT_CANARY');}});
 f.ctx.on('llm/stream',(options,next)=>{seen++;assert.throws(()=>{options.system='GLOBAL_PROMPT_CANARY';},TypeError);assert.throws(()=>{options.messages[0].content[0].text='PLUGIN_PROMPT_CANARY';},TypeError);return next();});
 await f.turn();assert.equal(seen,4);assert.equal(assemblies,0);assert(f.calls.every(c=>!JSON.stringify(c).includes('PROMPT_CANARY')));
});
test('cancel during a routed call settles usage once and publishes no partial story',async t=>{
 const f=await setup(t),controller=new AbortController();f.hook=()=>controller.abort();const before=await fs.readFile(f.store.currentFile(f.run.runId));await assert.rejects(f.engine.turn({runId:f.run.runId,requestId:'cancel-routed',input:'Synthetic',signal:controller.signal}),{code:'CANCELLED'});assert.deepEqual(await fs.readFile(f.store.currentFile(f.run.runId)),before);assert.equal(f.calls.length,1);assert.equal(f.settles.length,1);assert.equal(f.settles[0].status,'cancelled');
});
test('a request pin cannot be reused after another canonical turn or with a different input',async t=>{
 const f=await setup(t);f.failStage='post_stat';await assert.rejects(f.turn('original-failed'),{code:'SERVER'});await assert.rejects(f.engine.turn({runId:f.run.runId,requestId:'original-failed',input:'Changed input'}),{code:'MODEL_ROUTE_REQUEST_CHANGED'});await f.turn('other-request');const count=f.calls.length;await assert.rejects(f.turn('original-failed'),{code:'MODEL_ROUTE_REQUEST_CHANGED'});assert.equal(f.calls.length,count);
});
test('lost settings acknowledgement after atomic rename reads back the same saved operation',async t=>{
 const f=await setup(t);let injected=false;f.store.fault=(point,detail)=>{if(!injected&&point==='afterRename'&&detail.file.endsWith('agent-models.json')){injected=true;throw Object.assign(Error('lost ack'),{code:'EIO'});}};const result=await f.save({writer:selection('b')});assert.equal(result.revision,1);assert.equal((await readModelSettings(f.store,'@global')).fingerprint,result.fingerprint);assert.equal(f.calls.length,0);
});
test('INVALID_CONFIG is preserved as a non-retryable model error before reserve',async t=>{
 const f=await setup(t,{technicalRetries:1});f.infoError='INVALID_CONFIG';await assert.rejects(f.turn(),e=>e.code==='INVALID_CONFIG'&&!e.message.includes('PRIVATE_'));assert.equal(f.calls.length,0);assert.equal(f.reserves.length,0);
});
test('explicit used-role selections do not require an unrelated DSH default or unused Character model',async t=>{
 const f=await setup(t,{single:true});await f.save({director:selection('a'),writer:selection('b'),stat:selection('c')});f.current={provider:'',model:''};await f.turn();assert.deepEqual(f.calls.map(c=>c.model),['a','b','c']);
});
for(const single of [false,true])test(`Writer role also controls bounded local repairs (single=${single})`,async t=>{
 const f=await setup(t,{single});await f.save({writer:selection('b')});await f.engine.updateBanList({runId:f.run.runId,banList:['Synthetic']});await f.turn();const repairs=f.calls.filter(c=>c.stage.endsWith('_repair'));assert.equal(repairs.length,1);assert.equal(repairs[0].model,'b');assert.equal((await f.store.read(f.run.runId)).turns.length,1);
});
test('rolling and structured chapter summaries use their shared role with independent durable operation pins',async t=>{
 const f=await setup(t);await f.turn('seed-one');await f.turn('seed-two');await f.save({summary:selection('b')});let run=await f.store.read(f.run.runId);await updateSummary(f.engine,{runId:run.runId,operationId:'summary-job',expectedVersion:run.version,expectedHead:run.head,endTurn:1,recentWindow:1},{enabled:true});
 run=await f.store.read(f.run.runId);const chapter=await closeChapter(f.engine,{runId:run.runId,operationId:'close-chapter',expectedVersion:run.version,expectedHead:run.head,title:'Synthetic chapter'});run=await f.store.read(f.run.runId);
 f.reply=stage=>stage==='chapter_summary'?JSON.stringify({title:'Synthetic chapter',summary:'Two public turns completed.',keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'calm'}):undefined;
 const result=await backfillChapterSummary(f.engine,{runId:run.runId,chapterId:chapter.chapterId,operationId:'chapter-job',expectedVersion:run.version,expectedHead:run.head},{enabled:true});assert.equal(result.status,'completed');assert(f.calls.filter(c=>['summary','chapter_summary'].includes(c.stage)).every(c=>c.model==='b'));const pins=await fs.readdir(path.join(f.store.runDir(run.runId),'model-route-pins'));assert(pins.includes('summary-summary-job.json'));assert(pins.includes('chapter-chapter-job.json'));
});
test('a Run named global cannot address or overwrite global model defaults',async t=>{
 const f=await setup(t),run=await f.engine.createRun({runId:'global',snapshot:snapshot()});await f.save({writer:selection('b')},run.runId);assert.equal((await f.routing.status('global')).settings.roles.writer.model,'b');assert.equal((await readModelSettings(f.store,'@global')).revision,0);assert.equal(f.calls.length,0);
});

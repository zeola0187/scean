import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chapterRecallFixture} from '../fixtures/synthetic-chapter-recall.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createChapterConfiguration} from '../plugin/chapter-runtime.mjs';
import {sealChapterKeys} from '../isolated/web/chapter-settings-ui.mjs';
import {encodeRunBundle} from '../core/save-bundle.mjs';

test('configured production factory connects the saved Run switch despite retired service flags, without key leakage or paid activation on save',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scean-global-runtime-')),run=await chapterRecallFixture(),store=new DurableStore({root:join(root,'store')});await store.create(run);
 const records=new Map(),credentials={async readRecord(k){return structuredClone(records.get(k));},async modifyRecord(k,fn){const old=structuredClone(records.get(k)),next=await fn(old);if(next!==undefined)records.set(k,structuredClone(next));return structuredClone(next??old);}},events=[],calls=[],requests=[];
 const ledger={async reserve(row){events.push(row);return 'synthetic';},async settle(id,row){events.push(row);}};
 const model={async generate(a){calls.push({stage:a.stage,input:structuredClone(a.input)});if(a.stage==='director')return {text:'Public brief.'};if(a.stage==='draft'||a.stage==='prose')return {text:'The public crew waited at the dock.'};if(a.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};throw Error('UNEXPECTED_STORY_STAGE');}};
 const ctx={get:name=>name==='credentials'?credentials:name==='profileContext'?{name:'synthetic-profile'}:undefined,agentDefaultModel:{currentSelection:()=>({provider:'synthetic-native',model:'offline'})},llm:{async resolveModelInfo(){return {};},async *stream(){throw Error('NATIVE_RERANK_MUST_NOT_OVERRIDE_GLOBAL_HTTP_SELECTION');}}};
 const configuration=createChapterConfiguration({ctx,config:{},dataRoot:root,usageLedger:ledger,legacyNativeModel:model,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,model:body.model});
  if(url.endsWith('/embeddings'))return {ok:true,json:async()=>({data:body.input.map((_,index)=>({index,embedding:[1,0]})),usage:{total_tokens:1,cost:0}})};
  const input=JSON.parse(body.messages[1].content);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({rankings:input.candidates.map((_,index)=>({index,score:100-index}))})},finish_reason:'stop'}],usage:{total_tokens:1,cost:0}})};
 }});
 const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model,memory:{async retrieve(){return {records:[]};}}}),host=await new SceanHost({engine,root:join(root,'host'),chapterProviderSettings:configuration.settings,chapterRuntimeFactory:configuration.runtimeFactory}).init(),authority={principal:{},allowGlobalSettings:true};
 try{
  const status=(await host.request({action:'chapterProviderSettings'},undefined,authority)).value,s=status.settings;s.flags={chapterModelsEnabled:true,chapterRetrievalEnabled:false,chapterEmbeddingEnabled:false};
  s.rerank={mode:'compatible',provider:'',model:'synthetic-rank',baseUrl:'https://synthetic.invalid/v1',environmentFallback:false};
  const save={action:'chapterProviderSave',operationId:'configured-through-real-host',expectedRevision:0,settings:s};save.sealedKeys=await sealChapterKeys(status.keyTransport,save,{embedding:'SYNTHETIC_RUNTIME_EMBED',rerank:'SYNTHETIC_RUNTIME_RANK'});
  assert.equal((await host.request(save,undefined,authority)).ok,true);assert.equal(requests.length,0);assert.equal(host.chapterContextArmed.size,0);
  let before=await store.read(run.runId);await host.chapterSettings({runId:run.runId,operationId:'explicit-run-consent',expectedVersion:before.version,expectedHead:before.head,settings:{autoEnabled:true,tokenThreshold:32000,bufferTurns:6,detail:'auto'},chapterContextEnabled:true});
  await host.turn({runId:run.runId,requestId:'configured-global-turn',input:'Recall the compass promise.'});
  for(const stage of ['director','draft']){const input=calls.find(c=>c.stage===stage).input,p=input.assembly??input.context;assert.equal(p.chapterContext.recent.length,3);assert.equal(p.chapterContext.retrieved.length,8);assert.equal(p.recentDialogue.length,3);assert.equal(p.rollingSummary,undefined);}
  assert.equal(requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);assert.equal(requests.at(-1).model,'synthetic-rank');assert(requests.some(r=>r.url==='https://openrouter.ai/api/v1/embeddings'));assert(!calls.some(c=>c.stage==='chapter_rerank'));
  const all=JSON.stringify({run:encodeRunBundle(await store.read(run.runId)),attempts:await store.readAttempts(run.runId),events,publicSettings:(await host.request({action:'chapterProviderSettings'},undefined,authority)).value});for(const key of ['SYNTHETIC_RUNTIME_EMBED','SYNTHETIC_RUNTIME_RANK'])assert(!all.includes(key));assert(!JSON.stringify(encodeRunBundle(await store.read(run.runId))).includes('sealedKeys'));
  t.diagnostic(JSON.stringify({evidence:'global_settings_real_production_factory_scripted',recent:3,retrieved:8,uncovered:3,remoteRerankCalls:1,externalPaidModelCalls:0,externalEmbeddingCalls:0,keyOrSettingsInRun:false,saveModelRequests:0}));
 }finally{await host.close();}
});

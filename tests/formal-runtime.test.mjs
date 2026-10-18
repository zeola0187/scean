import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Typert from '@deepseek-ai/dsh-typert-registry';
import * as plugin from '../plugin/index.js';
import {buildSavedSnapshot} from '../vendor/cardstudio-scean/lib/scean-integration.js';

for(const enableExistingEmbedding of [false,true])test(`formal chapter missing-key configuration keeps Runtime and saved RP available (existing Memory vectors=${enableExistingEmbedding})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'scean-chapter-no-key-')),ctx=new Context(),previousKey=process.env['OpenRouter API Key'];let calls=0;
 delete process.env['OpenRouter API Key'];
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic-selected',model:'offline'})});ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){calls++;throw Error('Generation forbidden');}});await ctx.plugin(Typert);
 try{
  const fiber=ctx.plugin(plugin,{dataRoot:root,chapterModelsEnabled:true,chapterRetrievalEnabled:true,chapterEmbeddingEnabled:true,enableExistingEmbedding,technicalRetries:0});await fiber;assert.equal(fiber.state,2);
  const status=JSON.parse(await readFile(join(root,'runtime-status.json'),'utf8'));assert.equal(status.phase,'ready');assert.equal(status.chapterContext.enabled,true);assert.equal(status.chapterContext.embeddingConfigured,false);assert.equal(status.chapterContext.configurationFailure,'EMBEDDING_CONFIGURATION_MISSING');assert.equal(status.memory.embeddingConfigured,false);assert.equal(status.memory.retrieval,'bm25');assert.equal(status.memory.configurationFailure,enableExistingEmbedding?'EMBEDDING_CONFIGURATION_MISSING':null);
  const saved={id:'synthetic-no-key',revision:1,type:'card',sha256:'synthetic',card:{data:{name:'Synthetic old RP',first_mes:'Public opening.',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Synthetic.'}]}}}}};
  const start=await ctx.scean.startFromStudio({snapshot:buildSavedSnapshot(saved),authoringSessionId:'no-key-session',generation:'no-key-generation'}),read=await ctx.scean.inspectFromStudio({...start,authoringSessionId:'no-key-session',generation:'no-key-generation'});
  assert.equal(read.snapshot.opening.text,'Public opening.');assert.equal(calls,0);
 }finally{await ctx.fiber.dispose();if(previousKey===undefined)delete process.env['OpenRouter API Key'];else process.env['OpenRouter API Key']=previousKey;}
});

test('formal configured hybrid boots without payment and legacy Studio admission preserves saved opening and state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scean-formal-runtime-')),ctx=new Context();let generationCalls=0,networkCalls=0;
 const originalFetch=globalThis.fetch,previousKey=process.env['OpenRouter API Key'];globalThis.fetch=()=>{networkCalls++;throw Error('Network forbidden by offline test');};process.env['OpenRouter API Key']='SYNTHETIC_OFFLINE_ONLY';
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'synthetic-selected',model:'user-choice'})});ctx.provide('llm',{async resolveModelInfo(){return {};},async *stream(){generationCalls++;throw Error('Generation forbidden');}});await ctx.plugin(Typert);
 try{
  await ctx.plugin(plugin,{dataRoot:root,enableExistingEmbedding:true,summaryEnabled:false,chapterModelsEnabled:false,technicalRetries:0});
  const scean={
   characters:[{id:'keeper',name:'Keeper',description:'Synthetic background.'}],
   stateBlueprint:{schemaVersion:1,id:'charge',version:1,extensionPolicy:'allow',variables:[{key:'charge',displayName:'Charge',scope:'world',category:'resources',type:'number',min:0,max:10,visibility:'public'}]},
   initialState:{schemaVersion:1,blueprintId:'charge',blueprintVersion:1,values:[{scope:'world',category:'resources',key:'charge',value:3,source:{id:'synthetic-formal',version:1}}]},
  };
  const saved={id:'synthetic-formal',revision:1,type:'card',sha256:'synthetic',card:{data:{name:'Synthetic formal fixture',first_mes:'Saved main opening.',extensions:{scean}}}};
  const snapshot=buildSavedSnapshot(saved),start=await ctx.scean.startFromStudio({snapshot,authoringSessionId:'synthetic-session',generation:'lease-generation'});
  const inspected=await ctx.scean.inspectFromStudio({...start,authoringSessionId:'synthetic-session',generation:'lease-generation'});
  assert.equal(inspected.snapshot.opening.text,'Saved main opening.');assert.equal(inspected.state.world.resources.charge,3);
  const status=JSON.parse(await readFile(join(root,'runtime-status.json'),'utf8'));assert.equal(status.phase,'ready');assert.equal(status.memory.retrieval,'embedding_bm25_rrf');assert.equal(status.memory.providerConnectivity,'not_probed');assert.equal(status.memory.rerankConfigured,false);assert.equal(status.modelSelectionSource,'dsh_current_selection');assert.equal(status.localDollarLimit,null);assert.equal(status.localGenerationLimit,null);assert.deepEqual(status.backgroundModels,{rollingSummary:false,chapters:false});assert.equal(generationCalls,0);assert.equal(networkCalls,0);
 }finally{await ctx.fiber.dispose();globalThis.fetch=originalFetch;if(previousKey===undefined)delete process.env['OpenRouter API Key'];else process.env['OpenRouter API Key']=previousKey;}
});

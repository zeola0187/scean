import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ChapterRecall,chapterContextSources} from '../core/chapter-recall.mjs';
import {chapterRecallFixture,chapterRecallPorts} from '../fixtures/synthetic-chapter-recall.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {updateSummary} from '../core/narrative.mjs';
import {hash} from '../core/contracts.mjs';
const code=c=>e=>e.code===c;
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const ids=result=>[...result.recent,...result.retrieved].map(r=>r.summaryId);
async function setup({providerError,window=200000,missingPorts=false,tools=false}={}){
  const run=await chapterRecallFixture(),root=await mkdtemp(join(tmpdir(),'scean-recall-engine-')),store=new DurableStore({root}),ports=chapterRecallPorts({contextWindow:window}),calls=[];await store.create(run);
  const model={describe:ports.rerankModel.describe,async generate(a){calls.push({stage:a.stage,input:structuredClone(a.input),context:structuredClone(a.context)});
    if(a.stage==='chapter_rerank')return ports.rerankModel.generate(a);
    if(a.stage==='summary')return {text:'LEGACY_ROLLING_DO_NOT_DUPLICATE',model:'scripted'};
    if(a.stage==='director'){
      if(providerError)throw Object.assign(Error('scripted provider hard limit'),{code:providerError});
      if(tools&&!a.input.conversation.length)return {text:'',toolCalls:[{id:'read-original',name:'read_history',arguments:{commitId:'d-commit-0001'}},{id:'search-original',name:'search_history',arguments:{query:'PROMISE_COMPASS'}},{id:'owner-advice',name:'consult_character',arguments:{characterId:'kalt',question:'Give public advice.'}}]};
      return {text:'Public brief from selected chapters.'};
    }
    if(a.stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:'kalt',observable:{attitude:'calm',intent:'wait'},publicUtterances:['Public advice.'],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
    if(a.stage==='draft'||a.stage==='prose')return {text:'The public crew waited at the dock.'};
    if(a.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};
    throw Error('Unexpected scripted stage '+a.stage);
  }};
  const recall=new ChapterRecall({embed:missingPorts?undefined:ports.embed,rerankModel:missingPorts?undefined:model,embeddingModel:'scripted-vector'}),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,chapterRecall:recall,memory:{async retrieve(){return {records:[]};}}});return {run,root,store,engine,model,recall,ports,calls};
}
async function request(f,operationId,extra={}){const run=await f.store.read(f.run.runId);return {runId:run.runId,operationId,expectedVersion:run.version,expectedHead:run.head,...extra};}

test('3+8 actual BM25/vector/RRF/rerank path fixes latest3, ranks at most8 older, deduplicates and covers raw tail',async()=>{
  const run=await chapterRecallFixture(),ports=chapterRecallPorts(),recall=new ChapterRecall({...ports,embeddingModel:'scripted-vector'}),result=await recall.retrieve({run,query:'copper compass'});
  assert.deepEqual(result.recent.map(r=>r.chapterId),['d-chapter-12','d-chapter-13','d-chapter-14']);assert.equal(result.retrieved.length,8);assert.equal(new Set(ids(result)).size,11);
  assert.equal(result.retrieved[0].chapterId,'d-chapter-1','rerank changes the fused order');assert(result.retrieved.every(r=>Number(r.chapterId.split('-').at(-1))<12));
  assert(result.diagnostics.ranking.every(r=>r.bm25>0&&r.vector>0&&r.rrf>0&&Number.isFinite(r.rerank)));assert.deepEqual(result.recentDialogue.map(t=>t.turn),[43,44,45]);
  assert.deepEqual(ports.calls.map(c=>c.stage??c.kind),['document','query','chapter_rerank']);assert(!JSON.stringify(ports.calls).includes('SYNTHETIC_D_KALT_ONLY'));
});
test('3+8 cache is chapter-version/source/run scoped; query vector and rerank still execute each turn',async()=>{
  const run=await chapterRecallFixture(),ports=chapterRecallPorts(),recall=new ChapterRecall({...ports,embeddingModel:'scripted-vector'});await recall.retrieve({run,query:'compass'});const count=ports.calls.length;
  const again=await recall.retrieve({run,query:'calibration'});assert.equal(again.diagnostics.cacheHits,11);assert.deepEqual(ports.calls.slice(count).map(c=>c.stage??c.kind),['query','chapter_rerank']);
  const changed=structuredClone(run);changed.narrative.chapterSummaries[0].version++;changed.narrative.operations[changed.narrative.chapterSummaries[0].provenance.operationId].result.summaryVersion++;changed.narrative.chapterSummaries[0].payload.summary+=' NEW_VERSION';const next=await recall.retrieve({run:changed,query:'compass'});assert.equal(next.diagnostics.cacheHits,10);
  recall.clearRun(run.runId);assert.equal(recall.cacheSize,0);
});
for(const mutation of ['cross_run','retired','private','hash','chapter_version'])test(`3+8 excludes ${mutation} before embedding or BM25 corpus construction`,async()=>{
  const run=await chapterRecallFixture(),row=run.narrative.chapterSummaries[0];
  if(mutation==='cross_run')row.runId='another-run';if(mutation==='retired')row.current=false;if(mutation==='private')row.visibility='characters';if(mutation==='hash')row.sourceHash='0'.repeat(64);if(mutation==='chapter_version')row.chapterVersion++;
  row.payload.summary='EXCLUDED_CHAPTER_SECRET';const ports=chapterRecallPorts(),result=await new ChapterRecall({...ports}).retrieve({run,query:'compass'});assert(!JSON.stringify(ports.calls).includes('EXCLUDED_CHAPTER_SECRET'));assert(!ids(result).includes(row.id));assert(result.recentDialogue.some(t=>t.turn===1));
});
test('3+8 fewer than8 older chapters returns available data without padding or duplicate recent chapters',async()=>{
  const run=await chapterRecallFixture();run.narrative.chapters=run.narrative.chapters.slice(-5);run.narrative.chapterSummaries=run.narrative.chapterSummaries.slice(-5);
  const ports=chapterRecallPorts(),result=await new ChapterRecall({...ports}).retrieve({run,query:'compass'});assert.equal(result.recent.length,3);assert.equal(result.retrieved.length,2);assert.equal(new Set(ids(result)).size,5);
});
test('3+8 at most3 chapters needs no vector/rerank call and does not invent missing matches',async()=>{
  const run=await chapterRecallFixture();run.narrative.chapters=run.narrative.chapters.slice(-2);run.narrative.chapterSummaries=run.narrative.chapterSummaries.slice(-2);
  const result=await new ChapterRecall().retrieve({run,query:'compass'});assert.equal(result.recent.length,2);assert.equal(result.retrieved.length,0);assert.equal(result.diagnostics.embedding,'not_needed');
});
test('3+8 no relevant rerank match is not padded with eight irrelevant chapters',async()=>{
  const run=await chapterRecallFixture(),ports=chapterRecallPorts({overrideRerank:a=>({text:JSON.stringify({rankings:a.input.candidates.map((_,index)=>({index,score:0}))})})});
  const result=await new ChapterRecall({...ports}).retrieve({run,query:'unrelated query'});assert.equal(result.recent.length,3);assert.equal(result.retrieved.length,0);assert.equal(result.diagnostics.rerank,'ready');
});
for(const kind of ['missing_embed','missing_rerank','failed_embed','invalid_vector','failed_rerank','invalid_rerank'])test(`3+8 ${kind} fails visibly instead of claiming BM25-only is complete`,async()=>{
  const run=await chapterRecallFixture(),ports=chapterRecallPorts({overrideEmbed:()=>{if(kind==='failed_embed')throw Error('scripted embedding outage');if(kind==='invalid_vector')return [[0,0]];},overrideRerank:()=>{if(kind==='failed_rerank')throw Error('scripted rerank outage');if(kind==='invalid_rerank')return {text:JSON.stringify({rankings:[{index:999,score:1}]})};}});
  const recall=new ChapterRecall({embed:kind==='missing_embed'?undefined:ports.embed,rerankModel:kind==='missing_rerank'?undefined:ports.rerankModel});let error;try{await recall.retrieve({run,query:'compass'});}catch(e){error=e;}
  assert(error?.chapterRecallDiagnostics);assert.notEqual(error.chapterRecallDiagnostics.status,'ready');assert.equal(error.chapterRecallDiagnostics.retrievedSummaryIds.length,0);
});
test('3+8 cancellation and late vector result cannot enter cache',async()=>{
  const run=await chapterRecallFixture(),began=deferred(),release=deferred(),controller=new AbortController(),ports=chapterRecallPorts({overrideEmbed:async()=>{began.resolve();await release.promise;return [[1,0]];}}),recall=new ChapterRecall({...ports});
  const work=recall.retrieve({run,query:'compass',signal:controller.signal});await began.promise;controller.abort();await assert.rejects(work,code('CANCELLED'));release.resolve();assert.equal(recall.cacheSize,0);
});
test('3+8 rollback epoch discards a late vector result before index publication',async()=>{
  const run=await chapterRecallFixture(),began=deferred(),release=deferred(),ports=chapterRecallPorts({overrideEmbed:async a=>{if(a.kind==='document'){began.resolve();await release.promise;}return a.texts.map(()=>[1,0]);}}),recall=new ChapterRecall({...ports});
  const work=recall.retrieve({run,query:'compass'});await began.promise;recall.clearRun(run.runId);release.resolve();await assert.rejects(work,code('CHAPTER_RECALL_STALE'));assert.equal(recall.cacheSize,0);
});
test('3+8 late rerank cannot survive rollback or republish a cleared index',async()=>{
  const run=await chapterRecallFixture(),began=deferred(),release=deferred(),ports=chapterRecallPorts({overrideRerank:async a=>{began.resolve();await release.promise;return {text:JSON.stringify({rankings:a.input.candidates.map((_,index)=>({index,score:10}))})};}}),recall=new ChapterRecall({...ports});
  const work=recall.retrieve({run,query:'compass'});await began.promise;recall.clearRun(run.runId);release.resolve();await assert.rejects(work,code('CHAPTER_RECALL_STALE'));assert.equal(recall.cacheSize,0);
});
test('3+8 vector deadline reports failure with no fallback, cache publication or automatic retry',async()=>{
  const run=await chapterRecallFixture();let count=0;const recall=new ChapterRecall({embed:async()=>{count++;return new Promise(()=>{});},rerankModel:chapterRecallPorts().rerankModel,timeoutMs:5});
  await assert.rejects(recall.retrieve({run,query:'compass'}),e=>e.code==='CHAPTER_EMBEDDING_FAILED'&&e.chapterRecallDiagnostics.failureCode==='MODEL_TIMEOUT');assert.equal(count,1);assert.equal(recall.cacheSize,0);
});
test('3+8 identical IDs in concurrent Runs never share source or vector cache entries',async()=>{
  const one=await chapterRecallFixture(),two=structuredClone(one);two.runId='other-synthetic-run';for(const row of [...two.narrative.chapters,...two.narrative.chapterSummaries])row.runId=two.runId;for(const op of Object.values(two.narrative.operations))op.request.runId=two.runId;
  const ports=chapterRecallPorts(),recall=new ChapterRecall({...ports}),results=await Promise.all([recall.retrieve({run:one,query:'compass'}),recall.retrieve({run:two,query:'compass'})]);
  assert(results[0].recent.every(r=>r.runId===one.runId));assert(results[1].retrieved.every(r=>r.runId===two.runId));assert.equal(recall.cacheSize,22);recall.clearRun(one.runId);assert.equal(recall.cacheSize,11);
});
test('3+8 shared cache eviction cannot discard a returning Run vector snapshot or require a paid retry',async()=>{
  const base=await chapterRecallFixture(),ports=chapterRecallPorts(),recall=new ChapterRecall({...ports});let first;
  for(let i=0;i<47;i++){
    const run=structuredClone(base);run.runId='eviction-synthetic-'+i;
    for(const row of [...run.narrative.chapters,...run.narrative.chapterSummaries])row.runId=run.runId;
    for(const op of Object.values(run.narrative.operations))op.request.runId=run.runId;
    await recall.retrieve({run,query:'compass'});if(i===0)first=run;
  }
  assert.equal(recall.cacheSize,512);const before=ports.calls.length,result=await recall.retrieve({run:first,query:'compass'}),added=ports.calls.slice(before);
  assert.equal(result.diagnostics.cacheHits,6);assert.equal(result.retrieved.length,8);assert.equal(recall.cacheSize,512);
  assert.equal(added.filter(c=>c.kind==='document').length,1);assert.equal(added.filter(c=>c.kind==='query').length,1);assert.equal(added.filter(c=>c.stage==='chapter_rerank').length,1);
  assert(result.retrieved.every(r=>r.runId===first.runId));
});
test('3+8 missing production configuration blocks only opt-in, leaving ordinary legacy RP available',async()=>{
  const f=await setup({missingPorts:true}),host=await new SceanHost({engine:f.engine,root:join(f.root,'missing-port-host'),chapterModelsEnabled:true,chapterRetrievalEnabled:true}).init();try{
    const request_=await request(f,'missing-port-consent',{settings:{autoEnabled:true,tokenThreshold:32000,bufferTurns:6,detail:'auto'},chapterContextEnabled:true});await assert.rejects(host.chapterSettings(request_),code('CHAPTER_EMBEDDING_UNAVAILABLE'));
    assert.equal((await host.chapterStatus({runId:f.run.runId})).chapterContextArmed,false);await host.turn({runId:f.run.runId,requestId:'ordinary-legacy-turn',input:'Continue without opting in.'});assert(!f.calls.some(c=>c.stage==='chapter_rerank'));
  }finally{await host.close();}
});
test('3+8 consent survives the actual Host job boundary and reaches the next Director without rolling work',async()=>{
  const f=await setup(),host=await new SceanHost({engine:f.engine,root:join(f.root,'job-consent-host'),chapterModelsEnabled:true,chapterRetrievalEnabled:true}).init();try{
    const consent=await request(f,'job-context-consent',{settings:{autoEnabled:true,tokenThreshold:32000,bufferTurns:6,detail:'auto'},chapterContextEnabled:true});await host.jobs.submit({...consent,kind:'chapterSettings'});await host.jobs.active.get(f.run.runId)?.promise;
    assert.equal(host.chapterContextArmed.has(f.run.runId),true);await host.turn({runId:f.run.runId,requestId:'host-chapter-context',input:'Recall the compass.'});const packet=f.calls.find(c=>c.stage==='director').input.assembly;assert.equal(packet.chapterContext.retrieved.length,8);assert.equal(packet.rollingSummary,undefined);assert(!f.calls.some(c=>c.stage==='summary'));
  }finally{await host.close();}
});
test('3+8 actual Director/Draft receive identical 3+8+all raw originals, no duplicate legacy rolling; tools and CR boundaries remain',async()=>{
  const f=await setup({tools:true});await updateSummary(f.engine,await request(f,'legacy-rolling',{endTurn:10,recentWindow:6}),{enabled:true});
  await f.engine.turn({runId:f.run.runId,requestId:'new-chapter-context',input:'Find the compass promise.',chapterContextEnabled:true});
  const director=f.calls.find(c=>c.stage==='director').input.assembly,draft=f.calls.find(c=>c.stage==='draft').input.context;
  for(const packet of [director,draft]){assert.equal(packet.chapterContext.recent.length,3);assert.equal(packet.chapterContext.retrieved.length,8);assert.equal(packet.rollingSummary,undefined);assert(!JSON.stringify(packet).includes('LEGACY_ROLLING_DO_NOT_DUPLICATE'));assert.deepEqual(packet.recentDialogue.map(t=>t.turn),[43,44,45]);}
  assert.deepEqual(director.chapterContext,draft.chapterContext);assert(f.calls.filter(c=>c.stage==='director').length===2);
  for(const c of f.calls.filter(c=>['character','prose','post_stat'].includes(c.stage)))assert(!JSON.stringify(c.input).includes('CHAPTER_CANARY_'));
  const attempt=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(attempt.assemblyDiagnostics.chapterRecall.status,'ready');assert.equal(attempt.tools.length,3);validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId)));
});
test('3+8 no platform quota: small/unknown capability never silently removes selected chapters or originals',async()=>{
  for(const window of [1,null]){const f=await setup({window});await f.engine.turn({runId:f.run.runId,requestId:'complete-packet',input:'Keep the complete selected set.',chapterContextEnabled:true});
    for(const c of f.calls.filter(c=>['director','draft'].includes(c.stage))){const p=c.input.assembly??c.input.context;assert.equal(p.chapterContext.retrieved.length,8);assert.equal(p.recentDialogue.length,3);}}
});
test('3+8 actual provider hard-limit failure leaves the canonical story uncommitted and diagnostic',async()=>{
  const f=await setup({providerError:'CONTEXT_WINDOW_EXCEEDED'}),before=hash(await f.store.read(f.run.runId));await assert.rejects(f.engine.turn({runId:f.run.runId,requestId:'provider-limit',input:'Large complete packet.',chapterContextEnabled:true}),code('CONTEXT_WINDOW_EXCEEDED'));
  assert.equal(hash(await f.store.read(f.run.runId)),before);const attempt=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(attempt.error.code,'CONTEXT_WINDOW_EXCEEDED');assert(!f.calls.some(c=>c.stage==='draft'));
});
test('3+8 backup/restart reconstructs chapter sources and a cold index without persisting grants or cache',async()=>{
  const f=await setup(),restored=validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId))),ports=chapterRecallPorts(),first=await f.recall.retrieve({run:f.run,query:'compass'}),cold=new ChapterRecall({...ports});
  const result=await cold.retrieve({run:restored,query:'compass'});assert.deepEqual(ids(result),ids(first));assert.equal(result.diagnostics.cacheHits,0);assert(!JSON.stringify(encodeRunBundle(restored)).includes('scripted-vector'));
  const host=await new SceanHost({engine:f.engine,root:join(f.root,'host'),chapterModelsEnabled:true,chapterRetrievalEnabled:true}).init();
  try{const consent=await request(f,'arm-chapter-context',{settings:{autoEnabled:true,tokenThreshold:32000,bufferTurns:6,detail:'auto'},chapterContextEnabled:true});await host.chapterSettings(consent);assert.equal((await host.chapterStatus({runId:f.run.runId})).chapterContextArmed,true);await host.close();
    const second=await new SceanHost({engine:f.engine,root:join(f.root,'host'),chapterModelsEnabled:true,chapterRetrievalEnabled:true}).init();try{assert.equal((await second.chapterStatus({runId:f.run.runId})).chapterContextArmed,false);await second.chapterSettings(consent);assert.equal((await second.chapterStatus({runId:f.run.runId})).chapterContextArmed,false);}finally{await second.close();}
  }finally{await host.close();}
});

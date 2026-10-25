import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';import {SceanHost} from '../plugin/host.mjs';import {DurableStore} from '../adapters/store.mjs';
import {ChapterRecall,chapterContextSources} from '../core/chapter-recall.mjs';
import {chapterRecallFixture,chapterRecallPorts} from '../fixtures/synthetic-chapter-recall.mjs';
import {validateNarrative} from '../core/narrative.mjs';import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash} from '../core/contracts.mjs';
const copy=structuredClone,code=c=>e=>e.code===c;
const handoff=()=>({handoffVersion:1,sceneIntent:'Continue the public calibration task.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]});
const summary={title:'合成校準章節',summary:'公開船員完成一階段校準，承諾歸還羅盤，後續工作尚未完成。',keywords:['羅盤'],characters:[],locations:['北碼頭'],plotThreads:['後續校準'],emotionalTone:'平靜'};
const snapshot={schemaVersion:1,cardId:'integrated-chapter-card',revision:'r1',card:{name:'Offline calibration',description:'A public task.'},worldbook:{entries:[{id:1,keys:['compass'],content:'WORLD_BOOK_MUST_REMAIN: the public dock stores the compass.',enabled:true}]},preset:{style:'PRESET_MUST_REMAIN'},characters:[{id:'lin',name:'Lin',description:'A public engineer.'}]};
async function fixture({archived=false,missing=false,failArchive=false,failDirector=false}={}){
 const root=await mkdtemp(join(tmpdir(),'chapter-integrated-')),store=new DurableStore({root:join(root,'store')}),calls=[],ports=chapterRecallPorts();let writerCount=0;
 const model={async describe(){return{capabilities:{contextWindow:250000,outputLimit:4096}};},async generate(a){calls.push(copy({...a,signal:undefined}));
  if(a.stage==='chapter_analysis')return{text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:a.input.range.endTurn,suggestedTitle:'公開校準記錄',keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'平靜',significantEvents:[]}),model:'scripted-analysis'};
  if(a.stage==='chapter_summary'){if(failArchive)throw Object.assign(Error('synthetic archive failure'),{code:'SYNTHETIC_ARCHIVE_FAILURE'});return{text:JSON.stringify(summary),model:'scripted-summary'};}
  if(a.stage==='chapter_rerank')return ports.rerankModel.generate(a);
  if(a.stage==='director'){if(failDirector)throw Object.assign(Error('synthetic director failure'),{code:'SYNTHETIC_DIRECTOR_FAILURE'});return{text:JSON.stringify(handoff())};}
  if(a.stage==='writer')return{text:('第'+(++writerCount)+'輪，合成船員在北碼頭整理羅盤與校準記錄。').repeat(100)};
  if(a.stage==='post_stat')return{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};
  assert.fail('Unexpected stage '+a.stage);
 }};
 const recall=new ChapterRecall({embed:missing?undefined:ports.embed,rerankModel:missing?undefined:model,embeddingModel:'scripted'}),engine=new SceanEngine({store,model,chapterRecall:recall,memory:{async retrieve(){return{records:[]};}}});
 if(archived)await store.create(await chapterRecallFixture());
 const hostRoot=join(root,'host'),host=await new SceanHost({engine,root:hostRoot,chapterModelsEnabled:true}).init();
 const runId=archived?'synthetic-chapter-recall':(await host.createRun({snapshot,initialState:{world:{facts:{task:'STATE_MUST_REMAIN'}},characters:{lin:{public:{},private:{secret:'OWNER_STATE_MUST_NOT_LEAK'}}}}})).runId;
 return{root,store,calls,ports,engine,host,hostRoot,runId,model};
}
async function idle(f){for(let n=0;n<1000;n++){if(!f.host.chapterBackground?.size&&!f.host.mutationBusy(f.runId))return;await new Promise(r=>setTimeout(r,5));}assert.fail('Scripted background never settled');}
async function settings(f,enabled,operationId='settings'){const r=await f.store.read(f.runId);return f.host.chapterSettings({runId:f.runId,operationId,expectedVersion:r.version,expectedHead:r.head,settings:{autoEnabled:enabled,tokenThreshold:16000,bufferTurns:6,detail:'auto'}});}
const packet=(f,stage)=>f.calls.findLast(c=>c.stage===stage)?.input;

test('normal new story forms a named archive near the target; the next Director and Single Writer use it instead of the covered originals',async()=>{
 const f=await fixture();try{
  assert.equal((await f.store.read(f.runId)).narrative.chapterSettings.autoEnabled,true);assert.equal(f.calls.length,0);
  for(let i=1;i<=5;i++){await f.host.turn({runId:f.runId,requestId:'play-'+i,input:'Continue compass calibration.'});await idle(f);}
  const run=await f.store.read(f.runId),sources=chapterContextSources(run),d=packet(f,'director').assembly,w=packet(f,'writer').context;
  assert(run.narrative.chapters.length>0);assert(run.narrative.chapterSummaries.length>0);assert.equal(run.narrative.chapters[0].title,'公開校準記錄');
  assert.equal(d.chapterContext.mode,'chapter_3_plus_8');assert.equal(d.rollingSummary,undefined);assert(d.chapterContext.recent.length>0);assert.deepEqual(d.chapterContext,w.chapterContext);assert.deepEqual(d.recentDialogue,w.recentDialogue);
  const archivedThrough=run.narrative.chapterSummaries[0].endTurn;assert(d.recentDialogue.every(t=>t.turn>archivedThrough));assert(!d.recentDialogue.some(t=>t.turn<=archivedThrough));assert.equal(d.worldState.world.facts.task,'STATE_MUST_REMAIN');assert(JSON.stringify(d.sources.worldbook).includes('WORLD_BOOK_MUST_REMAIN'));assert.equal(w.sources.preset.style,'PRESET_MUST_REMAIN');
  assert(!f.calls.some(c=>['summary','draft','prose'].includes(c.stage)));assert.equal(f.calls.filter(c=>c.stage==='writer').length,5);assert.equal(sources.diagnostics.uncoveredTurns,run.turns.length-sources.diagnostics.archivedTurns);validateNarrative(run);validateRunBundle(encodeRunBundle(run));
  const attempt=(await f.store.readAttempts(f.runId)).at(-1);for(const stage of ['director','writer']){const use=attempt.stages.find(s=>s.stage===stage).narrativeUse;assert.equal(use.contextMode,'chapter_3_plus_8');assert.deepEqual(use.recentSummaryIds,d.chapterContext.recent.map(r=>r.summaryId));assert.equal(use.originalsHash,hash(d.recentDialogue));}
 }finally{await f.host.close();}
});
test('actual Single Writer receives identical recent3 plus fused/reranked8 and all uncovered originals without owner secrets or duplicate IDs',async()=>{
 const f=await fixture({archived:true});try{
  await settings(f,true);assert.equal(f.calls.length,0);await f.host.turn({runId:f.runId,requestId:'integrated-recall',input:'Recall the copper compass promise.'});await idle(f);
  const d=packet(f,'director').assembly,w=packet(f,'writer').context,c=d.chapterContext;
  assert.equal(c.recent.length,3);assert.equal(c.retrieved.length,8);assert.equal(new Set([...c.recent,...c.retrieved].map(r=>r.chapterId)).size,11);assert.deepEqual(c,w.chapterContext);assert.deepEqual(d.recentDialogue.map(t=>t.turn),[43,44,45]);assert.deepEqual(d.recentDialogue,w.recentDialogue);assert(!JSON.stringify([d,w]).includes('SYNTHETIC_D_KALT_ONLY'));assert(f.ports.calls.some(c=>c.kind==='query'));assert(f.calls.some(c=>c.stage==='chapter_rerank'));assert.equal(d.rollingSummary,undefined);
  const catalog=packet(f,'writer').directorHandoff.sourceCatalog.filter(r=>r.kind==='public_chapter_summary');assert.equal(catalog.length,11);assert.deepEqual(catalog.map(r=>r.summaryId),[...c.recent,...c.retrieved].map(r=>r.summaryId));assert(catalog.every(r=>r.sourceHash&&r.status==='historical_reference_not_current_event'));
 }finally{await f.host.close();}
});
test('missing hybrid configuration is visible and retains EVERY original in both actual payloads rather than pretending BM25-only or summary-only is ready',async()=>{
 const f=await fixture({archived:true,missing:true});try{
  await settings(f,true);const before=await f.store.read(f.runId),status=await f.host.chapterStatus({runId:f.runId});assert.equal(status.contextReadiness.reason,'CHAPTER_EMBEDDING_UNAVAILABLE');
  await f.host.turn({runId:f.runId,requestId:'fallback-full-originals',input:'Continue the compass task.'});await idle(f);
  for(const p of [packet(f,'director').assembly,packet(f,'writer').context]){assert.equal(p.chapterContext.status,'degraded');assert.equal(p.chapterContext.recent.length,0);assert.equal(p.chapterContext.retrieved.length,0);assert.deepEqual(p.recentDialogue.map(t=>t.commitId),before.turns.map(t=>t.commitId));}
  const trace=(await f.store.readAttempts(f.runId)).at(-1).assemblyDiagnostics.chapterRecall;assert.equal(trace.fallback,'all_committed_originals');assert.equal(trace.failureCode,'CHAPTER_EMBEDDING_UNAVAILABLE');assert.equal(trace.uncoveredTurns,45);
 }finally{await f.host.close();}
});
test('restart and applying global configuration never require a second arm, never generate on load/save, and preserve explicit OFF',async()=>{
 const f=await fixture({archived:true});try{
  await settings(f,true);const count=f.calls.length;await f.host.close();f.host=await new SceanHost({engine:f.engine,root:f.hostRoot,chapterModelsEnabled:true}).init();
  f.host.applyChapterProviderConfiguration({revision:4,settings:{flags:{chapterModelsEnabled:true,chapterRetrievalEnabled:false,chapterEmbeddingEnabled:false}}});
  assert.equal((await f.host.chapterStatus({runId:f.runId})).integratedContextEnabled,true);assert.equal(f.calls.length,count);assert.equal(f.host.chapterContextArmed.size,0,'normal flow owns no per-launch grant');
  await f.host.turn({runId:f.runId,requestId:'after-restart',input:'Recall compass.'});await idle(f);assert.equal(packet(f,'director').assembly.chapterContext.recent.length,3);
  await settings(f,false,'off');const afterOff=f.calls.length;await f.host.close();f.host=await new SceanHost({engine:f.engine,root:f.hostRoot,chapterModelsEnabled:true}).init();assert.equal((await f.host.chapterStatus({runId:f.runId})).integratedContextEnabled,false);assert.equal(f.calls.length,afterOff);
  await f.host.turn({runId:f.runId,requestId:'saved-off',input:'Continue normally.'});await idle(f);assert.equal(packet(f,'director').assembly.chapterContext,undefined);
 }finally{await f.host.close();}
});
test('summary failure preserves lawful originals, publishes no archive and leaves the committed player turn intact',async()=>{
 const f=await fixture({failArchive:true});try{
  for(let i=1;i<=5;i++){await f.host.turn({runId:f.runId,requestId:'failed-archive-'+i,input:'Continue compass.'});await idle(f);}
  const r=await f.store.read(f.runId);assert.equal(r.turns.length,5);assert.equal(r.narrative.chapterSummaries.length,0);assert.equal(r.narrative.chapters.length,0);assert.equal((await f.host.chapterStatus({runId:f.runId})).automaticFailure.code,'SYNTHETIC_ARCHIVE_FAILURE');assert.equal(packet(f,'director').assembly.recentDialogue.length,4);assert.equal(packet(f,'writer').context.recentDialogue.length,4);validateRunBundle(encodeRunBundle(r));
 }finally{await f.host.close();}
});
test('same request retry cannot silently change the saved chapter-context authority after a failed model attempt',async()=>{
 const f=await fixture({failDirector:true});try{
  await assert.rejects(f.host.turn({runId:f.runId,requestId:'same-request',input:'Continue compass.'}),code('SYNTHETIC_DIRECTOR_FAILURE'));
  await settings(f,false,'change-mode');await assert.rejects(f.host.turn({runId:f.runId,requestId:'same-request',input:'Continue compass.'}),code('CHAPTER_CONTEXT_REQUEST_CHANGED'));
 }finally{await f.host.close();}
});

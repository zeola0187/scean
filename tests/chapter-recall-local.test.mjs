import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as chapter from '../core/chapter-recall.mjs';
import {chapterRecallFixture,chapterRecallPorts} from '../fixtures/synthetic-chapter-recall.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {budgetStage} from '../core/context-budget.mjs';
import {hash} from '../core/contracts.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';

async function small(count=5){const r=await chapterRecallFixture();r.narrative.chapters=r.narrative.chapters.slice(0,count);const ids=new Set(r.narrative.chapters.map(c=>c.id));r.narrative.chapterSummaries=r.narrative.chapterSummaries.filter(s=>ids.has(s.chapterId));r.narrative.operations=Object.fromEntries(Object.entries(r.narrative.operations).filter(([,op])=>(!op.result?.chapterId||ids.has(op.result.chapterId))&&(!op.request?.chapterId||ids.has(op.request.chapterId))));return r;}
const zero=a=>({text:JSON.stringify({rankings:a.input.candidates.map((_,index)=>({index,score:0}))})});
const selected=r=>[...r.recent,...r.retrieved];

test('local recall: five valid archives always include first chapter, even if rerank would score zero; no model required',async()=>{
 const run=await small(),ports=chapterRecallPorts({overrideRerank:zero});
 const r=await new chapter.ChapterRecall({...ports}).retrieve({run,query:'Continue.'});
 assert.equal(r.recent.length,3);assert.equal(r.retrieved.length,2);assert.equal(selected(r).length,5);
 assert(r.retrieved.some(s=>s.chapterId==='d-chapter-1'));assert.equal(ports.calls.length,0);
 assert.equal(r.diagnostics.selectionPolicy,'all_older_within_8');assert.equal(r.diagnostics.embedding,'not_needed');
 assert(r.diagnostics.candidates.every(c=>c.scores.vector===null&&c.scores.rerank===null&&c.selected));
});
test('local recall: exactly eight older archives bypass ports, never exceed recent3 + older8',async()=>{
 const run=await small(11),r=await new chapter.ChapterRecall().retrieve({run,query:'Go.'});
 assert.equal(r.recent.length,3);assert.equal(r.retrieved.length,8);assert.equal(new Set(selected(r).map(s=>s.summaryId)).size,11);
});
test('local recall: more than8 preserves hybrid path and logs rejected zero scores without padding',async()=>{
 const run=await chapterRecallFixture(),ports=chapterRecallPorts({overrideRerank:zero});
 const r=await new chapter.ChapterRecall({...ports}).retrieve({run,query:'Go.'});
 assert.equal(r.retrieved.length,0);assert.equal(r.recent.length,3);assert.equal(r.diagnostics.selectionPolicy,'hybrid_rerank');
 assert.equal(r.diagnostics.candidates.length,11);assert(r.diagnostics.candidates.every(c=>c.scores.rerank===0&&c.reason==='rerank_nonpositive'));
 assert(r.diagnostics.candidates.every(c=>Number.isFinite(c.scores.vector)&&Number.isFinite(c.scores.rrf)));
});
test('local recall: query contains bounded latest committed public scene, never private state, summaries or future plans',async()=>{
 const run=await chapterRecallFixture();run.turns.at(-1).body='PUBLIC_LAST_SCENE '+ 'x'.repeat(20000)+' PUBLIC_SCENE_END';
 run.state.world.facts={...(run.state.world.facts??{}),futurePlan:'PRIVATE_OR_FUTURE_MUST_NOT_ENTER_QUERY'};
 const ports=chapterRecallPorts();await new chapter.ChapterRecall({...ports}).retrieve({run,query:'short input'});
 const query=ports.calls.find(c=>c.kind==='query').texts[0],rerank=ports.calls.find(c=>c.stage==='chapter_rerank').input;
 assert.equal(query,rerank.query);assert(query.includes('short input'));assert(query.includes('PUBLIC_SCENE_END'));
 assert(!query.includes('PRIVATE_OR_FUTURE'));assert(!query.includes('CHAPTER_CANARY_'));assert(query.length<=8192);
 const q=chapter.buildChapterRecallQuery(run,'p'.repeat(20000));assert(q.text.length<=8192);assert.equal(q.diagnostics.sourceHead,run.head);
 assert.equal(q.diagnostics.policy,'player_plus_latest_committed_public_scene_v1');assert(q.diagnostics.components.some(x=>x.truncated));
 assert(!JSON.stringify(q.diagnostics).includes('PUBLIC_SCENE_END'));assert.equal(q.diagnostics.queryHash,hash(q.text));
});
test('local recall: no archives, small-set cancellation and duplicate archives respect empty/permission boundaries',async()=>{
 const run=await small(0),empty=await new chapter.ChapterRecall().retrieve({run,query:'Go.'});assert.equal(selected(empty).length,0);assert.equal(empty.recentDialogue.length,45);
 const five=await small(),controller=new AbortController();controller.abort();await assert.rejects(new chapter.ChapterRecall().retrieve({run:five,query:'Go.',signal:controller.signal}),e=>e.code==='CANCELLED');
 five.narrative.chapters.push(structuredClone(five.narrative.chapters[0]));const r=await new chapter.ChapterRecall().retrieve({run:five,query:'Go.'});assert.equal(selected(r).length,5);assert.equal(new Set(selected(r).map(s=>s.summaryId)).size,5);
});
test('local recall: private, cross-run, retired and changed source versions never enter small-set payload',async()=>{
 for(const kind of ['private','cross_run','retired','version']){
  const run=await small(),s=run.narrative.chapterSummaries[0];if(kind==='private')s.visibility='characters';if(kind==='cross_run')s.runId='other';if(kind==='retired')s.current=false;if(kind==='version')s.chapterVersion++;
  const r=await new chapter.ChapterRecall().retrieve({run,query:'Go.'});assert(!selected(r).some(x=>x.summaryId===s.id));assert(r.recentDialogue.some(t=>t.turn===1));
 }
});
test('local recall: restart/exportrestore and rollback use only current source versions without persisted vector grants',async()=>{
 const run=await small(),restored=validateRunBundle(encodeRunBundle(run)),first=await new chapter.ChapterRecall().retrieve({run,query:'Go.'}),cold=await new chapter.ChapterRecall().retrieve({run:restored,query:'Go.'});assert.deepEqual(selected(first),selected(cold));
 const rolled=structuredClone(run);rolled.turns=rolled.turns.slice(0,12);rolled.head=rolled.turns.at(-1).commitId;rolled.version++;
 const r=await new chapter.ChapterRecall().retrieve({run:rolled,query:'Go.'});assert.equal(selected(r).length,4);assert(selected(r).every(s=>s.endTurn<=12));assert.equal(r.diagnostics.query.sourceHead,rolled.head);
});
test('local recall: Host readiness agrees small valid set needs no embedding/rerank configuration or probing',async()=>{
 const run=await small();run.narrative.chapterSettings.autoEnabled=true;const root=await mkdtemp(join(tmpdir(),'small-chapter-readiness-')),store=new DurableStore({root});await store.create(run);
 const model={async generate(){assert.fail('No model on status read');}},engine=new TemporalFixtureEngine({store,model,chapterRecall:new chapter.ChapterRecall(),memory:{async retrieve(){assert.fail('No memory query on status read');}}}),host=await new SceanHost({engine,root:join(root,'host'),chapterModelsEnabled:false,worldRoutineAutomatic:false}).init();
 try{const s=await host.chapterStatus({runId:run.runId});assert.equal(s.contextReadiness.status,'ready');assert.equal(s.contextReadiness.selectionPolicy,'all_older_within_8');assert.equal(s.contextReadiness.providerConnectivity,'not_probed');}finally{await host.close();}
});
test('local recall: real stage assembly and saved delivery receipts match for SingleWriter and Draft, without changing Prose contract',async()=>{
 for(const mode of ['single_writer','legacy']){
  const run=await small(),root=await mkdtemp(join(tmpdir(),'small-chapter-')),store=new DurableStore({root}),calls=[],ports=chapterRecallPorts({overrideRerank:zero});await store.create(run);
  const model={async describe(){return{capabilities:{contextWindow:1000000}};},async generate(a){calls.push(structuredClone({stage:a.stage,input:a.input}));
   if(a.stage==='director')return{text:JSON.stringify({handoffVersion:1,sceneIntent:'Continue the public scene.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]})};
   if(['writer','draft','prose'].includes(a.stage))return{text:'The crew continued their public task.'};
   if(a.stage==='post_stat')return{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};throw Error('Unexpected '+a.stage);
  }};
  const engine=new TemporalFixtureEngine({postBody:false,...(mode==='legacy'?{unconfiguredWritingMode:'current'}:{}),store,model,chapterRecall:new chapter.ChapterRecall({...ports}),memory:{async retrieve(){return{records:[]};}}});
  await engine.turn({runId:run.runId,requestId:'small-'+mode,input:'Continue.',chapterContextEnabled:true});
  const d=calls.find(c=>c.stage==='director').input.assembly,w=calls.find(c=>c.stage===(mode==='legacy'?'draft':'writer')).input.context;
  assert.deepEqual(d.chapterContext,w.chapterContext);assert.equal(d.chapterContext.retrieved.length,2);assert(d.chapterContext.retrieved.some(s=>s.chapterId==='d-chapter-1'));assert.equal(ports.calls.length,0);
  const a=(await store.readAttempts(run.runId)).at(-1),uses=a.stages.filter(s=>['director','writer','draft'].includes(s.stage)).map(s=>s.narrativeUse);
  assert(uses.every(u=>u.summaryStatus==='included'&&u.chapterSummaries.length===5&&u.deliveryStatus==='completed_port_call'));
  assert.equal(uses[0].chapterContextHash,uses[1].chapterContextHash);assert(uses.every(u=>u.chapterSummaries.every(s=>s.textSha256&&s.summaryVersion===1)));
  if(mode==='legacy'){assert(calls.some(c=>c.stage==='prose'));assert(!calls.find(c=>c.stage==='prose').input.chapterContext);}
 }
});
test('local recall: existing packet limit fails clearly with selected chapter receipt and never claims dispatch',async()=>{
 const run=await small(),r=await new chapter.ChapterRecall().retrieve({run,query:'Go.'}),packet={chapterContext:{mode:'chapter_3_plus_8',status:r.diagnostics.status,recent:r.recent,retrieved:r.retrieved},recentDialogue:[]};
 const receipt=chapter.chapterContextReceipt(packet,'blocked_capacity');assert.equal(receipt.chapterSummaries.length,5);assert.equal(receipt.deliveryStatus,'blocked_capacity');
 assert.throws(()=>budgetStage('director',{system:'x'.repeat(16*1024*1024),input:{assembly:packet,conversation:[]}},{}),e=>e.code==='CONTEXT_PACKET_TOO_LARGE'&&e.diagnostics.status==='blocked'&&e.diagnostics.packetLimitBytes===16*1024*1024);
});

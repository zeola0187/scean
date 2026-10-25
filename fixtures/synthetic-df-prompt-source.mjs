import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syntheticLongrun,D_PRIVATE} from './synthetic-longrun-d.mjs';
import {hash} from '../core/contracts.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine as SceanEngine} from './temporal-fixture-engine.mjs';
import {ChapterRecall} from '../core/chapter-recall.mjs';
import * as narrative from '../core/narrative.mjs';
import {updateChapterSettings,backfillChapterSummary} from '../core/chapter-summary.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {estimateContextTokens} from '../core/context-budget.mjs';
import {constructTemporalFixture} from './temporal-history.mjs';
import {Memory} from '../core/memory.mjs';

export const DF_BODY='The public crew checked the chart. The copper compass promise and unfinished calibration task remain recorded.';
export const DF_SUMMARY='The copper compass must be returned. Calibration remains unfinished. These public facts do not disclose private equipment details.';
const INPUT='Continue the same public watch.';
const clone=structuredClone;

// Direct synthetic construction, then exact production bundle validation. This
// controls source text lengths so metadata growth cannot hide behind prose size.
export function promptSource(turns,{chapters=0}={}){
  const run=syntheticLongrun({turns,runId:'synthetic-df-prompt-run'});
  for(const t of run.turns){t.input=INPUT;t.body=DF_BODY;t.bodyHash=hash(DF_BODY);const receipt=run.receipts[t.requestId];receipt.inputHash=hash(INPUT);receipt.result.body=DF_BODY;for(const rows of [run.memories,run.playerHistory,receipt.result.memories,receipt.result.playerHistory])for(const row of rows)if(row.source.commitId===t.commitId)row.source.bodyHash=t.bodyHash;}
  if(chapters){
    assert(Number.isInteger(chapters)&&chapters>=1&&chapters<=Math.min(100,turns));
    const ends=Array.from({length:chapters},(_,i)=>Math.floor(turns*(i+1)/chapters));
    run.narrative={schemaVersion:1,currentSummaryId:null,summaries:[],chapters:[],operations:{}};
    for(const t of run.turns){t.commitVersion=t.turn+ends.filter(end=>end<t.turn).length;run.receipts[t.requestId].result.version=t.commitVersion;}
    let startTurn=1;
    for(let i=0;i<chapters;i++){
      const endTurn=ends[i],selected=run.turns.slice(startTurn-1,endTurn),commitIds=selected.map(t=>t.commitId),sourceHashes=selected.map(narrative.narrativeSourceHash),operationId=`df-chapter-op-${i+1}`,baseHead=selected.at(-1).commitId,baseVersion=endTurn+i,title='Synthetic public watch',chapterId=`df-chapter-${i+1}`,createdAt=run.createdAt;
      const request={kind:'chapter',runId:run.runId,operationId,expectedVersion:baseVersion,expectedHead:baseHead,title};
      run.narrative.chapters.push({id:chapterId,runId:run.runId,version:1,order:i+1,title,startTurn,endTurn,commitIds,sourceHashes,sourceHash:hash({commitIds,sourceHashes}),baseHead,baseVersion,perspective:'public_story',visibility:'public',status:'completed',current:true,summaryId:null,summaryVersion:null,provenance:{operationId,algorithm:'explicit-host-close-v1',createdAt}});
      run.narrative.operations[operationId]={kind:'chapter',operationId,request,fingerprint:hash(request),status:'completed',finishedAt:createdAt,result:{status:'completed',operationId,chapterId,version:baseVersion+1,head:baseHead}};startTurn=endTurn+1;
    }
    run.version=turns+chapters;
  }
  // Rebuild synthetic temporal receipts after this constructor changes the
  // historical inputs and commit versions; production rejects these changes.
  constructTemporalFixture(run);validateRunBundle(encodeRunBundle(run));return run;
}
async function request(store,runId,operationId,extra={}){const run=await store.read(runId);return{runId,operationId,expectedVersion:run.version,expectedHead:run.head,...extra};}
export async function measurePromptCost(turns,{chapters=0,backfill=false,withChapterContext=false}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-df-prompt-')),store=new DurableStore({root}),run=promptSource(turns,{chapters}),observations=[],chapterContextObservations=[],singleWriterContextObservations=[],stageCounts={};let singleWriterActive=false,syntheticEmbeddingCalls=0;
  const model={async generate(p){
    stageCounts[p.stage]=(stageCounts[p.stage]??0)+1;
    if(p.stage==='chapter_rerank')return {text:JSON.stringify({rankings:p.input.candidates.map((_,index)=>({index,score:100-index}))}),model:'deterministic-local-rerank'};
    if(p.stage==='summary')return{text:DF_SUMMARY,model:'deterministic-local-df'};
    if(p.stage==='chapter_summary')return{text:JSON.stringify({title:'Synthetic public watch',summary:'DF_CHAPTER_SUMMARY_CANARY: a local public watch.',keywords:['compass'],characters:['kalt'],locations:[],plotThreads:['unfinished calibration'],emotionalTone:null}),model:'deterministic-local-df'};
    if(['director','draft'].includes(p.stage)||(singleWriterActive&&p.stage==='writer')){
      const packet=p.input.assembly??p.input.context,rolling=packet.rollingSummary;if(packet.chapterContext){assert.equal(rolling,undefined);assert(!JSON.stringify(p.input).includes(D_PRIVATE));(singleWriterActive?singleWriterContextObservations:chapterContextObservations).push({memoryIds:packet.memory?.records?.map(r=>r.id)??[],candidateRef:packet.temporal?.candidateRef,stage:p.stage,recentChapters:packet.chapterContext.recent.length,retrievedChapters:packet.chapterContext.retrieved.length,selectedSummaryIds:[...packet.chapterContext.recent,...packet.chapterContext.retrieved].map(r=>r.summaryId),uncoveredTurns:packet.recentDialogue.map(t=>t.turn),inputBytes:Buffer.byteLength(JSON.stringify(p.input))});}else{assert(rolling,'selected rolling summary reaches actual model port');assert.equal(rolling.text,DF_SUMMARY);
      assert(!JSON.stringify(p.input).includes(D_PRIVATE));assert(!JSON.stringify(p.input).includes('DF_CHAPTER_SUMMARY_CANARY'));assert(!Object.hasOwn(packet,'chapterSummaries'));
      const metadata=Object.fromEntries(Object.entries(rolling).filter(([key])=>key!=='text'));
      observations.push({stage:p.stage,rollingMetadataBytes:Buffer.byteLength(JSON.stringify(metadata)),rollingMetadataEstimate:estimateContextTokens(metadata),rollingBytes:Buffer.byteLength(JSON.stringify(rolling)),inputBytes:Buffer.byteLength(JSON.stringify(p.input)),inputEstimate:estimateContextTokens(p.input),rollingKeys:Object.keys(rolling).sort(),recentCount:packet.recentDialogue.length,summaryId:rolling.id,sourceCountDelivered:rolling.commitIds?.length??0});
    }}
    if(p.stage==='director')return{text:singleWriterActive?JSON.stringify(p.input.handoffContract.example):'Continue the public watch.'};if(p.stage==='draft'||p.stage==='prose'||p.stage==='writer')return{text:DF_BODY};if(p.stage==='post_stat')return{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};throw Error('Unexpected synthetic stage '+p.stage);
  }};
  const chapterRecall=withChapterContext?new ChapterRecall({embed:async({texts})=>{syntheticEmbeddingCalls++;return texts.map(()=>[1,0]);},rerankModel:model,embeddingModel:'scripted-large-history'}):undefined;
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,chapterRecall,memory:{async retrieve(){return{records:[]};},clearCache(){}}});await store.create(run);
  for(let end=50;;end+=50){const endTurn=Math.min(end,turns-6);await narrative.updateSummary(engine,await request(store,run.runId,`df-summary-${endTurn}`,{endTurn}),{enabled:true,model});if(endTurn===turns-6)break;}
  if(backfill){
    await updateChapterSettings(engine,await request(store,run.runId,'df-settings',{settings:{autoEnabled:false,detail:'auto',tokenThreshold:16000,bufferTurns:6}}));
    for(const chapter of (await store.read(run.runId)).narrative.chapters)await backfillChapterSummary(engine,await request(store,run.runId,`df-fill-${chapter.order}`,{chapterId:chapter.id}),{enabled:true,model});
  }
  const before=await store.read(run.runId),summary=narrative.selectNarrative(before).summary;if(backfill){assert.equal(before.narrative.chapterSummaries.length,chapters);assert(before.narrative.chapterSummaries.every(s=>s.current&&s.status==='completed'));}assert.equal(summary.commitIds.length,turns-6);const sourceHash=hash({commitIds:summary.commitIds,sourceHashes:summary.sourceHashes});assert.equal(sourceHash,summary.sourceHash);validateRunBundle(encodeRunBundle(before));
  await engine.regenerate(await request(store,run.runId,'df-prompt-regenerate',{requestId:'df-new-last-turn'}));
  const after=await store.read(run.runId),kept=after.narrative.summaries.find(s=>s.id===summary.id);assert.deepEqual(kept.commitIds,summary.commitIds);assert.deepEqual(kept.sourceHashes,summary.sourceHashes);assert.equal(kept.sourceHash,sourceHash);assert(after.memories.some(m=>m.text===D_PRIVATE));assert.equal(after.snapshot.hash,before.snapshot.hash);validateRunBundle(encodeRunBundle(after));
  if(withChapterContext){await engine.regenerate({...await request(store,run.runId,'df-chapter-context-regenerate',{requestId:'df-context-last-turn'}),chapterContextEnabled:true});validateRunBundle(encodeRunBundle(await store.read(run.runId)));}
  if(withChapterContext){
    singleWriterActive=true;
    const memory=new Memory({dimensions:2,embed:async({texts})=>{syntheticEmbeddingCalls++;return texts.map(()=>[1,0]);}});
    const currentEngine=new SceanEngine({store,model,chapterRecall,memory});
    await currentEngine.regenerate({...await request(store,run.runId,'df-current-writer-context',{requestId:'df-current-writer-turn'}),chapterContextEnabled:true});
    const current=await store.read(run.runId);validateRunBundle(encodeRunBundle(current));
    assert.deepEqual(singleWriterContextObservations.map(p=>p.stage),['director','writer']);
    assert(singleWriterContextObservations.every(p=>p.memoryIds.length>0),'current Memory.retrieve must deliver ACL-filtered public records');
    assert.equal(singleWriterContextObservations[0].candidateRef,singleWriterContextObservations[1].candidateRef);
    for(const key of ['selectedSummaryIds','uncoveredTurns','memoryIds'])assert.deepEqual(singleWriterContextObservations[0][key],singleWriterContextObservations[1][key],key+' must be identical for Director and Single Writer');
  }
  return{activeTurns:turns,predecessorTurns:turns-1,chapters,backfilled:backfill,sourceCommitCount:summary.commitIds.length,hostSourceHash:sourceHash,stageCounts,observations,chapterContextObservations,singleWriterContextObservations,syntheticEmbeddingCalls,paidCalls:0,embeddingCalls:0,aggregateBytes:Buffer.byteLength(JSON.stringify(before))};
}

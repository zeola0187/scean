import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';
import {selectNarrative,validateNarrative} from '../core/narrative.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash} from '../core/contracts.mjs';

// No provider, network, GenerationGate, embedding or private Run is used here.
const code=c=>e=>e.code===c;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const authority=r=>hash(Object.fromEntries(['head','turns','state','memories','snapshot','playerHistory','receipts','operationReceipts','stateProvenance'].map(k=>[k,r[k]])));
const archive={title:'合成章節',summary:'合成船員承諾歸還羅盤，校準仍未完成。',keywords:['羅盤'],characters:[],locations:[],plotThreads:['校準'],emotionalTone:'平靜'};
async function fixture({turns=16,bodyRepeats=20,summaryEnabled=true,override}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-auto-summary-')),store=new DurableStore({root:join(root,'store')}),run=syntheticLongrun({turns,bodyRepeats,runId:'auto-synthetic'}),calls=[];
  const model={async describe(){return {capabilities:{contextWindow:200000,outputLimit:4096}};},async generate(a){calls.push({stage:a.stage,input:structuredClone(a.input),context:structuredClone(a.context),signal:a.signal});const custom=await override?.(a);if(custom!==undefined)return custom;
    if(a.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:a.input.range.endTurn-1||1,suggestedTitle:'合成自然終點',keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'平靜',significantEvents:[]}),model:'scripted-analysis',usage:{inputTokens:10,outputTokens:10,costUSD:0}};
    if(a.stage==='chapter_summary')return {text:JSON.stringify(archive),model:'scripted-archive',usage:{inputTokens:20,outputTokens:20,costUSD:0}};
    if(a.stage==='summary')return {text:'SCRIPTED_CUMULATIVE_ROLLING: the compass promise and calibration remain open.',model:'scripted-rolling',usage:{inputTokens:30,outputTokens:30,costUSD:0}};
    if(a.stage==='director')return {text:'Continue the synthetic public watch.'};
    if(a.stage==='draft'||a.stage==='prose')return {text:'The synthetic public crew waited at the dock.'};
    if(a.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};
    throw Error('Unexpected scripted stage '+a.stage);
  }};
  await store.create(run);const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:{async retrieve(){return {records:[]};}}}),hostRoot=join(root,'host');
  const host=await new SceanHost({engine,root:hostRoot,summaryEnabled,chapterModelsEnabled:true}).init();return {root,hostRoot,store,engine,host,model,run,calls};
}
async function args(f,operationId,extra={}){const r=await f.store.read(f.run.runId);return {runId:r.runId,operationId,expectedVersion:r.version,expectedHead:r.head,...extra};}
async function arm(f,{bufferTurns=2,tokenThreshold=4000,operationId='arm-writer',viaJobs=false}={}){
  const request=await args(f,operationId,{settings:{autoEnabled:true,bufferTurns,tokenThreshold,detail:'auto'},writerSummaryEnabled:true});
  const before=f.calls.length;
  const value=viaJobs?await f.host.jobs.submit({...request,kind:'chapterSettings',baseVersion:request.expectedVersion,baseHead:request.expectedHead}):await f.host.chapterSettings(request);
  for(let i=0;i<500&&(f.host.jobs.active.has(f.run.runId)||f.host.auxRunning.has(f.run.runId));i++)await wait(10);
  assert.equal(f.calls.length,before,'settings save alone never dispatches a model');
  // These fixtures already contain committed turns. Simulate the existing
  // post-commit notification separately; it is no longer a settings side effect.
  const run=await f.store.read(f.run.runId);f.host.scheduleChapterAfterTurn(run.runId,run.head);
  return viaJobs?{...value,request}:value;
}
async function idle(f){for(let i=0;i<500;i++){if(!f.host.chapterBackground?.size&&!f.host.mutationBusy(f.run.runId))return;await wait(10);}throw Error('Synthetic background work did not settle');}
const backgroundCalls=f=>f.calls.filter(c=>['chapter_analysis','chapter_summary','summary'].includes(c.stage));

test('AUTO explicit UI job consent reaches Host; natural boundary feeds one rolling call and actual Director/Draft payload',async()=>{
  const f=await fixture();try{
    const before=authority(await f.store.read(f.run.runId)),submitted=await arm(f,{viaJobs:true});await idle(f);
    const run=await f.store.read(f.run.runId);assert.equal(authority(run),before);assert.equal(validateNarrative(run),true);validateRunBundle(encodeRunBundle(run));
    assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['chapter_analysis','chapter_summary','summary']);
    const [analysis,chapter,rolling]=backgroundCalls(f),end=chapter.input.range.endTurn;
    assert.equal(analysis.input.range.endTurn,14);assert.equal(end,13);assert.equal(rolling.input.sourceRange.endTurn,end);assert.equal(rolling.input.turns.at(-1).turn,end);
    assert.equal(run.narrative.summaries[0].provenance.usage.costUSD,0);assert.equal(run.narrative.chapterSummaries[0].endTurn,end);
    assert(!JSON.stringify(backgroundCalls(f)).includes(D_PRIVATE));
    await f.host.jobs.submit({...submitted.request,kind:'chapterSettings'});await idle(f);assert.equal(backgroundCalls(f).length,3);
    await assert.rejects(f.host.jobs.submit({...submitted.request,kind:'chapterSettings',writerSummaryEnabled:false}),code('OPERATION_ID_CONFLICT'));
    await f.host.turn({runId:run.runId,requestId:'writer-next',input:'Continue synthetic watch.'});await idle(f);
    for(const stage of ['director','draft']){const p=f.calls.find(c=>c.stage===stage).input,packet=p.assembly??p.context;assert.equal(packet.rollingSummary.endTurn,end);assert.deepEqual(packet.recentDialogue.map(t=>t.turn),[14,15,16]);assert(!Object.hasOwn(packet,'chapterSummaries'));assert(!JSON.stringify(packet).includes(archive.summary));}
    assert.equal(backgroundCalls(f).length,3);
  }finally{await f.host.close();}
});

test('AUTO below threshold adds zero analysis or compression; explicit post-turn scheduling later completes',async()=>{
  const long='合成'.repeat(1800),f=await fixture({turns:2,bodyRepeats:0,override:a=>{
    if(a.stage==='draft'||a.stage==='prose')return {text:long};
    if(a.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:a.input.range.endTurn,suggestedTitle:null,keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]})};
  }});try{
    await arm(f,{bufferTurns:1});await idle(f);assert.equal(f.calls.length,0);
    const one=await f.host.turn({runId:f.run.runId,requestId:'long-one',input:'First synthetic watch.'});await idle(f);assert.equal(one.status,'committed');assert.equal(backgroundCalls(f).length,0);
    const two=await f.host.turn({runId:f.run.runId,requestId:'long-two',input:'Second synthetic watch.'});await idle(f);assert.equal(two.status,'committed');assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['chapter_analysis','chapter_summary','summary']);
    const run=await f.store.read(f.run.runId);assert.equal(selectNarrative(run).summary.endTurn,3);assert.equal(run.head,two.commitId);
  }finally{await f.host.close();}
});

test('AUTO requires separate summary capability and fresh consent; legacy auto settings cannot grant it',async()=>{
  const f=await fixture({summaryEnabled:false});try{
    await assert.rejects(arm(f),code('SUMMARY_DISABLED'));assert.equal(f.calls.length,0);
    await f.host.chapterSettings(await args(f,'legacy-arm',{settings:{autoEnabled:true,bufferTurns:2,tokenThreshold:4000,detail:'auto'}}));
    const state=await f.host.chapterStatus({runId:f.run.runId});assert.equal(state.autoArmed,true);assert.equal(state.writerSummaryArmed,false);assert.equal(backgroundCalls(f).length,0);
  }finally{await f.host.close();}
});

test('AUTO no natural endpoint creates neither archive nor rolling summary and honors cooldown',async()=>{
  const f=await fixture({override:a=>a.stage==='chapter_analysis'?{text:JSON.stringify({shouldCreateChapter:false,optimalEndTurn:a.input.range.endTurn,suggestedTitle:null,keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]})}:undefined});try{
    await arm(f);await idle(f);assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['chapter_analysis']);
    await f.host.turn({runId:f.run.runId,requestId:'no-endpoint-next',input:'Continue synthetic scene.'});await idle(f);assert.equal(backgroundCalls(f).length,1);
    const run=await f.store.read(f.run.runId);assert.equal(run.narrative.currentSummaryId,null);assert.equal(selectNarrative(run).recentDialogue.length,17);
  }finally{await f.host.close();}
});

test('AUTO zero chapter buffer still protects one rolling original and catches up without reanalysis',async()=>{
  const f=await fixture({override:a=>a.stage==='chapter_analysis'?{text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:a.input.range.endTurn,suggestedTitle:null,keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]})}:undefined});try{
    await arm(f,{bufferTurns:0});await idle(f);let run=await f.store.read(f.run.runId);assert.equal(run.narrative.chapters[0].endTurn,16);assert.equal(selectNarrative(run).summary.endTurn,15);
    await f.host.turn({runId:run.runId,requestId:'after-zero-buffer',input:'Continue after the closed scene.'});await idle(f);run=await f.store.read(run.runId);
    assert.equal(selectNarrative(run).summary.endTurn,16);assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['chapter_analysis','chapter_summary','summary','summary']);validateRunBundle(encodeRunBundle(run));
  }finally{await f.host.close();}
});

for(const failure of ['MODEL_TIMEOUT','SYNTHETIC_SUMMARY_FAILURE'])test(`AUTO ${failure} disarms without undoing a committed story or blind retry`,async()=>{
  const f=await fixture({override:a=>{if(a.stage==='summary')throw Object.assign(Error('scripted failure'),{code:failure});}});try{
    await arm(f);await idle(f);const after=await f.store.read(f.run.runId),state=await f.host.chapterStatus({runId:f.run.runId});
    assert.equal(after.narrative.chapterSummaries.length,1);assert.equal(after.narrative.currentSummaryId,null);assert.equal(state.writerSummaryArmed,false);assert.equal(state.automaticFailure.code,failure);
    const committed=await f.host.turn({runId:f.run.runId,requestId:'after-summary-failure',input:'Continue with complete bounded originals.'});await idle(f);
    assert.equal(committed.status,'committed');assert.equal(backgroundCalls(f).length,3);assert.equal((await f.store.read(f.run.runId)).head,committed.commitId);
  }finally{await f.host.close();}
});

test('AUTO pending rolling is visible and cancellable by exact identity across pages; late output cannot publish',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async a=>{if(a.stage==='summary'){began.resolve();await release.promise;return {text:'LATE_CANCELLED_ROLLING'};}}});try{
    await arm(f);await began.promise;const run=await f.store.read(f.run.runId),op=Object.values(run.narrative.operations).find(o=>o.kind==='summary');
    const progress=await f.host.progress(run.runId);assert.equal(progress.operationId,op.operationId);assert.equal(progress.kind,'summaryStart');assert.equal(progress.pending,true);
    assert.equal((await f.host.jobs.status({runId:run.runId,operationId:op.operationId})).pending,true);
    await assert.rejects(f.host.turn({runId:run.runId,requestId:'other-page-turn',input:'Must wait.'}),code('RUN_BUSY'));
    assert.equal(f.host.summaryCancel({runId:run.runId,operationId:'wrong-summary-id'}).cancelRequested,false);
    assert.equal(f.host.summaryCancel({runId:run.runId,operationId:op.operationId}).cancelRequested,true);await idle(f);release.resolve();await wait(20);
    const done=await f.store.read(run.runId);assert.equal(done.narrative.currentSummaryId,null);assert.equal(done.narrative.operations[op.operationId].status,'cancelled');assert.equal(f.calls.find(c=>c.stage==='summary').signal.aborted,true);assert.equal(done.turns.length,16);
  }finally{release.resolve();await f.host.close();}
});

test('AUTO restart recovers pending once, never replays models or re-arms via settings receipt',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async a=>{if(a.stage==='summary'){began.resolve();await release.promise;return {text:'LATE_PRE_RESTART'};}}});let restarted;
  try{
    const consent=await args(f,'restart-arm',{settings:{autoEnabled:true,bufferTurns:2,tokenThreshold:4000,detail:'auto'},writerSummaryEnabled:true});await f.host.chapterSettings(consent);assert.equal(f.calls.length,0);f.host.scheduleChapterAfterTurn(f.run.runId,(await f.store.read(f.run.runId)).head);await began.promise;
    restarted=await new SceanHost({engine:f.engine,root:f.hostRoot,summaryEnabled:true,chapterModelsEnabled:true}).init();
    assert.equal((await restarted.chapterStatus({runId:f.run.runId})).writerSummaryArmed,false);await restarted.chapterSettings(consent);assert.equal((await restarted.chapterStatus({runId:f.run.runId})).writerSummaryArmed,false);
    release.resolve();await idle(f);const run=await f.store.read(f.run.runId),op=Object.values(run.narrative.operations).find(o=>o.kind==='summary');assert.equal(op.status,'failed');assert.equal(op.result.code,'SUMMARY_INTERRUPTED_NO_AUTORETRY');assert.equal(run.narrative.currentSummaryId,null);assert.equal(backgroundCalls(f).length,3);assert.equal(validateNarrative(run),true);
  }finally{release.resolve();await restarted?.close();await f.host.close();}
});

test('AUTO explicit fresh re-arm retries only the failed rolling range without repeating chapter stages',async()=>{
  let failures=1;const f=await fixture({override:a=>{if(a.stage==='summary'&&failures-->0)throw Object.assign(Error('one scripted failure'),{code:'MODEL_TIMEOUT'});}});try{
    await arm(f);await idle(f);assert.equal(selectNarrative(await f.store.read(f.run.runId)).summary,null);
    await arm(f,{operationId:'fresh-consent-after-review'});await idle(f);
    assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['chapter_analysis','chapter_summary','summary','summary']);
    const run=await f.store.read(f.run.runId);assert.equal(selectNarrative(run).summary.endTurn,13);assert.equal(validateNarrative(run),true);
  }finally{await f.host.close();}
});

test('AUTO external rollback during rolling makes late result stale without altering the new head',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async a=>{if(a.stage==='summary'){began.resolve();await release.promise;return {text:'LATE_STALE_ROLLING'};}}});try{
    await arm(f);await began.promise;await f.engine.rollback(await args(f,'external-rollback'));
    const head=(await f.store.read(f.run.runId)).head;release.resolve();await idle(f);
    const run=await f.store.read(f.run.runId),op=Object.values(run.narrative.operations).find(o=>o.kind==='summary');assert.equal(run.head,head);assert.equal(op.status,'stale');assert.equal(run.narrative.currentSummaryId,null);assert.equal(validateNarrative(run),true);
  }finally{release.resolve();await f.host.close();}
});

for(const point of ['beforeRename','afterRename','unknown'])test(`AUTO ${point} final-save outcome preserves story, source validation and zero automatic resends`,async()=>{
  const f=await fixture(),originalRead=f.store.read.bind(f.store);let readFailures=0,hit=false;
  f.store.read=async(...a)=>{if(readFailures-->0)throw Object.assign(Error('scripted read outage'),{code:'EIO'});return originalRead(...a);};
  f.store.fault=(p,{data})=>{if(!hit&&p===(point==='unknown'?'afterRename':point)&&Object.values(data.narrative?.operations??{}).some(o=>o.kind==='summary'&&o.status==='completed')){hit=true;if(point==='unknown')readFailures=2;throw Object.assign(Error('scripted save fault'),{code:'EIO'});}};
  try{
    const before=authority(await originalRead(f.run.runId));await arm(f);await idle(f);assert(hit);const run=await originalRead(f.run.runId);assert.equal(authority(run),before);assert.equal(validateNarrative(run),true);
    assert.equal(run.narrative.summaries.length,point==='beforeRename'?0:1);if(point!=='afterRename')assert.equal(f.host.writerSummaryArmed.has(run.runId),false);
    f.store.fault=null;await f.host.turn({runId:run.runId,requestId:'after-save-fault',input:'Continue synthetic watch.'});await idle(f);assert.equal(backgroundCalls(f).length,3);
  }finally{await f.host.close();}
});

test('AUTO known closed range catches up without duplicate chapter analysis; one bounded delta per activation',async()=>{
  const f=await fixture({turns:100,bodyRepeats:0});try{
    await f.host.chapterClose(await args(f,'legacy-close',{title:'Synthetic legacy archive'}));
    await arm(f,{bufferTurns:2});await idle(f);assert.deepEqual(backgroundCalls(f).map(c=>c.stage),['summary']);assert.equal(selectNarrative(await f.store.read(f.run.runId)).summary.endTurn,50);
    await arm(f,{bufferTurns:2,operationId:'catchup-second'});await idle(f);assert.equal(backgroundCalls(f).length,2);assert.equal(selectNarrative(await f.store.read(f.run.runId)).summary.endTurn,100-2);
  }finally{await f.host.close();}
});

test('AUTO two Runs isolate sources, operation IDs and cancellation',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async a=>{if(a.stage==='summary'&&a.context.runId==='auto-synthetic'){began.resolve();await release.promise;return {text:'FIRST_RUN_ONLY'};}}});try{
    const second=syntheticLongrun({turns:16,bodyRepeats:20,runId:'second-auto-synthetic'});await f.store.create(second);await f.host.refreshRuns();
    await arm(f);await began.promise;const other={...f,run:second};await arm(other);for(let i=0;i<300&&f.host.chapterBackground?.size>1;i++)await wait(10);
    const secondRun=await f.store.read(second.runId);assert.equal(secondRun.narrative.summaries.length,1);assert(secondRun.narrative.summaries.every(s=>s.runId===second.runId));
    const firstRun=await f.store.read(f.run.runId),firstOp=f.host.summaryRunning.get(firstRun.runId);
    assert.equal(f.host.summaryCancel({runId:second.runId,operationId:firstOp.operationId}).cancelRequested,false);assert.equal(f.host.summaryCancel({runId:f.run.runId,operationId:firstOp.operationId}).cancelRequested,true);await idle(f);assert.equal((await f.store.read(second.runId)).narrative.summaries.length,1);
  }finally{release.resolve();await f.host.close();}
});

test('AUTO rollback invalidates affected summary sources and retains portable retirement audit',async()=>{
  const f=await fixture();try{
    await arm(f);await idle(f);const first=selectNarrative(await f.store.read(f.run.runId)).summary;
    for(let i=0;i<4;i++)await f.host.historyMutation('rollback',{...await args(f,'rollback-'+i),confirmation:'rollback-last-committed-turn'});
    const run=await f.store.read(f.run.runId);assert.equal(selectNarrative(run).summary,null);assert.equal(run.narrative.summaries.find(s=>s.id===first.id).status,'stale');assert.equal(validateNarrative(run),true);validateRunBundle(encodeRunBundle(run));
  }finally{await f.host.close();}
});

test('AUTO same-text regeneration at a covered endpoint invalidates the original summary by commit identity',async()=>{
  const f=await fixture();try{
    await arm(f);await idle(f);
    for(let i=0;i<3;i++)await f.host.historyMutation('rollback',{...await args(f,'prepare-regenerate-'+i),confirmation:'rollback-last-committed-turn'});
    const before=await f.store.read(f.run.runId),old=selectNarrative(before).summary,body=before.turns.at(-1).body,generate=f.model.generate;
    assert.equal(old.endTurn,13);f.model.generate=async a=>['draft','prose'].includes(a.stage)?{text:body}:generate(a);
    await f.host.historyMutation('regenerate',await args(f,'replace-covered-endpoint',{requestId:'same-text-replacement'}));
    const after=await f.store.read(f.run.runId);assert.equal(after.turns.at(-1).body,body);assert.notEqual(after.head,before.head);assert.equal(selectNarrative(after).summary,null);assert.equal(after.narrative.summaries.find(s=>s.id===old.id).status,'stale');validateRunBundle(encodeRunBundle(after));
  }finally{await f.host.close();}
});

for(const turns of [100,500,1000])test(`AUTO uncovered ${turns}-turn history is complete without a platform token quota`,async()=>{
  const f=await fixture({turns,bodyRepeats:0});try{
    const selected=selectNarrative(await f.store.read(f.run.runId));assert.equal(selected.diagnostics.coverageStatus,'complete');assert.equal(selected.recentDialogue.length,turns);assert.equal(selected.diagnostics.unsummarizedOmittedTurns,0);
    const action=turns===1000?f.engine.regenerate(await args(f,'blocked-regenerate',{requestId:'blocked-replacement'})):f.engine.turn({runId:f.run.runId,requestId:'blocked-long-history',input:'Must explicitly repair coverage.'});
    await action;const packet=f.calls.find(c=>c.stage==='director').input.assembly;assert.equal(packet.recentDialogue.length,turns===1000?999:turns);assert.equal((await f.store.read(f.run.runId)).turns.length,turns===1000?1000:turns+1);
  }finally{await f.host.close();}
});

test('AUTO uncovered 7..50 turns remain complete in actual Writer packets, with explicit diagnostics',async()=>{
  const f=await fixture({turns:12,bodyRepeats:0});try{
    await f.host.turn({runId:f.run.runId,requestId:'complete-tail',input:'Keep every uncovered original.'});
    for(const stage of ['director','draft']){const input=f.calls.find(c=>c.stage===stage).input,p=input.assembly??input.context;assert.deepEqual(p.recentDialogue.map(t=>t.turn),Array.from({length:12},(_,i)=>i+1));}
    const trace=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(trace.assemblyDiagnostics.narrative.coverageStatus,'complete');assert.equal(trace.assemblyDiagnostics.narrative.unsummarizedOmittedTurns,0);assert.equal(trace.assemblyDiagnostics.narrative.expandedBeyondWindow,6);
  }finally{await f.host.close();}
});

test('AUTO large valid original is delivered complete without a platform token quota',async()=>{
 const f=await fixture({turns:1,bodyRepeats:0});try{
  await f.store.withRunLock(f.run.runId,async()=>{const r=await f.store.read(f.run.runId),n=structuredClone(r),t=n.turns[0];t.body='章'.repeat(80000);t.bodyHash=hash(t.body);n.receipts[t.requestId].result.body=t.body;n.memories.filter(m=>m.source.commitId===t.commitId).forEach(m=>m.source.bodyHash=t.bodyHash);n.version++;await f.store.commit(r.runId,r.version,n);});
  await f.host.turn({runId:f.run.runId,requestId:'large-original',input:'Keep the original complete.'});assert.equal(f.calls.find(c=>c.stage==='director').input.assembly.recentDialogue[0].body.length,80000);
 }finally{await f.host.close();}
});

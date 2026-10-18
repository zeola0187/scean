import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SceanEngine} from '../core/engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';
import {hash} from '../core/contracts.mjs';

// Synthetic model port only: no provider/network/embedding or generation gate.
const code=expected=>error=>error.code===expected;
const copy=structuredClone;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const summaryResult=()=>({title:'合成研究船的羅盤約定',summary:'艾兒承諾在北方碼頭歸還銅羅盤，校準工作仍未完成。',keywords:['羅盤','承諾'],characters:['艾兒','希歐'],locations:['北方碼頭'],plotThreads:['歸還羅盤','完成校準'],emotionalTone:'平靜'});
const authority=run=>hash(Object.fromEntries(['runId','head','turns','snapshot','state','memories','playerHistory','stateProvenance','receipts','operationReceipts'].map(k=>[k,run[k]??null])));
async function fixture({enabled=false,rollingEnabled=false,turns=16,bodyRepeats=20,override,empty=false}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-df-host-')),store=new DurableStore({root:join(root,'store')}),calls=[];
  const model={async describe(){return {capabilities:{contextWindow:200000,outputLimit:4096}};},async generate(args){calls.push({stage:args.stage,input:copy(args.input),signal:args.signal});const custom=await override?.(args);if(custom!==undefined)return custom;
    if(args.stage==='chapter_summary')return {text:JSON.stringify(summaryResult()),model:'synthetic-df-host'};
    if(args.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:false,optimalEndTurn:args.input.range.endTurn,suggestedTitle:null,keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]}),model:'synthetic-df-host'};
    if(args.stage==='summary')return {text:'Synthetic rolling summary.',model:'synthetic-df-host'};
    if(args.stage==='director')return {text:'Continue the public watch.'};
    if(args.stage==='draft'||args.stage==='prose')return {text:'The crew waited beside the copper compass.'};
    if(args.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};
    throw Error('Unexpected synthetic stage '+args.stage);
  }};
  const engine=new SceanEngine({store,model,memory:{async retrieve({records}){return {records:copy(records)};}}});
  let run;if(!empty){run=syntheticLongrun({turns,bodyRepeats,runId:'synthetic-df-host'});await store.create(run);}
  const hostRoot=join(root,'host'),host=await new SceanHost({engine,root:hostRoot,chapterModelsEnabled:enabled,summaryEnabled:rollingEnabled}).init();
  return {root,hostRoot,host,engine,store,model,run,calls};
}
async function args(f,operationId,extra={}){const run=await f.store.read(f.run.runId);return {runId:run.runId,operationId,expectedVersion:run.version,expectedHead:run.head,...extra};}
async function configure(f,settings,operationId='configure-chapters'){return f.host.chapterSettings(await args(f,operationId,{settings}));}
async function chapter(f){return f.host.chapterClose(await args(f,'close-synthetic-chapter',{title:'人工固定章名'}));}
async function settled(f,predicate){for(let i=0;i<300;i++){const status=await f.host.chapterStatus({runId:f.run.runId});if(predicate(status))return status;await wait(10);}throw Error('Synthetic chapter operation did not settle within 3 seconds');}

// Tests below target public Host boundaries. Core tests cover source-range details.
test('DF Host chapter model capability defaults disabled independently from rolling summaries',async()=>{
  const f=await fixture({rollingEnabled:true});try{const closed=await chapter(f),before=authority(await f.store.read(f.run.runId));
    assert.equal((await f.host.chapterStatus({runId:f.run.runId})).enabled,false);
    await assert.rejects(f.host.chapterStart('chapterSummarize',await args(f,'disabled-backfill',{chapterId:closed.chapterId})),code('CHAPTER_MODELS_DISABLED'));
    await assert.rejects(f.host.chapterStart('chapterAuto',await args(f,'disabled-auto')),code('CHAPTER_MODELS_DISABLED'));
    assert.equal(f.calls.length,0);assert.equal(authority(await f.store.read(f.run.runId)),before);
  }finally{await f.host.close();}
});

test('DF Host below-threshold auto attempt invokes no model',async()=>{
  const f=await fixture({enabled:true,turns:4,bodyRepeats:0});try{
    await configure(f,{autoEnabled:true,tokenThreshold:4000,bufferTurns:0,detail:'auto'});
    assert.equal((await f.host.chapterStatus({runId:f.run.runId})).autoArmed,true);
    await assert.rejects(f.host.chapterStart('chapterAuto',await args(f,'below-threshold')),error=>error.code==='CHAPTER_NOT_ELIGIBLE'&&error.reason==='below_threshold');
    assert.equal(f.calls.length,0);assert.equal((await f.store.read(f.run.runId)).turns.length,4);
  }finally{await f.host.close();}
});

test('DF explicit settings enable arms only the current Host launch; restart cannot inherit model authority',async()=>{
  const f=await fixture({enabled:true});let restarted;try{
    const request=await args(f,'explicit-arm',{settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'precise'}});
    await f.host.chapterSettings(request);assert.equal((await f.host.chapterStatus({runId:f.run.runId})).autoArmed,true);
    await f.host.close();restarted=await new SceanHost({engine:f.engine,root:f.hostRoot,chapterModelsEnabled:true}).init();
    const state=await restarted.chapterStatus({runId:f.run.runId});assert.equal(state.autoArmed,false);assert.equal(f.calls.length,0);
    await restarted.turn({runId:f.run.runId,input:'Continue after restart.',requestId:'after-restart'});await wait(30);assert.equal(f.calls.filter(c=>c.stage.startsWith('chapter_')).length,0);
    // An explicit enable request in this launch is fresh operator action, including receipt replay.
    await restarted.chapterSettings(request);assert.equal((await restarted.chapterStatus({runId:f.run.runId})).autoArmed,true);
    await restarted.chapterSettings(await args(f,'fresh-arm',{settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'precise'}}));assert.equal((await restarted.chapterStatus({runId:f.run.runId})).autoArmed,true);
    await restarted.chapterSettings(await args(f,'disarm',{settings:{autoEnabled:false,tokenThreshold:4000,bufferTurns:2,detail:'precise'}}));assert.equal((await restarted.chapterStatus({runId:f.run.runId})).autoArmed,false);
  }finally{await restarted?.close();await f.host.close();}
});

test('DF imported auto-enabled settings do not authorize models in a clean destination Host',async()=>{
  const a=await fixture({enabled:true}),b=await fixture({enabled:true,empty:true});try{
    await configure(a,{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'auto'});
    const authorityGrant={allowPrivateSaves:true,principal:'synthetic-test-operator'};
    const bundle=await a.host.exportRun({runId:a.run.runId,acknowledgement:'export-private-run-data'},authorityGrant);
    await b.host.importRun({bundle,acknowledgement:'import-private-run-data'},authorityGrant);
    assert.equal((await b.host.chapterStatus({runId:a.run.runId})).autoArmed,false);assert.equal(b.calls.length,0);
    await b.host.turn({runId:a.run.runId,input:'Continue after import.',requestId:'after-import'});await wait(30);
    assert.equal(b.calls.filter(c=>c.stage.startsWith('chapter_')).length,0);
  }finally{await a.host.close();await b.host.close();}
});

test('DF manual chapter backfill is operation-idempotent and ordinary status excludes private source data',async()=>{
  const f=await fixture({enabled:true});try{
    const closed=await chapter(f),request=await args(f,'backfill-one',{chapterId:closed.chapterId}),before=authority(await f.store.read(f.run.runId));
    const result=await f.host.chapterStart('chapterSummarize',request);assert.equal(result.status,'completed');assert.deepEqual(await f.host.chapterStart('chapterSummarize',request),result);
    assert.equal(f.calls.filter(c=>c.stage==='chapter_summary').length,1);assert.equal(authority(await f.store.read(f.run.runId)),before);
    const status=await f.host.chapterStatus({runId:f.run.runId,chapterId:closed.chapterId}),serialized=JSON.stringify(status);
    assert(!serialized.includes(D_PRIVATE));assert(!serialized.includes('sourceHashes'));assert(!serialized.includes('commitIds'));assert(serialized.includes(summaryResult().summary));
  }finally{await f.host.close();}
});

test('DF exact chapter cancellation rejects another identity and discards late model output',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({enabled:true,override:async args=>{if(args.stage==='chapter_summary'){began.resolve();await release.promise;return {text:JSON.stringify(summaryResult()),model:'synthetic-late'};}}});try{
    const closed=await chapter(f),request=await args(f,'cancel-backfill',{chapterId:closed.chapterId}),before=authority(await f.store.read(f.run.runId)),job=f.host.chapterStart('chapterSummarize',request),rejected=assert.rejects(job,code('CANCELLED'));
    await began.promise;assert.equal(f.host.chapterCancel({runId:f.run.runId,operationId:'unrelated'}).cancelRequested,false);
    assert.equal(f.host.chapterCancel(request).cancelRequested,true);await rejected;release.resolve();await wait(20);
    assert.equal(authority(await f.store.read(f.run.runId)),before);assert.equal(f.calls.length,1);
    const status=await f.host.chapterStatus({runId:f.run.runId});assert(JSON.stringify(status).includes('cancelled'));assert(!JSON.stringify(status).includes(summaryResult().summary));
  }finally{release.resolve();await f.host.close();}
});

test('DF pending chapter operation identity conflicts and Host shutdown aborts its provider signal',async()=>{
  const began=deferred(),release=deferred();let providerSignal;
  const f=await fixture({enabled:true,override:async args=>{if(args.stage==='chapter_summary'){providerSignal=args.signal;began.resolve();await release.promise;return {text:JSON.stringify(summaryResult())};}}});try{
    const closed=await chapter(f),request=await args(f,'shutdown-backfill',{chapterId:closed.chapterId}),job=f.host.chapterStart('chapterSummarize',request),rejected=assert.rejects(job,code('CANCELLED'));await began.promise;
    const duplicate=await f.host.chapterStart('chapterSummarize',request);assert.equal(duplicate.status,'pending');assert.equal(f.calls.length,1);
    await assert.rejects(f.host.chapterStart('chapterSummarize',{...request,detail:'precise'}),code('OPERATION_ID_CONFLICT'));
    await f.host.close();await rejected;assert.equal(providerSignal.aborted,true);release.resolve();await wait(20);
    assert(!JSON.stringify(await f.host.chapterStatus({runId:f.run.runId})).includes(summaryResult().summary));
  }finally{release.resolve();await f.host.close();}
});

test('DF armed post-turn chapter failure is non-fatal to already committed roleplay',async()=>{
  const began=deferred(),f=await fixture({enabled:true,override:args=>{if(args.stage==='chapter_analysis'){began.resolve();throw Object.assign(Error('Synthetic chapter analysis failure'),{code:'SYNTHETIC_ANALYSIS_FAILURE'});}}});try{
    await configure(f,{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'auto'});const result=await f.host.turn({runId:f.run.runId,input:'Continue the watch.',requestId:'successful-roleplay'});
    assert.equal(result.status,'committed');await Promise.race([began.promise,wait(3000).then(()=>{throw Error('No automatic chapter analysis started');})]);
    await settled(f,status=>JSON.stringify(status).includes('failed'));
    const run=await f.store.read(f.run.runId);assert.equal(run.head,result.commitId);assert.equal(run.turns.at(-1).body,'The crew waited beside the copper compass.');assert.equal(run.receipts['successful-roleplay'].result.status,'committed');assert.equal(f.calls.filter(c=>c.stage==='chapter_summary').length,0);
  }finally{await f.host.close();}
});


test('DF successful armed post-turn auto closes only the selected public range and atomically publishes its summary',async()=>{
  const began=deferred(),release=deferred();
  const f=await fixture({enabled:true,override:async args=>{
    if(args.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:true,optimalEndTurn:args.input.range.endTurn-1,suggestedTitle:'A completed watch',keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]}),model:'synthetic-analysis'};
    if(args.stage==='chapter_summary'){began.resolve();await release.promise;return {text:JSON.stringify(summaryResult()),model:'synthetic-summary'};}
  }});try{
    await configure(f,{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'concise'});
    const result=await f.host.turn({runId:f.run.runId,input:'Close this watch.',requestId:'auto-success'});assert.equal(result.status,'committed');
    await Promise.race([began.promise,wait(3000).then(()=>{throw Error('Background summary did not start');})]);
    const pending=await f.store.read(f.run.runId),story=authority(pending);assert.equal(pending.narrative.chapters.length,0);assert.equal(pending.narrative.chapterSummaries.length,0);
    const analysis=f.calls.find(c=>c.stage==='chapter_analysis'),summary=f.calls.find(c=>c.stage==='chapter_summary');
    assert.equal(analysis.input.range.endTurn,pending.turns.length-2);assert.equal(summary.input.range.endTurn,analysis.input.range.endTurn-1);assert.equal(summary.input.detail,'concise');
    assert(analysis.input.turns.every(t=>t.turn<=pending.turns.length-2));assert(summary.input.turns.every(t=>t.turn<=summary.input.range.endTurn));
    for(const input of [analysis.input,summary.input]){const serialized=JSON.stringify(input);assert(!serialized.includes(D_PRIVATE));for(const name of ['stateBefore','stateAfter','memories','playerHistory','rawTrace'])assert(!serialized.includes('"'+name+'"'));}
    release.resolve();await settled(f,status=>status.chapters.length===1&&status.chapters[0].summaryStatus==='completed');
    const done=await f.store.read(f.run.runId);assert.equal(authority(done),story);assert.equal(done.narrative.chapters.length,1);assert.equal(done.narrative.chapterSummaries.length,1);assert.equal(done.narrative.chapters[0].endTurn,summary.input.range.endTurn);
    assert.deepEqual(f.calls.filter(c=>c.stage.startsWith('chapter_')).map(c=>c.stage),['chapter_analysis','chapter_summary']);
    await f.host.turn({runId:f.run.runId,input:'Close this watch.',requestId:'auto-success'});await wait(30);assert.equal(f.calls.filter(c=>c.stage.startsWith('chapter_')).length,2);
  }finally{release.resolve();await f.host.close();}
});

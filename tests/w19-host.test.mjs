import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {headOf} from '../core/history.mjs';
import {hash} from '../core/contracts.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const snapshot={schemaVersion:1,cardId:'w19-synthetic',revision:1,card:{name:'Synthetic shared ship'},worldbook:{entries:[]},preset:{},characters:[{id:'captain',name:'Captain',description:'An explicitly synthetic captain.'}]};
async function fixture(options={}){
  const parent=fileURLToPath(new URL('../evidence/w19-host-temp/',import.meta.url));await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'jobs-')),calls=[];
  const store=new DurableStore({root:join(root,'store'),fault:options.storeFault});
  const model={async describe(){return {capabilities:{contextWindow:200000,outputLimit:4096}};},async generate(args){calls.push(args);const override=await options.override?.(args);if(override!==undefined)return override;
    if(args.stage==='summary')return {text:'The synthetic crew kept watch.',model:'synthetic-w19'};
    if(args.stage==='chapter_summary')return {text:JSON.stringify({title:'Synthetic watch',summary:'The crew kept watch.',keywords:['watch'],characters:['captain'],locations:['deck'],plotThreads:['watch'],emotionalTone:'quiet'}),model:'synthetic-w19'};
    if(args.stage==='chapter_analysis')return {text:JSON.stringify({shouldCreateChapter:false,optimalEndTurn:args.input.range.endTurn,suggestedTitle:null,keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:'quiet',significantEvents:[]}),model:'synthetic-w19'};
    return {text:args.stage==='post_stat'?JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]}):'The synthetic captain watches the quiet deck.'};
  }};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()});
  if(options.longrun)await store.create(syntheticLongrun({turns:16,bodyRepeats:20,runId:'w19-longrun'}));
  const hostRoot=join(root,'host'),host=await new SceanHost({engine,root:hostRoot,summaryEnabled:options.enabled??false,chapterModelsEnabled:options.enabled??false,maxConcurrentOperations:options.maxConcurrentOperations??4,jobLedgerOptions:options.jobLedgerOptions??{}}).init();
  const runId=options.longrun?'w19-longrun':(await host.createRun({snapshot})).runId;
  return {root,hostRoot,host,engine,store,calls,runId};
}
async function submit(f,kind='turn',extra={}){const run=await f.store.read(extra.runId??f.runId);return {action:'operationSubmit',kind,runId:run.runId,operationId:'w19-operation',baseVersion:run.version,baseHead:headOf(run),...(kind==='turn'?{requestId:'w19-request',input:'Watch the deck.'}:{}),...extra};}
async function finish(f,operationId='w19-operation'){await f.host.jobs.active.get(f.runId)?.promise;return (await f.host.request({action:'operationStatus',runId:f.runId,operationId})).value;}

test('W19 durable short ack, browser abort, lost ack replay and canonical idle status never duplicate generation',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async({stage})=>{if(stage==='director'){began.resolve();await release.promise;}}});
  const request=await submit(f),browser=new AbortController(),ack=await f.host.request(request,browser.signal);assert.equal(ack.ok,true);assert.equal(ack.value.status,'accepted');
  const durable=JSON.parse(await readFile(join(f.hostRoot,'operations.json'),'utf8'));assert.equal(durable.records[0].operationId,request.operationId);assert(!JSON.stringify(durable).includes(request.input));
  browser.abort();await began.promise;
  const duplicate=await f.host.request({...request,operationId:'ack-loss-new-attempt'});assert.equal(duplicate.value.operationId,request.operationId);
  assert.equal((await f.host.request({...request,input:'Changed input.'})).error.code,'IDEMPOTENCY_CONFLICT');
  release.resolve();const result=await finish(f);assert.equal(result.status,'committed');assert.equal(result.canonical.version,1);assert.equal(result.result.body,'The synthetic captain watches the quiet deck.');assert.equal(f.calls.length,4);
  assert.equal((await f.host.request(request)).value.result.commitId,result.result.commitId);assert.equal(f.calls.length,4);
  const idle=await f.host.progress(f.runId);assert.equal(idle.pending,false);assert.deepEqual(idle.canonical,result.canonical);
  const missing=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:'absent-op'})).value;assert.equal(missing.status,'not_found');assert.equal(missing.pending,false);assert.deepEqual(missing.canonical,result.canonical);
  await f.host.close();
});

test('W19 concurrent two-device admission is one Run writer with no implicit queue and bounded Host concurrency',async()=>{
  const release=deferred(),began=deferred(),f=await fixture({maxConcurrentOperations:1,override:async({stage})=>{if(stage==='director'){began.resolve();await release.promise;}}});
  const request=await submit(f),results=await Promise.all([f.host.request(request),f.host.request({...request,operationId:'other-operation',requestId:'other-request'})]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'RUN_BUSY');await began.promise;
  const other=(await f.host.createRun({snapshot})).runId,otherRequest=await submit(f,'turn',{runId:other,operationId:'other-run-operation',requestId:'other-run-request'});
  assert.equal((await f.host.request(otherRequest)).error.code,'HOST_BUSY');
  assert.equal((await f.host.request({...request,action:'regenerate',operationId:'legacy-regenerate',requestId:'regenerate-request',expectedVersion:0,expectedHead:null})).error.code,'RUN_BUSY');
  release.resolve();await finish(f);assert.equal(f.calls.length,4);await f.host.close();
});

test('W19 turn preconditions check under the canonical lock after receipt dedup and before model calls',async()=>{
  const f=await fixture(),first=await f.engine.turn({runId:f.runId,input:'First.',requestId:'first',baseVersion:0,baseHead:null});assert.equal(f.calls.length,4);
  assert.equal((await f.engine.turn({runId:f.runId,input:'First.',requestId:'first',baseVersion:0,baseHead:null})).commitId,first.commitId);
  await assert.rejects(f.engine.turn({runId:f.runId,input:'Changed.',requestId:'first',baseVersion:0,baseHead:null}),{code:'IDEMPOTENCY_CONFLICT'});
  const stale=await submit(f,'turn',{baseVersion:0,baseHead:null});assert.equal((await f.host.request(stale)).error.code,'VERSION_CONFLICT');
  await assert.rejects(f.engine.turn({runId:f.runId,input:'Stale.',requestId:'stale-direct',baseVersion:1,baseHead:null}),{code:'HISTORY_HEAD_CONFLICT'});assert.equal(f.calls.length,4);
  // Admission succeeds at v1, but an independent canonical writer changes it
  // before execution. Engine must check again inside its actual writer lock.
  const running=deferred(),release=deferred();f.host.jobs.ledger.fault=async point=>{if(point==='beforeRename'&&f.host.jobs.ledger.records.at(-1)?.status==='running'){running.resolve();await release.promise;}};
  const ack=await f.host.request(await submit(f));assert.equal(ack.ok,true);await running.promise;
  await f.engine.updateBanList({runId:f.runId,banList:['synthetic'],expectedVersion:1});release.resolve();
  const done=await finish(f);assert.equal(done.status,'failed');assert.equal(done.failure.code,'VERSION_CONFLICT');assert.equal(done.canonical.version,2);assert.equal(f.calls.length,4);await f.host.close();
});

test('W19 exact cross-device cancellation discards late output and old cancellation cannot touch a new job',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({override:async({stage})=>{if(stage==='director'){began.resolve();await release.promise;}}}),request=await submit(f);
  await f.host.request(request);await began.promise;
  assert.equal(f.host.cancel({runId:f.runId,operationId:'wrong-operation'}).reason,'operation_mismatch');
  assert.equal(f.host.cancel({runId:f.runId,operationId:request.operationId,requestId:'wrong-request'}).reason,'request_mismatch');
  assert.equal(f.host.cancel({runId:f.runId,operationId:request.operationId,attemptId:'wrong-attempt'}).reason,'attempt_mismatch');
  assert.equal(f.host.cancel({runId:f.runId}).reason,'identity_required');
  assert.equal(f.host.cancel({runId:f.runId,operationId:request.operationId,requestId:request.requestId}).cancelRequested,true);
  const cancelled=await finish(f);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.canonical.version,0);release.resolve();
  const retry=await f.host.request({...request,operationId:'explicit-retry',retryOf:request.operationId});assert.equal(retry.ok,true);
  assert.equal(f.host.cancel({runId:f.runId,operationId:request.operationId}).cancelRequested,false);
  const committed=await finish(f,'explicit-retry');assert.equal(committed.status,'committed');assert.equal(committed.canonical.version,1);assert.equal((await f.store.read(f.runId)).turns.length,1);await f.host.close();
});

test('W19 interrupted and failed identities never replay without an explicit bounded retryOf',async()=>{
  let broken=true;const f=await fixture({override:async()=>{if(broken)throw Object.assign(new Error('synthetic secret must not be echoed'),{code:'MODEL_TRANSPORT_ERROR'});}}),request=await submit(f);
  await f.host.request(request);const failed=await finish(f);assert.equal(failed.status,'failed');assert(!JSON.stringify(failed).includes('synthetic secret'));assert.equal(f.calls.length,1);broken=false;
  assert.equal((await f.host.request({...request,operationId:'new-id-no-retry'})).value.operationId,request.operationId);assert.equal(f.calls.length,1);
  assert.equal((await f.host.request({...request,operationId:'retry-invalid',retryOf:'wrong-op'})).error.code,'OPERATION_RETRY_CONFLICT');
  assert.equal((await f.host.request({...request,input:'Changed',operationId:'retry-changed',retryOf:request.operationId})).error.code,'IDEMPOTENCY_CONFLICT');
  await f.host.request({...request,operationId:'retry-good',retryOf:request.operationId});assert.equal((await finish(f,'retry-good')).status,'committed');assert.equal(f.calls.length,5);
  assert.equal((await f.host.request({...request,operationId:'retry-after-commit',retryOf:'retry-good'})).error.code,'OPERATION_RETRY_CONFLICT');await f.host.close();
});

test('W19 restart reconciles accepted/running evidence to committed or interrupted and invokes zero models',async()=>{
  const f=await fixture(),request=await submit(f);await f.host.request(request);const done=await finish(f);await f.host.close();
  const path=join(f.hostRoot,'operations.json'),data=JSON.parse(await readFile(path,'utf8'));
  data.records[0].status='running';delete data.records[0].finishedAt;
  data.records.push({...data.records[0],operationId:'accepted-before-crash',requestId:'never-started-request',inputHash:hash('Never started.'),fingerprint:hash('synthetic-accepted-record'),baseVersion:1,baseHead:done.canonical.head,status:'accepted'});
  await writeFile(path,JSON.stringify(data));let calls=0;const engine=new SceanEngine({unconfiguredWritingMode:'current',store:f.store,model:{generate(){calls++;throw Error('REPLAY_FORBIDDEN');}},memory:new Memory()}),host=await new SceanHost({engine,root:f.hostRoot}).init();
  const restored=(await host.request({action:'operationStatus',runId:f.runId,operationId:request.operationId})).value;assert.equal(restored.status,'committed');assert.equal(restored.result.commitId,done.result.commitId);
  const interrupted=(await host.request({action:'operationStatus',runId:f.runId,operationId:'accepted-before-crash'})).value;assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.recovery,'host_interrupted_no_replay');assert.equal(calls,0);await host.close();
});

test('W19 admission persistence failure starts no model, no accepted ack, and never evicts IDs at capacity',async()=>{
  const f=await fixture(),request=await submit(f);let failOnce=true;f.host.jobs.ledger.fault=point=>{if(point==='beforeRename'&&failOnce){failOnce=false;throw Object.assign(Error('synthetic storage fault'),{code:'EIO'});}};
  const rejected=await f.host.request(request);assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'HOST_JOB_LEDGER');assert.equal(f.calls.length,0);assert.equal(f.host.jobs.active.size,0);
  assert.equal((await f.host.request(request)).value.status,'interrupted');assert.equal(f.calls.length,0);
  f.host.jobs.ledger.capacity=1;assert.equal((await f.host.request({...request,operationId:'capacity-other',requestId:'capacity-other-request'})).error.code,'HOST_JOB_CAPACITY');await f.host.close();
});

test('W19 summary Host work survives browser loss, excludes all same-Run mutations, and preserves private projections',async()=>{
  const began=deferred(),release=deferred(),f=await fixture({longrun:true,enabled:true,override:async({stage})=>{if(stage==='summary'){began.resolve();await release.promise;}}}),before=await f.store.read(f.runId),browser=new AbortController(),request=await submit(f,'summaryStart');
  assert.equal((await f.host.request(request,browser.signal)).ok,true);browser.abort();await began.promise;
  assert.equal((await f.host.request(await submit(f,'turn',{operationId:'turn-during-summary'}))).error.code,'RUN_BUSY');
  assert.equal((await f.host.request({action:'banList',runId:f.runId,banList:['new'],expectedVersion:before.version})).error.code,'RUN_BUSY');
  assert.equal((await f.host.request({action:'rollback',runId:f.runId,operationId:'rollback-during-summary',expectedVersion:before.version,expectedHead:before.head,confirmation:'rollback-last-committed-turn'})).error.code,'RUN_BUSY');
  release.resolve();const result=await finish(f);assert.equal(result.status,'completed');assert.equal(f.calls.length,1);assert(!JSON.stringify(result).includes(D_PRIVATE));
  const after=await f.store.read(f.runId);for(const key of ['turns','state','memories','playerHistory','receipts'])assert.equal(hash(after[key]),hash(before[key]));
  assert.equal((await f.host.request(request)).value.status,'completed');assert.equal(f.calls.length,1);await f.host.close();
});

test('W19 history and chapter operations share durable admission and retirement remains authoritative',async()=>{
  const f=await fixture({longrun:true,enabled:true});
  const close=await submit(f,'chapterClose',{title:'Synthetic first chapter'});await f.host.request(close);const chapter=await finish(f);assert.equal(chapter.status,'completed');assert.equal(f.calls.length,0);
  await f.host.request(await submit(f,'chapterSummarize',{operationId:'backfill-op',chapterId:chapter.result.chapterId}));const backfill=await finish(f,'backfill-op');assert.equal(backfill.status,'completed');assert.equal(f.calls.length,1);
  await f.host.request(await submit(f,'regenerate',{operationId:'regen-op',requestId:'regen-request',guidance:'Keep the same public event.'}));const regen=await finish(f,'regen-op');assert.equal(regen.status,'committed');const generated=regen.result.commitId;
  await f.host.request(await submit(f,'rollback',{operationId:'rollback-op',confirmation:'rollback-last-committed-turn'}));assert.equal((await finish(f,'rollback-op')).status,'committed');
  const retired=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:'regen-op'})).value;assert.equal(retired.status,'retired');assert.equal(retired.result.commitId,generated);assert.equal(retired.result.body,undefined);await f.host.close();
});

test('W19 page drafts are independent, bounded, restart-safe and retain committed/retired reconciliation',async()=>{
  const f=await fixture();await f.host.request({action:'draftSave',runId:f.runId,viewerId:'page-a',requestId:'page-a-request',input:'Page A text.'});await f.host.request({action:'draftSave',runId:f.runId,viewerId:'page-b',requestId:'page-b-request',input:'Page B text.'});
  assert.equal((await f.host.draftGet(f.runId,'page-a')).input,'Page A text.');assert.equal((await f.host.draftGet(f.runId,'page-b')).input,'Page B text.');assert.equal((await f.host.draftGet(f.runId,'page-c')).status,'empty');
  await f.host.request(await submit(f,'turn',{viewerId:'page-a',input:'Page A text.',requestId:'page-a-request'}));await finish(f);assert.equal((await f.host.draftGet(f.runId,'page-a')).status,'empty');assert.equal((await f.host.draftGet(f.runId,'page-b')).input,'Page B text.');await f.host.close();
  const restored=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();assert.equal((await restored.draftGet(f.runId,'page-b')).input,'Page B text.');await restored.close();
});

test('W19 operator card scope still guards submit/status/cancel without leaking other Run evidence',async()=>{
  const f=await fixture(),scope={provider:'@local/dsh-card-studio-scean-test',authoringSessionId:'synthetic-session',generation:1,cardId:'different-card',revision:1},authority={requireCardScope:true,principal:{},resolveCardScope:async()=>scope};
  for(const action of ['operationSubmit','operationStatus','cancel']){const result=await f.host.request({...await submit(f),action,sessionId:'synthetic-session',cardScope:scope},undefined,authority);assert.equal(result.ok,false);assert.equal(result.error.code,'CARD_SCOPE_MISMATCH');}
  assert.equal(f.calls.length,0);await f.host.close();
});

test('W19 abrupt Host process exit before and after canonical publication never auto-replays models',async()=>{
  for(const phase of ['running','committed']){
    const f=await fixture();await f.host.close();
    const code=`
      import {SceanHost} from ${JSON.stringify(new URL('../plugin/host.mjs',import.meta.url).href)};
      import {SceanEngine} from ${JSON.stringify(new URL('../core/engine.mjs',import.meta.url).href)};
      import {DurableStore} from ${JSON.stringify(new URL('../adapters/store.mjs',import.meta.url).href)};
      import {Memory} from ${JSON.stringify(new URL('../core/memory.mjs',import.meta.url).href)};
      const store=new DurableStore({root:${JSON.stringify(join(f.root,'store'))}}),model={async generate({stage}){
        if(${JSON.stringify(phase)}==='running')process.exit(23);
        return {text:stage==='post_stat'?JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]}):'Synthetic restart witness.'};
      }},engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()}),host=await new SceanHost({engine,root:${JSON.stringify(f.hostRoot)}}).init();
      host.jobs.ledger.fault=point=>{if(point==='beforeRename'&&host.jobs.ledger.records.at(-1)?.status==='committed')process.exit(24);};
      await host.request({action:'operationSubmit',kind:'turn',runId:${JSON.stringify(f.runId)},requestId:'process-request',operationId:'process-operation',baseVersion:0,baseHead:null,input:'Synthetic restart request.'});
      await host.jobs.active.get(${JSON.stringify(f.runId)})?.promise;
    `;
    const exit=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','--eval',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});let stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('Synthetic restart child timed out'));},15000);child.stderr.on('data',value=>stderr+=value);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve({code,stderr});});});
    assert.equal(exit.code,phase==='running'?23:24,exit.stderr);
    let modelCalls=0;const engine=new SceanEngine({unconfiguredWritingMode:'current',store:f.store,model:{generate(){modelCalls++;throw Error('REPLAY_FORBIDDEN');}},memory:new Memory()}),host=await new SceanHost({engine,root:f.hostRoot}).init();
    const status=(await host.request({action:'operationStatus',runId:f.runId,operationId:'process-operation'})).value;
    assert.equal(status.status,phase==='running'?'interrupted':'committed');assert.equal(status.canonical.version,phase==='running'?0:1);assert.equal(modelCalls,0);
    const replay=await host.request({action:'operationSubmit',kind:'turn',runId:f.runId,requestId:'process-request',operationId:'process-operation',baseVersion:0,baseHead:null,input:'Synthetic restart request.'});assert.equal(replay.value.status,status.status);assert.equal(modelCalls,0);await host.close();
  }
});

test('W19 cancel at publication and rename faults resolve from canonical receipt without partial commits',async()=>{
  for(const point of ['beforeRename','afterRename']){
    const f=await fixture();let injected=false;f.store.fault=async phase=>{if(phase!==point||injected)return;injected=true;if(point==='beforeRename')throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});f.host.cancel({runId:f.runId,operationId:'w19-operation'});};
    await f.host.request(await submit(f));const status=await finish(f),run=await f.store.read(f.runId);
    assert.equal(status.status,point==='beforeRename'?'failed':'committed');assert.equal(run.version,point==='beforeRename'?0:1);assert.equal(run.turns.length,point==='beforeRename'?0:1);assert.equal(Object.keys(run.receipts).length,point==='beforeRename'?0:1);await f.host.close();
  }
});

test('W19 accepted turn releases reservation before saved automatic chapters; restart keeps preference without executing work',async()=>{
  const f=await fixture({longrun:true,enabled:true});
  await f.host.request(await submit(f,'chapterSettings',{operationId:'auto-settings',settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'auto'}}));assert.equal((await finish(f,'auto-settings')).status,'completed');
  const request=await submit(f,'turn');await f.host.request(request);assert.equal((await finish(f)).status,'committed');
  await Promise.allSettled([...f.host.chapterBackground??[]]);assert.equal(f.calls.filter(c=>c.stage==='chapter_analysis').length,1);assert.equal(f.calls.filter(c=>c.stage==='chapter_summary').length,0);
  await f.host.request(request);await Promise.allSettled([...f.host.chapterBackground??[]]);assert.equal(f.calls.filter(c=>c.stage==='chapter_analysis').length,1);await f.host.close();
  const restarted=await new SceanHost({engine:f.engine,root:f.hostRoot,chapterModelsEnabled:true}).init();assert.equal((await restarted.chapterStatus({runId:f.runId})).autoArmed,true);await restarted.close();
});

test('W19 graceful Host shutdown is distinct from explicit cancel for turn and narrative jobs',async()=>{
  for(const kind of ['turn','summaryStart']){
    const began=deferred(),f=await fixture({longrun:kind==='summaryStart',enabled:true,override:async({stage,signal})=>{if(stage===(kind==='turn'?'director':'summary')){began.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Synthetic shutdown'),{code:'CANCELLED'})),{once:true}));}}});
    await f.host.request(await submit(f,kind));await began.promise;await f.host.close();const status=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:'w19-operation'})).value;
    assert.equal(status.status,'interrupted');assert.equal(status.failure.code,'HOST_SHUTDOWN');assert.equal(status.recovery,'host_shutdown_no_replay');
  }
});

test('W19 exact operation status never aliases a later same-request retry across commit, restart or retirement',async()=>{
  for(const terminal of ['failed','cancelled','interrupted']){
    let first=true;const began=deferred(),f=await fixture({override:async({stage,signal})=>{
      if(!first||stage!=='director')return;
      if(terminal==='failed')throw Object.assign(Error('Synthetic first-attempt failure'),{code:'MODEL_TRANSPORT_ERROR'});
      began.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Synthetic first-attempt stop'),{code:'CANCELLED'})),{once:true}));
    }}),request=await submit(f);
    await f.host.request(request);
    if(terminal==='cancelled'){await began.promise;f.host.cancel({runId:f.runId,operationId:request.operationId});}
    if(terminal==='interrupted'){await began.promise;await f.host.close();}
    assert.equal((await finish(f)).status,terminal);const firstAttempt=f.host.jobs.ledger.records[0].attemptId;assert(firstAttempt);first=false;
    if(terminal==='interrupted')f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();
    const retry={...request,operationId:'owning-retry',retryOf:request.operationId};assert.equal((await f.host.request(retry)).ok,true);
    const success=await finish(f,'owning-retry');assert.equal(success.status,'committed');assert.notEqual(success.attemptId,firstAttempt);
    let old=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:request.operationId})).value;
    assert.equal(old.status,terminal);assert.equal(old.attemptId,firstAttempt);assert.equal(old.result,undefined);assert.equal(old.requestOutcome.status,'committed');assert.equal(old.requestOutcome.operationId,'owning-retry');assert.equal(old.requestOutcome.attemptId,success.attemptId);
    await f.host.close();f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();
    old=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:request.operationId})).value;assert.equal(old.status,terminal);assert.equal(old.result,undefined);
    await f.host.request(await submit(f,'rollback',{operationId:'retire-owning-retry',confirmation:'rollback-last-committed-turn'}));assert.equal((await finish(f,'retire-owning-retry')).status,'committed');
    old=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:request.operationId})).value;const retired=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:'owning-retry'})).value;
    assert.equal(old.status,terminal);assert.equal(old.result,undefined);assert.equal(old.requestOutcome.status,'retired');assert.equal(retired.status,'retired');assert.equal(retired.attemptId,success.attemptId);assert.equal(retired.result.body,undefined);await f.host.close();
  }
});

test('W19 accepted operation never borrows progress or attempt identity from the previous operation',async()=>{
  let block=false;const began=deferred(),release=deferred(),f=await fixture({override:async({stage})=>{if(block&&stage==='director'){began.resolve();await release.promise;}}});
  await f.host.request(await submit(f));const first=await finish(f);assert(first.attemptId);block=true;
  const next=await submit(f,'turn',{operationId:'next-owned-operation',requestId:'next-owned-request'}),accepted=(await f.host.request(next)).value;
  assert.equal(accepted.status,'accepted');assert.equal(accepted.attemptId,undefined);assert.equal(accepted.stage,undefined);
  await began.promise;const running=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:next.operationId})).value;assert(running.attemptId);assert.notEqual(running.attemptId,first.attemptId);
  assert.equal(f.host.cancel({runId:f.runId,operationId:next.operationId,attemptId:running.attemptId}).cancelRequested,true);assert.equal((await finish(f,next.operationId)).status,'cancelled');release.resolve();await f.host.close();
});

test('W19 pre-existing legacy canonical receipt deduplicates to its real operation identity without generation',async()=>{
  const f=await fixture(),request=await submit(f);const legacy=await f.host.turn({runId:f.runId,requestId:request.requestId,input:request.input,operationId:'legacy-canonical-operation'});assert.equal(f.calls.length,4);
  const acknowledgement=await f.host.request(request);assert.equal(acknowledgement.ok,true);assert.equal(acknowledgement.value.operationId,'legacy-canonical-operation');assert.equal(acknowledgement.value.status,'committed');assert.equal(acknowledgement.value.result.commitId,legacy.commitId);
  const status=(await f.host.request({action:'operationStatus',runId:f.runId,operationId:acknowledgement.value.operationId})).value;assert.equal(status.result.trace.operationId,status.operationId);assert.equal(status.attemptId,legacy.trace.attemptId);assert.equal(f.calls.length,4);await f.host.close();
});

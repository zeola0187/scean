import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {ScriptStore} from '../core/script-store.mjs';
import {changeRunLifecycle} from '../core/run-lifecycle.mjs';
import {buildSavedSnapshot} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {STUDIO_PROVIDER} from '../plugin/card-scope.mjs';

const saved=(revision=0,id='card-A')=>({id,type:'card',revision,sha256:'synthetic-'+revision,card:{data:{name:'Same synthetic title',first_mes:'Main '+revision,alternate_greetings:['Alternate '+revision],extensions:{scean:{characters:[{id:'actor',name:'Actor',description:'Synthetic test actor'}]}}}}});
async function fixture(t){
  const base=resolve(import.meta.dirname,'../.test-data');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'script-service-'));
  let current,modelCalls=0;const engine=new SceanEngine({store:new DurableStore({root:join(root,'store')}),model:{generate(){modelCalls++;throw Error('MODEL_FORBIDDEN');}},memory:new Memory()});
  let host=await new SceanHost({engine,root:join(root,'host')}).init();
  const select=(source=saved(),session='session-A',generation=1)=>current={provider:STUDIO_PROVIDER,cardId:source.id,authoringSessionId:session,generation,savedRevision:source.revision,savedSha256:source.sha256};select();
  const authority={requireCardScope:true,principal:'synthetic-operator',allowGlobalSettings:true,resolveCardScope:async()=>current};
  const call=(action,args={})=>host.request({action,sessionId:current.authoringSessionId,cardScope:current,...args},undefined,authority);
  const publish=(requestId='publish-one',source=saved(),extra={})=>host.publishFromStudio({snapshot:buildSavedSnapshot(source),authoringSessionId:current.authoringSessionId,generation:current.generation,requestId,...extra});
  const start=async(script,operationId,index=0)=>{const result=await call('scriptStart',{scriptId:script.scriptId,scriptHash:script.scriptHash,expectedRevision:script.revision,operationId});assert(result.ok,JSON.stringify(result));const offer=(await call('openingOffer')).value;const choice={offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash,openingIndex:index,playerName:'Synthetic player'};const started=await call('openingStart',choice);assert(started.ok,JSON.stringify(started));return {result:started.value,offer,choice};};
  t.after(async()=>{await host.close();assert.equal(modelCalls,0);await rm(root,{recursive:true,force:true});});
  return {root,engine,authority,get host(){return host;},get scope(){return current;},select,call,publish,start,async restart(){await host.close();host=await new SceanHost({engine,root:join(root,'host')}).init();return host;}};
}

test('independent immutable Scripts: publish creates no Run; same content in different requests stays separate',async t=>{
  const f=await fixture(t),one=await f.publish(),retry=await f.publish(),two=await f.publish('publish-two');
  assert.deepEqual(retry,one);assert.notEqual(one.scriptId,two.scriptId);assert.equal(one.scriptHash,two.scriptHash);
  assert.equal(one.review.status,'not_recorded');assert.equal((await f.engine.store.listRuns()).length,0);
  const rows=(await f.call('scriptList')).value;assert.equal(rows.length,2);assert(rows.every(row=>row.runCount===0));
  await assert.rejects(f.publish('publish-one',saved(1)),{code:'SCRIPT_REQUEST_CONFLICT'});
  await f.restart();assert.deepEqual(await f.publish(),one);
  const status=await f.host.scriptStatusFromStudio({authoringSessionId:'session-A',generation:2,requestId:'publish-one',cardScope:f.scope});assert.equal(status.status,'committed');assert.equal(status.scriptId,one.scriptId);
});

test('same-name cards never share Scripts, status or Run authorization',async t=>{
  const f=await fixture(t),one=await f.publish();f.select(saved(0,'card-B'));const two=await f.publish('publish-card-B',saved(0,'card-B'));
  assert.deepEqual((await f.call('scriptList')).value.map(row=>row.scriptId),[two.scriptId]);
  for(const action of ['scriptGet','scriptStart'])assert.equal((await f.call(action,{scriptId:one.scriptId,scriptHash:one.scriptHash,expectedRevision:one.revision,operationId:'foreign-start'})).error.code,'CARD_SCOPE_MISMATCH');
  await assert.rejects(f.host.scriptStatusFromStudio({authoringSessionId:'session-A',generation:1,requestId:'publish-one',cardScope:f.scope}),{code:'CARD_SCOPE_MISMATCH'});
});

test('two Scripts each create many Runs, current card revision never replaces a frozen Script or prior Run',async t=>{
  const f=await fixture(t),one=await f.publish(),two=await f.publish('publish-two',saved(1));
  const a=await f.start(one,'start-one',1),before=await readFile(f.engine.store.currentFile(a.result.runId),'utf8');
  f.select(saved(7));const b=await f.start(one,'start-two'),c=await f.start(two,'start-three'),d=await f.start(two,'start-four',1);
  assert.equal(new Set([a,b,c,d].map(x=>x.result.runId)).size,4);assert.equal(await readFile(f.engine.store.currentFile(a.result.runId),'utf8'),before);
  const ar=await f.engine.store.read(a.result.runId),br=await f.engine.store.read(b.result.runId);assert.equal(ar.snapshot.opening.text,'Alternate 0');assert.equal(br.snapshot.opening.text,'Main 0');
  assert.equal(ar.scriptId,one.scriptId);assert.equal(ar.scriptHash,one.scriptHash);assert.notEqual(ar.snapshot.hash,one.scriptHash);assert.notEqual(ar.snapshot.hash,br.snapshot.hash);
  assert.equal((await f.host.scripts.read(one.scriptId)).snapshot.card.data.first_mes,'Main 0');
  assert((await f.call('scriptList')).value.every(row=>row.runCount===2));
});

test('exact Script publication source and Run entry Session are distinct; stale generation cannot consume offers',async t=>{
  const f=await fixture(t),one=await f.publish();f.select(saved(9),'session-B',4);
  const started=await f.start(one,'session-B-start');const view=(await f.call('runView',{runId:started.result.runId})).value;
  assert.equal(view.sourceSessionId,'session-B');assert.equal(view.scriptSourceSessionId,'session-A');assert.equal((await f.call('scriptGet',{scriptId:one.scriptId})).value.sourceSessionId,'session-A');
  const prepared=await f.call('scriptStart',{scriptId:one.scriptId,scriptHash:one.scriptHash,expectedRevision:0,operationId:'stale-start'});assert(prepared.ok);
  const offer=(await f.call('openingOffer')).value;f.scope.generation=5;
  assert.equal((await f.call('openingStart',{offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash,openingIndex:0,playerName:'Synthetic player'})).error.code,'OPENING_STALE');
  for(const overrides of [{scriptHash:'forged'},{expectedRevision:9}])assert.equal((await f.call('scriptStart',{scriptId:one.scriptId,scriptHash:one.scriptHash,expectedRevision:0,operationId:'bad-start',...overrides})).error.code,'SCRIPT_VERSION_CONFLICT');
});

test('atomic Script receipt survives response loss and unknown recovery, before-rename failure creates nothing',async t=>{
  const f=await fixture(t);f.host.scripts.fault=point=>{if(point==='beforeRename')throw Object.assign(Error('synthetic disk failure'),{code:'EIO'});};
  await assert.rejects(f.publish(),{code:'EIO'});assert.equal((await f.host.scripts.list()).length,0);
  f.host.scripts.fault=point=>{if(point==='afterRename')throw Error('synthetic reply loss');};const recovered=await f.publish();assert.equal(recovered.receipt.status,'committed');
  const original=f.host.scripts.read.bind(f.host.scripts);f.host.scripts.fault=point=>{if(point==='afterRename'){f.host.scripts.read=async()=>{throw Error('synthetic unreadable');};throw Error('synthetic unknown');}};
  await assert.rejects(f.publish('publish-unknown'),{code:'SCRIPT_PUBLISH_UNKNOWN'});f.host.scripts.read=original;f.host.scripts.fault=null;
  await f.restart();const recoveredUnknown=await f.host.scriptStatusFromStudio({authoringSessionId:'session-A',generation:1,requestId:'publish-unknown',cardScope:f.scope});assert.equal(recoveredUnknown.status,'committed');assert.equal((await f.host.scripts.list()).length,2);
});

test('scriptStart and opening publication loss recover the same durable Run across Host restart',async t=>{
  const f=await fixture(t),one=await f.publish(),args={scriptId:one.scriptId,scriptHash:one.scriptHash,expectedRevision:0,operationId:'start-recovery'};
  const prepared=await f.call('scriptStart',args);assert(prepared.ok);await f.restart();assert.equal((await f.call('scriptStatus',{operationId:args.operationId})).value.status,'prepared');
  const offer=(await f.call('openingOffer')).value,choice={offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash,openingIndex:1,playerName:'Synthetic player'};
  const create=f.host.createRun.bind(f.host);f.host.createRun=async args=>{await create(args);throw Error('synthetic reply lost');};assert.equal((await f.call('openingStart',choice)).ok,false);
  const status=(await f.call('scriptStatus',{operationId:args.operationId})).value;assert.equal(status.status,'committed');
  await f.restart();const retry=await f.call('openingStart',choice);assert(retry.ok,JSON.stringify(retry));assert.equal(retry.value.runId,status.runId);
  const again=await f.call('scriptStart',args);assert.equal(again.value.runId,status.runId);assert.equal((await f.engine.store.listRuns()).length,1);
});

test('recycled Run cannot be read through script status or old opening receipt; independent Script remains reusable',async t=>{
  const f=await fixture(t),one=await f.publish(),started=await f.start(one,'recycle-start'),run=await f.engine.store.read(started.result.runId);
  await changeRunLifecycle(f.engine.store,{runId:run.runId,operationId:'trash-script-run',action:'trash',expectedVersion:0,expectedHead:null,expectedLifecycleRevision:0,confirmed:true});await f.host.refreshRuns();
  assert.equal((await f.call('scriptStatus',{operationId:'recycle-start'})).error.code,'RUN_TRASHED');
  assert.equal((await f.call('openingStart',started.choice)).error.code,'RUN_TRASHED');
  assert.equal((await f.call('runView',{runId:run.runId})).ok,false);
  const next=await f.start(one,'new-after-trash');assert.notEqual(next.result.runId,run.runId);assert.equal((await f.call('scriptList')).value[0].runCount,1);
});

test('independent ScriptStore clients cannot publish conflicting requests over one identity',async t=>{
  const f=await fixture(t),second=new ScriptStore({root:join(f.root,'host')}),snapshot=buildSavedSnapshot(saved());
  const args={snapshot,authoringSessionId:'session-A',generation:1,requestId:'race-request'};
  const result=await Promise.allSettled([f.host.scripts.publish(args),second.publish({...args,review:{status:'pending'}})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.host.scripts.list()).length,1);
  const failed=result.find(r=>r.status==='rejected');assert(['RUN_BUSY','SCRIPT_REQUEST_CONFLICT'].includes(failed.reason.code));
});

test('review binding follows exact provider payload through compatibility normalization',async t=>{
  const f=await fixture(t),source=saved(),snapshot=buildSavedSnapshot(source),review={status:'pending',documentId:source.id,revision:source.revision,snapshotHash:snapshot.hash};
  await assert.rejects(f.publish('bad-review',source,{review:{...review,snapshotHash:'0'.repeat(64)}}),{code:'SCRIPT_REVIEW_MISMATCH'});
  await assert.rejects(f.publish('bad-review-complete',source,{review:{...review,status:'completed',coverage:'complete',verdict:'pass'}}),{code:'SCRIPT_REVIEW_MISMATCH'});
  const published=await f.publish('bound-review',source,{review}),record=await f.host.scripts.read(published.scriptId);
  assert.equal(record.review.publicationBinding.reviewedSnapshotHash,snapshot.hash);assert.equal(record.review.publicationBinding.publishedSnapshotHash,record.scriptHash);
  assert.equal(record.snapshot.source.nativeHandoffCompatibility.providerSnapshotHash,snapshot.hash);
  await assert.rejects(f.publish('changed-reviewed-payload',saved(1),{review}),{code:'SCRIPT_REVIEW_MISMATCH'});
});

test('source return availability requires the exact currently authorized same-card Session',async t=>{
  const f=await fixture(t),one=await f.publish(),started=await f.start(one,'navigation-start');
  assert.equal((await f.call('runView',{runId:started.result.runId})).value.sourceSessionAvailable,true);
  f.select(saved(),'session-B',2);const current=f.scope;
  for(const target of [null,{...current,authoringSessionId:'session-A',cardId:'card-B'},{...current,authoringSessionId:'wrong-session'}]){
    f.authority.resolveCardScope=async id=>id==='session-B'?current:target;
    assert.equal((await f.call('runView',{runId:started.result.runId})).value.sourceSessionAvailable,false);
    assert.equal((await f.call('scriptGet',{scriptId:one.scriptId})).value.sourceSessionAvailable,false);
  }
  f.authority.resolveCardScope=async id=>id==='session-B'?current:(()=>{throw Object.assign(Error('synthetic archived'),{code:'SESSION_ARCHIVED'});})();
  const view=(await f.call('runView',{runId:started.result.runId})).value;assert.equal(view.sourceSessionAvailable,false);assert.equal(view.sourceSessionId,'session-A');
  const lookups=[];f.authority.resolveSourceSession=async(id,scope)=>{lookups.push({id,scope});return {available:true,authoringSessionId:id,cardId:scope.cardId};};
  assert.equal((await f.call('runView',{runId:started.result.runId})).value.sourceSessionAvailable,true);
  assert.equal(lookups[0].id,'session-A');assert.deepEqual(lookups[0].scope,current);
  f.authority.resolveSourceSession=async()=>({available:true,authoringSessionId:'session-A',cardId:'card-B'});
  assert.equal((await f.call('scriptGet',{scriptId:one.scriptId})).value.sourceSessionAvailable,false);
  f.authority.resolveSourceSession=async()=>({available:false,authoringSessionId:'session-A',cardId:current.cardId});
  assert.equal((await f.call('runView',{runId:started.result.runId})).value.sourceSessionAvailable,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {encodeRunBundle} from '../core/save-bundle.mjs';
import {STUDIO_PROVIDER,snapshotCardScope} from '../plugin/card-scope.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
const snapshot=(cardId,revision,source=true)=>({schemaVersion:1,cardId,revision,card:{data:{name:'Same display name',first_mes:`${cardId} opening`}},worldbook:{entries:[]},preset:{},characters:[{id:'actor',name:'Actor',description:'Synthetic background'}],...(source?{source:{provider:STUDIO_PROVIDER,card:{id:cardId,revision}}}:{})});
test('canonical card lineage scopes every native read/write; revisions and old bytes survive restart',async t=>{
  const base=new URL('../.test-data/',import.meta.url);await mkdir(base,{recursive:true});const root=await mkdtemp(new URL('card-scope-',base));let calls=0;
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),memory:new Memory(),model:{generate(){calls++;throw Error('MODEL_FORBIDDEN');}}});
  let host=await new SceanHost({engine,root:join(root,'host')}).init();t.after(()=>host.close());
  const ids=[];for(const [id,rev,source] of [['card-A',1,true],['card-A',2,true],['card-B',1,true],['card-B',2,true],['card-A',0,false]])ids.push((await host.createRun({snapshot:snapshot(id,rev,source)})).runId);
  const files=ids.map(id=>join(engine.store.runDir(id),'current.json')),before=await Promise.all(files.map(f=>readFile(f,'utf8')));
  let selected={provider:STUDIO_PROVIDER,cardId:'card-A',authoringSessionId:'session-A',generation:'generation-A'};
  const authority={requireCardScope:true,resolveCardScope:async id=>id===selected?.authoringSessionId?selected:null,allowPrivateSaves:true,allowPrivateDiagnostics:true,principal:'synthetic-operator'};
  const invoke=(action,payload={})=>host.request({action,sessionId:selected?.authoringSessionId,cardScope:selected,...payload},undefined,authority);
  assert.deepEqual((await host.request({action:'list'},undefined,authority)).value,[]);
  assert.equal((await host.request({action:'runView',runId:ids[0]},undefined,authority)).error.code,'CARD_CONTEXT_REQUIRED');
  assert.deepEqual((await invoke('list')).value.map(r=>r.runId).sort(),ids.slice(0,2).sort());
  for(const action of ['runView','inspect','draftGet','progress','historyPage','turn','rollback','banList','diagnosticsGrant','exportRun','cancel']){
    assert.equal((await invoke(action,{runId:ids[2]})).error.code,'CARD_SCOPE_MISMATCH',action);
  }
  const grant=(await invoke('diagnosticsGrant',{runId:ids[0],viewerId:'synthetic-viewer',acknowledgement:'show-private-character-context-for-this-run'})).value;
  const prior={...selected};selected={...selected,cardId:'card-B'};
  assert.equal((await invoke('diagnosticsRevoke',{runId:ids[0],viewerId:'synthetic-viewer',grantToken:grant.grantToken})).value.revoked,true);
  assert.equal((await invoke('runView',{runId:ids[0],cardScope:prior})).error.code,'CARD_CONTEXT_CHANGED');
  assert.deepEqual((await invoke('list')).value.map(r=>r.runId).sort(),ids.slice(2,4).sort());
  selected={...selected,cardId:'card-C'};assert.deepEqual((await invoke('list')).value,[]);
  assert.equal((await invoke('create',{snapshot:snapshot('card-C',1)})).error.code,'CARD_SCOPED_STUDIO_REQUIRED');
  const bundle=encodeRunBundle(await engine.store.read(ids[2]));
  assert.equal((await invoke('importRun',{bundle,acknowledgement:'import-private-run-data'})).error.code,'CARD_SCOPE_MISMATCH');
  await host.close();host=await new SceanHost({engine,root:join(root,'host')}).init();
  selected={...selected,cardId:'card-A',authoringSessionId:'session-reopen',generation:'generation-reopen'};
  assert.equal((await invoke('list')).value.length,2);
  const restoreEngine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'restore-store')}),memory:new Memory(),model:{generate(){throw Error('MODEL_FORBIDDEN');}}});
  const restoreHost=await new SceanHost({engine:restoreEngine,root:join(root,'restore-host')}).init();
  try{
    const restored=await restoreHost.request({action:'importRun',sessionId:selected.authoringSessionId,cardScope:selected,bundle:encodeRunBundle(await engine.store.read(ids[0])),acknowledgement:'import-private-run-data'},undefined,authority);
    assert.equal(restored.ok,true,JSON.stringify(restored));assert.equal(restored.value.runId,ids[0]);
    assert.deepEqual((await restoreEngine.store.read(ids[0])).snapshot,(await engine.store.read(ids[0])).snapshot);
  }finally{await restoreHost.close();}
  assert.deepEqual(await Promise.all(files.map(f=>readFile(f,'utf8'))),before);
  assert.equal(calls,0);
  assert.equal(snapshotCardScope(snapshot('card-A',1,false)),null);
  assert.equal(snapshotCardScope({...snapshot('card-A',1),source:{provider:STUDIO_PROVIDER,card:{id:'card-B',revision:1}}}),null);
});
test('native bridge discards delayed old context/read and stamps server-checked Session/card context',async()=>{
  let session='A',release,rejectDelay,delay=false;
  const calls=[],bridge=createNativeBridge({getSessionId:()=>session,selectPanel(){},call:async r=>{calls.push(r);if(delay)return new Promise((resolve,reject)=>{release=resolve;rejectDelay=reject;});return r.action==='context'?{cardScope:{provider:STUDIO_PROVIDER,cardId:'card-'+session,authoringSessionId:session,generation:'g'}}:[];}});
  await bridge.request('native.context');await bridge.request('list');assert.equal(calls.at(-1).cardScope.cardId,'card-A');
  delay=true;const read=bridge.request('list');session='B';bridge.clearContext();release(['old']);await assert.rejects(read,{code:'NATIVE_CONTEXT_STALE'});
  delay=false;await bridge.request('native.context');await bridge.request('list');assert.equal(calls.at(-1).sessionId,'B');assert.equal(calls.at(-1).cardScope.cardId,'card-B');
  delay=true;const staleFailure=bridge.request('list');bridge.clearContext();rejectDelay(Object.assign(Error('old failure'),{code:'CARD_CONTEXT_CHANGED'}));await assert.rejects(staleFailure,{code:'NATIVE_CONTEXT_STALE'});
  delay=true;const pending=bridge.request('native.context');bridge.clearContext();release({cardScope:{cardId:'old'}});await assert.rejects(pending,{code:'NATIVE_CONTEXT_STALE'});await bridge.dispose();
});

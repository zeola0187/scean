import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {assembleSources,SYSTEMS} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {buildSavedSnapshot,createSceanControl,resolveSceanCardContext} from '../packages/studio/lib/scean-integration.js';
import {WorkspaceLoader} from '../packages/studio/lib/loader.js';
import {savedOpenings} from '../plugin/opening-selection.mjs';
import {STUDIO_PROVIDER} from '../plugin/card-scope.mjs';

const saved=(first='Main synthetic opening.',alternates=['Alternative one.','Alternative two.'],revision=0)=>({
 id:'card-A',type:'card',revision,sha256:'synthetic-sha-'+revision,
 card:{data:{name:'Synthetic card',first_mes:first,alternate_greetings:alternates,group_only_greetings:['Group-only possible scene.'],extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Synthetic background.'}]}}}}
});
async function fixture(t){
 const base=new URL('../.test-data/',import.meta.url);await mkdir(base,{recursive:true});const root=await mkdtemp(new URL('opening-',base));
 let now=1000,modelCalls=0,current;
 const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),model:{generate(){modelCalls++;throw Error('MODEL_FORBIDDEN');}},memory:new Memory()});
 const host=await new SceanHost({engine,root:join(root,'host'),now:()=>now}).init();
 const authority={requireCardScope:true,resolveCardScope:async()=>current,principal:'offline-operator'};
 const select=source=>current={provider:STUDIO_PROVIDER,cardId:source.id,authoringSessionId:'session-A',generation:'generation-A',savedRevision:source.revision,savedSha256:source.sha256};
 const call=(action,args={})=>host.request({action,sessionId:current?.authoringSessionId,cardScope:current,...args},undefined,authority);
 const prepare=async(source=saved())=>{select(source);return host.startFromStudio({snapshot:buildSavedSnapshot(source),authoringSessionId:current.authoringSessionId,generation:current.generation});};
 const offer=async()=>{const r=await call('openingOffer');assert(r.ok,JSON.stringify(r));return r.value;};
 const choice=(o,index=0)=>({offerId:o.offerId,cardId:o.cardId,revision:o.revision,snapshotHash:o.snapshotHash,openingIndex:index,playerName:'Synthetic player'});
 t.after(async()=>{await host.close();assert.equal(modelCalls,0);});
 return {root,host,engine,prepare,offer,choice,call,select,authority,scope:()=>current,advance:n=>now+=n};
}
test('formal Studio handoff defers multiple openings; exact alternative and full original card freeze in a new Run',async t=>{
 const f=await fixture(t),source=saved(),result=await f.prepare(source);
 assert.equal(result.openingRequired,true);assert.equal(result.runId,undefined);assert.equal((await f.engine.store.listRuns()).length,0);
 const o=await f.offer();assert.deepEqual(o.options.map(x=>x.index),[0,1,2]);assert.equal(o.revision,0);
 const r=await f.call('openingStart',f.choice(o,2));assert(r.ok,JSON.stringify(r));
 const run=await f.engine.store.read(r.value.runId);
 assert.equal(run.snapshot.opening.id,'studio-opening-2');assert.equal(run.openingId,'studio-opening-2');
 assert.equal(run.snapshot.opening.text,'Alternative two.');assert.deepEqual(run.snapshot.card,source.card);
 const sources=assembleSources(run.snapshot).sources;
 assert.equal(sources.selectedOpening.text,'Alternative two.');assert.deepEqual(sources.card.data.alternate_greetings,source.card.data.alternate_greetings);
 assert.match(SYSTEMS.director,/unselected possible scenes, never events/);
 assert.equal(await f.offer(),null);
 assert.equal((await f.call('create',{snapshot:buildSavedSnapshot(source)})).error.code,'CARD_SCOPED_STUDIO_REQUIRED');
});
test('one valid opening confirms the name; blank main and blank alternatives retain original indexes; all empty rejects',async t=>{
 const f=await fixture(t);
 for(const [source,index,text]of [[saved('Only main.',[]),0,'Only main.'],[saved(' ',['','Only alternative.']),2,'Only alternative.']]){
  const pending=await f.prepare(source);assert.equal(pending.openingRequired,true);const o=await f.offer();const result=(await f.call('openingStart',f.choice(o,index))).value;assert(result.runId);
  const run=await f.engine.store.read(result.runId);assert.equal(run.snapshot.opening.id,'studio-opening-'+index);assert.equal(run.snapshot.opening.text,text);
 }
 const multi=saved('',['A','','B']);await f.prepare(multi);assert.deepEqual((await f.offer()).options.map(x=>x.index),[1,3]);
 assert.deepEqual(savedOpenings(buildSavedSnapshot(saved('',[]))),[]);
 await assert.rejects(()=>f.prepare(saved(' ',['','\n'])),{code:'OPENING_EMPTY'});
});
test('Host rejects illegal indexes and client-forged card, revision or hash without creating a Run',async t=>{
 const f=await fixture(t);await f.prepare();const o=await f.offer(),request=f.choice(o,1);
 for(const index of [undefined,-1,3,1.5,'1',NaN])assert.equal((await f.call('openingStart',{...request,openingIndex:index})).error.code,'OPENING_INDEX');
 for(const forged of [{cardId:'card-B'},{revision:1},{snapshotHash:'forged'},{offerId:'forged'}])assert.equal((await f.call('openingStart',{...request,...forged})).ok,false);
 assert.equal((await f.engine.store.listRuns()).length,0);
 assert.equal((await f.call('openingStart',request)).ok,true);
});
test('live saved revision, content hash, card and generation changes reject an otherwise valid old choice',async t=>{
 const f=await fixture(t);
 for(const change of [{savedRevision:1},{savedSha256:'changed'},{cardId:'card-B'},{generation:'generation-B'},{authoringSessionId:'session-B'}]){
  await f.prepare();const o=await f.offer();Object.assign(f.scope(),change);
  assert.equal((await f.call('openingStart',f.choice(o,1))).error.code,'OPENING_STALE');
 }
 assert.equal((await f.engine.store.listRuns()).length,0);
});
test('expiry, replacement handoff, cancellation retry and abort-before-admission leave no Run',async t=>{
 const f=await fixture(t);await f.prepare();const expired=await f.offer();f.advance(600001);
 assert.equal((await f.call('openingStart',f.choice(expired,1))).error.code,'OPENING_EXPIRED');
 await f.prepare();const replaced=await f.offer();await f.prepare();
 assert.equal((await f.call('openingStart',f.choice(replaced,1))).error.code,'OPENING_EXPIRED');
 const active=await f.offer(),cancel=f.choice(active);
 assert.deepEqual((await f.call('openingCancel',cancel)).value,{cancelled:true});
 assert.deepEqual((await f.call('openingCancel',cancel)).value,{cancelled:true});
 assert.equal((await f.call('openingStart',cancel)).error.code,'OPENING_EXPIRED');
 await f.prepare();const aborted=await f.offer(),controller=new AbortController();controller.abort();
 await assert.rejects(()=>f.host.openings.start(f.choice(aborted,1),f.scope(),async()=>f.scope(),controller.signal),{name:'AbortError'});
 assert.equal((await f.engine.store.listRuns()).length,0);
});
test('simultaneous start/retry and a lost publication reply return one durable Run; a different retry choice rejects',async t=>{
 const f=await fixture(t);await f.prepare();const o=await f.offer(),request=f.choice(o,1);
 const create=f.host.createRun.bind(f.host);let calls=0;
 f.host.createRun=async args=>{calls++;await create(args);throw Error('SYNTHETIC_REPLY_LOST');};
 const first=await Promise.all([f.call('openingStart',request),f.call('openingStart',request)]);
 assert(first.every(r=>!r.ok));assert.equal(calls,1);assert.equal((await f.engine.store.listRuns()).length,1);
 f.host.createRun=create;
 const retry=await f.call('openingStart',request);assert(retry.ok,JSON.stringify(retry));
 assert.deepEqual((await f.call('openingStart',request)).value,retry.value);
 assert.equal((await f.call('openingStart',f.choice(o,2))).error.code,'OPENING_ALREADY_STARTED');
 assert.equal((await f.engine.store.listRuns()).length,1);
});
test('abort before admission allows another choice; cancellation after admission cannot erase or duplicate the accepted Run',async t=>{
 const f=await fixture(t);await f.prepare();const o=await f.offer(),controller=new AbortController();
 const read=f.engine.store.read.bind(f.engine.store);let release,entered;
 const ready=new Promise(resolve=>entered=resolve);
 f.engine.store.read=async id=>{entered();await new Promise(resolve=>release=resolve);return read(id);};
 const aborted=f.host.openings.start(f.choice(o,1),f.scope(),async()=>f.scope(),controller.signal);await ready;controller.abort();release();
 await assert.rejects(aborted,{name:'AbortError'});f.engine.store.read=read;assert.equal((await f.engine.store.listRuns()).length,0);
 let allow,accepted;const admission=new Promise(resolve=>accepted=resolve),create=f.host.createRun.bind(f.host);
 f.host.createRun=async args=>{accepted();await new Promise(resolve=>allow=resolve);return create(args);};
 const pending=f.call('openingStart',f.choice(o,2));await admission;
 assert.equal((await f.call('openingCancel',f.choice(o,2))).error.code,'OPENING_START_PENDING');
 allow();const result=await pending;assert(result.ok,JSON.stringify(result));
 assert.deepEqual((await f.call('openingStart',f.choice(o,2))).value,result.value);assert.equal((await f.engine.store.listRuns()).length,1);
});
test('changing revision and selecting or reopening an existing Run never changes its opening or creates another Run',async t=>{
 const f=await fixture(t);await f.prepare();const one=await f.call('openingStart',f.choice(await f.offer(),1));assert(one.ok);
 const file=join(f.engine.store.runDir(one.value.runId),'current.json'),before=await readFile(file,'utf8');
 const r2=saved('New main.',['New alternative.'],1);await f.prepare(r2);
 const two=await f.call('openingStart',f.choice(await f.offer(),1));assert(two.ok);assert.notEqual(two.value.runId,one.value.runId);
 for(const runId of [one.value.runId,two.value.runId,one.value.runId])assert.equal((await f.call('runView',{runId})).ok,true);
 assert.equal(await readFile(file,'utf8'),before);assert.equal((await f.engine.store.listRuns()).length,2);
 assert.equal((await f.engine.store.read(two.value.runId)).snapshot.opening.text,'New alternative.');
});
test('stage can reopen the same saved version with another opening; a new card revision or foreign Run is refused',async t=>{
 const f=await fixture(t);await f.prepare();const first=await f.call('openingStart',f.choice(await f.offer(),1));assert(first.ok);
 const file=join(f.engine.store.runDir(first.value.runId),'current.json'),before=await readFile(file,'utf8');
 const prepared=await f.call('openingPrepare',{runId:first.value.runId});assert.equal(prepared.value.openingRequired,true);
 assert.equal((await f.engine.store.listRuns()).length,1);
 const second=await f.call('openingStart',f.choice(await f.offer(),2));assert(second.ok);assert.notEqual(second.value.runId,first.value.runId);
 assert.equal((await f.engine.store.read(second.value.runId)).snapshot.opening.text,'Alternative two.');assert.equal(await readFile(file,'utf8'),before);
 f.select(saved('New main.',['New alternate.'],1));
 assert.equal((await f.call('openingPrepare',{runId:first.value.runId})).error.code,'OPENING_STALE');
 f.select({...saved(),id:'card-B'});assert.equal((await f.call('openingPrepare',{runId:first.value.runId})).error.code,'CARD_SCOPE_MISMATCH');
 assert.equal((await f.engine.store.listRuns()).length,2);
});
test('actual formal Studio Loader/Control sends multi-opening handoff to stage; live saved revision is checked again at selection',async t=>{
 const f=await fixture(t),root=join(f.root,'studio');await mkdir(root);
 const agent={id:'session-A',status:'idle',session:{header:{cwd:root}},whenIdle:async()=>{},cancel(){}};
 const loader=new WorkspaceLoader({root,agentLookup:id=>id===agent.id?agent:null,activateAddon:async()=>({dispose(){}})});
 await loader.init();await loader.setArchiveState([]);t.after(()=>loader.close());
 const claim=await loader.acquire(agent,'opening-formal-page'),record=loader.records.get(agent.id);
 const card={spec:'chara_card_v3',spec_version:'3.0',data:{name:'Synthetic formal card',description:'Synthetic',personality:'Calm',scenario:'Test',first_mes:'Main scene.',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:['Alternative scene.'],group_only_greetings:[],tags:[],creator:'QA',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Synthetic keeper.'}]}},character_book:{entries:[]}}};
 await writeFile(join(root,'imports','synthetic.json'),JSON.stringify(card));
 const imported=await loader.call(agent,record,claim,'import',{path:'imports/synthetic.json',type:'card'});assert(imported.ok,JSON.stringify(imported));
 const id=imported.value.id,control=createSceanControl(loader,()=>f.host);
 const prepare=revision=>control(agent,{claim,mode:'start',document_id:id,expected_revision:revision});
 f.authority.resolveCardScope=()=>resolveSceanCardContext(loader,agent.id);
 const invoke=async(action,args={})=>{const scope=await f.authority.resolveCardScope();return f.host.request({action,sessionId:agent.id,cardScope:scope,...args},undefined,f.authority);};
 assert.equal((await prepare(0)).openingRequired,true);const o=(await invoke('openingOffer')).value;assert.equal(o.options.length,2);
 const changed=await loader.call(agent,record,claim,'patch',{document_id:id,expected_revision:0,patches:[{op:'replace',path:'/data/alternate_greetings/0',value:'Revision one alternative.'}]});assert(changed.ok,JSON.stringify(changed));
 assert.equal((await invoke('openingStart',f.choice(o,1))).error.code,'OPENING_STALE');assert.equal((await f.engine.store.listRuns()).length,0);
 assert.equal((await prepare(1)).openingRequired,true);const latest=(await invoke('openingOffer')).value;
 const started=await invoke('openingStart',f.choice(latest,1));assert(started.ok,JSON.stringify(started));
 assert.equal((await f.engine.store.read(started.value.runId)).snapshot.opening.text,'Revision one alternative.');
});

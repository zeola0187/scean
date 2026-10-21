import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {PresentationHost} from '../plugin/presentation-host.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {materializeInitialState} from '../core/state-blueprint.mjs';
import {publicRunView} from '../core/inspection.mjs';
import {hash} from '../core/contracts.mjs';

const clone=v=>structuredClone(v);
async function fixture(t,{none=false,blueprint=true,fault,now}={}){
 const base=fileURLToPath(new URL('../.test-data/',import.meta.url));await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'presentation-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const f=w01Fixture('fantasy'),snapshot=clone(f.snapshot);snapshot.hash=hash(snapshot);
 if(none)delete snapshot.frontend;
 const state=materializeInitialState(f.bp,f.initial,snapshot.characters).state;state.world.resources.mana=23;
 if(!blueprint){delete snapshot.stateBlueprint;delete snapshot.frontend;delete snapshot.initialState;}
 const run={schemaVersion:1,runId:'synthetic-presentation-run',version:7,head:'synthetic-commit',snapshot,state,turns:[{turn:1,commitId:'synthetic-commit',requestId:'turn-one',input:'Observe.',body:'The archivist reads the synthetic gauge.'}],memories:[],playerHistory:[],receipts:{}};
 const store=new DurableStore({root});await store.create(run);const service=new PresentationHost({store,fault,...(now?{now}:{})});
 const candidate=clone(f.frontend);delete candidate.hash;candidate.html=candidate.html.replace('旅人手札','另一種外觀');
 const source={documentId:snapshot.cardId,revision:9,label:'Synthetic saved card'};
 const preview=()=>service.preview({runId:run.runId,frontend:candidate,source,expectedPresentationRevision:0});
 return {root,f,run,store,service,candidate,source,preview,file:path.join(store.runDir(run.runId),'current.json')};
}
const args=(f,p,operationId='panel-one',revision=0)=>({runId:f.run.runId,previewToken:p.previewToken,operationId,expectedPresentationRevision:revision,confirmed:true});

test('presentation previews current committed public values, adds a missing panel without changing any story byte',async t=>{
 const f=await fixture(t,{none:true}),before=await readFile(f.file),p=await f.preview();
 assert.equal(p.preview.projection.values.mana.value,23);assert.equal(p.source.revision,9);assert(!JSON.stringify(p).includes('RESTRICTED'));
 const result=await f.service.apply(args(f,p));assert.equal(result.presentationRevision,1);assert.equal(result.usingOriginal,false);assert.equal(result.canonical.version,7);
 assert.deepEqual(await readFile(f.file),before);
 const run=await f.store.read(f.run.runId),view=await f.service.decorate(run,publicRunView(run));assert.equal(view.presentationRevision,1);assert.equal(view.cardFrontend.projection.values.mana.value,23);assert.equal(view.cardFrontend.projection.presentationRevision,1);assert.equal(view.cardFrontend.projection.snapshotHash,f.run.snapshot.hash);
 assert.notEqual(view.cardFrontend.frontend.hash,f.f.frontend.hash);assert.equal(run.snapshot.frontend,undefined);
});

test('presentation apply requires confirmation, exact preview/run/head and presentation version',async t=>{
 const f=await fixture(t),p=await f.preview();
 await assert.rejects(f.service.apply({...args(f,p),confirmed:false}),{code:'PRESENTATION_CONFIRM_REQUIRED'});
 await assert.rejects(f.service.apply({...args(f,p),expectedPresentationRevision:1}),{code:'PRESENTATION_REVISION_CONFLICT'});
 const changed=await f.store.read(f.run.runId);changed.head='new-canonical';changed.version++;
 await f.store.withRunLock(changed.runId,()=>f.store.commit(changed.runId,7,changed));
 await assert.rejects(f.service.apply(args(f,p)),{code:'PRESENTATION_PREVIEW_STALE'});
 assert.equal((await f.service.view({runId:f.run.runId})).presentationRevision,0);
});

test('presentation refuses absent Blueprint, private/missing/type-mismatched bindings and source-card guesses',async t=>{
 const no=await fixture(t,{blueprint:false});assert.equal((await no.service.view({runId:no.run.runId})).code,'PRESENTATION_BLUEPRINT_REQUIRED');
 await assert.rejects(no.preview(),{code:'PRESENTATION_BLUEPRINT_REQUIRED'});
 const f=await fixture(t);for(const [change,code]of [
  [p=>p.bindings[0].target.key='not-tracked','FRONTEND_BINDING_MISSING'],
  [p=>{p.bindings[0].target={scope:'world',category:'facts',key:'secret'};p.bindings[0].type='string';},'FRONTEND_BINDING_UNAUTHORIZED'],
  [p=>p.bindings[0].type='boolean','FRONTEND_BINDING_TYPE'],
  [p=>p.html='<script>window.parent.postMessage("x","*")</script>','FRONTEND_HTML_UNSUPPORTED'],
 ]){const frontend=clone(f.candidate);change(frontend);await assert.rejects(f.service.preview({runId:f.run.runId,frontend,expectedPresentationRevision:0}),{code});}
 await assert.rejects(f.service.preview({runId:f.run.runId,frontend:f.candidate,source:{...f.source,documentId:'same-name-different-id'},expectedPresentationRevision:0}),{code:'PRESENTATION_SOURCE_MISMATCH'});
});

test('presentation cannot smuggle Blueprint, State, Memory, worldbook or new derived facts into a preview or apply',async t=>{
 const f=await fixture(t);for(const key of ['blueprint','stateBlueprint','initial_state','state','memories','worldbook','characters','derivedFacts','preset','body']){
  await assert.rejects(f.service.preview({runId:f.run.runId,frontend:f.candidate,expectedPresentationRevision:0,[key]:{}}),{code:'PRESENTATION_INPUT_FIELDS'});
 }
 const p=await f.preview();await assert.rejects(f.service.apply({...args(f,p),frontend:f.candidate}),{code:'PRESENTATION_INPUT_FIELDS'});
 const frontend=clone(f.candidate);frontend.derivedBindings=[{alias:'new-rule',factId:'invented-rule'}];await assert.rejects(f.service.preview({runId:f.run.runId,frontend,expectedPresentationRevision:0}),{code:'FRONTEND_DERIVED_REQUIRED'});
});

test('presentation persists across Host/store reopen, source deletion, and supports monotonic previous/original restore',async t=>{
 const f=await fixture(t,{none:true}),before=await readFile(f.file),p=await f.preview();await f.service.apply(args(f,p));
 const service=new PresentationHost({store:new DurableStore({root:f.root})});
 assert.equal((await service.view({runId:f.run.runId})).presentationRevision,1);
 const second=clone(f.candidate);second.html=second.html.replace('另一種外觀','第三種外觀');const p2=await service.preview({runId:f.run.runId,frontend:second,expectedPresentationRevision:1});await service.apply(args(f,p2,'panel-two',1));
 let result=await service.restore({runId:f.run.runId,target:'previous',expectedPresentationRevision:2,operationId:'restore-prev',confirmed:true});assert.equal(result.presentationRevision,3);assert.equal(result.usingOriginal,false);
 let view=await service.decorate(await f.store.read(f.run.runId),publicRunView(f.run));assert(view.cardFrontend.frontend.tree.some(n=>JSON.stringify(n).includes('另一種外觀')));
 result=await service.restore({runId:f.run.runId,target:'original',expectedPresentationRevision:3,operationId:'restore-original',confirmed:true});assert.equal(result.presentationRevision,4);assert.equal(result.usingOriginal,true);
 view=await service.decorate(await f.store.read(f.run.runId),publicRunView(f.run));assert.equal(view.cardFrontend,null);assert.equal(view.presentationRevision,4);assert.deepEqual(await readFile(f.file),before);
});

test('presentation uses durable operation receipts after restart and rejects conflicting replay',async t=>{
 const f=await fixture(t),p=await f.preview(),input=args(f,p);await f.service.apply(input);
 const reopened=new PresentationHost({store:f.store}),r=await reopened.apply(input);assert.equal(r.replayed,true);assert.equal(r.presentationRevision,1);
 await assert.rejects(reopened.apply({...input,previewToken:'another-preview'}),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal((await reopened.view({runId:f.run.runId})).presentationRevision,1);
});

test('two presentation contenders cannot overwrite a newer revision and never take the story write path',async t=>{
 const f=await fixture(t),p=await f.preview(),other=new PresentationHost({store:f.store}),q=await other.preview({runId:f.run.runId,frontend:f.candidate,expectedPresentationRevision:0});
 const before=await readFile(f.file),results=await Promise.allSettled([f.service.apply(args(f,p,'device-one')),other.apply(args(f,q,'device-two'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.service.view({runId:f.run.runId})).presentationRevision,1);assert.deepEqual(await readFile(f.file),before);
});

test('presentation publication failure keeps original; lost acknowledgment reads the committed receipt without applying twice',async t=>{
 let faultPoint='beforeRename';const f=await fixture(t,{fault:async point=>{if(point===faultPoint)throw Error('synthetic I/O interruption');}}),p=await f.preview();
 await assert.rejects(f.service.apply(args(f,p)));assert.equal((await f.service.view({runId:f.run.runId})).presentationRevision,0);
 faultPoint='afterRename';const result=await f.service.apply(args(f,p));assert.equal(result.recovered,true);assert.equal(result.presentationRevision,1);
 const replay=await f.service.apply(args(f,p));assert.equal(replay.replayed,true);assert.equal(replay.presentationRevision,1);
});

test('presentation expiry, Run lock contention and Snapshot identity changes fail safely',async t=>{
 let time=1000;const f=await fixture(t,{now:()=>time}),p=await f.preview();time+=5*60*1000+1;await assert.rejects(f.service.apply(args(f,p)),{code:'PRESENTATION_PREVIEW_EXPIRED'});
 time=1000;const next=await f.preview();await f.store.withRunLock(f.run.runId,async()=>{await assert.rejects(f.service.apply(args(f,next)),{code:'RUN_BUSY'});});
 await f.service.apply(args(f,next));const run=await f.store.read(f.run.runId);run.snapshot.hash='different-snapshot';await f.store.atomic(f.file,run);const view=await f.service.view({runId:f.run.runId});assert.equal(view.status,'unavailable');assert.equal(view.code,'PRESENTATION_IDENTITY_MISMATCH');
 const decorated=await f.service.decorate(run,publicRunView(run));assert.equal(decorated.presentation.status,'unavailable');assert.equal(decorated.cardFrontend.frontend.hash,f.f.frontend.hash);
});

test('presentation retains override across story rollback/head changes and reads the new committed State',async t=>{
 const f=await fixture(t),p=await f.preview();await f.service.apply(args(f,p));const run=await f.store.read(f.run.runId);run.version++;run.head=null;run.state.world.resources.mana=0;run.turns=[];
 await f.store.withRunLock(run.runId,()=>f.store.commit(run.runId,7,run));const view=await f.service.decorate(run,publicRunView(run));assert.equal(view.presentationRevision,1);assert.equal(view.cardFrontend.projection.values.mana.value,0);assert.equal(view.cardFrontend.projection.canonical.head,null);assert.equal(view.cardFrontend.projection.canonical.version,8);
});

test('presentation cancellation before publication retains display; cancellation after publication preserves receipt truth',async t=>{
 let controller=new AbortController(),phase='beforeRename';const f=await fixture(t,{fault:async point=>{if(point===phase)controller.abort();}}),p=await f.preview(),before=await readFile(f.file);
 await assert.rejects(f.service.apply({...args(f,p),signal:controller.signal}));assert.equal((await f.service.view({runId:f.run.runId})).presentationRevision,0);
 controller=new AbortController();phase='afterRename';const result=await f.service.apply({...args(f,p),signal:controller.signal});assert.equal(result.presentationRevision,1);assert.equal((await f.service.view({runId:f.run.runId})).lastOperationId,'panel-one');assert.deepEqual(await readFile(f.file),before);
});

test('corrupt presentation metadata degrades only display while retaining official public State',async t=>{
 const f=await fixture(t);await f.service.settings.atomic(f.service.file(f.run.runId),{schemaVersion:999,raw:'not a presentation'});const view=await f.service.decorate(f.run,publicRunView(f.run));assert.equal(view.presentation.status,'unavailable');assert.equal(view.version,7);assert.equal(view.worldView.declared.find(v=>v.key==='mana').value,23);assert.equal(view.cardFrontend.frontend.hash,f.f.frontend.hash);assert(!JSON.stringify(view).includes('RESTRICTED'));
});

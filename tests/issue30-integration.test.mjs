// Canonical Studio + actual filesystem stores + Host integration. Every card,
// Session, review conclusion and model response below is an offline fixture.
// A fixture review receipt validates plumbing, never real semantic quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {WorkspaceLoader} from '../sources/card-studio/cardstudio-bundle/lib/loader.js';
import {createWorkReview} from '../sources/card-studio/cardstudio-bundle/lib/work-review.js';
import {createSceanControl,resolveSceanCardContext,resolveSceanSourceSession} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';

async function fixture(t){
  const base=resolve(import.meta.dirname,'../.test-data');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'issue30-integration-')),workspace=join(root,'studio');await mkdir(workspace);
  const agents=new Map(['issue30-session-A','issue30-session-B','issue30-session-C'].map(id=>[id,{id,status:'idle',session:{header:{cwd:workspace}},whenIdle:async()=>{},cancel(){}}]));
  const loader=new WorkspaceLoader({root:workspace,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose(){}})});await loader.init();await loader.setArchiveState([]);
  const stages=[],model={async generate({stage}){stages.push(stage);return {text:stage==='director'?JSON.stringify({handoffVersion:1,sceneIntent:'Wait at the synthetic gate.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]}):stage==='post_stat'?JSON.stringify({contractVersion:2,stateChanges:[],memories:[]}):'The keeper waits beside the quiet synthetic gate.'};}};
  const store=new DurableStore({root:join(root,'store')}),engine=new SceanEngine({store,model,memory:new Memory()}),host=await new SceanHost({engine,root:join(root,'host')}).init();
  const service={auditSavedSnapshot,startFromStudio:host.startFromStudio.bind(host),inspectFromStudio:host.inspectFromStudio.bind(host),attachInspection:host.attachInspection.bind(host),publishFromStudio:host.publishFromStudio.bind(host),scriptStatusFromStudio:host.scriptStatusFromStudio.bind(host),startScriptFromStudio:host.startScriptFromStudio.bind(host)};
  const review=createWorkReview(loader),control=createSceanControl(loader,()=>service,review),claims=new Map();
  async function acquire(id){const agent=agents.get(id),claim=await loader.acquire(agent,'page-'+id);claims.set(id,claim);return {agent,claim};}
  const a=await acquire('issue30-session-A'),b=await acquire('issue30-session-B'),c=await acquire('issue30-session-C');
  const cardCall=async(owner,action,args={})=>{const result=await loader.call(owner.agent,loader.records.get(owner.agent.id),owner.claim,action,args);assert(result.ok,JSON.stringify(result));return result.value;};
  const authority={principal:'synthetic-human',allowGlobalSettings:true,allowPrivateSaves:true,requireCardScope:true,resolveCardScope:id=>resolveSceanCardContext(loader,id),resolveSourceSession:(id,scope)=>resolveSceanSourceSession(loader,id,scope)};
  const hostCall=async(owner,action,args={})=>{const cardScope=await authority.resolveCardScope(owner.agent.id);return host.request({action,sessionId:owner.agent.id,cardScope,...args},undefined,authority);};
  async function cover(owner,documentId,revision){
    const tool=args=>review.call(owner.agent,loader.records.get(owner.agent.id),{document_id:documentId,expected_revision:revision,...args});
    const begin=(await tool({action:'begin'})).value,identity={review_id:begin.reviewId,fingerprint:begin.evidenceFingerprint};let offset=0,pages=0;
    do{const page=(await tool({action:'read',...identity,offset})).value;assert(Buffer.byteLength(JSON.stringify(page))<8192);offset=page.nextOffset;pages++;}while(offset!==null);
    const receipt=(await tool({action:'complete',...identity,verdict:'pass',summary:'Offline fixture conclusion for integration plumbing only; no AI quality or live-play claim.',issues:[]})).value;
    assert.equal(receipt.coverage,'complete');assert.equal(receipt.modelQualityVerified,false);return {receipt,identity,pages,tool};
  }
  async function start(owner,script,operationId,index=0){
    const prepared=await hostCall(owner,'scriptStart',{scriptId:script.scriptId,scriptHash:script.scriptHash,expectedRevision:script.revision,operationId});assert(prepared.ok,JSON.stringify(prepared));
    const offer=(await hostCall(owner,'openingOffer')).value;assert.equal(offer.scriptId,script.scriptId);
    const started=await hostCall(owner,'openingStart',{offerId:offer.offerId,cardId:offer.cardId,revision:offer.revision,snapshotHash:offer.snapshotHash,openingIndex:index,playerName:'Synthetic player'});assert(started.ok,JSON.stringify(started));return started.value;
  }
  t.after(async()=>{await loader.close();await host.close();await rm(root,{recursive:true,force:true});});
  return {root,loader,host,engine,store,stages,review,control,a,b,c,cardCall,hostCall,cover,start,authority};
}

test('Issue 30 real canonical flow: saved card → bounded review receipt → immutable Scripts → independent Runs and exact source return',async t=>{
  const f=await fixture(t),created=await f.cardCall(f.a,'create',{name:'Same integration title',description:'A keeper of a synthetic gate. '+('Synthetic world setting. '.repeat(250)),first_mes:'Original main opening.'});
  const roster=await f.cardCall(f.a,'scean_character',{document_id:created.id,expected_revision:created.revision,character:{id:'keeper',name:'Keeper',description:'A synthetic keeper with an explicit source.'},sources:[{kind:'card_field',path:'/data/description'}]});
  const saved=await f.cardCall(f.a,'patch',{document_id:created.id,expected_revision:roster.revision,patches:[{op:'replace',path:'/data/alternate_greetings',value:['Original alternate opening.']}]});
  const stale=await f.loader.call(f.a.agent,f.loader.records.get(f.a.agent.id),f.a.claim,'patch',{document_id:created.id,expected_revision:roster.revision,patches:[{op:'replace',path:'/data/first_mes',value:'Stale change must not commit.'}]});assert.equal(stale.ok,false);
  const args={claim:f.a.claim,document_id:created.id,expected_revision:saved.revision,request_id:'issue30-publish-first'};
  const prepared=await f.control(f.a.agent,{...args,mode:'prepare'});assert.equal(prepared.prepared,false);assert.equal(prepared.review.status,'pending');assert.equal(prepared.checks.audit.limits.modelsInvoked,0);
  await assert.rejects(f.control(f.a.agent,{...args,mode:'publish'}),{code:'SCEAN_REVIEW_PENDING'});assert.deepEqual(await f.host.scripts.list(),[]);assert.deepEqual(await f.store.listRuns(),[]);
  const reviewed=await f.cover(f.a,created.id,saved.revision);assert(reviewed.pages>1);
  const persisted=(await createWorkReview(f.loader).call(f.a.agent,f.loader.records.get(f.a.agent.id),{action:'status',document_id:created.id,expected_revision:saved.revision})).value;assert.equal(persisted.receiptId,reviewed.receipt.receiptId);
  const first=await f.control(f.a.agent,{...args,mode:'publish'});assert.equal(first.receipt.status,'committed');assert.deepEqual(await f.control(f.a.agent,{...args,mode:'publish'}),first);assert.equal(f.stages.length,0);
  const record=await f.host.scripts.read(first.scriptId);assert.equal(record.review.receiptId,persisted.receiptId);assert.equal(record.review.publicationBinding.reviewedSnapshotHash,persisted.snapshotHash);assert.equal(record.review.publicationBinding.publishedSnapshotHash,first.scriptHash);
  assert.deepEqual((await f.hostCall(f.a,'scriptList')).value.map(row=>row.scriptId),[first.scriptId]);const got=(await f.hostCall(f.a,'scriptGet',{scriptId:first.scriptId})).value;assert.equal(got.sourceSessionAvailable,true);assert.equal(got.openings.length,2);
  const run1=await f.start(f.a,first,'issue30-start-one',1),fixed=await f.store.read(run1.runId);assert.equal(fixed.snapshot.opening.text,'Original alternate opening.');assert.equal(fixed.scriptId,first.scriptId);
  await assert.rejects(f.host.inspectFromStudio({...run1,authoringSessionId:f.b.agent.id,generation:f.loader.records.get(f.b.agent.id).generation}),{code:'INSPECTION_DENIED'});
  const turn=await f.hostCall(f.a,'turn',{runId:run1.runId,input:'Wait by the gate.',requestId:'issue30-synthetic-turn'});assert(turn.ok,JSON.stringify(turn));assert.equal(turn.value.status,'committed');assert(f.stages.includes('writer'));assert(f.stages.includes('post_stat'));
  const oldBytes=await readFile(f.store.currentFile(run1.runId),'utf8'),oldRun=await f.store.read(run1.runId);assert.equal(oldRun.snapshot.hash,fixed.snapshot.hash);assert.equal(oldRun.turns.length,1);
  const exported=validateRunBundle(JSON.stringify(encodeRunBundle(oldRun)));assert.equal(exported.snapshot.source.script.scriptId,first.scriptId);assert.equal(exported.snapshot.source.authoring.sessionId,f.a.agent.id);assert.deepEqual(exported.snapshot.characters[0].sourceBindings,oldRun.snapshot.characters[0].sourceBindings);
  const bundle=await f.hostCall(f.a,'exportRun',{runId:run1.runId,acknowledgement:'export-private-run-data'});assert(bundle.ok,JSON.stringify(bundle));
  const importedStore=new DurableStore({root:join(f.root,'imported-store')}),importedHost=await new SceanHost({engine:new SceanEngine({store:importedStore,model:{generate(){assert.fail('Import must not generate');}},memory:new Memory()}),root:join(f.root,'imported-host')}).init();
  try{
    const scope=await f.authority.resolveCardScope(f.a.agent.id),importResult=await importedHost.request({action:'importRun',sessionId:f.a.agent.id,cardScope:scope,bundle:bundle.value,acknowledgement:'import-private-run-data'},undefined,f.authority);assert(importResult.ok,JSON.stringify(importResult));
    const restored=(await importedHost.request({action:'runView',runId:run1.runId,sessionId:f.a.agent.id,cardScope:scope},undefined,f.authority)).value;assert.equal(restored.scriptId,first.scriptId);assert.equal(restored.scriptHash,first.scriptHash);assert.equal(restored.sourceSessionId,f.a.agent.id);assert.equal(restored.sourceSessionAvailable,true);assert.deepEqual((await importedStore.read(run1.runId)).snapshot,oldRun.snapshot);
  }finally{await importedHost.close();}
  const revision2=await f.cardCall(f.a,'patch',{document_id:created.id,expected_revision:saved.revision,patches:[{op:'replace',path:'/data/first_mes',value:'Revision two main opening.'}]});
  const run2=await f.start(f.a,first,'issue30-start-old-again');assert.notEqual(run2.runId,run1.runId);assert.equal((await f.store.read(run2.runId)).snapshot.opening.text,'Original main opening.');assert.equal(await readFile(f.store.currentFile(run1.runId),'utf8'),oldBytes);
  const nextArgs={...args,expected_revision:revision2.revision,request_id:'issue30-publish-second',preset:{id:'synthetic-preset',revision:2,instructions:'Keep the complete revised synthetic Preset.'}};
  const presetSaved=await f.control(f.a.agent,{...nextArgs,mode:'presetSave',expected_preset_revision:0,operation_id:'issue30-preset-independent-001'});assert.equal(presetSaved.receipt.status,'committed');nextArgs.expected_preset_revision=presetSaved.revision;
  assert.equal((await f.control(f.a.agent,{...nextArgs,mode:'prepare'})).prepared,false);const nextReview=await f.cover(f.a,created.id,revision2.revision);assert.notEqual(nextReview.receipt.evidenceFingerprint,persisted.evidenceFingerprint);
  const second=await f.control(f.a.agent,{...nextArgs,mode:'publish'});assert.notEqual(second.scriptId,first.scriptId);assert.notEqual(second.scriptHash,first.scriptHash);
  const run3=await f.start(f.a,second,'issue30-start-new');assert.equal((await f.store.read(run3.runId)).snapshot.opening.text,'Revision two main opening.');assert.equal((await f.store.read(run3.runId)).snapshot.preset.instructions,nextArgs.preset.instructions);
  await f.cardCall(f.b,'open',{document_id:created.id});
  await assert.rejects(f.review.call(f.b.agent,f.loader.records.get(f.b.agent.id),{action:'read',document_id:created.id,expected_revision:revision2.revision,...nextReview.identity,offset:0}),{code:'REVIEW_TARGET'});
  const run4=await f.start(f.b,first,'issue30-session-B-start'),view=(await f.hostCall(f.b,'runView',{runId:run4.runId})).value;assert.equal(view.sourceSessionId,f.b.agent.id);assert.equal(view.scriptSourceSessionId,f.a.agent.id);assert.equal(view.sourceSessionAvailable,true);
  await f.loader.release(f.a.agent,f.a.claim);assert.equal(f.loader.records.has(f.a.agent.id),false);
  const origin=(await f.hostCall(f.b,'scriptGet',{scriptId:first.scriptId})).value;assert.equal(origin.sourceSessionId,f.a.agent.id);assert.equal(origin.sourceSessionAvailable,true);assert.equal(f.loader.records.has(f.a.agent.id),false);
  const secondCreate=await f.loader.call(f.b.agent,f.loader.records.get(f.b.agent.id),f.b.claim,'create',{name:'Same integration title'});assert.equal(secondCreate.error.code,'SESSION_CARD_BOUND');
  const sameName=await f.cardCall(f.c,'create',{name:'Same integration title',description:'A different synthetic card.',first_mes:'Other opening.'});assert.notEqual(sameName.id,created.id);
  assert.deepEqual((await f.hostCall(f.c,'scriptList')).value,[]);assert.equal((await f.hostCall(f.c,'scriptGet',{scriptId:first.scriptId})).error.code,'CARD_SCOPE_MISMATCH');assert.equal((await f.hostCall(f.c,'runView',{runId:run4.runId})).error.code,'CARD_SCOPE_MISMATCH');
  assert.equal(await readFile(f.store.currentFile(run1.runId),'utf8'),oldBytes);assert.equal((await f.host.scripts.list()).length,2);assert.equal((await f.store.listRuns()).length,4);
});

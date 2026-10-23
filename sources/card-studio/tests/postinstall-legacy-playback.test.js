// Upgrade compatibility using synthetic legacy metadata and real disk services.
// No installed/user Session, card, Run, model provider or production path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {buildSavedSnapshot,createSceanControl,resolveSceanCardContext,resolveSceanSourceSession,resolveSceanPlaybackStatus} from '../cardstudio-bundle/lib/scean-integration.js';
import {SceanHost} from '../../../plugin/host.mjs';
import {SceanEngine} from '../../../core/engine.mjs';
import {Memory} from '../../../core/memory.mjs';
import {DurableStore} from '../../../adapters/store.mjs';

const card=description=>({spec:'chara_card_v3',spec_version:'3.0',data:{name:'Same synthetic name',description,personality:'Independent.',scenario:'Synthetic station.',first_mes:'An old synthetic opening.',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],group_only_greetings:[],tags:[],creator:'offline fixture',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Independent synthetic keeper.'}]}}}});
async function fixture(t){
 const base=resolve(import.meta.dirname,'../../../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(join(base,'legacy-playback-')),workspace=join(root,'studio');await fs.mkdir(workspace);
 const ids=['legacy-A','same-card-peer','fixed-B','unselected'],agents=new Map(ids.map(id=>[id,{id,status:'idle',session:{header:{cwd:workspace}},whenIdle:async()=>{},cancel(){}}]));
 const loaders=[];let loader;const claims=new Map();
 const setup=async()=>{loader=new WorkspaceLoader({root:workspace,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose(){}})});loaders.push(loader);await loader.init();await loader.setArchiveState([]);claims.clear();};
 const acquire=async id=>{const claim=await loader.acquire(agents.get(id),'page-fixture-'+id);claims.set(id,claim);return claim;};
 const invoke=(id,action,args)=>loader.call(agents.get(id),loader.records.get(id),claims.get(id),action,args);
 const ok=async(id,action,args)=>{const r=await invoke(id,action,args);assert(r.ok,JSON.stringify(r));return r.value;};
 await setup();for(const id of ids)await acquire(id);
 for(const [file,description] of [['a','Original card A'],['b','Distinct same-name card B']])await fs.writeFile(join(workspace,'imports',file+'.json'),JSON.stringify(card(description)));
 const a=await ok('legacy-A','import',{path:'imports/a.json',type:'card'}),b=await ok('fixed-B','import',{path:'imports/b.json',type:'card'});await ok('same-card-peer','open',{document_id:a.id});
 const saved=await ok('legacy-A','read',{document_id:a.id}),snapshot=buildSavedSnapshot(saved);
 let modelCalls=0;const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),memory:new Memory(),model:{async generate({stage}){modelCalls++;if(stage==='director')return {text:'Observe the synthetic station.'};if(['draft','prose'].includes(stage))return {text:'The keeper inspected the old lamp.'};if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};assert.fail('Unexpected synthetic stage '+stage);}}});
 const host=await new SceanHost({engine,root:join(root,'host')}).init();const old=await host.createRun({snapshot,playerName:'Synthetic player'});await host.turn({runId:old.runId,requestId:'synthetic-old-progress',input:'Look at the old lamp.',expectedVersion:0});
 await ok('legacy-A','patch',{document_id:a.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Later working card A'}]});
 await loader.close();const indexFile=join(workspace,'.cardstudio-scean/working-copy-sessions.json'),index=JSON.parse(await fs.readFile(indexFile,'utf8'));
 index.bindings=index.bindings.filter(row=>row.sessionId==='fixed-B');index.documents.find(row=>row.id===a.id).sessions.push('unselected');await fs.writeFile(indexFile,JSON.stringify(index));const indexBytes=await fs.readFile(indexFile);
 await setup();
 const authority={principal:'synthetic-owner',allowGlobalSettings:true,requireCardScope:true,resolveCardScope:id=>resolveSceanCardContext(loader,id),resolveSourceSession:(id,scope)=>resolveSceanSourceSession(loader,id,scope),resolvePlaybackStatus:id=>resolveSceanPlaybackStatus(loader,id)};
 const request=async(id,action,args={})=>host.request({action,sessionId:id,cardScope:await resolveSceanCardContext(loader,id),...args},undefined,authority);
 t.after(async()=>{for(const l of loaders)await l.close();await host.close();assert.equal(dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
 return {root,workspace,a,b,saved,snapshot,old,host,engine,agents,claims,acquire,invoke,ok,indexFile,indexBytes,request,authority,get loader(){return loader;},get modelCalls(){return modelCalls;}};
}

test('legacy exact selection restores existing Run scope and progress without binding, copying or rewriting its snapshot',async t=>{
 const f=await fixture(t),claim=await f.acquire('legacy-A');assert.equal(claim.selection_status.document_id,null);assert.equal(claim.selection_status.binding_status.status,'unbound');
 const file=f.engine.store.currentFile(f.old.runId),before=await fs.readFile(file),old=await f.engine.store.read(f.old.runId),calls=f.modelCalls;
 const scope=await resolveSceanCardContext(f.loader,'legacy-A');assert(scope,'The pre-upgrade exact selection must remain usable for playback.');assert.equal(scope.cardId,f.a.id);assert.equal(scope.savedRevision,1);assert.equal(scope.authoringBindingRequired,true);
 const listed=await f.request('legacy-A','list');assert(listed.ok,JSON.stringify(listed));assert.deepEqual(listed.value.map(row=>row.runId),[f.old.runId]);assert.equal(listed.value[0].revision,0);assert.equal(listed.value[0].scriptId,undefined);
 const view=await f.request('legacy-A','runView',{runId:f.old.runId});assert(view.ok,JSON.stringify(view));assert.equal((await f.engine.store.read(f.old.runId)).version,1);
 assert.deepEqual(await fs.readFile(file),before);assert.deepEqual(await fs.readFile(f.indexFile),f.indexBytes);assert.equal(f.modelCalls,calls);
 const continued=await f.request('legacy-A','turn',{runId:f.old.runId,requestId:'synthetic-continue-existing',input:'Continue the existing scene.',expectedVersion:1});assert(continued.ok,JSON.stringify(continued));
 const after=await f.engine.store.read(f.old.runId);assert.equal(after.version,2);assert.equal(after.snapshot.hash,old.snapshot.hash);assert.deepEqual(after.snapshot,old.snapshot);assert.equal((await f.engine.store.listRuns()).length,1);assert.deepEqual(await fs.readFile(f.indexFile),f.indexBytes);
});

test('availability is a bounded readonly hint without a lease, migration or source payload',async t=>{
 const f=await fixture(t),fresh=new WorkspaceLoader({root:f.workspace,agentLookup:id=>f.agents.get(id),activateAddon:async()=>{assert.fail('Status must not activate authoring.');}});
 // No init/acquire: only the already-known official archive snapshot is supplied.
 fresh.canonical=f.loader.canonical;fresh.archiveIds=[];fresh.archived=new Set();
 const before=await fs.readFile(f.indexFile),runBytes=await fs.readFile(f.engine.store.currentFile(f.old.runId));
 assert.deepEqual(await resolveSceanPlaybackStatus(fresh,'legacy-A'),{status:'available',authoringBindingRequired:true});
 assert.deepEqual(await resolveSceanPlaybackStatus(fresh,'fixed-B'),{status:'available',authoringBindingRequired:false});
 assert.deepEqual(await resolveSceanPlaybackStatus(fresh,'unselected'),{status:'unselected'});
 assert.deepEqual(await resolveSceanPlaybackStatus(fresh,'unknown'),{status:'unavailable'});
 assert.equal(fresh.records.size,0);assert.equal(fresh.workspace,null);assert.deepEqual(await fs.readFile(f.indexFile),before);assert.deepEqual(await fs.readFile(f.engine.store.currentFile(f.old.runId)),runBytes);
 const outside={id:'foreign',session:{header:{cwd:join(f.root,'outside')}}};f.agents.set(outside.id,outside);assert.deepEqual(await resolveSceanPlaybackStatus(fresh,'foreign'),{status:'unavailable'});
});

test('normal archived-source lifecycle stays denied; context explains it without restoring source or changing old Run',async t=>{
 const f=await fixture(t);await f.acquire('legacy-A');
 // Real archive handling, not forged scope or a manually moved live source.
 await f.loader.setArchiveState(['legacy-A','same-card-peer','unselected']);
 const service=f.loader.workspace?.service??f.loader.serviceFactory(),life=await service.lifecycle.read();assert.equal(life.copies.find(row=>row.id===f.a.id).location,'recycled');
 const index=await fs.readFile(f.indexFile),journalFile=join(f.workspace,'.cardstudio-scean/session-lifecycle.json'),journal=await fs.readFile(journalFile),run=await fs.readFile(f.engine.store.currentFile(f.old.runId));
 assert.equal(await service.selectedPlaybackDocument('legacy-A'),null);assert.deepEqual(await service.playbackStatus('legacy-A'),{status:'source_recycled',authoringBindingRequired:true});
 await assert.rejects(f.acquire('legacy-A'),{code:'SESSION_ARCHIVED'});
 const context=await f.host.request({action:'context',sessionId:'legacy-A',playbackStatus:{status:'available'},cardScope:{provider:'@local/dsh-card-studio-scean-test',cardId:f.a.id}},undefined,f.authority);
 assert.deepEqual(context,{ok:true,value:{cardScope:null,playbackStatus:{status:'session_archived'}}});
 for(const action of ['list','runView','turn']){const response=await f.host.request({action,sessionId:'legacy-A',runId:f.old.runId,cardScope:{provider:'@local/dsh-card-studio-scean-test',cardId:f.a.id}},undefined,f.authority);assert(!response.ok,JSON.stringify(response));assert.equal(response.error.code,'SESSION_ARCHIVED');}
 assert.deepEqual(await fs.readFile(f.indexFile),index);assert.deepEqual(await fs.readFile(journalFile),journal);assert.deepEqual(await fs.readFile(f.engine.store.currentFile(f.old.runId)),run);
 await assert.rejects(fs.stat(join(f.workspace,'.cardstudio-scean/documents',f.a.id)),{code:'ENOENT'});
 assert.equal((await service.lifecycle.read()).copies.find(row=>row.id===f.a.id).location,'recycled');
});

test('availability explains missing/pending sources and corrupt identities fail closed without returning a usable scope',async t=>{
 const f=await fixture(t);await f.acquire('legacy-A');const service=f.loader.workspace.service,pointer=join(f.workspace,'.cardstudio-scean/documents',f.a.id,'current.json'),bytes=await fs.readFile(pointer);
 await fs.unlink(pointer);assert.deepEqual(await resolveSceanPlaybackStatus(f.loader,'legacy-A'),{status:'source_missing',authoringBindingRequired:true});assert.equal((await f.host.request({action:'context',sessionId:'legacy-A'},undefined,f.authority)).value.cardScope,null);await fs.writeFile(pointer,bytes);
 const file=join(f.workspace,'.cardstudio-scean/session-lifecycle.json'),before=await fs.readFile(file),life=JSON.parse(before);life.copies.push({id:f.a.id,location:'active',pending:{from:'active',to:'recycled'}});await fs.writeFile(file,JSON.stringify(life));
 assert.deepEqual(await resolveSceanPlaybackStatus(f.loader,'legacy-A'),{status:'source_pending',authoringBindingRequired:true});assert.equal(await resolveSceanCardContext(f.loader,'legacy-A'),null);await fs.writeFile(file,before);
 const index=JSON.parse(f.indexBytes);index.selections.push({sessionId:'legacy-A',documentId:f.a.id});const corrupt=Buffer.from(JSON.stringify(index));await fs.writeFile(f.indexFile,corrupt);
 assert.deepEqual(await resolveSceanPlaybackStatus(f.loader,'legacy-A'),{status:'unavailable'});assert.deepEqual((await f.host.request({action:'context',sessionId:'legacy-A'},undefined,f.authority)).value,{cardScope:null,playbackStatus:{status:'unavailable'}});assert.deepEqual(await fs.readFile(f.indexFile),corrupt);
});

test('playback compatibility does not grant authoring or infer a card from membership or a namesake',async t=>{
 const f=await fixture(t);for(const id of ['legacy-A','fixed-B','unselected'])await f.acquire(id);
 assert.equal((await f.invoke('legacy-A','read',{document_id:f.a.id})).error.code,'SESSION_CARD_REQUIRED');
 assert.equal((await f.invoke('legacy-A','patch',{document_id:f.a.id,expected_revision:1,patches:[]})).error.code,'SESSION_CARD_REQUIRED');
 const control=createSceanControl(f.loader,()=>({}));await assert.rejects(control(f.agents.get('legacy-A'),{claim:f.claims.get('legacy-A'),mode:'presetRead',document_id:f.a.id}),{code:'SCEAN_SELECTION'});
 assert.equal(await resolveSceanCardContext(f.loader,'unselected'),null);assert.deepEqual((await f.request('unselected','list')).value,[]);
 assert.equal((await f.request('fixed-B','runView',{runId:f.old.runId})).error.code,'CARD_SCOPE_MISMATCH');
 const forged=await f.host.request({action:'runView',runId:f.old.runId,sessionId:'fixed-B',cardScope:await resolveSceanCardContext(f.loader,'legacy-A')},undefined,f.authority);assert.equal(forged.error.code,'CARD_CONTEXT_CHANGED');
 assert.deepEqual(await fs.readFile(f.indexFile),f.indexBytes);
 // Explicit human choice is still required for authoring and may choose a
 // different UUID; playback compatibility never permanently pins a legacy one.
 await f.ok('legacy-A','open',{document_id:f.b.id});assert.equal((await resolveSceanCardContext(f.loader,'legacy-A')).cardId,f.b.id);assert.equal((await resolveSceanCardContext(f.loader,'legacy-A')).authoringBindingRequired,false);
 assert.equal((await f.request('legacy-A','runView',{runId:f.old.runId})).error.code,'CARD_SCOPE_MISMATCH');assert.equal((await f.invoke('legacy-A','open',{document_id:f.a.id})).error.code,'SESSION_CARD_BOUND');
});

test('source navigation reads only exact legacy selection, never acquires or substitutes another same-card Session',async t=>{
 const f=await fixture(t),scope={provider:'@local/dsh-card-studio-scean-test',cardId:f.a.id};
 assert.equal(f.loader.records.size,0);assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,true);assert.equal(f.loader.records.size,0);
 assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',{...scope,cardId:f.b.id})).available,false);assert.equal((await resolveSceanSourceSession(f.loader,'unselected',scope)).available,false);
 assert.deepEqual(await fs.readFile(f.indexFile),f.indexBytes);
 f.loader.archived.add('legacy-A');assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,false);f.loader.archived.delete('legacy-A');
 await f.acquire('legacy-A');await f.ok('legacy-A','open',{document_id:f.b.id});assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,false);assert.equal((await resolveSceanSourceSession(f.loader,'same-card-peer',scope)).available,true);
});

test('missing, recycled, pending and corrupt legacy identities fail closed without a namesake fallback or metadata repair',async t=>{
 const f=await fixture(t);await f.acquire('legacy-A');const service=f.loader.workspace.service,scope={provider:'@local/dsh-card-studio-scean-test',cardId:f.a.id},pointer=join(f.workspace,'.cardstudio-scean/documents',f.a.id,'current.json'),pointerBytes=await fs.readFile(pointer);
 await fs.unlink(pointer);assert.equal(await service.selectedPlaybackDocument('legacy-A'),null);assert.equal(await resolveSceanCardContext(f.loader,'legacy-A'),null);assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,false);assert.deepEqual(await fs.readFile(f.indexFile),f.indexBytes);await fs.writeFile(pointer,pointerBytes);
 const lifecycleFile=join(f.workspace,'.cardstudio-scean/session-lifecycle.json'),lifecycleBytes=await fs.readFile(lifecycleFile),life=JSON.parse(lifecycleBytes),copy=life.copies.find(row=>row.id===f.a.id)??{id:f.a.id,location:'active'};if(!life.copies.includes(copy))life.copies.push(copy);
 copy.location='recycled';await fs.writeFile(lifecycleFile,JSON.stringify(life));assert.equal(await service.selectedPlaybackDocument('legacy-A'),null);assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,false);
 copy.location='active';copy.pending={from:'active',to:'recycled'};await fs.writeFile(lifecycleFile,JSON.stringify(life));assert.equal(await service.selectedPlaybackDocument('legacy-A'),null);assert.equal((await resolveSceanSourceSession(f.loader,'legacy-A',scope)).available,false);await fs.writeFile(lifecycleFile,lifecycleBytes);
 const corrupt=JSON.parse(f.indexBytes);corrupt.selections.push({sessionId:'legacy-A',documentId:f.b.id});corrupt.documents.find(row=>row.id===f.b.id).sessions.push('legacy-A');const corruptBytes=Buffer.from(JSON.stringify(corrupt));await fs.writeFile(f.indexFile,corruptBytes);
 await assert.rejects(service.selectedPlaybackDocument('legacy-A'),{code:'ASSOCIATIONS'});assert.deepEqual(await fs.readFile(f.indexFile),corruptBytes);
});

import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {Context} from '@deepseek-ai/cordis';
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace';
import {DomainFacility} from '@deepseek-ai/dsh-storage-domain';
import {CardService} from '../cardstudio-bundle/lib/card-service.js';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {observeSessionArchives} from '../cardstudio-bundle/lib/archive-observer.js';


const nativeHashes={"dsh-workspace": "a33af459cfc7af29dd17412443a63655fd5037dd348b0dec20a413ce60c6c8bc", "dsh-storage-domain": "e536ba09b7ccc0f10bb54818dfe44454374e5cbf7aeba140b216ba1ca2e87517"};
for(const [name,hash] of Object.entries(nativeHashes))assert.equal(createHash('sha256').update(await fs.readFile(new URL('../cardstudio-test-runtime/node_modules/@deepseek-ai/'+name+'/lib/index.js',import.meta.url))).digest('hex'),hash,'Installed rc.2 lifecycle fixture changed');

const workspace=fileURLToPath(new URL('..',import.meta.url));
const root=await fs.mkdtemp(path.join(workspace,'test-run-archive-'));
after(async()=>{assert.equal(path.dirname(root),path.resolve(workspace));assert(path.basename(root).startsWith('test-run-archive-'));await fs.rm(root,{recursive:true,force:true});});
const source=JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic recycle fixture',description:'Original',personality:'',scenario:'',first_mes:'Hello',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{keep:'opaque'}}});
async function fixture(options={},baseline=[]){const dir=path.join(root,randomUUID());await fs.mkdir(dir);const s=new CardService(dir,options);await s.init();await fs.writeFile(path.join(dir,'imports/synthetic.json'),source);if(baseline!==null)await s.synchronizeArchiveState(baseline);return s;}
async function op(s,sessionId,action,args={}){const r=await s.operation(action,args,undefined,{sessionId});assert(r.ok,JSON.stringify(r));return r.value;}
const imported=(s,sessionId='A')=>op(s,sessionId,'import',{path:'imports/synthetic.json'});
const directory=(s,id,recycled=false)=>path.join(s.root,'.cardstudio-scean',recycled?'recycle/documents':'documents',id);
async function exists(file){try{await fs.stat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function hashes(dir){const result={};for(const row of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,row.name);if(row.isDirectory()){for(const [key,value]of Object.entries(await hashes(file)))result[row.name+'/'+key]=value;}else result[row.name]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}return result;}
async function edited(s,d){await op(s,'A','patch_text',{document_id:d.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Edited'});}

test('future exclusive archive moves the entire history and restores the same ID/selection; exports and imports are untouched',async()=>{
 const s=await fixture(),d=await imported(s);await edited(s,d);await op(s,'A','export',{document_id:d.id,expected_revision:1,name:'synthetic.json'});
 const before=await hashes(directory(s,d.id)),outputs=await hashes(path.join(s.root,'exports')),inputs=await hashes(path.join(s.root,'imports'));
 assert.equal((await s.synchronizeArchiveState(['A'])).moved,1);assert(!await exists(directory(s,d.id)));assert.deepEqual(await hashes(directory(s,d.id,true)),before);
 assert.equal((await s.operation('read',{document_id:d.id},undefined,{sessionId:'A'})).error.code,'SESSION_ARCHIVED');
 assert.equal((await op(s,'B','documents',{scope:'all'})).total,0);
 assert.equal((await s.synchronizeArchiveState([])).moved,1);assert.deepEqual(await hashes(directory(s,d.id)),before);assert(!await exists(directory(s,d.id,true)));
 assert.equal((await op(s,'A','documents')).selectedId,d.id);assert.deepEqual(await hashes(path.join(s.root,'exports')),outputs);assert.deepEqual(await hashes(path.join(s.root,'imports')),inputs);await s.close();
});

test('shared references survive partial archive; all archived recycles once; restoring either owner restores one consistent copy',async()=>{
 const s=await fixture(),d=await imported(s);await op(s,'B','open',{document_id:d.id});const before=await hashes(directory(s,d.id));
 assert.equal((await s.synchronizeArchiveState(['A'])).moved,0);assert(await exists(directory(s,d.id)));assert.equal((await op(s,'B','documents')).items[0].shared,true);
 assert.equal((await s.synchronizeArchiveState(['A','B'])).moved,1);assert.equal((await s.synchronizeArchiveState(['B','A'])).moved,0);
 assert.equal((await s.synchronizeArchiveState(['B'])).moved,1);assert.deepEqual(await hashes(directory(s,d.id)),before);assert.equal((await op(s,'A','documents')).selectedId,d.id);
 assert.deepEqual((await s.associations()).documents[0].sessions,['A','B']);assert.equal((await s.synchronizeArchiveState([])).moved,0);assert.equal((await op(s,'B','documents')).selectedId,d.id);await s.close();
});

test('first baseline does not sweep historical archived copies; legacy and unrelated data remain protected',async()=>{
 const s=await fixture({},null),d=await imported(s),legacy=await s.import('imports/synthetic.json','card');await op(s,'A','open',{document_id:legacy.id});
 const before=await hashes(directory(s,d.id)),legacyBefore=await hashes(directory(s,legacy.id));
 await s.synchronizeArchiveState(['A','HISTORIC-UNRELATED']);assert(await exists(directory(s,d.id)));
 assert.equal((await s.synchronizeArchiveState(['A','HISTORIC-UNRELATED'])).moved,0);
 let state=await s.lifecycle.read();assert.equal(state.sessions.find(r=>r.id==='A').armed,false);assert(!JSON.stringify(state).includes('HISTORIC-UNRELATED'));
 await s.synchronizeArchiveState(['HISTORIC-UNRELATED']);await s.synchronizeArchiveState(['A','HISTORIC-UNRELATED']);
 assert.deepEqual(await hashes(directory(s,d.id,true)),before);assert.deepEqual(await hashes(directory(s,legacy.id)),legacyBefore);await s.close();
});

test('restart reconciles missed future archive and restore using only registered metadata',async()=>{
 let s=await fixture();const d=await imported(s);await edited(s,d);const before=await hashes(directory(s,d.id)),folder=s.root;await s.close();
 s=new CardService(folder);await s.init();assert.equal((await s.synchronizeArchiveState(['A'])).moved,1);assert.deepEqual(await hashes(directory(s,d.id,true)),before);await s.close();
 s=new CardService(folder);await s.init();assert.equal((await s.synchronizeArchiveState([])).moved,1);assert.deepEqual(await hashes(directory(s,d.id)),before);assert.equal((await op(s,'A','documents')).selectedId,d.id);await s.close();
});

for(const point of ['beforeMove','afterMove','beforeSettle'])test(`interruption at ${point} leaves a recoverable journal; restart completes archive without lost revisions`,async()=>{
 let fired=false,s=await fixture({lifecycleHooks:{[point]:()=>{if(!fired){fired=true;throw new Error('Synthetic interruption');}}}});const d=await imported(s);await edited(s,d);const before=await hashes(directory(s,d.id)),folder=s.root;
 await assert.rejects(s.synchronizeArchiveState(['A']),/Synthetic interruption/);assert((await s.lifecycle.read()).copies[0].pending);
 assert((await exists(directory(s,d.id)))!==(await exists(directory(s,d.id,true))));await s.close();
 s=new CardService(folder);await s.init();await s.synchronizeArchiveState(['A']);assert.deepEqual(await hashes(directory(s,d.id,true)),before);assert(!(await s.lifecycle.read()).copies[0].pending);
 assert.equal((await s.synchronizeArchiveState(['A'])).moved,0);await s.synchronizeArchiveState([]);assert.deepEqual(await hashes(directory(s,d.id)),before);await s.close();
});

test('interrupted restore followed by a later offline archive finishes its intent then converges to current truth',async()=>{
 let restoring=false,s=await fixture({lifecycleHooks:{afterMove:({to})=>{if(restoring&&to==='active')throw new Error('Synthetic restore interruption');}}});const d=await imported(s),before=await hashes(directory(s,d.id)),folder=s.root;
 await s.synchronizeArchiveState(['A']);restoring=true;await assert.rejects(s.synchronizeArchiveState([]),/restore interruption/);assert(await exists(directory(s,d.id)));await s.close();
 s=new CardService(folder);await s.init();await s.synchronizeArchiveState(['A']);assert.deepEqual(await hashes(directory(s,d.id,true)),before);await s.synchronizeArchiveState([]);assert.deepEqual(await hashes(directory(s,d.id)),before);await s.close();
});

test('destination conflicts retain both directories and the intent; retry after explicit conflict isolation succeeds',async()=>{
 const s=await fixture(),d=await imported(s),before=await hashes(directory(s,d.id));const target=directory(s,d.id,true);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'synthetic-user-added.txt'),'Keep me');
 await assert.rejects(s.synchronizeArchiveState(['A']),e=>e.code==='RECYCLE_CONFLICT');assert.deepEqual(await hashes(directory(s,d.id)),before);assert.equal(await fs.readFile(path.join(target,'synthetic-user-added.txt'),'utf8'),'Keep me');
 const quarantine=path.join(s.root,'synthetic-conflict');assert.equal(path.dirname(path.resolve(quarantine)),s.root);await fs.rename(target,quarantine);
 await s.synchronizeArchiveState(['A']);assert.deepEqual(await hashes(directory(s,d.id,true)),before);assert.equal(await fs.readFile(path.join(quarantine,'synthetic-user-added.txt'),'utf8'),'Keep me');await s.close();
});

test('a recycle junction is refused without moving the copy or modifying its destination',async()=>{
 const s=await fixture(),d=await imported(s),foreign=path.join(root,randomUUID());await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'sentinel'),'Keep');
 await fs.symlink(foreign,path.join(s.root,'.cardstudio-scean/recycle'),'junction');const before=await hashes(directory(s,d.id));
 await assert.rejects(s.synchronizeArchiveState(['A']),e=>['PATH','RECYCLE_PATH'].includes(e.code));assert.deepEqual(await hashes(directory(s,d.id)),before);assert.deepEqual(await fs.readdir(foreign),['sentinel']);await s.close();
});

test('invalid or missing journal with recycle data fails closed; no data is silently reclassified',async()=>{
 const s=await fixture(),d=await imported(s);await s.synchronizeArchiveState(['A']);const before=await hashes(directory(s,d.id,true)),file=path.join(s.root,'.cardstudio-scean/session-lifecycle.json'),good=await fs.readFile(file);
 await fs.writeFile(file,'{"schemaVersion":99}');await assert.rejects(s.synchronizeArchiveState([]),e=>e.code==='RECYCLE_JOURNAL');assert.deepEqual(await hashes(directory(s,d.id,true)),before);
 const saved=path.join(s.root,'synthetic-saved-journal');assert.equal(path.dirname(path.resolve(saved)),s.root);await fs.rename(file,saved);
 await assert.rejects(s.synchronizeArchiveState([]),e=>e.code==='RECYCLE_JOURNAL');assert.deepEqual(await hashes(directory(s,d.id,true)),before);await fs.writeFile(file,good);await s.synchronizeArchiveState([]);await s.close();
});

test('failed intent write cannot move data; a repeated snapshot retries even after archive flags were saved',async()=>{
 const s=await fixture(),d=await imported(s),before=await hashes(directory(s,d.id)),write=s.lifecycle.atomicReplace;let fail=true;
 s.lifecycle.atomicReplace=async(file,bytes)=>{if(fail&&JSON.parse(bytes).copies.some(row=>row.pending)){fail=false;throw new Error('Synthetic intent write failure');}return write(file,bytes);};
 await assert.rejects(s.synchronizeArchiveState(['A']),/intent write failure/);assert.deepEqual(await hashes(directory(s,d.id)),before);assert.equal((await s.lifecycle.read()).copies.length,0);
 await s.synchronizeArchiveState(['A']);assert.deepEqual(await hashes(directory(s,d.id,true)),before);await s.close();
});

test('rollback restores all managed data and protects pre-rollback copies from later automatic recycling',async()=>{
 let s=await fixture();const a=await imported(s),b=await imported(s,'B'),before=await hashes(directory(s,a.id)),folder=s.root;await s.synchronizeArchiveState(['A']);
 assert.deepEqual(await s.prepareRecycleRollback(),{restored:1,protected:2});assert.deepEqual(await hashes(directory(s,a.id)),before);assert(await exists(directory(s,b.id)));await s.close();
 s=new CardService(folder);await s.init();await s.synchronizeArchiveState(['A','B']);assert(await exists(directory(s,a.id)));assert(await exists(directory(s,b.id)));
 const c=await imported(s,'C');await s.synchronizeArchiveState(['A','B','C']);assert(await exists(directory(s,c.id,true)));assert(await exists(directory(s,a.id)));assert.deepEqual(await s.prepareRecycleRollback(),{restored:1,protected:3});assert.equal((await s.prepareRecycleRollback()).restored,0);await s.close();
});

test('rollback CLI plan is read-only and apply refuses a non-inactive Host before moving files',async()=>{
 const s=await fixture(),d=await imported(s);await s.synchronizeArchiveState(['A']);
 await fs.writeFile(path.join(s.root,'.cardstudio-scean/workspace.json'),JSON.stringify({schemaVersion:1,capability:'card-studio-scean-test'}));await fs.writeFile(path.join(s.root,'.cardstudio-scean/runtime-status.json'),JSON.stringify({plugin:'@local/dsh-card-studio-scean-test',host:'ready'}));
 const before=await hashes(path.join(s.root,'.cardstudio-scean')),script=fileURLToPath(new URL('../cardstudio-bundle/rollback-recycle.js',import.meta.url));
 const plan=JSON.parse(execFileSync(process.execPath,[script,'--root',s.root,'--plan'],{encoding:'utf8'}));assert.equal(plan.recycled,1);assert.equal(plan.requiresNormalExit,true);
 const apply=spawnSync(process.execPath,[script,'--root',s.root,'--apply'],{encoding:'utf8'});assert.notEqual(apply.status,0);assert.match(apply.stderr,/Exit DSH normally/);assert.deepEqual(await hashes(path.join(s.root,'.cardstudio-scean')),before);assert(await exists(directory(s,d.id,true)));await s.close();
});

test('archive queues behind a running edit; release/dispose are not archive signals and still clean archived leases',async()=>{
 let releaseEdit,entered;const editing=new Promise(r=>{entered=r;}),gate=new Promise(r=>{releaseEdit=r;});
 const s=await fixture({beforeCommit:async()=>{entered();await gate;}});const agent={id:'A',status:'idle',session:{header:{cwd:s.root}},whenIdle:async()=>{}};
 const loader=new WorkspaceLoader({root:s.root,agentLookup:id=>id==='A'?agent:null,activateAddon:async()=>({dispose:async()=>{}}),serviceFactory:()=>s});await loader.init();const claim=await loader.acquire(agent,'synthetic-page-001');
 const d=await imported(s),edit=loader.call(agent,loader.records.get('A'),claim,'patch_text',{document_id:d.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Edited'});await editing;
 const archive=loader.setArchiveState(['A']);assert(await exists(directory(s,d.id)));releaseEdit();await edit;await archive;
 const saved=JSON.parse(await fs.readFile(path.join(directory(s,d.id,true),'1.json'),'utf8'));assert.equal(saved.revision,1);
 const before=await hashes(directory(s,d.id,true));await loader.release(agent,claim);await loader.disposed(agent);assert.deepEqual(await hashes(directory(s,d.id,true)),before);await loader.close();
});

async function nativeFixture(){
 const s=await fixture({},null),ctx=new Context(),events=[],states=[];let observer,facility,failWrite=false,block=false;
 let durable={initialized:true,workspaceIds:[],archivedSessionIds:[],pinnedSessionIds:[]};
 const headers=['A','B'].map(id=>({id,cwd:s.root}));
 await ctx.plugin({name:'synthetic-storage-provider',apply(scope){
  scope.provide('storage',{backend:{get:()=>({kv:{open:async()=>({loadAll:async()=>({global:durable,tables:{workspaces:{}}}),setGlobal:async value=>{if(failWrite)throw new Error('Synthetic durable write failed');durable=structuredClone(value);},close:async()=>{}})}})}});
  facility=new DomainFacility(scope,{backend:'synthetic'});scope.provide('storageDomain',facility);
  scope.provide('sessionPersistence',{list:async()=>headers.map(header=>({header}))});scope.provide('sessions',{get:id=>headers.some(h=>h.id===id)?{header:headers.find(h=>h.id===id)}:undefined,list:()=>headers.map(header=>({header}))});
 }});
 await ctx.plugin(WorkspaceRegistry);const registry=ctx.get('workspaceRegistry');
 ctx.on('workspace/session-activity',()=>Promise.resolve(block?[{kind:'synthetic',items:['busy']}]:[]));
 ctx.on('domain/changed',change=>{if(change.domain==='workspace'&&change.table==='')events.push({payload:[...change.value.archivedSessionIds],cached:[...registry.archivedSessionIds],durable:[...durable.archivedSessionIds]});});
 await ctx.plugin({name:'synthetic-archive-consumer',apply(scope){observer=observeSessionArchives(scope,{setArchiveState:ids=>s.synchronizeArchiveState(ids)},facts=>states.push(facts));}});await observer.sync();
 return {s,ctx,registry,observer,events,states,fail:value=>{failWrite=value;},block:value=>{block=value;},missArchive(ids){durable={...durable,archivedSessionIds:[...ids]};registry.state={...registry.state,archivedSessionIds:[...ids]};},close:async()=>{await ctx.fiber.dispose();await facility.closeAll();await s.close();}};
}

test('actual installed WorkspaceRegistry and DomainFacility emit only after durability; observer uses payload before registry cache update',async()=>{
 const f=await nativeFixture();try{
  const d=await imported(f.s);f.fail(true);await assert.rejects(f.registry.archiveSession('A'),/durable write failed/);await f.observer.sync();assert.equal(f.events.length,0);assert(await exists(directory(f.s,d.id)));
  f.fail(false);f.block(true);await assert.rejects(f.registry.archiveSession('A'),e=>e.name==='WorkspaceActiveSessionError');assert.equal(f.events.length,0);
  f.block(false);await f.registry.archiveSession('A');await f.observer.sync();assert.deepEqual(f.events[0],{payload:['A'],cached:[],durable:['A']});assert(await exists(directory(f.s,d.id,true)));
  await f.registry.archiveSession('A');await f.observer.sync();assert.equal(f.events.length,1);
  await f.registry.unarchiveSession('A');await f.observer.sync();assert(await exists(directory(f.s,d.id)));await f.registry.unarchiveSession('A');await f.observer.sync();assert.equal(f.events.length,2);assert.equal(f.states.at(-1).state,'ready');
 }finally{await f.close();}
});

test('observer ignores close/dispose/workspace deletion, detects missed state changes, and retries failed moves',async()=>{
 const f=await nativeFixture();try{
  const d=await imported(f.s),before=await hashes(directory(f.s,d.id));
  f.ctx.emit('session/disposed',{id:'A'});f.ctx.emit('api-session/removed','A');f.ctx.emit('domain/changed',{domain:'workspace',table:'workspaces',key:'synthetic-project',operation:'deleted'});await f.observer.sync();assert.deepEqual(await hashes(directory(f.s,d.id)),before);
  f.ctx.emit('domain/changed',{domain:'workspace',table:'',key:'',operation:'put',value:{archivedSessionIds:'invalid'}});assert.equal(f.states.at(-1).state,'error');await f.observer.sync();assert.equal(f.states.at(-1).state,'ready');assert.deepEqual(await hashes(directory(f.s,d.id)),before);
  let fail=true;f.s.lifecycle.hooks.beforeMove=()=>{if(fail)throw new Error('Synthetic transient IO');};f.missArchive(['A']);await f.observer.sync();assert.equal(f.states.at(-1).state,'error');assert(await exists(directory(f.s,d.id)));
  fail=false;await f.observer.sync();assert.equal(f.states.at(-1).state,'ready');assert.deepEqual(await hashes(directory(f.s,d.id,true)),before);
  f.missArchive([]);await f.observer.sync();assert.deepEqual(await hashes(directory(f.s,d.id)),before);
 }finally{await f.close();}
});

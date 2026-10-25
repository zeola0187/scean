import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {MaterialCardService} from '../cardstudio-bundle/lib/material-service.js';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {cardstudioRemote} from '../cardstudio-bundle/lib/bridge-protocol.js';
import {buildSavedSnapshot} from '../cardstudio-bundle/lib/scean-integration.js';
import {seedRecycleMaterials} from './helpers/material-recycle-fixture.js';
import {SceanHost} from '../../../plugin/host.mjs';
import {SceanEngine} from '../../../core/engine.mjs';
import {DurableStore} from '../../../adapters/store.mjs';
import {Memory} from '../../../core/memory.mjs';

const sessionId='synthetic-recycle-session',policy={mode:'content',epoch:0,assertCurrent(){}};
export const pin=row=>({material_id:row.material_id,record_sha256:row.record_sha256});
const request=(row,mode='recycle',extra={})=>({mode,...pin(row),expected_recycle_revision:row.recycle_revision,operation_id:randomUUID(),...extra});
const ok=async promise=>{const r=await promise;assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
async function tree(root){const out={};for(const row of await fs.readdir(root,{withFileTypes:true})){if(row.isDirectory()){for(const [k,v] of Object.entries(await tree(path.join(root,row.name))))out[row.name+'/'+k]=v;}else out[row.name]=(await fs.readFile(path.join(root,row.name))).toString('base64');}return out;}
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'material-recycle-')),s=new MaterialCardService(root);await s.init();const invoke=(action,args)=>s.withAuthoringScope(policy,()=>s.operation(action,args,undefined,{sessionId})),human=(r,signal,p=policy,session=sessionId)=>s.withAuthoringScope(p,()=>s.humanMaterials(r,signal,{sessionId:session}));try{const rows=await seedRecycleMaterials(root,invoke,human);await fn({root,s,invoke,human,rows});}finally{await s.close();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('material-recycle-'));await fs.rm(root,{recursive:true,force:true});}}

test('legacy materials start active; recycle excludes catalog/search but retains immutable files, receipts, sources and exact read/trace; restart and restore preserve ID/hash',()=>fixture(async({root,s,invoke,human,rows})=>{
 const row=rows[0];assert.equal(row.recycle_revision,0);assert.equal(row.recycled,false);assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/material-recycle')),[]);
 const before=await tree(path.join(root,'materials')),moved=await human(request(row));assert.equal(moved.recycled,true);
 assert.equal((await ok(invoke('material',{action:'catalog'}))).total,1);assert(!(await ok(invoke('material',{action:'search',query:'keeper'}))).items.some(r=>r.material_id===row.material_id));
 assert.match((await ok(invoke('material',{action:'read',...pin(row)}))).text,/sister/);assert.equal((await ok(invoke('material',{action:'trace',...pin(row)}))).sources[0].snapshot_verified,true);
 assert.deepEqual(await tree(path.join(root,'materials')),before);
 const restarted=new MaterialCardService(root);await restarted.init();try{const bin=await ok(restarted.operation('material',{action:'recycle_bin'},undefined,{sessionId}));assert.equal(bin.total,1);assert.deepEqual(pin(bin.items[0]),pin(row));const restored=await restarted.withAuthoringScope(policy,()=>restarted.humanMaterials(request(bin.items[0],'restore'),undefined,{sessionId}));assert.equal(restored.recycle_revision,2);assert.equal((await ok(restarted.operation('material',{action:'catalog'},undefined,{sessionId}))).total,2);assert.deepEqual(await tree(path.join(root,'materials')),before);}finally{await restarted.close();}
}));

test('already referenced material can be recycled; pinned selection reports it, new select/create reject, saved revisions/rollback/Run snapshot stay unchanged',()=>fixture(async({s,invoke,human,rows})=>{
 const row=rows[0];await ok(invoke('material',{action:'select',materials:[pin(row)]}));
 const created=await ok(invoke('create',{name:'Synthetic saved card',description:'Synthetic keeper.',material_selection:[pin(row)],adaptation_note:'Preserve sister relationship.'}));
 const saved=await ok(invoke('read',{document_id:created.id})),original=(await s.load(created.id,0)).record,run=buildSavedSnapshot(saved,{characters:[{id:'keeper',name:'Keeper',description:'Synthetic keeper.'}]}),frozen=structuredClone(run);
 await ok(invoke('patch',{document_id:created.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Synthetic revision 1.'}]}));
 await human(request(row));assert.deepEqual((await ok(invoke('material',{action:'selection'}))).recycled_materials,[row.material_id]);
 assert.equal((await invoke('material',{action:'select',materials:[pin(row)]})).error.code,'MATERIAL_RECYCLED');
 assert.equal((await invoke('create',{name:'Rejected card',material_selection:[pin(row)],adaptation_note:'Must restore first.'})).error.code,'SESSION_CARD_BOUND');
 const unboundCreate=args=>s.withAuthoringScope(policy,()=>s.operation('create',args,undefined,{sessionId:'synthetic-restored-material-card'}));
 assert.equal((await unboundCreate({name:'Rejected recycled material',material_selection:[pin(row)],adaptation_note:'Must restore first.'})).error.code,'MATERIAL_RECYCLED');
 assert.deepEqual((await s.load(created.id,0)).record,original);assert.deepEqual(run,frozen);
 await s.withAuthoringScope({...policy,mode:'full'},()=>ok(s.operation('rollback',{document_id:created.id,expected_revision:1,to:0},undefined,{sessionId})));
 const rolled=await ok(invoke('read',{document_id:created.id}));assert.deepEqual(rolled.material_composition,saved.material_composition);assert.equal(rolled.card.data.description,saved.card.data.description);
 const bin=(await ok(invoke('material',{action:'recycle_bin'}))).items[0];await human(request(bin,'restore'));await ok(unboundCreate({name:'Restored card',material_selection:[pin(row)],adaptation_note:'Restored original material.'}));
}));

test('same request retry is idempotent even after restart; conflicting operation or old revision cannot replay over a restore',()=>fixture(async({root,invoke,human,rows})=>{
 const r=request(rows[0]),[a,b]=await Promise.all([human(r),human(r)]);
 // Concurrent callers have no guaranteed completion/lock-acquisition order.
 // Exactly one transition and one replay must occur, both at revision one.
 assert.equal(a.recycle_revision,1);assert.equal(b.recycle_revision,1);
 assert.equal([a,b].filter(result=>result.idempotent===true).length,1);
 assert.equal([a,b].filter(result=>result.idempotent!==true).length,1);
 const restarted=new MaterialCardService(root);await restarted.init();try{assert.equal((await restarted.withAuthoringScope(policy,()=>restarted.humanMaterials(r,undefined,{sessionId}))).idempotent,true);}finally{await restarted.close();}
 await assert.rejects(human({...r,mode:'restore'}),{code:'MATERIAL_RECYCLE_CHANGED'});
 const bin=(await ok(invoke('material',{action:'recycle_bin'}))).items[0],restore=request(bin,'restore');
 const raced=await Promise.allSettled([human(restore),human(request(bin,'restore'))]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.find(r=>r.status==='rejected').reason.code,'MATERIAL_RECYCLE_CHANGED');
 await assert.rejects(human(r),{code:'MATERIAL_RECYCLE_CHANGED'});assert.equal((await ok(invoke('material',{action:'catalog'}))).total,2);
}));

test('opposing recycle and restore requests cannot overwrite a newer observed state',()=>fixture(async({invoke,human,rows})=>{
 const removed=await human(request(rows[0])),restore=request(removed,'restore');await human(restore);
 const active=(await ok(invoke('material',{action:'catalog'}))).items.find(r=>r.material_id===rows[0].material_id);
 const results=await Promise.allSettled([human(request(active)),human({...restore,operation_id:randomUUID()})]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'MATERIAL_RECYCLE_CHANGED');
 const bin=(await ok(invoke('material',{action:'recycle_bin'}))).items[0];assert.equal(bin.recycle_revision,3);assert.equal(bin.recycled,true);
}));

test('invalid ID/hash/revision/path, missing material and generic Agent mutations fail without state changes or private path leaks',()=>fixture(async({root,invoke,human,rows})=>{
 const base=request(rows[0]);for(const patch of [{material_id:'../outside'},{material_id:'a'.repeat(36)},{record_sha256:'bad'},{expected_recycle_revision:-1},{expected_recycle_revision:0.5},{operation_id:'../escape'}])await assert.rejects(human({...base,...patch}),{code:'MATERIAL_ID'});
 await assert.rejects(human({...base,path:'../private.json'}),{code:'MATERIAL_ARGUMENT'});await assert.rejects(human({...base,material_id:randomUUID()}),{code:'MATERIAL_NOT_FOUND'});
 await assert.rejects(human({...base,record_sha256:'f'.repeat(64)}),{code:'MATERIAL_CHANGED'});
 for(const action of ['recycle','restore'])assert.equal((await invoke('material',{action,...pin(rows[0])})).error.code,'MATERIAL_ACTION');
 assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/material-recycle')),[]);
 const parser=cardstudioRemote.descriptors.find(d=>d.method==='reviewMaterials').parameters[1].codec.create();assert.throws(()=>parser.parse({...base,path:'../private',claim:{},expected_epoch:0}),TypeError);
 const original=safePermissionError();function safePermissionError(){return Object.assign(new Error('EACCES private C:/fixture/secret'),{code:'EACCES'});}const {MaterialStore}=await import('../cardstudio-bundle/lib/material-store.js');const save=MaterialStore.prototype.save;MaterialStore.prototype.save=async function(rel,...args){if(rel.includes('/material-recycle/'))throw original;return save.call(this,rel,...args);};try{await assert.rejects(human(base),error=>error.code==='MATERIAL_RECYCLE_IO'&&!error.message.includes('secret'));}finally{MaterialStore.prototype.save=save;}
}));

test('scope revocation and cancellation immediately before atomic rename publish no state; corrupt state and redirected directory fail closed',()=>fixture(async({root,s,invoke,human,rows})=>{
 const base=request(rows[0]),save=s.materials.save.bind(s.materials);let revoked=false,fences=0;
 s.materials.save=async(rel,value,signal,fence)=>save(rel,value,signal,async()=>{if(rel.includes('/material-recycle/')&&++fences===2)revoked=true;await fence();});
 await assert.rejects(human(base,undefined,{...policy,assertCurrent(){if(revoked)throw Object.assign(new Error('Scope changed'),{code:'AUTHORING_SCOPE_CHANGED'});}}),{code:'AUTHORING_SCOPE_CHANGED'});
 s.materials.save=save;assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/material-recycle')),[]);
 const controller=new AbortController();controller.abort();await assert.rejects(human(base,controller.signal),{name:'AbortError'});
 await human(base);const stateFile=path.join(root,'.cardstudio-scean/material-recycle',rows[0].material_id+'.json');await fs.writeFile(stateFile,'{}');
 assert.equal((await invoke('material',{action:'catalog'})).error.code,'MATERIAL_RECYCLE_STATE');await assert.rejects(human(request({...rows[0],recycle_revision:1},'restore')),{code:'MATERIAL_RECYCLE_STATE'});
 await fs.rename(path.join(root,'.cardstudio-scean/material-recycle'),path.join(root,'.cardstudio-scean/material-recycle-original'));await fs.mkdir(path.join(root,'.cardstudio-scean/material-recycle'));
 await assert.rejects(human(base),{code:'MATERIAL_PATH'});assert.equal((await s.materials.item(rows[0].material_id,rows[0].record_sha256)).material_id,rows[0].material_id);
}));

test('current human claim is required; stolen/cross-workspace/stale scope and archived Session fail, while another authorized Session shares the workspace bin',()=>fixture(async({root,s,rows})=>{
 const agents=new Map(),loader=new WorkspaceLoader({root,agentLookup:id=>agents.get(id),serviceFactory:()=>s,activateAddon:async()=>({dispose(){}})});await loader.init();
 const agent=id=>{const a={id,session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel(){}};agents.set(id,a);return a;};
 const a=agent('recycle-A'),b=agent('recycle-B'),claimA=await loader.acquire(a,'recycle-page-A-0001'),claimB=await loader.acquire(b,'recycle-page-B-0001');
 try{
  const base={...request(rows[0]),claim:claimA,expected_epoch:0};
  await assert.rejects(loader.reviewMaterials(a,{...base,claim:undefined}));await assert.rejects(loader.reviewMaterials(b,base));
  const prior=a.session.header.cwd;a.session.header.cwd=path.dirname(root);await assert.rejects(loader.reviewMaterials(a,base));a.session.header.cwd=prior;
  await assert.rejects(loader.reviewMaterials(a,{...base,expected_epoch:99}),{code:'AUTHORING_SCOPE_CHANGED'});
  const moved=await loader.reviewMaterials(a,base);assert.equal(moved.ok,true,JSON.stringify(moved));
  const restored=await loader.reviewMaterials(b,{...request(moved.value,'restore'),claim:claimB,expected_epoch:0});assert.equal(restored.ok,true,JSON.stringify(restored));
  await loader.setArchiveState([a.id]);await assert.rejects(loader.reviewMaterials(a,{...base,operation_id:randomUUID()}));
 }finally{await loader.close();}
}));

test('real durable SCEAN Run and Inspector retain fixed saved content when the referenced material is recycled and restored',()=>fixture(async({root,invoke,human,rows})=>{
 let modelCalls=0;const rp=await new SceanHost({engine:new SceanEngine({store:new DurableStore({root:path.join(root,'synthetic-runs')}),model:{generate(){modelCalls++;throw Error('No model allowed');}},memory:new Memory()}),root:path.join(root,'synthetic-rp-host')}).init();
 try{
  const created=await ok(invoke('create',{name:'Synthetic Run card',description:'Keeper remembers her sister.',first_mes:'A synthetic keeper lights a lamp.',material_selection:[pin(rows[0])],adaptation_note:'Keep the original relationship.'}));
  const saved=await ok(invoke('read',{document_id:created.id})),snapshot=buildSavedSnapshot(saved,{characters:[{id:'keeper',name:'Keeper',description:'Synthetic keeper.'}]}),started=await rp.createRun({snapshot});
  const before=await rp.inspect(started.runId),bytes=await tree(path.join(root,'synthetic-runs'));
  await human(request(rows[0]));assert.deepEqual(await rp.inspect(started.runId),before);assert.deepEqual(await tree(path.join(root,'synthetic-runs')),bytes);
  const bin=(await ok(invoke('material',{action:'recycle_bin'}))).items[0];await human(request(bin,'restore'));assert.deepEqual(await rp.inspect(started.runId),before);assert.equal(modelCalls,0);
 }finally{await rp.close();}
}));

// Offline synthetic fixtures only: no real Session, card, installation or model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MaterialCardService} from '../cardstudio-bundle/lib/material-service.js';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';

async function fixture(t){
 const base=path.resolve(import.meta.dirname,'../../../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'fixed-binding-'));
 const services=[];async function service(){const s=new MaterialCardService(root);await s.init();services.push(s);return s;}const s=await service();
 t.after(async()=>{for(const value of services)await value.close();assert.equal(path.dirname(root),base);assert(path.basename(root).startsWith('fixed-binding-'));await fs.rm(root,{recursive:true,force:true});});
 const call=(sessionId,action,args={})=>s.operation(action,args,undefined,{sessionId});
 const ok=async(sessionId,action,args={})=>{const result=await call(sessionId,action,args);assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
 const create=(id,name='Same name')=>ok(id,'create',{name,description:'Synthetic original',first_mes:'Synthetic opening.'});
 return {root,s,service,call,ok,create,index:path.join(root,'.cardstudio-scean/working-copy-sessions.json')};
}
const denied=(result,code)=>{assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,code,JSON.stringify(result));};

test('UX02 legacy selection stays unbound without migration; bounded chooser then explicit open fixes one UUID',async t=>{
 const f=await fixture(t),a=await f.create('seed-A'),b=await f.create('seed-B');
 const index=JSON.parse(await fs.readFile(f.index,'utf8'));index.documents.find(x=>x.id===a.id).sessions.push('legacy');index.selections.push({sessionId:'legacy',documentId:a.id});await fs.writeFile(f.index,JSON.stringify(index));const before=await fs.readFile(f.index,'utf8');
 const reopened=await f.service();assert.equal(await reopened.selectedDocument('legacy'),null);
 assert.deepEqual(await reopened.bindingStatus('legacy'),{status:'unbound',document_id:null,legacy_document_id:a.id});
 const list=await reopened.operation('documents',{scope:'all'},undefined,{sessionId:'legacy'});assert.equal(list.ok,true);assert.equal(list.value.selectedId,null);assert.equal(list.value.items.length,2);assert(list.value.items.every(row=>row.name==='Same name'&&!Object.hasOwn(row,'card')));
 denied(await f.call('legacy','read',{document_id:a.id}),'SESSION_CARD_REQUIRED');assert.equal(await fs.readFile(f.index,'utf8'),before);
 await f.ok('legacy','open',{document_id:b.id});assert.equal((await reopened.selectedDocument('legacy')).document_id,b.id);
 denied(await f.call('legacy','open',{document_id:a.id}),'SESSION_CARD_BOUND');denied(await f.call('legacy','read',{document_id:a.id}),'SESSION_CARD_MISMATCH');
 assert.deepEqual((await f.ok('legacy','documents',{scope:'all'})).items.map(x=>x.id),[b.id]);
});

test('UX02 every general document read/write/preview/check/export target rejects another same-name card before processing',async t=>{
 const f=await fixture(t),a=await f.create('A'),b=await f.create('B'),beforeA=await f.s.read(a.id),beforeB=await f.s.read(b.id);
 const actions=['read','history','diff','patch','patch_text','rollback','book_list','book_read','book_search','book_config','book_upsert','book_patch','book_delete','book_reorder','scean_character','check','repair','frontend','fixture','visual_contract','asset','preview','target','target_source','gating','export','export_backup','export_bundle','export_target','asset_upload_begin'];
 for(const action of actions)denied(await f.call('A',action,{document_id:b.id,expected_revision:0,sessionId:'B'}),'SESSION_CARD_MISMATCH');
 denied(await f.call('A','open',{document_id:b.id}),'SESSION_CARD_BOUND');
 assert.deepEqual(await f.s.read(a.id),beforeA);assert.deepEqual(await f.s.read(b.id),beforeB);
 assert.deepEqual((await f.ok('A','documents',{scope:'all'})).items.map(x=>x.id),[a.id]);
 assert.deepEqual((await f.ok('B','documents')).items.map(x=>x.id),[b.id]);
});

test('UX02 bound conversation cannot allocate another create/import/upload/copy; immutable binding is not replaced',async t=>{
 const f=await fixture(t),a=await f.create('A'),before=await fs.readdir(path.join(f.root,'.cardstudio-scean/documents'));
 for(const action of ['create','import','upload_begin','upload_finish'])denied(await f.call('A',action,{}),'SESSION_CARD_BOUND');
 // library_copy has a separate override; a valid read-only Library remains available.
 await fs.mkdir(path.join(f.root,'library'),{recursive:true});await fs.writeFile(path.join(f.root,'library','source.json'),JSON.stringify((await f.s.read(a.id)).card));
 await f.ok('A','library',{action:'refresh'});const library=await f.ok('A','library',{action:'list'});assert.equal(library.items.length,1);
 const source=library.items[0];assert.equal((await f.call('A','library',{action:'read',item_id:source.item_id,source_sha256:source.source_sha256,fields:['description']})).ok,true);
 denied(await f.call('A','library_copy',{item_id:'unused',source_sha256:'0'.repeat(64)}),'SESSION_CARD_BOUND');
 assert.deepEqual(await fs.readdir(path.join(f.root,'.cardstudio-scean/documents')),before);assert.equal((await f.s.bindingStatus('A')).document_id,a.id);
});

test('UX02 material document sources and captured asset uploads cannot bypass binding; Library material reads keep their own permission',async t=>{
 const f=await fixture(t),a=await f.create('A'),b=await f.create('B');
 // Simulate an old association retained from before permanent binding.
 const index=JSON.parse(await fs.readFile(f.index,'utf8'));index.documents.find(x=>x.id===b.id).sessions.push('A');await fs.writeFile(f.index,JSON.stringify(index));
 denied(await f.call('A','material',{action:'begin',intent:'Synthetic extraction',sources:[{type:'document',document_id:b.id,revision:0,source_sha256:b.sha256}]}),'SESSION_CARD_MISMATCH');
 const batch=await f.ok('A','material',{action:'begin',intent:'Synthetic own-card extraction',sources:[{type:'document',document_id:a.id,revision:0,source_sha256:a.sha256}]});assert(batch.extraction_id);
 // A pre-binding candidate could have been created for another associated
 // working card. Preserve its valid evidence hash, but require today's binding.
 const prior=await f.ok('B','material',{action:'begin',intent:'Synthetic legacy extraction',sources:[{type:'document',document_id:b.id,revision:0,source_sha256:b.sha256}]}),filename=path.join(f.root,'.cardstudio-scean/material-candidates',prior.extraction_id+'.json'),legacy=JSON.parse(await fs.readFile(filename,'utf8'));legacy.session_id='A';await fs.writeFile(filename,JSON.stringify(legacy));
 for(const action of ['candidate','source_read'])denied(await f.call('A','material',{action,extraction_id:prior.extraction_id,...action==='source_read'?{source_index:0}:{}}),'SESSION_CARD_MISMATCH');
 const upload=f.s.assetUploads.begin('A',{name:'synthetic.png',size:1,document_id:b.id,expected_revision:0});f.s.assetUploads.append('A',{upload_id:upload.upload_id,offset:0,base64:'AA=='});
 denied(await f.call('A','asset_upload_finish',{upload_id:upload.upload_id}),'SESSION_CARD_MISMATCH');
 const materials=await f.ok('A','material',{action:'catalog'});assert(Array.isArray(materials.items));
});

test('UX02 concurrent first opens across service instances choose exactly one persistent binding; same-card Sessions remain allowed',async t=>{
 const f=await fixture(t),a=await f.create('seed-A'),b=await f.create('seed-B'),other=await f.service();
 const results=await Promise.all([f.s.operation('open',{document_id:a.id},undefined,{sessionId:'race'}),other.operation('open',{document_id:b.id},undefined,{sessionId:'race'})]);
 assert.equal(results.filter(x=>x.ok).length,1);denied(results.find(x=>!x.ok),'SESSION_CARD_BOUND');const id=results.find(x=>x.ok).value.id;
 assert.equal((await f.s.bindingStatus('race')).document_id,id);assert.equal((await other.bindingStatus('race')).document_id,id);
 await f.ok('shared','open',{document_id:id});await f.ok('race','open',{document_id:id});assert.equal((await f.s.bindingStatus('shared')).document_id,id);
 const state=JSON.parse(await fs.readFile(f.index,'utf8'));assert.equal(state.bindings.filter(x=>x.sessionId==='race').length,1);
});

test('UX02 concurrent first creates allocate one card and reject the losing request before allocation',async t=>{
 const f=await fixture(t),other=await f.service(),results=await Promise.all([f.call('race','create',{name:'First'}),other.operation('create',{name:'Second'},undefined,{sessionId:'race'})]);
 assert.equal(results.filter(x=>x.ok).length,1);denied(results.find(x=>!x.ok),'SESSION_CARD_BOUND');assert.equal((await fs.readdir(path.join(f.root,'.cardstudio-scean/documents'))).length,1);
});

test('UX02 lost acknowledgement after binding publication is discoverable and retries cannot create a replacement',async t=>{
 const f=await fixture(t),original=f.s.lifecycle.usedSession.bind(f.s.lifecycle);let lose=true;f.s.lifecycle.usedSession=async(...args)=>{if(lose){lose=false;throw Object.assign(Error('Synthetic receipt loss'),{code:'SYNTHETIC_RECEIPT_LOSS'});}return original(...args);};
 denied(await f.call('A','create',{name:'Fixed despite lost reply'}),'SYNTHETIC_RECEIPT_LOSS');const status=await (await f.service()).bindingStatus('A');assert.equal(status.status,'bound');
 denied(await f.call('A','create',{name:'Wrong retry'}),'SESSION_CARD_BOUND');const reopened=await f.ok('A','open',{document_id:status.document_id});assert.equal(reopened.id,status.document_id);assert.equal((await fs.readdir(path.join(f.root,'.cardstudio-scean/documents'))).length,1);
});

test('UX02 failure before binding publication leaves an unbound saved copy recoverable only by explicit open',async t=>{
 const f=await fixture(t),associate=f.s.associate.bind(f.s);let stop=true;f.s.associate=async(...args)=>{if(stop){stop=false;throw Object.assign(Error('Synthetic interruption before binding publication'),{code:'SYNTHETIC_BINDING_WRITE'});}return associate(...args);};
 denied(await f.call('A','create',{name:'Recoverable unbound copy'}),'SYNTHETIC_BINDING_WRITE');assert.equal((await f.s.bindingStatus('A')).status,'unbound');
 const list=await f.ok('A','documents',{scope:'all'});assert.equal(list.items.length,1);assert.equal(list.selectedId,null);const id=list.items[0].id;
 denied(await f.call('A','read',{document_id:id}),'SESSION_CARD_REQUIRED');await f.ok('A','open',{document_id:id});assert.equal((await f.s.bindingStatus('A')).document_id,id);assert.equal((await fs.readdir(path.join(f.root,'.cardstudio-scean/documents'))).length,1);
});

test('UX02 corrupt fixed-binding metadata fails closed without replacing the index',async t=>{
 const f=await fixture(t),a=await f.create('A'),index=JSON.parse(await fs.readFile(f.index,'utf8'));index.bindings.push({sessionId:'A',documentId:a.id});const corrupt=JSON.stringify(index);await fs.writeFile(f.index,corrupt);
 denied(await f.call('A','documents',{scope:'all'}),'ASSOCIATIONS');denied(await f.call('A','open',{document_id:a.id}),'ASSOCIATIONS');assert.equal(await fs.readFile(f.index,'utf8'),corrupt);
});

test('UX02 missing fixed source keeps its binding and cannot be silently replaced',async t=>{
 const f=await fixture(t),a=await f.create('A'),b=await f.create('B');
 await fs.unlink(path.join(f.root,'.cardstudio-scean/documents',a.id,'current.json'));
 assert.equal(await f.s.selectedDocument('A'),null);assert.equal((await f.s.bindingStatus('A')).document_id,a.id);
 denied(await f.call('A','open',{document_id:b.id}),'SESSION_CARD_BOUND');denied(await f.call('A','create',{name:'Replacement'}),'SESSION_CARD_BOUND');
});

test('UX02 standalone worldbook keeps an independent fixed Session and does not replace a bound card',async t=>{
 const f=await fixture(t),a=await f.create('A');await fs.writeFile(path.join(f.root,'imports','book.json'),JSON.stringify({name:'Synthetic book',entries:[]}));
 const book=await f.ok('book-session','import',{path:'imports/book.json',type:'worldbook'});assert.equal((await f.s.selectedDocument('book-session')).type,'worldbook');
 assert.equal((await f.ok('book-session','book_list',{document_id:book.id})).entries.length,0);
 denied(await f.call('A','open',{document_id:book.id}),'SESSION_CARD_BOUND');denied(await f.call('book-session','read',{document_id:a.id}),'SESSION_CARD_MISMATCH');
});

test('UX02 loader restart restores binding; trusted Session identity and stale card revisions remain enforced',async t=>{
 const f=await fixture(t),agents=new Map(['A','B','shared'].map(id=>[id,{id,status:'idle',session:{header:{cwd:f.root}},whenIdle:async()=>{},cancel(){}}])),loaders=[];
 async function loader(){const l=new WorkspaceLoader({root:f.root,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose(){}})});await l.init();await l.setArchiveState([]);loaders.push(l);return l;}
 t.after(async()=>{for(const l of loaders)await l.close();});let l=await loader();const claims={};for(const id of agents.keys())claims[id]=await l.acquire(agents.get(id),'synthetic-page-'+id);
 const call=(id,action,args)=>l.call(agents.get(id),l.records.get(id),claims[id],action,args),a=(await call('A','create',{name:'Same name',description:'Original'})).value,b=(await call('B','create',{name:'Same name'})).value;
 denied(await call('A','read',{document_id:b.id,sessionId:'B'}),'SESSION_CARD_MISMATCH');assert.equal((await call('shared','open',{document_id:a.id})).ok,true);
 assert.equal((await call('shared','patch_text',{document_id:a.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Edited'})).ok,true);
 denied(await call('A','patch_text',{document_id:a.id,expected_revision:0,field:'description',old_text:'Original',new_text:'Stale'}),'REVISION_CONFLICT');
 await l.close();l=await loader();claims.A=await l.acquire(agents.get('A'),'synthetic-page-A-restarted');assert.equal(claims.A.selection_status.document_id,a.id);assert.deepEqual(claims.A.selection_status.binding_status,{status:'bound',document_id:a.id,legacy_document_id:null});
 denied(await call('A','open',{document_id:b.id}),'SESSION_CARD_BOUND');assert.equal((await call('A','read',{document_id:a.id})).value.revision,1);
 // Deferred authoring callbacks retain trusted Session identity even outside operation().
 const policy=l.scopePolicy(agents.get('A'),l.records.get('A'),claims.A,'asset',{document_id:a.id,expected_revision:1});
 await assert.rejects(l.workspace.service.withAuthoringScope(policy,()=>l.workspace.service.read(b.id)),{code:'SESSION_CARD_MISMATCH'});
});

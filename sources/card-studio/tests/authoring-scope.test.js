import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WorkspaceLoader } from '../cardstudio-bundle/lib/loader.js';
import { sha,canonical } from '../cardstudio-bundle/lib/codec.js';
import { assertScopeOperation,assertNarrativeText } from '../cardstudio-bundle/lib/authoring-scope.js';
import { cardstudioRemote } from '../cardstudio-bundle/lib/bridge-protocol.js';
import { toolSpecs } from '../cardstudio-bundle/lib/tool-definitions.js';

const repo=fileURLToPath(new URL('..',import.meta.url));
const config={profile:'tauritavern-helper-ejs-v1',namespace:'synthetic_scope_state',fields:{score:{type:'number',min:0,max:10},open:{type:'boolean'},phase:{type:'string',enum:['low','high']}},initialState:{values:{score:0,open:false,phase:'low'}},source:'<section><p>{{sample::score}}</p></section>'};
async function setup(t,{beforeCommit,empty=false}={}){
  const root=path.join(repo,'test-scope-'+randomUUID());await fs.mkdir(root);
  const agent={id:'scope-session-'+randomUUID(),session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel(){throw Error('An idle synthetic agent must not be cancelled.');}};
  const loader=new WorkspaceLoader({root,agentLookup:id=>id===agent.id?agent:null,activateAddon:async()=>({dispose:async()=>{}})});
  await loader.init();await loader.setArchiveState([]);let claim=await loader.acquire(agent,'scope-page-one-0001');
  const service=loader.workspace.service;service.beforeCommit=beforeCommit;
  const raw=(action,args={})=>loader.call(agent,loader.records.get(agent.id),claim,action,args);
  const op=async(action,args)=>{const result=await raw(action,args);assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  let id=null,entry=null;
  if(!empty){const created=await op('create',{name:'Synthetic scope',description:'A quiet puzzle guide.',first_mes:'Welcome {{user}}.'});id=created.id;}
  const mutate=async(action,args={})=>op(action,{document_id:id,expected_revision:(await service.load(id)).record.revision,...args});
  if(!empty){
  await mutate('book_upsert',{entry:{id:1,keys:['puzzle'],content:'Ordinary lore {{user}}',enabled:true,insertion_order:100,extensions:{opaque:{kept:7}}}});
  await mutate('visual_contract',{action:'create',contract:{characters:{guide:{}}}});await mutate('target',{action:'configure',config});
  entry='id:1';const read=await op('gating',{action:'read',document_id:id,entry_id:entry});
  await mutate('gating',{action:'create',entry_id:entry,expected_source_hash:read.source_hash,rule:{schemaVersion:1,predicate:{op:'gte',path:'values.score',value:5}}});
  await mutate('book_upsert',{entry:{id:3,keys:['plain'],content:'Plain worldbook body',enabled:true,insertion_order:100,extensions:{opaque:{keep:true}}}});
  }
  t.after(async()=>{await loader.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(repo));await fs.rm(root,{recursive:true,force:true});});
  const scope=async(mode,expected_epoch=loader.records.get(agent.id).scope.epoch,pageClaim=claim)=>loader.setAuthoringScope(agent,{mode,expected_epoch,claim:pageClaim});
  return {root,agent,loader,service,id,entry,raw,op,mutate,scope,getClaim:()=>claim,setClaim:value=>{claim=value;}};
}
const stateDigest=state=>sha(canonical({bytes:state.record.bytes,authoring:state.record.authoring,revision:state.record.revision}));

test('missing optional revision yields a lossless JSON error and preserves the working copy',async t=>{
  const s=await setup(t),before=stateDigest(await s.service.state(s.id));
  const result=await s.raw('visual_contract',{action:'create',document_id:s.id,contract:{characters:{guide:{}}}});
  assert.equal(result.ok,false);assert.equal(result.error.code,'REVISION_CONFLICT');assert.match(result.error.message,/expected_revision/);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);assert.deepEqual(result.error.details,{actual:(await s.service.load(s.id)).record.revision});
  assert.equal(stateDigest(await s.service.state(s.id)),before);
});

test('content mode admits narrative changes and reads complete runtime while preserving protected projections',async t=>{
  const s=await setup(t);await s.scope('content');const before=await s.service.state(s.id);
  await s.mutate('patch_text',{field:'description',old_text:'quiet',new_text:'helpful'});
  await s.mutate('patch',{patches:[{op:'replace',path:'/data/first_mes',value:'Welcome to the puzzle. {{user}}'}]});
  await s.mutate('book_patch',{entry_id:'id:3',changes:{content:'A second plain worldbook paragraph.'}});
  const after=await s.service.state(s.id);assert.deepEqual(after.authoring,before.authoring);assert.deepEqual(after.decoded.card.data.extensions,before.decoded.card.data.extensions);
  assert.deepEqual(after.decoded.card.data.character_book.entries.find(e=>e.id===1),before.decoded.card.data.character_book.entries.find(e=>e.id===1));
  assert.equal((await s.op('target_source',{action:'list',document_id:s.id,kind:'script'})).authoring_scope.mode,'content');
  const checked=await s.op('check',{document_id:s.id});assert.equal(checked.counts.FAIL,0);
  const dryrun=await s.op('target',{action:'dryrun',document_id:s.id,cases:[{payload:{values:{score:5}},expect:'accepted'}]});assert.equal(dryrun.results[0].expectationMatched,true);
});

test('all runtime mutation families refuse content-mode admission and leave snapshots/assets unchanged',async t=>{
  const s=await setup(t);await s.scope('content');const before=stateDigest(await s.service.state(s.id));
  const cases=[['target',{action:'rebuild'}],['target_source',{action:'patch',kind:'script'}],['gating',{action:'patch',entry_id:s.entry}],['gating',{action:'edit_body',entry_id:s.entry,old_text:'lore',new_text:'story'}],['frontend',{action:'create',target:'first_mes',source:'<p>front</p>'}],['fixture',{action:'patch'}],['visual_contract',{action:'patch'}],['asset',{action:'link'}],['asset',{action:'unlink'}],['asset',{action:'import'}],['asset',{action:'arm_generated'}],['asset_upload_begin',{name:'x.png',size:32}],['asset_upload_chunk',{}],['asset_upload_finish',{}],['repair',{}],['book_delete',{entry_id:'id:3'}],['book_patch_config',{changes:{scan_depth:99}}],['book_upsert',{entry:{content:'new'}}]];
  for(const [action,args] of cases){const result=await s.raw(action,{document_id:s.id,expected_revision:(await s.service.load(s.id)).record.revision,...args});assert.equal(result.ok,false,action);assert.equal(result.error.code,'AUTHORING_SCOPE',JSON.stringify(result));assert.equal(stateDigest(await s.service.state(s.id)),before,action);}
  await assert.rejects(fs.stat(path.join(s.root,'.cardstudio-scean/documents',s.id,'assets')),{code:'ENOENT'});
});

test('generic pointers, ancestor replacements, upserts and metadata cannot bypass the final content projection',async t=>{
  const s=await setup(t);await s.scope('content');const before=await s.service.state(s.id),digest=stateDigest(before);
  const card=before.decoded.card;
  const cases=[['patch',{patches:[{op:'add',path:'/data/extensions/a~1b',value:'escape'}]}],['patch',{patches:[{op:'add',path:'/data/future_runtime',value:{script:'inert'}}]}],['patch',{patches:[{op:'replace',path:'/data',value:{...card.data,extensions:{changed:true}}}]}],['patch_text',{field:'system_prompt',old_text:'x',new_text:'y'}],['book_patch',{entry_id:'id:3',changes:{content:'changed',extensions:{opaque:{keep:false}}}}],['book_upsert',{entry_id:'id:3',entry:{content:'changed',constant:true}}],['patch',{patches:[{op:'replace',path:'/data/first_mes',value:'<script>unknown()</script>'}]}]];
  for(const [action,args] of cases){const result=await s.raw(action,{document_id:s.id,expected_revision:before.record.revision,...args});assert.equal(result.ok,false,action);assert.ok(['AUTHORING_SCOPE','MATCH','ENTRY_TOOL','PATH'].includes(result.error.code),JSON.stringify(result));assert.equal(stateDigest(await s.service.state(s.id)),digest);}
  // Existing /data ancestor protection is retained even for narrative-only proposals.
  const ancestor=await s.raw('patch',{document_id:s.id,expected_revision:before.record.revision,patches:[{op:'replace',path:'/data',value:{...card.data,description:'Plain replacement only'}}]});
  assert.equal(ancestor.error.code,'PATH');assert.equal(stateDigest(await s.service.state(s.id)),digest);
});

test('mixed original content stays readonly even when the proposed new value is plain text',async t=>{
  const s=await setup(t);await s.mutate('patch',{patches:[{op:'replace',path:'/data/first_mes',value:'<section>Existing front end</section>'}]});await s.scope('content');
  const before=await s.service.state(s.id);const r=await s.raw('patch',{document_id:s.id,expected_revision:before.record.revision,patches:[{op:'replace',path:'/data/first_mes',value:'Safe replacement'}]});assert.equal(r.error.code,'AUTHORING_SCOPE');assert.equal(stateDigest(await s.service.state(s.id)),stateDigest(before));
  for(const text of ['<% value %>','@@if condition\ntext','{{setvar::x::y}}','<img onerror="x">','javascript:code'])assert.throws(()=>assertNarrativeText(text,'synthetic'),{code:'AUTHORING_SCOPE'});
  assertNarrativeText('Plain **Markdown** {{user}} and <START>\n{{char}}: hello.','synthetic');
});

test('managed Gate generic body changes are guarded in Full mode and edit_body preserves prefix/rule/unknown metadata',async t=>{
  const s=await setup(t),before=await s.service.state(s.id),read=await s.op('gating',{action:'read',document_id:s.id,entry_id:s.entry});
  for(const action of ['book_patch','book_upsert']){
    const r=await s.raw(action,{document_id:s.id,expected_revision:before.record.revision,entry_id:s.entry,...action==='book_patch'?{changes:{content:'replacement'}}:{entry:{content:'replacement'}}});assert.equal(r.error.code,'GATE_MANAGED_BODY');
  }
  await s.mutate('gating',{action:'edit_body',entry_id:s.entry,expected_source_hash:read.source_hash,old_text:'Ordinary lore',new_text:'Revised lore'});
  const after=await s.service.state(s.id),old=before.decoded.card.data.character_book.entries.find(e=>e.id===1),updated=after.decoded.card.data.character_book.entries.find(e=>e.id===1);
  assert.equal(updated.content,old.content.replace('Ordinary lore','Revised lore'));assert.deepEqual(after.authoring.gating,before.authoring.gating);assert.deepEqual(updated.extensions,old.extensions);
  await s.scope('content');const blocked=await s.raw('gating',{action:'edit_body',document_id:s.id,expected_revision:after.record.revision,entry_id:s.entry,expected_source_hash:sha(canonical(updated)),old_text:'Revised',new_text:'Different'});assert.equal(blocked.error.code,'AUTHORING_SCOPE');
});

test('rollback of narrative-only snapshots works; rollback changing runtime/sidecar is denied',async t=>{
  const s=await setup(t);await s.scope('content');const before=await s.service.state(s.id);
  await s.mutate('patch_text',{field:'description',old_text:'quiet',new_text:'bright'});await s.mutate('rollback',{to:before.record.revision});
  assert.equal((await s.service.state(s.id)).decoded.card.data.description,before.decoded.card.data.description);
  const current=await s.service.state(s.id),r=await s.raw('rollback',{document_id:s.id,expected_revision:current.record.revision,to:0});assert.equal(r.error.code,'AUTHORING_SCOPE');assert.equal(stateDigest(await s.service.state(s.id)),stateDigest(current));
});

test('scope epoch revokes delayed precommit and drains old jobs before the human switch acknowledges',async t=>{
  const s=await setup(t);let reached,release;const entered=new Promise(resolve=>reached=resolve),held=new Promise(resolve=>release=resolve);
  s.service.beforeCommit=async()=>{reached();await held;};const before=await s.service.state(s.id);
  const old=s.raw('patch',{document_id:s.id,expected_revision:before.record.revision,patches:[{op:'add',path:'/data/extensions/delayed',value:{protected:true}}]});await entered;
  let acknowledged=false;const switched=s.scope('content').then(value=>{acknowledged=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(acknowledged,false);
  release();const [result,value]=await Promise.all([old,switched]);assert.equal(result.ok,false);assert.ok(['CANCELLED','AUTHORING_SCOPE_CHANGED'].includes(result.error.code));assert.equal(value.authoring_scope.mode,'content');assert.equal(stateDigest(await s.service.state(s.id)),stateDigest(before));
  await assert.rejects(fs.stat(path.join(s.root,'.cardstudio-scean/documents',s.id,String(before.record.revision+1)+'.json')),{code:'ENOENT'});
});

test('multiple windows share scope, stale-window promotion is rejected, and Session scope survives reacquisition',async t=>{
  const s=await setup(t),second=await s.loader.acquire(s.agent,'scope-page-two-0002');await s.scope('content');
  const renewed=await s.loader.renew(s.agent,second);assert.equal(renewed.authoring_scope.mode,'content');assert.equal(renewed.authoring_scope.epoch,1);
  await assert.rejects(s.scope('full',0,second),{code:'AUTHORING_SCOPE_CHANGED'});
  const first=s.getClaim();await s.loader.release(s.agent,first);await s.loader.release(s.agent,second);const newClaim=await s.loader.acquire(s.agent,'scope-page-three-003');s.setClaim(newClaim);
  assert.equal(newClaim.authoring_scope.mode,'content');assert.equal((await s.raw('target',{action:'rebuild',document_id:s.id,expected_revision:0})).error.code,'AUTHORING_SCOPE');
});

test('exact-byte Library copy/import retains runtime as data and cannot reset or remove Session scope',async t=>{
  const source=await setup(t),s=await setup(t,{empty:true}),original=Buffer.from((await source.service.state(source.id)).record.bytes,'base64');await fs.writeFile(path.join(s.root,'library','synthetic-runtime.json'),original);await s.scope('content');
  await s.op('library',{action:'refresh'});const list=await s.op('library',{action:'list'}),item=list.items[0];
  const copied=await s.op('library_copy',{item_id:item.item_id,source_sha256:item.source_sha256});assert.equal(copied.authoring_scope.mode,'content');assert.deepEqual(Buffer.from((await s.service.load(copied.id)).record.bytes,'base64'),original);
  assert.deepEqual(await fs.readFile(path.join(s.root,'library','synthetic-runtime.json')),original);
  const r=await s.raw('patch',{document_id:copied.id,expected_revision:0,patches:[{op:'replace',path:'/data/extensions',value:{}}]});assert.equal(r.error.code,'AUTHORING_SCOPE');
  assert.equal((await s.raw('create',{name:'Another card'})).error.code,'SESSION_CARD_BOUND');
  const fresh=await setup(t,{empty:true});await fresh.scope('content');const created=await fresh.op('create',{name:'Fresh narrative',first_mes:'A simple puzzle.'});assert.equal(created.authoring_scope.mode,'content');
  assert.equal((await fresh.raw('create',{name:'Bad new runtime',system_prompt:'hidden runtime'})).error.code,'AUTHORING_SCOPE');
});

test('human scope invocation is separate from Agent actions and read capability schemas cannot promote',()=>{
  assert.equal(cardstudioRemote.descriptors.filter(d=>d.method==='setAuthoringScope').length,1);
  assert.equal(toolSpecs.some(([name])=>/scope/i.test(name)),false);
  assert.throws(()=>assertScopeOperation({mode:'content'},'scope_set',{mode:'full'}),{code:'AUTHORING_SCOPE'});
  assert.throws(()=>assertScopeOperation({mode:'content'},'asset_upload_begin',{scope:'full'}),{code:'AUTHORING_SCOPE'});
});

test('content-mode standalone ST dictionary body editing preserves every book and entry metadata byte value',async t=>{
  const s=await setup(t,{empty:true});await s.scope('content');
  const book={name:'Synthetic book',scan_depth:4,extensions:{opaque:true},entries:{1:{uid:1,key:['plain'],keysecondary:[],content:'Plain body',disable:false,order:5,extensions:{keep:true},future:null}}};
  const original=Buffer.from(JSON.stringify(book,null,2)+'\n');await fs.writeFile(path.join(s.root,'imports','synthetic-worldbook.json'),original);
  const imported=await s.op('import',{path:'imports/synthetic-worldbook.json',type:'worldbook'}),read=await s.service.state(imported.id);
  await s.op('book_patch',{document_id:imported.id,expected_revision:0,entry_id:read.record.entryIds[0],changes:{content:'A new plain body'}});
  const after=await s.service.state(imported.id),expected=structuredClone(book);expected.entries[1].content='A new plain body';assert.deepEqual(after.decoded.card.data.character_book,expected);
  assert.deepEqual(await fs.readFile(path.join(s.root,'imports','synthetic-worldbook.json')),original);
});

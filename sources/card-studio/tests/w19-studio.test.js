import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {syntheticPng} from './helpers/synthetic-assets.js';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const stage=process.env.STUDIO_W19_STAGE??fileURLToPath(new URL('../../../../studio-w19-stage',import.meta.url));
const lib=async name=>import(pathToFileURL(path.join(stage,'cardstudio-bundle/lib',name)).href);
const [{WorkspaceLoader},{MaterialCardService},{UploadBuffer,UPLOAD_CHUNK},{ExportDownloads,exportZip},{sha},{WorkspaceClient},{cardstudioRemote}]=await Promise.all(['loader.js','material-service.js','upload-buffer.js','export-download.js','codec.js','client-controller.js','bridge-protocol.js'].map(lib));
const template=await fs.readFile(path.join(stage,'cardstudio-bundle/client-template.js'),'utf8');
const downloadFactorySource=template.split('/* W19_VERIFIED_DOWNLOAD_START */')[1]?.split('/* W19_VERIFIED_DOWNLOAD_END */')[0];
const downloadFactory=()=>vm.runInNewContext(downloadFactorySource+';createVerifiedDownload;');
const card=name=>({spec:'chara_card_v3',spec_version:'3.0',data:{name,description:'Synthetic only',personality:'',scenario:'',first_mes:'Hello',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],group_only_greetings:[],tags:[],creator:'test',character_version:'1',extensions:{},character_book:{entries:[],extensions:{}}}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(t,{taskMs=600000}={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'w19-studio-'));let now=0,service,cancelled=0,disposed=0,idle=deferred();
  const agent={id:'synthetic-session',status:'idle',session:{header:{cwd:root},snapshotEvents:()=>[]},cancel(){cancelled++;this.status='idle';idle.resolve();},whenIdle(){return this.status==='running'?idle.promise:Promise.resolve();}},agents=new Map([[agent.id,agent]]);
  const loader=new WorkspaceLoader({root,taskMs,now:()=>now,agentLookup:id=>agents.get(id),activateAddon:async()=>({async dispose(){disposed++;}}),serviceFactory:()=>service=new MaterialCardService(root)});await loader.init();
  const a=await loader.acquire(agent,'synthetic-page-0001'),b=await loader.acquire(agent,'synthetic-page-0002');
  const call=(claim,action,args={})=>loader.call(agent,loader.records.get(agent.id),claim,action,args);
  const ok=async(claim,action,args={})=>{const result=await call(claim,action,args);assert(result.ok,JSON.stringify(result));return result.value;};
  t.after(async()=>{agent.status='idle';idle.resolve();await loader.close();assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('w19-studio-'));await fs.rm(root,{recursive:true,force:true});});
  return {root,loader,agent,agents,a,b,call,ok,get service(){return service;},now:value=>now=value,cancelled:()=>cancelled,disposed:()=>disposed,run(){agent.status='running';idle=deferred();},finish(){agent.status='idle';idle.resolve();}};
}

test('W19 page uploads are independent and reject cross-page, cross-lease and cross-Session access',async t=>{
  const f=await fixture(t),data=Buffer.from(JSON.stringify(card('A'))),args={name:'a.json',size:data.length,type:'card'};
  const a=await f.ok(f.a,'upload_begin',args),b=await f.ok(f.b,'upload_begin',{...args,name:'b.json'});
  assert.equal(f.service.uploads.rows.size,2);
  const chunk={upload_id:a.upload_id,offset:0,base64:data.toString('base64')};assert.equal((await f.call(f.b,'upload_chunk',chunk)).error.code,'UPLOAD_EXPIRED');
  assert.throws(()=>f.service.uploads.append({sessionId:'different',pageId:f.a.page_id,leaseId:f.a.lease_id},chunk),error=>error.code==='UPLOAD_EXPIRED');
  await f.ok(f.a,'upload_chunk',chunk);await f.ok(f.b,'upload_chunk',{...chunk,upload_id:b.upload_id});
  const importedA=await f.ok(f.a,'upload_finish',{upload_id:a.upload_id}),importedB=await f.ok(f.b,'upload_finish',{upload_id:b.upload_id});assert.notEqual(importedA.id,importedB.id);
  const renewed=await f.loader.renew(f.agent,f.a);assert.equal(renewed.selection_status.document_id,importedB.id);assert(renewed.selection_status.changed);
  const old=await f.ok(f.a,'upload_begin',args);await f.loader.acquire(f.agent,f.a.page_id);assert.equal((await f.call(f.a,'upload_chunk',{...chunk,upload_id:old.upload_id})).error.code,'STALE_LEASE');
});

test('W19 uploads bound memory, replacement, offsets and expiry without clearing another page',()=>{
  let now=0;const buffer=new UploadBuffer({now:()=>now}),owner=page=>({sessionId:'session',pageId:page,leaseId:'lease'}),args={name:'a.json',size:1,type:'card'};
  const a=buffer.begin(owner('A'),args),b=buffer.begin(owner('B'),args),replacement=buffer.begin(owner('A'),args);assert.equal(buffer.rows.size,2);assert.throws(()=>buffer.get(owner('A'),a.upload_id));buffer.append(owner('B'),{upload_id:b.upload_id,offset:0,base64:'eA=='});assert.equal(buffer.finish(owner('B'),b.upload_id).bytes.toString(),'x');
  assert.throws(()=>buffer.append(owner('A'),{upload_id:replacement.upload_id,offset:1,base64:'eA=='}));now=120001;buffer.sweep();assert.equal(buffer.rows.size,0);
});

test('W19 same saved revision permits one edit; changed Session selection rejects stale page writes explicitly',async t=>{
  const f=await fixture(t),one=await f.ok(f.a,'create',{name:'Synthetic one'});await f.ok(f.b,'open',{document_id:one.id});
  const args={document_id:one.id,expected_revision:0,patches:[{op:'replace',path:'/data/first_mes',value:'A'}]},results=await Promise.all([f.call(f.a,'patch',args),f.call(f.b,'patch',{...args,patches:[{op:'replace',path:'/data/first_mes',value:'B'}]})]);assert.equal(results.filter(row=>row.ok).length,1);assert.equal(results.find(row=>!row.ok).error.code,'REVISION_CONFLICT');
  const status=await f.loader.renew(f.agent,results[0].ok?f.b:f.a);assert.equal(status.selection_status.revision,1);assert(status.selection_status.changed);
  const two=await f.ok(f.b,'create',{name:'Synthetic two'}),rejected=await f.call(f.a,'patch',{...args,expected_revision:1});assert.equal(rejected.error.code,'STUDIO_SELECTION_CHANGED');assert.equal((await f.service.read(one.id)).revision,1);assert.equal((await f.loader.renew(f.agent,f.a)).selection_status.document_id,two.id);
});

test('W19 changing selection while a canonical write is paused rejects the late write before head advance',async t=>{
  const f=await fixture(t),a=await f.ok(f.a,'create',{name:'Synthetic card A'}),b=await f.ok(f.b,'create',{name:'Synthetic card B'});await f.ok(f.a,'open',{document_id:a.id});const entered=deferred(),release=deferred();
  f.service.beforeCommit=async()=>{entered.resolve();await release.promise;};
  const write=f.call(f.a,'patch',{document_id:a.id,expected_revision:0,patches:[{op:'replace',path:'/data/first_mes',value:'Late write'}]});await entered.promise;
  const selecting=f.call(f.b,'open',{document_id:b.id});for(let i=0;i<10;i++)await new Promise(done=>setImmediate(done));release.resolve();const [result,selection]=await Promise.all([write,selecting]);assert.equal(result.error.code,'STUDIO_SELECTION_CHANGED');assert(selection.ok,JSON.stringify(selection));assert.equal((await f.service.read(a.id)).revision,0);assert.equal((await f.service.selectedDocument(f.agent.id)).document_id,b.id);
});

test('W19 asset upload completion pins its trusted document and revision and rejects a changed selected card',async t=>{
  const f=await fixture(t),a=await f.ok(f.a,'create',{name:'Synthetic asset A'}),bytes=syntheticPng(),upload=await f.ok(f.a,'asset_upload_begin',{document_id:a.id,expected_revision:0,name:'synthetic.png',size:bytes.length});
  await f.ok(f.a,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:bytes.toString('base64')});const b=await f.ok(f.b,'create',{name:'Synthetic asset B'});
  assert.equal((await f.call(f.b,'asset_upload_finish',{upload_id:upload.upload_id})).error.code,'UPLOAD_EXPIRED');
  const response=await f.call(f.a,'asset_upload_finish',{upload_id:upload.upload_id});assert.equal(response.ok,false);assert.equal(response.error.code,'STUDIO_SELECTION_CHANGED');assert.equal((await f.service.read(a.id)).revision,0);assert.equal((await f.service.selectedDocument(f.agent.id)).document_id,b.id);
});

test('W19 selecting another card during a paused asset upload commit cannot advance the original head',async t=>{
  const f=await fixture(t),a=await f.ok(f.a,'create',{name:'Synthetic paused asset A'}),b=await f.ok(f.b,'create',{name:'Synthetic paused asset B'});await f.ok(f.a,'open',{document_id:a.id});const bytes=syntheticPng(),upload=await f.ok(f.a,'asset_upload_begin',{document_id:a.id,expected_revision:0,name:'synthetic.png',size:bytes.length});await f.ok(f.a,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:bytes.toString('base64')});
  const entered=deferred(),release=deferred();f.service.beforeCommit=async()=>{entered.resolve();await release.promise;};
  const finishing=f.call(f.a,'asset_upload_finish',{upload_id:upload.upload_id});await entered.promise;const selecting=f.call(f.b,'open',{document_id:b.id});for(let i=0;i<10;i++)await new Promise(done=>setImmediate(done));release.resolve();const [result,selection]=await Promise.all([finishing,selecting]);assert.equal(result.ok,false);assert.equal(result.error.code,'STUDIO_SELECTION_CHANGED');assert(selection.ok,JSON.stringify(selection));const current=await f.service.state(a.id);assert.equal(current.record.revision,0);assert.equal(current.authoring.assetManifest.assets.length,0);assert.equal((await f.service.selectedDocument(f.agent.id)).document_id,b.id);
});

test('W19 accepted Agent survives page expiration beyond 90 seconds, page writes expire, then idle releases capability',async t=>{
  const f=await fixture(t);f.run();f.loader.agentStatus(f.agent);const deadline=f.loader.records.get(f.agent.id).hostTask.deadline;
  f.now(95000);await f.loader.sweep();assert.equal(f.cancelled(),0);assert.equal(f.loader.records.get(f.agent.id).pages.size,0);assert.equal((await f.call(f.a,'create',{name:'Late human'})).error.code,'STALE_LEASE');
  const accepted=await f.call(null,'create',{name:'Accepted synthetic Agent'});assert(accepted.ok,JSON.stringify(accepted));assert.equal(f.loader.records.get(f.agent.id).hostTask.deadline,deadline);
  f.finish();await f.loader.transition;await f.loader.sweep();assert.equal(f.loader.records.size,0);assert.equal(f.disposed(),1);assert.equal(f.cancelled(),0);
});

test('W19 a new Agent task cannot claim an expired unswept page lease',async t=>{
  const f=await fixture(t);f.now(95000);f.run();f.loader.agentStatus(f.agent);assert.equal(f.loader.records.get(f.agent.id).hostTask,undefined);assert.equal((await f.call(null,'create',{name:'New expired task'})).error.code,'STALE_LEASE');
});

test('W19 Host Agent deadline is absolute despite page renewal and cancels once; shutdown cancels explicitly',async t=>{
  const f=await fixture(t,{taskMs:100000});f.run();await f.loader.renew(f.agent,f.a);const original=f.loader.records.get(f.agent.id).hostTask.deadline;f.now(80000);await f.loader.renew(f.agent,f.a);assert.equal(f.loader.records.get(f.agent.id).hostTask.deadline,original);f.now(100001);assert.equal((await f.call(null,'create',{name:'Too late'})).error.code,'HOST_TASK_TIMEOUT');await f.loader.sweep();assert.equal(f.cancelled(),1);assert.equal(f.loader.records.size,0);
  const g=await fixture(t);g.run();await g.loader.renew(g.agent,g.a);await g.loader.close();assert.equal(g.cancelled(),1);assert.equal(g.loader.records.size,0);
});

test('W19 scope/generation checks still reject retired Agent task jobs and late human lease response',async t=>{
  const f=await fixture(t);f.run();await f.loader.renew(f.agent,f.a);const record=f.loader.records.get(f.agent.id),policy=f.loader.scopePolicy(f.agent,record,null,'create',{});f.finish();await f.loader.sweep();assert.throws(()=>policy.assertCurrent(),error=>error.code==='STALE_HOST_TASK');
  const before=record.scope.epoch;await f.loader.setAuthoringScope(f.agent,{mode:'content',expected_epoch:before,claim:f.a});assert.equal((await f.call(f.a,'create',{name:'Synthetic',system_prompt:'protected'})).error.code,'AUTHORING_SCOPE');
  const old=record;f.agents.set(f.agent.id,{...f.agent});assert.equal((await f.loader.call(f.agent,old,f.a,'read',{})).error.code,'STALE_WORKSPACE');
});

test('W19 export download uses exact page/Session/document/revision/hash receipt and no caller paths',async t=>{
  const f=await fixture(t),doc=await f.ok(f.a,'create',{name:'Synthetic download'}),exported=await f.ok(f.a,'export',{document_id:doc.id,expected_revision:0,name:'synthetic.json'});assert(exported.download,JSON.stringify(exported));
  const d=exported.download,request={mode:'chunk',receipt_id:d.receipt_id,document_id:d.document_id,expected_revision:d.revision,sha256:d.sha256,offset:0};
  const chunk=await f.loader.downloadExport(f.agent,{...request,claim:f.a});assert.equal(sha(Buffer.from(chunk.base64,'base64')),d.sha256);assert.equal(chunk.source_sha256,doc.sha256);assert.equal(chunk.filename,'synthetic.json');
  for(const changed of [{sha256:'0'.repeat(64)},{expected_revision:1},{document_id:'other'},{path:'../outside'},{offset:1}])await assert.rejects(()=>f.loader.downloadExport(f.agent,{...request,...changed,claim:f.a}));
  await assert.rejects(()=>f.loader.downloadExport(f.agent,{...request,claim:f.b}),error=>error.code==='DOWNLOAD_EXPIRED');
  const other={...f.agent,id:'other-session'};f.agents.set(other.id,other);const otherClaim=await f.loader.acquire(other,'synthetic-other-page');await assert.rejects(()=>f.loader.downloadExport(other,{...request,claim:otherClaim}));
  await f.ok(f.a,'patch',{document_id:doc.id,expected_revision:0,patches:[{op:'replace',path:'/data/first_mes',value:'Changed'}]});await assert.rejects(()=>f.loader.downloadExport(f.agent,{...request,claim:f.a}),error=>error.code==='REVISION_CONFLICT');
});

test('W19 exact export bytes remain immutable after receipt; TTL, release, restart and tamper are rejected',async t=>{
  const f=await fixture(t),doc=await f.ok(f.a,'create',{name:'Synthetic expiry'}),exported=await f.ok(f.a,'export',{document_id:doc.id,expected_revision:0,name:'expiry.json'}),d=exported.download,owner=f.loader.uploadOwner(f.agent,f.a),request={mode:'chunk',receipt_id:d.receipt_id,document_id:doc.id,expected_revision:0,sha256:d.sha256,offset:0};
  await fs.writeFile(path.join(f.root,exported.path),'tampered after export');assert.equal(sha(Buffer.from(f.loader.downloads.request(owner,request).base64,'base64')),d.sha256);
  const saved=await f.service.read(doc.id);await assert.rejects(()=>f.loader.downloads.issue(f.root,owner,exported,saved),error=>error.code==='DOWNLOAD_CHANGED');
  const store=new ExportDownloads({now:()=>0});assert.throws(()=>store.request(owner,request),error=>error.code==='DOWNLOAD_EXPIRED');
  const release={...request,mode:'release'};delete release.offset;assert(f.loader.downloads.request(owner,release).released);assert.throws(()=>f.loader.downloads.request(owner,request));
  const second=await f.ok(f.a,'export',{document_id:doc.id,expected_revision:0,name:'expiry-2.json'});f.now(second.download.expires_at+1);f.loader.downloads.sweep();assert.equal(f.loader.downloads.rows.size,0);
});

test('W19 optional download failure cannot swallow a replaced lease and publish a late export response',async t=>{
  const f=await fixture(t),doc=await f.ok(f.a,'create',{name:'Synthetic late export'}),entered=deferred(),release=deferred();
  f.loader.downloads.issue=async()=>{entered.resolve();await release.promise;throw Object.assign(new Error('Synthetic bounded download failure'),{code:'DOWNLOAD_LIMIT'});};
  const exported=f.call(f.a,'export',{document_id:doc.id,expected_revision:0,name:'late.json'});await entered.promise;const next=await f.loader.acquire(f.agent,f.a.page_id);release.resolve();const response=await exported;assert.equal(response.ok,false);assert(['CANCELLED','STALE_LEASE'].includes(response.error.code));assert((await f.call(next,'read',{document_id:doc.id})).ok);assert.equal((await f.service.read(doc.id)).revision,0);
});

test('W19 browser bundle ZIP includes verified manifest/card and CRC-correct members with safe paths',async t=>{
  const f=await fixture(t),doc=await f.ok(f.a,'create',{name:'Synthetic bundle'}),exported=await f.ok(f.a,'export_bundle',{document_id:doc.id,expected_revision:0,name:'bundle'});assert(exported.download,JSON.stringify(exported));const d=exported.download,chunk=await f.loader.downloadExport(f.agent,{mode:'chunk',receipt_id:d.receipt_id,document_id:doc.id,expected_revision:0,sha256:d.sha256,offset:0,claim:f.a}),bytes=Buffer.from(chunk.base64,'base64');assert.equal(bytes.readUInt32LE(0),0x04034b50);assert(bytes.includes(Buffer.from('manifest.json')));assert(bytes.includes(Buffer.from('card.json')));assert.equal(sha(bytes),d.sha256);assert.throws(()=>exportZip([{name:'../escape',bytes:Buffer.from('x')}]));
});

test('W19 multi-chunk raw download preserves byte count and whole-file hash, bounds receipts and rejects expiry',async t=>{
  const f=await fixture(t),long='Synthetic '.repeat(6500),doc=await f.ok(f.a,'create',{name:'Synthetic multi chunk',description:long,personality:long,scenario:long,first_mes:long,mes_example:long,creator_notes:long}),exported=await f.ok(f.a,'export',{document_id:doc.id,expected_revision:0,name:'large.json'}),d=exported.download;assert(d.size>UPLOAD_CHUNK);const chunks=[];
  for(let offset=0;offset<d.size;offset+=d.chunk_bytes){const chunk=await f.loader.downloadExport(f.agent,{mode:'chunk',receipt_id:d.receipt_id,document_id:doc.id,expected_revision:0,sha256:d.sha256,offset,claim:f.a});chunks.push(Buffer.from(chunk.base64,'base64'));}const bytes=Buffer.concat(chunks);assert.equal(bytes.length,d.size);assert.equal(sha(bytes),d.sha256);
  const owner=f.loader.uploadOwner(f.agent,f.a),saved=await f.service.read(doc.id),small=new ExportDownloads({limit:1});await assert.rejects(()=>small.issue(f.root,owner,exported,saved),error=>error.code==='DOWNLOAD_LIMIT');
  const full=new ExportDownloads({totalLimit:1});await assert.rejects(()=>full.issue(f.root,owner,exported,saved),error=>error.code==='DOWNLOAD_BUSY');
  for(let i=0;i<5;i++)await f.loader.downloads.issue(f.root,owner,exported,saved);assert.equal(f.loader.downloads.rows.size,4);f.now(d.expires_at+1);assert.throws(()=>f.loader.downloads.request(owner,{mode:'chunk',receipt_id:d.receipt_id,document_id:doc.id,expected_revision:0,sha256:d.sha256,offset:0}),error=>error.code==='DOWNLOAD_EXPIRED');
});

test('W19 remote Library choice stays inside configured capability and rejects junction/traversal/UNC escape',async t=>{
  const f=await fixture(t),inside=path.join(f.root,'library','inside'),outside=await fs.mkdtemp(path.join(os.tmpdir(),'w19-library-outside-'));await fs.mkdir(inside,{recursive:true});t.after(async()=>{assert.equal(path.dirname(outside),os.tmpdir());assert(path.basename(outside).startsWith('w19-library-outside-'));await fs.rm(outside,{recursive:true,force:true});});
  const choose=(p,revision=f.service.libraryRevision)=>f.loader.setLibraryRoot(f.agent,{path:p,expected_revision:revision,claim:f.a});assert.equal((await choose(inside)).path,await fs.realpath(inside));
  for(const p of [outside,f.root+'/../'+path.basename(f.root)+'/library',String.raw`\\synthetic-server\share\cards`])await assert.rejects(()=>choose(p));
  const junction=path.join(f.root,'library','escape');await fs.symlink(outside,junction,'junction');await assert.rejects(()=>choose(junction),error=>error.code==='LIBRARY_CAPABILITY');await fs.unlink(junction);assert.equal((await choose(null)).custom,false);
  await assert.rejects(()=>choose(f.root),error=>error.code==='LIBRARY_PATH');assert.equal(f.service.librarySettings().custom,false);
});

test('W19 Client surfaces changed selection without replacing view and discards late download after Session change',async()=>{
  const events=[],gate=deferred(),selection={document_id:'a',revision:0,agent_generation:'g',workspace_generation:'w',changed:false};let current=selection;
  const client=new WorkspaceClient({root:'C:/Synthetic',pageId:'synthetic-client-page',hide(){},show(){},notify(error){throw error;},setTimer:()=>0,clearTimer(){},sendDownload:()=>gate.promise,send:async(_id,request)=>({ok:true,value:request.action==='acquire'?{lease_id:'lease',selection_status:current}:request.action==='renew'?{selection_status:current}:{} })});
  client.selectionChanged=value=>events.push(value);await client.transition({id:'A',cwd:'C:/Synthetic'});current={...selection,document_id:'b',revision:2,changed:true};await client.heartbeat(client.sequence);assert.equal(events.length,1);assert.equal(events[0].document_id,'b');
  client.updateSelection({...current,revision:1});assert.equal(client.selectionStatus.revision,2);const pending=client.downloadExport({mode:'chunk'});await client.transition({id:'B',cwd:'C:/Synthetic'});gate.resolve({ok:true,value:{base64:'old'}});await assert.rejects(pending,/previous Session/);await client.close();
  const download=cardstudioRemote.descriptors.find(row=>row.method==='downloadExport');assert(download);const codec=download.parameters[1].codec.create();assert.throws(()=>codec.parse({mode:'chunk',claim:{},receipt_id:'r',document_id:'d',expected_revision:0,sha256:'0'.repeat(64),offset:0,path:'../escape'}));
});

test('W19 verified download link stays user-clickable for a bounded lifetime and revokes on selection, replacement and unmount',()=>{
  let now=0,counter=0;const revoked=[],changes=[],timers=new Map(),identity={sequence:1,session_id:'S',document_id:'A',revision:2,selected_document_id:'A',selected_revision:2},receipt={document_id:'A',revision:2,filename:'synthetic.json',size:5,sha256:'a'.repeat(64)};
  const manager=downloadFactory()({createURL:()=>`blob:synthetic-${++counter}`,revokeURL:url=>revoked.push(url),onChange:value=>changes.push(value),now:()=>now,setTimer:(fn,ms)=>{const id=++counter;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
  const first=manager.publish(new Blob(['hello']),receipt,identity);assert.equal(manager.usable(identity),true);assert.equal(first.filename,receipt.filename);assert.equal([...timers.values()][0].ms,120000);
  manager.requested();assert.equal(manager.current.requested,true);assert.equal([...timers.values()][0].ms,30000);manager.invalidate({...identity,selected_document_id:'B'});assert.equal(manager.current,null);assert(revoked.includes(first.url));
  const second=manager.publish(new Blob(['hello']),receipt,identity),third=manager.publish(new Blob(['hello']),receipt,identity);assert(revoked.includes(second.url));now=120001;assert.equal(manager.usable(identity),false);assert(revoked.includes(third.url));now=0;
  const last=manager.publish(new Blob(['hello']),receipt,identity);manager.close();assert(revoked.includes(last.url));assert.equal(manager.current,null);assert.throws(()=>manager.publish(new Blob(['hello']),receipt,identity),/closed/);assert(changes.length>=7);
  assert(template.includes("'data-verified-download':'ready'"));assert(template.includes('href:verifiedDownload.url,download:verifiedDownload.filename'));
});

test('W19 actual client export publishes an explicit download link only after full SHA verification and always releases the RPC receipt',async()=>{
  const bytes=Buffer.from('SYNTHETIC verified browser file'),identity={sequence:1,session_id:'S',document_id:'A',revision:2,selected_document_id:'A',selected_revision:2},baseReceipt={receipt_id:'receipt',document_id:'A',revision:2,sha256:sha(bytes),filename:'verified.json',size:bytes.length,media_type:'application/json',chunk_bytes:UPLOAD_CHUNK};
  const body=template.slice(template.indexOf('const deliverExport=async(action,values)=>{'),template.indexOf('const rawExportForm='));assert(!body.includes('.click()'));
  for(const tamper of [false,true]){
    const modes=[],urls=[],manager=downloadFactory()({createURL:blob=>{urls.push(blob);return 'blob:verified';},revokeURL(){},onChange(){},setTimer:()=>1,clearTimer(){}}),receipt={...baseReceipt,...tamper?{sha256:'0'.repeat(64)}:{}};
    const deliver=vm.runInNewContext(body+';deliverExport;',{call:async()=>({download:receipt}),setV(){},presentDiagnostics:value=>value,json:JSON.stringify,state:{current:{doc:{id:'A',revision:2}}},controller:{downloadExport:async request=>{modes.push(request.mode);return {base64:bytes.toString('base64')};}},sequence:1,valid:()=>true,downloadIdentity:()=>identity,downloadRef:{current:manager},atob,Uint8Array,Blob,crypto:webcrypto});
    if(tamper){await assert.rejects(deliver('export',{}));assert.equal(manager.current,null);assert.equal(urls.length,0);}else{await deliver('export',{});assert.equal(manager.current.filename,'verified.json');assert.equal(manager.current.sha256,baseReceipt.sha256);assert.equal(urls.length,1);assert.equal(await urls[0].text(),bytes.toString());}
    assert.deepEqual(modes,['chunk','release']);manager.close();
  }
});

test('W19 selection change during browser SHA verification cannot expose a stale download link',async()=>{
  const bytes=Buffer.from('SYNTHETIC delayed digest'),entered=deferred(),release=deferred();let selected='A',created=0;
  const receipt={receipt_id:'r',document_id:'A',revision:0,sha256:sha(bytes),filename:'late.json',size:bytes.length,media_type:'application/json',chunk_bytes:UPLOAD_CHUNK},manager=downloadFactory()({createURL:()=>{created++;return 'blob:late';},revokeURL(){},onChange(){},setTimer:()=>1,clearTimer(){}}),body=template.slice(template.indexOf('const deliverExport=async(action,values)=>{'),template.indexOf('const rawExportForm='));
  const deliver=vm.runInNewContext(body+';deliverExport;',{call:async()=>({download:receipt}),setV(){},presentDiagnostics:value=>value,json:JSON.stringify,state:{current:{doc:{id:'A',revision:0}}},controller:{downloadExport:async()=>({base64:bytes.toString('base64')})},sequence:1,valid:()=>true,downloadIdentity:()=>({sequence:1,session_id:'S',document_id:'A',revision:0,selected_document_id:selected,selected_revision:0}),downloadRef:{current:manager},atob,Uint8Array,Blob,crypto:{subtle:{digest:async(...args)=>{entered.resolve();await release.promise;return webcrypto.subtle.digest(...args);}}}});
  const pending=deliver('export',{});await entered.promise;selected='B';release.resolve();await assert.rejects(pending,/selection changed/);assert.equal(created,0);assert.equal(manager.current,null);manager.close();
});

test('W19 native SDK Bridge exposes human receipt download, rejects generic/model action and preserves permission surface',async t=>{
  const {nativeHost}=await import('./helpers/current-host.js'),plugin=await import(pathToFileURL(path.join(stage,'cardstudio-bundle/index.js')).href),home=await fs.mkdtemp(path.join(os.tmpdir(),'w19-native-')),previous=process.env.DSH_HOME;process.env.DSH_HOME=home;let host;
  t.after(async()=>{await host?.close();if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;assert.equal(path.dirname(home),os.tmpdir());assert(path.basename(home).startsWith('w19-native-'));await fs.rm(home,{recursive:true,force:true});});
  host=await nativeHost(home,plugin);const workspace=host.registry.list()[0],agent=host.agent('synthetic-native-w19',workspace.path),bridge=host.ctx.get('cardstudioSceanBridge'),invoke=request=>bridge.request(agent,request,new AbortController().signal),a=(await invoke({action:'acquire',page_id:'native-synthetic-page-1'})).value,b=(await invoke({action:'acquire',page_id:'native-synthetic-page-2'})).value;
  const created=await invoke({action:'create',claim:a,args:{name:'Synthetic native download'}});assert(created.ok,JSON.stringify(created));const doc=created.value,exported=await invoke({action:'export',claim:a,args:{document_id:doc.id,expected_revision:0,name:'native.json'}});assert(exported.ok,JSON.stringify(exported));const d=exported.value.download;assert(d,JSON.stringify(exported));
  const request={mode:'chunk',receipt_id:d.receipt_id,document_id:doc.id,expected_revision:0,sha256:d.sha256,offset:0};assert.equal((await bridge.downloadExport(agent,{...request,claim:b})).error.code,'DOWNLOAD_EXPIRED');assert.equal(sha(Buffer.from((await bridge.downloadExport(agent,{...request,claim:a})).value.base64,'base64')),d.sha256);
  assert.equal((await invoke({action:'downloadExport',claim:a,args:request})).error.code,'ACTION');assert(!host.ctx.tools.schemas(agent).some(row=>/download/i.test(row.name)));assert.equal((await bridge.setLibraryRoot(agent,{path:home,expected_revision:0,claim:a})).error.code,'LIBRARY_CAPABILITY');
});

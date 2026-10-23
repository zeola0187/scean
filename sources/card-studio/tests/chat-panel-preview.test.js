import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {MaterialCardService} from '../cardstudio-bundle/lib/material-service.js';
import {validSavedPanelArtifact,savedPanelFromTool,savedPanelsInTurn,savedPanelResponseError,decodeSavedPanelResponse} from '../cardstudio-bundle/lib/chat-panel-preview.js';
import {boundPanelWriteReceipt} from '../cardstudio-bundle/lib/saved-panel.js';
import {cardstudioRemote} from '../cardstudio-bundle/lib/bridge-protocol.js';

const bp={schemaVersion:1,id:'synthetic-panel',version:1,extensionPolicy:'deny',variables:[{scope:'world',category:'resources',key:'energy',displayName:'Energy',type:'number',visibility:'public'},{scope:'world',category:'facts',key:'secret',displayName:'SECRET_LABEL_CANARY',type:'string',visibility:'restricted'}]};
const initial={schemaVersion:1,blueprintId:bp.id,blueprintVersion:1,values:[{scope:'world',category:'resources',key:'energy',value:75,source:{id:'synthetic-author',version:1}},{scope:'world',category:'facts',key:'secret',value:'SECRET_VALUE_CANARY',source:{id:'synthetic-author',version:1}}]};
const frontend={schemaVersion:1,id:'synthetic-panel',runtime:{profile:'scean-html-bindings-v1',apiMajor:1},html:'<section><h2>合成面板</h2><p>體力 <strong data-scean-text="energy"></strong></p></section>',css:'section{background:#142840;color:#f1f5ff;padding:16px;border-radius:8px}',bindings:[{alias:'energy',type:'number',target:{scope:'world',category:'resources',key:'energy'}}],conditions:{},capabilities:{network:'none',worldActions:[],derivedDisplays:[]}};
const clone=structuredClone,deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const testWorkspace=fileURLToPath(new URL('..',import.meta.url));
async function hashes(root){const out={};async function visit(directory){for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await visit(file);else out[path.relative(root,file)]=createHash('sha256').update(await fs.readFile(file)).digest('hex');}}await visit(root);return out;}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(testWorkspace,'test-run-chat-panel-'));let now=0,service;
  const agent=id=>({id,status:'idle',session:{header:{cwd:root},snapshotEvents:()=>[]},whenIdle:async()=>{},cancel(){throw Error('No test may cancel an Agent.');}}),a=agent('synthetic-panel-session-A'),b=agent('synthetic-panel-session-B'),agents=new Map([[a.id,a],[b.id,b]]);
  const loader=new WorkspaceLoader({root,now:()=>now,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose:async()=>{}}),serviceFactory:()=>service=new MaterialCardService(root)});await loader.init();const claim=await loader.acquire(a,'synthetic-panel-page-A');
  const call=(action,args,owner=a,lease=claim)=>loader.call(owner,loader.records.get(owner.id),lease,action,args);
  const ok=async(action,args,owner,lease)=>{const result=await call(action,args,owner,lease);assert(result.ok,JSON.stringify(result));return result.value;};
  const document=await ok('create',{name:'Same synthetic name'});
  const save=(extra={})=>ok('frontend',{action:'dynamic_save',document_id:document.id,expected_revision:0,blueprint:clone(bp),initial_state:clone(initial),frontend:clone(frontend),...extra});
  const read=artifact=>loader.resolveSavedPanel(a,{claim,artifact});
  t.after(async()=>{await loader.close();assert.equal(path.dirname(root),path.resolve(testWorkspace));assert(path.basename(root).startsWith('test-run-chat-panel-'));await fs.rm(root,{recursive:true,force:true});});
  return{root,a,b,agents,loader,claim,call,ok,save,read,document,get service(){return service;},now:value=>now=value};
}
function tool(receipt,args={}){return{kind:'tool-result',callId:'synthetic-call',call:{name:'cardstudio_scean_frontend',argsRaw:JSON.stringify({action:'dynamic_save',document_id:receipt.id,expected_revision:receipt.revision-1,...args})},content:[{type:'text',text:JSON.stringify({ok:true,value:receipt})}],isError:false,subCalls:[]};}

test('successful panel save gives a bounded immutable artifact; human read is byte-for-byte readonly',async t=>{
  const f=await fixture(t),receipt=await f.save();assert(validSavedPanelArtifact(receipt.panelPreview));assert.equal(receipt.panelPreviewStatus,'available');assert(Buffer.byteLength(JSON.stringify(receipt))<8192);assert(!JSON.stringify(receipt).includes('SECRET'));
  const before=await hashes(f.root),view=await f.read(receipt.panelPreview);assert.deepEqual(await hashes(f.root),before);assert.equal(view.source,'authoring-initial-state-not-runtime');assert(view.html.includes('作者設定初值（非遊玩狀態）'));assert(view.html.includes('75'));assert(!view.html.includes('SECRET'));assert(view.html.includes("script-src 'none'"));assert(view.html.includes("connect-src 'none'"));assert(!view.html.includes('已提交狀態 v0'));
});
test('old chat preview stays on its saved revision after later panel edits and a refused same-name card switch',async t=>{
  const f=await fixture(t),first=await f.save();const second=await f.ok('frontend',{action:'dynamic_patch',document_id:f.document.id,expected_revision:1,expected_source_hash:first.panelPreview.frontend_hash,field:'html',old_text:'合成面板',new_text:'新版面板'});
  const peer=await f.loader.acquire(f.b,'synthetic-panel-page-B'),other=await f.ok('create',{name:'Same synthetic name'},f.b,peer);assert.equal((await f.call('open',{document_id:other.id})).error.code,'SESSION_CARD_BOUND');const old=await f.read(first.panelPreview),fresh=await f.read(second.panelPreview);assert(old.html.includes('合成面板'));assert(!old.html.includes('新版面板'));assert(fresh.html.includes('新版面板'));assert.notEqual(first.panelPreview.receipt_id,second.panelPreview.receipt_id);
});
test('missing, forged, altered revision/hash and arbitrary locator receipts reject',async t=>{
  const f=await fixture(t),receipt=await f.save(),artifact=receipt.panelPreview;
  for(const bad of [null,{}, {...artifact,path:'anything'}, {...artifact,document_id:'../outside'}, {...artifact,receipt_id:randomUUID()}, {...artifact,card_sha256:'0'.repeat(64)}, {...artifact,frontend_hash:'0'.repeat(64)}, {...artifact,revision:0}, {...artifact,revision:2}])await assert.rejects(f.read(bad));
});
test('preview cannot mint a receipt for an ordinary revision inheriting old save metadata',async t=>{
  const f=await fixture(t),first=await f.save();const changed=await f.ok('patch_text',{document_id:f.document.id,expected_revision:1,field:'description',old_text:'',new_text:'Synthetic changed description'}).catch(()=>f.ok('patch',{document_id:f.document.id,expected_revision:1,patches:[{op:'replace',path:'/data/description',value:'Synthetic changed description'}]}));
  await assert.rejects(f.read({...first.panelPreview,revision:changed.revision,card_sha256:changed.sha256}),error=>error.code==='PANEL_RECEIPT');assert((await f.read(first.panelPreview)).html);
});
test('shared copy in another valid Session does not authorize its saved chat receipt',async t=>{
  const f=await fixture(t),receipt=await f.save(),other=await f.loader.acquire(f.b,'synthetic-panel-page-B');await f.ok('open',{document_id:f.document.id},f.b,other);
  await assert.rejects(f.loader.resolveSavedPanel(f.b,{claim:other,artifact:receipt.panelPreview}),error=>error.code==='PANEL_RECEIPT');await assert.rejects(f.loader.resolveSavedPanel(f.b,{claim:f.claim,artifact:receipt.panelPreview}));
});
test('unassociated same-name card, recycled source and archived Session are unavailable',async t=>{
  const f=await fixture(t),receipt=await f.save(),read=f.service.lifecycle.read.bind(f.service.lifecycle);
  f.service.lifecycle.read=async()=>({copies:[{id:f.document.id,location:'recycled'}]});await assert.rejects(f.read(receipt.panelPreview),e=>e.code==='PANEL_RECYCLED');f.service.lifecycle.read=read;
  const associations=f.service.associations.bind(f.service);f.service.associations=async()=>({documents:[],selections:[]});await assert.rejects(f.read(receipt.panelPreview),e=>e.code==='SESSION_CARD_REQUIRED');f.service.associations=associations;
  f.loader.archived.add(f.a.id);await assert.rejects(f.read(receipt.panelPreview),e=>e.code==='SESSION_ARCHIVED');f.loader.archived.delete(f.a.id);
});
test('missing source is not replaced with current selection or similar card',async t=>{
  const f=await fixture(t),receipt=await f.save();await fs.rename(path.join(f.root,'.cardstudio-scean/documents',f.document.id),path.join(f.root,'source-missing'));assert.equal((await f.call('create',{name:'Same synthetic name'})).error.code,'SESSION_CARD_BOUND');const peer=await f.loader.acquire(f.b,'synthetic-panel-page-B');await f.ok('create',{name:'Same synthetic name'},f.b,peer);await assert.rejects(f.read(receipt.panelPreview),e=>e.code==='ENOENT');
});
test('expired lease and absent human claim are denied without creating a lease',async t=>{
  const f=await fixture(t),receipt=await f.save(),count=f.loader.records.get(f.a.id).pages.size;await assert.rejects(f.loader.resolveSavedPanel(f.a,{artifact:receipt.panelPreview}),e=>e.code==='STALE_LEASE');f.now(90001);await assert.rejects(f.read(receipt.panelPreview),e=>e.code==='STALE_LEASE');assert.equal(f.loader.records.get(f.a.id).pages.size,count);
});
test('same-Session peer lease and restarted Host can read exact saved artifact without re-association',async t=>{
  const f=await fixture(t),receipt=await f.save(),peer=await f.loader.acquire(f.a,'synthetic-panel-peer-page');assert((await f.loader.resolveSavedPanel(f.a,{claim:peer,artifact:receipt.panelPreview})).html);
  await f.loader.close();const restarted=new WorkspaceLoader({root:f.root,agentLookup:id=>f.agents.get(id),activateAddon:async()=>({dispose:async()=>{}}),serviceFactory:()=>new MaterialCardService(f.root)});await restarted.init();t.after(()=>restarted.close());const claim=await restarted.acquire(f.a,'synthetic-panel-restarted-page'),before=await hashes(f.root);await assert.rejects(restarted.resolveSavedPanel(f.a,{claim:f.claim,artifact:receipt.panelPreview}));assert((await restarted.resolveSavedPanel(f.a,{claim,artifact:receipt.panelPreview})).html);assert.deepEqual(await hashes(f.root),before);
});
test('a source becoming recycled during a read is rejected by its second lifecycle check',async t=>{
  const f=await fixture(t),receipt=await f.save(),original=f.service.savedPanelPreview.bind(f.service);f.service.savedPanelPreview=async(...args)=>{const value=await original(...args);f.service.lifecycle.read=async()=>({copies:[{id:f.document.id,location:'recycled'}]});return value;};await assert.rejects(f.read(receipt.panelPreview),error=>error.code==='PANEL_RECYCLED');
});
test('late read after scope epoch change, release or cancellation cannot return a preview',async t=>{
  for(const mode of ['epoch','lease','abort']){
    const f=await fixture(t),receipt=await f.save(),entered=deferred(),release=deferred(),original=f.service.savedPanelPreview.bind(f.service),abort=new AbortController();
    f.service.savedPanelPreview=async(...args)=>{entered.resolve();await release.promise;return original(...args);};const pending=f.loader.resolveSavedPanel(f.a,{claim:f.claim,artifact:receipt.panelPreview},abort.signal);const observed=assert.rejects(pending);await entered.promise;
    if(mode==='epoch')f.loader.records.get(f.a.id).scope.epoch++;
    else if(mode==='lease')f.now(90001);else abort.abort();release.resolve();await observed;
  }
});
test('scope mode remains readable; malformed markup/resources/restricted bindings fail saving safely',async t=>{
  const f=await fixture(t),receipt=await f.save();await f.loader.setAuthoringScope(f.a,{claim:f.claim,mode:'content',expected_epoch:0});assert((await f.read(receipt.panelPreview)).html);await f.loader.setAuthoringScope(f.a,{claim:f.claim,mode:'full',expected_epoch:1});
  for(const html of ['<script>alert(1)</script>','<img src="https://invalid.example/">','<iframe></iframe>','<div onclick="alert(1)">x</div>']){const result=await f.call('frontend',{action:'dynamic_save',document_id:f.document.id,expected_revision:1,frontend:{...clone(frontend),html}});assert.equal(result.ok,false);}
  const result=await f.call('frontend',{action:'dynamic_save',document_id:f.document.id,expected_revision:1,frontend:{...clone(frontend),bindings:[{alias:'energy',type:'string',target:{scope:'world',category:'facts',key:'secret'}}]}});assert.equal(result.ok,false);assert.equal((await f.service.load(f.document.id)).record.revision,1);
});
test('a failed optional preview reread never turns an already committed panel save into failure',async t=>{
  const f=await fixture(t),load=f.service.load.bind(f.service);let failed=false;f.service.load=async(id,revision)=>{if(revision===1&&!failed){failed=true;throw Object.assign(Error('Synthetic read failed'),{code:'SYNTHETIC_READ'});}return load(id,revision);};
  const receipt=await f.save();assert.equal(receipt.revision,1);assert.equal(receipt.panelPreviewStatus,'unavailable');assert.equal(receipt.panelPreviewError.code,'SYNTHETIC_READ');assert.equal(receipt.panelPreview,undefined);f.service.load=load;assert.equal((await f.service.load(f.document.id)).record.revision,1);
});
test('receipt byte budget trims change rows without losing save status or exact identity',()=>{
  const changes=Array.from({length:64},(_,i)=>({path:'/'+String(i)+'x'.repeat(150),op:'replace'})),receipt={id:randomUUID(),revision:1,sha256:'a'.repeat(64),changes,changeCount:64,changesOmitted:0};const value=boundPanelWriteReceipt(receipt,{panelPreviewStatus:'available',panelPreview:{schemaVersion:1,kind:'cardstudio-saved-panel',document_id:receipt.id,revision:1,card_sha256:receipt.sha256,frontend_hash:'b'.repeat(64),receipt_id:randomUUID()}});assert(Buffer.byteLength(JSON.stringify({ok:true,value,authoring_scope:{mode:'full',epoch:0,boundary:'x'.repeat(200)},selection_status:{revision:1}}))<=8192);assert.equal(value.changeCount,value.changes.length+value.changesOmitted);assert(validSavedPanelArtifact(value.panelPreview));assert.equal(receipt.changes.length,64);
});
test('only official completed successful frontend save blocks create previews; Assistant claims never do',async t=>{
  const f=await fixture(t),receipt=await f.save(),block=tool(receipt);assert.deepEqual(savedPanelFromTool(block),receipt.panelPreview);
  for(const bad of [{...block,kind:'text'},{...block,isError:true},{...block,error:{code:'denied'}},{...block,call:{...block.call,name:'other'}},tool(receipt,{action:'dynamic_preview'}),{...block,content:[{type:'text',text:JSON.stringify({ok:false,value:receipt})}]},{...block,content:[{type:'text',text:JSON.stringify({ok:true,value:{...receipt,revision:99}})}]}])assert.equal(savedPanelFromTool(bad),null);
});
test('turn-local DSH Location projection deduplicates root/subcalls without scanning other turns',async t=>{
  const f=await fixture(t),receipt=await f.save(),root=tool(receipt);root.subCalls=[tool(receipt)];const snapshot={locations:{getTurn:turn=>turn===7?['only']:[]},nodes:new Map([['only',{kind:'tool-call',data:{root}}],['unrelated',{kind:'tool-call',data:{root:tool(receipt)}}]])};assert.deepEqual(savedPanelsInTurn(snapshot,{turn:7,start:{seq:1}}),[receipt.panelPreview]);assert.equal(savedPanelsInTurn(snapshot,7),savedPanelsInTurn(snapshot,{turn:7}));assert.deepEqual(savedPanelsInTurn(snapshot,8),[]);assert.deepEqual(savedPanelsInTurn({locations:{getTurn:()=>['only']},nodes:new Map([['only',{kind:'assistant-step',data:{root}}]])},7),[]);
});
test('human resolver descriptor accepts no general action/path/HTML and is not an Agent tool',async()=>{
  const descriptor=cardstudioRemote.descriptors.find(row=>row.method==='savedPanelPreview'),parse=descriptor.parameters[1].codec.create().parse;assert(parse({claim:{},artifact:{}}));for(const extra of ['path','html','action','sessionId'])assert.throws(()=>parse({claim:{},artifact:{},[extra]:'anything'}));const toolSource=await fs.readFile(new URL('../cardstudio-bundle/lib/tool-definitions.js',import.meta.url),'utf8');assert(!toolSource.includes('savedPanelPreview'));
});
test('browser response guard preserves strict contract with separate safe failure codes',()=>{
  const artifact={schemaVersion:1,kind:'cardstudio-saved-panel',document_id:randomUUID(),revision:1,card_sha256:'a'.repeat(64),frontend_hash:'b'.repeat(64),receipt_id:randomUUID()},value={artifact,source:'authoring-initial-state-not-runtime',html:'<p>synthetic</p>'};assert.equal(savedPanelResponseError(value,artifact),null);assert.equal(savedPanelResponseError({value},artifact),'PANEL_PREVIEW_SOURCE');assert.equal(savedPanelResponseError({...value,artifact:{}},artifact),'PANEL_PREVIEW_ARTIFACT');assert.equal(savedPanelResponseError({...value,artifact:{...artifact,revision:2}},artifact),'PANEL_PREVIEW_IDENTITY');assert.equal(savedPanelResponseError({...value,html:{}},artifact),'PANEL_PREVIEW_CONTENT');
});
test('native RPC and business envelopes are each decoded once; both kinds of denial propagate',()=>{
  const value={source:'authoring-initial-state-not-runtime',html:'synthetic'};assert.equal(decodeSavedPanelResponse({ok:true,value:{ok:true,value}}),value);assert.throws(()=>decodeSavedPanelResponse({ok:false,error:{code:'STALE_LEASE'}}),error=>error.code==='STALE_LEASE');assert.throws(()=>decodeSavedPanelResponse({ok:true,value:{ok:false,error:{code:'PANEL_SESSION'}}}),error=>error.code==='PANEL_SESSION');assert.throws(()=>decodeSavedPanelResponse({ok:true,value}),error=>error.code==='PANEL_PREVIEW_RPC');
});

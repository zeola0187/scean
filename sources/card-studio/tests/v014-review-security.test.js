import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {crc32} from '../cardstudio-bundle/lib/codec.js';
import {buildPreview,sanitizeCss} from '../cardstudio-bundle/lib/preview-projection.js';
import {defaultFixture,bindFixture} from '../cardstudio-bundle/lib/authoring-fixture.js';
import {createVisualContract,validateVisualState,resolveVisualState} from '../cardstudio-bundle/lib/visual-state.js';
import {validateRaster} from '../cardstudio-bundle/lib/asset-raster.js';
import {createFrontend,inspectFrontend,readFrontend,patchFrontend} from '../cardstudio-bundle/lib/frontend-authoring.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AuthoringCardService} from '../cardstudio-bundle/lib/authoring-service.js';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';

const card=()=>({spec:'chara_card_v2',spec_version:'2.0',data:{first_mes:'Narrative before\n<section class="existing"><p>Original</p></section>',character_book:{entries:[]},extensions:{}}});
function chunk(type,data){const name=Buffer.from(type),bytes=Buffer.alloc(data.length+12);bytes.writeUInt32BE(data.length);name.copy(bytes,4);data.copy(bytes,8);bytes.writeUInt32BE(crc32(Buffer.concat([name,data])),data.length+8);return bytes;}
function tinyPng(){const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,1,2,3,255]))),chunk('IEND',Buffer.alloc(0))]);}
const contract=()=>createVisualContract({characters:{maliyah:{variants:[{expression:'neutral',assetId:'neutral_image'},{expression:'happy',assetId:'happy_image'}]},coworker:{}}});

test('review: projection removes active tags, event attrs, direct remote resources and encoded CSS resources',()=>{
 const p=buildPreview('<section><script>parent.callHost()</script><iframe src="https://evil.invalid"></iframe><svg><script>bad()</script></svg><img src="https://evil.invalid/a.png" onerror="bad()"><p onclick="bad()" style="background-color: red; width: expre&#x73;sion(bad()); color: blue">Safe</p></section>');
 assert.equal(p.sandbox,'');assert.equal(p.javascript,false);assert.equal(p.network,false);
 assert(!/<script\b|<iframe\b|<svg\b|onerror=|onclick=|src="https:/i.test(p.html));
 assert(!p.html.includes('parent.callHost'));assert(!p.html.includes('expression('));assert(p.html.includes('Safe'));
 assert(p.diagnostics.some(d=>d.code==='JAVASCRIPT_DISABLED'));
});

test('review: restricted CSS drops at-rules, escapes, resource functions and nesting',()=>{
 for(const css of ['@import "https://evil.invalid/style";','.x{background-color:url(https://evil.invalid)}','.x{width:expression(alert(1))}','.x{font-family:image-set(url(a))}','.x{color:r\\65 d}','.x{color:red}.y{.z{color:blue}}']){
  const safe=sanitizeCss(css);assert(!safe.includes('evil.invalid'));assert(!/expression|image-set|\\|@import/i.test(safe));
 }
 assert.equal(sanitizeCss('.x{display:flex;gap:8px;color:rgb(1,2,3);position:fixed}'),'.x{display:flex;gap:8px;color:rgb(1,2,3)}');
});

test('review: malformed/raw-text HTML remains inert and cannot inject a second policy or stylesheet close',()=>{
 for(const source of ['<div title="broken>Oops','<style>.x{color:red}</style><script>alert(1)</script>','<div><p>One</div></p><img src=x onerror=bad()>','<plaintext><script>bad()</script>']){
  const p=buildPreview(source);assert(!/<script\b|<plaintext\b|onerror=|<meta[^>]+http-equiv="refresh"/i.test(p.html));
  assert(p.html.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"'));
 }
});

test('review: typed fixture labels escape markup and do not change numeric values',()=>{
 const f=defaultFixture();f.bindings.affection.display='label';f.bindings.affection.label='<img src="https://evil.invalid" onerror="bad()">';
 const bound=bindFixture(f),p=buildPreview('<p>{{sample_label::affection}}</p>',{fixture:bound});
 assert.equal(bound.values.affection,42);assert(p.html.includes('&lt;img'));assert(!p.html.includes('<img src="https://evil.invalid"'));
 f.bindings.affection.display='hidden';const hidden=buildPreview('<p>{{sample::affection}}</p>',{fixture:bindFixture(f)});
 assert(!hidden.html.includes('<p>42</p>'),'hidden sample values must not be displayed');
});

test('review: valid PNG decodes; bad CRC, scanline, trailing payload, SVG and path inputs fail admission',()=>{
 const png=tinyPng();assert.equal(validateRaster(png).validation,'decoded');
 const crc=Buffer.from(png);crc[crc.length-1]^=1;assert.throws(()=>validateRaster(crc));
 assert.throws(()=>validateRaster(Buffer.concat([png,Buffer.from('<script>bad()</script>')])));
 assert.throws(()=>validateRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')));
 for(const input of ['https://evil.invalid/x.png','file:///C:/private.png','\\\\server\\share\\x.png','C:\\private.png'])assert.throws(()=>validateRaster(input));
 assert.throws(()=>validateRaster(png,{declaredType:'image/jpeg'}));
});

test('review: illegal state path, URL, unknown field/enums never reach resolver',()=>{
 const c=contract();
 for(const proposal of [{characters:{maliyah:{expression:'../happy'}}},{characters:{maliyah:{expression:'https://evil.invalid'}}},{characters:{maliyah:{assetId:'happy_image'}}},{characters:{maliyah:{selector:'#host'}}},{characters:{unknown:{expression:'happy'}}},{script:'bad()'},{characters:{maliyah:{expression:'HAPPY'}}}]){
  const result=validateVisualState(c,proposal);assert.equal(result.accepted,false);assert.equal(result.state.characters.maliyah.expression,'neutral');
 }
 const invalid=resolveVisualState(c,{characters:{maliyah:{expression:'../happy'}}},{neutral_image:{sha256:'a'.repeat(64),mediaType:'image/png'}});
 assert.equal(invalid.characters.maliyah.assetId,'neutral_image');assert.equal(invalid.characters.coworker.fallback,'placeholder');
});

test('review: state patch, reset, snapshot and stale contract/sequence preserve deterministic complete state',()=>{
 const c=contract(),one=validateVisualState(c,{sequence:1,characters:{maliyah:{expression:'happy'}}}).state;
 const two=validateVisualState(c,{sequence:2,characters:{coworker:{expression:'sad'}}},{previous:one});assert(two.accepted);assert.equal(two.state.characters.maliyah.expression,'happy');
 const reset=validateVisualState(c,{sequence:3,characters:{maliyah:null}},{previous:two.state});assert.equal(reset.state.characters.maliyah.expression,'neutral');
 assert.equal(validateVisualState(c,{sequence:2,characters:{maliyah:{expression:'angry'}}},{previous:two.state}).diagnostics[0].code,'STALE_SEQUENCE');
 assert.equal(validateVisualState(c,{contractRevision:999,characters:{maliyah:{expression:'happy'}}},{previous:one}).accepted,false);
 const snap=validateVisualState(c,{mode:'snapshot',sequence:3,characters:{maliyah:{expression:'happy'}}},{previous:two.state});assert.equal(snap.state.characters.coworker.expression,'neutral');
});

test('review: prototype state keys and ambiguous regex stable IDs fail closed',()=>{
 const c=contract();assert.equal(validateVisualState(c,JSON.parse('{"characters":{"__proto__":{"expression":"happy"}}}')).accepted,false);
 for(const scripts of [[{replaceString:'<section>A</section>'}],[{id:'duplicate',replaceString:'<section>A</section>'},{id:'duplicate',replaceString:'<section>B</section>'}]]){
  const d=card();d.data.extensions.regex_scripts=scripts;
  assert.throws(()=>createFrontend(d,{target:'regex',regex_id:scripts[0].id??'0',source:'<section>New</section>'}),undefined,'only unique admitted regex IDs may be edited');
 }
});

test('review: host fragment patch preserves surrounding narrative, source hash and distinct adjacent component identities',()=>{
 const d=card(),initial=inspectFrontend(d);const a=createFrontend(d,{target:'first_mes',source:'<section class="new"><p>New</p></section>'},[],initial.components);
 const prior=a.components.map(c=>c.component_id),inspected=inspectFrontend(a.card,a.components);
 assert.deepEqual(inspected.components.map(c=>c.component_id),prior,'reinspection must retain distinct admitted adjacent components');
 const component=a.component,patched=patchFrontend(a.card,{component_id:component.component_id,expected_source_hash:component.sourceHash,old_text:'>New<',new_text:'>Changed<'},a.components);
 assert(patched.card.data.first_mes.startsWith('Narrative before\n<section class="existing"><p>Original</p></section>'));
 assert.throws(()=>patchFrontend(a.card,{component_id:component.component_id,expected_source_hash:'0'.repeat(64),old_text:'New',new_text:'Wrong'},a.components));
 assert.throws(()=>readFrontend({...a.card,data:{...a.card.data,first_mes:'<section>Changed elsewhere</section>'}},component.component_id,a.components));
});

async function serviceFixture(fn){
 const checkout=path.resolve(fileURLToPath(new URL('..',import.meta.url))),root=await fs.mkdtemp(path.join(checkout,'test-run-v014-review-')),service=new AuthoringCardService(root);
 try{await service.init();await service.synchronizeArchiveState([]);await fn(service,root);}
 finally{await service.close();assert.equal(path.dirname(root),checkout);assert(path.basename(root).startsWith('test-run-v014-review-'));await fs.rm(root,{recursive:true,force:true});}
}
async function op(service,action,args={},sessionId='review-session'){const result=await service.operation(action,args,undefined,{sessionId});assert(result.ok,JSON.stringify(result));return result.value;}
async function createdFrontend(service){
 const d=await op(service,'create',{format:'v3',name:'Synthetic review adult clerk',first_mes:'Welcome.'});
 await op(service,'frontend',{action:'create',document_id:d.id,expected_revision:0,target:'first_mes',source:'<section><p>{{sample_label::affection}}</p><img data-character-id="maliyah"></section>'});
 const inspection=await op(service,'frontend',{action:'inspect',document_id:d.id});return {id:d.id,component_id:inspection.components[0].component_id};
}

test('review service: no-card create, joint sidecar revision and rollback remain hash-verifiable',()=>serviceFixture(async(service)=>{
 const d=await createdFrontend(service);const f=defaultFixture();f.values.affection=95;f.bindings.affection.display='label';f.bindings.affection.label='Warm';
 await op(service,'fixture',{action:'patch',document_id:d.id,expected_revision:1,fixture_id:'default',fixture:f});
 const snapshot=await service.load(d.id);assert.equal(snapshot.record.authoring.fixtures.default.values.affection,95);assert.match(snapshot.record.jointSha256,/^[a-f0-9]{64}$/);
 await op(service,'rollback',{document_id:d.id,expected_revision:2,to:1});const restored=await service.load(d.id);assert.equal(restored.record.revision,3);assert.equal(restored.record.authoring.fixtures.default.values.affection,42);
 assert.equal((await op(service,'documents')).selectedId,d.id);
 const stale=await service.operation('fixture',{action:'patch',document_id:d.id,expected_revision:2,fixture_id:'default',fixture:f},undefined,{sessionId:'review-session'});assert.equal(stale.error.code,'REVISION_CONFLICT');assert.equal((await service.load(d.id)).record.revision,3);
}));

test('review service: admitted local PNG renders and repeated increasing sequences are accepted',()=>serviceFixture(async(service)=>{
 const d=await createdFrontend(service);await op(service,'visual_contract',{action:'create',document_id:d.id,expected_revision:1,contract:{characters:{maliyah:{}}}});
 const png=tinyPng(),upload=await op(service,'asset_upload_begin',{document_id:d.id,expected_revision:2,name:'selected.png',size:png.length});
 const forged=await service.operation('asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:png.toString('base64')},undefined,{sessionId:'other-session'});assert.equal(forged.error.code,'UPLOAD_EXPIRED');
 await op(service,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:png.toString('base64')});const asset=await op(service,'asset_upload_finish',{upload_id:upload.upload_id});
 await op(service,'asset',{action:'link',document_id:d.id,expected_revision:3,asset_id:asset.asset_id,character_id:'maliyah',expression:'neutral'});
 const first=await op(service,'preview',{document_id:d.id,component_id:d.component_id,fixture_id:'default',viewport:390,state:{sequence:1,characters:{maliyah:{expression:'neutral'}}}});
 assert(first.html.includes('data:image/png;base64,'),'admitted local raster must be available to the projection');
 const second=await op(service,'preview',{document_id:d.id,component_id:d.component_id,fixture_id:'default',viewport:360,state:{sequence:2,characters:{maliyah:{expression:'happy'}}}});
 assert.equal(second.state.characters.maliyah.expression,'happy');assert(!second.diagnostics.some(d=>['SEQUENCE_MISMATCH','STALE_SEQUENCE'].includes(d.code)));
}));

test('review service: imported frontend inspection yields a readable host identity without rewriting preserved card',()=>serviceFixture(async(service,root)=>{
 const raw={spec:'chara_card_v2',spec_version:'2.0',data:{name:'Imported synthetic',description:'',personality:'',scenario:'',first_mes:'Narrative\n<section><p>Original</p></section>',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'',character_version:'1',extensions:{opaque:{keep:true}},character_book:{entries:[],extensions:{}}}};
 const bytes=Buffer.from(JSON.stringify(raw));await fs.writeFile(path.join(root,'imports/only-synthetic.json'),bytes);const d=await op(service,'import',{path:'imports/only-synthetic.json',type:'card'});
 const front=await op(service,'frontend',{action:'inspect',document_id:d.id});assert.equal(front.components.length,1);
 const read=await op(service,'frontend',{action:'read',document_id:d.id,component_id:front.components[0].component_id});assert(read.source.includes('Original'));
 assert.deepEqual(Buffer.from((await service.load(d.id)).record.bytes,'base64'),bytes,'discovery must preserve imported source bytes');
}));

test('review service: authoring snapshot tamper fails closed and never advances current revision',()=>serviceFixture(async(service,root)=>{
 const d=await op(service,'create',{name:'Synthetic tamper fixture'}),file=path.join(root,'.cardstudio-scean/documents',d.id,'0.json');
 const stored=JSON.parse(await fs.readFile(file,'utf8'));stored.authoring.fixtures.default.values.affection=99;await fs.writeFile(file,JSON.stringify(stored));
 const response=await service.operation('fixture',{action:'read',document_id:d.id,fixture_id:'default'},undefined,{sessionId:'review-session'});assert.equal(response.error.code,'VERIFY');
 assert.equal(JSON.parse(await fs.readFile(path.join(root,'.cardstudio-scean/documents',d.id,'current.json'),'utf8')).revision,0);
}));

test('review service: authoring reuse adds trusted Session ownership before exclusive archive',()=>serviceFixture(async(service)=>{
 const d=await op(service,'create',{name:'Synthetic shared ownership'});
 const unbound=await service.operation('fixture',{action:'read',document_id:d.id,fixture_id:'default'},undefined,{sessionId:'second-session'});assert.equal(unbound.error.code,'SESSION_CARD_REQUIRED');
 await op(service,'open',{document_id:d.id},'second-session');
 const forged=await service.operation('fixture',{action:'read',document_id:d.id,fixture_id:'default',sessionId:'forged'},undefined,{sessionId:'second-session'});assert.equal(forged.error.code,'AUTHORING_ARGUMENT');
 await op(service,'fixture',{action:'read',document_id:d.id,fixture_id:'default'},'second-session');
 const association=(await service.associations()).documents.find(row=>row.id===d.id);assert.deepEqual(association.sessions,['review-session','second-session']);assert(!association.sessions.includes('forged'));
 assert.equal((await service.synchronizeArchiveState(['review-session'])).moved,0);assert.equal((await service.load(d.id)).record.revision,0);
 assert.equal((await service.synchronizeArchiveState(['review-session','second-session'])).moved,1);assert.equal((await service.synchronizeArchiveState([])).moved,1);assert.equal((await service.load(d.id)).record.revision,0);
}));

test('review service: no-card create rejects full JSON and paths before writing a document',()=>serviceFixture(async(service,root)=>{
 for(const args of [{name:'Synthetic',card:{data:{}}},{name:'Synthetic',path:'../../private.json'},{name:'Synthetic',document_id:'../../private'},{name:'Synthetic',format:'charx'}]){
  const response=await service.operation('create',args,undefined,{sessionId:'review-session'});assert.equal(response.ok,false);
 }
 assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/documents')),[]);
 const response=await service.operation('create',{name:'Synthetic'},undefined,{});assert.equal(response.error.code,'SESSION');assert.deepEqual(await fs.readdir(path.join(root,'.cardstudio-scean/documents')),[]);
}));

test('review service: asset junction and arbitrary path arguments cannot write foreign data',()=>serviceFixture(async(service,root)=>{
 const d=await op(service,'create',{name:'Synthetic asset boundary'}),foreign=path.join(root,'only-synthetic-foreign');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'sentinel'),'Retain synthetic sentinel');
 const link=path.join(root,'.cardstudio-scean/documents',d.id,'assets');await fs.symlink(foreign,link,'junction');
 const png=tinyPng(),upload=await op(service,'asset_upload_begin',{document_id:d.id,expected_revision:0,name:'selected.png',size:png.length});await op(service,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:png.toString('base64')});
 const failed=await service.operation('asset_upload_finish',{upload_id:upload.upload_id},undefined,{sessionId:'review-session'});assert.equal(failed.error.code,'ASSET_PATH');assert.equal((await service.load(d.id)).record.revision,0);assert.deepEqual(await fs.readdir(foreign),['sentinel']);assert.equal(await fs.readFile(path.join(foreign,'sentinel'),'utf8'),'Retain synthetic sentinel');
 for(const value of ['../private','C:\\private.png','file:///C:/private.png','https://evil.invalid/a.png']){const refused=await service.operation('asset',{action:'import',document_id:d.id,expected_revision:0,path:value},undefined,{sessionId:'review-session'});assert.equal(refused.ok,false);}
 // Remove exactly our junction before fixture cleanup; never follow its target.
 await fs.unlink(link);
}));

test('review service: stolen upload finish/abort and stale revision cannot import bytes',()=>serviceFixture(async(service,root)=>{
 const d=await op(service,'create',{name:'Synthetic upload ownership'}),png=tinyPng(),upload=await op(service,'asset_upload_begin',{document_id:d.id,expected_revision:0,name:'selected.png',size:png.length});
 await op(service,'asset_upload_chunk',{upload_id:upload.upload_id,offset:0,base64:png.toString('base64')});
 for(const action of ['asset_upload_finish','asset_upload_abort']){
  const forged=await service.operation(action,{upload_id:upload.upload_id,sessionId:'review-session'},undefined,{sessionId:'intruder'});assert.equal(forged.error.code,action==='asset_upload_finish'?'UPLOAD_EXPIRED':'AUTHORING_ARGUMENT');
  const malformedOwner=await service.operation(action,{upload_id:upload.upload_id,sessionId:'intruder'},undefined,{sessionId:'review-session'});assert.equal(malformedOwner.error.code,'AUTHORING_ARGUMENT');
  const stolen=await service.operation(action,{upload_id:upload.upload_id},undefined,{sessionId:'intruder'});assert.equal(stolen.error.code,'UPLOAD_EXPIRED');
 }
 await op(service,'patch',{document_id:d.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Changed while uploading'}]});
 const stale=await service.operation('asset_upload_finish',{upload_id:upload.upload_id},undefined,{sessionId:'review-session'});assert.equal(stale.error.code,'REVISION_CONFLICT');
 assert.equal((await service.load(d.id)).record.revision,1);assert.equal((await op(service,'asset',{action:'list',document_id:d.id})).assets.length,0);
 assert(!await fs.stat(path.join(root,'.cardstudio-scean/documents',d.id,'assets')).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e)));
}));

test('review service: a created card without any frontend supports rollback and exact standard-card export',()=>serviceFixture(async(service,root)=>{
 const d=await op(service,'create',{name:'Synthetic card without frontend',format:'v2'}),before=Buffer.from((await service.load(d.id)).record.bytes,'base64');
 await op(service,'patch',{document_id:d.id,expected_revision:0,patches:[{op:'replace',path:'/data/first_mes',value:'Plain narrative only.'}]});
 await op(service,'rollback',{document_id:d.id,expected_revision:1,to:0});const out=await op(service,'export',{document_id:d.id,expected_revision:2,name:'plain.json'});
 assert.deepEqual(await fs.readFile(path.join(root,out.path)),before);assert.equal((await op(service,'frontend',{action:'inspect',document_id:d.id})).components.length,0);
}));

test('review loader: new APIs retain generation/lease protection and discard asset upload on workspace leave',()=>serviceFixture(async(service,root)=>{
 const agent={id:'review-lease-session',session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel:()=>assert.fail('No running model')};
 const loader=new WorkspaceLoader({root,agentLookup:id=>id===agent.id?agent:undefined,activateAddon:async()=>({dispose:async()=>{}}),serviceFactory:()=>service});await loader.init();
 try{
  const claim=await loader.acquire(agent,'review-page-001'),record=loader.records.get(agent.id);
  const forged=await loader.call(agent,record,{...claim,lease_id:'forged'},'create',{name:'Should not be created'});assert.equal(forged.error.code,'STALE_LEASE');
  const created=await loader.call(agent,record,claim,'create',{name:'Synthetic leased new card'});assert(created.ok);assert.equal(record.selected.document_id,created.value.id);
  const png=tinyPng(),upload=await loader.call(agent,record,claim,'asset_upload_begin',{document_id:created.value.id,expected_revision:0,name:'selected.png',size:png.length});assert(upload.ok);assert.equal(service.assetUploads.rows.size,1);
  await loader.release(agent,claim);assert.equal(service.assetUploads.rows.size,0);
  const late=await loader.call(agent,record,claim,'asset_upload_finish',{upload_id:upload.value.upload_id});assert.equal(late.error.code,'STALE_WORKSPACE');
  assert.equal(loader.records.size,0);assert.equal((await fs.readdir(path.join(root,'.cardstudio-scean/documents'))).length,1);
 }finally{await loader.close();}
}));

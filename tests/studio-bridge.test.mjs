import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {IsolatedStudioBridge} from '../isolated/studio-bridge.mjs';
import {pngChunk} from '../vendor/cardstudio-scean/lib/codec.js';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {MaterialCardService} from '../sources/card-studio/cardstudio-bundle/lib/material-service.js';

const card=(roster=true)=>({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic Studio keeper',description:'saved r1',personality:'Calm',scenario:'A synthetic observatory',first_mes:'Welcome to the quiet observation deck.',mes_example:'',creator_notes:'Synthetic fixture only',system_prompt:'',post_history_instructions:'',alternate_greetings:['Welcome to the synthetic harbor.'],tags:[],creator:'SCEAN synthetic test',character_version:'1',extensions:roster?{scean:{characters:[{id:'keeper',name:'Keeper',description:'A synthetic station keeper.'}]}}:{},character_book:{entries:[{id:1,keys:['lamp'],content:'A silver lamp stands on the desk.',enabled:true,insertion_order:0,extensions:{}}]}}});
const b64=value=>Buffer.from(typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value).toString('base64');
async function fixture(t,{absent=false,clock,sourceCard=card(),skipImport=false}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-studio-a-'));let calls=0;
  const host=await new SceanHost({engine:new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'rp')}),model:{generate(){calls++;throw Error('No model allowed in Studio integration');}},memory:new Memory()}),root:join(root,'host')}).init();
  const bridge=await new IsolatedStudioBridge({root:join(root,'studio'),sceanHost:absent?null:host,...clock?{now:()=>clock.value}:{}}).init();
  t.after(async()=>{await bridge.close();host.close();assert.equal(calls,0);});
  const acquired=await bridge.request({action:'studio.acquire',pageId:'studio-test-page-0001'});assert(acquired.ok,JSON.stringify(acquired));
  const claim=acquired.value.claim;
  const request=(action,args={})=>bridge.request({action:'studio.'+action,claim,...(action==='handoff'?{playerName:'Synthetic player'}:{}),...args});
  let id;if(!skipImport){const imported=await request('import',{fileName:'synthetic.json',type:'card',base64:b64(sourceCard)});assert(imported.ok,JSON.stringify(imported));id=imported.value.id;}
  return {root,bridge,host,claim,request,id};
}

test('real Studio saved revisions, worldbook/preset/roster/opening snapshot and SCEAN Inspector binding',async t=>{
  const f=await fixture(t);
  const first=await f.request('handoff',{documentId:f.id,expectedRevision:0,presetId:'scean-default',openingIndex:1});assert(first.ok,JSON.stringify(first));
  assert.equal(first.value.snapshot.revision,0);assert.equal(first.value.snapshot.characters[0].id,'keeper');assert.equal(first.value.snapshot.opening.text,card().data.alternate_greetings[0]);
  assert.equal(first.value.snapshot.worldbook.entries[0].content,card().data.character_book.entries[0].content);
  assert.equal(first.value.snapshot.source.studioBridge.scope.mode,'content');assert.equal(first.value.snapshot.source.studioBridge.presetSource,'explicit_scean_isolated_preset');
  const prior=await f.host.inspect(first.value.runId);
  const changed=await f.request('patch',{documentId:f.id,expectedRevision:0,description:'saved r2'});assert(changed.ok,JSON.stringify(changed));assert.equal(changed.value.revision,1);
  const second=await f.request('handoff',{documentId:f.id,expectedRevision:1,presetId:'scean-default'});assert(second.ok,JSON.stringify(second));assert.notEqual(second.value.runId,first.value.runId);
  assert.equal(second.value.snapshot.card.data.description,'saved r2');assert.equal(JSON.stringify(await f.host.inspect(first.value.runId)),JSON.stringify(prior));
  const inspection=await f.request('inspect',{runId:first.value.runId,binding:first.value.binding});assert(inspection.ok,JSON.stringify(inspection));assert.equal(inspection.value.snapshot.revision,0);
  const forged=await f.request('inspect',{runId:second.value.runId,binding:first.value.binding});assert.equal(forged.ok,false);assert.equal(forged.error.code,'INSPECTION_DENIED');
});

test('actual standalone worldbook read is fixed with expected revision, no fallback',async t=>{
  const f=await fixture(t);
  const book={name:'Synthetic book',entries:{'8':{uid:8,key:['harbor'],content:'Only a synthetic harbor.',disable:false,order:0}}};
  const peer=new MaterialCardService(f.bridge.root);await peer.init();t.after(()=>peer.close());await writeFile(join(f.bridge.root,'imports','worldbook.json'),JSON.stringify(book));
  const imported=await peer.operation('import',{path:'imports/worldbook.json',type:'worldbook'},undefined,{sessionId:'isolated-book-session'});assert(imported.ok,JSON.stringify(imported));
  const handed=await f.request('handoff',{documentId:f.id,expectedRevision:0,worldbookDocumentId:imported.value.id,worldbookRevision:0,presetId:'scean-default'});assert(handed.ok,JSON.stringify(handed));
  assert.equal(handed.value.snapshot.source.worldbook.kind,'saved_document');assert.equal(handed.value.snapshot.worldbook.entries['8'].content,book.entries['8'].content);
  const stale=await f.request('handoff',{documentId:f.id,expectedRevision:0,worldbookDocumentId:imported.value.id,worldbookRevision:99,presetId:'scean-default'});assert.equal(stale.error.code,'SCEAN_REVISION');
});

test('missing or stale lease/revision and implicit single-character inference are rejected',async t=>{
  const clock={value:1000},f=await fixture(t,{clock,sourceCard:card(false)});
  for(const request of [{action:'studio.read',documentId:f.id},{action:'studio.read',claim:{...f.claim,lease_id:'forged'},documentId:f.id},{action:'studio.handoff',claim:f.claim,documentId:f.id,expectedRevision:99,presetId:'scean-default'},{action:'studio.read',claim:f.claim,documentId:'foreign-document'}])assert.equal((await f.bridge.request(request)).ok,false);
  const req={documentId:f.id,expectedRevision:0,presetId:'scean-default'};
  assert.equal((await f.request('handoff',req)).error.code,'SCEAN_ROSTER_REQUIRED');
  assert.equal((await f.request('handoff',{...req,singleCharacter:true})).error.code,'STUDIO_ROSTER_SAVE_REQUIRED');
  assert.equal((await f.request('handoff',{...req,roster:card().data.extensions.scean.characters})).error.code,'STUDIO_ROSTER_SAVE_REQUIRED');
  clock.value+=90001;assert.equal((await f.request('read',{documentId:f.id})).error.code,'STALE_LEASE');
  await assert.rejects(()=>f.bridge.loader.validate({...f.bridge.agent},f.bridge.loader.records.get(f.bridge.agent.id),f.claim));
});

test('release drains authoring only; new generation explicitly reattaches the same run binding',async t=>{
  const f=await fixture(t),started=await f.request('handoff',{documentId:f.id,expectedRevision:0,presetId:'scean-default'});assert(started.ok);
  let rpAborted=false;const rpController=new AbortController();rpController.signal.addEventListener('abort',()=>rpAborted=true);f.host.running.set(started.value.runId,rpController);
  f.bridge.agent.status='running';const released=await f.request('release');assert(released.ok);assert.equal(f.bridge.authoringCancels,1);assert.equal(rpAborted,false);
  assert.equal((await f.request('read',{documentId:f.id})).ok,false);
  const next=await f.bridge.request({action:'studio.acquire',pageId:'studio-test-page-0002'});assert(next.ok);
  const old=await f.bridge.request({action:'studio.inspect',claim:next.value.claim,...started.value});assert.equal(old.error.code,'INSPECTION_DENIED');
  const attached=await f.bridge.request({action:'studio.attach',claim:next.value.claim,runId:started.value.runId,binding:started.value.binding});assert(attached.ok,JSON.stringify(attached));
  assert((await f.bridge.request({action:'studio.inspect',claim:next.value.claim,...attached.value})).ok);f.host.running.delete(started.value.runId);
});

test('SCEAN absent still imports, saves and exports through original Studio service without scope elevation',async t=>{
  const f=await fixture(t,{absent:true});
  assert.equal((await f.request('handoff',{documentId:f.id,expectedRevision:0,presetId:'scean-default'})).error.code,'SCEAN_UNAVAILABLE');
  assert((await f.request('patch',{documentId:f.id,expectedRevision:0,description:'Saved without RP service'})).ok);
  const exported=await f.request('export',{documentId:f.id,expectedRevision:1,fileName:'saved.json'});assert(exported.ok,JSON.stringify(exported));assert.equal(JSON.parse(Buffer.from(exported.value.base64,'base64')).data.description,'Saved without RP service');
  assert.equal(f.bridge.loader.records.get(f.bridge.agent.id).scope.mode,'content');
  const denied=await f.bridge.loader.call(f.bridge.agent,f.bridge.loader.records.get(f.bridge.agent.id),f.claim,'patch',{document_id:f.id,expected_revision:1,patches:[{op:'add',path:'/data/extensions/executable',value:'no'}]});assert.equal(denied.error.code,'AUTHORING_SCOPE');
});

test('accepted handoff drains to a durable receipt when authoring lease closes during Run creation',async t=>{
  const f=await fixture(t);let entered,release;
  const begun=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
  const create=f.host.createRun.bind(f.host);f.host.createRun=async args=>{entered();await hold;return create(args);};
  const pending=f.request('handoff',{documentId:f.id,expectedRevision:0,presetId:'scean-default'});await begun;
  let drained=false;const closing=f.request('release').then(result=>{drained=true;return result;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
  release();const [receipt,closed]=await Promise.all([pending,closing]);assert(receipt.ok,JSON.stringify(receipt));assert(closed.ok);
  assert.equal(receipt.value.handoffAdmission,'accepted_before_run_creation; authoring_release_drains_receipt');
  assert.equal((await f.host.inspect(receipt.value.runId)).version,0);
});

test('PNG upload uses original parser, validates CRC, rejects paths and arbitrary source filenames',async t=>{
  const f=await fixture(t,{skipImport:true}),header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('tEXt',Buffer.from('chara\0'+b64(card()))),pngChunk('IDAT',deflateSync(Buffer.from([0,0,0,0,0]))),pngChunk('IEND',Buffer.alloc(0))]);
  const imported=await f.request('import',{fileName:'safe.png',type:'card',base64:b64(png)});assert(imported.ok,JSON.stringify(imported));const saved=await f.request('read',{documentId:imported.value.id});assert.equal(saved.value.format,'png');
  assert.equal((await f.request('import',{fileName:'second.json',type:'card',base64:b64(card())})).error.code,'SESSION_CARD_BOUND');
  const unbound=await fixture(t,{skipImport:true}),corrupt=Buffer.from(png);corrupt[32]^=1;assert.equal((await unbound.request('import',{fileName:'bad.png',type:'card',base64:b64(corrupt)})).error.code,'PNG_CRC');
  for(const fileName of ['../outside.json','C:\\private.json','folder/card.json'])assert.equal((await unbound.request('import',{fileName,type:'card',base64:b64(card())})).error.code,'UPLOAD_NAME');
  assert.equal((await f.request('import',{path:'E:\\private.json',type:'card'})).error.code,'STUDIO_UPLOAD_BYTES');
  assert.equal((await f.request('export',{documentId:imported.value.id,expectedRevision:0,fileName:'../outside.json'})).error.code,'EXPORT_NAME');
});

test('vendor source closure matches recorded original hashes and contains no SDK/external imports',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../vendor/cardstudio-scean/source-manifest.json',import.meta.url),'utf8'));assert.equal(manifest.files.length,33);
  for(const row of manifest.files){const bytes=await readFile(new URL('../vendor/cardstudio-scean/'+row.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);}
});

const multiRoster=()=>[
  {id:'kalt',name:'卡爾特',description:'完整合成角色背景。卡爾特是漫遊船的航海員，說話簡短；修過舊羅盤。',identity:{gender:'男性',pronouns:'他',source:'user-explicit'},relationships:[{characterId:'lyra',description:'多年船員同伴'}],customMetadata:{origin:'synthetic-authored'}},
  {id:'lyra',name:'莉拉',description:'完整合成角色背景。莉拉負責觀測與紀錄，認識卡爾特但有自己的觀點。',identity:{pronouns:'她',source:'card-explicit'},relationships:'與卡爾特同船，但不代替他發言。'}
];
const rosterSave=(f,roster=multiRoster(),extra={})=>({documentId:f.id,expectedRevision:0,expectedScopeEpoch:f.claim.authoring_scope.epoch,authorizeRosterSave:true,roster,...extra});

test('explicit multicharacter roster saves atomically through lawful scope and fixed saved handoff',async t=>{
  const f=await fixture(t),before=await f.request('read',{documentId:f.id});
  const old=await f.request('handoff',{documentId:f.id,expectedRevision:0,presetId:'scean-default'});assert(old.ok);
  const original=await f.host.inspect(old.value.runId),scope=f.bridge.loader.records.get(f.bridge.agent.id).scope.epoch;
  const calls=[],setScope=f.bridge.loader.setAuthoringScope.bind(f.bridge.loader);
  f.bridge.loader.setAuthoringScope=async(...args)=>{calls.push(args[1].mode);return setScope(...args);};
  const saved=await f.request('patch',rosterSave(f,multiRoster(),{description:'完整多角色合成卡背景',firstMes:'新的已保存開場。'}));assert(saved.ok,JSON.stringify(saved));
  assert.equal(saved.value.revision,1);assert.equal(saved.value.rosterSaved,true);assert.equal(saved.value.scopeRestored,true);
  assert.deepEqual(calls,['full','content']);assert.equal(saved.value.claim.authoring_scope.mode,'content');assert.equal(saved.value.claim.authoring_scope.epoch,scope+2);
  const read=await f.request('read',{documentId:f.id});assert.deepEqual(read.value.roster,multiRoster());assert.equal(read.value.rosterSource,'saved_card_extension');
  assert.equal(read.value.card.data.description,'完整多角色合成卡背景');assert.equal(read.value.card.data.first_mes,'新的已保存開場。');
  assert.equal(read.value.card.data.character_version,before.value.card.data.character_version);assert.notEqual(read.value.sha256,before.value.sha256);
  const next=await f.request('handoff',{documentId:f.id,expectedRevision:1,presetId:'scean-default'});assert(next.ok,JSON.stringify(next));assert.deepEqual(next.value.snapshot.characters,multiRoster());
  assert.deepEqual(await f.host.inspect(old.value.runId),original);assert.equal(old.value.snapshot.source.studioBridge.rosterSource,'saved_card_extension');
  const exported=await f.request('export',{documentId:f.id,expectedRevision:1});assert(exported.ok);assert.deepEqual(JSON.parse(Buffer.from(exported.value.base64,'base64')).data.extensions.scean.characters,multiRoster());
});

test('roster save requires explicit authorization, current scope, revision and live lease; invalid actors never elevate',async t=>{
  const f=await fixture(t),record=f.bridge.loader.records.get(f.bridge.agent.id),epoch=record.scope.epoch;
  for(const [overrides,code] of [
    [{authorizeRosterSave:false},'STUDIO_ROSTER_AUTH_REQUIRED'],[{expectedScopeEpoch:epoch+1},'AUTHORING_SCOPE_CHANGED'],
    [{expectedRevision:10},'SCEAN_REVISION'],[{claim:{...f.claim,lease_id:'forged'}},'STALE_LEASE'],
    [{roster:[{id:'kalt',name:'Kalt',description:''}]},'ACTOR_BACKGROUND_REQUIRED'],
    [{roster:[...multiRoster(),multiRoster()[0]]},'DUPLICATE_ACTOR'],
    [{roster:[{...multiRoster()[0],identity:{gender:'male',source:'guessed'}}]},'INVALID_ACTOR_IDENTITY']
  ]){const result=await f.request('patch',rosterSave(f,multiRoster(),overrides));assert.equal(result.error?.code,code,JSON.stringify(result));assert.equal(record.scope.mode,'content');assert.equal(record.scope.epoch,epoch);}
  assert.equal((await f.request('read',{documentId:f.id})).value.revision,0);
  const result=await f.request('patch',rosterSave(f));assert(result.ok);
  assert.equal((await f.request('patch',rosterSave(f,multiRoster(),{expectedRevision:1}))).error.code,'AUTHORING_SCOPE_CHANGED');
});

test('plain card explicit roster save creates only missing parent, preserves other extensions and works without SCEAN',async t=>{
  const plain=card(false);plain.data.extensions={other:{keep:true}};const f=await fixture(t,{absent:true,sourceCard:plain});
  const saved=await f.request('patch',rosterSave(f,multiRoster()));assert(saved.ok,JSON.stringify(saved));
  const read=await f.request('read',{documentId:f.id});assert.deepEqual(read.value.card.data.extensions.other,{keep:true});assert.deepEqual(read.value.roster,multiRoster());
  const exported=await f.request('export',{documentId:f.id,expectedRevision:1});assert(exported.ok);assert.deepEqual(JSON.parse(Buffer.from(exported.value.base64,'base64')).data.extensions.other,{keep:true});
});

test('failed scoped roster patch restores content and queued page release drains successful save',async t=>{
  const f=await fixture(t),original=f.bridge.operation.bind(f.bridge);let failOnce=true;
  f.bridge.operation=async(...args)=>{if(args[1]==='patch'&&failOnce){failOnce=false;throw Object.assign(Error('synthetic failure'),{code:'INJECTED_PATCH_FAILURE'});}return original(...args);};
  const bad=await f.request('patch',rosterSave(f));assert.equal(bad.error.code,'INJECTED_PATCH_FAILURE');
  assert.equal(f.bridge.loader.records.get(f.bridge.agent.id).scope.mode,'content');assert.equal((await f.request('read',{documentId:f.id})).value.revision,0);
  let entered,release;const begun=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
  f.bridge.operation=async(...args)=>{if(args[1]==='patch'){entered();await hold;}return original(...args);};
  const current=(await f.request('renew')).value.claim;
  const pending=f.request('patch',rosterSave(f,multiRoster(),{expectedScopeEpoch:current.authoring_scope.epoch}));await begun;
  let closed=false;const closing=f.request('release').then(r=>{closed=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(closed,false);
  release();const [saved,released]=await Promise.all([pending,closing]);assert(saved.ok,JSON.stringify(saved));assert(released.ok);assert.equal(saved.value.revision,1);assert(saved.value.scopeRestored);
});


test('scope restoration failure closes authoring while returning the committed roster receipt',async t=>{
  const f=await fixture(t),setScope=f.bridge.loader.setAuthoringScope.bind(f.bridge.loader);
  f.bridge.loader.setAuthoringScope=async(...args)=>{if(args[1].mode==='content')throw Object.assign(Error('synthetic restore failure'),{code:'INJECTED_RESTORE_FAILURE'});return setScope(...args);};
  const saved=await f.request('patch',rosterSave(f));assert(saved.ok,JSON.stringify(saved));assert.equal(saved.value.revision,1);assert.equal(saved.value.scopeRestored,false);assert.equal(saved.value.authoringClosed,true);assert.equal(saved.value.claim,undefined);
  assert.equal((await f.request('read',{documentId:f.id})).error.code,'STUDIO_CLOSED');
  // Restart uses the original acquire scope transition before exposing operations.
  const next=await new IsolatedStudioBridge({root:join(f.root,'studio'),sceanHost:f.host}).init();t.after(()=>next.close());
  const acquired=await next.request({action:'studio.acquire',pageId:'studio-recovered-0001'});assert(acquired.ok);assert.equal(acquired.value.claim.authoring_scope.mode,'content');
  const recovered=await next.request({action:'studio.read',claim:acquired.value.claim,documentId:f.id});assert.equal(recovered.value.revision,1);assert.deepEqual(recovered.value.roster,multiRoster());
});

test('two pages cannot reuse the pre-save scope epoch; unknown saved metadata survives complete roster editing',async t=>{
  const f=await fixture(t),other=await f.bridge.request({action:'studio.acquire',pageId:'studio-second-page-0001'});assert(other.ok);
  const first=await f.request('patch',rosterSave(f));assert(first.ok);
  const stale=await f.bridge.request({action:'studio.patch',...rosterSave(f,multiRoster(),{expectedRevision:1,claim:other.value.claim})});assert.equal(stale.error.code,'AUTHORING_SCOPE_CHANGED');
  const read=await f.request('read',{documentId:f.id}),edited=structuredClone(read.value.roster);edited[0].description+=' Added explicit background.';
  const saved=await f.request('patch',rosterSave(f,edited,{expectedRevision:1,expectedScopeEpoch:first.value.claim.authoring_scope.epoch}));assert(saved.ok);
  const current=await f.request('read',{documentId:f.id});assert.deepEqual(current.value.roster[0].customMetadata,multiRoster()[0].customMetadata);assert.deepEqual(current.value.roster[0].relationships,multiRoster()[0].relationships);
});

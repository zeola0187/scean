import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeHost} from './helpers/current-host.js';
import {defaultFixture} from '../cardstudio-bundle/lib/authoring-fixture.js';
import * as plugin from '../cardstudio-bundle/index.js';

test('review native SDK: 24 registered tools perform bounded authoring, selection, metadata-only preview/export and reject stale capability',async()=>{
 const checkout=path.resolve(fileURLToPath(new URL('..',import.meta.url))),home=await fs.mkdtemp(path.join(checkout,'test-run-v014-native-review-'));
 const oldHome=process.env.DSH_HOME;process.env.DSH_HOME=home;let host;
 try{
  host=await nativeHost(home,plugin);const workspace=host.registry.list()[0],agent=host.agent('native-review-authoring',workspace.path),other=host.agent('native-review-other',home);
  assert.equal(host.ctx.tools.schemas(agent).length,0);
  const acquired=await host.request(agent,{action:'acquire',page_id:'native-review-page-001'});assert(acquired.ok,JSON.stringify(acquired));const claim=acquired.value;
  assert.equal(host.ctx.tools.schemas(agent).length,29);assert.equal(host.ctx.tools.schemas(other).length,0);
  const names=host.ctx.tools.schemas(agent).map(s=>s.name);for(const name of ['cardstudio_scean_create','cardstudio_scean_frontend','cardstudio_scean_fixture','cardstudio_scean_visual_contract','cardstudio_scean_asset','cardstudio_scean_preview','cardstudio_scean_document','card_read','card_patch_text','cardstudio_scean_worldbook_gate'])assert(names.includes(name));
  let callId=0;
  const execute=async(name,args)=>host.ctx.tools.execute({agent,name,arguments:args,callId:'native-review-'+(++callId),signal:new AbortController().signal});
  const invoke=async(name,args)=>{
   const result=await execute(name,args);assert.equal(result.isError,false,JSON.stringify(result));
   const text=result.content?.find(row=>row.type==='text')?.text;assert.equal(typeof text,'string',JSON.stringify(result));
   const receipt=JSON.parse(text);assert(receipt.ok,JSON.stringify(receipt));return receipt.value;
  };
  const selection=async()=>(await host.ctx.systemPrompt.assemble({scope:agent})).contexts.find(c=>c.name==='cardstudio-selection')?.text;
  assert.match(await selection(),/no working copy/);
  const created=await invoke('cardstudio_scean_create',{format:'v3',name:'Native synthetic adult clerk',description:'Only a synthetic content fixture.',first_mes:'Welcome.'});
  assert((await selection()).includes(created.id));assert(!(await selection()).includes('Only a synthetic content fixture.'));
  await invoke('cardstudio_scean_frontend',{action:'create',document_id:created.id,expected_revision:0,target:'first_mes',source:'<section class="clerk-panel"><p>{{sample_label::affection}}</p></section>'});
  const components=await invoke('cardstudio_scean_frontend',{action:'inspect',document_id:created.id}),componentId=components.components[0].component_id;
  const fragment=await invoke('cardstudio_scean_frontend',{action:'read',document_id:created.id,component_id:componentId});assert(fragment.source.includes('clerk-panel'));
  const fixture=defaultFixture();fixture.values.affection=88;fixture.bindings.affection.display='label';fixture.bindings.affection.label='Trust';
  await invoke('cardstudio_scean_fixture',{action:'patch',document_id:created.id,expected_revision:1,fixture_id:'default',fixture});
  await invoke('cardstudio_scean_visual_contract',{action:'create',document_id:created.id,expected_revision:2,contract:{characters:{clerk:{}}}});
  const contract=await invoke('cardstudio_scean_visual_contract',{action:'read',document_id:created.id});assert.equal(contract.contract.characters.clerk.expressions.length,6);
  const checked=await invoke('cardstudio_scean_visual_contract',{action:'validate',document_id:created.id,state:{characters:{clerk:{expression:'embarrassed'}}}});assert.equal(checked.accepted,true);
  const preview=await invoke('cardstudio_scean_preview',{document_id:created.id,component_id:componentId,fixture_id:'default',viewport:390,state:{sequence:1,characters:{clerk:{expression:'embarrassed'}}}});
  assert(!Object.hasOwn(preview,'html'));assert(!JSON.stringify(preview).includes('data:image'));assert(preview.projection_bytes>0);assert.equal(preview.state.characters.clerk.expression,'embarrassed');
  const rpcPreview=await host.request(agent,{action:'preview',claim,args:{document_id:created.id,component_id:componentId,fixture_id:'default',viewport:360,state:{sequence:2,characters:{clerk:{expression:'happy'}}}}});assert(rpcPreview.ok);assert(rpcPreview.value.html.includes('Trust'));assert.equal(rpcPreview.value.state.characters.clerk.expression,'happy');
  const stale=await host.request(agent,{action:'fixture',claim:{...claim,lease_id:'stale'},args:{action:'read',document_id:created.id,fixture_id:'default'}});assert.equal(stale.error.code,'STALE_LEASE');
  const exported=await invoke('cardstudio_scean_document',{action:'export_bundle',document_id:created.id,expected_revision:3,name:'native-review'});assert(exported.files.some(row=>row.name==='authoring.json'));assert.equal(exported.card,'card.json');
  const files=await fs.readdir(path.join(workspace.path,exported.path));assert(files.includes('README.txt'));assert(files.includes('authoring.json'));
  const assetList=await invoke('cardstudio_scean_asset',{action:'list',document_id:created.id});assert.deepEqual(assetList.assets,[]);
  await invoke('cardstudio_scean_target',{action:'configure',document_id:created.id,expected_revision:3,config:{profile:'tauritavern-helper-ejs-v1',namespace:'quest',fields:{event_done:{type:'boolean'}},initialState:{values:{event_done:false},characters:{clerk:{expression:'neutral'}}},source:'<p>Existing plain panel</p>'}});
  const added=await invoke('lorebook_upsert_entry',{document_id:created.id,expected_revision:4,entry:{keys:['quest'],enabled:true,constant:false,insertion_order:1,content:'Synthetic quest secret',extensions:{opaque:42}}});
  const gateRead=await invoke('cardstudio_scean_worldbook_gate',{action:'read',document_id:created.id,entry_id:added.entry_id});
  await invoke('cardstudio_scean_worldbook_gate',{action:'create',document_id:created.id,entry_id:added.entry_id,expected_revision:5,expected_source_hash:gateRead.source_hash,rule:{schemaVersion:1,predicate:{op:'eq',path:'values.event_done',value:true}}});
  const gateTrial=await invoke('cardstudio_scean_worldbook_gate',{action:'evaluate',document_id:created.id,values:{event_done:true}});
  assert.equal(gateTrial.entries.find(e=>e.entry_id===added.entry_id).status,'pass');assert.equal(gateTrial.runtimeVerified,false);
  const gateRPC=await host.request(agent,{action:'gating',claim,args:{action:'evaluate',document_id:created.id,values:{event_done:false}}});assert(gateRPC.ok);assert.equal(gateRPC.value.entries.find(e=>e.entry_id===added.entry_id).status,'fail');
  const captured=host.ctx.tools.get('cardstudio_scean_create',agent);await host.request(agent,{action:'release',claim});assert.equal(host.ctx.tools.schemas(agent).length,0);assert.equal(await selection(),undefined);
  const oldClosure=await captured.execute({name:'Should not create after release'},{agent,signal:new AbortController().signal});assert.equal(oldClosure.error.code,'STALE_WORKSPACE');
  const afterRelease=await execute('cardstudio_scean_create',{name:'Should not be visible after release'});assert.equal(afterRelease.isError,true);
 }finally{
  await host?.close();if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;
  assert.equal(path.dirname(home),checkout);assert(path.basename(home).startsWith('test-run-v014-native-review-'));await fs.rm(home,{recursive:true,force:true});
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AuthoringCardService} from '../cardstudio-bundle/lib/authoring-service.js';
import {TARGET_PROFILE,applyTarget} from '../cardstudio-bundle/lib/target-profile.js';
import {repairLoop,failureFingerprint} from '../cardstudio-bundle/lib/preflight-check.js';
import {sha} from '../cardstudio-bundle/lib/codec.js';
import {sixSyntheticRasters} from './helpers/synthetic-assets.js';
const repo=fileURLToPath(new URL('..',import.meta.url)),session='synthetic-preflight';
const rule={schemaVersion:1,predicate:{op:'gte',path:'values.progress',value:30}};
async function setup(t,target=false){
 const root=await fs.mkdtemp(path.join(repo,'test-preflight-')),s=new AuthoringCardService(root);await s.init();await s.synchronizeArchiveState([]);
 t.after(async()=>{await s.close();assert.equal(path.dirname(root),path.resolve(repo));await fs.rm(root,{recursive:true,force:true});});
 const raw=(action,args)=>s.operation(action,args,undefined,{sessionId:session}),op=async(action,args)=>{const r=await raw(action,args);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 const {id}=await op('create',{name:'Synthetic preflight',first_mes:'Preserve {{user}}'});
 const mutate=async(action,args={})=>op(action,{document_id:id,expected_revision:(await s.load(id)).record.revision,...args});
 const config={profile:TARGET_PROFILE,namespace:'test_state',fields:{progress:{type:'number',min:0,max:100}},initialState:{values:{progress:0},characters:{clerk:{expression:'neutral'}}},source:'<p>State</p>'};
 if(target){await mutate('visual_contract',{action:'create',contract:{characters:{clerk:{}}}});await mutate('target',{action:'configure',config});}
 const addGate=async()=>{await mutate('book_upsert',{entry:{keys:['key'],content:'Preserved lore {{user}}',enabled:true,insertion_order:10,extensions:{unknown:'keep'}}});const entry_id=(await s.load(id)).record.entryIds.at(-1),g=await op('gating',{action:'read',document_id:id,entry_id});await mutate('gating',{action:'create',entry_id,expected_source_hash:g.source_hash,rule});return entry_id;};
 return {root,s,id,op,raw,mutate,config,addGate};
}
async function tree(root){const result={};async function scan(p){for(const e of await fs.readdir(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())await scan(f);else result[path.relative(root,f)]=sha(await fs.readFile(f));}}await scan(root);return result;}
test('readonly check binds snapshot and all four export entries use fresh checks',async t=>{
 const {root,s,id,op,raw,mutate}=await setup(t);const before=await tree(root),c=await op('check',{document_id:id});
 assert.deepEqual(await tree(root),before);assert.equal(c.overall,'PASS');assert.equal(c.runtimeVerified,false);assert.ok(c.items.some(i=>i.severity==='NA'));assert.equal(c.revision,0);
 for(const action of ['export','export_backup','export_bundle']){const out=await mutate(action,{name:action==='export_bundle'?'bundle':action+'.json'});assert.equal(out.preflight.export_action,action);assert.equal(out.preflight.revision,0);}
 const fail=await raw('export_target',{document_id:id,expected_revision:0});assert.equal(fail.error.details.check.overall,'FAIL');assert.ok(fail.error.details.check.items.some(i=>i.code==='TARGET_MISSING'));
 await mutate('patch_text',{field:'first_mes',old_text:'Preserve',new_text:'Keep'});assert.equal((await raw('check',{document_id:id,expected_revision:c.revision})).error.code,'REVISION_CONFLICT');
 const out=await mutate('export',{name:'fresh.json'});assert.equal(out.preflight.revision,1);assert.notEqual(out.preflight.sha256,c.sha256);
 assert.equal((await raw('check',{document_id:id,patches:[]})).error.code,'AUTHORING_ARGUMENT');
});
test('target WARN is exportable, source conflict blocks without writes, backup preserves source',async t=>{
 const {root,s,id,mutate,raw}=await setup(t,true),check=await mutate('check');assert.equal(check.overall,'WARN');assert.ok(check.items.some(i=>i.code==='HOST_UNTESTED'&&i.scope==='untested'));
 const out=await mutate('export_target',{name:'warn'});assert.equal(out.preflight.exportAllowed,true);assert.equal(out.runtimeVerified,false);
 const writer=(await s.state(id)).decoded.card.data.extensions.tavern_helper.scripts[0];await mutate('target_source',{action:'patch',kind:'script',content_id:writer.id,expected_source_hash:sha(writer.content),old_text:'// Character-owned',new_text:'// Custom character-owned'});
 const before=await tree(root),rev=(await s.state(id)).record.revision,r=await raw('export_target',{document_id:id,expected_revision:rev,name:'blocked'});assert.equal(r.error.details.check.overall,'FAIL');assert.deepEqual(await tree(root),before);
 const repair=await mutate('repair');assert.equal(repair.stop,'author_required');assert.equal(repair.rounds.length,0);assert.equal((await s.state(id)).record.revision,rev);
 const backup=await mutate('export_backup',{name:'backup.json'});assert.deepEqual(await fs.readFile(path.join(root,backup.path)),Buffer.from((await s.state(id)).record.bytes,'base64'));
});
test('assets are reread on each delivery even when revision is unchanged',async t=>{
 const {root,s,id,mutate,raw}=await setup(t,true),raster=sixSyntheticRasters()[0];await s.importAsset(id,(await s.load(id)).record.revision,raster.bytes);
 await mutate('target',{action:'rebuild'});const good=await mutate('check'),a=(await s.state(id)).authoring.assetManifest.assets[0];assert.equal(good.exportAllowed,true);
 const file=path.join(root,'.cardstudio-scean/documents',id,'assets',a.sha256);await fs.rename(file,file+'.held');const bad=await mutate('check');assert.equal(bad.revision,good.revision);assert.equal(bad.overall,'FAIL');assert.ok(bad.items.some(i=>i.object.asset_id===a.assetId));
 for(const action of ['export_target','export_bundle']){const r=await raw(action,{document_id:id,expected_revision:bad.revision,name:'missing'});assert.equal(r.ok,false);assert.equal(r.error.details.check.overall,'FAIL');}
 await fs.rename(file+'.held',file);
});
test('explicit lock/unlock/relock and unknown expectations are synthetic, never runtime proof',async t=>{
 const {mutate,addGate,raw,id:docid,s}=await setup(t,true),id=await addGate(),cases=[29,30,29].map(value=>({values:{progress:value},expect:{[id]:value>=30?'pass':'fail'}}));
 cases.push({values:{progress:'30'},expect:{[id]:'unknown'}},{values:{},expect:{[id]:'unknown'}});
 const checked=await mutate('check',{cases});assert.equal(checked.counts.FAIL,0);assert.equal(checked.items.filter(i=>i.code==='CASE_EXPECTATION').length,5);assert.equal(checked.runtimeVerified,false);
 assert.ok(checked.items.some(i=>i.code==='FRESHNESS_UNTESTED'));const bad=await mutate('check',{cases:[{values:{progress:29},expect:{[id]:'pass'}}]});assert.equal(bad.overall,'FAIL');assert.ok(bad.items.some(i=>i.object.entry_id===id&&i.object.case===0));const blocked=await raw('export_target',{document_id:docid,expected_revision:(await s.load(docid)).record.revision,cases:[{values:{progress:29},expect:{[id]:'pass'}}]});assert.equal(blocked.error.details.check.overall,'FAIL');
});
test('safe rebind repairs same rule and body through snapshot chain and permits rollback',async t=>{
 const {s,id,mutate,addGate}=await setup(t,true),entry=await addGate();await mutate('target',{action:'rebuild'});
 // A visual label changes definition without changing the field used by the rule.
 let st=await s.state(id);await mutate('visual_contract',{action:'patch',changes:{characters:{clerk:{...st.authoring.contract.characters.clerk,displayName:'Updated label'}}}});await mutate('target',{action:'rebuild'});
 const before=await s.state(id),check=await mutate('check');assert.ok(check.items.some(i=>i.repair?.kind==='gate_rebind'));
 const repaired=await mutate('repair');assert.equal(repaired.stop,'complete');assert.equal(repaired.rounds.length,1);assert.equal(repaired.rounds[0].fullCheck.counts.FAIL,0);
 const after=await s.state(id);assert.deepEqual(after.authoring.gating.entries[0].rule,before.authoring.gating.entries[0].rule);assert.equal(after.record.revision,before.record.revision+1);
 assert.ok(after.decoded.card.data.character_book.entries.find(e=>e.content.endsWith('Preserved lore {{user}}')));await mutate('rollback',{to:before.record.revision});assert.deepEqual((await s.state(id)).authoring.gating,before.authoring.gating);
 assert.equal(entry,before.authoring.gating.entries[0].entryId);
});
test('host repair batches all safe Gate rebinds into one joint revision and rollback',async t=>{
 const {s,id,mutate,addGate}=await setup(t,true);for(let i=0;i<4;i++)await addGate();let st=await s.state(id);await mutate('visual_contract',{action:'patch',changes:{characters:{clerk:{...st.authoring.contract.characters.clerk,displayName:'Updated label'}}}});await mutate('target',{action:'rebuild'});
 const prior=await s.state(id),before=prior.record.revision,r=await mutate('repair');assert.equal(r.stop,'complete');assert.equal(r.rounds.length,1);assert.equal(r.rounds[0].batchSize,4);assert.equal(r.result.revision,before+1);assert.equal(r.result.counts.FAIL,0);assert.equal((await mutate('repair')).rounds.length,0);await mutate('rollback',{to:before});assert.deepEqual((await s.state(id)).authoring.gating,prior.authoring.gating);
});
test('foreign gate body is never an automatic repair',async t=>{
 const {s,id,mutate,addGate}=await setup(t,true),entry_id=await addGate();let st=await s.state(id);await mutate('target',{action:'patch',expected_source_hash:sha(st.authoring.target.config.source),old_text:'State',new_text:'Display'});const entry=st.decoded.card.data.character_book.entries.find(e=>e.content.endsWith('Preserved lore {{user}}'));
 const denied=await s.operation('book_patch',{document_id:id,expected_revision:(await s.state(id)).record.revision,entry_id,changes:{content:entry.content+'\n<% unknown() %>'}},undefined,{sessionId:session});assert.equal(denied.error.code,'GATE_MANAGED_BODY');
 // Inject external damage only in the owned synthetic fixture.
 await s.commit(id,(await s.state(id)).record.revision,card=>{card.data.character_book.entries.find(e=>e.id===entry.id).content=entry.content+'\n<% unknown() %>';},'synthetic external damage');const c=await mutate('check');assert.ok(c.counts.FAIL);assert.ok(!c.items.some(i=>i.repair));assert.equal((await mutate('repair')).stop,'author_required');
});
test('repair loop stops on repaired fingerprint recurrence or increased failures after a full check',async()=>{
 const failure=n=>({severity:'FAIL',fingerprint:failureFingerprint('X',{entry_id:n}),repair:{kind:'gate_rebind'}}),result=(revision,items)=>({revision,items,counts:{FAIL:items.length}});
 for(const [after,stop]of [[result(1,[failure('a')]),'repeated_fingerprint'],[result(1,[failure('b'),failure('c')]),'failures_increased']]){let checks=0,patches=0;const r=await repairLoop({check:async()=>++checks===1?result(0,[failure('a')]):after,patch:async()=>patches++});assert.equal(r.stop,stop);assert.equal(checks,2);assert.equal(patches,1);assert.deepEqual(r.rounds[0].fullCheck,after);}
});

test('repair loop is bounded to three full-rechecked rounds and 64 safe plans per batch',async()=>{
 let checks=0;const sizes=[];
 const r=await repairLoop({check:async()=>{const revision=checks++;return {revision,items:Array.from({length:65},(_,i)=>({severity:'FAIL',fingerprint:revision+':'+i,repair:{kind:'gate_rebind'}})),counts:{FAIL:65}};},patch:async plans=>sizes.push(plans.length)});
 assert.equal(r.stop,'round_limit');assert.equal(checks,4);assert.deepEqual(sizes,[64,64,64]);assert.equal(r.rounds.length,3);
});

test('changed referenced schema requires author review even when rule still validates',async t=>{
 const {s,id,mutate,addGate}=await setup(t,true);await addGate();const before=await s.state(id);
 await s.commit(id,before.record.revision,(card,ids,a)=>{applyTarget(card,a,{...a.target.config,fields:{progress:{type:'number',min:0,max:50}}},ids);return {authoring:true};},'synthetic authored schema change');
 const checked=await mutate('check');assert.ok(checked.items.some(i=>i.code==='GATE_STALE'));assert.ok(!checked.items.some(i=>i.repair));const revision=checked.revision;assert.equal((await mutate('repair')).stop,'author_required');assert.equal((await s.state(id)).record.revision,revision);
});
test('bad case shapes remain diagnostics and failed patch still performs a complete recheck',async t=>{
 const {mutate}=await setup(t,true);for(const cases of [{bad:true},Array.from({length:17},()=>({}))])assert.equal((await mutate('check',{cases})).overall,'FAIL');
 let checks=0;const failure={severity:'FAIL',fingerprint:'x',repair:{kind:'gate_rebind'}},r=await repairLoop({check:async()=>{checks++;return {revision:0,items:[failure],counts:{FAIL:1}};},patch:async()=>{throw Object.assign(Error('Conflicting source'),{code:'GATE_SOURCE_CONFLICT'});}});assert.equal(r.stop,'patch_failed');assert.equal(checks,2);assert.equal(r.rounds.length,1);
});

// Contract evidence only. All Sessions, cards, reviews and Runs are synthetic;
// no provider is called and no production installation is opened or modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {createWorkReview} from '../cardstudio-bundle/lib/work-review.js';
import {createSceanControl,resolveSceanSourceSession} from '../cardstudio-bundle/lib/scean-integration.js';
import {auditSavedSnapshot} from '../../../authoring/compatibility-audit.mjs';
import {DurableStore} from '../../../adapters/store.mjs';
import {ScriptStore} from '../../../core/script-store.mjs';
import {SceanEngine} from '../../../core/engine.mjs';
import {SceanHost} from '../../../plugin/host.mjs';
import {Memory} from '../../../core/memory.mjs';
import {captureRunProseStyle} from '../../../core/prose-style.mjs';

globalThis.fetch=async()=>assert.fail('No network in this contract fixture');
async function fixture(t){
 const base=resolve(import.meta.dirname,'../../../.test-data');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(join(base,'issue30-context-')),workspace=join(root,'studio');await fs.mkdir(workspace);
 const agents=new Map(['synthetic-source','synthetic-peer','synthetic-legacy-empty'].map(id=>[id,{id,status:'idle',session:{header:{cwd:workspace}},whenIdle:async()=>{},cancel(){}}]));
 const claims=new Map(),loaders=[];
 const setupLoader=async()=>{const value=new WorkspaceLoader({root:workspace,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose(){}})});await value.init();await value.setArchiveState([]);loaders.push(value);return value;};
 let loader=await setupLoader();
 const acquire=async id=>{const claim=await loader.acquire(agents.get(id),'page-'+id);claims.set(id,claim);return claim;};
 const call=async(id,action,args={})=>{const result=await loader.call(agents.get(id),loader.records.get(id),claims.get(id),action,args);assert(result.ok,JSON.stringify(result));return result.value;};
 const restart=async()=>{await loader.close();loader=await setupLoader();claims.clear();};
 t.after(async()=>{for(const value of loaders)await value.close();assert(root.startsWith(base+requireSeparator()));await fs.rm(root,{recursive:true,force:true});});
 return {root,workspace,agents,claims,acquire,call,restart,get loader(){return loader;}};
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}

test('Issue30 fixed Session binding persists across restart and rejects switching while preserving exact source return',async t=>{
 const f=await fixture(t),a='synthetic-source',b='synthetic-peer',legacy='synthetic-legacy-empty';
 for(const id of [a,b,legacy]){const claim=await f.acquire(id);assert.equal(claim.selection_status.document_id,null);}
 const first=await f.call(a,'create',{name:'Same exact name',first_mes:'First synthetic opening.'}),second=await f.call(b,'create',{name:'Same exact name',first_mes:'Second synthetic opening.'});assert.notEqual(first.id,second.id);
 const file=join(f.workspace,'.cardstudio-scean','working-copy-sessions.json'),persisted=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(persisted.selections.find(x=>x.sessionId===a).documentId,first.id);assert.equal(persisted.selections.find(x=>x.sessionId===b).documentId,second.id);
 assert.equal(persisted.selections.some(x=>x.sessionId===legacy),false);
 // The unbound chooser sees bounded names; bound All and general reads cannot cross cards.
 assert.deepEqual((await f.call(a,'documents')).items.map(x=>x.id),[first.id]);assert.deepEqual((await f.call(b,'documents')).items.map(x=>x.id),[second.id]);
 assert.deepEqual((await f.call(b,'documents',{scope:'all'})).items.map(x=>x.id),[second.id]);
 assert.deepEqual(new Set((await f.call(legacy,'documents',{scope:'all'})).items.map(x=>x.id)),new Set([first.id,second.id]));
 const rejected=await f.loader.call(f.agents.get(b),f.loader.records.get(b),f.claims.get(b),'read',{document_id:first.id});assert.equal(rejected.error.code,'SESSION_CARD_MISMATCH');
 await f.restart();
 assert.equal((await f.acquire(a)).selection_status.document_id,first.id);assert.equal((await f.acquire(b)).selection_status.document_id,second.id);assert.equal((await f.acquire(legacy)).selection_status.document_id,null);
 await f.call(legacy,'open',{document_id:first.id});assert.equal((await f.call(legacy,'documents')).selectedId,first.id);assert.equal((await f.call(a,'documents')).selectedId,first.id);
 const scope={provider:'@local/dsh-card-studio-scean-test',cardId:first.id};
 await f.loader.release(f.agents.get(a),f.claims.get(a));assert.equal(f.loader.records.has(a),false);assert.equal((await resolveSceanSourceSession(f.loader,a,scope)).available,true);assert.equal(f.loader.records.has(a),false);
 await f.acquire(a);const switchResult=await f.loader.call(f.agents.get(a),f.loader.records.get(a),f.claims.get(a),'open',{document_id:second.id});assert.equal(switchResult.error.code,'SESSION_CARD_BOUND');
 assert.equal((await f.call(a,'documents')).selectedId,first.id);assert.equal((await f.call(b,'documents')).selectedId,second.id);assert.equal((await f.call(legacy,'documents')).selectedId,first.id);
 assert.equal((await resolveSceanSourceSession(f.loader,a,scope)).available,true);assert.equal((await resolveSceanSourceSession(f.loader,legacy,scope)).available,true);
 const fixed=JSON.parse(await fs.readFile(file,'utf8'));assert(fixed.documents.find(x=>x.id===first.id).sessions.includes(a));assert(!fixed.documents.find(x=>x.id===second.id).sessions.includes(a));
 await f.restart();assert.equal((await f.acquire(a)).selection_status.document_id,first.id);
 await f.call(a,'open',{document_id:first.id});assert.equal((await resolveSceanSourceSession(f.loader,a,scope)).available,true);
 assert.equal((await f.call(a,'read',{document_id:first.id})).revision,first.revision);
 assert.equal((await f.call(a,'documents')).selectedId,first.id);
});

test('human Preset service preserves binding, existing scope, reload, explicit receipts and same-card multi-Session CAS without a SCEAN Host',async t=>{
 const f=await fixture(t),a='synthetic-source',b='synthetic-peer',c='synthetic-legacy-empty';
 for(const id of [a,b,c])await f.acquire(id);
 const first=await f.call(a,'create',{name:'Same name'}),other=await f.call(b,'create',{name:'Same name'});
 await f.call(c,'open',{document_id:first.id});
 let control=createSceanControl(f.loader,()=>null);
 const request=(id,mode,args={})=>control(f.agents.get(id),{claim:f.claims.get(id),mode,document_id:first.id,...args});
 const original=await request(a,'presetRead');assert.equal(original.saved,false);assert.equal(original.revision,0);
 await assert.rejects(fs.stat(join(f.workspace,'.cardstudio-scean','presets')),{code:'ENOENT'});
 const preset={id:'shared',revision:99,instructions:'First saved text',extra:{keep:null}},save={preset,expected_revision:first.revision,expected_preset_revision:0,operation_id:'independent-save-0001'};
 await assert.rejects(request(b,'presetRead'),{code:'SESSION_CARD_MISMATCH'});
 await assert.rejects(request(b,'presetSave',save),{code:'SESSION_CARD_MISMATCH'});
 await assert.rejects(request(a,'presetSave',{...save,expected_revision:999}),{code:'SCEAN_REVISION'});
 const stored=await request(a,'presetSave',save);assert.equal(stored.revision,1);assert.equal(stored.receipt.operationId,save.operation_id);
 assert.deepEqual((await request(c,'presetRead')).preset,preset);
 assert.equal((await request(a,'presetStatus',{operation_id:save.operation_id})).status,'committed');
 assert.equal((await request(a,'presetStatus',{operation_id:'independent-never-committed'})).status,'not_committed');
 await f.restart();await f.acquire(a);await f.acquire(b);await f.acquire(c);control=createSceanControl(f.loader,()=>null);
 assert.deepEqual((await request(a,'presetRead')).preset,preset);
 const next={...preset,instructions:'Second Session saved text'};
 await request(c,'presetSave',{...save,preset:next,expected_preset_revision:1,operation_id:'independent-save-0002'});
 await assert.rejects(request(a,'presetSave',{...save,preset:{...preset,instructions:'Stale draft'},expected_preset_revision:1,operation_id:'independent-stale-0003'}),{code:'PRESET_REVISION_CONFLICT'});
 const replay=await request(a,'presetSave',save);assert.equal(replay.replayed,true);assert.equal(replay.receipt.revision,1);assert.equal(replay.revision,2);assert.deepEqual(replay.preset,next);
 assert.equal((await f.call(a,'read',{document_id:first.id})).revision,first.revision);
 assert.equal((await f.call(b,'read',{document_id:other.id})).revision,other.revision);
 assert.equal((await control(f.agents.get(b),{claim:f.claims.get(b),mode:'presetRead',document_id:other.id})).saved,false);
 const r=f.loader.records.get(a);await f.loader.setAuthoringScope(f.agents.get(a),{claim:f.claims.get(a),mode:'content',expected_epoch:r.scope.epoch});
 assert.equal((await request(a,'presetRead')).revision,2);
 await assert.rejects(request(a,'presetSave',{...save,expected_preset_revision:2,operation_id:'independent-scope-denied'}),{code:'AUTHORING_SCOPE'});
 await f.loader.release(f.agents.get(a),f.claims.get(a));
 await assert.rejects(request(a,'presetRead'),{code:'STALE_WORKSPACE'});
});

test('Issue30 full Preset saves independently before review and immutable Script; Run prose style has separate versions and pins',async t=>{
 const f=await fixture(t),owner='synthetic-source';await f.acquire(owner);
 const card=await f.call(owner,'create',{name:'Preset fixture',description:'Synthetic keeper source.',first_mes:'The gate opens.'});
 const bound=await f.call(owner,'scean_character',{document_id:card.id,expected_revision:card.revision,character:{id:'keeper',name:'Keeper',description:'Synthetic keeper.'},sources:[{kind:'card_field',path:'/data/description'}]});
 const before=await f.call(owner,'read',{document_id:card.id});
 const store=new DurableStore({root:join(f.root,'runs')}),engine=new SceanEngine({store,model:{generate(){assert.fail('No model call in this fixture');}},memory:new Memory()}),host=await new SceanHost({engine,root:join(f.root,'host')}).init();t.after(()=>host.close());
 const review=createWorkReview(f.loader),control=createSceanControl(f.loader,()=>({auditSavedSnapshot,startFromStudio:host.startFromStudio.bind(host),inspectFromStudio:host.inspectFromStudio.bind(host),publishFromStudio:host.publishFromStudio.bind(host)}),review);
 const preset={id:'synthetic-complete-preset',revision:7,instructions:'Preserve exact multiline instructions.\nSecond line.',style:'Measured prose.',nested:{order:['first','second'],enabled:false,threshold:0},unknown_extension:{preserve:'untouched'}};
 const args={claim:f.claims.get(owner),document_id:card.id,expected_revision:bound.revision,preset};
 const savedPreset=await control(f.agents.get(owner),{...args,mode:'presetSave',expected_preset_revision:0,operation_id:'synthetic-preset-save-first'});assert.equal(savedPreset.revision,1);assert.equal(savedPreset.receipt.status,'committed');args.expected_preset_revision=1;
 assert.deepEqual((await createSceanControl(f.loader,()=>null)(f.agents.get(owner),{claim:args.claim,mode:'presetRead',document_id:card.id})).preset,preset);
 const prepare=()=>control(f.agents.get(owner),{...args,mode:'prepare'});
 const tool=value=>review.call(f.agents.get(owner),f.loader.records.get(owner),{document_id:card.id,expected_revision:bound.revision,...value});
 async function complete(){const begin=(await tool({action:'begin'})).value,id={review_id:begin.reviewId,fingerprint:begin.evidenceFingerprint};let offset=0;do{offset=(await tool({action:'read',...id,offset})).value.nextOffset;}while(offset!==null);return (await tool({action:'complete',...id,verdict:'pass',summary:'Synthetic workflow evidence only, not model quality.',issues:[]})).value;}
 const pending=await prepare();assert.equal(pending.prepared,false);assert.equal((await host.scripts.list()).length,0);
 const ledgerFile=join(f.workspace,'.cardstudio-scean','work-reviews',createHash('sha256').update(owner).digest('hex')+'.json');
 assert.deepEqual(JSON.parse(await fs.readFile(ledgerFile,'utf8')).snapshot.preset,preset);
 assert.deepEqual(await f.call(owner,'read',{document_id:card.id}),before);
 const checked=await complete(),first=await control(f.agents.get(owner),{...args,mode:'publish',request_id:'synthetic-preset-publication-first'});
 const record=await new ScriptStore({root:join(f.root,'host')}).read(first.scriptId);assert.deepEqual(record.snapshot.preset,preset);assert.equal(record.snapshot.source.preset.kind,'working_card_preset');assert.equal(record.snapshot.source.preset.revision,1);assert.equal(record.review.receiptId,checked.receiptId);
 assert.deepEqual(await f.call(owner,'read',{document_id:card.id}),before);
 const run=await engine.createRun({snapshot:record.snapshot}),originalRun=await store.read(run.runId);
 const style=await engine.updateProseStyle({runId:run.runId,text:'A different per-Run prose style.',expectedRevision:0,operationId:'synthetic-style-first'}),pin=await captureRunProseStyle(store,style);
 assert.equal(style.revision,1);assert.equal(pin.revision,1);assert.equal(pin.text,style.text);assert.deepEqual(await store.read(run.runId),originalRun);assert.deepEqual(originalRun.snapshot.preset,preset);
 await assert.rejects(engine.updateProseStyle({runId:run.runId,text:'Stale replacement.',expectedRevision:0,operationId:'synthetic-style-stale'}),{code:'VERSION_CONFLICT'});
 const nextStyle=await engine.updateProseStyle({runId:run.runId,text:'New request style.',expectedRevision:1,operationId:'synthetic-style-next'});assert.equal(nextStyle.revision,2);assert.equal(pin.text,style.text);assert.deepEqual((await store.read(run.runId)).snapshot.preset,preset);
 // Preset revision is author payload, not an independent CAS counter: changing
 // content with the same id/revision still invalidates review by exact hash.
 args.preset={...preset,instructions:'Changed complete Preset, same declared revision.'};await assert.rejects(prepare(),{code:'PRESET_UNSAVED'});await control(f.agents.get(owner),{...args,mode:'presetSave',operation_id:'synthetic-preset-save-second'});args.expected_preset_revision=2;await assert.rejects(tool({action:'status'}),{code:'REVIEW_STALE'});const changed=await prepare();assert.equal(changed.prepared,false);assert.notEqual(changed.review.evidenceFingerprint,checked.evidenceFingerprint);
 await complete();await assert.rejects(control(f.agents.get(owner),{...args,mode:'publish',request_id:'synthetic-preset-publication-first'}),{code:'SCRIPT_REQUEST_CONFLICT'});
 const second=await control(f.agents.get(owner),{...args,mode:'publish',request_id:'synthetic-preset-publication-second'});assert.notEqual(second.scriptHash,first.scriptHash);assert.deepEqual((await host.scripts.read(first.scriptId)).snapshot.preset,preset);assert.deepEqual((await host.scripts.read(second.scriptId)).snapshot.preset,args.preset);
 assert.deepEqual((await store.read(run.runId)).snapshot.preset,preset);assert.deepEqual(await f.call(owner,'read',{document_id:card.id}),before);
});

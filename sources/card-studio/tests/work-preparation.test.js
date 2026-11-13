import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import {WorkspaceLoader} from '../cardstudio-bundle/lib/loader.js';
import {createWorkReview} from '../cardstudio-bundle/lib/work-review.js';
import {createSceanControl,resolveSceanSourceSession} from '../cardstudio-bundle/lib/scean-integration.js';
import {auditSavedSnapshot} from '../../../authoring/compatibility-audit.mjs';
import {cardstudioRemote} from '../cardstudio-bundle/lib/bridge-protocol.js';

globalThis.fetch=async()=>assert.fail('Offline synthetic test only; no model calls');
test('actual RPC codec admits preparation/publication and refuses caller-supplied review claims',()=>{
 const descriptor=cardstudioRemote.descriptors.find(row=>row.method==='sceanControl');
 const parse=descriptor.parameters.find(row=>row.name==='request').codec.create().parse;
 const claim={page_id:'synthetic'},base={claim,document_id:'synthetic-card',expected_revision:1};
 assert.equal(parse({...base,mode:'prepare'}).mode,'prepare');
 assert.equal(parse({...base,mode:'publish',request_id:'synthetic-request-001'}).mode,'publish');
 assert.equal(parse({claim,mode:'prepareStatus',request_id:'synthetic-request-001'}).mode,'prepareStatus');
 assert.throws(()=>parse({...base,mode:'publish',request_id:'synthetic-request-001',review:{status:'completed'}}));
 assert.throws(()=>parse({...base,mode:'publish',request_id:'bad'}));
 assert.throws(()=>parse({...base,mode:'prepare',path:'arbitrary'}));
});
async function fixture(t){
 const base=join(process.cwd(),'.test-data','work-review');await fs.mkdir(base,{recursive:true});
 const root=await fs.mkdtemp(join(base,'studio-'));
 const agents=new Map(['synthetic-A','synthetic-B'].map(id=>[id,{id,session:{header:{cwd:root}},status:'idle',whenIdle:async()=>{},cancel(){}}]));
 const loader=new WorkspaceLoader({root,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose:async()=>{}})});
 await loader.init();await loader.setArchiveState([]);t.after(()=>loader.close());
 const agent=agents.get('synthetic-A'),claim=await loader.acquire(agent,'synthetic-work-page-001');
 const call=async(action,args={})=>{const value=await loader.call(agent,loader.records.get(agent.id),claim,action,args);assert(value.ok,JSON.stringify(value));return value.value;};
 const created=await call('create',{name:'Synthetic work',description:'A synthetic keeper. '+('Setting sentence. '.repeat(700)),first_mes:'A synthetic opening.'});
 const char=await call('scean_character',{document_id:created.id,expected_revision:created.revision,character:{id:'keeper',name:'Keeper',description:'A synthetic keeper.'},sources:[{kind:'card_field',path:'/data/description'}]});
 const review=createWorkReview(loader),publications=[];
 const service={startFromStudio:()=>assert.fail('Preparation cannot create a Run'),inspectFromStudio:async()=>({}),auditSavedSnapshot,publishFromStudio:async payload=>{publications.push(structuredClone({...payload,signal:undefined}));return {scriptId:'script-synthetic',scriptHash:'f'.repeat(64),cardId:payload.snapshot.cardId,revision:payload.snapshot.revision,receipt:{status:'committed',requestId:payload.requestId}};},scriptStatusFromStudio:async({requestId})=>({status:publications.some(p=>p.requestId===requestId)?'committed':'not_committed'})};
 const control=createSceanControl(loader,()=>service,review);
 const request={claim,document_id:created.id,expected_revision:char.revision,request_id:'synthetic-publish-request-001'};
 const tool=args=>review.call(agent,loader.records.get(agent.id),{document_id:created.id,expected_revision:char.revision,...args});
 return {root,loader,agents,agent,claim,call,created,revision:char.revision,review,control,request,tool,publications};
}
async function cover(f){
 const begin=(await f.tool({action:'begin'})).value,identity={review_id:begin.reviewId,fingerprint:begin.evidenceFingerprint};
 let offset=0,pages=0;
 do{const page=(await f.tool({action:'read',...identity,offset})).value;assert(Buffer.byteLength(JSON.stringify(page))<8192);offset=page.nextOffset;pages++;}while(offset!==null);
 assert(pages>1);return identity;
}
test('real saved card + audit + bounded review gates publication; fixture conclusion is not AI quality evidence',async t=>{
 const f=await fixture(t),prepared=await f.control(f.agent,{...f.request,mode:'prepare'});
 assert.equal(prepared.prepared,false);assert.equal(prepared.review.status,'pending');assert.equal(prepared.checks.audit.limits.modelsInvoked,0);assert.equal(f.publications.length,0);
 await assert.rejects(f.control(f.agent,{...f.request,mode:'publish'}),{code:'SCEAN_REVIEW_PENDING'});
 const begin=(await f.tool({action:'begin'})).value,id={review_id:begin.reviewId,fingerprint:begin.evidenceFingerprint};
 await assert.rejects(f.tool({action:'complete',...id,verdict:'pass',summary:'Synthetic fixture, not model evaluation.',issues:[]}),{code:'REVIEW_INCOMPLETE'});
 await assert.rejects(f.tool({action:'read',...id,offset:1800}),{code:'REVIEW_COVERAGE'});
 await assert.rejects(f.tool({action:'read',...id,review_id:'forged',offset:0}),{code:'REVIEW_IDENTITY'});
 const completeIdentity=await cover(f);
 await assert.rejects(f.tool({action:'complete',...completeIdentity,verdict:'pass',summary:'x'.repeat(1001),issues:[]}),{code:'REVIEW_CONCLUSION'});
 await assert.rejects(f.tool({action:'complete',...completeIdentity,verdict:'pass',summary:'Synthetic.',issues:['Unresolved.']}),{code:'REVIEW_CONCLUSION'});
 const receipt=(await f.tool({action:'complete',...completeIdentity,verdict:'pass',summary:'Synthetic conclusion tests the workflow only; no AI quality claim.',issues:[]})).value;
 assert.equal(receipt.coverage,'complete');assert.equal(receipt.modelQualityVerified,false);
 const again=await f.control(f.agent,{...f.request,mode:'prepare'});assert.equal(again.prepared,true);assert.equal(again.review.receiptId,receipt.receiptId);
 const published=await f.control(f.agent,{...f.request,mode:'publish'});assert.equal(published.receipt.status,'committed');assert.equal(f.publications.length,1);assert.equal(f.publications[0].review.snapshotHash,f.publications[0].snapshot.hash);
 const restored=createWorkReview(f.loader);assert.equal((await restored.call(f.agent,f.loader.records.get(f.agent.id),{action:'status',document_id:f.created.id,expected_revision:f.revision})).value.receiptId,receipt.receiptId);
 const preset={id:'custom',revision:2,instructions:'Changed full Preset'};await f.control(f.agent,{...f.request,mode:'presetSave',expected_preset_revision:0,operation_id:'synthetic-preset-save-001',preset});const changed=await f.control(f.agent,{...f.request,mode:'prepare',expected_preset_revision:1,preset});assert.equal(changed.prepared,false);assert.notEqual(changed.review.evidenceFingerprint,receipt.evidenceFingerprint);
});
test('review refuses revision drift, another Session and another selected card',async t=>{
 const f=await fixture(t);await f.control(f.agent,{...f.request,mode:'prepare'});const identity=await cover(f);
 const b=f.agents.get('synthetic-B'),bClaim=await f.loader.acquire(b,'synthetic-work-page-002');
 await f.loader.call(b,f.loader.records.get(b.id),bClaim,'open',{document_id:f.created.id});
 await assert.rejects(f.review.call(b,f.loader.records.get(b.id),{action:'read',document_id:f.created.id,expected_revision:f.revision,...identity,offset:0}),{code:'REVIEW_TARGET'});
 const denied=await f.loader.call(f.agent,f.loader.records.get(f.agent.id),f.claim,'create',{name:'Other synthetic card'});assert.equal(denied.ok,false);assert.equal(denied.error.code,'SESSION_CARD_BOUND');
 await assert.rejects(f.review.call(f.agent,f.loader.records.get(f.agent.id),{action:'read',document_id:'another-card',expected_revision:f.revision,...identity,offset:0}),{code:'REVIEW_STALE'});
 await f.call('patch',{document_id:f.created.id,expected_revision:f.revision,patches:[{op:'replace',path:'/data/first_mes',value:'Changed opening.'}]});
 await assert.rejects(f.tool({action:'read',...identity,offset:0}),{code:'REVIEW_STALE'});
});
test('external worldbook revision, changed scope and lease lifetime invalidate pending review',async t=>{
 const f=await fixture(t);
 await fs.writeFile(join(f.root,'imports','synthetic-world.json'),JSON.stringify({entries:[{id:1,keys:['city'],content:'Synthetic city condition.',enabled:true,insertion_order:1,extensions:{}}],extensions:{}}));
 const b=f.agents.get('synthetic-B'),claim=await f.loader.acquire(b,'worldbook-edit-page-003');
 const imported=await f.loader.call(b,f.loader.records.get(b.id),claim,'import',{path:'imports/synthetic-world.json',type:'worldbook'});assert(imported.ok,JSON.stringify(imported));const book=imported.value;
 const request={...f.request,mode:'prepare',worldbook_document_id:book.id,worldbook_revision:book.revision};
 await assert.rejects(f.control(f.agent,{...request,worldbook_document_id:f.created.id,worldbook_revision:f.revision}),{code:'SCEAN_WORLDBOOK'});
 await f.control(f.agent,request);const identity=await cover(f);
 // A second human Session edits the dependency while this card stays selected.
 const changed=await f.loader.call(b,f.loader.records.get(b.id),claim,'book_patch',{document_id:book.id,expected_revision:book.revision,entry_id:'id:1',changes:{content:'Changed synthetic city.'}});assert(changed.ok,JSON.stringify(changed));
 await assert.rejects(f.tool({action:'complete',...identity,verdict:'pass',summary:'Synthetic.',issues:[]}),{code:'REVIEW_STALE'});
 await f.control(f.agent,{...request,worldbook_revision:changed.value.revision});
 await f.loader.setAuthoringScope(f.agent,{claim:f.claim,mode:'content',expected_epoch:f.claim.authoring_scope.epoch});
 await assert.rejects(f.tool({action:'begin'}),{code:'REVIEW_SCOPE'});
 await f.loader.release(f.agent,f.claim);
 await assert.rejects(f.review.call(f.agent,f.loader.records.get(f.agent.id),{action:'begin',document_id:f.created.id,expected_revision:f.revision}),{code:'STALE_WORKSPACE'});
});
test('saved summary counts preserve opening indices and preparation invalidates every authoring input',async()=>{
 const source=await fs.readFile(new URL('../cardstudio-bundle/client-template.js',import.meta.url),'utf8'),code=source.split('/* WORK_PREPARATION_STATE_START */')[1].split('/* WORK_PREPARATION_STATE_END */')[0];
 const context=vm.createContext({});vm.runInContext(code+';globalThis.api={workPreparationKey,savedWorkContents,workPreparationCurrent,workPublicationCurrent};',context);
 const {workPreparationKey:key,savedWorkContents:contents,workPreparationCurrent:current}=context.api;
 const doc={id:'x',revision:1,sha256:'a',card:{data:{first_mes:' ',alternate_greetings:['A','','B'],character_book:{entries:[{id:1,enabled:false},{id:2}]},extensions:{scean:{characters:[{id:'a'},{id:'b'}]}}}}};
 const counts=contents(doc);assert.equal(counts.characters.length,2);assert.equal(counts.settings.length,2);assert.deepEqual(Array.from(counts.openings,o=>o.index),[1,3]);assert.equal(contents(null).openings.length,0);
 const v={doc,sceanCharacters:'[]',sceanCharactersRevision:1};v.workPreparation={prepared:true,key:key(v)};assert(current(v));
 for(const patch of [{doc:{...doc,revision:2}},{sceanPreset:'{}'},{sceanCharacters:'[{}]'},{sceanCharactersRevision:2},{sceanWorldbook:'b'},{sceanWorldbookRevision:2}])assert.equal(current({...v,...patch}),false);
 assert(source.includes("sandbox:''"));assert(!source.includes("title:'Card Studio SCEAN Test'"));
});
test('source conversation lookup needs no live lease and grants none',async t=>{
 const f=await fixture(t),scope={provider:'@local/dsh-card-studio-scean-test',cardId:f.created.id};
 await f.loader.release(f.agent,f.claim);assert.equal(f.loader.records.has(f.agent.id),false);
 assert.equal((await resolveSceanSourceSession(f.loader,f.agent.id,scope)).available,true);assert.equal(f.loader.records.has(f.agent.id),false);
 assert.equal((await resolveSceanSourceSession(f.loader,'missing',scope)).available,false);
 assert.equal((await resolveSceanSourceSession(f.loader,f.agent.id,{...scope,cardId:'other'})).available,false);
 f.loader.archived.add(f.agent.id);assert.equal((await resolveSceanSourceSession(f.loader,f.agent.id,scope)).available,false);
});

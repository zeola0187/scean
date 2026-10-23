import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {WorkspaceLoader} from '../sources/card-studio/cardstudio-bundle/lib/loader.js';
import {buildSavedSnapshot,createSceanControl,resolveSceanCardContext} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {createSceanDiagnosis} from '../sources/card-studio/cardstudio-bundle/lib/scean-diagnosis.js';
import {toolSpecs} from '../sources/card-studio/cardstudio-bundle/lib/tool-definitions.js';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
import {clearEditIntent} from '../sources/card-studio/cardstudio-bundle/lib/diagnosis-consent.js';

export const syntheticCard=()=>({spec:'chara_card_v3',spec_version:'3.0',data:{name:'同名合成卡',description:'Independent; she may disagree.',personality:'Independent and kind.',scenario:'Synthetic station.',first_mes:'A lamp is on the desk.',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:['A new synthetic scene.'],group_only_greetings:[],tags:[],creator:'offline QA',character_version:'1',extensions:{scean:{characters:[{id:'keeper',name:'Keeper',description:'Independent station keeper.'}]}},character_book:{entries:[{id:1,keys:['lamp'],content:'A silver lamp.',enabled:true,insertion_order:0,extensions:{}},{id:2,keys:['unmatched'],content:'Unmatched background.',enabled:true,insertion_order:1,extensions:{}}]}}});
export async function fixture(t){
  const base=new URL('../.test-data/',import.meta.url);await mkdir(base,{recursive:true});const root=await mkdtemp(new URL('w02-',base));
  const clock={value:100000},calls=[];
  const model={async generate(args){calls.push(args.stage);if(args.stage==='director')return {text:'Observe independently.'};if(['draft','prose'].includes(args.stage))return {text:'She disagreed and inspected the lamp.'};if(args.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};throw Error('Unexpected offline stage '+args.stage);}};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),model,memory:new Memory()});
  const host=await new SceanHost({engine,root:join(root,'host'),now:()=>clock.value}).init();
  const workspace=join(root,'studio');await mkdir(workspace);
  const agent={id:'w02-session',status:'idle',session:{header:{cwd:workspace},snapshotEvents:()=>[]},whenIdle:async()=>{},cancel(){}};
  const agents=new Map([[agent.id,agent]]);
  const loader=new WorkspaceLoader({root:workspace,agentLookup:id=>agents.get(id),activateAddon:async()=>({dispose(){}}),now:()=>clock.value});
  await loader.init();await loader.setArchiveState([]);const claim=await loader.acquire(agent,'w02-human-page'),r=loader.records.get(agent.id);
  t?.after(async()=>{await loader.close();await host.close();});
  const runtime={startFromStudio:q=>host.startFromStudio(q),inspectFromStudio:q=>host.inspectFromStudio(q),listDiagnosticRuns:q=>host.agentDiagnostics.list(q),grantAgentDiagnosis:q=>host.agentDiagnostics.issue(q),readAgentDiagnosis:q=>host.agentDiagnostics.read(q),revokeAgentDiagnosis:q=>host.agentDiagnostics.revoke(q)};
  const diagnosis=createSceanDiagnosis(loader,()=>runtime),control=createSceanControl(loader,()=>runtime);
  const invoke=(action,args={},human=true)=>loader.call(agent,r,human?claim:null,action,args);
  const importCard=async(name='synthetic')=>{await writeFile(join(workspace,'imports',name+'.json'),JSON.stringify(syntheticCard()));const imported=await invoke('import',{path:'imports/'+name+'.json',type:'card'});assert(imported.ok,JSON.stringify(imported));return imported.value.id;};
  const id=await importCard();
  const saved=async()=>{const value=await invoke('read',{document_id:id});assert(value.ok,JSON.stringify(value));return value.value;};
  const scope=()=>resolveSceanCardContext(loader,agent.id);
  const start=async(requestId='w02-handoff-00000001')=>{
    const current=await saved(),offer=await control(agent,{claim,mode:'start',document_id:id,expected_revision:current.revision,request_id:requestId});
    if(offer.runId)return offer;
    const s=await scope(),o=host.openings.get(s),choice={offerId:o.offerId,cardId:o.cardId,revision:o.revision,snapshotHash:o.snapshotHash,openingIndex:0,playerName:'Synthetic tester'};
    return host.openings.start(choice,s,scope);
  };
  const grant=(runId,args={})=>diagnosis.human(agent,{claim,mode:'diagnosis_grant',runId,...args});
  const tool=args=>diagnosis.call(agent,r,args);
  const human=args=>diagnosis.human(agent,{claim,...args});
  const newSession=async sessionId=>{
    const peer={...agent,id:sessionId};agents.set(peer.id,peer);const peerClaim=await loader.acquire(peer,sessionId+'-page'),record=loader.records.get(peer.id);
    return {agent:peer,r:record,claim:peerClaim,invoke:(action,args={},human=true)=>loader.call(peer,record,human?peerClaim:null,action,args),
      human:args=>diagnosis.human(peer,{claim:peerClaim,...args}),tool:args=>diagnosis.call(peer,record,args)};
  };
  return {root,workspace,clock,calls,engine,host,loader,agent,r,claim,id,invoke,importCard,saved,scope,start,grant,tool,human,control,runtime,diagnosis,newSession};
}

test('C2 binding rejects invalid Runtime identity/relationships before any saved revision and preserves metadata',async t=>{
 const f=await fixture(t),before=await f.saved(),valid={id:'keeper',name:'Keeper',description:'Independent station keeper.',customMetadata:{kept:true},relationships:{peer:{trust:2}}},args={document_id:f.id,expected_revision:before.revision,sources:[{kind:'card_field',path:'/data/description'}]};
 for(const character of [{...valid,identity:'string'},{...valid,identity:{source:'inferred',gender:'unknown'}},{...valid,relationships:4}]){
   const r=await f.invoke('scean_character',{...args,character});assert(!r.ok);assert.match(r.error.code,/INVALID_ACTOR_(IDENTITY|RELATIONSHIPS)/);const after=await f.saved();assert.equal(after.revision,before.revision);assert.equal(after.sha256,before.sha256);
 }
 const saved=await f.invoke('scean_character',{...args,character:valid});assert(saved.ok,JSON.stringify(saved));const current=await f.saved();assert.equal(current.revision,before.revision+1);assert.deepEqual(current.card.data.extensions.scean.characters[0].customMetadata,{kept:true});
 assert.equal((await f.invoke('scean_character',{...args,character:valid})).error.code,'REVISION_CONFLICT');
});

test('C1 stage handoff requires the roster source revision and still checks card expectedRevision',async t=>{
 const f=await fixture(t),saved=await f.saved(),characters=structuredClone(saved.card.data.extensions.scean.characters),base={claim:f.claim,mode:'start',document_id:f.id,expected_revision:saved.revision,request_id:'roster-version-fixture',characters};
 await assert.rejects(f.control(f.agent,base),{code:'SCEAN_ROSTER_REVISION'});
 await assert.rejects(f.control(f.agent,{...base,characters_revision:saved.revision+1}),{code:'SCEAN_ROSTER_REVISION'});assert.equal(f.host.metadata.runs.length,0);
 const result=await f.control(f.agent,{...base,characters_revision:saved.revision});assert.equal(result.openingRequired,true);
 await f.invoke('patch',{document_id:f.id,expected_revision:saved.revision,patches:[{op:'replace',path:'/data/scenario',value:'Updated fixture'}]});
 await assert.rejects(f.control(f.agent,{...base,characters_revision:saved.revision}),{code:'SCEAN_REVISION'});
});

test('record pagination is distinct from turn authorization; default reads of the exact granted turn work and private data stays denied',async t=>{
 const f=await fixture(t),started=await f.start();await f.host.turn({runId:started.runId,requestId:'pagination-proof',input:'Look at the lamp',expectedVersion:0});await f.grant(started.runId,{fromTurn:1,toTurn:1});
 for(const section of ['context','story','runtime']){const result=await f.tool({section,turn:1});assert(result.ok,JSON.stringify(result));assert.equal(result.value.status,'available');}
 let inspections=0;const inspect=f.engine.inspect.bind(f.engine);f.engine.inspect=async(...args)=>{inspections++;return inspect(...args);};
 await assert.rejects(f.tool({section:'story',turn:1,limit:4000}),e=>e.code==='DIAG_QUERY_PAGE'&&/records, not tokens or characters/.test(e.message));
 await assert.rejects(f.tool({section:'story',turn:0}),e=>e.code==='DIAG_QUERY'&&/authorized range 1\.\.1/.test(e.message));
 await assert.rejects(f.tool({section:'private_context',turn:1,limit:4000}),e=>e.code==='DIAG_DENIED');assert.equal(inspections,0,'invalid/undelegated requests must not query the Runtime');
 const available=await f.tool({section:'runtime',turn:1,limit:1});assert.equal(available.value.status,'available');assert.ok(inspections>0);
});

test('diagnostic action/target/direction and parameter combinations fail clearly without granting edits',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId);
 for(const args of [{runId:'other'},{section:'story',field:'card'},{entry_id:'1'},{target:'card'},{direction:'edit'},{action:'prepare_edit',direction:'edit',limit:1}])await assert.rejects(f.tool(args),e=>e.code==='DIAG_QUERY');
 for(const direction of ['', '  ','x'.repeat(4001)])await assert.rejects(f.tool({action:'prepare_edit',target:'card',direction}),e=>e.code==='DIAG_DIRECTION');
 const accepted=await f.tool({action:'prepare_edit',target:'card',direction:'x'.repeat(4000)});assert(accepted.ok);assert.equal(accepted.value.proposal.target.document_id,f.id);
 await assert.rejects(f.tool({action:'prepare_edit',target:'worldbook',direction:'Edit embedded entry'}),e=>e.code==='DIAG_TARGET'&&/target=card/.test(e.message));
 assert.equal((await f.saved()).revision,0);assert.equal(f.r.diagnosis.approval,null);
});

test('Snapshot and large record cursors have explicit distinct UTF-16 units, bounded pages and no skipped text',async t=>{
 const f=await fixture(t);const description='甲🙂'.repeat(10000);assert((await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:description}]})).ok);const run=await f.start();await f.host.turn({runId:run.runId,requestId:'cursor-turn',input:'Look at the lamp',expectedVersion:0});await f.grant(run.runId);
 let offset=0,joined='',last;do{last=(await f.tool({section:'snapshot',field:'card',offset})).value;assert.equal(last.pagination.offsetUnit,'utf16_code_units');assert(last.data.text.length<=12000);joined+=last.data.text;offset=last.nextOffset;}while(offset!==null);assert.equal(JSON.parse(joined).data.description,description);
 await assert.rejects(f.tool({section:'snapshot',offset:joined.length+1}),e=>e.code==='DIAG_QUERY_CURSOR');await assert.rejects(f.tool({offset:1}),e=>e.code==='DIAG_QUERY_PAGE');
 for(const value of [-1,1.5,'1'])await assert.rejects(f.tool({section:'story',text_offset:value}),e=>e.code==='DIAG_QUERY_CURSOR');
 const inspect=f.engine.inspect.bind(f.engine),body='乙🙂'.repeat(20000);f.engine.inspect=async(...args)=>{const r=await inspect(...args);r.turns[0].body=body;return r;};
 let textOffset=0,fragments='',pageHash;do{last=(await f.tool({section:'story',turn:1,offset:0,limit:1,text_offset:textOffset,...pageHash?{page_hash:pageHash}:{}})).value;assert.equal(last.pagination.offsetUnit,'records');assert.equal(last.data.encoding,'json-fragment');assert(last.data.text.length<=12000);assert(Buffer.byteLength(JSON.stringify([{type:'text',text:JSON.stringify({ok:true,value:last})}]))<=16000);fragments+=last.data.text;textOffset=last.data.nextTextOffset;pageHash=last.pageHash;}while(textOffset!==null);assert.equal(JSON.parse(fragments)[0].body,body);
 await assert.rejects(f.tool({section:'story',limit:1,text_offset:fragments.length+1}),e=>e.code==='DIAG_QUERY_CURSOR');f.engine.inspect=inspect;await assert.rejects(f.tool({section:'story',text_offset:1}),e=>e.code==='DIAG_QUERY_CURSOR');
});

test('all Snapshot source enums and worldbook ID bounds retain no_data/denied/query-error distinctions',async t=>{
 const f=await fixture(t),run=await f.start();await f.host.turn({runId:run.runId,requestId:'entry-boundary',input:'Look at the lamp',expectedVersion:0});await f.grant(run.runId);
 for(const field of ['card','worldbook','characters','opening','preset','stateBlueprint','initialState','source']){const v=(await f.tool({section:'snapshot',field})).value;assert(['available','no_data'].includes(v.status),field);}
 for(const entry_id of ['',123,'x'.repeat(513)])await assert.rejects(f.tool({section:'worldbook',entry_id}),e=>e.code==='DIAG_QUERY_ENTRY');
 const runtime=(await f.tool({section:'runtime',turn:1})).value,entry=runtime.data.flatMap(a=>a.worldbook?.examples??[])[0];assert(entry);assert.equal((await f.tool({section:'worldbook',entry_id:String(entry.entryId),turn:1})).value.status,'available');
 assert.equal((await f.tool({section:'worldbook',entry_id:'x'.repeat(512),turn:1})).value.status,'no_data');
 for(const args of [{offset:-1},{offset:8000001},{limit:0},{limit:11}])await assert.rejects(f.tool({section:'story',...args}),e=>e.code==='DIAG_QUERY_PAGE');
 await assert.rejects(f.tool({section:'private_context',text_offset:-1}),e=>e.code==='DIAG_DENIED');
});

test('W02 full offline service loop: real committed Runtime evidence → discuss → human consent → existing patch/new revision → new Run; original bytes unchanged',async t=>{
 const f=await fixture(t),old=await f.start();
 await f.host.turn({runId:old.runId,requestId:'w02-turn-1',input:'Look at the lamp',expectedVersion:0});
 const file=join(f.engine.store.runDir(old.runId),'current.json'),before=await readFile(file);
 const changed=await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/scenario',value:'A later working setting.'}]});assert(changed.ok);
 await f.grant(old.runId);
 const context=(await f.tool({})).value;assert.equal(context.sourceRevision,0);assert.equal(context.editTarget.target.revision,1);assert(context.changedFields.includes('scenario'));
 const story=(await f.tool({section:'story',turn:1})).value;assert.equal(story.data[0].body,'She disagreed and inspected the lamp.');
 const runtime=(await f.tool({section:'runtime',turn:1})).value;assert.equal(runtime.status,'available');assert(runtime.data.some(a=>a.commit));assert(runtime.data[0].worldbook.examples.some(e=>e.status));
 const miss=runtime.data[0].worldbook.examples.find(e=>e.reason==='primary_miss');assert(miss);assert.equal((await f.tool({section:'worldbook',turn:1,entry_id:String(miss.entryId)})).value.status,'not_triggered');assert.equal((await f.tool({section:'worldbook',turn:1,entry_id:'absent-entry'})).value.status,'no_data');
 const denied=await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/description',value:'Forbidden automatic repair.'}]},false);assert.equal(denied.error.code,'DIAG_EDIT_CONSENT');
 const replacement=await f.invoke('create',{name:'Unapproved replacement'},false);assert.equal(replacement.error.code,'DIAG_EDIT_CONSENT');
 await f.tool({action:'prepare_edit',direction:'Reduce excessive compliance; preserve the independent personality.'});
 await f.human({mode:'diagnosis_consent',expected_revision:1});
 const patched=await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/description',value:'Independent; she can refuse requests while remaining kind.'}]},false);assert(patched.ok,JSON.stringify(patched));assert.equal(patched.value.revision,2);
 const next=await f.start('w02-handoff-00000002');assert.notEqual(next.runId,old.runId);const nextRun=await f.engine.store.read(next.runId);assert.equal(nextRun.snapshot.revision,2);assert.equal(nextRun.snapshot.card.data.personality,syntheticCard().data.personality);assert.equal(nextRun.snapshot.card.data.scenario,'A later working setting.');assert.deepEqual(await readFile(file),before);
 assert(f.calls.length>0); // Offline deterministic port, not a paid model or semantic acceptance.
});

test('same-name cards and multiple Runs use exact source IDs; mismatched target cannot edit',async t=>{
 const f=await fixture(t),a=await f.start(),b=await f.start('w02-another-run-0001'),peer=await f.newSession('w02-namesake-session');
 const namesake=syntheticCard();namesake.data.description='Different same-name card, never the diagnostic source.';
 await writeFile(join(f.workspace,'imports','same-name.json'),JSON.stringify(namesake));const imported=await peer.invoke('import',{path:'imports/same-name.json',type:'card'});assert(imported.ok,JSON.stringify(imported));const other=imported.value.id;assert.notEqual(f.id,other);
 const listed=await f.human({mode:'diagnosis_list'});assert.equal(listed.items.length,2);assert.notEqual(listed.items[0].runId,listed.items[1].runId);
 const before=await f.saved();assert.equal((await peer.invoke('read',{document_id:f.id})).error.code,'SESSION_CARD_MISMATCH');
 const mismatched=await peer.human({mode:'diagnosis_grant',runId:a.runId});assert.equal(mismatched.context.cardId,f.id);assert.equal(mismatched.editTarget.status,'target_mismatch');
 const fixed=(await peer.tool({section:'snapshot',field:'card'})).value;assert.equal(fixed.status,'available');assert.deepEqual(JSON.parse(fixed.data.text),before.card);
 await assert.rejects(peer.tool({action:'prepare_edit',direction:'Fix.'}),{code:'DIAG_SOURCE_UNAVAILABLE'});assert.equal(peer.r.diagnosis.approval,null);assert.deepEqual(await f.saved(),before);
 const g=await f.grant(a.runId);assert.equal(g.context.cardId,f.id);assert.equal(g.editTarget.status,'available');
 await f.grant(b.runId);assert.equal((await f.tool({})).value.runId,b.runId);
});

test('Agent has no implicit Inspector grant and cannot issue grants or consent',async t=>{
 const f=await fixture(t);await f.start();await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});
 await assert.rejects(f.diagnosis.human(f.agent,{mode:'diagnosis_grant'}),{code:'STALE_LEASE'});
 assert.equal(toolSpecs.filter(x=>x[0]==='cardstudio_scean_diagnose').length,1);
 assert(!toolSpecs.some(x=>/grant|consent/.test(x[0])));
});

test('diagnostic scope is enforced and private context needs separate explicit consent',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId,{ranges:['story']});
 await assert.rejects(f.tool({section:'snapshot'}),{code:'DIAG_DENIED'});await assert.rejects(f.tool({section:'private_context'}),{code:'DIAG_DENIED'});
 await assert.rejects(f.grant(run.runId,{ranges:['private_context']}),{code:'DIAG_PRIVATE_CONSENT'});
 await f.grant(run.runId,{ranges:['private_context'],acknowledgement:'allow-agent-private-context-for-this-run'});assert.equal((await f.tool({section:'private_context'})).value.status,'no_data');
});

test('revoke, wrong Run/Session/generation and changed Snapshot stop reads without a timer',async t=>{
 const f=await fixture(t),one=await f.start(),two=await f.start('w02-other-run-00002'),g=await f.grant(one.runId);
 const q={id:g.context.id,runId:one.runId,authoringSessionId:f.agent.id,generation:f.r.generation};
 for(const change of [{runId:two.runId},{authoringSessionId:'other'},{generation:'other'}])await assert.rejects(f.host.agentDiagnostics.read({...q,...change}),{code:'DIAG_DENIED'});
 await f.grant(one.runId);await f.human({mode:'diagnosis_revoke'});await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});
 await f.grant(one.runId);const inspect=f.engine.inspect.bind(f.engine);f.engine.inspect=async id=>{const r=await inspect(id);r.snapshot.hash='changed';return r;};await assert.rejects(f.tool({}),{code:'DIAG_SNAPSHOT_CHANGED'});f.engine.inspect=inspect;
});

test('Session disposal and revoked-during-query responses cannot leak late evidence',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId);
 const read=f.engine.inspect.bind(f.engine);let release,entered;const ready=new Promise(r=>entered=r);
 f.engine.inspect=async id=>{entered();await new Promise(r=>release=r);return read(id);};
 const pending=f.tool({section:'story'});await ready;await f.human({mode:'diagnosis_revoke'});release();await assert.rejects(pending,{code:'DIAG_DENIED'});f.engine.inspect=read;
 await f.grant(run.runId);await f.loader.release(f.agent,f.claim);await assert.rejects(f.tool({}),{code:'STALE_WORKSPACE'});
 assert.equal(f.host.agentDiagnostics.rows.size,0,'Session disposal revokes ephemeral Runtime delegation, without waiting for time cleanup');
});

test('source deletion gives Snapshot-only read, never a namesake replacement; no fake recovery copy',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId);
 const service=f.loader.workspace.service,read=service.read.bind(service);service.read=async id=>{if(id===f.id)throw Object.assign(Error('missing'),{code:'ENOENT'});return read(id);};
 const context=(await f.tool({})).value;assert.equal(context.editTarget.status,'source_missing');assert.equal(context.editTarget.editable,false);assert.equal((await f.tool({section:'snapshot',field:'card'})).value.status,'available');
 await assert.rejects(f.tool({action:'prepare_edit',direction:'Recover.'}),{code:'DIAG_SOURCE_UNAVAILABLE'});service.read=read;
});

test('no_data, recorded non-trigger, failed query and permission denial stay distinct; bounded source and turn pages',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId,{fromTurn:1,toTurn:1});
 assert.equal((await f.tool({section:'runtime'})).value.status,'no_data');await assert.rejects(f.tool({section:'story',turn:2}),{code:'DIAG_QUERY'});
 const inspect=f.engine.inspect.bind(f.engine);f.engine.inspect=async()=>{throw Object.assign(Error('IO'),{code:'EIO'});};await assert.rejects(f.tool({section:'runtime'}),{code:'DIAG_QUERY_FAILED'});f.engine.inspect=inspect;
 const snapshot=(await f.tool({section:'snapshot',field:'card'})).value;assert(snapshot.data.text.length<=12000);assert.equal(snapshot.trust,'untrusted-data');
});

test('revision changes between proposal, consent and write reject stale modifications',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Preserve independence.'});
 await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/scenario',value:'Concurrent edit.'}]});
 await assert.rejects(f.human({mode:'diagnosis_consent',expected_revision:0}),{code:'REVISION_CONFLICT'});
 await f.tool({action:'prepare_edit',direction:'Preserve independence.'});await f.human({mode:'diagnosis_consent',expected_revision:1});
 const stale=await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'stale'}]},false);assert.equal(stale.ok,false);
 await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/scenario',value:'Another concurrent edit.'}]});
 const conflict=await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/description',value:'stale'}]},false);assert.equal(conflict.error.code,'REVISION_CONFLICT');
 assert.equal((await f.saved()).card.data.description,syntheticCard().data.description);
});

test('lost handoff and Run receipts recover across Host restart without duplicate Runs',async t=>{
 const f=await fixture(t),saved=await f.saved(),request={snapshot:buildSavedSnapshot(saved),authoringSessionId:f.agent.id,generation:f.r.generation,requestId:'durable-handoff-000001'};
 const first=await f.host.startFromStudio(request),again=await f.host.startFromStudio(request);assert.equal(first.openingOfferId,again.openingOfferId);
 const scope=await f.scope(),offer=f.host.openings.get(scope),choice={offerId:offer.offerId,cardId:f.id,revision:0,snapshotHash:offer.snapshotHash,openingIndex:0,playerName:'Synthetic tester'};
 const create=f.host.createRun.bind(f.host);f.host.createRun=async args=>{await create(args);throw Error('SYNTHETIC_LOST_CREATE_REPLY');};
 await assert.rejects(f.host.openings.start(choice,scope,f.scope));assert.equal((await f.engine.store.listRuns()).length,1);f.host.createRun=create;
 const restored=await new SceanHost({engine:f.engine,root:join(f.root,'host'),now:()=>f.clock.value}).init();t.after(()=>restored.close());
 const recover=await restored.startFromStudio(request);assert.equal(recover.openingOfferId,offer.offerId);const result=await restored.openings.start(choice,scope,f.scope);assert.equal((await f.engine.store.listRuns()).length,1);assert.equal((await restored.startFromStudio(request)).runId,result.runId);
 await assert.rejects(restored.startFromStudio({...request,snapshot:buildSavedSnapshot({...saved,revision:1})}),{code:'HANDOFF_CONFLICT'});
});

test('failed create before commit retries original opening exactly once; different choice rejected',async t=>{
 const f=await fixture(t),saved=await f.saved();await f.host.startFromStudio({snapshot:buildSavedSnapshot(saved),authoringSessionId:f.agent.id,generation:f.r.generation,requestId:'failed-handoff-000001'});
 const scope=await f.scope(),o=f.host.openings.get(scope),q={offerId:o.offerId,cardId:f.id,revision:0,snapshotHash:o.snapshotHash,openingIndex:0,playerName:'Synthetic tester'},create=f.host.createRun.bind(f.host);f.host.createRun=async()=>{throw Error('SYNTHETIC_DISK_FAILURE');};
 await assert.rejects(f.host.openings.start(q,scope,f.scope));assert.equal((await f.engine.store.listRuns()).length,0);f.host.createRun=create;
 await assert.rejects(f.host.openings.start({...q,openingIndex:1},scope,f.scope),{code:'OPENING_ALREADY_STARTED'});await f.host.openings.start(q,scope,f.scope);assert.equal((await f.engine.store.listRuns()).length,1);
});

test('stage action transfers only Run intent, never operator grant or automatic diagnosis/edit authority',async()=>{
 const events=[],panels=[],scope={cardId:'x',authoringSessionId:'session',generation:'g'};
 const bridge=createNativeBridge({call:async()=>({cardScope:scope}),getSessionId:()=>scope.authoringSessionId,selectPanel:x=>panels.push(x),onDiagnose:x=>events.push(x)});
 await bridge.request('native.context');assert.equal((await bridge.request('native.diagnose',{runId:'run-a'})).authorization,'human_confirmation_required');assert.deepEqual(events,[{runId:'run-a',authoringSessionId:'session'}]);assert.deepEqual(panels,['local-cardstudio-scean']);await bridge.dispose();
});

test('forged source UUID/hash with different Snapshot card content is readonly; historical revision absence never restores over current card',async t=>{
 const f=await fixture(t),saved=await f.saved(),snapshot=buildSavedSnapshot(saved);delete snapshot.hash;snapshot.card.data.description='Forged unrelated payload.';
 const run=await f.host.createRun({snapshot,playerName:'Synthetic tester'});await f.grant(run.runId);assert.equal((await f.tool({})).value.editTarget.status,'source_identity_mismatch');
 await assert.rejects(f.tool({action:'prepare_edit',direction:'Overwrite it.'}),{code:'DIAG_SOURCE_UNAVAILABLE'});assert.equal((await f.saved()).card.data.description,'Independent; she may disagree.');
});

test('standalone worldbook has its own exact source revision, selected repair target and existing book write contract',async t=>{
 const f=await fixture(t);await writeFile(join(f.workspace,'imports','book.json'),JSON.stringify({entries:{'8':{uid:8,key:['lamp'],content:'Standalone lamp.',disable:false,order:0}}}));
 const peer=await f.newSession('w02-worldbook-session'),imported=await peer.invoke('import',{path:'imports/book.json',type:'worldbook'});assert(imported.ok,JSON.stringify(imported));const bookId=imported.value.id;
 const card=await f.saved(),bookRead=await peer.invoke('read',{document_id:bookId});assert(bookRead.ok,JSON.stringify(bookRead));const snapshot=buildSavedSnapshot(card,{worldbook:bookRead.value});
 const run=await f.host.createRun({snapshot,playerName:'Synthetic tester'});await peer.human({mode:'diagnosis_grant',runId:run.runId});
 const context=(await peer.tool({})).value;assert.equal(context.editTarget.targetKind,'worldbook');assert.equal(context.editTarget.target.document_id,bookId);
 await peer.tool({action:'prepare_edit',target:'worldbook',direction:'Clarify the lamp setting without changing the character.'});await peer.human({mode:'diagnosis_consent',expected_revision:0});
 const patched=await peer.invoke('book_patch',{document_id:bookId,expected_revision:0,entry_id:'uid:8',changes:{content:'The standalone lamp is silver.'}},false);assert(patched.ok,JSON.stringify(patched));assert.equal(patched.value.revision,1);
 assert.equal((await peer.tool({})).value.editTarget.diagnosticRevision,0);assert((await peer.tool({})).value.changedFields.includes('entries'));assert.deepEqual(await f.saved(),card);
 const old=await f.engine.store.read(run.runId);assert.equal(old.snapshot.worldbook.entries['8'].content,'Standalone lamp.');
});

test('revocation while an existing card transaction is pending stops its commit, not just its reply',async t=>{
 const f=await fixture(t),run=await f.start();await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Keep the independent personality.'});await f.human({mode:'diagnosis_consent',expected_revision:0});
 let entered,release;const ready=new Promise(r=>entered=r),service=f.loader.workspace.service;service.beforeCommit=async()=>{entered();await new Promise(r=>release=r);};
 const pending=f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Must not commit after revoke.'}]},false);await ready;await f.human({mode:'diagnosis_revoke'});release();
 const result=await pending;assert.equal(result.error.code,'DIAG_EDIT_CONSENT');service.beforeCommit=null;assert.equal((await f.saved()).revision,0);
});

test('large Snapshot source is paged with explicit incomplete coverage, never a truncated complete card',async t=>{
 const f=await fixture(t);await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Synthetic long context. '.repeat(2000)}]});const run=await f.start();await f.grant(run.runId);
 const first=(await f.tool({section:'snapshot',field:'card'})).value;assert.equal(first.data.complete,false);assert.equal(first.nextOffset,12000);
 const next=(await f.tool({section:'snapshot',field:'card',offset:first.nextOffset})).value;assert.equal(next.data.offset,12000);assert.equal(next.data.text.length,12000);
});

const said=(seq,text,{kind='user',rpcId='synthetic-owner-rpc',principal}={})=>({seq,type:'user/message',surfaceOp:'append',data:{id:'human-'+seq,role:'user',source:{kind,...rpcId?{rpcId}:{},...principal?{principal}:{}},content:[{type:'text',text}]}});
const discussion=seq=>({seq,type:'assistant/message',data:{message:{id:'assistant-'+seq,role:'assistant',source:{kind:'model',provider:'synthetic',model:'offline'},content:[{type:'text',text:'我建議調整配合互動的描述，保留她的獨立性與性格。你想這樣修改嗎？'}]}}});
test('same Session discussion then natural-language owner agreement directly authorizes existing free edit tools and preserves personality',async t=>{
 const f=await fixture(t),log=[said(0,'幫我診斷這局')];f.agent.session.snapshotEvents=()=>log;const run=await f.start();await f.grant(run.runId);await f.tool({section:'context'});await f.tool({action:'prepare_edit',direction:'調整過度順從的互動描述，保持她的獨立性。'});
 log.push(discussion(1),said(2,'好，幫我改，但不要改性格'));
 const patched=await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Independent; she may refuse kindly.'}]},false);assert(patched.ok,JSON.stringify(patched));assert.equal(f.r.diagnosis.approval.source,'owner-conversation');
 const constraint=await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/personality',value:'Completely obedient.'}]},false);assert.equal(constraint.error.code,'DIAG_EDIT_CONSTRAINT');assert.equal((await f.saved()).card.data.personality,'Independent and kind.');
 const next=await f.start('natural-consent-new-run-0001');assert.notEqual(next.runId,run.runId);assert.equal((await f.engine.store.read(next.runId)).snapshot.revision,1);
 f.r.diagnosis.approval=null;assert.equal((await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/description',value:'replayed'}]},false)).error.code,'DIAG_EDIT_CONSENT');
});
test('quoted, hypothetical, old, non-owner, Runtime and tool text cannot become conversational repair consent',async t=>{
 const f=await fixture(t),log=[said(0,'好，幫我改')];f.agent.session.snapshotEvents=()=>log;const run=await f.start();await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Keep independence.'});log.push(discussion(1));
 const edit=()=>f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Not authorized.'}]},false);
 assert.equal((await edit()).error.code,'DIAG_EDIT_CONSENT');
 for(const source of [{kind:'runtime-context'},{rpcId:null},{principal:{kind:'api-key',id:'synthetic'}},{text:'如果我說「好，幫我改」，會怎樣？'},{text:'好，先不要改'},{text:'> 好，幫我改'}]){log.push(said(log.length,source.text??'好，幫我改',source));assert.equal((await edit()).error.code,'DIAG_EDIT_CONSENT');}
 assert.equal((await f.saved()).revision,0);
});
test('a new human withdrawal while an agreed transaction is pending blocks commit',async t=>{
 const f=await fixture(t),log=[];f.agent.session.snapshotEvents=()=>log;const run=await f.start();await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Keep independence.'});log.push(discussion(0),said(1,'好，幫我改，但不要改性格'));
 let release,entered;const ready=new Promise(r=>entered=r);f.loader.workspace.service.beforeCommit=async()=>{entered();await new Promise(r=>release=r);};
 const pending=f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Must not commit.'}]},false);await ready;log.push(said(2,'等等，先不要改'));release();assert.equal((await pending).error.code,'DIAG_EDIT_CONSENT');assert.equal((await f.saved()).revision,0);
});
test('recognition is conservative and supports the requested qualified Chinese consent',()=>{
 for(const text of ['好，幫我改，但不要改性格','好的，請修改這張卡','請照剛才建議幫我改'])assert(clearEditIntent(text),text);
 for(const text of ['幫我看看問題','先討論，不要動手','好，先不要改','如果我說好幫我改','「好，幫我改」','好，幫我改嗎？'])assert(!clearEditIntent(text),text);
});

async function advanceConnected(f,milliseconds){
 // Simulate the existing connected page heartbeat; no generation or real wait.
 const step=Math.floor(f.loader.leaseMs/2);let remaining=milliseconds;
 while(remaining>0){const elapsed=Math.min(step,remaining);f.clock.value+=elapsed;remaining-=elapsed;await f.loader.renew(f.agent,f.claim);}
}
test('Session-bound diagnosis and explicit editor repair consent remain usable after two hours in their original scope',async t=>{
 const f=await fixture(t),run=await f.start();const g=await f.grant(run.runId,{ranges:['story','snapshot','runtime'],fromTurn:1,toTurn:1});
 assert.equal(g.context.authorizationVersion,2);assert.equal(g.context.lifetime,'session');assert(!Object.hasOwn(g.context,'expiresAt'));
 await f.tool({action:'prepare_edit',direction:'Only adjust description; preserve personality.'});const consent=await f.human({mode:'diagnosis_consent',expected_revision:0});assert.equal(consent.lifetime,'diagnosis');assert(!Object.hasOwn(consent,'expiresAt'));
 await advanceConnected(f,7200001);assert.equal((await f.tool({section:'context'})).value.status,'available');
 await assert.rejects(f.tool({section:'story',turn:2}),{code:'DIAG_QUERY'});await assert.rejects(f.tool({section:'private_context'}),{code:'DIAG_DENIED'});
 const saved=await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Independent, revised after a long discussion.'}]},false);assert(saved.ok,JSON.stringify(saved));assert.equal((await f.saved()).revision,1);
 await f.human({mode:'diagnosis_revoke'});await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});assert.equal((await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[]},false)).error.code,'DIAG_EDIT_CONSENT');
});
test('natural owner consent keeps its direction and constraints beyond an hour; expectedRevision conflict still blocks overwrite',async t=>{
 const f=await fixture(t),log=[];f.agent.session.snapshotEvents=()=>log;const run=await f.start();await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Adjust only description and retain independence.'});log.push(discussion(0),said(1,'好，幫我改，但不要改性格'));
 const edit=revision=>f.invoke('patch',{document_id:f.id,expected_revision:revision,patches:[{op:'replace',path:'/data/description',value:'Preserve her independence, revision '+revision}]},false);
 assert((await edit(0)).ok);await advanceConnected(f,3600001);assert((await edit(1)).ok);assert.equal((await f.saved()).revision,2);
 assert.equal((await f.invoke('patch',{document_id:f.id,expected_revision:2,patches:[{op:'replace',path:'/data/personality',value:'Wrong personality'}]},false)).error.code,'DIAG_EDIT_CONSTRAINT');
 await f.invoke('patch',{document_id:f.id,expected_revision:2,patches:[{op:'replace',path:'/data/description',value:'Another editor changed this'}]});
 const conflict=await edit(2);assert.equal(conflict.error.code,'REVISION_CONFLICT');assert.equal((await f.saved()).card.data.description,'Another editor changed this');
});
test('legacy timed or revoked delegations are never silently promoted to Session-bound authority',async t=>{
 const f=await fixture(t),run=await f.start();await assert.rejects(f.grant(run.runId,{ttlMs:600000}),{code:'DIAG_SCOPE'});
 const g=await f.grant(run.runId),row=f.host.agentDiagnostics.rows.get(g.context.id);delete row.authorizationVersion;delete row.lifetime;row.expiresAt=f.clock.value-1;
 await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});await advanceConnected(f,3600001);await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});
 const fresh=await f.grant(run.runId);assert.notEqual(fresh.context.id,g.context.id);await f.human({mode:'diagnosis_revoke'});await advanceConnected(f,3600001);await assert.rejects(f.tool({}),{code:'DIAG_DENIED'});
});
test('Runtime revocation or Snapshot mismatch during a repair blocks final publication, including after a long discussion',async t=>{
 for(const mode of ['revoke','snapshot']){
  const f=await fixture(t),run=await f.start(),g=await f.grant(run.runId);await f.tool({action:'prepare_edit',direction:'Only description.'});await f.human({mode:'diagnosis_consent',expected_revision:0});await advanceConnected(f,3600001);
  const inspect=f.engine.inspect.bind(f.engine);f.loader.workspace.service.beforeCommit=async()=>{
   if(mode==='revoke')await f.host.agentDiagnostics.revoke({id:g.context.id,runId:run.runId,authoringSessionId:f.agent.id,generation:f.r.generation});
   else f.engine.inspect=async id=>{const value=await inspect(id);value.snapshot.hash='different-fixed-snapshot';return value;};
  };
  const result=await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Must never publish'}]},false);assert.equal(result.error.code,mode==='revoke'?'DIAG_DENIED':'DIAG_SNAPSHOT_CHANGED');f.loader.workspace.service.beforeCommit=null;f.engine.inspect=inspect;assert.equal((await f.saved()).revision,0);
 }
});

for(const phrase of ['確認修改，只改測試欄位','同意這個修改'])for(const route of ['patch','blueprint'])test('owner chat agreement reaches existing '+route+' commit with '+phrase,async t=>{
 const f=await fixture(t),log=[];f.agent.session.snapshotEvents=()=>log;
 let expected=0,panel;
 if(route==='blueprint'){
  const {w01Fixture}=await import('../fixtures/w01-frontends.mjs');panel=w01Fixture('fantasy');
  const first=await f.invoke('frontend',{action:'dynamic_save',document_id:f.id,expected_revision:0,blueprint:panel.bp,initial_state:panel.initial,frontend:panel.frontend});assert(first.ok,JSON.stringify(first));expected=1;
 }
 const run=await f.start();await f.grant(run.runId);const direction=route==='patch'?'Only clarify description; preserve personality.':'Only adjust the synthetic public mana maximum; keep all narrative text.';
 await f.tool({action:'prepare_edit',target:'card',direction});log.push(discussion(1),said(2,phrase));
 const before=await f.saved(),request=route==='patch'?{document_id:f.id,expected_revision:expected,patches:[{op:'replace',path:'/data/description',value:'A clarified synthetic description.'}]}:{action:'dynamic_save',document_id:f.id,expected_revision:expected,blueprint:{...panel.bp,variables:panel.bp.variables.map(v=>v.key==='mana'?{...v,max:120}:v)},initial_state:panel.initial};
 const result=await f.invoke(route==='patch'?'patch':'frontend',request,false);assert(result.ok,JSON.stringify(result));assert.equal(result.value.revision,expected+1);assert.equal(f.r.diagnosis.approval.source,'owner-conversation');
 const after=await f.saved();assert.equal(after.card.data.personality,before.card.data.personality);assert.equal(after.card.data.first_mes,before.card.data.first_mes);
 if(route==='blueprint'){assert.equal(after.card.data.extensions.scean.stateBlueprint.variables.find(v=>v.key==='mana').max,120);assert.equal(after.card.data.description,before.card.data.description);}
});

test('identical prepare_edit keeps the discussed scope and new owner consent; changed scope requires fresh agreement',async t=>{
 const f=await fixture(t),log=[];f.agent.session.snapshotEvents=()=>log;const run=await f.start();await f.grant(run.runId);
 const proposal={action:'prepare_edit',target:'card',direction:'Clarify only description.'};await f.tool(proposal);const original=f.r.diagnosis.proposal;log.push(discussion(1),said(2,'同意這個修改'));
 const repeated=await f.tool(proposal);assert.equal(repeated.value.reusedProposal,true);assert.equal(f.r.diagnosis.proposal,original);
 assert((await f.invoke('patch',{document_id:f.id,expected_revision:0,patches:[{op:'replace',path:'/data/description',value:'Clarified fixture.'}]},false)).ok);
 await f.tool({...proposal,direction:'Change the opening instead.'});assert.equal(f.r.diagnosis.approval,null);
 const denied=await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/first_mes',value:'Must wait.'}]},false);assert.equal(denied.error.code,'DIAG_EDIT_CONSENT');assert.equal(denied.error.details.reason,'proposal_changed_or_message_too_old');
 log.push(discussion(3),said(4,'我同意這個修改'));
 assert((await f.invoke('patch',{document_id:f.id,expected_revision:1,patches:[{op:'replace',path:'/data/first_mes',value:'A freshly agreed opening.'}]},false)).ok);
});

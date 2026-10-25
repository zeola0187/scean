import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {AgentDiagnostics,diagnosticPage,diagnosticWireBytes,DIAGNOSTIC_WIRE_BYTES,warningSummary} from '../plugin/agent-diagnostics.mjs';
import {boundedDiagnosisResult,diagnosisToolWireBytes,DIAGNOSIS_TOOL_WIRE_BYTES} from '../sources/card-studio/cardstudio-bundle/lib/scean-diagnosis.js';
import {selectiveSecondaryWarning} from '../sources/card-studio/cardstudio-bundle/lib/codec.js';
import {narrativeSources} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {selectWorldbooks} from '../core/worldbook.mjs';
import {characterAdviceOutputContract} from '../core/character-advice.mjs';
import {fixture,syntheticCard} from '../fixtures/gemini-batch2.mjs';
import {auditSavedSnapshot} from '../authoring/compatibility-audit.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {publicRunView} from '../core/inspection.mjs';

function diagnostics(){
 const warning=Array.from({length:1500},(_,i)=>({code:i%3?'UNSUPPORTED_ENTRY_EXTENSION':'EXECUTABLE_SYNTAX_LITERAL_ONLY',ref:'worldbook:0:entry:'+i%25,field:'unknown_'+i}));
 const a={attemptId:'attempt-one',runId:'run-fixture',requestId:'request-one',status:'failed',error:{code:'CHARACTER_ADVICE_FIELDS',category:'model'},stages:[{stage:'character',status:'failed',access:{kind:'character_private',characterId:'keeper'},prompt:{input:{private:'ONLY_AUTHORIZED_PRIVATE',large:'中\\"\n😀'.repeat(25000)}},result:{text:'PRIVATE_RESULT'}}],assemblyDiagnostics:{worldbook:{status:'selected',warnings:warning,entries:[{entryId:'entry',ref:'worldbook:0:entry:0',status:'excluded',reason:'secondary_keys_missing'},{entryId:'secret',ref:'private-ref',status:'excluded',reason:'private_scope'}]}},tools:[{id:'tool-one',name:'consult_character',status:'failed',error:{code:'CHARACTER_ADVICE_FIELDS'}}]};
 a.assemblyDiagnostics.worldbook.warnings.push({code:'PRIVATE_ENTRY_EXCLUDED',ref:'private-ref'});
 const run={runId:'run-fixture',snapshot:{hash:'a'.repeat(64),cardId:'card-fixture',revision:6,card:{data:{name:'Synthetic'}}},turns:[{turn:1,attemptId:a.attemptId,requestId:a.requestId,commitId:'commit-one'},{turn:2,attemptId:'other-turn',requestId:'other-request',commitId:'commit-two'}],attempts:[a,{...structuredClone(a),attemptId:'other-turn',requestId:'other-request',input:'UNAUTHORIZED_TURN'},{...structuredClone(a),attemptId:'unknown',requestId:'unknown',input:'UNKNOWN_HISTORY'}]};
 let alive=true;const host={metadata:{runs:[],agentDiagnosticAudit:[]},validateOwner(){if(!alive)throw Object.assign(Error('expired owner'),{code:'STUDIO_OWNER_CHANGED'});},requireRun(){},now:()=>1,persist:async()=>{},engine:{store:{read:async()=>structuredClone(run)},inspect:async()=>structuredClone(run)}};
 const service=new AgentDiagnostics(host);
 const grant=async ranges=>{const g=await service.issue({runId:run.runId,authoringSessionId:'session',generation:'generation',fromTurn:1,toTurn:1,ranges,acknowledgement:'allow-agent-private-context-for-this-run'});return {id:g.id,runId:run.runId,authoringSessionId:'session',generation:'generation'};};
 return {run,host,service,grant,kill:()=>alive=false};
}
async function pages(service,query){
 let text='',cursor=0,pageHash,r;do{r=await service.read({...query,textOffset:cursor,...pageHash?{pageHash}:{}});assert(diagnosticWireBytes(r)<=DIAGNOSTIC_WIRE_BYTES);if(r.data?.encoding!=='json-fragment')return r.data;text+=r.data.text;cursor=r.data.nextTextOffset;pageHash=r.pageHash;}while(cursor!==null);return JSON.parse(text);
}
test('A1 default summary retains exact error/tool/source locators and aggregates repeated warnings without changing raw storage',async()=>{
 const f=diagnostics(),q=await f.grant(['runtime']),before=JSON.stringify(f.run),r=await f.service.read({...q,section:'runtime'});
 assert.equal(r.detail,'summary');assert.equal(r.data.length,1);assert.equal(r.data[0].error.code,'CHARACTER_ADVICE_FIELDS');assert.equal(r.data[0].tools[0].error.code,'CHARACTER_ADVICE_FIELDS');assert.equal(r.data[0].worldbook.warnings.total,1500);assert.equal(r.data[0].worldbook.warnings.byCode.reduce((n,g)=>n+g.count,0),1500);assert.equal(r.data[0].stages[0].index,0);assert.equal(r.turnAssociation.status,'unknown_history_omitted');
 for(const marker of ['ONLY_AUTHORIZED_PRIVATE','PRIVATE_RESULT','private-ref','UNAUTHORIZED_TURN','UNKNOWN_HISTORY'])assert(!JSON.stringify(r).includes(marker));
 assert.equal(JSON.stringify(f.run),before);assert(diagnosticWireBytes(r)<DIAGNOSTIC_WIRE_BYTES);
});
test('A1 warning pages preserve every authorized row and exact public/private projection, including filtered counts',async()=>{
 const f=diagnostics(),q=await f.grant(['runtime','private_context']);let offset=0,all=[];
 do{const r=await f.service.read({...q,section:'runtime',detail:'warnings',attemptId:'attempt-one',warningCode:'UNSUPPORTED_ENTRY_EXTENSION',offset,limit:10});all.push(...r.data);offset=r.nextOffset;}while(offset!==null);
 assert.equal(all.length,1000);assert(all.every(w=>w.code==='UNSUPPORTED_ENTRY_EXTENSION'&&!Object.hasOwn(w,'field')));
 const privateRows=await f.service.read({...q,section:'private_context',detail:'warnings',attemptId:'attempt-one',sourceRef:'worldbook:0:entry:1',limit:10});assert(privateRows.data.every(w=>w.ref==='worldbook:0:entry:1'&&w.field));
 assert.equal(warningSummary(f.run.attempts[0].assemblyDiagnostics.worldbook.warnings).total,1501);
});
for(const content of ['中😀'.repeat(20000),'\\"\n\t'.repeat(20000),'<div a="\\">呈現</div>'.repeat(8000)])test('A1 escaped UTF-8 model text blocks stay bounded and fragments reconstruct exactly: '+content.length,()=>{
 const original={payload:content},base={schemaVersion:1,data:original,nextOffset:7,trust:'untrusted-data'};let cursor=0,text='',pageHash,r;
 do{r=diagnosticPage(base,{textOffset:cursor,...pageHash?{pageHash}:{}});assert(diagnosticWireBytes(r)<=14000);assert(diagnosisToolWireBytes({ok:true,value:r})<=16000);assert.equal(r.nextOffset,7);text+=r.data.text;cursor=r.data.nextTextOffset;pageHash=r.pageHash;}while(cursor!==null);
 assert.deepEqual(JSON.parse(text),original);
});
test('A1 full and individual private stage evidence survive complete paging; default private summary does not dump prompts',async()=>{
 const f=diagnostics(),q=await f.grant(['runtime','private_context']);const summary=await f.service.read({...q,section:'private_context'});assert(!JSON.stringify(summary).includes('ONLY_AUTHORIZED_PRIVATE'));
 const full=await pages(f.service,{...q,section:'private_context',detail:'stage',attemptId:'attempt-one',stageIndex:0});assert.equal(full.prompt.input.private,'ONLY_AUTHORIZED_PRIVATE');assert.equal(full.prompt.input.large,f.run.attempts[0].stages[0].prompt.input.large);
 const publicStage=await pages(f.service,{...q,section:'runtime',detail:'stage',attemptId:'attempt-one',stageIndex:0});assert.equal(publicStage.prompt.status,'restricted');
 const legacyFull=await pages(f.service,{...q,section:'runtime',detail:'full'});assert.equal(legacyFull[0].error.code,'CHARACTER_ADVICE_FIELDS');
});
test('A1 fragment fingerprint detects changing evidence, missing fingerprint and an oversized metadata envelope',async()=>{
 const base={data:{value:'x'.repeat(50000)}},first=diagnosticPage(base);
 assert.throws(()=>diagnosticPage(base,{textOffset:first.data.nextTextOffset}),{code:'DIAG_QUERY_CURSOR'});
 assert.throws(()=>diagnosticPage(base,{textOffset:JSON.stringify(base.data).length,pageHash:first.pageHash}),{code:'DIAG_QUERY_CURSOR'});
 assert.throws(()=>diagnosticPage({data:{value:'y'.repeat(50000)}},{textOffset:first.data.nextTextOffset,pageHash:first.pageHash}),{code:'DIAG_PAGE_CHANGED'});
 assert.throws(()=>diagnosticPage({...base,metadata:'x'.repeat(20000)}),{code:'DIAG_REPLY_SIZE'});
 const denied=boundedDiagnosisResult({ok:true,value:{metadata:'中'.repeat(16000)}});assert.equal(denied.error.code,'DIAG_REPLY_SIZE');assert(diagnosisToolWireBytes(denied)<DIAGNOSIS_TOOL_WIRE_BYTES);
});
test('A1 a large frozen Snapshot can continue beyond the former eight-million-unit cursor ceiling',async()=>{
 const f=diagnostics();f.run.snapshot.card.data.description='a'.repeat(8100000);const q=await f.grant(['snapshot']),r=await f.service.read({...q,section:'snapshot',field:'card',offset:8000001});assert.equal(r.data.offset,8000001);assert(r.data.text.startsWith('aaaa'));assert(r.nextOffset>8000001);assert(diagnosticWireBytes(r)<=14000);await assert.rejects(f.service.read({...q,section:'snapshot',offset:67108865}),{code:'DIAG_QUERY_PAGE'});
});
for(const change of ['revoke','session','snapshot'])test('A1 continuation stops after '+change,async()=>{
 const f=diagnostics(),q=await f.grant(['private_context']);const r=await f.service.read({...q,section:'private_context',detail:'stage',attemptId:'attempt-one',stageIndex:0});
 if(change==='revoke')await f.service.revoke(q);else if(change==='session')f.kill();else f.run.snapshot.hash='b'.repeat(64);
 await assert.rejects(f.service.read({...q,section:'private_context',detail:'stage',attemptId:'attempt-one',stageIndex:0,textOffset:r.data.nextTextOffset,pageHash:r.pageHash}),{code:change==='snapshot'?'DIAG_SNAPSHOT_CHANGED':change==='session'?'STUDIO_OWNER_CHANGED':'DIAG_DENIED'});
});
test('A1 revocation during audit, denied private scope, unknown sources and query failure stay distinct',async()=>{
 const f=diagnostics(),q=await f.grant(['runtime']);await assert.rejects(f.service.read({...q,section:'private_context'}),{code:'DIAG_DENIED'});
 assert.equal((await f.service.read({...q,section:'runtime',detail:'stage',attemptId:'other-turn',stageIndex:0})).status,'no_data');
 assert.equal((await f.service.read({...q,section:'worldbook',entryId:'entry'})).status,'not_triggered');
 f.host.engine.inspect=async()=>{throw Object.assign(Error('private path omitted'),{code:'EIO'});};await assert.rejects(f.service.read({...q,section:'runtime'}),{code:'DIAG_QUERY_FAILED'});
 f.host.engine.inspect=async()=>structuredClone(f.run);f.host.persist=async()=>f.service.rows.delete(q.id);await assert.rejects(f.service.read({...q,section:'runtime'}),{code:'DIAG_DENIED'});
});
test('A1 Snapshot identity change while audit is awaited prevents publishing the prepared page',async()=>{
 const f=diagnostics(),q=await f.grant(['runtime']);f.host.persist=async()=>{f.run.snapshot.hash='b'.repeat(64);};await assert.rejects(f.service.read({...q,section:'runtime'}),{code:'DIAG_SNAPSHOT_CHANGED'});assert(!f.service.rows.has(q.id));
});
test('A1 actual Studio tool envelope respects its final render budget and new query contract',async t=>{
 const f=await fixture(t),started=await f.start();await f.engine.turn({runId:started.runId,requestId:'synthetic-diagnostic',input:'lamp'});
 const a=(await f.engine.inspect(started.runId)).attempts[0];a.stages[0].prompt.input.padding='中\\"😀'.repeat(15000);await f.engine.store.writeAttempt(started.runId,a);
 await f.grant(started.runId,{ranges:['runtime','snapshot','private_context'],acknowledgement:'allow-agent-private-context-for-this-run'});
 let result=await f.tool({section:'private_context',detail:'stage',attempt_id:a.attemptId,stage_index:0}),text='';
 while(true){assert(result.ok);assert(diagnosisToolWireBytes(result)<=DIAGNOSIS_TOOL_WIRE_BYTES);text+=result.value.data.text;const cursor=result.value.data.nextTextOffset;if(cursor===null)break;result=await f.tool({section:'private_context',detail:'stage',attempt_id:a.attemptId,stage_index:0,text_offset:cursor,page_hash:result.value.pageHash});}
 assert.equal(JSON.parse(text).prompt.input.padding,a.stages[0].prompt.input.padding);
});
for(const args of [{detail:'file'},{detail:'warnings'},{detail:'stage',attemptId:'attempt-one',stageIndex:-1},{detail:'warnings',attemptId:'attempt-one',sourceRef:'x'.repeat(513)},{detail:'summary',warningCode:'CODE'},{section:'context',detail:'full'}])test('A1 invalid detail selectors never become arbitrary source access: '+JSON.stringify(args),async()=>{
 const f=diagnostics(),q=await f.grant(['runtime']);await assert.rejects(f.service.read({...q,section:'runtime',...args}),{code:'DIAG_QUERY'});
});

test('D1 only declared card presentation is omitted; narrative strings and similarly named fields remain',()=>{
 const sources={card:{data:{description:'<b>NARRATIVE</b>',personality:'KEEP_PERSONALITY',system_prompt:'KEEP_RULE',extensions:{scean:{frontend:{html:'EXCLUDE_UI',css:'UI_STYLE'},narrativeRules:'KEEP_CUSTOM_RULE'},other:{frontend:'KEEP_UNKNOWN_CONTRACT'}}}},preset:{frontend:'KEEP_PRESET',instructions:'KEEP_STYLE'},worldbook:{entries:[{content:'KEEP_SELECTED'}]}};
 const original=structuredClone(sources),projected=narrativeSources(sources);assert.equal(projected.card.data.extensions.scean.frontend,undefined);assert.equal(projected.card.data.extensions.other.frontend,'KEEP_UNKNOWN_CONTRACT');assert.equal(projected.preset.frontend,'KEEP_PRESET');assert.equal(projected.card.data.description,'<b>NARRATIVE</b>');assert.equal(projected.card.data.extensions.scean.narrativeRules,'KEEP_CUSTOM_RULE');assert.deepEqual(sources,original);
});
test('D1 all affected Engine stage inputs retain required narrative contracts; complete fixed card stays unchanged',async t=>{
 const f=await fixture(t),calls=[],card=syntheticCard(),frontend={html:'PRESENTATION_ONLY'.repeat(5000),css:'.ui { color: red; }'};card.data.extensions.scean.frontend=frontend;card.data.system_prompt='KEEP_NARRATIVE_RULE';card.data.description='<b>KEEP_DESCRIPTION</b>';
 const actors=[{id:'keeper',name:'Keeper',description:'KEEP_OWNER_DESCRIPTION',private:{secret:'OWNER_ONLY'}},{id:'other',name:'Other',description:'Other background',private:{secret:'OTHER_PRIVATE'}}];card.data.extensions.scean.characters=actors;
 card.data.character_book.entries=[{id:1,keys:[],constant:true,content:'KEEP_SELECTED',enabled:true,insertion_order:0},{id:2,keys:['absent'],content:'UNSELECTED_LORE',enabled:true,insertion_order:1}];
 f.engine.model={async generate({stage,input}){calls.push({stage,input:structuredClone(input)});if(stage==='director')return input.conversation.length?{text:'Public brief'}:{text:'',toolCalls:[{id:'consult',name:'consult_character',arguments:{characterId:'keeper',question:'A question'}},{id:'ruling',name:'adjudicate_action',arguments:{action:'A public action'}}]};if(stage==='character')return {text:JSON.stringify(characterAdviceOutputContract('keeper').example)};if(stage==='adjudicate')return {text:'Public ruling'};if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};return {text:'Narrative body'};}};
 const run=await f.engine.createRun({snapshot:{schemaVersion:1,cardId:'projection-fixture',revision:8,card,characters:actors,worldbook:card.data.character_book,preset:{instructions:'KEEP_PRESET'}}});const before=JSON.stringify((await f.engine.store.read(run.runId)).snapshot);await f.engine.turn({runId:run.runId,requestId:'projection-test',input:'Consult then write.'});
 for(const c of calls){const text=JSON.stringify(c.input);assert(!text.includes('PRESENTATION_ONLY'));assert(!text.includes('UNSELECTED_LORE'));assert(!text.includes('OTHER_PRIVATE'));if(c.stage!=='character')assert(!text.includes('OWNER_ONLY'));}
 for(const stage of ['director','draft']){const c=calls.find(c=>c.stage===stage),s=c.input.assembly??c.input.context;assert.equal(s.sources.card.data.system_prompt,'KEEP_NARRATIVE_RULE');assert.equal(s.sources.card.data.description,'<b>KEEP_DESCRIPTION</b>');assert.equal(s.sources.preset.instructions,'KEEP_PRESET');assert.equal(s.sources.worldbook.entries[0].content,'KEEP_SELECTED');}
 assert.equal(calls.find(c=>c.stage==='character').input.character.private.secret,'OWNER_ONLY');assert.equal(calls.find(c=>c.stage==='adjudicate').input.worldbook.entries[0].content,'KEEP_SELECTED');assert.equal(calls.find(c=>c.stage==='prose').input.preset.instructions,'KEEP_PRESET');assert.equal(JSON.stringify((await f.engine.store.read(run.runId)).snapshot),before);
});
test('D1 compiled player frontend and public value projection remain intact after narrative generation',async t=>{
 const f=await fixture(t),ui=w01Fixture(),run=await f.engine.createRun({snapshot:ui.snapshot}),before=publicRunView(run).cardFrontend;
 await f.engine.turn({runId:run.runId,requestId:'frontend-preservation',input:'Observe.'});const saved=await f.engine.store.read(run.runId),after=publicRunView(saved).cardFrontend;
 assert.equal(after.status,'ready');assert.equal(after.frontend.hash,before.frontend.hash);assert.deepEqual(after.frontend,before.frontend);assert.deepEqual(saved.snapshot.card.data.extensions.scean.frontend,ui.snapshot.card.data.extensions.scean.frontend);
});

for(const logic of [0,1,2,3,'and_any','not_all','not_any','and_all'])test('D2 empty-secondary warning preserves current selector behavior for '+logic,()=>{
 const e={id:1,keys:['trigger'],secondary_keys:[],selective:true,selectiveLogic:logic,content:'Context',enabled:true,insertion_order:0};assert.equal(selectiveSecondaryWarning(e).code,'SELECTIVE_SECONDARY_EMPTY');
 const r=selectWorldbooks({cardId:'x',worldbook:{entries:[e]}},{playerInput:'trigger'});assert.equal(r.entries.length,0);assert.equal(r.diagnostics.entries[0].reason,'secondary_keys_missing');
 const enabled=selectWorldbooks({cardId:'x',worldbook:{entries:[{...e,selective:false}]}},{playerInput:'trigger'});assert.equal(enabled.entries.length,1);assert.equal(e.selective,true);
});
for(const extra of [{constant:true},{enabled:false},{disable:true},{content:'  '},{selective:false},{secondary_keys:['valid']},{secondary_keys:['valid'],keysecondary:[]}])test('D2 boundary is not falsely flagged: '+JSON.stringify(extra),()=>{assert.equal(selectiveSecondaryWarning({keys:['x'],content:'Body',selective:true,enabled:true,secondary_keys:[],...extra}),null);});
test('D2 whitespace and legacy secondary aliases follow the Runtime precedence; private and recursive entries do not become public',()=>{
 assert(selectiveSecondaryWarning({selective:true,content:'Text',keysecondary:['  ']}));assert.equal(selectiveSecondaryWarning({selective:true,content:'Text',keysecondary:['key']}),null);
 const r=selectWorldbooks({worldbook:{recursive_scanning:true,entries:[{id:1,keys:['x'],content:'y',enabled:true,selective:true,secondary_keys:[],insertion_order:0},{id:2,keys:['y'],content:'No recursion',enabled:true,insertion_order:1},{id:3,keys:['x'],content:'Private',visibility:'private',enabled:true,insertion_order:2}]}},{playerInput:'x'});assert.equal(r.entries.length,0);assert(r.diagnostics.entries.some(e=>e.reason==='private_scope'));assert(r.diagnostics.entries.some(e=>e.reason==='primary_miss'));
});
test('D2 actual saved CCv3 and ST worldbooks retain import bytes and unknown metadata; edits create revisions and reject conflicts',async t=>{
 const f=await fixture(t),before=await fs.readFile(f.workspace+'/imports/synthetic.json');let saved=await f.saved(),entry_id=saved.entryIds[0];
 const change=await f.invoke('book_patch',{document_id:f.id,expected_revision:saved.revision,entry_id,changes:{selective:true,secondary_keys:[],extensions:{unknown:'PRESERVED'}}});assert(change.ok);
 saved=await f.saved();assert(saved.compatibilityWarnings.some(w=>w.code==='SELECTIVE_SECONDARY_EMPTY'));const list=await f.invoke('book_list',{document_id:f.id});assert(list.value.entries[0].warnings.some(w=>w.code==='SELECTIVE_SECONDARY_EMPTY'));
 const revision=saved.revision;const edited=await f.invoke('book_patch',{document_id:f.id,expected_revision:revision,entry_id,changes:{secondary_keys:['silver']}});assert(edited.ok);saved=await f.saved();assert.equal(saved.revision,revision+1);assert.equal(saved.card.data.character_book.entries[0].selective,true);assert.equal(saved.card.data.character_book.entries[0].extensions.unknown,'PRESERVED');assert(!saved.compatibilityWarnings.some(w=>w.code==='SELECTIVE_SECONDARY_EMPTY'));
 const conflict=await f.invoke('book_patch',{document_id:f.id,expected_revision:revision,entry_id,changes:{selective:false}});assert.equal(conflict.error.code,'REVISION_CONFLICT');assert.deepEqual(await fs.readFile(f.workspace+'/imports/synthetic.json'),before);
 const st={entries:{'14':{uid:14,key:['trigger'],keysecondary:[],selective:true,content:'Legacy context',disable:false,order:1,extensions:{untouched:true}}}};const bytes=JSON.stringify(st);await fs.writeFile(f.workspace+'/imports/legacy.json',bytes);const imported=await f.invoke('import',{path:'imports/legacy.json',type:'worldbook'});assert(imported.ok);const id=imported.value.id,read=await f.invoke('read',{document_id:id});assert(read.value.compatibilityWarnings.some(w=>w.code==='SELECTIVE_SECONDARY_EMPTY'));const editedST=await f.invoke('book_patch',{document_id:id,expected_revision:read.value.revision,entry_id:read.value.entryIds[0],changes:{secondary_keys:['second']}});assert(editedST.ok);const final=(await f.invoke('read',{document_id:id})).value.card.data.character_book.entries['14'];assert.deepEqual(final.keysecondary,['second']);assert.equal(final.selective,true);assert.equal(final.extensions.untouched,true);assert.equal(await fs.readFile(f.workspace+'/imports/legacy.json','utf8'),bytes);
});
test('D2 Editor A draft choices use existing entry diffs and retain unrelated metadata',async()=>{
 const source=await fs.readFile(new URL('../sources/card-studio/cardstudio-bundle/client-template.js',import.meta.url),'utf8'),start=source.indexOf('const entryKnown='),end=source.indexOf('const authoringBlank=',start),helpers=vm.runInNewContext('(()=>{const json=v=>JSON.stringify(v,null,2);'+source.slice(start,end)+';return {entryDraft,changedEntry,entrySecondaryWarning};})()');
 const draft=helpers.entryDraft({entry:{keys:['x'],content:'Body',enabled:true,selective:true,secondary_keys:[],unknown:{keep:true}}});assert(helpers.entrySecondaryWarning(draft));assert.deepEqual(JSON.parse(JSON.stringify(helpers.changedEntry(draft))),{});draft.selective=false;assert.deepEqual(JSON.parse(JSON.stringify(helpers.changedEntry(draft))),{selective:false});assert(!helpers.entrySecondaryWarning(draft));assert(source.includes('只影響這個條目'));assert(source.includes('保留原設定'));
});
test('D2 saved-card audit warns on empty secondary before any matching input is supplied',()=>{
 const card=syntheticCard();card.data.character_book.entries[0].selective=true;card.data.character_book.entries[0].secondary_keys=[];
 const snapshot={schemaVersion:1,cardId:'audit-synthetic',revision:0,card,characters:card.data.extensions.scean.characters,worldbook:card.data.character_book,preset:{}};
 const r=auditSavedSnapshot({snapshot,saved:{id:'audit-synthetic',revision:0},entryIds:['stable-one','stable-two']});const issue=r.items.find(i=>i.observed?.code==='SELECTIVE_SECONDARY_EMPTY');assert(issue);assert.equal(issue.status,'WARN');assert(issue.objectID.includes('stable-one'));assert.equal(issue.observed.automaticChange,false);assert.equal(r.limits.modelsInvoked,0);
});

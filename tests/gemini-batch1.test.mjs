import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {AgentDiagnostics,diagnosticAttemptTurns} from '../plugin/agent-diagnostics.mjs';
import {characterAdviceOutputContract,projectCharacterAdvice} from '../core/character-advice.mjs';
import {safeFailure,SYSTEMS} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {validateRoster} from '../core/contracts.mjs';
import {validateRoster as portableRoster} from '../sources/card-studio/cardstudio-bundle/lib/w01/core/contracts.mjs';
import {resolveRoster} from '../sources/card-studio/cardstudio-bundle/lib/scean-integration.js';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';

const actor=()=>({id:'fixture-actor',name:'Same name',description:'Explicit fixture background.'});
const snap=()=>({schemaVersion:1,cardId:'fixture-card',revision:1,card:{data:{name:'Same name'}},characters:[actor()],worldbook:{entries:[]},preset:{}});
function diagnosticFixture(){
 const run={runId:'fixture-run',version:12,snapshot:{...snap(),hash:'fixture-hash'},turns:[{turn:1,attemptId:'attempt-one',requestId:'request-one',commitId:'commit-one'},{turn:2,attemptId:'attempt-two',requestId:'request-two',commitId:'commit-two'}],retired:[{turn:2,attemptId:'attempt-retired',requestId:'request-retired',commitId:'commit-retired'}],attempts:[]};
 const add=(id,baseVersion,requestId,extra={})=>run.attempts.push({attemptId:id,runId:run.runId,baseVersion,requestId,status:'failed',input:id,stages:[{stage:'character',prompt:{input:{privateMarker:id}},result:{text:id}}],assemblyDiagnostics:{worldbook:{entries:[{entryId:1,status:'selected',ref:'entry-fixture'}]}},...extra});
 add('attempt-one',1,'request-one');add('attempt-two',2,'request-two');add('attempt-retry',2,'request-two');add('attempt-retired',9,'request-retired');
 add('attempt-new-failed',12,'uncommitted',{turnIdentity:{schemaVersion:1,turn:3,baseHead:'commit-two',snapshotHash:run.snapshot.hash}});
 add('unknown-old-private',1,'unknown');
 const host={metadata:{runs:[],agentDiagnosticAudit:[]},validateOwner(){},requireRun(){},now:()=>1,persist:async()=>{},engine:{store:{read:async()=>structuredClone(run)},inspect:async()=>structuredClone(run)}};
 return {run,host,service:new AgentDiagnostics(host)};
}
test('A2 exact identities cover shifted versions, retries, retired commits and new failed attempts',()=>{
 const {run}=diagnosticFixture(),m=diagnosticAttemptTurns(run);
 assert.equal(m.get('attempt-one'),1);assert.equal(m.get('attempt-two'),2);assert.equal(m.get('attempt-retry'),2);assert.equal(m.get('attempt-retired'),2);assert.equal(m.get('attempt-new-failed'),3);assert.equal(m.get('unknown-old-private'),null);
});
test('A2 contradictory, foreign Run/Snapshot and absent base-head identities are not guessed',()=>{
 const {run}=diagnosticFixture();run.attempts.push({attemptId:'attempt-one',requestId:'request-two'},{attemptId:'foreign',runId:'other',requestId:'request-two'},{attemptId:'wrong-snapshot',requestId:'request-two',inputSnapshot:{hash:'other'}},{attemptId:'bad-head',turnIdentity:{schemaVersion:1,turn:2,baseHead:'absent',snapshotHash:run.snapshot.hash}});
 const m=diagnosticAttemptTurns(run);for(const id of ['attempt-one','foreign','wrong-snapshot','bad-head'])assert.equal(m.get(id),null);
 run.attempts.push({attemptId:'malformed-null',requestId:'request-two',turnIdentity:null});assert.equal(diagnosticAttemptTurns(run).get('malformed-null'),null);
});
for(const section of ['runtime','private_context','worldbook'])test('A2 narrow delegation never mixes other-turn/unknown attempt records: '+section,async()=>{
 const {run,service}=diagnosticFixture(),before=JSON.stringify(run),g=await service.issue({runId:run.runId,authoringSessionId:'fixture-session',generation:'fixture-generation',fromTurn:2,toTurn:2,ranges:['runtime','private_context'],acknowledgement:'allow-agent-private-context-for-this-run'});
 const query={id:g.id,runId:run.runId,authoringSessionId:'fixture-session',generation:'fixture-generation',section,turn:2,limit:1,...section==='worldbook'?{entryId:'1'}:{}};
 const seen=[];let offset=0;do{const r=await service.read({...query,offset});assert.equal(r.turnAssociation.status,'unknown_history_omitted');seen.push(...r.data);offset=r.nextOffset;}while(offset!==null);
 assert.deepEqual(seen.map(a=>a.attemptId),['attempt-two','attempt-retry','attempt-retired']);assert(!JSON.stringify(seen).includes('attempt-one'));assert(!JSON.stringify(seen).includes('unknown-old-private'));
 await assert.rejects(service.read({...query,turn:1}),{code:'DIAG_QUERY'});assert.equal(JSON.stringify(run),before);
 await service.revoke(query);await assert.rejects(service.read(query),{code:'DIAG_DENIED'});
});
test('A2 wholly unknown history returns no data with explicit association status',async()=>{
 const f=diagnosticFixture();f.run.turns=[];f.run.retired=[];f.run.attempts=f.run.attempts.slice(0,1);
 const g=await f.service.issue({runId:f.run.runId,authoringSessionId:'session',generation:'generation',fromTurn:1,toTurn:1,ranges:['runtime']});
 const r=await f.service.read({id:g.id,runId:f.run.runId,authoringSessionId:'session',generation:'generation',section:'runtime'});assert.equal(r.status,'no_data');assert.equal(r.turnAssociation.status,'unknown_history_omitted');assert.deepEqual(r.data,[]);
});

const source=await fs.readFile(new URL('../sources/card-studio/cardstudio-bundle/client-template.js',import.meta.url),'utf8');
const code=source.split('/* ROSTER_REVISION_START */')[1].split('/* ROSTER_REVISION_END */')[0];
const helpers=vm.runInNewContext('(()=>{'+code+';return {reconcileRoster,rosterDraftDirty,rosterHandoffReady,editRosterActor};})()', {json:v=>JSON.stringify(v,null,2)});
const document=(revision,description='original')=>({id:'same-card',revision,card:{data:{extensions:{scean:{characters:[{...actor(),description}]}}}}});
const hydrate=doc=>({doc,...helpers.reconcileRoster({},doc)});
test('C1 clean same-card revision reads refresh the roster and its source revision',()=>{
 const old=hydrate(document(1)),doc=document(2,'agent edit'),next={doc,...helpers.reconcileRoster(old,doc)};assert(next.sceanCharacters.includes('agent edit'));assert(helpers.rosterHandoffReady(next));assert(!helpers.rosterDraftDirty(next));
});
test('C1 competing saved roster preserves draft and both comparison bases, blocks handoff',()=>{
 const old=hydrate(document(1));old.sceanCharacters=old.sceanCharacters.replace('original','manual draft');const doc=document(2,'agent edit'),next={doc,...helpers.reconcileRoster(old,doc)};
 assert(next.sceanCharacters.includes('manual draft'));assert(next.sceanRosterConflict.previous.includes('original'));assert(next.sceanRosterConflict.saved.includes('agent edit'));assert(!helpers.rosterHandoffReady(next));
 for(const keepDraft of [true,false]){const choice={...next,sceanCharacters:keepDraft?next.sceanCharacters:next.sceanRosterConflict.saved,sceanCharactersBase:next.sceanRosterConflict.saved,sceanCharactersRevision:doc.revision,sceanRosterConflict:null};assert(helpers.rosterHandoffReady(choice));assert.equal(helpers.rosterDraftDirty(choice),keepDraft);}
});
test('C1 unrelated revision preserves draft while safely advancing unchanged roster base',()=>{
 const old=hydrate(document(1));old.sceanCharacters+=' ';const doc=document(2),next={doc,...helpers.reconcileRoster(old,doc)};assert.equal(next.sceanCharacters,old.sceanCharacters);assert.equal(next.sceanRosterConflict,null);assert(helpers.rosterHandoffReady(next));assert(helpers.rosterDraftDirty(next));
});
test('C1 prior cache without tracking hydrates, and stale source revision cannot hand off',()=>{
 const doc=document(2),view={doc,sceanCharacters:JSON.stringify(doc.card.data.extensions.scean.characters,null,2)};assert(helpers.rosterHandoffReady({...view,...helpers.reconcileRoster(view,doc)}));assert(!helpers.rosterHandoffReady({...hydrate(doc),sceanCharactersRevision:1}));
});
test('C1 explicit manual background does not falsely retain its previous source attestation',()=>{
 const old={...actor(),sourceBindings:{descriptionHash:'old-attestation'},customMetadata:{kept:true}};
 const next=helpers.editRosterActor([old],0,'description','Manual replacement')[0];assert.equal(next.sourceBindings,undefined);assert.equal(old.sourceBindings.descriptionHash,'old-attestation');assert.deepEqual(next.customMetadata,{kept:true});assert(helpers.editRosterActor([old],0,'name','New display name')[0].sourceBindings);
});
test('C2 portable Studio and Runtime share the same validator contract and retain metadata',()=>{
 assert.equal(portableRoster.toString(),validateRoster.toString());
 const a={...actor(),identity:{source:'user-explicit',pronouns:'they'},relationships:{peer:{trust:3}},customMetadata:{retained:true}};
 assert.deepEqual(resolveRoster(null,[a]),validateRoster([a]));assert.deepEqual(resolveRoster(null,[actor()]),[actor()]);
});
for(const [field,value,code] of [['identity','text','INVALID_ACTOR_IDENTITY'],['identity',{source:'guessed',gender:'unknown'},'INVALID_ACTOR_IDENTITY'],['relationships',42,'INVALID_ACTOR_RELATIONSHIPS']])test('C2 invalid '+field+' rejects consistently before handoff',()=>{const a={...actor(),[field]:value};for(const check of [validateRoster,portableRoster,r=>resolveRoster(null,r)])assert.throws(()=>check([a]),{code});});

test('B1 model-visible example validates and preserves only the explicit publication fields',()=>{
 const contract=characterAdviceOutputContract('fixture-actor');assert(contract.schema.required.includes('intendedDisclosures'));assert(!contract.schema.properties.internal.properties.intendedDisclosures);assert.match(SYSTEMS.character,/top-level sibling/);
 const input={...contract.example,withheld:['PRIVATE_WITHHELD'],internal:{notes:['PRIVATE_NOTES']}};const advice=projectCharacterAdvice(input,{characterId:'fixture-actor'});assert(!JSON.stringify(advice).includes('PRIVATE_'));assert.deepEqual(advice.intendedDisclosures,[]);
});
test('B1 valid JSON with nested disclosures is a field-path error, not syntax; no values leak',()=>{
 const input=characterAdviceOutputContract('fixture-actor').example;delete input.intendedDisclosures;input.internal.intendedDisclosures=[{topic:'SECRET',publicText:'SECRET'}];
 let error;try{projectCharacterAdvice(JSON.stringify(input),{characterId:'fixture-actor'});}catch(e){error=e;}assert.equal(error.code,'CHARACTER_ADVICE_FIELDS');assert.equal(error.validation.path,'/intendedDisclosures');const safe=safeFailure(error,'consult_character');assert.deepEqual(safe.validation,{path:'/intendedDisclosures',reason:'missing_fields'});assert(!JSON.stringify(safe).includes('SECRET'));
});
test('B1 syntax, object shape, unknown fields and indexed field paths remain distinct',()=>{
 assert.throws(()=>projectCharacterAdvice('{"broken":}',{characterId:'fixture-actor'}),{code:'CHARACTER_ADVICE_JSON'});
 assert.throws(()=>projectCharacterAdvice('[]',{characterId:'fixture-actor'}),{code:'CHARACTER_ADVICE_FIELDS'});
 const v=characterAdviceOutputContract('fixture-actor').example;v.internal.SECRET_FIELD='SECRET_VALUE';assert.throws(()=>projectCharacterAdvice(v,{characterId:'fixture-actor'}),e=>e.validation.path==='/internal'&&!JSON.stringify(safeFailure(e)).includes('SECRET'));
 delete v.internal.SECRET_FIELD;v.intendedDisclosures=[{topic:10,publicText:'okay'}];assert.throws(()=>projectCharacterAdvice(v,{characterId:'fixture-actor'}),e=>e.validation.path==='/intendedDisclosures/0/topic');
});
test('A2/B1 synthetic engine persists exact pending-turn identity; invalid advice makes no half commit after one bounded correction',async t=>{
 const base=new URL('../.test-data/',import.meta.url);await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(new URL('gemini-batch1-',base));t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[];
 const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root}),memory:new Memory(),model:{async generate(q){calls.push(q);if(q.stage==='director')return {text:'',toolCalls:[{id:'consult',name:'consult_character',arguments:{characterId:'fixture-actor',question:'Fixture question'}}]};if(q.stage==='character'){assert.equal(q.input.outputContract.example.characterId,'fixture-actor');const v=structuredClone(q.input.outputContract.example);delete v.intendedDisclosures;v.internal.intendedDisclosures=[];return {text:JSON.stringify(v)};}throw Error('No later stages allowed');}}});
 const run=await engine.createRun({snapshot:snap()});await assert.rejects(engine.turn({runId:run.runId,requestId:'fixture-invalid',input:'Consult fixture'}),{code:'CHARACTER_ADVICE_FIELDS'});const current=await engine.store.read(run.runId),attempts=await engine.store.readAttempts(run.runId);assert.equal(current.turns.length,0);assert.equal(current.memories.length,0);assert.deepEqual(calls.map(c=>c.stage),['director','character','character']);assert.equal(attempts[0].tools[0].consultation.formatCorrections,1);assert.equal(attempts[0].tools[0].consultation.dispatches,2);assert.equal(attempts[0].turnIdentity.turn,1);assert.equal(diagnosticAttemptTurns({...current,attempts}).get(attempts[0].attemptId),1);assert.equal(attempts[0].error.validation.path,'/intendedDisclosures');
});

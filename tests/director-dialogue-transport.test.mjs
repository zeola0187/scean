import test from 'node:test';import assert from 'node:assert/strict';
import {safeFailure} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {writerHandoffContract,buildWriterHandoff} from '../core/writer-workflow.mjs';
import {decodeWriterDialogue,writerDialogueContract,DIALOGUE_OUTPUT_GUIDE} from '../core/dialogue.mjs';
import {publicInspection} from '../core/inspection.mjs';
import {hash} from '../core/contracts.mjs';import {Memory} from '../core/memory.mjs';

const assembly={sources:{},recentDialogue:[],memory:{records:[]}},scope={assembly,tools:[],snapshotHash:'synthetic-snapshot',turn:1};
const contract=()=>writerHandoffContract(assembly,[]),brief=()=>structuredClone(contract().example);
test('one schema defines the Director output, with a valid nonempty source-cited example and no misleading statement field',()=>{
 const c=contract();assert(!Object.hasOwn(c,'statement'));assert(!Object.hasOwn(c.schema.properties,'statement'));assert.deepEqual(c.required,c.schema.required);assert.equal(c.schema.additionalProperties,false);assert.equal(c.schema.properties.knownFacts.items.additionalProperties,false);assert(c.example.knownFacts.length);assert.doesNotThrow(()=>buildWriterHandoff(c.example,scope));
 assert.deepEqual(c.schema.properties.knownFacts.items.properties.sourceRefs.items.enum,c.sourceCatalog.map(s=>s.id));
 for(const n of ['knownFacts','effectiveConstraints','expressedCommitmentsOrRefusals','characterPositions','unknowns'])assert.deepEqual(c.schema.properties[n],c.schema.properties.knownFacts);
});
test('Director strict structural errors retain code and safe field paths without reflecting response content',()=>{
 const cases=[
  [v=>v.statement={text:'EXTRA_PRIVATE_CANARY',sourceRefs:['input']},'WRITER_HANDOFF_INVALID','/statement','unexpected_fields'],
  [v=>v.knownFacts=['UNQUOTED_PRIVATE_CANARY'],'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0','object_required'],
  [v=>v.knownFacts[0].sourceRefs=['UNKNOWN_PRIVATE_SOURCE'],'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0/sourceRefs/0','unknown_source'],
  [v=>delete v.knownFacts[0].sourceRefs,'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0/sourceRefs','missing_field'],
  [v=>v.knownFacts[0].sourceRefs=[],'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0/sourceRefs','limit'],
  [v=>v.knownFacts[0].text=' '.repeat(10),'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0/text','limit'],
  [v=>v.knownFacts[0].text='x'.repeat(1501),'WRITER_HANDOFF_SOURCE_INVALID','/knownFacts/0/text','limit'],
  [v=>v.handoffVersion='1','WRITER_HANDOFF_INVALID','/handoffVersion','version'],
  [v=>delete v.unknowns,'WRITER_HANDOFF_INVALID','/unknowns','missing_field'],
  [v=>v.unknowns=Array(25).fill({text:'Unknown.',sourceRefs:['input']}),'WRITER_HANDOFF_INVALID','/unknowns','limit'],
  [v=>v['ARBITRARY_PRIVATE_KEY']='secret','WRITER_HANDOFF_INVALID','','unexpected_fields'],
 ];
 for(const [change,code,path,reason]of cases){const v=brief();change(v);assert.throws(()=>buildWriterHandoff(JSON.stringify(v),scope),e=>{assert.equal(e.code,code);assert.deepEqual(e.validation,{path,reason});const safe=safeFailure(e,'writer_handoff');assert.deepEqual(safe.validation,{path,reason});assert(!/PRIVATE|secret/.test(JSON.stringify(safe)));return true;});}
 const max=brief();max.knownFacts[0].text='x'.repeat(contract().schema.properties.knownFacts.items.properties.text.maxLength);assert.doesNotThrow(()=>buildWriterHandoff(max,scope));
 assert.throws(()=>buildWriterHandoff('```json\n{bad\n```',scope),e=>e.validation.path===''&&e.validation.reason==='invalid_json');
 assert.doesNotThrow(()=>buildWriterHandoff('```json\n'+JSON.stringify(brief())+'\n```',scope));
 assert.equal(safeFailure({code:'WRITER_HANDOFF_INVALID',validation:{path:'/PRIVATE_PATH',reason:'unexpected_fields'}},'writer_handoff').validation,undefined);
});
test('typed source catalog after a Character tool round still rejects Advice-only commitments',()=>{
 const tool={id:'consult-one',name:'consult_character',status:'completed',arguments:{question:'What is a possible response?'},result:{advice:{kind:'advice_not_event',adviceVersion:1,characterId:'speaker-a',observable:{attitude:'calm',intent:'possible response'},publicUtterances:[],intendedDisclosures:[]}}};
 const v=brief();v.expressedCommitmentsOrRefusals=[{text:'Already agreed.',sourceRefs:['tool:consult-one']}];
 assert.throws(()=>buildWriterHandoff(v,{...scope,tools:[tool]}),e=>e.code==='WRITER_ADVICE_NOT_COMMITMENT'&&e.validation.path==='/expressedCommitmentsOrRefusals/0/sourceRefs');
 v.expressedCommitmentsOrRefusals=[];v.characterPositions=[{text:'A proposed response, not an event.',sourceRefs:['tool:consult-one']}];assert.doesNotThrow(()=>buildWriterHandoff(v,{...scope,tools:[tool]}));
});

const body='Speaker A says "Ready."';const entry={kind:'speech',speakerId:'speaker-a',text:'"Ready."'};
const envelope=(dialogue=[entry],finalBody=body)=>JSON.stringify({sceanWriter:1,finalBody,dialogue});
class Store{
 runs=new Map();attempts=new Map();failCommit=false;
 async create(r){this.runs.set(r.runId,structuredClone(r));return structuredClone(r);}
 async read(id){return structuredClone(this.runs.get(id));}
 async withRunLock(id,fn){return fn();}async recoverAttempts(){}
 async readAttempts(id){return [...this.attempts.values()].filter(a=>a.runId===id).map(a=>structuredClone(a));}
 async writeAttempt(id,a){this.attempts.set(a.attemptId,structuredClone(a));}
 async commit(id,version,next){assert.equal(this.runs.get(id).version,version);if(this.failCommit)throw Object.assign(Error('synthetic disk failure'),{code:'EIO'});this.runs.set(id,structuredClone(next));}
}
async function fixture({writer=envelope(),badDirector=false,postFailure=false,repair=false,consult=false}={}){
 const store=new Store(),calls=[];let rounds=0;
 const model={async generate(a){calls.push(structuredClone({stage:a.stage,input:a.input,system:a.system}));
  if(a.stage==='director'){
   if(consult&&rounds++===0)return {text:'',toolCalls:[{id:'consult-one',name:'consult_character',arguments:{characterId:'speaker-a',question:'A possible response?'}}]};
   const v=structuredClone(a.input.handoffContract.example);if(badDirector)v.statement={text:'Extra field.',sourceRefs:['input']};return {text:JSON.stringify(v)};
  }
  if(a.stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:'speaker-a',observable:{attitude:'calm',intent:'possible speech'},publicUtterances:[],withheld:['PRIVATE_CANARY'],internal:{notes:['INTERNAL_CANARY']},intendedDisclosures:[]})};
  if(a.stage==='writer')return {text:writer};
  if(a.stage==='writer_repair')return {text:JSON.stringify({bodyHash:a.input.bodyHash,edits:a.input.ranges.map(r=>({start:r.start,end:r.end,replacement:r.text.replaceAll('BANNED','ready')}))})};
  if(a.stage==='post_stat'){if(postFailure)throw Object.assign(Error('synthetic failure'),{code:'RATE_LIMIT'});return {text:'{"contractVersion":2,"stateChanges":[],"memories":[]}'};}
  assert.fail('Unexpected extra generation '+a.stage);
 }};
 const engine=new SceanEngine({postBody:false,store,model,memory:new Memory()}),run=await engine.createRun({snapshot:{schemaVersion:1,cardId:'transport-synthetic',revision:'r1',card:{name:'Synthetic workshop'},worldbook:{entries:[]},preset:{style:'PRESERVE_STYLE_CANARY'},characters:[{id:'speaker-a',name:'A',description:'Synthetic public speaker.'}]},...(repair?{banList:['BANNED']}:{})});
 return {engine,run,store,calls,turn:()=>engine.turn({runId:run.runId,requestId:'request-one',input:'Observe the public scene.'})};
}
test('actual model packets deliver strict Director schema and mandatory Writer envelope through the budget, without changing style',async()=>{
 const f=await fixture({consult:true}),r=await f.turn();assert.deepEqual(f.calls.map(c=>c.stage),['director','character','director','writer','post_stat']);
 const w=f.calls.find(c=>c.stage==='writer'),d=f.calls.filter(c=>c.stage==='director').at(-1);
 assert(w.system.includes(DIALOGUE_OUTPUT_GUIDE));assert(w.system.includes('required Host display envelope'));assert.deepEqual(w.input.outputContract,writerDialogueContract([{id:'speaker-a'}],w.input.context.temporal.candidateRef));assert.deepEqual(w.input.outputContract.schema.required,['sceanWriter','finalBody','dialogue','candidateRef']);assert.equal(w.input.preset.style,'PRESERVE_STYLE_CANARY');
 assert(d.input.handoffContract.schema.properties.knownFacts.items.properties.sourceRefs.items.enum.includes('tool:consult-one'));
 assert(!JSON.stringify(w.input).includes('PRIVATE_CANARY'));assert(!JSON.stringify(w.input).includes('INTERNAL_CANARY'));
 const a=(await f.store.readAttempts(f.run.runId))[0];assert.deepEqual(a.stages.find(s=>s.stage==='writer').prompt.input.outputContract,w.input.outputContract);assert.equal(r.body,body);
});
test('bad Director output fails once with a durable field diagnostic before Writer, including after tools',async()=>{
 for(const consult of [false,true]){const f=await fixture({badDirector:true,consult}),before=await f.store.read(f.run.runId);await assert.rejects(f.turn(),{code:'WRITER_HANDOFF_INVALID'});assert.deepEqual(await f.store.read(f.run.runId),before);assert(!f.calls.some(c=>c.stage==='writer'));assert.equal(f.calls.filter(c=>c.stage==='director').length,consult?2:1);const a=(await f.store.readAttempts(f.run.runId))[0];assert.deepEqual(a.error.validation,{path:'/statement',reason:'unexpected_fields'});}
});
test('one local display decision distinguishes omitted, explicitly unattributed and invalid annotations; complete prose still commits once',async()=>{
 const cases=[
  [body,'not_provided'],[envelope([]),'unattributed'],[JSON.stringify({sceanWriter:1,finalBody:body}),'not_provided'],
  ['{"sceanWriter":1,"finalBody":'+JSON.stringify(body)+',"dialogue":BAD}','invalid_annotations'],
  [envelope('invalid'),'invalid_annotations'],[envelope([{...entry,speakerId:'unknown'}]),'invalid_annotations'],[envelope(Array(65).fill(entry)),'invalid_annotations'],[envelope(),'accepted'],
 ];
 for(const [writer,status]of cases){const f=await fixture({writer}),r=await f.turn(),saved=await f.store.read(f.run.runId),a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(r.body,body);assert.equal(saved.turns.length,1);assert.equal(saved.turns[0].bodyHash,hash(body));assert.equal(a.dialoguePresentation.status,status);assert.equal(!!saved.turns[0].dialoguePresentation,status==='accepted');assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','post_stat']);assert.equal(f.calls.at(-1).input.finalBody,body);assert.equal(f.calls.at(-1).input.bodyHash,hash(body));assert(!JSON.stringify(f.calls.at(-1).input).includes('sceanWriter'));assert(!JSON.stringify(f.calls.at(-1).input).includes('dialoguePresentation'));const count=f.calls.length;assert.deepEqual(await f.turn(),r);assert.equal(f.calls.length,count);const projected=publicInspection({...saved,attempts:[a]});assert.deepEqual(projected.attempts[0].dialoguePresentation,a.dialoguePresentation);}
});
test('incomplete Writer body aborts once, while annotation-tail damage recovers the complete original body',async()=>{
 const f=await fixture({writer:'{"sceanWriter":1,"finalBody":"incomplete'}),before=await f.store.read(f.run.runId);await assert.rejects(f.turn(),{code:'WRITER_BODY_FORMAT'});assert.deepEqual(await f.store.read(f.run.runId),before);assert.deepEqual(f.calls.map(c=>c.stage),['director','writer']);assert.equal(decodeWriterDialogue('{"sceanWriter":1,"finalBody":'+JSON.stringify(body)+',"dialogue":[').body,body);
});
test('literal repair invalidates pre-repair offsets and binds post_stat and atomic commit to the final body hash',async()=>{
 const original='Speaker A says "BANNED."',f=await fixture({writer:envelope([{...entry,text:'"BANNED."'}],original),repair:true});const r=await f.turn(),saved=await f.store.read(f.run.runId),a=(await f.store.readAttempts(f.run.runId))[0];assert.notEqual(r.body,original);assert.equal(a.dialoguePresentation.status,'body_changed');assert(!saved.turns[0].dialoguePresentation);assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','writer_repair','post_stat']);assert.equal(f.calls.at(-1).input.bodyHash,hash(r.body));assert.equal(f.calls.at(-1).input.finalBody,r.body);assert.equal(a.commit.bodyHash,saved.turns[0].bodyHash);assert.equal(saved.turns[0].bodyHash,hash(r.body));
});
test('PostStat or atomic commit failure never publishes body, annotations, State or Memory',async()=>{
 for(const postFailure of [true,false]){const f=await fixture({postFailure}),before=await f.store.read(f.run.runId);f.store.failCommit=!postFailure;await assert.rejects(f.turn());assert.deepEqual(await f.store.read(f.run.runId),before);assert.equal(f.calls.filter(c=>c.stage==='writer').length,1);}
});
test('successful regeneration retains complete prose but binds annotation offsets to the new commit only',async()=>{
 const f=await fixture();await f.turn();const old=await f.store.read(f.run.runId);await f.engine.regenerate({runId:old.runId,requestId:'regenerated',operationId:'regenerate-one',expectedVersion:old.version,expectedHead:old.head});const next=await f.store.read(old.runId),t=next.turns[0];assert.equal(t.body,old.turns[0].body);assert.notEqual(t.commitId,old.head);assert.equal(t.dialoguePresentation.commitId,t.commitId);assert.equal(t.dialoguePresentation.bodyHash,t.bodyHash);for(const s of t.dialoguePresentation.spans)assert.equal(t.body.slice(s.start,s.end),s.text);assert.equal(next.retired[0].commitId,old.head);
});

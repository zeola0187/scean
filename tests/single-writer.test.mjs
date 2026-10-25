import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';import {DurableStore} from '../adapters/store.mjs';import {Memory} from '../core/memory.mjs';import {hash} from '../core/contracts.mjs';
import {freezeWriterBody,assertWriterBodyHash,buildWriterHandoff,publicToolEvidence} from '../core/writer-workflow.mjs';
import {publicInspection} from '../core/inspection.mjs';import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {captureWritingMode,validateWritingModePin,writingModeAvailability,loadWritingSkills} from '../core/writing-mode.mjs';
import {syntheticCatalog,createScriptedModel} from '../fixtures/synthetic-catalog.mjs';

const snapshot={schemaVersion:1,cardId:'single-synthetic',revision:'r1',card:{name:'Synthetic workshop',description:'A public workshop.'},worldbook:{entries:[]},preset:{style:'PRESET_MUST_REACH_WRITER',perspective:'third-person',format:'ordinary prose'},characters:[{id:'lin',name:'Lin',description:'An engineer with private editorial notes.',publicProfile:{description:'An engineer.'},private:{notes:'OWNER_CHARACTER_CANARY'}}]};
const handoff=(extra={})=>JSON.stringify({handoffVersion:1,sceneIntent:'Understand the requested ordinary task; leave new choices to the player.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[],...extra});
const stat=()=>({text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})});
const answer=a=>a.stage==='director'?{text:a.input.handoffContract?handoff(): 'Existing public brief.'}:a.stage==='writer'?{text:'Lin places the finished parcel on the table.'}:a.stage==='draft'?{text:'Legacy draft.'}:a.stage==='prose'?{text:a.input.draft}:a.stage==='post_stat'?stat():assert.fail('Unexpected model stage '+a.stage);
async function fixture({generate=answer,fault,describe}={}){
 const root=await mkdtemp(join(tmpdir(),'scean-single-')),store=new DurableStore({root,fault}),calls=[],model={...(describe?{describe}:{}),async generate(a){calls.push(structuredClone({...a,signal:undefined}));return generate(a);}};
 const engine=new SceanEngine({store,model,memory:new Memory()}),run=await engine.createRun({snapshot,initialState:{world:{facts:{task:'A parcel is ready.'}},characters:{lin:{private:{secret:'OWNER_STATE_CANARY'},public:{}}}}});
 return {root,store,engine,run,calls};
}
const select=(f,mode='single_writer',revision=0,operationId='mode-one')=>f.engine.updateWritingMode({runId:f.run.runId,mode,expectedRevision:revision,operationId});
const turn=(f,requestId='one',extra={})=>f.engine.turn({runId:f.run.runId,requestId,input:'Please put the finished parcel on the table.',...extra});

test('single workflow truly schedules one main Writer without Draft or fixed Prose',async()=>{
 const f=await fixture();await select(f);const before=await f.store.read(f.run.runId),result=await turn(f);
 assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','post_stat']);
 assert.equal(f.calls.filter(c=>['draft','prose'].includes(c.stage)).length,0);
 assert.equal(result.body,'Lin places the finished parcel on the table.');
 assert.deepEqual(result.trace.stages.map(s=>s.stage),['director','writer','validation','post_stat']);
 const attempt=(await f.engine.inspect(f.run.runId)).attempts.at(-1),writer=attempt.stages.find(s=>s.stage==='writer');
 assert.deepEqual(writer.prompt.input,f.calls.find(c=>c.stage==='writer').input);assert.equal(writer.prompt.system,f.calls.find(c=>c.stage==='writer').system);
 assert.equal(attempt.stages.find(s=>s.stage==='validation').modelCall,false);assert.equal(attempt.finalBody.bodyHash,hash(result.body));
 const run=await f.store.read(f.run.runId);assert.deepEqual(run.snapshot,before.snapshot);assert.equal(run.turns.length,1);assert.equal(run.state.characters.lin.private.secret,'OWNER_STATE_CANARY');
});
test('Writer receives full applicable method, preset, public sources and pinned independent style through budget',async()=>{
 const f=await fixture({describe:()=>({contextWindow:64})});await select(f);
 await f.engine.updateProseStyle({runId:f.run.runId,text:'Use a calm direct style.',expectedRevision:0,operationId:'style-one'});await turn(f);
 const w=f.calls.find(c=>c.stage==='writer'),attempt=(await f.engine.inspect(f.run.runId)).attempts.at(-1),event=attempt.stages.find(s=>s.stage==='writer');
 assert.equal(w.input.preset.style,'PRESET_MUST_REACH_WRITER');assert.equal(w.input.proseStyle.text,'Use a calm direct style.');assert.equal(w.input.writingSkill.id,'single-writer');assert(w.input.writingSkill.text.includes('There is no subsequent full Prose rewrite'));
 assert.equal(w.input.context.playerInput,'Please put the finished parcel on the table.');assert.equal(w.input.context.worldState.world.facts.task,'A parcel is ready.');
 assert(event.contextBudget.sources.some(s=>s.path==='/input/preset'&&s.mandatory&&s.included));assert(event.contextBudget.sources.some(s=>s.path==='/input/writingSkill'&&s.mandatory&&s.included));assert.equal(event.contextBudget.estimatedOverflow,true);
 for(const canary of ['OWNER_CHARACTER_CANARY','OWNER_STATE_CANARY'])assert(!JSON.stringify(w.input).includes(canary));
 assert.equal(attempt.contextPreflights.find(p=>p.stage==='writer').stage,'writer');
});
test('current and materials workflows retain the actual legacy Draft -> Prose scheduler',async()=>{
 for(const mode of ['current','materials']){const f=await fixture();await select(f,mode);await turn(f);assert.deepEqual(f.calls.map(c=>c.stage),['director','draft','prose','post_stat']);}
});
test('Director can still choose history, state query and private Character consultation; Writer gets typed public evidence',async()=>{
 let rounds=0;const f=await fixture({generate:a=>{
  if(a.stage==='director'&&++rounds===1)return {text:'Check the relevant position and prior state.',toolCalls:[{id:'history-one',name:'search_history',arguments:{query:'parcel'}},{id:'state-one',name:'adjudicate_action',arguments:{action:'What is the parcel status?',mode:'query'}},{id:'character-one',name:'consult_character',arguments:{characterId:'lin',question:'What response would fit?'}}]};
  if(a.stage==='character'){assert(JSON.stringify(a.input).includes('OWNER_STATE_CANARY'));return {text:JSON.stringify({adviceVersion:1,characterId:'lin',observable:{attitude:'calm',intent:'A possible response'},publicUtterances:['I prefer leaving it on the table.'],withheld:['WITHHELD_CANARY'],internal:{notes:['INTERNAL_CANARY']},intendedDisclosures:[]})};}
  if(a.stage==='adjudicate')return {text:'Known state: the parcel is ready. This query performs no action.'};
  return answer(a);
 }});await select(f);await turn(f);
 const w=f.calls.find(c=>c.stage==='writer'),e=w.input.directorHandoff.evidence;
 assert.deepEqual(e.map(x=>x.kind),['historical_reference','stat_advice','character_advice']);assert.equal(e[1].mode,'query');assert.equal(e[1].result.resolution,'not_structurally_classified');assert.equal(e[2].status,'candidate_not_event');assert.equal(e[2].source.characterId,'lin');assert.equal(e[2].advice.publicUtterances[0],'I prefer leaving it on the table.');
 assert(w.input.directorHandoff.sourceCatalog.some(r=>r.id==='tool:character-one'));
 for(const secret of ['WITHHELD_CANARY','INTERNAL_CANARY','OWNER_STATE_CANARY','OWNER_CHARACTER_CANARY'])assert(!JSON.stringify(w.input).includes(secret));
 const run=await f.store.read(f.run.runId);assert.deepEqual(run.memories,[]);assert(!run.turns[0].body.includes('I prefer leaving'));
});
test('invalid handoff citations and Advice-only expressed commitments fail before Writer',async()=>{
 for(const extra of [{knownFacts:[{text:'Unsupported fact.',sourceRefs:['not-a-source']}]},{expressedCommitmentsOrRefusals:[{text:'Already promised.',sourceRefs:['tool:advice']}]}]){
  if(extra.knownFacts){const f=await fixture({generate:a=>a.stage==='director'?{text:handoff(extra)}:answer(a)});await select(f);await assert.rejects(turn(f),{code:'WRITER_HANDOFF_SOURCE_INVALID'});assert.equal(f.calls.length,1);assert.equal((await f.store.read(f.run.runId)).turns.length,0);}
  else {const assembly={sources:{},recentDialogue:[],memory:{records:[]}},tools=[{id:'advice',name:'consult_character',arguments:{question:'Response?'},status:'completed',result:{advice:{kind:'advice_not_event',adviceVersion:1,characterId:'lin',observable:{attitude:'',intent:''},publicUtterances:[],intendedDisclosures:[]}}}];assert.throws(()=>buildWriterHandoff(handoff(extra),{assembly,tools,snapshotHash:'x',turn:1}),{code:'WRITER_ADVICE_NOT_COMMITMENT'});}
 }
});
test('body freeze rejects stale proposal hashes and invalid Unicode without another model',()=>{
 const frozen=freezeWriterBody('Final body.');assert.doesNotThrow(()=>assertWriterBodyHash(frozen.body,frozen.bodyHash));assert.throws(()=>assertWriterBodyHash('Changed body.',frozen.bodyHash),{code:'WRITER_BODY_HASH_CHANGED'});assert.throws(()=>freezeWriterBody('\ud800'),{code:'WRITER_BODY_FORMAT'});
});
test('new stage receipts and writing-mode pins survive private save and public inspection',async()=>{
 const f=await fixture();await select(f);const r=await turn(f),run=await f.store.read(f.run.runId);run.writingMode=await f.engine.writingMode(run.runId);const bundle=encodeRunBundle(run),restored=validateRunBundle(bundle);assert.equal(restored.receipts.one.result.body,r.body);assert(restored.receipts.one.result.trace.stages.some(s=>s.stage==='writer'));const p=publicInspection(await f.engine.inspect(run.runId));assert(p.attempts.at(-1).stages.some(s=>s.stage==='writer'));assert(!JSON.stringify(p).includes('OWNER_STATE_CANARY'));
});
test('bounded Writer repair changes the frozen hash before post_stat and never calls fixed Prose',async()=>{
 const f=await fixture({generate:a=>a.stage==='writer'?{text:'Lin places a BANNED parcel on the table.'}:a.stage==='writer_repair'?{text:JSON.stringify({bodyHash:a.input.bodyHash,edits:a.input.ranges.map(r=>({start:r.start,end:r.end,replacement:r.text.replaceAll('BANNED','blue')}))})}:answer(a)});
 await select(f);await f.engine.updateBanList({runId:f.run.runId,banList:['BANNED'],expectedVersion:0});const result=await turn(f),post=f.calls.find(c=>c.stage==='post_stat'),attempt=(await f.engine.inspect(f.run.runId)).attempts.at(-1);
 assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','writer_repair','post_stat']);assert(!result.body.includes('BANNED'));assert.equal(post.input.finalBody,result.body);assert.equal(post.input.bodyHash,hash(result.body));assert.notEqual(f.calls.find(c=>c.stage==='writer_repair').input.bodyHash,post.input.bodyHash);assert.equal(attempt.commit.bodyHash,post.input.bodyHash);assert.equal(attempt.finalBody.locallyRepaired,true);
});
test('a stale local repair hash aborts before post_stat without rewriting durable state',async()=>{
 const f=await fixture({generate:a=>a.stage==='writer'?{text:'A BANNED parcel.'}:a.stage==='writer_repair'?{text:JSON.stringify({bodyHash:'stale',edits:[]})}:answer(a)});await select(f);await f.engine.updateBanList({runId:f.run.runId,banList:['BANNED']});const before=await f.store.read(f.run.runId);await assert.rejects(turn(f),{code:'STALE_PROSE_PATCH'});assert(!f.calls.some(c=>c.stage==='post_stat'));assert.deepEqual(await f.store.read(f.run.runId),before);
});
test('post_stat sees only final story and state; story, State and Memory commit once',async()=>{
 const memory={schemaVersion:2,text:'Lin put the parcel on the table.',access:{kind:'known_event'},knowers:['lin'],characterIds:['lin'],visibility:'characters',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:['lin'],decisionMakers:[]}};
 const f=await fixture({generate:a=>a.stage==='post_stat'?{text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'parcel_location',operation:'set',value:'table'}],memories:[memory]})}:answer(a)});await select(f);const result=await turn(f),post=f.calls.find(c=>c.stage==='post_stat');assert.equal(post.input.finalBody,result.body);assert.equal(post.input.directorHandoff,undefined);assert.equal(post.input.context,undefined);assert(!JSON.stringify(post.input).includes('candidate_not_event'));
 const run=await f.store.read(f.run.runId);assert.equal(run.version,1);assert.equal(run.state.world.facts.parcel_location,'table');assert.equal(run.memories.length,1);assert.equal(run.memories[0].source.bodyHash,hash(result.body));assert.equal(run.memories[0].source.commitId,run.turns[0].commitId);assert.equal(run.state.characters.lin.private.secret,'OWNER_STATE_CANARY');const count=f.calls.length;assert.deepEqual(await turn(f),result);assert.equal(f.calls.length,count);
});
test('failed atomic publication keeps body, State and Memory unchanged',async()=>{
 let armed=false;const f=await fixture({fault:async(point,d)=>{if(armed&&point==='beforeRename'&&d.file.endsWith('current.json'))throw Object.assign(Error('synthetic disk'),{code:'EIO'});}});await select(f);const before=await f.store.read(f.run.runId);armed=true;await assert.rejects(turn(f),{code:'EIO'});assert.deepEqual(await f.store.read(f.run.runId),before);assert.equal((await f.engine.inspect(f.run.runId)).attempts.at(-1).status,'failed');
});
test('unknown post-rename acknowledgement recovers the original receipt without another Writer',async()=>{
 let armed=false,failRead=false;const f=await fixture({fault:async(point,d)=>{if(armed&&point==='afterRename'&&d.file.endsWith('current.json')){armed=false;failRead=true;throw Object.assign(Error('lost receipt'),{code:'EIO'});}}});await select(f);const read=f.store.read.bind(f.store);f.store.read=async id=>{if(failRead){failRead=false;throw Object.assign(Error('synthetic transient read'),{code:'EIO'});}return read(id);};armed=true;await assert.rejects(turn(f),{code:'COMMIT_OUTCOME_UNKNOWN'});const calls=f.calls.length,result=await turn(f);assert.equal(result.status,'committed');assert.equal(f.calls.length,calls);assert.equal((await read(f.run.runId)).turns.length,1);
});
test('retry keeps original workflow, method hashes and style after a concurrent settings switch',async()=>{
 let failed=false;const f=await fixture({generate:a=>{if(a.stage==='writer'&&!failed){failed=true;throw Object.assign(Error('timeout'),{code:'MODEL_TIMEOUT'});}return answer(a);}});await select(f);await f.engine.updateProseStyle({runId:f.run.runId,text:'First style.',expectedRevision:0,operationId:'style-first'});await assert.rejects(turn(f),{code:'MODEL_TIMEOUT'});await select(f,'current',1,'mode-switch');await f.engine.updateProseStyle({runId:f.run.runId,text:'New style.',expectedRevision:1,operationId:'style-new'});await turn(f);
 const writers=f.calls.filter(c=>c.stage==='writer');assert.equal(writers.length,2);assert.equal(writers[1].input.proseStyle.text,'First style.');assert.equal(writers[0].input.writingSkill.sha256,writers[1].input.writingSkill.sha256);assert(!f.calls.some(c=>c.stage==='prose'));const attempts=(await f.engine.inspect(f.run.runId)).attempts;assert.equal(attempts[0].writingMode.hash,attempts[1].writingMode.hash);await turn(f,'two');assert(f.calls.some(c=>c.stage==='prose'));
});
test('cancelled Writer ignores late output and keeps the canonical Run unchanged',async()=>{
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);const f=await fixture({generate:a=>a.stage==='writer'?(started(),gate):answer(a)});await select(f);const before=await f.store.read(f.run.runId),controller=new AbortController(),work=turn(f,'one',{signal:controller.signal});await began;controller.abort();await assert.rejects(work,{code:'CANCELLED'});release({text:'Late story must not commit.'});await new Promise(setImmediate);assert.deepEqual(await f.store.read(f.run.runId),before);assert(!f.calls.some(c=>c.stage==='post_stat'));const attempt=(await f.engine.inspect(f.run.runId)).attempts.at(-1);assert.equal(attempt.status,'cancelled');assert.equal(attempt.error.stage,'writer');
});
test('Writer cannot request a supplemental loop or use tools in phase one',async()=>{
 const f=await fixture({generate:a=>a.stage==='writer'?{text:'Please ask Director again.',toolCalls:[{id:'extra',name:'read_history',arguments:{}}]}:answer(a)});await select(f);await assert.rejects(turn(f),{code:'STAGE_TOOL_FORBIDDEN'});assert.deepEqual(f.calls.map(c=>c.stage),['director','writer']);assert.equal((await f.store.read(f.run.runId)).turns.length,0);
});
test('Director can read a prior committed original and preserve its locator into Writer',async()=>{
 let prior=null,looked=false;const f=await fixture({generate:a=>{if(a.stage==='director'&&a.input.handoffContract&&!looked){looked=true;return {text:'Check the previous accepted action.',toolCalls:[{id:'read-original',name:'read_history',arguments:{commitId:prior,radius:0}}]};}return answer(a);}});await select(f,'current');prior=(await turn(f,'legacy-first')).commitId;await select(f,'single_writer',1,'history-single');await turn(f,'single-second');const h=f.calls.find(c=>c.stage==='writer').input.directorHandoff,e=h.evidence[0];assert.equal(e.source.tool,'read_history');assert.equal(e.query.commitId,prior);assert(JSON.stringify(e.reference).includes(prior));assert.equal(e.status,'reference_not_current_event');
});
test('in-flight workflow and style remain pinned; next new request can return to legacy',async()=>{
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);const f=await fixture({generate:a=>a.stage==='writer'?(started(),gate):answer(a)});await select(f);await f.engine.updateProseStyle({runId:f.run.runId,text:'Original style.',expectedRevision:0,operationId:'style-first'});const work=turn(f);await began;await select(f,'current',1,'switch-in-flight');await f.engine.updateProseStyle({runId:f.run.runId,text:'Next style.',expectedRevision:1,operationId:'style-next'});release({text:'Lin puts the parcel on the table.'});await work;assert.equal(f.calls.find(c=>c.stage==='writer').input.proseStyle.text,'Original style.');await turn(f,'next');assert.equal(f.calls.find(c=>c.stage==='prose').input.proseStyle.text,'Next style.');assert.equal((await f.store.read(f.run.runId)).turns.length,2);
});
test('Single Writer fixed methods reject missing assets, unknown mode and tampered pins',async()=>{
 const config={schemaVersion:1,runId:'synthetic',revision:1,mode:'single_writer'},pin=await captureWritingMode(config);assert.deepEqual(pin.skills.map(s=>s.stage),['director','writer']);assert.equal(validateWritingModePin(pin).hash,pin.hash);assert.throws(()=>validateWritingModePin({...pin,skills:pin.skills.map((s,i)=>i?{...s,text:'changed'}:s)}),{code:'WRITING_SKILL_CHANGED'});await assert.rejects(loadWritingSkills('single_writer',{stat:async()=>{throw Error('missing');}}),{code:'WRITING_SKILL_UNAVAILABLE'});await assert.rejects(loadWritingSkills('unknown'),{code:'WRITING_MODE_UNKNOWN'});const a=await writingModeAvailability({stat:async()=>{throw Error('missing');}});assert.equal(a.single_writer.status,'unavailable');
});
test('malformed Director handoff is a bounded failure, not an automatic extra model round',async()=>{
 const f=await fixture({generate:a=>a.stage==='director'?{text:'not JSON'}:answer(a)});await select(f);await assert.rejects(turn(f));assert.deepEqual(f.calls.map(c=>c.stage),['director']);assert.equal((await f.store.read(f.run.runId)).turns.length,0);
});
test('Single Writer admission still rejects a stale Run revision before any generation',async()=>{
 const f=await fixture();await select(f);await turn(f);const count=f.calls.length;await assert.rejects(turn(f,'new',{baseVersion:0,baseHead:null}),{code:'VERSION_CONFLICT'});assert.equal(f.calls.length,count);
});
test('the bundled offline synthetic model supports the Single Writer scheduler too',async()=>{
 const root=await mkdtemp(join(tmpdir(),'scean-single-bundled-')),store=new DurableStore({root}),scripted=createScriptedModel({delayMs:0}),calls=[];
 const engine=new SceanEngine({store,memory:new Memory(),model:{async generate(a){calls.push(a.stage);return scripted.generate(a);}}}),run=await engine.createRun({snapshot:syntheticCatalog().cards[0].revisions[0].snapshot});
 await engine.updateWritingMode({runId:run.runId,mode:'single_writer',expectedRevision:0,operationId:'select'});const r=await engine.turn({runId:run.runId,requestId:'synthetic',input:'Check the public scene.'});assert.equal(r.status,'committed');assert.deepEqual(calls,['director','writer','post_stat']);assert.equal((await store.read(run.runId)).turns.length,1);
});

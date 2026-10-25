import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {SYSTEMS} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {Memory} from '../core/memory.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {characterAdviceOutputContract} from '../core/character-advice.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
import {createDispatchBudget,DeepSeekModel} from '../adapters/model.mjs';
import {publicInspection} from '../core/inspection.mjs';

const valid=id=>({...characterAdviceOutputContract(id).example,publicUtterances:['A public fixture suggestion.'],withheld:['PRIVATE_WITHHELD_'+id],internal:{notes:['PRIVATE_NOTES_'+id]}});
const malformed=id=>JSON.stringify(valid(id))+']';
const wrongShape=id=>{const v=valid(id);v.internal.intendedDisclosures=[];delete v.intendedDisclosures;return JSON.stringify(v);};
async function fixture(t,{character=()=>null,native=false,technicalRetries=0,timeoutMs=1000,beforeReserve,afterCharacter,waitStage}={}){
 const base=new URL('../.test-data/',import.meta.url);await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(new URL('character-retry-',base));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const controller=new AbortController(),calls=[],ownerRecalls=[],reserves=[],settles=[],traces=[],counts={},selection={provider:'fixture-provider',model:'original-model',reasoningEffort:'off'};
 const response=(stage,input)=>{
  calls.push({stage,input:structuredClone(input)});
  if(stage==='director')return input.conversation.length?{text:'Use the public suggestions.'}:{text:'',toolCalls:['alpha','beta'].map(id=>({id:'ask-'+id,name:'consult_character',arguments:{characterId:id,question:'Original question for '+id}}))};
  if(stage==='character'){const id=input.character.id,n=counts[id]=(counts[id]??0)+1;const value=character(id,n,input);afterCharacter?.(id,n,selection);return value??{text:JSON.stringify(valid(id))};}
  if(stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[]})};
  return {text:'The fixture actors consider a public suggestion.'};
 };
 const ledger={async reserve(r){reserves.push(structuredClone(r));const id='reservation-'+reserves.length;await beforeReserve?.(r,reserves.length,controller);return id;},async settle(id,r){settles.push({id,...structuredClone(r)});}};
 const llm={async resolveModelInfo(){return {context:{contextWindow:1000000},defaultMaxTokens:8192,reasoning:{efforts:[{id:'off'}],defaultEffort:'off'}};},async *stream(options){
   const stage=Object.keys(SYSTEMS).find(k=>SYSTEMS[k]===options.system),input=JSON.parse(options.messages[0].content[0].text);const q=response(stage,input);calls.at(-1).route={provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort};
   if(q.pause)await q.pause;
   if(waitStage===stage||q.wait){await new Promise((resolve,reject)=>{const abort=()=>reject(Object.assign(Error('aborted fixture'),{code:'ABORTED'}));if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});});}
   yield {type:'usage',usage:{inputTokens:10,outputTokens:5,totalTokens:15}};
   if(q.error)throw Object.assign(Error('Private provider details are not forwarded'),{code:q.error});
   if(q.text!==undefined)yield {type:'block-end',index:0,block:{type:'text',text:q.text}};
   for(const [i,tool] of (q.toolCalls??[]).entries())yield {type:'block-end',index:i+1,block:{type:'tool-call',...tool}};
   yield {type:'finish',reason:{kind:q.finish??(q.toolCalls?.length?'tool-calls':'stop')}};
 }};
 const model=native?createNativeModelPort({llm,agentDefaultModel:{currentSelection:()=>({...selection})},usageLedger:ledger,technicalRetries,timeoutMs,onTrace:r=>traces.push(r)}):{timeoutMs,async generate({stage,input,signal}){const q=response(stage,input);if(q.wait)await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));if(q.error)throw Object.assign(Error(q.error),{code:q.error});return q;}};
 const store=new DurableStore({root}),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()});const run=await engine.createRun({snapshot:{schemaVersion:1,cardId:'synthetic-retry-card',revision:1,card:{data:{name:'Synthetic pair'}},worldbook:{entries:[]},preset:{},characters:['alpha','beta'].map(id=>({id,name:id,description:'Background '+id,private:{secret:'PRIVATE_CARD_'+id}}))},initialState:{world:{place:'fixture'},characters:{alpha:{private:{secret:'PRIVATE_STATE_alpha'}},beta:{private:{secret:'PRIVATE_STATE_beta'}}}}});
 const recall=engine.recall.bind(engine);engine.recall=async(...args)=>{if(args[2])ownerRecalls.push(args[2]);return recall(...args);};
 const file=store.runDir(run.runId)+'/current.json',before=await fs.readFile(file);
 const turn=()=>engine.turn({runId:run.runId,requestId:'original-request',input:'Consult both fixture actors.',signal:controller.signal});
 return {root,controller,calls,counts,reserves,settles,traces,ownerRecalls,store,engine,run,file,before,turn};
}

test('first valid replies perform no correction and preserve the ordinary Director continuation',async t=>{
 const f=await fixture(t),r=await f.turn();assert.deepEqual(f.counts,{alpha:1,beta:1});assert.deepEqual(f.ownerRecalls,['alpha','beta']);assert.equal(f.calls.filter(c=>c.stage==='director'&&!c.input.conversation.length).length,1);assert.equal(f.calls.filter(c=>c.stage==='director').length,2);for(const tool of r.trace.tools){assert.equal(tool.consultation.formatCorrections,0);assert.equal(tool.consultation.dispatches,1);}
});
for(const [label,make,code] of [['JSON',malformed,'CHARACTER_ADVICE_JSON'],['schema',wrongShape,'CHARACTER_ADVICE_FIELDS'],['version',id=>JSON.stringify({...valid(id),adviceVersion:2}),'CHARACTER_ADVICE_VERSION']])test(label+' correction retains the same actor/input and successful consultation; only valid public advice resumes Director',async t=>{
 const f=await fixture(t,{native:true,character:(id,n)=>id==='beta'&&n===1?{text:make(id)}:null,afterCharacter:(id,n,selection)=>{if(id==='beta'&&n===1){selection.provider='changed-provider';selection.model='changed-model';}}});
 const result=await f.turn(),cr=f.calls.filter(c=>c.stage==='character'),beta=cr.filter(c=>c.input.character.id==='beta');assert.equal(f.counts.alpha,1);assert.equal(beta.length,2);assert.deepEqual(f.ownerRecalls,['alpha','beta']);assert.equal(beta[1].input.correction.error.code,code);assert.equal(beta[1].input.correction.previousOutput,make('beta'));
 const {correction,...same}=beta[1].input;assert.deepEqual(same,beta[0].input);assert.deepEqual(beta[1].route,beta[0].route);assert.equal(beta[1].route.model,'original-model');assert(!JSON.stringify(beta).includes('PRIVATE_CARD_alpha'));
 if(label==='JSON'){assert.equal(correction.error.validation.position,make('beta').length-1);assert.equal(correction.error.validation.positionUnit,'utf16_json_body');}
 assert.equal(f.calls.filter(c=>c.stage==='director'&&!c.input.conversation.length).length,1);assert.equal(f.calls.filter(c=>c.stage==='director').length,2);
 for(const c of f.calls.filter(c=>c.stage!=='character'))assert(!JSON.stringify(c.input).includes('PRIVATE_WITHHELD_')&&!JSON.stringify(c.input).includes('PRIVATE_NOTES_'));
 assert(!JSON.stringify(result.trace).includes('PRIVATE_WITHHELD_'));assert.equal(result.trace.tools[1].id,'ask-beta');assert.equal(result.trace.tools[1].consultation.dispatches,2);assert.equal(result.trace.tools[1].consultation.formatCorrections,1);
 const stored=await f.store.read(f.run.runId);assert.equal(stored.turns.length,1);assert.equal(stored.memories.length,0);const view=publicInspection(await f.engine.inspect(f.run.runId));assert(!JSON.stringify(view).includes('PRIVATE_NOTES_'));const repairedStage=view.attempts[0].stages.filter(s=>s.stage==='character').at(-1);assert(!repairedStage.contextBudget.sources.some(s=>s.path==='/input/correction'));assert(repairedStage.contextBudget.restrictedSources.count>0);
 assert.equal(f.reserves.length,f.settles.length);assert.equal(f.traces.length,f.reserves.length);assert(f.settles.every(x=>x.status==='completed'&&x.usage.inputTokens===10));
});
test('two invalid replies fail clearly without skipping the tool, later stages, state or memory publication',async t=>{
 const f=await fixture(t,{native:true,character:id=>({text:wrongShape(id)})});await assert.rejects(f.turn(),{code:'CHARACTER_ADVICE_FIELDS'});assert.equal(f.counts.alpha,2);assert.equal(f.counts.beta,undefined);assert.equal(f.calls.filter(c=>c.stage==='director').length,1);assert(!f.calls.some(c=>c.stage==='draft'));assert.deepEqual(await fs.readFile(f.file),f.before);const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.tools[0].status,'failed');assert.equal(a.tools[0].consultation.formatCorrections,1);assert.equal(a.stages.filter(s=>s.stage==='character'&&s.validation?.status==='failed').length,2);assert.equal(f.settles.length,f.reserves.length);
});
for(const [name,reply,code] of [['identity',id=>({text:JSON.stringify({...valid(id),characterId:'wrong-actor'})}),'CHARACTER_ADVICE_IDENTITY'],['authentication',()=>({error:'AUTH'}),'AUTH'],['truncated',id=>({text:malformed(id),finish:'max-tokens'}),'MODEL_OUTPUT_TRUNCATED'],['oversized correction',id=>({text:JSON.stringify({...valid(id),extra:'x'.repeat(41000)})}),'CHARACTER_ADVICE_FIELDS']])test(name+' is not eligible for format recovery',async t=>{
 const f=await fixture(t,{native:true,character:reply,technicalRetries:1});await assert.rejects(f.turn(),{code});assert.equal(f.counts.alpha,1);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('transport retry consumes the same allowance: transport then invalid schema cannot cause a third dispatch',async t=>{
 const f=await fixture(t,{native:true,technicalRetries:1,character:(id,n)=>n===1?{error:'SERVER'}:{text:wrongShape(id)}});await assert.rejects(f.turn(),{code:'CHARACTER_ADVICE_FIELDS'});assert.equal(f.counts.alpha,2);const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.tools[0].consultation.dispatches,2);assert.equal(a.tools[0].consultation.formatCorrections,0);assert.equal(f.settles.filter(s=>s.status==='failed').length,1);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('format correction consumes the same allowance: invalid JSON then transport failure cannot trigger a third dispatch',async t=>{
 const f=await fixture(t,{native:true,technicalRetries:1,character:(id,n)=>n===1?{text:malformed(id)}:{error:'SERVER'}});await assert.rejects(f.turn(),{code:'SERVER'});assert.equal(f.counts.alpha,2);const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.tools[0].consultation.formatCorrections,1);assert.equal(a.tools[0].consultation.dispatches,2);assert.equal(f.reserves.length,f.settles.length);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('a technical retry that succeeds validly needs no format retry',async t=>{
 const f=await fixture(t,{native:true,technicalRetries:1,character:(id,n)=>id==='alpha'&&n===1?{error:'SERVER'}:null});const r=await f.turn();assert.equal(f.counts.alpha,2);assert.equal(r.trace.tools[0].consultation.formatCorrections,0);assert.equal(r.trace.tools[0].consultation.dispatches,2);
});
test('cancel after validation failure prevents correction dispatch and canonical writes',async t=>{
 const f=await fixture(t,{native:true,character:id=>({text:malformed(id)})}),write=f.store.writeAttempt.bind(f.store);f.store.writeAttempt=async(id,a)=>{await write(id,a);if(a.stages.some(s=>s.validation?.status==='failed'))f.controller.abort();};await assert.rejects(f.turn(),{code:'CANCELLED'});assert.equal(f.counts.alpha,1);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('cancel during repair preserves usage settlement and rejects late completion',async t=>{
 const f=await fixture(t,{native:true,character:(id,n)=>n===1?{text:malformed(id)}:{wait:true},afterCharacter:(id,n)=>{if(id==='alpha'&&n===2)setTimeout(()=>f.controller.abort(),5);}});await assert.rejects(f.turn(),{code:'CANCELLED'});assert.equal(f.counts.alpha,2);await new Promise(r=>setTimeout(r,10));assert.equal(f.reserves.length,f.settles.length);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('one consultation deadline includes correction and does not restart on repair',async t=>{
 const f=await fixture(t,{native:true,timeoutMs:1000,character:(id,n)=>n===1?{text:malformed(id)}:{wait:true},technicalRetries:1});await assert.rejects(f.turn(),{code:'MODEL_TIMEOUT'});assert.equal(f.counts.alpha,2);await new Promise(r=>setTimeout(r,10));assert.equal(f.reserves.length,f.settles.length);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('an unmanaged deterministic port is also bounded and cancellable without exposing host budget objects',async t=>{
 const f=await fixture(t,{timeoutMs:1000,character:()=>({wait:true})});await assert.rejects(f.turn(),{code:'MODEL_TIMEOUT'});assert.equal(f.counts.alpha,1);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('concurrent duplicate request cannot repeat a pending correction; committed replay adds no calls',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r),paused=new Promise(r=>release=r);
 const f=await fixture(t,{native:true,character:(id,n)=>{if(id==='beta'&&n===1)return {text:wrongShape(id)};if(id==='beta'&&n===2){enter();return {text:JSON.stringify(valid(id)),pause:paused};}return null;},timeoutMs:5000});
 const pending=f.turn();await entered;await assert.rejects(f.turn(),{code:'RUN_BUSY'});release();const first=await pending,count=f.calls.length;const replay=await f.turn();assert.equal(replay.commitId,first.commitId);assert.equal(f.calls.length,count);assert.equal(f.counts.beta,2);assert.equal((await f.store.read(f.run.runId)).turns.length,1);
});
test('native reservation cancellation before provider dispatch spends no further provider request',async t=>{
 const f=await fixture(t,{native:true,character:id=>({text:malformed(id)}),beforeReserve:(r,n,c)=>{if(r.meta.stage==='character'&&r.meta.consultationDispatch===2)c.abort();}});await assert.rejects(f.turn(),{code:'CANCELLED'});assert.equal(f.counts.alpha,1);await new Promise(r=>setTimeout(r,10));assert.equal(f.reserves.length,f.settles.length);assert.deepEqual(await fs.readFile(f.file),f.before);
});
test('dispatch checkpoint failure is persistence failure, never a technical or format retry',async t=>{
 const f=await fixture(t,{native:true,technicalRetries:1}),write=f.store.writeAttempt.bind(f.store);let fail=true;
 f.store.writeAttempt=async(id,a)=>{if(fail&&a.tools[0]?.consultation?.dispatches===1){fail=false;throw Object.assign(Error('synthetic checkpoint failure'),{code:'EIO'});}return write(id,a);};
 await assert.rejects(f.turn(),{code:'CONSULTATION_CHECKPOINT_FAILED'});assert.equal(f.counts.alpha,undefined);assert.equal(f.reserves.filter(x=>x.meta.stage==='character').length,0);assert.deepEqual(await fs.readFile(f.file),f.before);assert.equal((await f.store.readAttempts(f.run.runId))[0].error.category,'persistence');
});
test('cancel while usage admission is pending settles the late reservation once without dispatching',async t=>{
 let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r);
 const f=await fixture(t,{native:true,beforeReserve:async r=>{if(r.meta.stage==='character'){enter();await held;}}});const pending=f.turn();await entered;f.controller.abort();await assert.rejects(pending,{code:'CANCELLED'});release();
 for(let i=0;i<40&&f.settles.length<f.reserves.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.counts.alpha,undefined);assert.equal(f.settles.length,f.reserves.length);assert.equal(f.settles.at(-1).status,'cancelled');assert.equal(new Set(f.settles.map(s=>s.id)).size,f.settles.length);assert.deepEqual(await fs.readFile(f.file),f.before);assert(f.traces.some(r=>r.lateAdmission));
});
test('cancel while generation-gate admission is pending settles the gate and never reserves usage or dispatches',async()=>{
 let enter,release;const entered=new Promise(r=>enter=r),held=new Promise(r=>release=r),controller=new AbortController(),budget=createDispatchBudget({signal:controller.signal,timeoutMs:1000}),settled=[];let usage=0,streams=0;
 const port=createNativeModelPort({selection:{provider:'fixture',model:'fixture'},technicalRetries:1,timeoutMs:1000,llm:{resolveModelInfo:async()=>({defaultMaxTokens:100}),async *stream(){streams++;throw Error('No dispatch expected');}},usageLedger:{reserve:async()=>{usage++;return 'usage';},settle:async()=>{}},generationGate:{reserve:async()=>{enter();await held;return 'gate';},settle:async(id,r)=>settled.push({id,...r})}});
 try{const pending=port.generate({stage:'character',system:'fixture',input:{character:{id:'fixture'}},signal:budget.signal,dispatchBudget:budget});await entered;controller.abort();await assert.rejects(pending,{code:'CANCELLED'});release();for(let i=0;i<40&&!settled.length;i++)await new Promise(r=>setTimeout(r,5));assert.equal(settled.length,1);assert.equal(settled[0].status,'cancelled');assert.equal(usage,0);assert.equal(streams,0);}finally{release();budget.close();}
});
test('direct shipped adapter also enforces the shared two-dispatch ceiling and settles each reservation',async()=>{
 const reservations=[],settled=[],requests=[],budget=createDispatchBudget();
 try{
  const model=new DeepSeekModel({apiKey:'synthetic-not-a-credential',usageLedger:{reserve:async r=>{reservations.push(r);return reservations.length;},settle:async(id,r)=>settled.push({id,...r})},fetchImpl:async(url,options)=>{
   requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'fixture'}}],usage:{prompt_tokens:1,completion_tokens:1}})};
  }});
  for(let i=0;i<2;i++)await model.generate({stage:'character',system:'fixture',input:{fixture:true},dispatchBudget:budget,signal:budget.signal});
  await assert.rejects(model.generate({stage:'character',system:'fixture',input:{fixture:true},dispatchBudget:budget,signal:budget.signal}),{code:'CONSULTATION_DISPATCH_LIMIT'});assert.equal(requests.length,2);assert.equal(reservations.length,2);assert.equal(settled.length,2);
 }finally{budget.close();}
});

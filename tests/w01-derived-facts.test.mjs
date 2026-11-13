import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {derivedFixture} from '../fixtures/w01-derived-facts.mjs';
import {w01Fixture} from '../fixtures/w01-frontends.mjs';
import {derivedFactsPackage,projectDerivedFacts} from '../core/derived-facts.mjs';
import {evaluateCondition} from '../core/condition-ast.mjs';
import {frontendProjection} from '../core/frontend.mjs';
import {displayValues} from '../isolated/web/frontend-runtime.mjs';
import {DIRECTOR_TOOLS,SYSTEMS} from '../core/engine.mjs';import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';import {hash} from '../core/contracts.mjs';
import {budgetStage} from '../core/context-budget.mjs';import {publicRunView} from '../core/inspection.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
const copy=structuredClone;const fact=r=>projectDerivedFacts(r).facts[0];
async function setup(options={}){
 const f=options.fixture??derivedFixture(options),root=await fs.mkdtemp(path.join(tmpdir(),'w01-derived-')),store=new DurableStore({root}),calls=[];let mode='off',entered,release;
 const model={async describe({stage}){return {contextWindow:typeof options.capacity==='function'?options.capacity(stage):options.capacity??131072,outputLimit:4096};},async generate(request){const {stage,signal}=request;calls.push(copy({stage,system:request.system,input:request.input}));
  if(stage==='post_stat'){
   if(mode==='fail')throw Object.assign(Error('SYNTHETIC_FAILURE'),{code:'SYNTHETIC_FAILURE'});
   if(mode==='hold'){entered?.();await new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(Error('CANCELLED'),{code:'CANCELLED'})),{once:true});});}
   return {text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'check_1',operation:'set',value:mode==='on'}],memories:[]})};
  }
  return {text:stage==='director'?'Use supplied public committed facts, preserve player agency.':'The synthetic archivist records a public observation.'};
 }};
 const memory={async retrieve(){return {status:'offline',records:[]};}},engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model,memory});const run=await engine.createRun({snapshot:f.snapshot});
 return {...f,root,store,model,memory,engine,run,calls,setMode:m=>mode=m,waitHold:()=>new Promise(r=>entered=r),read:()=>store.read(run.runId),turn:requestId=>engine.turn({runId:run.runId,input:'Observe synthetic public conditions.',requestId})};
}
test('Host rules: four true, each false, missing, wrong type and illegal/restricted references fail closed',async()=>{
 const f=await setup();assert.equal(fact(f.run).value,true);
 for(let i=1;i<=4;i++){const r=copy(f.run);r.state.world.facts['check_'+i]=false;assert.equal(fact(r).value,false);}
 const missing=copy(f.run);delete missing.state.world.facts.check_2;assert.equal(fact(missing).status,'unknown');assert(!Object.hasOwn(fact(missing),'value'));
 const malformed=copy(f.run);malformed.state.world.facts.check_3='true';assert.throws(()=>projectDerivedFacts(malformed),e=>e.code.startsWith('BLUEPRINT_'));
 for(const [mutate,code] of [[p=>p.facts[0].expression={ref:'absent'},'DERIVED_REFERENCE_MISSING'],[p=>p.bindings[0].type='string','DERIVED_BINDING_TYPE'],[p=>{p.bindings[0].target.key='secret';p.bindings[0].type='string';},'DERIVED_BINDING_UNAUTHORIZED'],[p=>p.facts[0].name='','DERIVED_METADATA']]){const p=copy(f.rules);delete p.hash;mutate(p);assert.throws(()=>derivedFactsPackage(p,f.bp),{code});}
 assert.deepEqual(evaluateCondition({op:'not',args:[{ref:'bad'}]},{bad:{status:'known',value:'false'}}),{status:'unavailable'});
 assert(!JSON.stringify(projectDerivedFacts(f.run)).includes('RESTRICTED'));
});
function assertPacket(call,run,value){
 const p=(call.input.assembly??call.input.context).derivedFacts;assert.equal(p.facts[0].value,value);assert.equal(p.facts[0].name,'四條件合成安全指示');assert(p.facts[0].description);assert.equal(p.runId,run.runId);assert.equal(p.snapshotHash,run.snapshot.hash);assert.deepEqual(p.canonical,{version:run.version,head:run.head??null});assert(p.config.hash);assert(p.facts[0].ruleHash);
 assert(!JSON.stringify(call.input).includes('RESTRICTED_VALUE_CANARY'));assert(!JSON.stringify(call.input).includes('RESTRICTED_LABEL_CANARY'));assert(!JSON.stringify(call.input).includes('display-only-inverse'));return p;
}
test('Actual model port Director and Draft receive same mandatory facts from previous Commit; no extra stage or State writer',async()=>{
 const f=await setup();await f.turn('first');const first=copy(f.run);assertPacket(f.calls.find(c=>c.stage==='director'),first,true);assertPacket(f.calls.find(c=>c.stage==='draft'),first,true);
 const saved=await f.read();assert.equal(fact(saved).value,false);assert(!Object.hasOwn(saved.state.world,'derivedFacts'));assert.equal(saved.memories.length,0);
 f.calls.length=0;f.setMode('on');await f.turn('next');assertPacket(f.calls.find(c=>c.stage==='director'),saved,false);assertPacket(f.calls.find(c=>c.stage==='draft'),saved,false);
 assert.deepEqual(f.calls.map(c=>c.stage),['director','draft','prose','post_stat']);
 for(const stage of ['prose','post_stat'])assert(!JSON.stringify(f.calls.find(c=>c.stage===stage).input).includes('four-checks-permit'));
 const current=await f.read(),p=frontendProjection(current);assert.equal(p.values.safe.value,fact(current).value);assert.deepEqual(p.values.safe.provenance.canonical,projectDerivedFacts(current).canonical);assert.equal(displayValues(f.frontend,p).safe.value,true);
 const attempts=await f.store.readAttempts(current.runId),last=attempts.find(a=>a.requestId==='next');for(const s of last.stages.filter(s=>['director','draft'].includes(s.stage))){assert.equal(s.derivedFactsUse.status,'completed');assert(s.contextBudget.sources.some(s=>s.path.endsWith('/derivedFacts')&&s.mandatory&&s.included));}
 const out=new URL('../evidence/w01-derived-model-port.json',import.meta.url);await fs.writeFile(out,JSON.stringify({scope:'actual SceanEngine.model.generate arguments; synthetic only',calls:f.calls},null,2));
});
test('No custom frontend and all Writer flags off retain their independent contracts; legacy cards have no new field',async()=>{
 const f=await setup({frontend:false});assert.equal(publicRunView(f.run).cardFrontend,null);assert.equal(publicRunView(f.run).derivedFacts.facts[0].value,true);await f.turn('no-ui');assertPacket(f.calls.find(c=>c.stage==='draft'),f.run,true);
 const none=await setup({frontend:false,writer:false});await none.turn('not-requested');for(const c of none.calls.filter(c=>['director','draft'].includes(c.stage)))assert(!Object.hasOwn(c.input.assembly??c.input.context,'derivedFacts'));
 const legacy=await setup({fixture:w01Fixture()});assert.equal(projectDerivedFacts(legacy.run),null);await legacy.turn('legacy');assert(!Object.hasOwn(legacy.calls[0].input.assembly,'derivedFacts'));
});
test('Cancel/fail preserve authoritative facts; rollback, regenerate, restart and export/import use effective committed history',async()=>{
 const records=[];const f=await setup(),initial=hash(await f.read());f.setMode('fail');await assert.rejects(f.turn('fail'));assert.equal(hash(await f.read()),initial);assertPacket(f.calls.find(c=>c.stage==='director'),f.run,true);assertPacket(f.calls.find(c=>c.stage==='draft'),f.run,true);records.push({phase:'failed proposal preserves committed State',calls:copy(f.calls)});f.calls.length=0;
 f.setMode('hold');const held=f.waitHold(),abort=new AbortController(),pending=f.engine.turn({runId:f.run.runId,input:'Pending candidate.',requestId:'cancel',signal:abort.signal});await held;assert.equal(fact(await f.read()).value,true);abort.abort();await assert.rejects(pending);assert.equal(hash(await f.read()),initial);assertPacket(f.calls.find(c=>c.stage==='director'),f.run,true);assertPacket(f.calls.find(c=>c.stage==='draft'),f.run,true);records.push({phase:'cancelled proposal preserves committed State',calls:copy(f.calls)});f.calls.length=0;
 f.setMode('off');await f.turn('off');let r=await f.read();assert.equal(fact(r).value,false);
 await f.engine.rollback({runId:r.runId,operationId:'rollback',expectedVersion:r.version,expectedHead:r.head});r=await f.read();assert.equal(fact(r).value,true);
 const restart=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:new DurableStore({root:f.root}),model:f.model,memory:f.memory});f.calls.length=0;await restart.turn({runId:r.runId,input:'Restarted.',requestId:'restart'});assertPacket(f.calls.find(c=>c.stage==='director'),r,true);assertPacket(f.calls.find(c=>c.stage==='draft'),r,true);records.push({phase:'rollback then Engine/Store restart uses restored committed State',basis:projectDerivedFacts(r,{writerOnly:true}),calls:copy(f.calls)});
 r=await f.read();f.calls.length=0;f.setMode('on');await restart.regenerate({runId:r.runId,operationId:'regen',requestId:'regen-result',expectedVersion:r.version,expectedHead:r.head});const after=await f.read();assert.equal(fact(after).value,true);assert.equal(f.calls[0].input.assembly.derivedFacts.facts[0].value,true,'Regenerate uses existing committed predecessor context, not the discarded proposal');
 records.push({phase:'regenerate follows existing committed predecessor context, operation epoch with predecessor head',publishedBefore:projectDerivedFacts(r,{writerOnly:true}),calls:copy(f.calls),publishedAfter:projectDerivedFacts(after,{writerOnly:true})});await fs.writeFile(new URL('../evidence/w01-derived-lifecycle-port.json',import.meta.url),JSON.stringify({source:'actual SceanEngine.model.generate arguments, synthetic only',records},null,2));
 assert.equal(hash(projectDerivedFacts(validateRunBundle(encodeRunBundle(after)))),hash(projectDerivedFacts(after)));
});
test('Snapshot freezes independent config and invalid frontend fact IDs cannot bypass admission',async()=>{
 const f=await setup(),before=hash(f.run),s=copy(f.snapshot);s.revision=2;s.derivedFacts=copy(f.rules);delete s.derivedFacts.hash;s.derivedFacts.version=2;s.derivedFacts.facts[0].name='New name';s.card.data.extensions.scean.derivedFacts=s.derivedFacts;await f.engine.createRun({snapshot:s});assert.equal(hash(await f.read()),before);
 const bad=copy(f.snapshot);delete bad.frontend.hash;bad.frontend.derivedBindings[0].factId='absent';await assert.rejects(f.engine.createRun({snapshot:bad}),{code:'FRONTEND_DERIVED_MISSING'});
});
test('No token quota silently removes required facts from actual Director/Draft packets',async()=>{
 const observations=[];
 for(const target of ['director','draft']){
  const f=await setup({frontend:false,capacity:stage=>stage===target?1:131072}),before=await f.read();await f.turn('complete-'+target);const c=f.calls.find(c=>c.stage===target);assert(c);assertPacket(c,before,true);
  const attempts=await f.store.readAttempts(f.run.runId),a=attempts.at(-1),d=target==='director'?a.contextPreflights.at(-1):a.stages.find(s=>s.stage==='draft').contextBudget;assert.equal(d.status,'ready');assert.equal(d.estimatedOverflow,true);assert(d.sources.some(s=>s.path.endsWith('/derivedFacts')&&s.mandatory&&s.included));observations.push({stage:target,diagnostics:d,dispatchedStages:f.calls.map(c=>c.stage),policy:'complete_authorized_packet_no_token_quota'});
 }
 await fs.writeFile(new URL('../evidence/w01-derived-complete-packets.json',import.meta.url),JSON.stringify(observations,null,2));
});

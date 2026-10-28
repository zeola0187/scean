import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {SceanEngine} from '../core/engine.mjs';import {DurableStore} from '../adapters/store.mjs';
import {DEFAULT_STORY_TIME} from '../core/story-clock.mjs';import {clone,hash} from '../core/contracts.mjs';
import {TIME_TOOL,timeControlView,prepareTemporalCandidate,validateTemporalRun,validateTemporalCheckpoint,assertBackgroundSource,timeSourceCatalog} from '../core/state-operations.mjs';
import {encodeRunBundle,validateRunBundle,TIME_ORIGIN_CAPABILITY} from '../core/save-bundle.mjs';
import {SceanHost} from '../plugin/host.mjs';import {timeConfirmationValue} from '../isolated/web/time-confirmation-ui.mjs';
import {pathToFileURL} from 'node:url';
import {createNativeModelPort} from '../plugin/native-model.mjs';
const base=process.env.W29_TEST_ROOT??new URL('../evidence/timecal4-tests/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');await fs.mkdir(base,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const refinement=(period='morning')=>({target:{dayOrdinal:1,periodId:period},basis:{kind:'editorial_choice',sourceRef:'input'}});
const composite=(extra={})=>({kind:'refine_then_advance',refinement:refinement(),advance:{kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},sourceRefs:['input'],...extra});
const call=(id,arguments_)=>({id,name:'resolve_turn_time',arguments:clone(arguments_)});
const reply=(op,id='time')=>({text:'',toolCalls:[call(id,op)]});
const oldConfirm=(r,target={dayOrdinal:1,periodId:'afternoon'})=>({schemaVersion:1,confirmed:true,mode:'refine',target,base:timeControlView(r).base});
const confirm=(r,role,target)=>({schemaVersion:2,confirmed:true,role,mode:role==='origin'?'refine':'advance_to',target,base:timeControlView(r).base});
async function fixture({onDirector,definition=DEFAULT_STORY_TIME,events=[],routine=false,timeoutMs=1200,postChanges=[]}={}){
 const root=await fs.mkdtemp(path.join(base,'origin-')),store=new DurableStore({root:path.join(root,'store')}),calls=[];let n=0;
 const model={timeoutMs,async generate(a){calls.push({stage:a.stage,input:clone(a.input)});
  if(a.stage==='director')return await onDirector?.(a,++n)??{text:JSON.stringify(a.input.handoffContract.example)};
  if(a.stage==='writer')return{text:JSON.stringify({sceanWriter:1,finalBody:'Synthetic scene at the supplied candidate time.',dialogue:[],candidateRef:a.input.context.temporal.candidateRef})};
  if(a.stage==='post_stat')return{text:JSON.stringify({contractVersion:2,candidateRef:a.input.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:clone(postChanges),memories:[]})};
  if(a.stage==='character')return{text:JSON.stringify({adviceVersion:1,characterId:'a',observable:{attitude:'calm',intent:'listen'},publicUtterances:[],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
  throw Error('UNEXPECTED_STAGE');
 }};
 const engine=new SceanEngine({postBody:false,store,model,memory:{retrieve:async()=>({records:[]}),clearCache(){}}});
 const r=await engine.createRun({runId:'origin-synthetic',snapshot:{schemaVersion:1,cardId:'origin-synthetic',revision:1,card:{data:{name:'Synthetic origin',first_mes:'Unselected alternate at nine.'}},opening:{id:'selected',title:'Selected',text:'The initial public scene is at ten in the morning.'},worldbook:{entries:[]},preset:{},characters:[{id:'a',name:'Synthetic actor',description:'A synthetic observer with no unstated facts.'}],storyTimeDefinition:clone(definition),publicEvents:clone(events),...(routine?{worldRoutineDefinition:{schemaVersion:2,calendar:true,forum:true,authorIds:['a'],medium:{id:'synthetic-forum',label:'Synthetic public forum'},ambientPosts:{schemaVersion:1,enabled:true,publicContext:'Synthetic public world.'}}}:{})}});
 return {root,store,engine,model,run:r,calls,turn:(opts={})=>engine.turn({runId:r.runId,input:'Synthetic same-day afternoon endpoint.',requestId:'origin-request',...opts})};
}
const valid=async f=>{const r=await f.store.read(f.run.runId);validateTemporalRun(r);validateRunBundle(encodeRunBundle(r));return r;};

test('model chooses same-day morning origin and afternoon endpoint in one candidate; no player form',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await f.turn();const r=await valid(f),t=r.turns[0];assert.equal(r.storyClock.periodId,'afternoon');assert.equal(r.storyClock.precision,'period');assert.deepEqual(t.clockBefore,f.run.storyClock);assert.equal(t.timeResolution.operation.kind,'refine_then_advance');assert.equal(r.storyEpoch,0);assert.deepEqual(r.baselineStoryClock,f.run.baselineStoryClock);assert.equal(encodeRunBundle(r).schemaVersion,12);assert(encodeRunBundle(r).manifest.requiredCapabilities.includes(TIME_ORIGIN_CAPABILITY));assert.equal(f.calls.filter(c=>c.stage==='director').length,2);
});
test('legal selected opening is a source, never host-parsed into time',async()=>{
 const op=composite({refinement:{target:{dayOrdinal:1,minuteOfDay:600},basis:{kind:'source_statement',sourceRef:'opening',quote:'at ten in the morning'}}});
 const f=await fixture({onDirector(a,n){if(n===1){assert.equal(a.input.assembly.timeSources.sources.find(s=>s.ref==='opening').kind,'selected_initial_opening_not_current_time');return reply(op);}}});assert.equal(f.run.storyClock.precision,'day');await f.turn();const writer=f.calls.find(c=>c.stage==='writer').input.context.temporal;assert.equal(writer.originResolution.clock.position.earliest.minuteOfDay,600);assert.equal(writer.originResolution.basis.sourceRef,'opening');await valid(f);
});
test('ordinary dialogue keeps day precision without a time call',async()=>{const f=await fixture();await f.turn();const r=await valid(f);assert.equal(r.storyClock.precision,'day');assert.equal(encodeRunBundle(r).schemaVersion,9);assert.equal(r.turns[0].timeResolution.operation.kind,'hold');});
test('refine-only keeps a period rather than forcing arbitrary minutes',async()=>{const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'refine_only',refinement:refinement('afternoon')});}});await f.turn();assert.equal((await valid(f)).storyClock.precision,'period');});
test('selector failure feeds back once, composite retains afternoon intent and succeeds',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{periodId:'afternoon'}},'bad');if(n===2){const e=JSON.parse(a.input.conversation.at(-1).result.text);assert.equal(e.code,'TIME_TARGET_INVALID');assert.equal(e.intent.target.periodId,'afternoon');return reply(composite(),'fixed');}}});await f.turn();const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.toolRecovery.used,1);assert.equal(a.tools[0].status,'failed');assert.equal((await valid(f)).storyClock.periodId,'afternoon');
});
test('only mechanically ambiguous origin receives a bounded refinement correction',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},'origin-missing');if(n===2){const e=JSON.parse(a.input.conversation.at(-1).result.text);assert.equal(e.recovery,'resolve_origin');assert.equal(e.candidateUnchanged,true);return reply(composite(),'resolved');}}});await f.turn();assert.equal((await valid(f)).storyClock.periodId,'afternoon');
});
for(const [name,op] of [['hold',{kind:'hold'}],['zero',{kind:'advance_by',amount:{minutes:0}}],['different-period',{kind:'advance_to',target:{dayOffset:0,periodId:'night'}}]])test('failed advance cannot be corrected to '+name,async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{periodId:'afternoon'}},'bad');if(n===2)return reply(op,'bypass');}});await assert.rejects(f.turn(),{code:'TOOL_RECOVERY_INTENT_CHANGED'});assert.deepEqual(await f.store.read(f.run.runId),f.run);assert(!f.calls.some(c=>c.stage==='writer'));
});
test('recovery cannot replace an already supplied same-day selector with tomorrow',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},'uncertain');if(n===2)return reply(composite({advance:{kind:'advance_to',target:{nextDay:true,periodId:'afternoon'}}}),'tomorrow');}});await assert.rejects(f.turn(),{code:'TOOL_RECOVERY_INTENT_CHANGED'});assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('same unresolved operation twice stops; no second correction or Writer',async()=>{
 const f=await fixture({onDirector(a,n){return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},'again-'+n);}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});assert.equal(f.calls.length,2);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('explicit needsPrecision is not an automatic guessing or recovery lane',async()=>{const f=await fixture({onDirector(){return reply({needsPrecision:true,sourceRefs:['input']});}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);});
test('known ten cannot be refined or advanced backwards to nine',async()=>{
 for(const op of [composite({refinement:{target:{dayOrdinal:1,minuteOfDay:540},basis:{kind:'editorial_choice',sourceRef:'input'}}}),{kind:'advance_to',target:{dayOrdinal:1,minuteOfDay:540}}]){const f=await fixture({definition:{...clone(DEFAULT_STORY_TIME),initial:{dayOrdinal:1,precision:'minute',minuteOfDay:600}},onDirector(){return reply(op);}});await assert.rejects(f.turn());assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);}
});
test('unknown source, fabricated quote and editorial quotation fail without commit',async()=>{
 for(const basis of [{kind:'source_statement',sourceRef:'private:other-character'},{kind:'source_statement',sourceRef:'opening',quote:'invented time quotation'},{kind:'editorial_choice',sourceRef:'input',quote:'pretend this was stated'}]){const f=await fixture({onDirector(){return reply(composite({refinement:{target:{dayOrdinal:1,periodId:'morning'},basis}}));}});await assert.rejects(f.turn());assert.deepEqual(await f.store.read(f.run.runId),f.run);}
});
test('active committed body may be cited, but future or retired references may not',async()=>{
 const f=await fixture();await f.turn({requestId:'prior'});const before=await f.store.read(f.run.runId),id=before.turns[0].commitId;
 f.model.generate=async a=>{f.calls.push({stage:a.stage,input:clone(a.input)});if(a.stage==='director'){if(!a.input.conversation.length)return reply(composite({refinement:{target:{dayOrdinal:1,periodId:'morning'},basis:{kind:'source_statement',sourceRef:'history:'+id,quote:'Synthetic scene'}}}));return{text:JSON.stringify(a.input.handoffContract.example)};}if(a.stage==='writer')return{text:JSON.stringify({sceanWriter:1,finalBody:'Synthetic next scene.',dialogue:[],candidateRef:a.input.context.temporal.candidateRef})};return{text:JSON.stringify({contractVersion:2,candidateRef:a.input.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:[],memories:[]})};};
 await f.turn({requestId:'citing'});const r=await valid(f);const tampered=clone(r);tampered.turns[1].timeResolution.operation.refinement.basis.sourceRef='history:'+r.turns[1].commitId;assert.throws(()=>validateTemporalRun(tampered),{code:'TIME_SOURCE_INVALID'});
});
test('same-day refinement never rewrites SourceCut or creates a day obligation',async()=>{
 const f=await fixture({routine:true,onDirector(a,n){if(n===1)return reply({kind:'refine_only',refinement:refinement('afternoon')});}});await f.turn();const r=await valid(f);assert.deepEqual(r.worldActivity.sourceCuts,f.run.worldActivity.sourceCuts);assert.deepEqual(r.worldActivity.dailyObligations,f.run.worldActivity.dailyObligations);assert.equal(r.storyEpoch,0);
});
test('refinement cannot settle a future or merely possible event early',async()=>{
 const event={id:'future',label:'Synthetic future event',start:{dayOrdinal:1,minuteOfDay:900},end:{dayOrdinal:1,minuteOfDay:960},requiredForScene:false};const f=await fixture({events:[event],onDirector(a,n){if(n===1)return reply({kind:'refine_only',refinement:refinement()});}});await f.turn();const r=await valid(f);assert.equal(r.worldActivity.occurrences.length,0);
 const g=await fixture({events:[event],onDirector(a,n){if(n===1)return reply(composite());}});await g.turn();assert.equal((await valid(g)).worldActivity.occurrences.length,0);assert(g.calls.find(c=>c.stage==='writer').input.context.temporal.transitions.every(e=>e.status==='possibly_due'));
});
test('required event inside an uncertain period still stops without making up minutes',async()=>{
 const f=await fixture({events:[{id:'hard',label:'Synthetic hard event',start:{dayOrdinal:1,minuteOfDay:900},end:{dayOrdinal:1,minuteOfDay:960},requiredForScene:true}],onDirector(){return reply(composite());}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('settled public events and prior receipts are not rewritten on later holds',async()=>{
 const f=await fixture({events:[{id:'past',label:'Synthetic prior event',start:{dayOrdinal:1,minuteOfDay:480},end:{dayOrdinal:1,minuteOfDay:540}}],onDirector(a,n){if(n===1)return reply(composite({refinement:{target:{dayOrdinal:1,minuteOfDay:600},basis:{kind:'editorial_choice',sourceRef:'input'}}}));}});await f.turn();const before=await valid(f);assert.equal(before.worldActivity.occurrences.length,2);await f.turn({requestId:'later'});const r=await valid(f);assert.deepEqual(r.worldActivity.occurrences,before.worldActivity.occurrences);assert.deepEqual(r.turns[0],before.turns[0]);assert.deepEqual(r.receipts['origin-request'],before.receipts['origin-request']);
});
test('cross-midnight advancement creates one frozen SourceCut without future State',async()=>{
 const f=await fixture({routine:true,postChanges:[{scope:'world',category:'facts',key:'arrival',operation:'set',value:true}],onDirector(a,n){if(n===1)return reply(composite({advance:{kind:'advance_to',target:{nextDay:true,periodId:'afternoon'}}}));}});await f.turn();const r=await valid(f);assert.equal(r.worldActivity.sourceCuts.length,2);assert.equal(r.worldActivity.dailyObligations.length,2);assert.deepEqual(r.worldActivity.sourceCuts[0],f.run.worldActivity.sourceCuts[0]);assert.equal(r.worldActivity.sourceCuts[1].day,2);assert.equal(r.worldActivity.sourceCuts[1].clock.position.earliest.minuteOfDay,0);assert.equal(r.worldActivity.sourceCuts[1].publicState.world.facts?.arrival,undefined);assert.equal(r.state.world.facts.arrival,true);
});
test('custom day and minute length use calendar arithmetic across midnight',async()=>{
 const definition={...clone(DEFAULT_STORY_TIME),hoursPerDay:20,minutesPerHour:100,periods:{morning:{start:500,end:999},afternoon:{start:1000,end:1499},night:{start:1500,end:1999}}};const f=await fixture({definition,onDirector(a,n){if(n===1)return reply(composite({advance:{kind:'advance_to',target:{dayOrdinal:2,minuteOfDay:100}}}));}});await f.turn();const r=await valid(f);assert.equal(r.storyClock.position.earliest.dayOrdinal,2);assert.equal(r.storyClock.position.earliest.minuteOfDay,100);
});
test('cross-day unknown origin is explicitly unsupported, never silently recut',async()=>{
 const f=await fixture();const r=clone(f.run);r.storyClock={...r.storyClock,precision:'range',position:{earliest:{dayOrdinal:1,minuteOfDay:1200},latest:{dayOrdinal:2,minuteOfDay:300}}};assert.throws(()=>prepareTemporalCandidate(r,composite(),{requestId:'synthetic',inputHash:hash('input'),input:'input'}),{code:'TIME_ORIGIN_DAY_UNRESOLVED'});assert.equal(f.calls.length,0);
});
test('player v2 origin can be followed by afternoon advance, old v1 remains locked',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}});}});await f.turn({timeConfirmation:confirm(f.run,'origin',{dayOrdinal:1,periodId:'morning'})});assert.equal((await valid(f)).storyClock.periodId,'afternoon');
 const g=await fixture({routine:true});await g.turn({timeConfirmation:oldConfirm(g.run)});const legacy=encodeRunBundle(await valid(g));assert.equal(legacy.schemaVersion,11);assert.equal(validateRunBundle(legacy).worldRoutine.schemaVersion,2);
});
test('player origin minute cannot be contradicted; a coarse constraint can be safely narrowed',async()=>{
 const f=await fixture({onDirector(){return reply(composite());}});await assert.rejects(f.turn({timeConfirmation:confirm(f.run,'origin',{dayOrdinal:1,minuteOfDay:600})}),{code:'TIME_REFINEMENT_OUTSIDE_BASE'});assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const g=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await g.turn({timeConfirmation:confirm(g.run,'origin',{dayOrdinal:1})});assert.equal((await valid(g)).storyClock.periodId,'afternoon');
});
test('player endpoint remains binding while Director resolves the unknown origin',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1){assert.equal(a.input.assembly.temporal.endpointPending,true);return reply(composite());}}});await f.turn({timeConfirmation:confirm(f.run,'endpoint',{dayOrdinal:1,periodId:'afternoon'})});assert.equal((await valid(f)).storyClock.periodId,'afternoon');
 const g=await fixture();await assert.rejects(g.turn({timeConfirmation:confirm(g.run,'endpoint',{dayOrdinal:1,periodId:'afternoon'})}),{code:'TIME_CONFIRMATION_ENDPOINT_REQUIRED'});assert.deepEqual(await g.store.read(g.run.runId),g.run);
});
test('UI supports day, period and minute with explicit optional v2 roles',async()=>{
 const f=await fixture(),c=timeControlView(f.run),v=timeConfirmationValue(c,{mode:'refine',day:'1',kind:'day',confirmed:true});assert.equal(v.schemaVersion,2);assert.equal(v.role,'origin');assert.deepEqual(v.target,{dayOrdinal:1});assert.equal(timeConfirmationValue(c,{mode:'advance_to',day:'1',kind:'period',period:'afternoon',confirmed:true}).role,'endpoint');assert.throws(()=>timeConfirmationValue(c,{mode:'refine',day:'1',kind:'day',confirmed:false}));assert.equal(f.calls.length,0);
});
test('new capability is explicit; tampered provenance, receipt or downgraded bundle fails',async()=>{
 const f=await fixture({routine:true,onDirector(a,n){if(n===1)return reply(composite());}});await f.turn();const r=await valid(f),b=encodeRunBundle(r);assert.equal(b.schemaVersion,12);assert.equal(b.manifest.requiredCapabilities.includes(TIME_ORIGIN_CAPABILITY),true);const low=clone(b);low.schemaVersion=10;assert.throws(()=>validateRunBundle(low));const bad=clone(b);bad.run.turns[0].timeResolution.operation.refinement.target.periodId='afternoon';bad.manifest.sha256=hash(bad.run);assert.throws(()=>validateRunBundle(bad));
});
test('rollback restores original unknown clock, retires background epoch, regenerate is atomic',async()=>{
 const f=await fixture({routine:true,onDirector(a){if(!a.input.conversation.length)return reply(composite({advance:{kind:'advance_to',target:{nextDay:true,periodId:'afternoon'}}}));}});await f.turn();const before=await valid(f),cut=before.worldActivity.sourceCuts[1],token={runId:before.runId,snapshotHash:before.snapshot.hash,epoch:before.storyEpoch,sourceCutId:cut.id,sourceCutHash:hash(cut)};
 await f.engine.rollback({runId:before.runId,operationId:'rollback',expectedVersion:before.version,expectedHead:before.head});const rolled=await valid(f);assert.deepEqual(rolled.storyClock.position,f.run.storyClock.position);assert.equal(rolled.storyEpoch,1);assert.throws(()=>assertBackgroundSource(rolled,token),{code:'BACKGROUND_SOURCE_STALE'});
 const g=await fixture({onDirector(a){if(!a.input.conversation.length)return reply(composite());}});await g.turn();const original=await valid(g);await g.engine.regenerate({runId:original.runId,operationId:'regenerate',requestId:'replacement',expectedVersion:original.version,expectedHead:original.head});const next=await valid(g);assert.equal(next.turns.length,1);assert.equal(next.retired.length,1);assert.equal(next.storyEpoch,1);assert.equal(next.storyClock.periodId,'afternoon');
});
test('new format export/restore and Host restart read without model redispatch',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await f.turn();const b=encodeRunBundle(await valid(f)),root=await fs.mkdtemp(path.join(base,'restore-')),store=new DurableStore({root:path.join(root,'store')});await store.create(validateRunBundle(clone(b)));let calls=0;const engine=new SceanEngine({postBody:false,store,model:{generate:async()=>{calls++;throw Error('NO_REDISPATCH');}},memory:{retrieve:async()=>({records:[]})}});for(let i=0;i<2;i++){const host=await new SceanHost({engine,root:path.join(root,'host'),worldRoutineAutomatic:false}).init();assert.equal((await host.inspect(f.run.runId)).turns.length,1);await host.close();}assert.equal(calls,0);
});
test('source change clears v2 consent before dispatch; success deduplicates same request',async()=>{
 const f=await fixture(),value=confirm(f.run,'origin',{dayOrdinal:1,periodId:'morning'});await f.turn({requestId:'first'});const count=f.calls.length;await assert.rejects(f.turn({requestId:'second',timeConfirmation:value}),{code:'TIME_CONFIRMATION_STALE'});assert.equal(f.calls.length,count);
 const g=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await g.turn();const n=g.calls.length;await g.turn();assert.equal(g.calls.length,n);
});
test('beforeRename failure, published unknown ack and unreadable result retain safe semantics',async()=>{
 for(const point of ['beforeRename','afterRename']){const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});f.store.fault=p=>{if(p===point)throw Object.assign(Error('synthetic IO'),{code:'EIO'});};if(point==='beforeRename'){await assert.rejects(f.turn(),{code:'EIO'});assert.deepEqual(await f.store.read(f.run.runId),f.run);}else{const result=await f.turn();assert.equal(result.status,'committed');assert.equal((await valid(f)).turns.length,1);const n=f.calls.length;await f.turn();assert.equal(f.calls.length,n);}}
});
test('fixed deadline and cancellation survive origin feedback; no free correction dispatch',async()=>{
 const f=await fixture({timeoutMs:200,onDirector:async(a,n)=>{if(n===1){await pause(80);return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},'bad');}await pause(200);return reply(composite(),'late');}});await assert.rejects(f.turn(),{code:'MODEL_TIMEOUT'});assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const c=new AbortController(),g=await fixture({onDirector(a,n){if(n===1)return reply({kind:'advance_to',target:{dayOffset:0,periodId:'afternoon'}},'bad');c.abort();return reply(composite(),'cancelled');}});await assert.rejects(g.turn({signal:c.signal}),{code:'CANCELLED'});assert.deepEqual(await g.store.read(g.run.runId),g.run);
});
test('schema declares distinct refinement, forward operation and clarification branches',()=>{
 const p=TIME_TOOL.function.parameters;assert(p.properties.kind.enum.includes('refine_then_advance'));assert(p.properties.kind.enum.includes('refine_only'));assert.equal(p.properties.refinement.properties.basis.properties.kind.enum.includes('editorial_choice'),true);assert(p.oneOf[0].not.anyOf.some(x=>x.required[0]==='refinement'));assert.equal(p.additionalProperties,false);
});

test('initial provisional uncertainty lets Director select an earlier safe period, never commit unresolved hold',async()=>{
 const event={id:'hard-later',label:'Synthetic later hard event',start:{dayOrdinal:1,minuteOfDay:900},end:{dayOrdinal:1,minuteOfDay:960},requiredForScene:true};
 const f=await fixture({events:[event],onDirector(a,n){if(n===1){assert.equal(a.input.assembly.temporal.settlementPending,true);return reply({kind:'refine_only',refinement:refinement()});}}});await f.turn();assert.equal((await valid(f)).storyClock.periodId,'morning');
 const g=await fixture({events:[event]});await assert.rejects(g.turn(),{code:'NEEDS_TIME_PRECISION'});assert.deepEqual(await g.store.read(g.run.runId),g.run);assert(!g.calls.some(c=>c.stage==='writer'));
});
test('new origin checkpoint authenticates provenance and original pins; prior-body cache cannot mask changed source',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await f.turn();const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(validateTemporalCheckpoint(f.run,a.temporalCheckpoint),true);const bad=clone(a.temporalCheckpoint);bad.candidate.originResolution.basis.sourceHash='0'.repeat(64);assert.throws(()=>validateTemporalCheckpoint(f.run,bad),{code:'TEMPORAL_CHECKPOINT_STALE'});
 const g=await fixture();await g.turn({requestId:'prior'});const before=await g.store.read(g.run.runId),id=before.turns[0].commitId,op=composite({refinement:{target:{dayOrdinal:1,periodId:'morning'},basis:{kind:'source_statement',sourceRef:'history:'+id}}});let round=0;
 g.model.generate=async a=>{if(a.stage==='director'){if(++round===1)return reply(op);return{text:JSON.stringify(a.input.handoffContract.example)};}if(a.stage==='writer')return{text:JSON.stringify({sceanWriter:1,finalBody:'Synthetic later story.',dialogue:[],candidateRef:a.input.context.temporal.candidateRef})};return{text:JSON.stringify({contractVersion:2,candidateRef:a.input.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:[],memories:[]})};};
 await g.turn({requestId:'source-use'});const r=await valid(g);validateTemporalRun(r);const changed=clone(r);changed.turns[0].body+=' Changed source.';assert.throws(()=>validateTemporalRun(changed),{code:'TEMPORAL_RESOLUTION_INVALID'});
});
test('published result with unreadable acknowledgement stops as unknown, then receipt deduplicates without model',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}}),original=f.store.read.bind(f.store);let blocked=false;
 f.store.fault=p=>{if(p==='afterRename'){blocked=true;throw Object.assign(Error('lost ack'),{code:'EIO'});}};
 f.store.read=async(...a)=>{if(blocked)throw Object.assign(Error('unreadable'),{code:'EACCES'});return original(...a);};
 await assert.rejects(f.turn(),{code:'COMMIT_OUTCOME_UNKNOWN'});blocked=false;f.store.read=original;f.store.fault=undefined;const calls=f.calls.length;const result=await f.turn();assert.equal(result.status,'committed');assert.equal(f.calls.length,calls);assert.equal((await valid(f)).turns.length,1);
});

test('composite selector failure cannot lose its advance purpose during correction',async()=>{
 const broken=composite({refinement:{target:{periodId:'morning'},basis:{kind:'editorial_choice',sourceRef:'input'}}});
 const f=await fixture({onDirector(a,n){if(n===1)return reply(broken,'bad-origin');if(n===2)return reply({kind:'hold'},'erase');}});await assert.rejects(f.turn(),{code:'TOOL_RECOVERY_INTENT_CHANGED'});assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const g=await fixture({onDirector(a,n){if(n===1)return reply(broken,'bad-origin');if(n===2)return reply(composite(),'fixed-origin');}});await g.turn();assert.equal((await valid(g)).storyClock.periodId,'afternoon');
});
test('actual sealed timecal3 reader rejects new v12 rather than silently losing resolution provenance',async()=>{
 assert(process.env.TIMECAL3_BASELINE_ROOT,'Verified baseline reader is required for this acceptance');const old=await import(pathToFileURL(path.join(process.env.TIMECAL3_BASELINE_ROOT,'core/save-bundle.mjs')));
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite());}});await f.turn();const b=encodeRunBundle(await valid(f));assert.equal(b.schemaVersion,12);assert.throws(()=>old.validateRunBundle(b),{code:'SAVE_FORMAT_VERSION'});
});

test('explicit next-day goal can keep whole-day precision rather than choosing midnight',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return reply(composite({advance:{kind:'advance_to',target:{nextDay:true}}}));}});await f.turn();const r=await valid(f);assert.equal(r.storyClock.precision,'day');assert.deepEqual(r.storyClock.position,{earliest:{dayOrdinal:2,minuteOfDay:0},latest:{dayOrdinal:2,minuteOfDay:1439}});assert.equal((await f.store.readAttempts(f.run.runId))[0].tools.length,1);
});
test('fixed-month date target and authored overlapping periods keep their mechanical meaning',async()=>{
 const definition={...clone(DEFAULT_STORY_TIME),calendar:{id:'fixed-synthetic',version:1,kind:'fixed-month',monthLengths:[10,10],anchor:{year:1,month:1,day:10}}};const f=await fixture({definition,onDirector(a,n){if(n===1)return reply(composite({advance:{kind:'advance_to',target:{date:{year:1,month:2,day:1},periodId:'afternoon'}}}));}});await f.turn();assert.equal((await valid(f)).storyClock.position.earliest.dayOrdinal,2);
 const overlap={...clone(DEFAULT_STORY_TIME),periods:{morning:{start:360,end:720},afternoon:{start:700,end:1079}}};const g=await fixture({definition:overlap,onDirector(){return reply(composite());}});await assert.rejects(g.turn(),{code:'NEEDS_TIME_PRECISION'});assert.deepEqual(await g.store.read(g.run.runId),g.run);
});
test('failed composite stops dependent batch advice, correction settles once and never replays skipped Character',async()=>{
 const bad=composite({refinement:{target:{periodId:'morning'},basis:{kind:'editorial_choice',sourceRef:'input'}}}),advice={id:'skipped',name:'consult_character',arguments:{characterId:'a',question:'Synthetic endpoint advice'}};
 const f=await fixture({onDirector(a,n){if(n===1)return{text:'',toolCalls:[call('bad',bad),advice]};if(n===2){assert.equal(JSON.parse(a.input.conversation.at(-1).result.text).code,'TOOL_NOT_EXECUTED');return{text:'',toolCalls:[call('fixed',composite()),{...advice,id:'after-settlement'}]};}}});await f.turn();const r=await valid(f);assert.equal(r.storyClock.periodId,'afternoon');assert.equal(f.calls.filter(c=>c.stage==='character').length,1);assert.equal(f.calls.find(c=>c.stage==='character').input.temporal.clock.periodId,'afternoon');assert(!(await f.store.readAttempts(r.runId))[0].tools.some(t=>t.id==='skipped'));
});
test('actual native SDK port carries composite schema and counts every real mock dispatch',async()=>{
 const f=await fixture(),reservations=[],settlements=[];let stage,n=0;
 const llm={resolveModelInfo:async()=>({context:{contextWindow:1000000},reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}}),async *stream(options){const a=JSON.parse(options.messages[0].content[0].text);let output;
  if(stage==='director'&&++n===1){assert(options.tools.find(t=>t.name==='resolve_turn_time').parameters.properties.kind.enum.includes('refine_then_advance'));yield{type:'tool-call-delta',index:0,id:'native-composite',name:'resolve_turn_time',argumentsDelta:JSON.stringify(composite())};yield{type:'finish',reason:{kind:'tool-calls'}};return;}
  if(stage==='director')output=a.handoffContract.example;
  else if(stage==='writer')output={sceanWriter:1,finalBody:'Synthetic native-port scene.',dialogue:[],candidateRef:a.context.temporal.candidateRef};
  else output={contractVersion:2,candidateRef:a.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:[],memories:[]};
  yield{type:'text-delta',index:0,text:JSON.stringify(output)};yield{type:'finish',reason:{kind:'stop'}};
 }};
 f.engine.model=createNativeModelPort({llm,agentDefaultModel:{currentSelection:()=>({provider:'offline',model:'synthetic',reasoningEffort:'off'})},usageLedger:{reserve:async r=>{stage=r.meta.stage;reservations.push(stage);return'usage-'+reservations.length;},settle:async(id,r)=>settlements.push({id,status:r.status})}});
 await f.turn();assert.equal((await valid(f)).storyClock.periodId,'afternoon');assert.equal(reservations.length,4);assert.equal(settlements.length,4);assert.deepEqual(reservations,['director','director','writer','post_stat']);assert.equal((await f.store.readAttempts(f.run.runId))[0].directorDispatches,2);
});

test('player v2 override contributes to candidate identity while old before remains unchanged',async()=>{
 const f=await fixture(),options={requestId:'same-synthetic-id',input:'Synthetic',inputHash:hash('Synthetic')};
 const a=prepareTemporalCandidate(f.run,{kind:'hold'},{...options,confirmation:confirm(f.run,'origin',{dayOrdinal:1,periodId:'morning'})});
 const b=prepareTemporalCandidate(f.run,{kind:'hold'},{...options,confirmation:confirm(f.run,'origin',{dayOrdinal:1,periodId:'afternoon'})});
 assert.notEqual(a.candidateRef,b.candidateRef);assert.notEqual(a.hash,b.hash);assert.deepEqual(a.clockBefore,f.run.storyClock);assert.deepEqual(b.clockBefore,f.run.storyClock);
});

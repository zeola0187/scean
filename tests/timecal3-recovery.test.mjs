import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {SceanEngine} from '../core/engine.mjs';import {DurableStore} from '../adapters/store.mjs';
import {DEFAULT_STORY_TIME} from '../core/story-clock.mjs';import {hash,clone,SceanError} from '../core/contracts.mjs';
import {timeControlView,validateTemporalRun} from '../core/state-operations.mjs';import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {timeConfirmationValue,mountTimeConfirmation} from '../isolated/web/time-confirmation-ui.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
const parent=process.env.W29_TEST_ROOT??path.resolve('../test-data');await fs.mkdir(parent,{recursive:true});
const bad={kind:'advance_to',target:{periodId:'afternoon'},sourceRefs:['input']},good={...bad,target:{...bad.target,dayOffset:0}};
const tool=(id,op=bad)=>({id,name:'resolve_turn_time',arguments:clone(op)}),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture({day=false,onDirector,timeoutMs=1000,managed=false}={}){
 const root=await fs.mkdtemp(path.join(parent,'tc3-')),store=new DurableStore({root}),calls=[];let n=0;
 const model={timeoutMs,managesDispatchBudget:managed,async generate(a){calls.push({stage:a.stage,input:clone(a.input)});
  if(a.stage==='director'){const reply=await onDirector?.(a,++n);return reply??{text:JSON.stringify(a.input.handoffContract.example)};}
  if(a.stage==='character')return {text:JSON.stringify({adviceVersion:1,characterId:'a',observable:{attitude:'calm',intent:'speak'},publicUtterances:[],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
  if(a.stage==='writer')return {text:JSON.stringify({sceanWriter:1,finalBody:'Synthetic safe dialogue.',dialogue:[],candidateRef:a.input.context.temporal.candidateRef})};
  if(a.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,candidateRef:a.input.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:[],memories:[]})};throw Error(a.stage);
 }};
 const engine=new SceanEngine({postBody:false,store,model,memory:{retrieve:async()=>({records:[]}),clearCache(){}}});
 const run=await engine.createRun({runId:'synthetic-timecal3',snapshot:{schemaVersion:1,cardId:'synthetic',revision:1,card:{data:{name:'Synthetic',first_mes:'上午十點'}},worldbook:{entries:[]},preset:{},characters:[{id:'a',name:'Synthetic actor',description:'Synthetic background'}],storyTimeDefinition:{...clone(DEFAULT_STORY_TIME),initial:day?{dayOrdinal:1,precision:'day'}:{dayOrdinal:1,precision:'minute',minuteOfDay:600}}}});
 return {engine,run,store,calls,model,root,turn:(extra={})=>engine.turn({runId:run.runId,input:'Explicit synthetic afternoon intent',requestId:'req-1',...extra})};
}
const confirm=(r,extra={})=>({schemaVersion:1,confirmed:true,mode:'refine',target:{dayOrdinal:1,periodId:'afternoon'},base:timeControlView(r).base,...extra});
test('missing selector feeds safe error to Director once, fixes before dependent batch, commits',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return {text:'',toolCalls:[tool('bad'),{id:'skip-char',name:'consult_character',arguments:{characterId:'a',question:'Synthetic advice'}}]};if(n===2){const feedback=JSON.parse(a.input.conversation.find(t=>t.role==='tool'&&t.toolCallId==='bad').result.text);assert.equal(feedback.code,'TIME_TARGET_INVALID');assert.equal(feedback.candidateUnchanged,true);assert.equal(feedback.validation.reason,'missing_date_selector');assert.equal(JSON.parse(a.input.conversation.at(-1).result.text).code,'TOOL_NOT_EXECUTED');return {text:'',toolCalls:[tool('fixed',good),{id:'char',name:'consult_character',arguments:{characterId:'a',question:'Synthetic advice'}}]};}}});
 await f.turn();const r=await f.store.read(f.run.runId),a=(await f.store.readAttempts(r.runId))[0];assert.equal(r.storyClock.periodId,'afternoon');assert.equal(a.tools[0].status,'failed');assert.equal(a.tools[0].error.code,'TIME_TARGET_INVALID');assert.equal(a.toolRecovery.used,1);assert.equal(f.calls.filter(c=>c.stage==='director').length,3);assert.equal(f.calls.filter(c=>c.stage==='character').length,1);assert(!a.tools.some(t=>t.id==='skip-char'));validateTemporalRun(r);validateRunBundle(encodeRunBundle(r));
});
test('same invalid operation repeated stops after one correction; no writer or canonical mutation',async()=>{
 const f=await fixture({onDirector(a,n){return {text:'',toolCalls:[tool('bad-'+n)]};}});await assert.rejects(f.turn(),{code:'TIME_TARGET_INVALID'});assert.equal(f.calls.length,2);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('earlier successful read is retained and not replayed during correction',async()=>{
 const history={name:'search_history',arguments:{query:'synthetic'}};
 const f=await fixture({onDirector(a,n){if(n===1)return{text:'',toolCalls:[{id:'read-1',...history}]};if(n===2)return{text:'',toolCalls:[tool('bad')]};if(n===3)return{text:'',toolCalls:[tool('fixed',good),{id:'read-2',...history}]};}});await f.turn();const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.tools.find(t=>t.id==='read-2').reusedFrom,'read-1');assert.equal(a.tools.find(t=>t.id==='read-1').status,'completed');assert.equal(f.calls.filter(c=>c.stage==='director').length,4);
});
test('repair shares original decision deadline; cancelled/expired attempt cannot dispatch repair',async()=>{
 const f=await fixture({timeoutMs:150,onDirector:async()=>{await pause(300);return{text:'',toolCalls:[tool('late')]};}});await assert.rejects(f.turn(),{code:'MODEL_TIMEOUT'});assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const controller=new AbortController(),c=await fixture({onDirector(){controller.abort();return{text:'',toolCalls:[tool('cancelled')]};}});await assert.rejects(c.turn({signal:controller.signal}),{code:'CANCELLED'});assert.equal(c.calls.length,1);
});
test('physical technical dispatches consume recovery allowance; no free semantic retry',async()=>{
 const f=await fixture({managed:true,onDirector:async(a)=>{for(let i=0;i<10;i++)await a.dispatchBudget.take();return{text:'',toolCalls:[tool('spent')]};}});await assert.rejects(f.turn(),{code:'TIME_TARGET_INVALID'});const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.directorDispatches,10);assert.equal(f.calls.length,1);
});
test('six-tool bound and fifth round stay enforced',async()=>{
 const f=await fixture({onDirector(a,n){return{text:'',toolCalls:Array.from({length:7},(_,i)=>tool('hold-'+n+'-'+i,{kind:'hold'}))};}});await assert.rejects(f.turn(),{code:'DIRECTOR_TOOL_LIMIT'});assert.equal(f.calls.length,1);
 const g=await fixture({onDirector(a,n){return{text:'',toolCalls:[tool('hold-'+n,{kind:'hold'})]};}});await assert.rejects(g.turn(),{code:'DIRECTOR_TOOL_LIMIT'});assert.equal(g.calls.length,5);
});
test('needsPrecision is not repairable and never guesses day or falls through hold',async()=>{
 const f=await fixture({day:true,onDirector(){return{text:'',toolCalls:[tool('precision',{needsPrecision:true,sourceRefs:['input']})]};}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);assert.equal(f.run.storyClock.precision,'day');
});
test('schema repair on broad day still asks player rather than guessing tomorrow',async()=>{
 const f=await fixture({day:true,onDirector(a,n){return{text:'',toolCalls:[tool('time-'+n,n===1?bad:good)]};}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});assert.equal(f.calls.length,2);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('explicit structured confirmation refines same day atomically; old history/base untouched; capability protected',async()=>{
 const f=await fixture({day:true});await f.turn({requestId:'hold-old'});const before=await f.store.read(f.run.runId),confirmation=confirm(before);await f.turn({requestId:'confirmed-new',timeConfirmation:confirmation});const r=await f.store.read(f.run.runId);
 assert.deepEqual(r.baselineStoryClock,f.run.baselineStoryClock);assert.deepEqual(r.turns[0],before.turns[0]);assert.equal(r.storyEpoch,0);assert.equal(r.storyClock.periodId,'afternoon');assert.equal(r.storyClock.position.earliest.dayOrdinal,1);assert.deepEqual(r.worldActivity.sourceCuts,before.worldActivity.sourceCuts);validateTemporalRun(r);const b=encodeRunBundle(r);assert.equal(b.schemaVersion,11);assert(b.manifest.requiredCapabilities.includes('storyTime.playerConfirmation.v1'));validateRunBundle(b);
 const copy=clone(b);copy.run.turns[1].timeConfirmation.target.periodId='morning';copy.manifest.sha256=hash(copy.run);assert.throws(()=>validateRunBundle(copy));const downgraded=clone(b);downgraded.schemaVersion=9;delete downgraded.manifest.requiredCapabilities;assert.throws(()=>validateRunBundle(downgraded));
 const cached=clone(r);validateTemporalRun(cached);cached.receipts[cached.turns[1].requestId].timeConfirmation.target.periodId='morning';assert.throws(()=>validateTemporalRun(cached),{code:'TIME_CONFIRMATION_INVALID'});
 const count=f.calls.length;await f.turn({requestId:'confirmed-new',timeConfirmation:confirmation});assert.equal(f.calls.length,count);
});
test('model cannot forge confirmation, stale source fails before dispatch, restart does not auto-apply',async()=>{
 const f=await fixture({day:true,onDirector(){return{text:'',toolCalls:[tool('forge',{kind:'confirm_time',mode:'refine',target:{dayOrdinal:1,periodId:'afternoon'},sourceRefs:['player_confirmation']})]};}});await assert.rejects(f.turn(),{code:'TIME_CONFIRMATION_REQUIRED'});assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const g=await fixture({day:true}),old=confirm(g.run);await g.turn({requestId:'hold'});const count=g.calls.length;await assert.rejects(g.turn({requestId:'new',timeConfirmation:old}),{code:'TIME_CONFIRMATION_STALE'});assert.equal(g.calls.length,count);
 const fresh=new SceanEngine({postBody:false,store:new DurableStore({root:g.root}),model:g.model,memory:{retrieve:async()=>({records:[]})}});assert.equal((await fresh.store.read(g.run.runId)).storyClock.precision,'day');assert.equal(g.calls.length,count);
});
test('changing confirmation under failed request identity is rejected, explicit new request allowed',async()=>{
 let fail=true;const f=await fixture({day:true,onDirector(){if(fail)return{text:'',toolCalls:[tool('needs',{needsPrecision:true})]};}});await assert.rejects(f.turn(),{code:'NEEDS_TIME_PRECISION'});const count=f.calls.length;fail=false;await assert.rejects(f.turn({timeConfirmation:confirm(f.run)}),{code:'TIME_CONFIRMATION_REQUEST_CHANGED'});assert.equal(f.calls.length,count);await f.turn({requestId:'new-confirmation',timeConfirmation:confirm(f.run)});assert.equal((await f.store.read(f.run.runId)).storyClock.periodId,'afternoon');
});
test('confirmation beforeRename failure keeps all domains; afterRename lost ack reconciles exactly once',async()=>{
 for(const point of ['beforeRename','afterRename']){const f=await fixture({day:true}),confirmation=confirm(f.run);f.store.fault=p=>{if(p===point)throw Object.assign(Error('synthetic IO'),{code:'EIO'});};if(point==='beforeRename'){await assert.rejects(f.turn({timeConfirmation:confirmation}),{code:'EIO'});assert.deepEqual(await f.store.read(f.run.runId),f.run);}else{const r=await f.turn({timeConfirmation:confirmation}),count=f.calls.length;assert.equal(r.status,'committed');await f.turn({timeConfirmation:confirmation});assert.equal(f.calls.length,count);assert.equal((await f.store.read(f.run.runId)).turns.length,1);}}
});
test('structured UI confirmation uses authored calendar ranges, requires consent and no prose parsing',async()=>{
 const f=await fixture({day:true}),c=timeControlView(f.run);assert.equal(c.initialDayPrecision,true);assert.equal(f.run.storyClock.precision,'day');const values={mode:'refine',day:'1',kind:'period',period:'afternoon',hour:'',minute:'',confirmed:true};assert.deepEqual(timeConfirmationValue(c,values),{...confirm(f.run),schemaVersion:2,role:'origin'});assert.throws(()=>timeConfirmationValue(c,{...values,confirmed:false}));assert.throws(()=>timeConfirmationValue(c,{...values,period:'invented'}));assert.throws(()=>timeConfirmationValue(c,{...values,kind:'minute',hour:'24',minute:'0'}));assert.equal(f.calls.length,0);
});
test('read-only query repair reuses successful Character advice without replay or disclosure',async()=>{
 const advice={name:'consult_character',arguments:{characterId:'a',question:'Synthetic advice'}};
 const f=await fixture({onDirector(a,n){if(n===1)return{text:'',toolCalls:[{id:'advice',...advice},{id:'bad-read',name:'search_history',arguments:{query:''}}]};if(n===2){const e=JSON.parse(a.input.conversation.at(-1).result.text);assert.equal(e.code,'HISTORY_QUERY_INVALID');return{text:'',toolCalls:[{id:'advice-again',...advice},{id:'fixed-read',name:'search_history',arguments:{query:'synthetic'}}]};}}});await f.turn();assert.equal(f.calls.filter(c=>c.stage==='character').length,1);const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.tools.find(t=>t.id==='advice-again').reusedFrom,'advice');
});
test('permission/cross-run failure is not recoverable',async()=>{
 const f=await fixture({onDirector(){return{text:'',toolCalls:[{id:'denied',name:'search_history',arguments:{runId:'other',query:'synthetic'}}]};}});await assert.rejects(f.turn(),{code:'HISTORY_CROSS_RUN'});assert.equal(f.calls.length,1);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('correction does not receive a fresh deadline and cancellation after feedback stops',async()=>{
 const f=await fixture({timeoutMs:1000,onDirector:async(a,n)=>{if(n===1){await pause(300);return{text:'',toolCalls:[tool('bad')]};}await pause(800);return{text:'',toolCalls:[tool('fixed',good)]};}});await assert.rejects(f.turn(),{code:'MODEL_TIMEOUT'});assert.equal(f.calls.filter(c=>c.stage==='director').length,2);assert.deepEqual(await f.store.read(f.run.runId),f.run);
 const controller=new AbortController(),g=await fixture({onDirector(a,n){if(n===1)return{text:'',toolCalls:[tool('bad')]};controller.abort();return{text:'',toolCalls:[tool('fixed',good)]};}});await assert.rejects(g.turn({signal:controller.signal}),{code:'CANCELLED'});assert.equal(g.calls.length,2);assert.deepEqual(await g.store.read(g.run.runId),g.run);
});
test('real confirmation widget clears consent on source changes and is read-only until explicit submit',async()=>{
 const f=await fixture({day:true}),nodes=[],doc={createElement(tag){const n={tag,value:'',checked:false,children:[],append(...c){this.children.push(...c);},replaceChildren(){this.children=[];}};nodes.push(n);return n;}},parent=doc.createElement('div'),ui=mountTimeConfirmation({parent,document:doc}),run={timeControls:timeControlView(f.run)};
 ui.update(run,false,{code:'NEEDS_TIME_PRECISION'});assert.equal(ui.read(),null);nodes.find(n=>n.tag==='button').onclick();const selects=nodes.filter(n=>n.tag==='select'),inputs=nodes.filter(n=>n.tag==='input');selects[0].value='refine';selects[1].value='period';selects[2].value='afternoon';inputs[0].value='1';assert.throws(()=>ui.read());inputs.at(-1).checked=true;assert.deepEqual(ui.read(),{...confirm(f.run),schemaVersion:2,role:'origin'});ui.update({timeControls:{...run.timeControls,base:{...run.timeControls.base,version:1}}},false);assert.equal(ui.read(),null);assert.equal(inputs.at(-1).checked,false);assert.equal(f.calls.length,0);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('authenticated operation admission carries confirmation, deduplicates and rejects changed confirmation',async()=>{
 const f=await fixture({day:true}),host=await new SceanHost({engine:f.engine,root:path.join(f.root,'host'),worldRoutineAutomatic:false}).init();try{
  const request={kind:'turn',runId:f.run.runId,input:'Explicit synthetic afternoon intent',requestId:'confirmed-request',operationId:'confirmed-operation',baseVersion:f.run.version,baseHead:null,timeConfirmation:confirm(f.run)};
  await host.jobs.submit(request);await host.jobs.active.get(f.run.runId)?.promise;const status=await host.jobs.status({runId:f.run.runId,operationId:request.operationId});assert.equal(status.status,'committed');assert.equal((await f.store.read(f.run.runId)).storyClock.periodId,'afternoon');const count=f.calls.length;await host.jobs.submit(request);assert.equal(f.calls.length,count);await assert.rejects(host.jobs.submit({...request,operationId:'changed-op',timeConfirmation:{...request.timeConfirmation,target:{dayOrdinal:1,periodId:'morning'}}}),{code:'IDEMPOTENCY_CONFLICT'});
  const row=host.jobs.ledger.records[0];assert.equal(row.timeConfirmationHash,hash(request.timeConfirmation));
 }finally{await host.close();}
});
test('Director cannot bypass a failed time decision by returning a hold handoff',async()=>{
 const f=await fixture({onDirector(a,n){if(n===1)return{text:'',toolCalls:[tool('bad')]};}});await assert.rejects(f.turn(),{code:'TOOL_RECOVERY_INCOMPLETE'});assert.equal(f.calls.length,2);assert.deepEqual(await f.store.read(f.run.runId),f.run);
});
test('actual native port journals and settles every correction dispatch with shared Director count',async()=>{
 const f=await fixture(),reservations=[],settlements=[];let activeStage,round=0;
 const llm={async resolveModelInfo(){return {defaultMaxTokens:4096,context:{contextWindow:100000}};},async *stream(options){const packet=JSON.parse(options.messages[0].content[0].text);let text;
  if(activeStage==='director'&&++round<=2){yield {type:'block-end',index:0,block:{type:'tool-call',id:'native-time-'+round,name:'resolve_turn_time',arguments:JSON.stringify(round===1?bad:good)}};yield {type:'usage',usage:{inputTokens:10,outputTokens:5}};yield {type:'finish',reason:{kind:'tool-calls'}};return;}
  if(activeStage==='director')text=JSON.stringify(packet.handoffContract.example);
  else if(activeStage==='writer')text=JSON.stringify({sceanWriter:1,finalBody:'Synthetic native-port dialogue.',dialogue:[],candidateRef:packet.context.temporal.candidateRef});
  else if(activeStage==='post_stat')text=JSON.stringify({contractVersion:2,candidateRef:packet.temporal.candidateRef,temporalCheck:{status:'consistent'},stateChanges:[],memories:[]});
  else throw Error(activeStage);
  yield {type:'text-delta',index:0,text};yield {type:'usage',usage:{inputTokens:10,outputTokens:5}};yield {type:'finish',reason:{kind:'stop'}};
 }};
 f.engine.model=createNativeModelPort({llm,selection:{provider:'synthetic',model:'offline'},timeoutMs:1000,usageLedger:{async reserve(r){reservations.push(r);activeStage=r.meta.stage;return String(reservations.length);},async settle(id,r){settlements.push({id,...r});}}});
 await f.turn();assert.equal(reservations.length,5);assert.equal(settlements.length,5);assert.equal(reservations.filter(r=>r.meta.stage==='director').length,3);const a=(await f.store.readAttempts(f.run.runId))[0];assert.equal(a.directorDispatches,3);assert.equal(a.toolRecovery.used,1);assert(reservations.every(r=>r.kind==='generation'));assert(settlements.every(r=>r.status==='completed'));
});
test('confirmed-time unknown commit reconciles on restart without another dispatch',async()=>{
 const f=await fixture({day:true}),confirmation=confirm(f.run),original=f.store.read.bind(f.store);let unreadable=false;f.store.read=async(...args)=>{if(unreadable)throw Error('synthetic unreadable');return original(...args);};f.store.fault=point=>{if(point==='afterRename'){unreadable=true;throw Error('synthetic lost acknowledgement');}};
 await assert.rejects(f.turn({timeConfirmation:confirmation}),{code:'COMMIT_OUTCOME_UNKNOWN'});const count=f.calls.length;unreadable=false;f.store.fault=null;const fresh=new SceanEngine({postBody:false,store:new DurableStore({root:f.root}),model:f.model,memory:{retrieve:async()=>({records:[]})}});const result=await fresh.turn({runId:f.run.runId,requestId:'req-1',input:'Explicit synthetic afternoon intent',timeConfirmation:confirmation});assert.equal(result.status,'committed');assert.equal(f.calls.length,count);assert.equal((await fresh.store.read(f.run.runId)).turns.length,1);
});

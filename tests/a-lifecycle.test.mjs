import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {SceanHost} from '../plugin/host.mjs';

const characterAdvice = (characterId, speech = 'A public suggestion, not an event.') => JSON.stringify({adviceVersion:1,characterId,observable:{attitude:'calm',intent:'consider the question'},publicUtterances:[speech],withheld:[],internal:{notes:[]},intendedDisclosures:[]});
const snapshot=()=>({schemaVersion:1,cardId:'synthetic-a',revision:'r1',card:{name:'Harbor',private:{secret:'CARD_SECRET'}},worldbook:{place:'harbor'},preset:{style:'concise'},characters:[{id:'kalt',name:'Kalt',description:'PRIVATE_BACKGROUND',publicDescription:'A navigator',identity:{gender:'female',source:'user-explicit'}}]});
const publicMemory=()=>({schemaVersion:2,text:'Kalt places a key by the chart.',access:{kind:'world_public'},knowers:['kalt'],characterIds:['kalt'],visibility:'public',epistemic:{kind:'fact'},credibility:'confirmed',participants:{speakers:[],actors:['kalt'],decisionMakers:['kalt']}});
function model(overrides={}){const calls=[];return {calls,async generate(args){calls.push(args);if(overrides[args.stage])return overrides[args.stage](args);if(args.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'key',operation:'set',value:'chart'}],memories:[publicMemory()]})};return {text:args.stage==='character'?characterAdvice(args.input.character.id):'Kalt places a key by the chart.',route:{requested:{provider:'dsh',model:'selected'},effective:{provider:'dsh',model:'selected'},responseModel:'selected',parameterSource:{maxTokens:'stage'},usageSource:'not_reported'},attempts:[{attempt:0,status:'completed'}]};}};}
async function setup(overrides={},create={}){await mkdir(new URL('../.test-data/',import.meta.url),{recursive:true});const root=await mkdtemp(new URL('../.test-data/a-life-',import.meta.url));const store=new DurableStore(join(root,'store'));const port=model(overrides);const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model:port,memory:new Memory()});const host=await new SceanHost({engine,root:join(root,'host')}).init();const run=(await host.createRun({snapshot:snapshot(),initialState:{world:{place:'harbor'},characters:{kalt:{private:{secret:'STATE_SECRET'},public:{role:'navigator'}}}},...create})).run;return {root,store,port,engine,host,run};}
const cancel=async(e,runId=e.run.runId)=>{const p=await e.host.progress(runId);return e.host.cancel({runId,operationId:p.operationId});};
const act=(e,extra={})=>e.host.request({action:'turn',runId:e.run.runId,requestId:'request-a',input:'Place the key.',...extra});

test('A lifecycle immutable run selection and opening reach own model port with public progress and provenance',async()=>{const e=await setup({}, {openingId:'opening-a',modelSelection:{provider:'route',model:'default'},stageModelSelections:{prose:{provider:'route',model:'polish'}}});const response=await act(e);assert.equal(response.ok,true);const result=response.value;assert.equal(e.run.openingId,'opening-a');for(const call of e.port.calls){assert.deepEqual(call.context.modelSelection,{provider:'route',model:'default'});assert.deepEqual(call.context.stageModelSelections,{prose:{provider:'route',model:'polish'}});}const p=await e.host.progress(e.run.runId);assert.equal(p.status,'committed');assert.equal(p.pending,false);assert.deepEqual(p.events.filter(x=>x.status==='pending').map(x=>x.stage),['chapter_recall','memory','director','draft','prose','banlist','post_stat','commit']);assert(p.events.every((x,i)=>x.sequence===i+1));assert(!JSON.stringify(p).includes('PRIVATE'));const view=await e.engine.inspect(e.run.runId);assert.equal(view.attempts[0].stages[0].result.route.responseModel,'selected');assert.equal(result.memories[0].source.snapshotHash,e.run.snapshot.hash);assert.equal(result.memories[0].source.revision,'r1');assert.equal(result.memories[0].source.requestId,'request-a');assert.equal((await e.host.listRuns())[0].turnCount,1);assert.equal((await e.host.draftGet(e.run.runId)).status,'empty');});

test('A1 owner consultation prevents raw context forwarding and PostStat preserves full private state',async()=>{const e=await setup({director:({input})=>input.conversation.length?{text:'Use public advice.'}:{text:'',toolCalls:[{id:'ask-kalt',name:'consult_character',arguments:{characterId:'kalt',question:'Your public view?'}}]}});assert.equal((await act(e)).ok,true);for(const call of e.port.calls.filter(call=>call.stage!=='character')){assert(!JSON.stringify(call.input).includes('STATE_SECRET'));assert(!JSON.stringify(call.input).includes('CARD_SECRET'));assert(!JSON.stringify(call.input).includes('PRIVATE_BACKGROUND'));}const cr=e.port.calls.find(c=>c.stage==='character').input;assert.equal(cr.character.description,'PRIVATE_BACKGROUND');assert.deepEqual(cr.ownState,{private:{secret:'STATE_SECRET'},public:{role:'navigator'}});const read=await e.store.read(e.run.runId);assert.equal(read.state.characters.kalt.private.secret,'STATE_SECRET');assert.equal(read.memories.length,1);});

test('A cancellation returns while ignoring provider is pending, rejects late result and preserves draft for retry',async()=>{let release,entered;const wait=new Promise(r=>entered=r);let hold=true;const e=await setup({director:async()=>{if(hold){entered();await new Promise(r=>release=r);}return {text:'Brief'};}});const pending=act(e);await wait;assert.equal((await cancel(e)).cancelRequested,true);const response=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('cancel hung')),1000))]);assert.equal(response.ok,false);assert.equal(response.error.category,'cancelled');assert.equal((await e.store.read(e.run.runId)).version,0);assert.equal((await e.host.draftGet(e.run.runId)).input,'Place the key.');release();await new Promise(r=>setTimeout(r,10));assert.equal((await e.store.read(e.run.runId)).version,0);hold=false;assert.equal((await act(e)).ok,true);assert.equal((await e.store.read(e.run.runId)).turns.length,1);});

test('A failed request identity rejects changed input before generation, same input retries and receipt avoids duplicate calls',async()=>{let fail=true;const e=await setup({draft:()=>{if(fail)throw Object.assign(Error('unsafe-provider-text'),{code:'MODEL_TIMEOUT',category:'model'});return {text:'Kalt places a key by the chart.'};}});const failure=await act(e);assert.equal(failure.error.category,'model');assert.equal(failure.error.stage,'draft');assert(!JSON.stringify(await e.engine.inspect(e.run.runId)).includes('unsafe-provider-text'));const count=e.port.calls.length;await assert.rejects(e.engine.turn({runId:e.run.runId,requestId:'request-a',input:'Different input'}),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(e.port.calls.length,count);fail=false;assert.equal((await act(e)).ok,true);const calls=e.port.calls.length;assert.equal((await act(e)).ok,true);assert.equal(e.port.calls.length,calls);assert.equal((await e.store.read(e.run.runId)).memories.length,1);});

test('A unknown commit acknowledgement and failed read recover same receipt without generating again',async()=>{const e=await setup();const originalRead=e.store.read.bind(e.store);let readBroken=false;e.store.read=async(...args)=>{if(readBroken)throw Object.assign(Error('read outage'),{code:'EIO'});return originalRead(...args);};e.store.fault=point=>{if(point==='afterRename'){readBroken=true;throw Object.assign(Error('ack outage'),{code:'EIO'});}};const failure=await act(e);assert.equal(failure.ok,false);assert.equal(failure.error.code,'COMMIT_OUTCOME_UNKNOWN');assert.equal(failure.error.category,'persistence');const count=e.port.calls.length;readBroken=false;e.store.fault=undefined;assert.equal((await act(e)).ok,true);assert.equal(e.port.calls.length,count);const read=await e.store.read(e.run.runId);assert.equal(read.turns.length,1);assert.equal(read.memories.length,1);});

test('A pre-publication persistence failure has no half-round and is retryable',async()=>{const e=await setup();e.store.fault=point=>{if(point==='beforeRename')throw Object.assign(Error('disk full'),{code:'ENOSPC'});};const failed=await act(e);assert.equal(failed.error.category,'persistence');const before=await e.store.read(e.run.runId);assert.equal(before.version,0);assert.equal(before.turns.length,0);assert.equal(before.memories.length,0);e.store.fault=undefined;assert.equal((await act(e)).ok,true);});

test('A new Node process restores failed draft and canonical revision; separate Runs do not share draft/progress/state',async()=>{const e=await setup({director:()=>{throw Object.assign(Error('transport'),{code:'MODEL_TRANSPORT_ERROR'});}});await act(e);const other=(await e.host.createRun({snapshot:{...snapshot(),revision:'r2'}})).run;await e.host.draftSave({runId:other.runId,input:'Second run draft',requestId:'second-a'});assert.equal((await e.host.draftGet(e.run.runId)).input,'Place the key.');assert.equal((await e.host.progress(other.runId)).status,'not_recorded');const imports={engine:new URL('../core/engine.mjs',import.meta.url).href,store:new URL('../adapters/store.mjs',import.meta.url).href,memory:new URL('../core/memory.mjs',import.meta.url).href,host:new URL('../plugin/host.mjs',import.meta.url).href};const code=`import {SceanEngine} from ${JSON.stringify(imports.engine)};import {DurableStore} from ${JSON.stringify(imports.store)};import {Memory} from ${JSON.stringify(imports.memory)};import {SceanHost} from ${JSON.stringify(imports.host)};const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:new DurableStore(${JSON.stringify(join(e.root,'store'))}),memory:new Memory(),model:{generate(){throw Error('No calls allowed')}}});const host=await new SceanHost({engine,root:${JSON.stringify(join(e.root,'host'))}}).init();console.log(JSON.stringify({draft:await host.draftGet(${JSON.stringify(e.run.runId)}),run:await engine.inspect(${JSON.stringify(e.run.runId)}),other:await host.draftGet(${JSON.stringify(other.runId)})}));`;const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(stderr)));});const restored=JSON.parse(stdout);assert.equal(restored.draft.requestId,'request-a');assert.equal(restored.run.snapshot.revision,'r1');assert.equal(restored.run.turns.length,0);assert.equal(restored.other.input,'Second run draft');});

test('A failure categories distinguish forbidden tool, PostStat and validation from model transport',async()=>{for(const [overrides,category] of [[{director:()=>({text:'',toolCalls:[{id:'bad',name:'write_private',arguments:{}}]})},'tool'],[{post_stat:()=>({text:'invalid JSON'})},'post_stat']]){const e=await setup(overrides);const result=await act(e);assert.equal(result.ok,false);assert.equal(result.error.category,category);assert.equal((await e.store.read(e.run.runId)).version,0);}});

test('A simultaneous submissions reserve Run before draft IO and do not overwrite the active input',async()=>{let entered,release;const waiting=new Promise(r=>entered=r);const e=await setup({director:async()=>{entered();await new Promise(r=>release=r);return {text:'Brief'};}});const first=act(e);const second=act(e,{requestId:'request-b',input:'Different competing input'});const rejected=await second;assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'RUN_BUSY');await waiting;assert.equal((await e.host.draftGet(e.run.runId)).input,'Place the key.');assert.equal((await e.host.draftGet(e.run.runId)).requestId,'request-a');release();assert.equal((await first).ok,true);assert.equal((await e.store.read(e.run.runId)).turns.length,1);});

test('A startup reconciles interrupted pending progress into failed and preserves its draft',async()=>{const e=await setup();await e.host.draftSave({runId:e.run.runId,input:'Interrupted input',requestId:'interrupted-a'});await e.store.writeAttempt(e.run.runId,{schemaVersion:1,attemptId:'attempt-interrupted-a',requestId:'interrupted-a',runId:e.run.runId,status:'pending',startedAt:new Date().toISOString(),input:'Interrupted input',stages:[{stage:'draft',status:'pending'}],tools:[],directorComplete:true});const restarted=await new SceanHost({engine:new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store:new DurableStore(join(e.root,'store')),model:e.port,memory:new Memory()}),root:join(e.root,'host')}).init();const progress=await restarted.progress(e.run.runId);assert.equal(progress.status,'failed');assert.equal(progress.pending,false);assert.equal(progress.lastFailure.code,'INTERRUPTED_BEFORE_COMMIT');assert.equal((await restarted.draftGet(e.run.runId)).input,'Interrupted input');assert.equal(e.port.calls.length,0);});

test('A draft persistence failure is classified before any model generation',async()=>{const e=await setup();e.host.persist=async()=>{throw Object.assign(Error('private path must not appear'),{code:'ENOSPC'});};const failure=await act(e);assert.equal(failure.ok,false);assert.equal(failure.error.category,'persistence');assert.equal(e.port.calls.length,0);assert.equal(e.host.running.size,0);assert(!JSON.stringify(failure).includes('private path'));assert.equal((await e.store.read(e.run.runId)).version,0);});

test('A operation ownership: pending A then selected B, cancelling captured A leaves B pending and rejects A late result',async()=>{
  const {SelectionEpoch}=await import('../isolated/web/view-model.mjs');
  const view=new SelectionEpoch(),waiting=new Map(),releases=new Map(),seen=new Map();
  const reached=id=>new Promise(resolve=>waiting.set(id,resolve));
  const e=await setup({director:async args=>{
    seen.set(args.context.runId,args);
    waiting.get(args.context.runId)?.();
    await new Promise(resolve=>releases.set(args.context.runId,resolve));
    return {text:`Public brief for ${args.context.runId}`};
  }});
  const a=e.run.runId,b=(await e.host.createRun({snapshot:{...snapshot(),revision:'r2'}})).run.runId;
  const waitA=reached(a),waitB=reached(b);
  view.select(a);const ownerA={...view.capture(),requestId:'switch-owner-a'};
  const pendingA=act(e,{requestId:ownerA.requestId});await waitA;
  const progressA=await e.host.progress(a);assert.equal(progressA.pending,true);assert.equal(progressA.requestId,ownerA.requestId);
  assert.equal(progressA.attemptId,seen.get(a).context.attemptId);
  view.select(b);const ownerB={...view.capture(),requestId:'switch-owner-b'};
  const pendingB=act(e,{runId:b,requestId:ownerB.requestId,input:'B places the key.'});await waitB;
  try{
    assert.equal(view.runId,b);assert.equal(view.current(ownerA),false);assert.equal(view.current(ownerB),true);
    assert.notEqual(seen.get(a).context.attemptId,seen.get(b).context.attemptId);
    assert.equal(e.host.cancel({runId:ownerA.runId,operationId:progressA.operationId}).cancelRequested,true);
    const cancelledA=await pendingA;assert.equal(cancelledA.error.category,'cancelled');
    assert.equal(seen.get(a).signal.aborted,true);assert.equal(seen.get(b).signal.aborted,false);
    assert.equal((await e.host.progress(b)).pending,true);assert.equal((await e.host.progress(b)).requestId,ownerB.requestId);
    releases.get(a)();await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await e.store.read(a)).version,0);assert.equal((await e.store.read(a)).turns.length,0);assert.equal((await e.store.read(a)).memories.length,0);
    assert.equal((await e.host.progress(a)).status,'cancelled');assert.equal((await e.host.progress(b)).pending,true);
    assert.equal(view.current(ownerA),false); // Late A cannot refresh selected B.
    releases.get(b)();const committedB=await pendingB;assert.equal(committedB.ok,true);
    const finalB=await e.store.read(b);assert.equal(finalB.turns.length,1);assert.equal(finalB.receipts[ownerB.requestId].attemptId,seen.get(b).context.attemptId);
    assert.equal(finalB.receipts[ownerA.requestId],undefined);assert(finalB.memories.every(m=>m.source.runId===b));
    assert.equal((await e.host.draftGet(a)).requestId,ownerA.requestId);assert.equal((await e.host.draftGet(b)).status,'empty');
  }finally{releases.get(a)?.();releases.get(b)?.();await cancel(e,a);await cancel(e,b);await Promise.allSettled([pendingA,pendingB]);}
});

test('A attempt ownership: cancelled old provider result cannot clear or commit over same Run retry while it is pending',async()=>{
  const waiting=[],releases=[],contexts=[];
  const e=await setup({director:async args=>{const index=contexts.push(args.context)-1;waiting[index]?.();await new Promise(resolve=>releases[index]=resolve);return {text:`Brief attempt ${index}`};}});
  const started1=new Promise(resolve=>waiting[0]=resolve),started2=new Promise(resolve=>waiting[1]=resolve);
  const first=act(e);await started1;await cancel(e);assert.equal((await first).error.category,'cancelled');
  const retry=act(e);await started2;
  try{
    assert.notEqual(contexts[0].attemptId,contexts[1].attemptId);
    releases[0]();await new Promise(resolve=>setImmediate(resolve));
    const pending=await e.host.progress(e.run.runId);assert.equal(pending.pending,true);assert.equal(pending.attemptId,contexts[1].attemptId);
    assert.equal((await e.store.read(e.run.runId)).version,0);
    releases[1]();assert.equal((await retry).ok,true);
    const read=await e.store.read(e.run.runId);assert.equal(read.turns.length,1);assert.equal(read.receipts['request-a'].attemptId,contexts[1].attemptId);
    const attempts=await e.store.readAttempts(e.run.runId);assert.equal(attempts.find(a=>a.attemptId===contexts[0].attemptId).status,'cancelled');assert.equal(attempts.find(a=>a.attemptId===contexts[1].attemptId).status,'committed');
  }finally{releases[0]?.();releases[1]?.();await cancel(e);await Promise.allSettled([retry]);}
});

test('A stale cancellation is rejected when same requestId retries with a new operation and attempt',async()=>{
  const waiting=[],releases=[],calls=[];
  const e=await setup({director:async args=>{const i=calls.push(args)-1;waiting[i]?.();await new Promise(resolve=>releases[i]=resolve);return {text:`Public brief ${i}`};}});
  const enteredOld=new Promise(resolve=>waiting[0]=resolve),enteredNew=new Promise(resolve=>waiting[1]=resolve);
  const old=act(e,{operationId:'operation-old'});await enteredOld;
  assert.equal(e.host.cancel({runId:e.run.runId}).reason,'identity_required');
  assert.equal(calls[0].signal.aborted,false);
  const oldIdentity=await e.host.progress(e.run.runId);
  assert.equal(oldIdentity.operationId,'operation-old');
  assert.equal(e.host.cancel({runId:e.run.runId,operationId:oldIdentity.operationId,requestId:oldIdentity.requestId}).cancelRequested,true);
  assert.equal((await old).error.category,'cancelled');
  const fresh=act(e,{operationId:'operation-new'});await enteredNew;
  try{
    const newIdentity=await e.host.progress(e.run.runId);
    assert.equal(newIdentity.requestId,oldIdentity.requestId);assert.notEqual(newIdentity.attemptId,oldIdentity.attemptId);
    assert.equal(newIdentity.operationId,'operation-new');
    assert.equal(e.host.cancel({runId:e.run.runId,operationId:oldIdentity.operationId,requestId:oldIdentity.requestId}).reason,'operation_mismatch');
    assert.equal(e.host.cancel({runId:e.run.runId,requestId:oldIdentity.requestId}).reason,'identity_required');
    assert.equal(e.host.cancel({runId:e.run.runId,attemptId:oldIdentity.attemptId}).reason,'attempt_mismatch');
    assert.equal(e.host.cancel({runId:e.run.runId,operationId:newIdentity.operationId,requestId:'unrelated-request'}).reason,'request_mismatch');
    assert.equal(calls[1].signal.aborted,false);
    releases[0]();await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await e.host.progress(e.run.runId)).pending,true);assert.equal((await e.host.progress(e.run.runId)).operationId,newIdentity.operationId);
    releases[1]();const result=await fresh;assert.equal(result.ok,true);assert.equal(result.value.trace.operationId,'operation-new');
    const run=await e.store.read(e.run.runId);assert.equal(run.turns.length,1);assert.equal(run.receipts['request-a'].attemptId,newIdentity.attemptId);
    const attempts=await e.store.readAttempts(e.run.runId);assert.equal(attempts.find(a=>a.attemptId===newIdentity.attemptId).operationId,'operation-new');
    const reused=await act(e,{operationId:'operation-old'});assert.equal(reused.ok,false);assert.equal(reused.error.code,'OPERATION_ID_REUSED');
  }finally{releases[0]?.();releases[1]?.();e.host.close();await Promise.allSettled([fresh]);}
});

test('A operation identity exists before stage starts and cancellation cannot use a null attempt as identity',async()=>{
  const e=await setup();const pending=act(e,{operationId:'operation-prestage'});
  const before=await e.host.progress(e.run.runId);assert.equal(before.operationId,'operation-prestage');assert.equal(before.pending,true);
  assert.equal(e.host.cancel({runId:e.run.runId,attemptId:null}).reason,'identity_required');
  assert.equal(e.host.cancel({runId:e.run.runId,operationId:'operation-prestage'}).cancelRequested,true);
  const result=await pending;assert.equal(result.ok,false);assert.equal(result.error.category,'cancelled');assert.equal(e.port.calls.length,0);assert.equal((await e.store.read(e.run.runId)).version,0);
});

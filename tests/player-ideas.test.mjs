import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePlayerIdeas,playerIdeasInput,parsePlayerIdeas,IDEA_CATEGORIES} from '../core/player-ideas.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
import {DEFAULT_STAGE_MAX_TOKENS,outputLimits} from '../adapters/model.mjs';

const response=()=>JSON.stringify({ideas:IDEA_CATEGORIES.map((category,index)=>({category,text:'Synthetic idea '+index}))});
function fixture(){
  const turns=Array.from({length:8},(_,i)=>({turn:i+1,requestId:'request-'+i,commitId:'commit-'+i,body:'Committed public body '+i,input:'INPUT_NOT_NEEDED',stateAfter:{hidden:'STATE_CANARY'},trace:'TRACE_CANARY'}));
  let run={runId:'ideas-run',head:'commit-7',version:8,snapshot:{hash:'snapshot-original',card:{secret:'CARD_CANARY'},worldbook:{content:'WORLDBOOK_CANARY'},preset:{instructions:'PRESET_CANARY'}},turns,receipts:Object.fromEntries(turns.map(t=>[t.requestId,{commitId:t.commitId,status:'committed'}])),state:{secret:'STATE_CANARY'},memories:['MEMORY_CANARY'],modelSelection:{provider:'configured',model:'same-model'},stageModelSelections:{writer:{provider:'other',model:'WRITER_ROUTE_CANARY'}}};
  const calls=[];const engine={store:{async read(){return structuredClone(run);},async write(){throw Error('NO_WRITES_ALLOWED');}},model:{async describe(args){calls.push({kind:'describe',...args});return {capabilities:{contextWindow:32000,outputLimit:1536}};},async generate(args){calls.push({kind:'generate',...args});return {text:response(),usage:{inputTokens:10,outputTokens:20,apiKey:'DO_NOT_COPY'},model:'configured/same-model'};}}};
  return {engine,calls,get run(){return run;},set run(value){run=value;},request:{runId:run.runId,expectedHead:run.head,expectedVersion:run.version,requestId:'ideas-request'}};
}

test('one optional call receives only last five committed public bodies and leaves all story data exact',async()=>{
  const f=fixture(),before=structuredClone(f.run),value=await generatePlayerIdeas(f.engine,f.request),call=f.calls.find(x=>x.kind==='generate');
  assert.equal(f.calls.filter(x=>x.kind==='generate').length,1);assert.equal(call.stage,'ideas');assert.deepEqual(call.tools,[]);assert.deepEqual(Object.keys(call.input).sort(),['directions','turns']);assert.deepEqual(call.input.turns.map(t=>t.turn),[4,5,6,7,8]);
  for(const value of ['STATE_CANARY','MEMORY_CANARY','CARD_CANARY','WORLDBOOK_CANARY','PRESET_CANARY','TRACE_CANARY','INPUT_NOT_NEEDED','WRITER_ROUTE_CANARY'])assert(!JSON.stringify(call).includes(value));
  assert.deepEqual(call.context.modelSelection,f.run.modelSelection);assert.equal(value.ideas.length,5);assert.deepEqual(value.usage,{inputTokens:10,outputTokens:20});assert.deepEqual(f.run,before);
});
test('retired, absent-receipt and incomplete bodies cannot enter inspiration',()=>{
  const f=fixture();f.run.receipts['request-7'].status='retired';delete f.run.receipts['request-6'];f.run.turns[5].body='';assert.deepEqual(playerIdeasInput(f.run).turns.map(x=>x.turn),[1,2,3,4,5]);
});
test('no committed story or stale request performs zero model calls',async()=>{
  const f=fixture();f.run.turns=[];await assert.rejects(generatePlayerIdeas(f.engine,f.request),{code:'IDEAS_NO_STORY'});assert.equal(f.calls.filter(x=>x.kind==='generate').length,0);
  await assert.rejects(generatePlayerIdeas(f.engine,{...f.request,expectedVersion:7}),{code:'IDEAS_STALE'});assert.equal(f.calls.filter(x=>x.kind==='generate').length,0);
});
test('changed head, source or version during generation invalidates the returned ideas without a second call',async()=>{
  for(const change of [r=>r.head='new-head',r=>r.version++,r=>r.snapshot.hash='new-snapshot']){
    const f=fixture();f.engine.model.generate=async args=>{f.calls.push({kind:'generate',...args});change(f.run);return {text:response()};};
    await assert.rejects(generatePlayerIdeas(f.engine,f.request),{code:'IDEAS_STALE'});assert.equal(f.calls.filter(x=>x.kind==='generate').length,1);
  }
});
test('a changed story during free model metadata resolution stops before paid dispatch',async()=>{
  const f=fixture();f.engine.model.describe=async()=>{f.run.version++;return {};};await assert.rejects(generatePlayerIdeas(f.engine,f.request),{code:'IDEAS_STALE'});assert.equal(f.calls.filter(x=>x.kind==='generate').length,0);
});
test('basic structure validation has no semantic classifier or repair call',async()=>{
  const weird={ideas:IDEA_CATEGORIES.map(category=>({category,text:'<script>Only displayed as text</script> A bold, possibly impossible idea.'}))};assert.equal(parsePlayerIdeas(JSON.stringify(weird)).length,5);
  for(const invalid of ['not JSON','{}',JSON.stringify({ideas:weird.ideas.slice(0,4)}),JSON.stringify({ideas:[weird.ideas[0],...weird.ideas.slice(0,4)]})])assert.throws(()=>parsePlayerIdeas(invalid),{code:'IDEAS_INVALID_RESPONSE'});
  const f=fixture();f.engine.model.generate=async args=>{f.calls.push({kind:'generate',...args});return {text:'bad'};};await assert.rejects(generatePlayerIdeas(f.engine,f.request),{code:'IDEAS_INVALID_RESPONSE'});assert.equal(f.calls.filter(x=>x.kind==='generate').length,1);
});
test('tool calls and truncated responses are never followed or repaired',async()=>{
  for(const extra of [{toolCalls:[{name:'consult_character'}]},{finishReason:'length'}]){const f=fixture();let count=0;f.engine.model.generate=async()=>{count++;return {text:response(),...extra};};await assert.rejects(generatePlayerIdeas(f.engine,f.request),{code:'IDEAS_INVALID_RESPONSE'});assert.equal(count,1);}
});
test('long context is locally bounded to recent excerpts, keeping configured output reserve unchanged',()=>{
  const f=fixture();for(const t of f.run.turns)t.body='長'.repeat(6000);const input=playerIdeasInput(f.run,{contextWindow:7000,outputReserve:3000});assert.equal(input.turns.length,3);assert(input.turns.every(t=>t.body.length<6000));assert.equal(input.turns.at(-1).turn,8);
  assert.throws(()=>playerIdeasInput(f.run,{contextWindow:1000,outputReserve:3000}),{code:'IDEAS_CONTEXT_LIMIT'});
});
test('cancel rejects promptly and does not spawn replacement work',async()=>{
  const f=fixture(),controller=new AbortController();let entered,release;const began=new Promise(r=>entered=r);
  f.engine.model.generate=async()=>{entered();return new Promise(r=>release=r);};const pending=generatePlayerIdeas(f.engine,{...f.request,signal:controller.signal});await began;controller.abort();await assert.rejects(pending,{code:'CANCELLED'});release({text:response()});
  const stopped=new AbortController();stopped.abort();let calls=0;f.engine.model.generate=async()=>{calls++;return {text:response()};};await assert.rejects(generatePlayerIdeas(f.engine,{...f.request,signal:stopped.signal}),{code:'CANCELLED'});assert.equal(calls,0);
});
test('native routing preserves explicit model and usage journal while ideas never technically retries',async()=>{
  let dispatches=0;const reservations=[],settled=[],requested=[];
  const model=createNativeModelPort({llm:{async resolveModelInfo(provider,name){requested.push([provider,name]);return {};},async *stream(){dispatches++;throw Object.assign(Error('synthetic transport'),{code:'SERVER'});}},agentDefaultModel:{currentSelection:()=>({provider:'default',model:'base'})},usageLedger:{async reserve(row){reservations.push(row);return 'reserved';},async settle(id,row){settled.push({id,...row});}},stageSelections:{ideas:{provider:'configured',model:'quick'}},stageMaxTokens:{ideas:777},technicalRetries:1});
  await assert.rejects(model.generate({stage:'ideas',system:'Synthetic only',input:{turns:[]},tools:[],context:{runId:'ideas-run',requestId:'inspiration'}}),{code:'SERVER'});
  assert.equal(dispatches,1);assert.equal(reservations.length,1);assert.equal(settled.length,1);assert.equal(reservations[0].meta.stage,'ideas');assert.equal(reservations[0].meta.maxTokens,777);assert.deepEqual(requested,[['configured','quick']]);
  assert.equal(DEFAULT_STAGE_MAX_TOKENS.ideas,1536);assert.equal(outputLimits({stageMaxTokens:{ideas:321}})('ideas'),321);
});

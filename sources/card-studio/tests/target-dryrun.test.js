import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dryrunTarget } from '../cardstudio-bundle/lib/target-dryrun.js';
import { validateTargetState,reduceTargetUpdate,startTargetWriter,targetInputStamp } from '../cardstudio-bundle/lib/target-state.js';
import { compileTarget } from '../cardstudio-bundle/lib/target-profile.js';
import { createVisualContract } from '../cardstudio-bundle/lib/visual-state.js';

const definition={profile:'tauritavern-helper-ejs-v1',namespace:'synthetic_state',digest:'synthetic-digest',fields:{score:{type:'number',min:0,max:10},open:{type:'boolean'},phase:{type:'string',enum:['low','high']},items:{type:'array',maxItems:3}},contract:{characters:{guide:{expressions:['neutral','happy'],dimensions:{outfit:['plain']},variants:[]}}},initialState:{values:{score:0,open:false,phase:'low',items:[]}},assets:{}};
const previous=()=>validateTargetState(definition,definition.initialState);
const reduce=(message,role='assistant',state=previous())=>reduceTargetUpdate(definition,{message,role},state,validateTargetState);
const block=payload=>'<state-update>'+JSON.stringify(payload)+'</state-update>';

test('sequential synthetic first/second envelope replay rejects flat fields and retains the entire previous state',()=>{
  const d={...definition,fields:{bond:{type:'number',min:0,max:100},hours:{type:'number',min:0,max:36},week:{type:'number',min:1,max:12}},initialState:{values:{bond:5,hours:2,week:1}}};
  const r=dryrunTarget(d,[{payload:{values:{bond:6,hours:3,week:1}},expect:'accepted'},{payload:{bond:7,hours:7.5,week:1},previous_case:true,expect:'rejected'},{payload:{values:{bond:7,hours:7.5,week:1}},previous_case:true,expect:'accepted'},{payload:{values:{bond:7,hours:7.5,week:1}},previous_case:true,expect:'accepted'}]);
  assert.ok(r.results.every(x=>x.expectationMatched));assert.equal(r.runtimeVerified,false);assert.equal(r.fixtureOnly,true);
  assert.deepEqual(r.results[1].state,r.results[0].state);assert.deepEqual(r.results[1].appliedPaths,[]);assert.equal(r.results[1].diagnostic.code,'STATE_ENVELOPE');assert.equal(r.results[1].retained,'entire previous state');
  assert.deepEqual(r.results[2].state.values,{bond:7,hours:7.5,week:1});assert.deepEqual(r.results[3].changedPaths,[]);assert.equal(r.results[3].accepted,true);
});

test('typed/bounded/unknown-section-field-character/scene refusals are strict and never partly apply',()=>{
  const state=previous(),frozen=structuredClone(state);
  const payloads=[{values:{score:6},extra:{}},{values:{unknown:1}},{values:{score:'6'}},{values:{score:11}},{values:{open:1}},{values:{phase:'unknown'}},{values:{items:['a','b','c','d']}},{characters:{unknown:{expression:'neutral'}}},{characters:{guide:{expression:'unknown'}}},{characters:{guide:{outfit:'fancy'}}},{values:{score:6},scene:{location:'undeclared'}},{values:[]},null,[]];
  for(const payload of payloads){const r=reduce(block(payload),'assistant',state);assert.equal(r.accepted,false,JSON.stringify(payload));assert.deepEqual(r.state,frozen);assert.deepEqual(r.appliedPaths,[]);assert.ok(r.diagnostic.code.startsWith('STATE_'));assert.deepEqual(state,frozen);}
  const accepted=reduce(block({values:{score:6},characters:{guide:{expression:'happy'}}}));assert.equal(accepted.accepted,true);assert.equal(accepted.state.values.open,false);assert.equal(accepted.state.characters.guide.expression,'happy');assert.ok(accepted.changedPaths.includes('/values/score'));
});

test('bounded shared parsing distinguishes user/no-update/no-op/multiple/bad JSON and excessive payloads',()=>{
  assert.equal(reduce('A narrative without an update.').status,'no_update');assert.equal(reduce(block({bad:'ignored'}),'user').status,'no_update');
  assert.equal(reduce(block({values:{score:0}})).status,'accepted');assert.deepEqual(reduce(block({values:{score:0}})).changedPaths,[]);
  assert.equal(reduce(block({values:{score:1}})+block({values:{score:2}})).diagnostic.code,'STATE_BLOCK_COUNT');
  assert.equal(reduce('<state-update>{bad}</state-update>').diagnostic.code,'STATE_JSON');
  assert.equal(reduce(block({values:{phase:'x'.repeat(17000)}})).diagnostic.code,'STATE_UPDATE_LIMIT');
  assert.equal(reduce('x'.repeat(2*1024*1024+1)).diagnostic.code,'STATE_MESSAGE_LIMIT');
});

test('previous snapshot identity/types and input/evidence limits reject invalid synthetic cases without script evaluation',()=>{
  const good={profile:definition.profile,definition:definition.digest,state:previous()};
  assert.equal(dryrunTarget(definition,[{payload:{values:{score:1}},previous_snapshot:good}]).results[0].status,'accepted');
  assert.deepEqual(good.state,previous());
  for(const snapshot of [null,{...good,profile:'wrong'},{...good,definition:'wrong'},{...good,state:{values:{score:'0',open:false,phase:'low',items:[]}}}])assert.throws(()=>dryrunTarget(definition,[{payload:{values:{}},previous_snapshot:snapshot}]),{code:'TARGET_PREVIOUS_INVALID'});
  assert.throws(()=>dryrunTarget(definition,Array.from({length:17},()=>({payload:{values:{}}}))),{code:'TARGET_DRYRUN_LIMIT'});
  assert.throws(()=>dryrunTarget(definition,[{message:'x'.repeat(65536)}]),{code:'TARGET_DRYRUN_LIMIT'});
  assert.throws(()=>dryrunTarget(definition,[{payload:{},previous_case:true}]),{code:'TARGET_PREVIOUS_INVALID'});
  assert.throws(()=>dryrunTarget(definition,[{payload:{},message:'x'}]),{code:'TARGET_DRYRUN_CASE'});
});

test('generated rules use this schema, a concrete legal values envelope and only declared sections/IDs',()=>{
  const config={profile:definition.profile,namespace:definition.namespace,fields:definition.fields,initialState:definition.initialState,source:'<section>{{sample::score}}</section>'};
  const contract=createVisualContract({characters:{guide:{displayName:'Guide',dimensions:{},variants:[]}}});
  const a={contract,assetManifest:{schemaVersion:1,assets:[]}},compiled=compileTarget(config,a),prompt=compiled.prompt;
  assert.match(prompt,/根物件只允許 values、characters/);assert.match(prompt,/禁止將 score、open、phase、items/);assert.match(prompt,/未宣告場景；禁止提供 scene/);assert.doesNotMatch(prompt,/場景ID：\{\}|bond|hours|week|Teresa/);
  const literal=prompt.match(/合法完整外層範例：<state-update>(.*?)<\/state-update>/)[1];assert.deepEqual(JSON.parse(literal),{values:definition.initialState.values});
  assert.equal(reduceTargetUpdate({...definition,contract},{role:'assistant',message:block(JSON.parse(literal))},previous(),validateTargetState).accepted,true);
  assert.ok(compiled.script.content.includes(reduceTargetUpdate.toString()));assert.ok(compiled.script.content.includes(validateTargetState.toString()));
});

test('generated writer health tracks accepted/rejected attempts and treats user floors and legal no-op honestly',async()=>{
  const messages=[{role:'assistant',message:'Greeting',data:{}}],events=new Map(),errors=[];
  const context={console:{error:(...args)=>errors.push(args.join(' '))},SillyTavern:{getCurrentChatId:()=> 'synthetic-health',saveChat:async()=>{}},getLastMessageId:()=>messages.length-1,getVariables:({message_id})=>messages[message_id].data,getChatMessages:i=>[messages[i]],setChatMessages:async writes=>{for(const w of writes)messages[w.message_id].data=structuredClone(w.data);},eventOn:(name,fn)=>{events.set(name,fn);return {stop(){}};},eventEmit:async()=>{},tavern_events:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_SENT','MESSAGE_UPDATED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SWIPE_DELETED','CHAT_CHANGED'].map(n=>[n,n])),window:{addEventListener(){}}};
  vm.runInNewContext('('+startTargetWriter.toString()+')('+JSON.stringify(definition)+','+validateTargetState.toString()+','+targetInputStamp.toString()+','+reduceTargetUpdate.toString()+')',context);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,5));await settle();
  async function add(role,message,event='MESSAGE_RECEIVED'){messages.push({role,message,data:{}});await events.get(event)(messages.length-1);await settle();return messages.at(-1).data.synthetic_state;}
  const accepted=await add('assistant',block({values:{score:5,open:true,phase:'high'}}));assert.equal(accepted.health.lastAccepted.messageId,1);assert.equal(accepted.health.lastAccepted.noOp,false);
  const rejected=await add('assistant',block({score:7}));assert.equal(rejected.error,'Invalid state envelope');assert.deepEqual(rejected.state,accepted.state);assert.equal(rejected.health.lastRejected.messageId,2);assert.equal(rejected.health.rejectedAttempts,1);
  const user=await add('user','Keep playing.','MESSAGE_SENT');assert.equal(user.health.latest.status,'no_update');assert.equal(user.health.rejectedAttempts,1);assert.equal(user.health.lastAccepted.messageId,1);
  const noOp=await add('assistant',block({values:{score:5}}));assert.equal(noOp.health.lastAccepted.noOp,true);assert.equal(noOp.health.rejectedAttempts,0);assert.equal(noOp.health.lastRejected.reason,'Invalid state envelope');assert.equal(errors.length,0,errors.join('\n'));
  assert.equal(noOp.input.stamp,targetInputStamp(messages.at(-1).message));assert.equal(noOp.input.messageId,messages.length-1);
});

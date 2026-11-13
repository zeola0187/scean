import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mountTimeConfirmation} from '../isolated/web/time-confirmation-ui.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {DEFAULT_STORY_TIME} from '../core/story-clock.mjs';
import {timeControlView} from '../core/state-operations.mjs';
import {hash} from '../core/contracts.mjs';

const control=()=>({base:{runId:'synthetic-run',snapshotHash:'synthetic-snapshot',version:0,head:null,clockHash:'clock'},definition:{hoursPerDay:24,minutesPerHour:60,periods:{morning:{start:360,end:719}}},uncertain:true,initialDayPrecision:true});
function widget(){
 const nodes=[],document={createElement(tag){const node={tag,textContent:'',value:'',checked:false,hidden:false,children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};nodes.push(node);return node;}};
 const parent=document.createElement('div'),ui=mountTimeConfirmation({parent,document});
 return {ui,nodes,box:parent.children[0],button:nodes.find(n=>n.tag==='button'),note:nodes.filter(n=>n.tag==='p')[0],explanation:nodes.filter(n=>n.tag==='p')[1],form:nodes.find(n=>n.tag==='fieldset'),selects:nodes.filter(n=>n.tag==='select'),inputs:nodes.filter(n=>n.tag==='input')};
}

test('post-body optional control stays available without obsolete Director precision prompts',()=>{
 const f=widget();f.ui.update({settlementPolicy:'post-body-v1',timeControls:control()},false);
 assert.equal(f.box.hidden,false);assert.equal(f.button.textContent,'指定結算時間（選填）');assert.equal(f.note.hidden,true);
 assert.equal(f.form.hidden,true);assert.equal(f.ui.read(),null);
 assert.match(f.explanation.textContent,/直接在輸入中描述/);assert.match(f.explanation.textContent,/結算/);assert.doesNotMatch(f.explanation.textContent,/導演/);
 const later={...control(),initialDayPrecision:false};f.ui.update({settlementPolicy:'post-body-v1',timeControls:later},false);assert.equal(f.note.hidden,true);
});

test('legacy precision guidance and real source-change warnings remain visible',()=>{
 const f=widget(),run={timeControls:control()};f.ui.update(run,false);
 assert.equal(f.button.textContent,'補充／確認時間');assert.equal(f.note.hidden,false);assert.match(f.note.textContent,/導演/);
 f.button.onclick();f.ui.update({settlementPolicy:'post-body-v1',timeControls:{...control(),base:{...control().base,version:1}}},false);
 assert.equal(f.note.hidden,false);assert.match(f.note.textContent,/先前時間確認已清除/);assert.equal(f.ui.read(),null);
 f.ui.update({settlementPolicy:'post-body-v1',timeControls:control()},false,{code:'NEEDS_TIME_PRECISION'});assert.equal(f.note.hidden,false);assert.match(f.note.textContent,/尚未提交/);
 f.ui.update(null,false);assert.equal(f.box.hidden,true);
});

test('post-body form still requires explicit consent and preserves day precision without choosing midnight',()=>{
 const f=widget(),run={settlementPolicy:'post-body-v1',timeControls:control()};f.ui.update(run,false);f.button.onclick();
 f.selects[0].value='advance_to';f.selects[1].value='day';f.inputs[0].value='2';
 assert.throws(()=>f.ui.read(),{code:'TIME_CONFIRMATION_INVALID'});f.inputs.at(-1).checked=true;
 assert.deepEqual(f.ui.read(),{schemaVersion:2,confirmed:true,role:'endpoint',mode:'advance_to',target:{dayOrdinal:2},base:control().base});
 f.ui.update(run,true);assert.equal(f.button.disabled,true);assert.equal(f.form.disabled,true);
 f.ui.update({...run,timeControls:{...control(),base:{...control().base,version:1}}},false);assert.equal(f.ui.read(),null);assert.equal(f.inputs.at(-1).checked,false);
});

async function fixture(t,time){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'scean-post-time-controls-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new DurableStore({root}),calls=[],input='翌日早上再去港口。';
 const model={async generate(a){calls.push({stage:a.stage,input:structuredClone(a.input)});
  if(a.stage==='director')return{text:JSON.stringify({sceneIntent:'Follow the synthetic player request.'})};
  if(a.stage==='writer')return{text:JSON.stringify({finalBody:'The synthetic player visits the harbor the next morning.',dialogue:[]})};
  if(a.stage==='post_stat')return{text:JSON.stringify({time,stateChanges:[]})};
  throw Error('Unexpected synthetic stage');
 }};
 const engine=new SceanEngine({store,model,memory:{retrieve:async()=>({records:[]})}}),run=await engine.createRun({runId:'post-time-control-run',snapshot:{schemaVersion:1,cardId:'synthetic-card',revision:1,card:{name:'Synthetic world'},worldbook:{entries:[]},preset:{},characters:[{id:'observer',name:'Synthetic observer',description:'A public synthetic observer.'}],storyTimeDefinition:{...structuredClone(DEFAULT_STORY_TIME),initial:{dayOrdinal:1,precision:'day'}}}});
 return {store,engine,run,calls,input,turn:confirmation=>engine.turn({runId:run.runId,requestId:'synthetic-request',input,...(confirmation?{timeConfirmation:confirmation}:{})})};
}
const confirm=(run,role,target)=>({schemaVersion:2,confirmed:true,role,mode:role==='origin'?'refine':'advance_to',target,base:timeControlView(run).base});

test('natural-language time intent reaches every stage and commits without a confirmation form',async t=>{
 const f=await fixture(t,{dayOrdinal:2,periodId:'morning'});await f.turn();
 assert.deepEqual(f.calls.map(c=>c.stage),['director','writer','post_stat']);
 for(const c of f.calls)assert(JSON.stringify(c.input).includes(f.input));
 const post=f.calls.find(c=>c.stage==='post_stat');assert.equal(post.input.playerInput,f.input);assert.equal(post.input.playerOverride,undefined);
 const saved=await f.store.read(f.run.runId);assert.equal(saved.storyClock.position.earliest.dayOrdinal,2);assert.equal(saved.storyClock.periodId,'morning');assert.equal(saved.turns[0].timeConfirmation,undefined);
});

test('post-body origin confirmation reaches settlement and still permits elapsed time',async t=>{
 const f=await fixture(t,{elapsedMinutes:15}),override=confirm(f.run,'origin',{dayOrdinal:1,minuteOfDay:600});await f.turn(override);
 assert.deepEqual(f.calls.find(c=>c.stage==='post_stat').input.playerOverride,override);
 const saved=await f.store.read(f.run.runId);assert.equal(saved.storyClock.position.earliest.minuteOfDay,615);assert.deepEqual(saved.turns[0].timeConfirmation,override);
});

test('post-body endpoint confirmation binds Host settlement rather than silently accepting a different endpoint',async t=>{
 const wrong=await fixture(t,{dayOrdinal:1,minuteOfDay:650}),override=confirm(wrong.run,'endpoint',{dayOrdinal:1,minuteOfDay:660}),before=hash(wrong.run);
 await assert.rejects(wrong.turn(override),{code:'TIME_CONFIRMATION_ENDPOINT_REQUIRED'});assert.equal(hash(await wrong.store.read(wrong.run.runId)),before);
 const correct=await fixture(t,{dayOrdinal:1,minuteOfDay:660});await correct.turn(confirm(correct.run,'endpoint',{dayOrdinal:1,minuteOfDay:660}));
 assert.equal((await correct.store.read(correct.run.runId)).storyClock.position.earliest.minuteOfDay,660);
});

test('stale or out-of-range post-body confirmations stop before any model stage or saved change',async t=>{
 const f=await fixture(t,{unchanged:true}),before=hash(f.run),stale=confirm(f.run,'origin',{dayOrdinal:1,minuteOfDay:600});stale.base.version++;
 await assert.rejects(f.turn(stale),{code:'TIME_CONFIRMATION_STALE'});
 await assert.rejects(f.turn(confirm(f.run,'origin',{dayOrdinal:2,minuteOfDay:600})),{code:'TIME_REFINEMENT_OUTSIDE_BASE'});
 assert.equal(f.calls.length,0);assert.equal(hash(await f.store.read(f.run.runId)),before);
});

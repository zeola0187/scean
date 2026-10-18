import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {publicInspection} from '../core/inspection.mjs';
import {publicBlueprintState} from '../core/state-blueprint.mjs';

const variable=(key,category,type,extra={})=>({key,displayName:'公開 '+key,scope:'world',category,type,visibility:'public',...extra});
const blueprint=()=>({schemaVersion:1,id:'synthetic-ship-schema',version:1,extensionPolicy:'allow',variables:[
  variable('fuel','resources','number',{unit:'L',min:0,max:100}),variable('temperature','resources','number',{unit:'C'}),
  variable('location','locations','string'),variable('lampLit','facts','boolean'),variable('mode','facts','enum',{enumValues:['idle','active']}),
  variable('inspection','tasks','json'),variable('captainSecret','facts','string',{visibility:'restricted',displayName:'RESTRICTED_WORLD_LABEL'}),
  variable('personalSecret','facts','string',{scope:'character',characterId:'engineer',visibility:'restricted',displayName:'RESTRICTED_CHARACTER_LABEL'}),
]});
const initial=()=>({schemaVersion:1,blueprintId:'synthetic-ship-schema',blueprintVersion:1,values:[
  ['fuel','resources',72],['location','locations','laboratory'],['lampLit','facts',false],['mode','facts','idle'],
  ['inspection','tasks',{status:'pending',assignees:['engineer'],progress:0,priority:'routine'}],['captainSecret','facts','WORLD_SECRET_VALUE'],
].map(([key,category,value])=>({scope:'world',category,key,value,source:{id:'synthetic-card-r1',version:'r1'}})).concat([{scope:'character',characterId:'engineer',category:'facts',key:'personalSecret',value:'CHARACTER_SECRET_VALUE',source:{id:'synthetic-card-r1',version:'r1'}}])});
const snapshot=()=>{const stateBlueprint=blueprint(),initialState=initial();return{schemaVersion:1,cardId:'b-blueprint-synthetic',revision:'r1',card:{data:{name:'Synthetic research ship',description:'Public laboratory.',extensions:{scean:{stateBlueprint:structuredClone(stateBlueprint),initialState:structuredClone(initialState)},unrelated:{value:'PRESERVED_EXTENSION'}}}},worldbook:{entries:[]},preset:{style:'plain'},characters:[{id:'engineer',name:'Engineer',description:'OWN_FULL_BACKGROUND'}],stateBlueprint,initialState};};
const proposal=(stateChanges=[])=>({contractVersion:2,stateChanges,memories:[]});
const change=(key,category,value)=>({scope:'world',category,key,operation:'set',value});
async function setup({source=snapshot(),post=()=>proposal(),fault,consult=false}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-b-blueprint-')),store=new DurableStore({root,fault}),calls=[];
  const model={async generate(args){calls.push({stage:args.stage,input:structuredClone(args.input)});
    if(args.stage==='director')return consult&&!args.input.conversation.length?{text:'',toolCalls:[{id:'engineer-consult',name:'consult_character',arguments:{characterId:'engineer',question:'Give your public advice.'}}]}:{text:'Stay near the laboratory.'};
    if(args.stage==='character')return{text:JSON.stringify({adviceVersion:1,characterId:'engineer',observable:{attitude:'calm',intent:'wait'},publicUtterances:['Wait here.'],withheld:[],internal:{notes:[]},intendedDisclosures:[]})};
    if(args.stage==='draft'||args.stage==='prose')return{text:'The engineer checked the laboratory lamp and noted the fuel.'};
    if(args.stage==='post_stat')return{text:JSON.stringify(post(args))};throw Error('Unexpected stage '+args.stage);
  }};
  const memory={async retrieve(){return{records:[],status:'offline'};}};
  const engine=new SceanEngine({store,model,memory}),run=await engine.createRun({snapshot:source});return{root,store,model,memory,engine,run,calls};
}
const play=(f,requestId='blueprint-turn')=>f.engine.turn({runId:f.run.runId,input:'Check the lamp without lighting it.',requestId});

test('B3 actual creation initializes typed state, preserves missing=unknown, and hides restricted labels and values from public packets',async()=>{
  const f=await setup();assert.equal(f.run.state.world.resources.fuel,72);assert(!Object.hasOwn(f.run.state.world.resources,'temperature'));assert.equal(f.run.state.world.facts.lampLit,false);
  await play(f);const publicTrace=JSON.stringify(publicInspection(await f.engine.inspect(f.run.runId))),packets=JSON.stringify(f.calls);
  for(const marker of ['RESTRICTED_WORLD_LABEL','RESTRICTED_CHARACTER_LABEL','WORLD_SECRET_VALUE','CHARACTER_SECRET_VALUE']){assert(!publicTrace.includes(marker),'Inspector leaked '+marker);assert(!packets.includes(marker),'model leaked '+marker);}
  const view=publicBlueprintState(f.run.snapshot.stateBlueprint,f.run.state),unknown=view.declared.find(v=>v.key==='temperature');assert.equal(unknown.known,false);assert(!Object.hasOwn(unknown,'value'));assert.equal(view.declared.find(v=>v.key==='fuel').unit,'L');
  assert(!view.declared.some(v=>v.visibility==='restricted'));assert.equal(f.run.snapshot.card.data.extensions.unrelated.value,'PRESERVED_EXTENSION');
  const post=f.calls.find(c=>c.stage==='post_stat').input.stateBlueprint;
  assert.equal(post.id,'synthetic-ship-schema');assert.equal(post.version,1);
  assert.deepEqual(post.variables.find(v=>v.key==='fuel'),blueprint().variables.find(v=>v.key==='fuel'));
  assert.deepEqual(post.variables.find(v=>v.key==='mode').enumValues,['idle','active']);
  assert(!post.variables.some(v=>v.visibility!=='public'));assert(!Object.hasOwn(f.calls.find(c=>c.stage==='prose').input,'stateBlueprint'));
});

test('B3 invalid typed/enum/range initial values fail before any model generation',async()=>{
  for(const [key,bad] of [['fuel',101],['lampLit','false'],['mode','unknown'],['inspection',{status:'pending'}]]){
    const source=snapshot();source.initialState.values.find(v=>v.key===key).value=bad;
    await assert.rejects(setup({source}),e=>String(e.code).startsWith('BLUEPRINT_'),key);
  }
});

test('B3 initialized restricted character value reaches only its owner CR, never the public stages',async()=>{
  const f=await setup({consult:true});await play(f);const cr=f.calls.find(c=>c.stage==='character');
  assert(JSON.stringify(cr.input).includes('CHARACTER_SECRET_VALUE'));assert(!JSON.stringify(cr.input).includes('WORLD_SECRET_VALUE'));
  for(const c of f.calls.filter(c=>c.stage!=='character'))assert(!JSON.stringify(c.input).includes('CHARACTER_SECRET_VALUE'),c.stage);
  const shared=JSON.stringify(publicInspection(await f.engine.inspect(f.run.runId)));assert(!shared.includes('CHARACTER_SECRET_VALUE'));
});

test('B3 whole-key replacement does not silently retain task fields and failures preserve the whole committed round',async()=>{
  const f=await setup({post:()=>proposal([change('inspection','tasks',{status:'completed'})])});const before=await f.store.read(f.run.runId);
  await assert.rejects(play(f),e=>e.code==='BLUEPRINT_TASK_FIELDS');assert.deepEqual(await f.store.read(f.run.runId),before);
  assert.equal((await f.store.readAttempts(f.run.runId)).at(-1).status,'failed');
});

test('B3 legal dynamic state and full task replacements commit together with provenance, and replay is idempotent',async()=>{
  const f=await setup({post:()=>proposal([change('inspection','tasks',{status:'completed',assignees:['engineer'],progress:100}),change('sampleCount','resources',3)])});
  const result=await play(f),n=f.calls.length;assert.equal(result.status,'committed');await play(f);assert.equal(f.calls.length,n);
  const run=await f.store.read(f.run.runId);assert.deepEqual(run.state.world.tasks.inspection,{status:'completed',assignees:['engineer'],progress:100});assert.equal(run.state.world.resources.sampleCount,3);
  const view=publicBlueprintState(run.snapshot.stateBlueprint,run.state);assert(view.otherState.some(v=>v.key==='sampleCount'&&v.value===3));
  const raw=JSON.stringify(run);assert(raw.includes('"kind":"dynamic"'));assert(raw.includes('synthetic-ship-schema'));assert(raw.includes(result.commitId));
});

test('B3 new schema/card revision opens separate state while an existing Run survives a fresh engine unchanged',async()=>{
  const f=await setup();await play(f);const before=await f.store.read(f.run.runId),source=snapshot();source.revision='r2';source.stateBlueprint.version=2;source.initialState.blueprintVersion=2;source.initialState.values.find(v=>v.key==='fuel').value=40;
  const next=await f.engine.createRun({snapshot:source});assert.equal(next.state.world.resources.fuel,40);assert.notEqual(next.snapshot.hash,before.snapshot.hash);
  const restarted=new SceanEngine({store:new DurableStore({root:f.root}),model:f.model,memory:f.memory});assert.deepEqual((await restarted.inspect(f.run.runId)).snapshot,before.snapshot);assert.deepEqual((await restarted.inspect(f.run.runId)).state,before.state);
});

test('B3 write interruption before publication preserves typed initial state, then same request can retry after restart',async()=>{
  let enabled=false;const fault=(point)=>{if(enabled&&point==='beforeRename')throw Object.assign(new Error('synthetic persistence failure'),{code:'EIO'});};
  const f=await setup({fault,post:()=>proposal([change('fuel','resources',70)])});const before=await f.store.read(f.run.runId);enabled=true;
  await assert.rejects(play(f),e=>e.code==='EIO');assert.deepEqual(await f.store.read(f.run.runId),before);
  enabled=false;const restarted=new SceanEngine({store:new DurableStore({root:f.root}),model:f.model,memory:f.memory});const result=await restarted.turn({runId:f.run.runId,input:'Check the lamp without lighting it.',requestId:'blueprint-turn'});assert.equal(result.state.world.resources.fuel,70);assert.equal(result.version,1);
});

test('B3 cancelling a pending model result preserves initialized state and does not accept the late proposal',async()=>{
  const f=await setup(),before=await f.store.read(f.run.runId),controller=new AbortController();
  let start,release;const started=new Promise(r=>start=r),late=new Promise(r=>release=r);
  f.engine.model={async generate(){start();await late;return{text:'Late uncommitted result'};}};
  const pending=f.engine.turn({runId:f.run.runId,input:'Wait at the laboratory.',requestId:'cancel-blueprint',signal:controller.signal});
  await started;controller.abort();await assert.rejects(pending,e=>e.code==='CANCELLED');release();await new Promise(r=>setImmediate(r));
  assert.deepEqual(await f.store.read(f.run.runId),before);assert.equal((await f.store.readAttempts(f.run.runId)).at(-1).status,'cancelled');
});

test('B3 readOnly, extension deny and declared range fail atomically at actual PostStat submission',async()=>{
  for(const kind of ['readonly','extension-deny','range']){
    const source=snapshot();if(kind==='readonly')source.stateBlueprint.variables.find(v=>v.key==='fuel').readOnly=true;if(kind==='extension-deny')source.stateBlueprint.extensionPolicy='deny';
    const delta=kind==='extension-deny'?change('unlisted','facts',true):change('fuel','resources',kind==='range'?101:71);
    const f=await setup({source,post:()=>proposal([delta])}),before=await f.store.read(f.run.runId);
    const expected={readonly:'BLUEPRINT_READONLY_WRITE','extension-deny':'BLUEPRINT_EXTENSION_FORBIDDEN',range:'BLUEPRINT_VALUE_RANGE'}[kind];
    await assert.rejects(play(f),e=>e.code===expected);assert.deepEqual(await f.store.read(f.run.runId),before);
    assert.equal(f.calls.at(-1).stage,'post_stat');
  }
});

test('B3 separate legacy base-state argument cannot bypass frozen blueprint initial-value validation',async()=>{
  const f=await setup();const count=(await f.store.listRuns()).length;
  for(const injected of [{world:{resources:{fuel:1000}},characters:{}},{world:{facts:{undeclared:'BYPASS'}},characters:{}},{world:{},characters:{engineer:{public:{facts:{personalSecret:'BYPASS'}}}}}]){
    await assert.rejects(f.engine.createRun({snapshot:snapshot(),initialState:injected}),e=>e.code==='BLUEPRINT_BASE_STATE_FORBIDDEN');
  }
  assert.equal((await f.store.listRuns()).length,count);assert.equal(f.calls.length,0);
});

test('B3 after-publication interruption recovers a single body/state/provenance commit without regeneration',async()=>{
  let enabled=false;const fault=point=>{if(enabled&&point==='afterRename')throw Object.assign(new Error('lost commit acknowledgement'),{code:'EIO'});};
  const f=await setup({fault,post:()=>proposal([change('sampleCount','resources',4)])});enabled=true;const result=await play(f),calls=f.calls.length;
  assert.equal(result.status,'committed');const stored=await f.store.read(f.run.runId),dynamic=stored.stateProvenance.filter(v=>v.kind==='dynamic');
  assert.equal(stored.turns.length,1);assert.equal(stored.version,1);assert.equal(dynamic.length,1);assert.equal(dynamic[0].source.id,result.commitId);assert.equal(dynamic[0].source.version,stored.version);
  assert.equal(stored.receipts['blueprint-turn'].commitId,result.commitId);
  const restarted=new SceanEngine({store:new DurableStore({root:f.root}),model:f.model,memory:f.memory});await restarted.turn({runId:f.run.runId,input:'Check the lamp without lighting it.',requestId:'blueprint-turn'});assert.equal(f.calls.length,calls);
});

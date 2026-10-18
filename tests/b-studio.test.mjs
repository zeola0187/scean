import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {IsolatedStudioBridge} from '../isolated/studio-bridge.mjs';
import {pngChunk} from '../vendor/cardstudio-scean/lib/codec.js';
import {SceanHost} from '../plugin/host.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';

const card=(roster=true)=>({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Synthetic Studio keeper',description:'saved r1',personality:'Calm',scenario:'A synthetic observatory',first_mes:'Welcome to the quiet observation deck.',mes_example:'',creator_notes:'Synthetic fixture only',system_prompt:'',post_history_instructions:'',alternate_greetings:['Welcome to the synthetic harbor.'],tags:[],creator:'SCEAN synthetic test',character_version:'1',extensions:roster?{scean:{characters:[{id:'keeper',name:'Keeper',description:'A synthetic station keeper.'}]}}:{},character_book:{entries:[{id:1,keys:['lamp'],content:'A silver lamp stands on the desk.',enabled:true,insertion_order:0,extensions:{}}]}}});
const b64=value=>Buffer.from(typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value).toString('base64');
async function fixture(t,{absent=false,clock}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-studio-b-'));let calls=0;
  const host=await new SceanHost({engine:new SceanEngine({store:new DurableStore({root:join(root,'rp')}),model:{generate(){calls++;throw Error('No model allowed in Studio integration');}},memory:new Memory()}),root:join(root,'host')}).init();
  const bridge=await new IsolatedStudioBridge({root:join(root,'studio'),sceanHost:absent?null:host,...clock?{now:()=>clock.value}:{}}).init();
  t.after(async()=>{await bridge.close();host.close();assert.equal(calls,0);});
  const acquired=await bridge.request({action:'studio.acquire',pageId:'studio-test-page-0001'});assert(acquired.ok,JSON.stringify(acquired));
  const claim=acquired.value.claim;
  const request=(action,args={})=>bridge.request({action:'studio.'+action,claim,...args});
  const imported=await request('import',{fileName:'synthetic.json',type:'card',base64:b64(card())});assert(imported.ok,JSON.stringify(imported));
  return {root,bridge,host,claim,request,id:imported.value.id};
}


import {studioBlueprintDraft,studioBlueprintPayload} from '../isolated/web/studio-view-model.mjs';
import {blueprintStateRows} from '../isolated/web/view-model.mjs';
const bp=()=>({schemaVersion:1,id:'research-ship',version:1,extensionPolicy:'allow',variables:[
 {key:'fuel',displayName:'燃料',scope:'world',category:'resources',type:'number',unit:'L',min:0,max:100,visibility:'public'},
 {key:'destination',displayName:'目的地',scope:'world',category:'locations',type:'string',visibility:'public'},
 {key:'secret',displayName:'私密記事',scope:'character',characterId:'keeper',category:'facts',type:'string',visibility:'restricted'}
]});
const initial=()=>({schemaVersion:1,blueprintId:'research-ship',blueprintVersion:1,values:[
 {scope:'world',category:'resources',key:'fuel',value:45,source:{id:'synthetic-card',version:1}},
 {scope:'character',characterId:'keeper',category:'facts',key:'secret',value:'PRIVATE_BLUEPRINT_CANARY',source:{id:'synthetic-card',version:1}}
]});
const save=(f,extra={})=>({documentId:f.id,expectedRevision:0,expectedScopeEpoch:f.claim.authoring_scope.epoch,authorizeBlueprintSave:true,stateBlueprint:bp(),initialState:initial(),...extra});

test('B Studio saves Blueprint/InitialState through original revision/codec and preserves extension metadata',async t=>{
 const f=await fixture(t),original=card();original.data.extensions.other={preserve:'yes'};original.data.extensions.scean.future={preserve:true};
 const imported=await f.request('import',{fileName:'bp.json',type:'card',base64:b64(original)});assert(imported.ok);
 const saved=await f.request('patch',save(f,{documentId:imported.value.id}));assert(saved.ok,JSON.stringify(saved));assert.equal(saved.value.blueprintSaved,true);assert.equal(saved.value.rosterSaved,false);assert.equal(saved.value.scopeRestored,true);
 const read=await f.request('read',{documentId:imported.value.id});assert.equal(read.value.revision,1);assert.deepEqual(read.value.card.data.extensions.other,{preserve:'yes'});assert.deepEqual(read.value.card.data.extensions.scean.future,{preserve:true});assert.deepEqual(read.value.card.data.extensions.scean.stateBlueprint,bp());
 const exported=await f.request('export',{documentId:imported.value.id,expectedRevision:1});assert(exported.ok);const exportedCard=JSON.parse(Buffer.from(exported.value.base64,'base64'));assert.deepEqual(exportedCard.data.extensions.scean.initialState,initial());
});

test('B Studio rejects missing authorization, stale scope, invalid actor/type/unit/task before scope transition',async t=>{
 const f=await fixture(t),record=f.bridge.loader.records.get(f.bridge.agent.id),epoch=record.scope.epoch;
 const invalidActor=bp();invalidActor.variables[2].characterId='not-in-roster';
 const invalidUnit=bp();invalidUnit.variables[1].unit='L';
 const invalidInitial=initial();invalidInitial.values[0].value=1000;
 const invalidTask=bp();invalidTask.variables[1]={key:'task',displayName:'任務',scope:'world',category:'tasks',type:'json',visibility:'public'};
 const taskInitial=initial();taskInitial.values.push({scope:'world',category:'tasks',key:'task',value:{status:'pending'},source:{id:'test',version:1}});
 for(const [change,code] of [[{authorizeBlueprintSave:false},'STUDIO_BLUEPRINT_AUTH_REQUIRED'],[{expectedScopeEpoch:epoch+1},'AUTHORING_SCOPE_CHANGED'],[{stateBlueprint:invalidActor},'BLUEPRINT_ACTOR'],[{stateBlueprint:invalidUnit},'BLUEPRINT_UNIT'],[{initialState:invalidInitial},'BLUEPRINT_VALUE_RANGE'],[{stateBlueprint:invalidTask,initialState:taskInitial},'BLUEPRINT_TASK_FIELDS']]){
  const result=await f.request('patch',save(f,change));assert.equal(result.error?.code,code,JSON.stringify(result));assert.equal(record.scope.epoch,epoch);assert.equal(record.scope.mode,'content');
 }
 assert.equal((await f.request('read',{documentId:f.id})).value.revision,0);
});

test('B Studio saved Blueprint becomes immutable new Run, r2 cannot change old Run, private initial state stays out ordinary inspector',async t=>{
 const f=await fixture(t),saved=await f.request('patch',save(f));assert(saved.ok,JSON.stringify(saved));
 const first=await f.request('handoff',{documentId:f.id,expectedRevision:1,presetId:'scean-default'});assert(first.ok,JSON.stringify(first));assert.deepEqual(first.value.snapshot.stateBlueprint,bp());assert.deepEqual(first.value.snapshot.initialState,initial());
 const prior=await f.host.inspect(first.value.runId);assert.equal(prior.state.world.resources.fuel,45);assert(!JSON.stringify(prior).includes('PRIVATE_BLUEPRINT_CANARY'));assert(prior.worldView.declared.some(v=>v.key==='destination'&&!v.known));
 const nextBp=bp();nextBp.version=2;const nextInitial=initial();nextInitial.blueprintVersion=2;nextInitial.values[0].value=60;
 const revised=await f.request('patch',save(f,{expectedRevision:1,expectedScopeEpoch:saved.value.claim.authoring_scope.epoch,stateBlueprint:nextBp,initialState:nextInitial}));assert(revised.ok,JSON.stringify(revised));
 const second=await f.request('handoff',{documentId:f.id,expectedRevision:2,presetId:'scean-default'});assert(second.ok,JSON.stringify(second));assert.notEqual(first.value.runId,second.value.runId);assert.equal((await f.host.inspect(second.value.runId)).state.world.resources.fuel,60);assert.deepEqual(await f.host.inspect(first.value.runId),prior);
 assert.equal((await f.request('handoff',{documentId:f.id,expectedRevision:2,presetId:'scean-default',stateBlueprint:bp()})).error.code,'STUDIO_BLUEPRINT_SAVE_REQUIRED');
});

test('B Studio Blueprint save works while SCEAN absent and restores scope on injected write failure',async t=>{
 const f=await fixture(t,{absent:true}),operation=f.bridge.operation.bind(f.bridge);let failed=false;
 f.bridge.operation=async(...args)=>{if(args[1]==='patch'&&!failed){failed=true;throw Object.assign(Error('synthetic'),{code:'INJECTED_WRITE_FAILURE'});}return operation(...args);};
 assert.equal((await f.request('patch',save(f))).error.code,'INJECTED_WRITE_FAILURE');assert.equal(f.bridge.loader.records.get(f.bridge.agent.id).scope.mode,'content');assert.equal((await f.request('read',{documentId:f.id})).value.revision,0);
 const renewed=await f.request('renew');const saved=await f.request('patch',save(f,{expectedScopeEpoch:renewed.value.claim.authoring_scope.epoch}));assert(saved.ok,JSON.stringify(saved));assert((await f.request('export',{documentId:f.id,expectedRevision:1})).ok);
});

test('B form payload retains unknown omission, false/zero, source and declared UI labels/units',()=>{
 const document={card:{data:{extensions:{scean:{stateBlueprint:bp(),initialState:initial()}}}}};const draft=studioBlueprintDraft(document);const round=studioBlueprintPayload(draft,card().data.extensions.scean.characters);assert.deepEqual(round.stateBlueprint,bp());assert.deepEqual(round.initialState,initial());
 draft.variables[0].initialText='0';delete draft.variables[0].initialSource;const changed=studioBlueprintPayload(draft,card().data.extensions.scean.characters);assert.equal(changed.initialState.values[0].value,0);assert(!changed.initialState.values.some(v=>v.key==='destination'));
 const rows=blueprintStateRows({declared:[{key:'fuel',displayName:'燃料',known:true,value:0,unit:'L'},{key:'location',displayName:'目的地',known:false}],otherState:[{key:'weather',value:'rain'}]});assert.equal(rows.declared[0].text,'0 L');assert.equal(rows.declared[1].text,'未知');assert.equal(rows.other[0].label,'weather');
 draft.variables[0].initialText='101';assert.throws(()=>studioBlueprintPayload(draft,card().data.extensions.scean.characters),/範圍/);
});


test('B saved blueprint owner references prevent inconsistent roster-only revision; combined edit removes both legally',async t=>{
 const f=await fixture(t),saved=await f.request('patch',save(f));assert(saved.ok);
 const roster=[{id:'newkeeper',name:'New keeper',description:'Synthetic replacement roster entry.'}];
 const staleOwner=await f.request('patch',{documentId:f.id,expectedRevision:1,expectedScopeEpoch:saved.value.claim.authoring_scope.epoch,authorizeRosterSave:true,roster});assert.equal(staleOwner.error.code,'BLUEPRINT_ACTOR');assert.equal((await f.request('read',{documentId:f.id})).value.revision,1);
 const cleanBp=bp();cleanBp.variables=cleanBp.variables.filter(v=>v.scope==='world');const cleanInitial=initial();cleanInitial.values=cleanInitial.values.filter(v=>v.scope==='world');
 const combined=await f.request('patch',save(f,{expectedRevision:1,expectedScopeEpoch:saved.value.claim.authoring_scope.epoch,authorizeRosterSave:true,roster,stateBlueprint:cleanBp,initialState:cleanInitial}));assert(combined.ok,JSON.stringify(combined));assert.equal(combined.value.revision,2);
});

test('B browser form flags invalid enum/unit/task and preserves explicit false vs unknown',()=>{
 const characters=card().data.extensions.scean.characters;
 const draft={id:'test',version:1,extensionPolicy:'allow',variables:[{key:'alarm',displayName:'警報',scope:'world',category:'effects',type:'boolean',visibility:'public',initialText:'false'}]};
 assert.equal(studioBlueprintPayload(draft,characters).initialState.values[0].value,false);
 draft.variables[0].initialText='';assert.equal(studioBlueprintPayload(draft,characters).initialState.values.length,0);
 draft.variables[0].unit='L';assert.throws(()=>studioBlueprintPayload(draft,characters),/單位/);delete draft.variables[0].unit;
 draft.variables[0].type='enum';draft.variables[0].enumValues=['same','same'];assert.throws(()=>studioBlueprintPayload(draft,characters),/enum/);
 draft.variables[0].type='json';delete draft.variables[0].enumValues;draft.variables[0].category='tasks';draft.variables[0].initialText='{"status":"active","progress":0}';assert.throws(()=>studioBlueprintPayload(draft,characters),/assignees/);
});


test('B player state presentation uses public projection, shows latest value delta and hides restricted rows',()=>{
 const projection={declared:[{scope:'world',category:'resources',key:'fuel',displayName:'燃料',known:true,value:40,unit:'L'},{key:'secret',known:true,value:'must-not-render',visibility:'restricted'}],otherState:[{scope:'world',category:'facts',key:'weather',value:'rain'},{key:'hidden',value:'must-not-render',visibility:'private'}]};
 const rows=blueprintStateRows(projection,{stateBefore:{world:{resources:{fuel:45}},characters:{}}});
 assert.equal(rows.declared.length,1);assert.equal(rows.declared[0].text,'40 L（原為 45 L）');assert.equal(rows.other.length,1);assert.equal(rows.other[0].text,'rain（本輪新增）');assert(!JSON.stringify(rows).includes('must-not-render'));
});


test('B imported saved blueprint may omit InitialState: new Run remains unknown; orphan InitialState is rejected',async t=>{
 const f=await fixture(t),unknown=card();unknown.data.extensions.scean.stateBlueprint=bp();
 const imported=await f.request('import',{fileName:'unknown-initial.json',type:'card',base64:b64(unknown)});assert(imported.ok,JSON.stringify(imported));
 const handed=await f.request('handoff',{documentId:imported.value.id,expectedRevision:0,presetId:'scean-default'});assert(handed.ok,JSON.stringify(handed));assert.equal(Object.hasOwn(handed.value.snapshot,'initialState'),false);
 const run=await f.host.inspect(handed.value.runId);assert(run.worldView.declared.length>0);assert(run.worldView.declared.every(row=>row.known===false));assert.deepEqual(run.state.world,{});
 const orphan=card();orphan.data.extensions.scean.initialState=initial();const bad=await f.request('import',{fileName:'orphan-initial.json',type:'card',base64:b64(orphan)});assert(bad.ok);
 const rejected=await f.request('handoff',{documentId:bad.value.id,expectedRevision:0,presetId:'scean-default'});assert.equal(rejected.error.code,'INITIAL_STATE_WITHOUT_BLUEPRINT');
});

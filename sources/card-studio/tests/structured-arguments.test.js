import test from 'node:test';
import assert from 'node:assert/strict';
import {validateArgs,parameterSchemaSpecToJsonSchema} from '@deepseek-ai/dsh-tools';
import {toolSpecs} from '../cardstudio-bundle/lib/tool-definitions.js';
import {CardService} from '../cardstudio-bundle/lib/card-service.js';
import {validateBlueprint} from '../cardstudio-bundle/lib/w01/core/state-blueprint.mjs';
import {validateFrontend} from '../cardstudio-bundle/lib/w01/core/frontend.mjs';
const specs=Object.fromEntries(toolSpecs.map(([name,,,spec])=>[name,spec]));
const bp={schemaVersion:1,id:'synthetic',version:1,extensionPolicy:'allow',variables:[]};
const frontend={schemaVersion:1,id:'synthetic',runtime:{profile:'scean-html-bindings-v1',apiMajor:1},html:'<p>test</p>',css:'p{}',bindings:[],conditions:{},capabilities:{network:'none',worldActions:[],derivedDisplays:[]}};
const patch=[{op:'add',path:'/data/extensions/test',value:'x'}];
test('actual SDK schema rejects encoded JSON, invalid patch items, and preserves null',()=>{
 const p=specs.card_patch_fields, f=specs.cardstudio_scean_frontend;
 assert.equal(parameterSchemaSpecToJsonSchema(p).properties.patches.type,'array');
 assert.deepEqual(validateArgs(p,{document_id:'x',expected_revision:0,patches:patch}),[]);
 for(const bad of [JSON.stringify(patch),[null],[{op:'add',path:3}],[{op:'bad',path:'/data/name'}]])assert.notEqual(validateArgs(p,{document_id:'x',expected_revision:0,patches:bad}).length,0);
 assert.deepEqual(validateArgs(f,{action:'dynamic_validate',document_id:'x',blueprint:bp,frontend,initial_state:null,derived_facts:null}),[]);
 for(const key of ['blueprint','frontend','initial_state'])assert.notEqual(validateArgs(f,{action:'dynamic_validate',document_id:'x',[key]:'{}'}).length,0);
 assert.doesNotThrow(()=>validateBlueprint(bp));assert.doesNotThrow(()=>validateFrontend(frontend,bp));
});
test('patch service rejects invalid shapes before commit without writing',async()=>{
 let commits=0;const fake={commit:async(_id,_rev,fn)=>{commits++;let card={spec:'chara_card_v2',spec_version:'2.0',data:{...Object.fromEntries(['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','creator','character_version'].map(k=>[k,''])),alternate_greetings:[],tags:[],extensions:{}}};fn(card,[]);return card;}};
 for(const value of [JSON.stringify(patch),[null],[{op:'add',path:4}]])await assert.rejects(CardService.prototype.patch.call(fake,'synthetic',0,value),e=>e.code==='PATCH_TYPE'&&e.message.includes('Nothing was written'));
 assert.equal(commits,0);const result=await CardService.prototype.patch.call(fake,'synthetic',0,patch);assert.equal(result.data.extensions.test,'x');assert.equal(commits,1);
});

test('expired lease keeps active task then logs disposal on idle without replay',async()=>{
 const {WorkspaceLoader}=await import('../cardstudio-bundle/lib/loader.js');
 const events=[];let disposed=0,cancelled=0,now=100;
 const loader=new WorkspaceLoader({root:'synthetic',agentLookup:()=>null,activateAddon:()=>null,now:()=>now,onLifecycle:e=>events.push(e)});
 const agent={id:'synthetic',status:'running',cancel:()=>cancelled++,whenIdle:()=>Promise.resolve()};
 const lease={id:'lease',expires:99,controller:new AbortController()};
 const record={agent,pages:new Map([['page',lease]]),hostTask:{id:'task',deadline:1000,controller:new AbortController()},controller:new AbortController(),jobs:new Set(),addon:{dispose:async()=>disposed++},closing:false};
 loader.records.set(agent.id,record);loader.workspace={service:{close:async()=>{},uploads:{sweep(){},clearOwner(){},clear(){}},assetUploads:{sweep(){},clearOwner(){},clear(){}}}};
 await loader.sweep();assert.equal(disposed,0);assert.equal(events[0].event,'lease_expired');assert.equal(events[0].remainingPages,0);assert.equal(events[0].agentRunning,true);assert.match(events[0].sessionHash,/^[a-f0-9]{12}$/);
 agent.status='idle';await loader.sweep();assert.equal(disposed,1);assert.equal(cancelled,0);assert.equal(events[1].event,'addon_stop');assert.equal(events[1].reason,'idle');assert.equal(events[1].sessionHash,events[0].sessionHash);
});

test('SDK model dispatch reports actionable error and executes only corrected call',async()=>{
 const {defineTool}=await import('@deepseek-ai/dsh-tools');let calls=0;
 const tool=defineTool({name:'synthetic_patch',description:'synthetic',parameters:specs.card_patch_fields,output:{schema:{type:'json'},render:()=>[]},execute:async()=>{calls++;return {ok:true}}});
 await assert.rejects(tool.execute({document_id:'x',expected_revision:0,patches:'[]'},{}),e=>e.name==='ToolArgsError'&&e.message.includes('patches')&&e.message.includes('array'));
 assert.equal(calls,0);assert.deepEqual(await tool.execute({document_id:'x',expected_revision:0,patches:patch},{}),{ok:true});assert.equal(calls,1);
});

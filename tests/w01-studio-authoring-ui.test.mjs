import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('Studio entering frontend authoring loads dynamic Blueprint data and existing tools without ReferenceError',async()=>{
 const source=await fs.readFile(new URL('../packages/studio/client-template.js',import.meta.url),'utf8');
 const start=source.indexOf('const loadAuthoring=async('),end=source.indexOf('const authoringMutation=',start);
 assert(start>0&&end>start);const calls=[],current={doc:{id:'synthetic'},authoring:{components:[]}};
 const blueprint={id:'test-bp',variables:[]},initial={facts:{}},frontend={id:'custom'};
 const sandbox={state:{current},json:JSON.stringify,authoringBlank:()=>({components:[]}),componentId:r=>r.id,setV:x=>Object.assign(current,x),setA:x=>Object.assign(current.authoring,x),loadComponent:async()=>assert.fail('no fragment selected'),call:async(tool,args)=>{calls.push([tool,args]);return args.action==='dynamic_read'?{stateBlueprint:blueprint,initialState:initial,frontend}:tool==='frontend'?{components:[],diagnostics:[]}:tool==='fixture'?{fixture:{}}:tool==='visual_contract'?{contract:{}}:{assets:[]};}};
 vm.createContext(sandbox);await vm.runInContext(source.slice(start,end)+'loadAuthoring();',sandbox);
 assert.equal(current.route,'authoring');assert.deepEqual(JSON.parse(current.authoring.dynamic),{stateBlueprint:blueprint,initialState:initial,frontend});assert.equal(current.authoring.dynamicBase,current.authoring.dynamic);assert.equal(calls.length,5);
});

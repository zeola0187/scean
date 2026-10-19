import test from 'node:test';
import assert from 'node:assert/strict';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {toolSpecs} from '../sources/card-studio/cardstudio-bundle/lib/tool-definitions.js';
const [name,description,,parameters]=toolSpecs.find(t=>t[0]==='cardstudio_scean_diagnose');
test('all10 diagnostic parameters publish defaults/conditions, units and finite or authority-bound limits',()=>{
 assert.equal(Object.keys(parameters).length,10);for(const [key,p]of Object.entries(parameters))assert.ok(p.description?.length>30,key+' must explain its contract');
 for(const key of ['action','section','field','limit','target'])assert.ok(parameters[key].enum?.length,key);
 assert.match(parameters.offset.description,/Snapshot|snapshot/);assert.match(parameters.offset.description,/8000000/);assert.match(parameters.text_offset.description,/totalCharacters/);assert.match(parameters.direction.description,/4000 UTF-16/);assert.match(parameters.entry_id.description,/512 UTF-16/);assert.match(parameters.target.description,/embedded worldbook/);assert.match(description,/finish the fragment.*before following nextOffset/);
});
test('official SDK validates every diagnostic enum and scalar type before dispatch',async()=>{
 let dispatches=0;const tool=defineTool({name,description,parameters,output:{schema:{type:'json'},render:()=>[]},async execute(){dispatches++;return {ok:true};}});
 for(const key of ['action','section','field','limit','target'])await assert.rejects(tool.execute({[key]:key==='limit'?4000:'__unknown__'},{}),e=>e.code==='INVALID_ARGS');
 for(const key of ['turn','offset','limit','text_offset'])for(const value of ['1',1.5,null,[]])await assert.rejects(tool.execute({[key]:value},{}),e=>e.code==='INVALID_ARGS');
 for(const key of ['direction','entry_id'])await assert.rejects(tool.execute({[key]:123},{}),e=>e.code==='INVALID_ARGS');assert.equal(dispatches,0);
 for(const limit of parameters.limit.enum)await tool.execute({limit},{});assert.equal(dispatches,10);
});
test('registered contract exposes no Run/grant/token/path/consent or write-revision override',()=>{
 for(const forbidden of ['runId','snapshotHash','id','grant','operatorToken','path','consent','expected_revision'])assert(!Object.hasOwn(parameters,forbidden));
 assert.deepEqual(parameters.target.enum,['card','worldbook']);assert.deepEqual(parameters.section.enum,['context','story','snapshot','runtime','worldbook','private_context']);
});

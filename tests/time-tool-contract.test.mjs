import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {TIME_TOOL,prepareTemporalCandidate} from '../core/state-operations.mjs';
import {TIME_TOOL as studioTool} from '../sources/card-studio/cardstudio-bundle/lib/w01/core/state-operations.mjs';
import {routineFixture} from '../fixtures/w29-routine-synthetic.mjs';
import {hash} from '../core/contracts.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {createNativeModelPort} from '../plugin/native-model.mjs';
// Optional existing test dependencies; never install packages or contact a model.
let Ajv;try{const require=createRequire(process.env.SCEAN_TEST_DEPENDENCY_ROOT?path.resolve(process.env.SCEAN_TEST_DEPENDENCY_ROOT,'package.json'):import.meta.url);Ajv=require('ajv');}catch{}
test('precision request is exclusive in the tool schema',{skip:!Ajv?'Set SCEAN_TEST_DEPENDENCY_ROOT to existing Ajv test dependencies':false},()=>{
 const valid=new Ajv({strict:false}).compile(TIME_TOOL.function.parameters);
 for(const v of [{needsPrecision:true},{needsPrecision:true,sourceRefs:['input']},{kind:'hold',sourceRefs:['input']},{needsPrecision:false,kind:'advance_by',amount:{minutes:5},sourceRefs:['input']},{kind:'advance_to',target:{nextDay:true,periodId:'morning'},sourceRefs:['input']}])assert(valid(v),JSON.stringify(v));
 for(const v of [{needsPrecision:true,kind:'hold',sourceRefs:['input']},{needsPrecision:true,amount:{minutes:5}},{needsPrecision:true,target:{nextDay:true}},{needsPrecision:true,sourceRefs:['character']},{needsPrecision:'true'},{kind:'hold',extra:1}])assert(!valid(v),JSON.stringify(v));
});
test('Studio and stage advertise the identical time contract',()=>assert.deepEqual(studioTool,TIME_TOOL));
test('runtime preserves strict errors and never converts unresolved time into hold',async()=>{
 const f=await routineFixture({policy:{forum:false}});
 try{const r=await f.read(),before=hash(r),opts={requestId:'synthetic-contract',inputHash:hash('synthetic input')};
  for(const [operation,code]of [[{needsPrecision:true,kind:'hold',sourceRefs:['input']},'TEMPORAL_FIELDS'],[{needsPrecision:true,sourceRefs:['input']},'NEEDS_TIME_PRECISION'],[{needsPrecision:true,sourceRefs:['other']},'TIME_SOURCE_INVALID']])assert.throws(()=>prepareTemporalCandidate(r,operation,opts),{code});
  assert.deepEqual(prepareTemporalCandidate(r,{kind:'hold',sourceRefs:['input']},opts),prepareTemporalCandidate(r,{needsPrecision:false,kind:'hold',sourceRefs:['input']},opts));
  assert.equal(hash(r),before);assert.equal(f.calls.length,0);
 }finally{await f.host.close();}
});
test('synthetic engine fails before Writer and commits a separately valid operation',async()=>{
 const f=await routineFixture({policy:{forum:false}});
 try{const before=hash(await f.read());
  for(const [op,id,code]of [[{needsPrecision:true,kind:'hold',sourceRefs:['input']},'mixed','TEMPORAL_FIELDS'],[{needsPrecision:true,sourceRefs:['input']},'precision','NEEDS_TIME_PRECISION']]){
   await assert.rejects(f.turn(op,id),{code});assert.equal(hash(await f.read()),before);assert(!f.calls.some(c=>c.stage==='writer'));
  }
  await f.turn({kind:'advance_by',amount:{minutes:5},sourceRefs:['input']},'legal');
  const r=await f.read();assert.equal(r.storyClock.position.earliest.minuteOfDay,605);validateRunBundle(encodeRunBundle(r));
 }finally{await f.host.close();}
});
test('native port preserves exclusion schema in its synthetic adapter packet',async()=>{
 let packet,reserved=0,settled=0;
 const llm={async resolveModelInfo(){return{defaultMaxTokens:1024};},async *stream(p){packet=p;yield{type:'block-end',index:0,block:{type:'text',text:'Synthetic only'}};yield{type:'finish',reason:{kind:'stop'}};}};
 const port=createNativeModelPort({llm,selection:{provider:'synthetic',model:'offline'},usageLedger:{async reserve(){reserved++;return 'fixture';},async settle(){settled++;}},technicalRetries:0});
 await port.generate({stage:'director',system:'Synthetic test',input:'Unresolved synthetic endpoint',tools:[TIME_TOOL]});
 assert.equal(reserved,1);assert.equal(settled,1);assert.deepEqual(packet.tools[0],TIME_TOOL.function);
});

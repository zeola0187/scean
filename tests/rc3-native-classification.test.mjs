import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeModelPort} from '../plugin/native-model.mjs';
for(const code of ['CLIENT_UPGRADE_REQUIRED','MODEL_UNSUPPORTED'])for(const mode of ['resolve','prepare','throw','finish'])test(`RC3 ${code} at ${mode}: exact safe code and no automatic retry`,async()=>{
 let calls=0,prepares=0,reserves=0;const traces=[],fail=()=>{throw Object.assign(Error('PRIVATE_PROVIDER_TOKEN'),{code});};
 const llm={resolveModelInfo:async()=>mode==='resolve'?fail():({defaultMaxTokens:100,context:{contextWindow:1000}}),prepareCall:async()=>{prepares++;if(mode==='prepare')fail();return {config:{provider:'synthetic',model:'pinned',maxTokens:100},context:{contextWindow:1000},stream:async function*(){calls++;if(mode==='throw')fail();yield {type:'text-delta',index:0,text:'must never publish partial'};yield {type:'finish',reason:{kind:'error',failure:{code,message:'PRIVATE_PROVIDER_TOKEN'}}};}};},stream:async function*(){throw Error('unexpected unprepared fallback');}};
 const port=createNativeModelPort({llm,routing:{epoch:0,validate:async()=>{}},agentDefaultModel:{currentSelection:()=>({provider:'synthetic',model:'pinned'})},usageLedger:{reserve:async()=>{reserves++;return 'synthetic-'+reserves;},settle:async()=>{}},technicalRetries:1,onTrace:async r=>traces.push(r)});
 const action=mode==='resolve'?()=>port.describe({stage:'writer'}):()=>port.generate({stage:'writer',system:'synthetic',input:'synthetic'});
 await assert.rejects(action(),e=>e.code===code&&!e.message.includes('PRIVATE_PROVIDER_TOKEN')&&(mode==='resolve'||e.attempts.length===1));
 assert.equal(calls,['throw','finish'].includes(mode)?1:0);assert.equal(reserves,calls);assert(prepares<=1);assert(!JSON.stringify(traces).includes('PRIVATE_PROVIDER_TOKEN'));
});

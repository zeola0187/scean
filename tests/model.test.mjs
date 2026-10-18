import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, appendFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageLedger, BudgetLedger } from '../adapters/budget.mjs';
import { DeepSeekModel, parseCompletion, createOpenRouterEmbedding, outputLimits } from '../adapters/model.mjs';
const ledger=async options=>new UsageLedger(join(await mkdtemp(join(tmpdir(),'scean-usage-')),'usage.jsonl'),options);
const success={model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:'public prose',reasoning_content:'PRIVATE'}}],usage:{prompt_tokens:5,completion_tokens:3}};
test('R2 usage journal survives restart; historical 5 USD and request limits do not constrain recording',async()=>{
  const b=await ledger({maxUsd:.01,maxGenerationRequests:1});assert.equal(BudgetLedger,UsageLedger);
  const id=await b.reserve({caseId:'a',maxCostUsd:6});await b.settle(id,{actualCostUsd:10,usage:{inputTokens:4,outputTokens:3},status:'completed'});
  const restarted=new UsageLedger(b.path);await restarted.reserve({caseId:'b',maxCostUsd:10000});
  const s=await restarted.summary();assert.equal(s.knownActualCostUsd,10);assert.equal(s.reservations,2);assert.equal(s.unresolved,1);assert.equal(s.monetaryEnforcement,false);assert.equal(s.actualCostStatus,'unknown_or_partial');
  const raw=await readFile(b.path,'utf8');assert(!raw.includes('maxCostUsd'));assert(!raw.includes('chargedUpperUsd'));assert(!raw.includes('maxUsd'));
});
test('technical retry remains finite without lifetime request/cost quota',async()=>{
  const b=await ledger({maxGenerationRequests:1});for(let retry=0;retry<3;retry++)await b.reserve({caseId:'a',retry});
  await assert.rejects(b.reserve({caseId:'a',retry:1}),/RETRIES_EXHAUSTED/);await b.reserve({caseId:'b'});
});
test('historical ledger immutable even when deliberately passed as new path',async()=>{
  const b=await ledger();const row={seq:0,previous:null,type:'limits',maxUsd:5,maxGenerationRequests:200};row.hash=createHash('sha256').update(JSON.stringify(row)).digest('hex');
  const raw=JSON.stringify(row)+'\n';await writeFile(b.path,raw);await assert.rejects(b.reserve({caseId:'a'}),/HISTORICAL_LEDGER_READ_ONLY/);assert.equal(await readFile(b.path,'utf8'),raw);
});
test('journal corruption and concurrent writer protection preserve evidence',async()=>{
  const b=await ledger();const results=await Promise.allSettled([b.reserve({caseId:'a'}),b.reserve({caseId:'b'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await appendFile(b.path,'{');await assert.rejects(b.summary(),/CORRUPT/);
});
test('adapter strips hidden reasoning and rejects truncated completion',()=>{
  assert(!JSON.stringify(parseCompletion(success)).includes('PRIVATE'));
  assert.throws(()=>parseCompletion({choices:[{finish_reason:'length'}]}),e=>e.code==='MODEL_OUTPUT_TRUNCATED');
  const call=parseCompletion({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'c1',type:'function',function:{name:'consult_character',arguments:'{"characterId":"sio","question":"q"}'}}]}}]});assert.equal(call.toolCalls[0].arguments.characterId,'sio');
});
test('HTTP/transport failures record usage without storing provider secrets',async()=>{
  const budget=await ledger(),traces=[];const model=new DeepSeekModel({budget,apiKey:'TEST_SECRET',fetchImpl:async()=>{throw new Error('TEST_SECRET at https://secret');},onTrace:t=>traces.push(t)});
  await assert.rejects(model.generate({stage:'prose',system:'public',input:'x'}),e=>e.code==='MODEL_TRANSPORT_ERROR'&&!e.message.includes('TEST_SECRET'));
  assert.equal((await budget.summary()).generationRequests,1);assert(!JSON.stringify(traces).includes('TEST_SECRET'));
  assert.equal((await budget.summary()).knownActualCostUsd,0);
});
test('stage output defaults and configurable precedence, tool contract, attribution',async()=>{
  const budget=await ledger();const requests=[];const model=new DeepSeekModel({budget,apiKey:'test',fetchImpl:async(_u,r)=>{requests.push(JSON.parse(r.body));return {ok:true,status:200,json:async()=>success};}});
  await model.generate({stage:'director',system:'public',input:{},tools:[{type:'function',function:{name:'f'}}],context:{runId:'r',attemptId:'a',requestId:'q',secret:'NEVER'}});
  await model.generate({stage:'prose',system:'public',input:{}});
  assert.equal(requests[0].max_tokens,4096);assert.equal(requests[1].max_tokens,8192);assert.equal(requests[0].tool_choice,'auto');assert.equal(requests[0].thinking.type,'disabled');
  const row=(await budget.read()).find(x=>x.type==='reserve');assert.equal(row.meta.attemptId,'a');assert(!JSON.stringify(row).includes('NEVER'));
  assert.equal(outputLimits({maxTokens:10000,stageMaxTokens:{prose:12000}})('prose'),12000);assert.equal(outputLimits({maxTokens:10000})('draft'),10000);
  assert.throws(()=>outputLimits({maxTokens:384001,providerOutputLimit:384000}),/INVALID_MAX_TOKENS/);assert.throws(()=>outputLimits({stageMaxTokens:{typo:3}}),/INVALID_MAX_TOKENS/);
});
test('provider-reported cost is kept exactly; no estimate substituted',async()=>{
  const budget=await ledger();const model=new DeepSeekModel({budget,apiKey:'test',fetchImpl:async()=>({ok:true,status:200,json:async()=>({...success,usage:{...success.usage,cost:.001}})})});
  await model.generate({stage:'prose',system:'x',input:'x'});const summary=await budget.summary();assert.equal(summary.knownActualCostUsd,.001);assert.equal(summary.actualCostStatus,'reported');
});
test('embedding keeps original Nebius hybrid provider and usage cost',async()=>{
  const budget=await ledger();let body;const embed=createOpenRouterEmbedding({budget,apiKey:'test',fetchImpl:async(_u,r)=>{body=JSON.parse(r.body);return{ok:true,status:200,json:async()=>({data:[{index:0,embedding:[1,2]}],usage:{prompt_tokens:4,cost:.00004}})};}});
  assert.deepEqual(await embed(['text']),[[1,2]]);assert.deepEqual(body.provider,{only:['nebius'],allow_fallbacks:false});assert.equal((await budget.summary()).embeddingRequests,1);assert.equal((await budget.summary()).knownActualCostUsd,.00004);
});
test('cancelled request never contacts provider or journals a request',async()=>{
  const budget=await ledger();let calls=0;const fetchImpl=async()=>{calls++;throw new Error('must not run');};const c=new AbortController();c.abort();
  const model=new DeepSeekModel({budget,apiKey:'test',fetchImpl});await assert.rejects(model.generate({stage:'prose',system:'x',input:'x',signal:c.signal}),/ABORTED_BEFORE/);
  await assert.rejects(createOpenRouterEmbedding({budget,apiKey:'test',fetchImpl})(['x'],{signal:c.signal}),/ABORTED_BEFORE/);assert.equal(calls,0);assert.equal((await budget.summary()).reservations,0);
  assert.throws(()=>new DeepSeekModel({budget,apiKey:'test',baseUrl:'https://other.example'}),/UNAUTHORIZED/);
});

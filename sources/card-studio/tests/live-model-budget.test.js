import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LiveModelBudget,requestDigest,reservedRequestMicros,persistBudgetLedger} from '../review/live-model-budget.js';
const endpoint='https://api.deepseek.com/anthropic/v1/messages';
const body=JSON.stringify({model:'deepseek-flash',max_tokens:8192,thinking:{type:'enabled'},output_config:{effort:'max'},messages:[{role:'user',content:'Synthetic only'}]});
// These facts and counts are fake test inputs, not a claim about the live account.
const billing={verified:true,provider:'deepseek-account',model:'deepseek-flash',endpoint,currency:'USD',input:300000,output:1200000,source:'OFFLINE SYNTHETIC TARIFF'};
function setup(options={}){const writes=[];let sent=0;const budget=new LiveModelBudget({billing,
 persist:async state=>{writes.push(structuredClone(state));},
 countInput:async text=>({verified:true,upperBound:500,source:'OFFLINE COUNTER',requestSha256:requestDigest(text)}),...options});
 const send=async args=>{sent++;assert.equal(args.redirect,'error');assert.equal(writes.at(-1).requests.at(-1).status,'reserved');return{usage:{inputTokens:100,outputTokens:50}};};
 return{budget,writes,send,get sent(){return sent;}};}

test('unverified billing rejects before turn or transport',async()=>{const x=setup({billing:{...billing,verified:false}});await assert.rejects(x.budget.beginTurn('A'),{code:'BILLING_UNVERIFIED'});await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'BILLING_UNVERIFIED'});assert.equal(x.sent,0);});
test('explicit public-tariff authorization waives billing observability but not input proof',async()=>{
 const x=setup({billing:{...billing,verified:false,publicEstimateAuthorized:true},
  countInput:async()=>({verified:false,upperBound:100,source:'SDK HEURISTIC'})});
 await x.budget.beginTurn('A');
 await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'INPUT_BOUND_UNVERIFIED'});assert.equal(x.sent,0);
 const y=setup({billing:{...billing,verified:false,publicEstimateAuthorized:true}});
 await y.budget.beginTurn('A');await y.budget.dispatch('A',endpoint,body,y.send);assert.equal(y.sent,1);
});
test('heuristic input counts and mismatched request digests reject before transport',async()=>{for(const count of [{verified:false,upperBound:100,source:'SDK HEURISTIC'},{verified:true,upperBound:100,source:'FAKE',requestSha256:'wrong'}]){const x=setup({countInput:async()=>count});await x.budget.beginTurn('A');await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'INPUT_BOUND_UNVERIFIED'});assert.equal(x.sent,0);assert.equal(x.budget.snapshot().requests.length,0);}});
test('32k input and output/reasoning model limits reject before transport',async()=>{const x=setup({countInput:async()=>({verified:true,upperBound:32001,source:'COUNTER',requestSha256:requestDigest(body)})});await x.budget.beginTurn('A');await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'INPUT_LIMIT'});await assert.rejects(x.budget.dispatch('A',endpoint,body.replace('8192','8193'),x.send),{code:'MODEL_LIMIT_REJECTED'});assert.equal(x.sent,0);});
test('lower requested output preserves the actual-usage guard and full reservation',async()=>{
 const x=setup();await x.budget.beginTurn('A');await x.budget.dispatch('A',endpoint,body.replace('8192','8191'),x.send);assert.equal(x.sent,1);assert.equal(x.budget.totalReserved(),19431);
 await assert.rejects(x.budget.dispatch('A',endpoint,body.replace('8192','8191'),async()=>({usage:{inputTokens:100,outputTokens:8193}})),{code:'PROVIDER_LIMIT_VIOLATION'});assert.equal(x.budget.snapshot().stopped,'PROVIDER_LIMIT_VIOLATION');
});
test('destination and media rejection happen before transport',async()=>{const x=setup();await x.budget.beginTurn('A');await assert.rejects(x.budget.dispatch('A','https://unapproved.invalid/messages',body,x.send),{code:'DESTINATION_REJECTED'});await assert.rejects(x.budget.dispatch('A',endpoint,body.replace('Synthetic only','').replace('"content":""','"content":[{"type":"image"}]'),x.send),{code:'MEDIA_OR_SERVER_TOOL_REJECTED'});assert.equal(x.sent,0);});
test('reservation is durable before send and never reduced by low usage',async()=>{const x=setup();await x.budget.beginTurn('A');await x.budget.dispatch('A',endpoint,body,x.send);assert.equal(x.sent,1);assert.equal(x.budget.totalReserved(),19431);assert.equal(x.budget.snapshot().requests[0].estimatedMicros,90);});
test('all continuations/retries and resumed ledgers share the thirty request cap',async()=>{const x=setup();for(const c of ['A','B','C']){await x.budget.beginTurn(c);await x.budget.beginTurn(c);for(let i=0;i<({A:10,B:12,C:8})[c];i++)await x.budget.dispatch(c,endpoint,body,x.send);await assert.rejects(x.budget.dispatch(c,endpoint,body,x.send),{code:'REQUEST_LIMIT'});}assert.equal(x.sent,30);assert.equal(x.budget.totalReserved(),582930);assert(reservedRequestMicros(billing)*30<1000000);const y=setup({state:x.budget.snapshot()});await assert.rejects(y.budget.dispatch('A',endpoint,body,y.send),{code:'REQUEST_LIMIT'});assert.equal(y.sent,0);});
test('two turns per case, six total, and three rounds cannot be reset',async()=>{const x=setup();for(const c of ['A','B','C']){await x.budget.beginTurn(c);await x.budget.beginTurn(c);await assert.rejects(x.budget.beginTurn(c),{code:'TURN_LIMIT'});}await x.budget.nextRound();await x.budget.nextRound();await assert.rejects(x.budget.nextRound(),{code:'ROUND_LIMIT'});});
test('new authorized batch reallocates case calls but retains aggregate thirty and one batch round',async()=>{
 const limits={requests:30,turns:6,rounds:1,input:32000,output:8192,usdMicros:1000000,cases:{A:30,B:30,C:30}},x=setup({limits});
 for(const c of ['A','B','C']){await x.budget.beginTurn(c);for(let i=0;i<({A:11,B:10,C:9})[c];i++)await x.budget.dispatch(c,endpoint,body,x.send);}
 assert.equal(x.sent,30);await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'REQUEST_LIMIT'});await assert.rejects(x.budget.nextRound(),{code:'ROUND_LIMIT'});
 const resumed=setup({limits,state:x.budget.snapshot()});await assert.rejects(resumed.budget.dispatch('B',endpoint,body,resumed.send),{code:'REQUEST_LIMIT'});assert.equal(resumed.sent,0);
});
test('ledger write failure prevents the first network call',async()=>{const x=setup();await x.budget.beginTurn('A');x.budget.persist=async()=>{throw Object.assign(new Error('disk'),{code:'DISK_FAILED'});};await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'DISK_FAILED'});assert.equal(x.sent,0);assert.equal(x.budget.snapshot().stopped,'LEDGER_FAILED');});
test('missing usage stops and retains full reservation after disconnection',async()=>{const x=setup();await x.budget.beginTurn('A');await assert.rejects(x.budget.dispatch('A',endpoint,body,async()=>({})),{code:'USAGE_MISSING'});assert.equal(x.budget.totalReserved(),19431);await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'STOPPED'});assert.equal(x.sent,0);});
test('cancel reaches the outstanding request and prohibits another call',async()=>{const x=setup();await x.budget.beginTurn('A');let started;const ready=new Promise(resolve=>started=resolve);const pending=x.budget.dispatch('A',endpoint,body,({signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));await ready;x.budget.cancel();await assert.rejects(pending,{code:'CANCELLED'});assert.equal(x.budget.totalReserved(),19431);await assert.rejects(x.budget.dispatch('A',endpoint,body,x.send),{code:'STOPPED'});});
test('reported input or output above the authorized limits cancels future calls',async()=>{const x=setup();await x.budget.beginTurn('A');await assert.rejects(x.budget.dispatch('A',endpoint,body,async()=>({usage:{inputTokens:32001,outputTokens:50}})),{code:'PROVIDER_LIMIT_VIOLATION'});assert.equal(x.budget.snapshot().stopped,'PROVIDER_LIMIT_VIOLATION');});

test('real local ledger survives reopening and reserves before transport',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cardstudio-018-budget-'));
 try{
  const file=path.join(directory,'ledger.json'),x=setup({persist:persistBudgetLedger(file)});
  await x.budget.beginTurn('A');
  await x.budget.dispatch('A',endpoint,body,async()=>{
   const onDisk=JSON.parse(await fs.readFile(file,'utf8'));
   assert.equal(onDisk.requests.length,1);assert.equal(onDisk.requests[0].status,'reserved');
   assert.equal(onDisk.requests[0].reservedMicros,19431);
   return {usage:{inputTokens:100,outputTokens:50}};
  });
  const onDisk=JSON.parse(await fs.readFile(file,'utf8')),resumed=setup({state:onDisk,persist:persistBudgetLedger(file)});
  assert.equal(resumed.budget.totalReserved(),19431);
  await resumed.budget.dispatch('A',endpoint,body,async()=>({usage:{inputTokens:100,outputTokens:50}}));
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).requests.length,2);
  const text=await fs.readFile(file,'utf8');assert(!text.includes('Synthetic only'));assert(!text.includes('x-dsh-auth-token'));
 }finally{assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});}
});

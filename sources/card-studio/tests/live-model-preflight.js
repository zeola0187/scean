// Historical original 23-request gate audit only. Latest cumulative audit is review/audit-live-history.py.
// No credential lookup, provider call or ledger reset; never overwrite current acceptance.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {LiveModelBudget,LIVE_LIMITS} from '../review/live-model-budget.js';
import {countReferenceInput} from '../review/live-input-bound.js';
const root=new URL('../',import.meta.url),read=async name=>JSON.parse(await fs.readFile(new URL('test-evidence/'+name,root),'utf8'));
const state=await read('live-model-ledger.json');assert.equal(state.requests.length,23);assert.equal(state.round,3);
const actual=await read('live-model-abc.json');assert.equal(actual.modelRequests,state.requests.length);
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('OFFLINE_PREFLIGHT_NO_NETWORK');};
const billing={verified:false,publicEstimateAuthorized:true,provider:'deepseek-account',model:'deepseek-flash',
 endpoint:'https://api.deepseek.com/anthropic/v1/messages',currency:'USD',input:300000,output:1200000,source:'https://api-docs.deepseek.com/quick_start/pricing/'};
const budget=new LiveModelBudget({state,billing,countInput:countReferenceInput,persist:async()=>{throw new Error('READ_ONLY_PREFLIGHT');}});budget.assertGate();
const payloads=await read('outbound-payload-review.json'),bounds=[];
for(const row of payloads.payloads){
 const body=JSON.stringify(JSON.parse(await fs.readFile(new URL(row.file,root),'utf8')));
 const count=await budget.verifyInput(body);bounds.push({case:row.case,upperBound:count.upperBound,requestSha256:count.requestSha256});
}
const sample=JSON.parse(await fs.readFile(new URL(payloads.payloads[0].file,root),'utf8'));
sample.messages.push({role:'assistant',content:[{type:'thinking',thinking:'OFFLINE representative reasoning replay',signature:'OFFLINE'},
 {type:'tool_use',id:'synthetic-call',name:'card_read',input:{document_id:'synthetic-only',fields:['personality'],nested:{emoji:'🍲',line:'背景\n保留'}}}]},
 {role:'user',content:[{type:'tool_result',tool_use_id:'synthetic-call',content:[{type:'text',text:'{"ok":true,"value":{"personality":"合成資料"}}'}]}]});
const representativeReplay=await budget.verifyInput(JSON.stringify(sample));
const comparisons=[];
for(const row of actual.requests.slice(0,4)){
 const count=await budget.verifyInput(JSON.stringify(row.body));
 comparisons.push({request:row.number,referenceTokens:count.referenceTokens,actualInputTokens:row.accountedUsage.inputTokens,match:count.referenceTokens===row.accountedUsage.inputTokens});
}
assert(comparisons.every(row=>row.match));
const report={status:'HISTORICAL_ORIGINAL_23_REQUESTS_READ_ONLY_AUDIT',modelRequests:state.requests.length,
 round:state.round,requestsByCase:Object.fromEntries(['A','B','C'].map(n=>[n,state.requests.filter(r=>r.case===n).length])),
 modelInputTokens:state.requests.reduce((s,r)=>s+(r.usage?.inputTokens??0),0),
 modelOutputTokens:state.requests.reduce((s,r)=>s+(r.usage?.outputTokens??0),0),
 unknownUsageRequests:state.requests.filter(r=>!r.usage).map(r=>r.number),networkAttempts,limits:LIVE_LIMITS,
 cases:{A:'PARTIAL_NO_MODEL_EXPORT',B:'FAIL_MAIN_PRESENTATION_PARTIAL_TOOLS',C:'FAIL_SHORT_SUMMARY_INVALID_LEASE_EVIDENCE'},
 localReferenceInputGate:{ready:true,bounds,representativeReplayUpperBound:representativeReplay.upperBound,comparisons,serverInputPrelocked:false,source:representativeReplay.source},
 actualProviderDebitUSD:null,estimatedUSD:actual.estimatedUSD,reservedUSD:actual.reservedUSD,
 disclosureAuthorization:'Explicit human consent received after two automatic-review refusals; actual provider execution then approved.',
 repairedAfterLiveRun:['Main-text guidance covers repair/delivery and intermediate replies','Export-only argument guidance','Normal 20-second native page renewal','Gate evaluate readonly admission','Stop before provider call when native tools/context disappear'],
 postFixRealModelRetested:false,
 untested:['Complete real-model A/B/C after fixes','Official full Agent loop/daily Desktop UI','TT runtime','human acceptance']};
assert.equal(networkAttempts,0);await fs.writeFile(new URL('test-evidence/live-model-preflight-original-history.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,modelRequests:report.modelRequests,requestsByCase:report.requestsByCase,inputCounterMatches:comparisons.length,networkAttempts}));

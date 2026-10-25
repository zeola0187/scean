import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SceanHost} from '../plugin/host.mjs';
import {createNativeModelPort as createPort} from '../plugin/native-model.mjs';
// Milestone A requires explicit DSH selection/capabilities in synthetic fixtures.
function createNativeModelPort(args){
  const llm=args.llm;
  if(!llm.resolveModelInfo)llm.resolveModelInfo=async()=>({reasoning:{efforts:[{id:'off',name:'Off'}],defaultEffort:'off'}});
  return createPort({...args,agentDefaultModel:{currentSelection:()=>({provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off'})}});
}

import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';

const snapshot={schemaVersion:1,cardId:'synthetic-plugin-fixture',revision:1,card:{name:'Synthetic ship'},worldbook:{entries:[]},preset:{},characters:[{id:'captain',name:'Captain',description:'Captain of the synthetic ship.'}]};
const model={async generate({stage}){return {text:stage==='post_stat'?JSON.stringify({contractVersion:2,stateChanges:[{scope:'world',category:'facts',key:'visited',operation:'set',value:true}],memories:[{text:'The player visited the deck.',characterIds:[],schemaVersion:2,access:{kind:'world_public'},knowers:[],epistemic:{kind:'fact'},credibility:'confirmed',visibility:'public',participants:{speakers:[],actors:['player'],decisionMakers:[]}}]}):'The player visits the quiet deck.'};}};
async function fixture(){const base=new URL('../evidence/plugin-test-temp/',import.meta.url);await mkdir(base,{recursive:true});const root=await mkdtemp(join(fileURLToPath(base),'host-'));const engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:join(root,'store')}),model,memory:new Memory()});return {root,engine,host:await new SceanHost({engine,root:join(root,'host')}).init()};}

test('OFFLINE plugin host: Studio saved snapshots isolated; read-only binding fails cross-session/run/generation and restores',async()=>{
  const {root,engine,host}=await fixture();const r1=await host.startFromStudio({snapshot,authoringSessionId:'author-A',generation:1});
  snapshot.card.name='Changed later';
  const r2=await host.startFromStudio({snapshot:{...snapshot,revision:2},authoringSessionId:'author-A',generation:1});
  const read=await host.inspectFromStudio({...r1,authoringSessionId:'author-A',generation:1});assert.equal(read.snapshot.card.name,'Synthetic ship');
  for(const forged of [{...r1,authoringSessionId:'author-B',generation:1},{...r1,authoringSessionId:'author-A',generation:2},{...r1,runId:r2.runId,authoringSessionId:'author-A',generation:1}])await assert.rejects(host.inspectFromStudio(forged),{code:'INSPECTION_DENIED'});
  const renewed=await host.attachInspection({runId:r1.runId,priorBinding:r1.binding,authoringSessionId:'author-A',generation:2});
  const restarted=await new SceanHost({engine,root:join(root,'host')}).init();assert.equal((await restarted.inspectFromStudio({...renewed,authoringSessionId:'author-A',generation:2})).snapshot.revision,1);
  assert.equal(restarted.listRuns().length,2);assert(!JSON.stringify(await host.inspect(r1.runId)).includes(r1.binding));
});
test('OFFLINE plugin host: two turns commit, restart readback, independent action dispatch and BanList',async()=>{
  const {root,engine,host}=await fixture();const {runId}=await host.createRun({snapshot});
  assert.equal(host.capabilities().version,JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version);
  const first=await host.request({action:'turn',runId,input:'Visit the deck',requestId:'plugin-request-1'});assert(first.ok);assert.equal(first.value.status,'committed');
  assert((await host.request({action:'turn',runId,input:'Remember the visit',requestId:'plugin-request-2'})).ok);
  const restarted=await new SceanHost({engine,root:join(root,'host')}).init();const read=await restarted.inspect(runId);assert.equal(read.turns.length,2);assert.equal(read.memories.length,2);assert.equal(read.availability.directorTools,'not_called');
  assert((await host.request({action:'banList',runId,banList:['forbidden'],expectedVersion:read.version})).ok);
  assert.equal((await host.request({action:'delete',runId})).error.code,'ACTION');
});
test('OFFLINE plugin host: cancellation owned by RP; closing Studio does not enter cancellation path',async()=>{
  let began;const ready=new Promise(r=>began=r);const {host,engine}=await fixture();engine.model={generate:async({signal})=>{began();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
  const {runId}=await host.createRun({snapshot});const pending=host.request({action:'turn',runId,input:'Wait',requestId:'plugin-cancel'});await ready;
  assert.equal((await host.request({action:'turn',runId,input:'Concurrent',requestId:'plugin-concurrent'})).error.code,'RUN_BUSY');
  assert.equal(host.cancel({runId,operationId:(await host.progress(runId)).operationId}).cancelRequested,true);assert.equal((await pending).ok,false);assert.equal((await host.inspect(runId)).version,0);
});
test('OFFLINE plugin host: reconstruct run index after interrupted host metadata publication',async()=>{
  const {root,engine,host}=await fixture();const canonical=await engine.createRun({snapshot});
  const restarted=await new SceanHost({engine,root:join(root,'host')}).init();assert.equal(restarted.listRuns()[0].runId,canonical.runId);
  const started=await restarted.startFromStudio({snapshot,authoringSessionId:'studio-uuid-owner',generation:'actual-uuid-generation'});
  await assert.rejects(restarted.inspectFromStudio({...started,binding:'界'.repeat(started.binding.length),authoringSessionId:'studio-uuid-owner',generation:'actual-uuid-generation'}),{code:'INSPECTION_DENIED'});
});
test('OFFLINE native model port: formal chunks and reasoning exclusion; usage start precedes stream without cost reservation',async()=>{
  const events=[];let opts,reservation;
  const llm={async *stream(options){opts=options;events.push('stream');yield {type:'reasoning-delta',index:0,text:'PRIVATE_REASONING_SENTINEL'};yield {type:'block-end',index:0,block:{type:'reasoning',text:'PRIVATE_REASONING_SENTINEL'}};yield {type:'tool-call-delta',index:1,id:'call-1',name:'adjudicate_action',argumentsDelta:'{"action":"climb"}'};yield {type:'usage',usage:{inputTokens:20,outputTokens:10}};yield {type:'finish',reason:{kind:'tool-calls'}};}};
  const budget={reserve:async value=>{reservation=value;events.push('reserve');return 'usage-1';},settle:async()=>events.push('settle')};
  const port=createNativeModelPort({llm,budget});const result=await port.generate({stage:'director',system:'Brief',input:{input:'Climb'},tools:[{type:'function',function:{name:'adjudicate_action',parameters:{type:'object'}}}]});
  assert.deepEqual(events,['reserve','stream','settle']);assert.equal(reservation.maxCostUsd,undefined);assert.equal(reservation.meta.maxTokens,null);assert(!Object.hasOwn(opts,'maxTokens'));assert.equal(result.route.outputBudget.source,'adapter_default_unknown');assert.equal(opts.provider,'deepseek-official');assert.equal(opts.model,'deepseek-flash');assert.equal(opts.tools[0].name,'adjudicate_action');assert.equal(result.toolCalls[0].arguments.action,'climb');assert(!JSON.stringify(result).includes('PRIVATE_REASONING_SENTINEL'));
});
test('OFFLINE native model port: token cutoff and malformed tool outputs fail; usage still settled',async()=>{
  let settles=0;const budget={reserve:async()=> 'id',settle:async()=>settles++};
  for(const reason of ['max-tokens','error','aborted']){const port=createNativeModelPort({budget,llm:{async *stream(){yield {type:'text-delta',index:0,text:'partial'};yield {type:'finish',reason:{kind:reason}};}}});await assert.rejects(port.generate({stage:'prose',system:'',input:'test'}));}
  assert.equal(settles,3);
});

test('R2 host failure reports safe code/reason/stage and refreshed lastFailure without half commit',async()=>{
  const {host,engine}=await fixture(); const {runId}=await host.createRun({snapshot});
  engine.model={generate:async()=>{throw Object.assign(new Error('Bearer SYNTHETIC_REDACTION_FIXTURE_000000'),{code:'max-tokens'});}};
  const failed=await host.request({action:'turn',runId,input:'Synthetic bounded request',requestId:'failure-ui'});
  assert.equal(failed.ok,false);assert.equal(failed.error.code,'max-tokens');assert.equal(failed.error.stage,'director');assert.equal(failed.lastFailure.attemptId,failed.error.attemptId);
  assert(!JSON.stringify(failed).includes('PRIVATE_PROVIDER_SENTINEL'));
  const view=await host.inspect(runId);assert.equal(view.version,0);assert.equal(view.memories.length,0);assert.equal(view.lastFailure.attemptId,failed.error.attemptId);assert.ok(view.attempts[0].stages[0].finishedAt);
});

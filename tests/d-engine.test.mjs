import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {updateSummary,selectNarrative} from '../core/narrative.mjs';
import {searchHistory,HISTORY_REFERENCE_LABEL} from '../core/history-recall.mjs';
import {hash} from '../core/contracts.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';

const code=value=>error=>error.code===value;
const clone=structuredClone;
const advice=characterId=>({adviceVersion:1,characterId,observable:{attitude:'calm',intent:'wait'},publicUtterances:['Only public advice.'],withheld:['SYNTHETIC_WITHHELD'],internal:{notes:['SYNTHETIC_INTERNAL']},intendedDisclosures:[]});
async function setup({turns=100,recentWindow=6,strategy,summaryText='AER_PROMISE_COMPASS_AND_UNFINISHED_CALIBRATION',contextWindow=200000,mutate}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-d-engine-')),store=new DurableStore({root}),run=syntheticLongrun({turns,runId:'d-engine-synthetic',bodyRepeats:0});
  if(mutate)mutate(run);
  await store.create(run);const calls=[];
  const model={async describe({stage}){return {capabilities:{contextWindow:stage==='summary'?200000:contextWindow,outputLimit:4096}};},async generate(args){calls.push(clone({stage:args.stage,input:args.input,context:args.context,tools:args.tools??null}));if(args.stage==='summary')return {text:summaryText,model:'synthetic-d-summary'};if(args.stage==='director')return strategy?strategy(args):{text:'The public crew pauses at the dock.'};if(args.stage==='character')return {text:JSON.stringify(advice(args.input.character.id))};if(args.stage==='draft'||args.stage==='prose')return {text:'The crew waited at the northern dock.'};if(args.stage==='post_stat')return {text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};throw Error(args.stage);}};
  const memory={async retrieve({records}){return {records:clone(records),status:'synthetic-local'};}};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory,recentWindow});return {root,store,run,model,memory,engine,calls};
}
const play=f=>f.engine.turn({runId:f.run.runId,requestId:'d-engine-next',input:'Continue the public watch.'});
async function summarize(f,endTurn,operationId){const run=await f.store.read(f.run.runId);return updateSummary(f.engine,{runId:run.runId,expectedVersion:run.version,expectedHead:run.head,operationId,endTurn,recentWindow:f.engine.recentWindow},{enabled:true});}

test('D1 actual writer port receives rolling summary plus bounded recent originals, no full history or source hashes',async()=>{
  const f=await setup();await summarize(f,50,'summary-first');await summarize(f,94,'summary-second');await play(f);
  const summaries=f.calls.filter(c=>c.stage==='summary');assert.equal(summaries[0].input.turns.length,50);assert.equal(summaries[1].input.turns.length,44);assert.equal(summaries[1].input.turns[0].turn,51);assert.equal(summaries[1].input.previousSummary.text,'AER_PROMISE_COMPASS_AND_UNFINISHED_CALIBRATION');
  const director=f.calls.find(c=>c.stage==='director').input.assembly,draft=f.calls.find(c=>c.stage==='draft').input.context;
  for(const packet of [director,draft]){assert.equal(packet.rollingSummary.endTurn,94);assert.equal(packet.recentDialogue.length,6);assert.deepEqual(packet.recentDialogue.map(t=>t.turn),[95,96,97,98,99,100]);assert(!JSON.stringify(packet.rollingSummary).includes('Hash'));assert(!JSON.stringify(packet).includes('PROMISE_COMPASS '));assert(!JSON.stringify(packet).includes(D_PRIVATE));}
  for(const call of f.calls.filter(c=>['prose','post_stat'].includes(c.stage))){assert(!JSON.stringify(call.input).includes('rollingSummary'));assert(!JSON.stringify(call.input).includes('AER_PROMISE_COMPASS'));}
  const attempt=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(attempt.assemblyDiagnostics.narrative.overlapTurns,0);assert.equal(attempt.assemblyDiagnostics.narrative.unsummarizedOmittedTurns,0);assert(attempt.assemblyDiagnostics.narrative.stageUse.some(s=>s.stage==='director'&&s.summaryStatus==='included'&&s.status==='completed'));
  const saved=await f.store.read(f.run.runId);assert.equal(saved.memories.length,f.run.memories.length);assert.equal(selectNarrative(saved).summary.endTurn,94);
});
test('D1 recent window configuration bounds immutable Snapshot seed history and static summary remains unchanged',async()=>{
  const f=await setup({turns:2,recentWindow:3,mutate:r=>{r.snapshot.chapterSummary='STATIC_AUTHOR_SUMMARY';r.snapshot.recentDialogue=Array.from({length:20},(_,i)=>({input:'seed '+i,body:'SEED_'+i}));}});
  await play(f);const assembly=f.calls.find(c=>c.stage==='director').input.assembly;assert.equal(assembly.chapterSummary,'STATIC_AUTHOR_SUMMARY');assert.equal(assembly.recentDialogue.length,3);assert.equal(assembly.recentDialogue[0].body,'SEED_19');assert.equal(assembly.rollingSummary,undefined);
  assert.equal((await f.store.read(f.run.runId)).snapshot.chapterSummary,'STATIC_AUTHOR_SUMMARY');
  for(const recentWindow of [0,51,1.5])assert.throws(()=>new SceanEngine({unconfiguredWritingMode:'current',store:f.store,model:f.model,memory:f.memory,recentWindow}),code('INVALID_RECENT_WINDOW'));
});
test('D1 no platform quota preserves the complete rolling summary even when estimates exceed reported context',async()=>{
 const f=await setup({turns:10,contextWindow:14000,summaryText:'龜'.repeat(15000)});await summarize(f,4,'large-summary');await play(f);
 const writer=f.calls.find(c=>c.stage==='director').input.assembly;assert.equal(writer.rollingSummary.text,'龜'.repeat(15000));assert.equal(writer.recentDialogue.length,6);
 const trace=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(trace.contextPreflights[0].estimatedOverflow,true);assert(trace.contextPreflights[0].sources.every(s=>s.included));
});
test('D2 Director optional Search and Read use public history; owner CR never receives those reference packets',async()=>{
  const f=await setup({summaryText:'Public cumulative summary of prior watches.',strategy:({input})=>input.conversation.length?{text:'The crew considers the publicly established promise.'}:{text:'',toolCalls:[{id:'search-source',name:'search_history',arguments:{query:'PROMISE_COMPASS'}},{id:'read-source',name:'read_history',arguments:{commitId:'d-commit-0001'}},{id:'consult-owner',name:'consult_character',arguments:{characterId:'sio',question:'What public advice can you offer?'}}]}});
  await summarize(f,50,'history-prefix');await summarize(f,94,'history-tail');f.calls.length=0;
  await play(f);const secondDirector=f.calls.filter(c=>c.stage==='director')[1],refs=JSON.stringify(secondDirector.input.conversation);assert(refs.includes(HISTORY_REFERENCE_LABEL));assert(refs.includes('PROMISE_COMPASS'));assert(!refs.includes(D_PRIVATE));
  const owner=f.calls.find(c=>c.stage==='character');assert(!JSON.stringify(owner.input).includes('PROMISE_COMPASS'));assert(!JSON.stringify(owner.input).includes(D_PRIVATE));assert(!JSON.stringify(owner.input).includes('history_read'));
  for(const call of f.calls.filter(c=>['draft','prose','post_stat'].includes(c.stage))){assert(!JSON.stringify(call.input).includes('PROMISE_COMPASS'));assert(!JSON.stringify(call.input).includes('history_read'));assert(!JSON.stringify(call.input).includes('SYNTHETIC_INTERNAL'));}
  const attempt=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(attempt.tools[1].historyBudget.calls,2);assert(attempt.tools[1].historyBudget.cumulativeEstimate<=6000);assert.equal(attempt.tools[0].kind,'historical_reference_not_current_event');
});
test('D2 no compulsory history consultation or added model stages during a normal turn',async()=>{
  const f=await setup({turns:5});await play(f);assert.deepEqual(f.calls.map(c=>c.stage),['director','draft','prose','post_stat']);assert.equal((await f.store.readAttempts(f.run.runId)).at(-1).tools.length,0);
});
test('D2 wrong derived summary can be checked against original Read without rewriting State or Memory',async()=>{
  const f=await setup({turns:10,summaryText:'INCORRECT: The copper compass was destroyed.',strategy:({input})=>input.conversation.length?{text:'Follow the original promise.'}:{text:'',toolCalls:[{id:'check-original',name:'read_history',arguments:{commitId:'d-commit-0001'}}]}});await summarize(f,4,'incorrect-summary');const before=await f.store.read(f.run.runId);await play(f);
  assert(f.calls.filter(c=>c.stage==='director')[1].input.conversation.at(-1).result.text.includes('promised to return the copper compass'));
  const after=await f.store.read(f.run.runId);assert.deepEqual(after.state,before.state);assert.deepEqual(after.memories,before.memories);assert.equal(selectNarrative(after).summary.text,'INCORRECT: The copper compass was destroyed.');
});
test('D2 tool count limit aborts before a fourth reference and preserves canonical aggregate',async()=>{
  const f=await setup({turns:10,strategy:()=>({text:'',toolCalls:Array.from({length:4},(_,i)=>({id:'history-'+i,name:'search_history',arguments:{query:'compass',limit:1}}))})});const before=await f.store.read(f.run.runId);await assert.rejects(play(f),code('HISTORY_TOOL_LIMIT'));assert.deepEqual(await f.store.read(f.run.runId),before);const attempt=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(attempt.tools.filter(t=>t.status==='completed').length,3);assert.equal(f.calls.length,1);
});
test('D2 legal large original reaches the next Director without a platform token quota',async()=>{
 const f=await setup({turns:5,mutate:r=>{const t=r.turns[0];t.body='龜'.repeat(3500);t.bodyHash=hash(t.body);r.receipts[t.requestId].result.body=t.body;r.memories.filter(m=>m.source.commitId===t.commitId).forEach(m=>m.source.bodyHash=t.bodyHash);},strategy:({input})=>input.conversation.length?{text:'Follow the supplied original.'}:{text:'',toolCalls:[{id:'large-original',name:'read_history',arguments:{commitId:'d-commit-0001'}}]}});
 await play(f);assert.equal(f.calls.filter(c=>c.stage==='director').length,2);const trace=(await f.store.readAttempts(f.run.runId)).at(-1);assert(trace.tools[0].historyBudget.estimatedTokens>6000);assert.equal(trace.tools[0].historyBudget.tokenQuota,null);
});
for(const [name,args,error] of [['search_history',{query:'compass',externalPath:'C:/secret'},'INVALID_HISTORY_TOOL_ARGUMENTS'],['read_history',{commitId:'d-commit-0001',runId:'other-run'},'HISTORY_CROSS_RUN'],['read_history',{commitId:'missing-commit'},'HISTORY_COMMIT_NOT_FOUND'],['read_history',{commitId:'d-commit-0001',radius:2},'HISTORY_READ_RADIUS']])test(`D2 ${name} rejects ${error} safely`,async()=>{
  const f=await setup({turns:5,strategy:()=>({text:'',toolCalls:[{id:'bad-history',name,arguments:args}]})});const before=await f.store.read(f.run.runId);await assert.rejects(play(f),code(error));assert.deepEqual(await f.store.read(f.run.runId),before);
});
test('D1 a new committed story invalidates pending summary before a late summary result',async()=>{
  const f=await setup({turns:10});let release,started;const pending=new Promise(resolve=>{release=resolve;}),begun=new Promise(resolve=>{started=resolve;});const synthetic={describe:f.model.describe,async generate(){started();await pending;return{text:'LATE_SUMMARY',model:'synthetic-late'};}};
  const run=await f.store.read(f.run.runId);const task=updateSummary(f.engine,{runId:run.runId,operationId:'pending-summary',expectedVersion:run.version,expectedHead:run.head,endTurn:4},{enabled:true,model:synthetic});await begun;await play(f);release();assert.equal((await task).status,'stale');const saved=await f.store.read(f.run.runId);assert.equal(saved.narrative.operations['pending-summary'].status,'stale');assert.equal(saved.narrative.summaries.length,0);
});
test('D2 three individually legal reads remain complete beyond the removed cumulative token quota',async()=>{
 const f=await setup({turns:5,mutate:r=>{const t=r.turns[0];t.body='龜'.repeat(1300);t.bodyHash=hash(t.body);r.receipts[t.requestId].result.body=t.body;r.memories.filter(m=>m.source.commitId===t.commitId).forEach(m=>m.source.bodyHash=t.bodyHash);},strategy:({input})=>input.conversation.length?{text:'Use all three original references.'}:{text:'',toolCalls:Array.from({length:3},(_,i)=>({id:'read-'+i,name:'read_history',arguments:{commitId:'d-commit-0001'}}))}});
 await play(f);const trace=(await f.store.readAttempts(f.run.runId)).at(-1);assert.equal(trace.tools.filter(t=>t.status==='completed').length,3);assert(trace.tools.at(-1).historyBudget.cumulativeEstimate>6000);
});
test('D2 retired source is unavailable to Director after real rollback',async()=>{
  const f=await setup({turns:5,strategy:()=>({text:'',toolCalls:[{id:'retired-source',name:'read_history',arguments:{commitId:'d-commit-0005'}}]})});await f.engine.rollback({runId:f.run.runId,operationId:'retire-final',expectedVersion:5,expectedHead:'d-commit-0005'});const before=await f.store.read(f.run.runId);await assert.rejects(play(f),code('HISTORY_COMMIT_RETIRED'));assert.deepEqual(await f.store.read(f.run.runId),before);
});
test('D1 summary stage override can be saved explicitly without invoking it',async()=>{
  const f=await setup({turns:1});const run=await f.engine.createRun({snapshot:f.run.snapshot,stageModelSelections:{summary:{provider:'synthetic-local',model:'offline-summary'}}});assert.equal(run.stageModelSelections.summary.model,'offline-summary');assert.equal(f.calls.length,0);
});
test('D1 cancel before story publication leaves pending summary source valid',async()=>{
  const f=await setup({turns:10});let release,started;const pending=new Promise(resolve=>{release=resolve;}),begun=new Promise(resolve=>{started=resolve;});const synthetic={describe:f.model.describe,async generate(){started();await pending;return{text:'SUMMARY_STILL_VALID',model:'synthetic-late'};}};
  const run=await f.store.read(f.run.runId),task=updateSummary(f.engine,{runId:run.runId,operationId:'pending-unmodified',expectedVersion:run.version,expectedHead:run.head,endTurn:4},{enabled:true,model:synthetic});await begun;
  const abort=new AbortController();abort.abort();await assert.rejects(f.engine.turn({runId:run.runId,requestId:'cancelled-story',input:'Wait.',signal:abort.signal}),code('CANCELLED'));release();assert.equal((await task).status,'completed');assert.equal((await f.store.read(run.runId)).turns.length,10);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';
import {backfillChapterSummary} from '../core/chapter-summary.mjs';
import {closeChapter,validateNarrative} from '../core/narrative.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash,json} from '../core/contracts.mjs';

// Actual Store / chapter transaction / portable-schema integration. Every source
// and provider result below is invented; no production data or network model.
const copy=structuredClone,code=c=>e=>e.code===c;
const roots=[];
const tmpRoot=resolve(process.cwd(),'.test-tmp');
const data=text=>({title:'合成港口紀錄',summary:text,keywords:['港口'],characters:['紀錄員'],locations:['碼頭'],plotThreads:['尚待校準'],emotionalTone:'平靜'});
const publicTurns=run=>run.turns.map(t=>({turn:t.turn,commitId:t.commitId,input:t.input,body:t.body}));
const authority=run=>Object.fromEntries(['snapshot','head','turns','state','baselineState','stateProvenance','baselineProvenance','memories','playerHistory','receipts','operationReceipts','retired','banList'].map(k=>[k,copy(run[k])]));
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};

function exactSource(run,bytes){
 for(const turn of run.turns)turn.body='這是隔離合成章節的公開航海紀錄。'.repeat(140)+turn.body;
 const remaining=bytes-Buffer.byteLength(json(publicTurns(run)));
 assert(remaining>=0,'fixture must start below the requested exact byte count');
 run.turns.at(-1).body+='界'.repeat(Math.floor(remaining/3))+'x'.repeat(remaining%3);
 for(const turn of run.turns){
  turn.bodyHash=hash(turn.body);const receipt=run.receipts[turn.requestId];receipt.result.body=turn.body;
  for(const row of [...run.memories,...run.playerHistory,...receipt.result.memories,...receipt.result.playerHistory])if(row.source.commitId===turn.commitId)row.source.bodyHash=turn.bodyHash;
 }
 assert.equal(Buffer.byteLength(json(publicTurns(run))),bytes);
 validateRunBundle(encodeRunBundle(run));return run;
}

test.after(async()=>{
 for(const root of roots){const rel=relative(tmpRoot,root);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));await rm(root,{recursive:true,force:true});}
});

async function fixture({turns=27,bytes=232697,capabilities={contextWindow:32768,outputLimit:4096},fault}={}){
 await mkdir(tmpRoot,{recursive:true});const root=await mkdtemp(join(tmpRoot,'chapter-batch-integration-'));roots.push(root);
 let run=syntheticLongrun({turns,runId:'synthetic-chapter-batch',bodyRepeats:1});if(bytes)run=exactSource(run,bytes);
 // Configuration must reach describe/generate unchanged, without a provider.
 run.modelSelection={provider:'synthetic-provider',model:'synthetic-main'};
 run.stageModelSelections={chapter_summary:{provider:'synthetic-provider',model:'synthetic-summary'}};
 validateRunBundle(encodeRunBundle(run));
 const store=new DurableStore({root,fault});await store.create(run);
 const engine=new SceanEngine({store,model:{async generate(){throw Error('UNEXPECTED_STORY_MODEL');}},memory:{async retrieve(){throw Error('UNEXPECTED_MEMORY_QUERY');}}});
 const closed=await closeChapter(engine,{runId:run.runId,operationId:'manual-close',expectedVersion:run.version,expectedHead:run.head,title:'既有手動章節'});
 run=await store.read(run.runId);assert.equal(validateNarrative(run),true);validateRunBundle(encodeRunBundle(run));
 const calls=[],descriptions=[],progress=[],model={
  async describe(args){descriptions.push(copy({stage:args.stage,context:args.context}));return{capabilities:copy(capabilities)};},
  async generate(args){
   calls.push(copy({stage:args.stage,system:args.system,input:args.input,context:args.context}));
   const reduced=args.input.turns[0]?.kind==='intermediate_chapter_summary';
   return{text:json(data(reduced?'完整合成章節的最終摘要。':'合成公開原文的局部摘要。')),model:'synthetic-provider/synthetic-summary',finishReason:'stop',usage:{inputTokens:11,outputTokens:7,totalTokens:18,costUSD:0}};
  }
 };
 const request={runId:run.runId,chapterId:closed.chapterId,operationId:'batch-summary',expectedVersion:run.version,expectedHead:run.head,detail:'precise',onProgress:p=>progress.push(copy(p))};
 return{root,run,store,engine,model,calls,descriptions,progress,request,capabilities,read:()=>store.read(run.runId)};
}
const perform=(f,request=f.request,options={})=>backfillChapterSummary(f.engine,request,{enabled:true,model:f.model,timeoutMs:60000,...options});
const portable=run=>{assert.equal(validateNarrative(run),true);return validateRunBundle(encodeRunBundle(run));};
function assertNoPartial(run,f,status){
 assert.deepEqual(authority(run),authority(f.run));assert.deepEqual(run.narrative.chapters,f.run.narrative.chapters);
 assert.equal(run.narrative.chapterSummaries.length,0);assert.equal(run.narrative.operations[f.request.operationId].status,status);portable(run);
}

test('27 turns / exact 232697 bytes backfill through bounded maps and one reduce; portable save, all usage, source and replay stay exact',async()=>{
 const f=await fixture(),result=await perform(f),run=await f.read(),op=run.narrative.operations[f.request.operationId],summary=run.narrative.chapterSummaries[0];
 assert.equal(result.status,'completed');assert.equal(result.created,true);assert.equal(run.version,f.run.version+2);
 assert.deepEqual(authority(run),authority(f.run));assert.deepEqual(run.narrative.chapters,f.run.narrative.chapters);
 assert.equal(run.narrative.chapters.length,1);assert.equal(summary.startTurn,1);assert.equal(summary.endTurn,27);
 assert.equal(op.batching.sourceBytes,232697);assert(op.batching.batchCount>1&&op.batching.batchCount<=16);
 assert.equal(f.calls.length,op.batching.batchCount+1);assert.equal(op.batching.completedCalls,f.calls.length);
 assert.equal(f.descriptions.length,1);assert(f.calls.every(c=>c.stage==='chapter_summary'));
 assert.equal(f.calls.filter(c=>c.input.turns[0]?.kind==='intermediate_chapter_summary').length,1);
 const maps=f.calls.slice(0,-1),reconstructed=new Map();
 for(const call of maps){
  assert(Buffer.byteLength(json({system:call.system,input:call.input}))<=200000);
  assert.equal(call.input.range.startTurn,1);assert.equal(call.input.range.endTurn,27);
  assert.deepEqual(call.input.range.commitIds,f.run.narrative.chapters[0].commitIds);
  assert.deepEqual(call.input.range.sourceHashes,f.run.narrative.chapters[0].sourceHashes);
  for(const part of call.input.turns){
   assert.equal(part.kind,'committed_turn_segment');assert(!/\p{Surrogate}/u.test(part.text));
   if(!reconstructed.has(part.turn))reconstructed.set(part.turn,{turn:part.turn,commitId:part.commitId,input:'',body:''});
   const row=reconstructed.get(part.turn);assert.equal(Buffer.byteLength(row[part.field]),part.startByte);row[part.field]+=part.text;
   assert.equal(Buffer.byteLength(row[part.field]),part.endByte);
  }
 }
 assert.deepEqual([...reconstructed.values()],publicTurns(f.run));
 assert.equal(summary.sourceHash,f.run.narrative.chapters[0].sourceHash);
 assert.deepEqual(summary.payload,data('完整合成章節的最終摘要。'));
 assert.deepEqual(summary.provenance.usage,{inputTokens:11*f.calls.length,outputTokens:7*f.calls.length,totalTokens:18*f.calls.length,costUSD:0});
 for(const call of f.calls){
  assert.deepEqual(call.context.modelSelection,f.run.modelSelection);assert.deepEqual(call.context.stageModelSelections,f.run.stageModelSelections);
  assert.equal(call.context.capacityBudget.contextWindow,32768);assert.equal(call.context.capacityBudget.outputReserve,4096);
  const b=call.context.capacityBudget;assert(b.includedEstimate+b.overheadReserve+b.toolReserve+b.outputReserve<=32768);
 }
 assert(!json(f.calls).includes(D_PRIVATE));assert(f.progress.some(p=>p.batching?.phase==='map'));assert.equal(f.progress.at(-1).batching.completedCalls,f.calls.length);
 const restored=portable(run);assert.deepEqual(restored.narrative.chapterSummaries,run.narrative.chapterSummaries);
 const beforeReplay=await readFile(join(f.store.runDir(run.runId),'current.json'),'utf8'),count=f.calls.length;
 assert.deepEqual(await perform(f),result);assert.equal(f.calls.length,count);
 assert.deepEqual(await backfillChapterSummary({store:new DurableStore({root:f.root})},f.request,{enabled:false}),result);
 assert.equal(await readFile(join(f.store.runDir(run.runId),'current.json'),'utf8'),beforeReplay);
});

test('ordinary fitting closed chapter retains one original summary call and identical public-turn packet',async()=>{
 const f=await fixture({turns:3,bytes:null}),result=await perform(f),run=await f.read();
 assert.equal(result.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.descriptions.length,1);
 const call=f.calls[0];assert.deepEqual(Object.keys(call.input).sort(),['detail','instructions','previousChapters','range','turns']);
 assert.deepEqual(call.input.turns,publicTurns(f.run));assert.deepEqual(call.input.range,{startTurn:1,endTurn:3});
 assert.equal(run.narrative.operations[f.request.operationId].batching.batchCount,0);assert.deepEqual(authority(run),authority(f.run));portable(run);
});

test('map transport failure has one failed operation, no hidden retry or canonical partial',async()=>{
 const f=await fixture(),generate=f.model.generate.bind(f.model);let dispatched=0;
 f.model.generate=async args=>{dispatched++;if(dispatched===2)throw Object.assign(Error('synthetic private provider details must not persist'),{code:'MODEL_TRANSPORT_ERROR'});return generate(args);};
 await assert.rejects(perform(f),code('MODEL_TRANSPORT_ERROR'));assert.equal(dispatched,2);
 const run=await f.read();assertNoPartial(run,f,'failed');assert.equal(run.narrative.operations[f.request.operationId].stages.length,2);
 assert(!json(run).includes('synthetic private provider details must not persist'));
 assert.deepEqual(await perform(f),run.narrative.operations[f.request.operationId].result);assert.equal(dispatched,2);
});

test('cancel in-flight map aborts transport, preserves no canonical partial and ignores a late response',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),controller=new AbortController();let dispatched=0,transport;
 f.model.generate=async args=>{dispatched++;transport=args.signal;entered.resolve();await release.promise;return{text:json(data('遲到的合成摘要。'))};};
 const work=perform(f,{...f.request,signal:controller.signal});await entered.promise;controller.abort();
 await assert.rejects(work,code('CANCELLED'));assert.equal(dispatched,1);assert(transport.aborted);
 assertNoPartial(await f.read(),f,'cancelled');const before=await readFile(join(f.store.runDir(f.run.runId),'current.json'),'utf8');
 release.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(await readFile(join(f.store.runDir(f.run.runId),'current.json'),'utf8'),before);
});

test('authoritative rollback while a map runs makes the captured source stale and never dispatches another batch',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();let dispatched=0;
 f.model.generate=async()=>{dispatched++;entered.resolve();await release.promise;return{text:json(data('已過期來源的合成摘要。'))};};
 const work=perform(f);await entered.promise;const pending=await f.read();
 await f.engine.rollback({runId:f.run.runId,operationId:'synthetic-source-rollback',expectedVersion:pending.version,expectedHead:pending.head});
 const afterRollback=await f.read(),authoritative=authority(afterRollback);portable(afterRollback);release.resolve();
 await assert.rejects(work,code('CHAPTER_SOURCE_CHANGED'));const run=await f.read();
 assert.equal(run.narrative.operations[f.request.operationId].status,'stale');assert.equal(dispatched,1);
 assert.equal(run.narrative.chapterSummaries.length,0);assert.equal(run.narrative.chapters.length,1);
 assert.deepEqual(authority(run),authoritative);assert.equal(run.turns.length,26);portable(run);
});

test('model timeout during first map persists the bounded failure and stops later maps',async()=>{
 const f=await fixture();let dispatched=0,transport;
 f.model.generate=({signal})=>{dispatched++;transport=signal;return new Promise(()=>{});};
 await assert.rejects(perform(f,f.request,{timeoutMs:15}),code('MODEL_TIMEOUT'));
 assert.equal(dispatched,1);assert(transport.aborted);assertNoPartial(await f.read(),f,'failed');
 assert.equal((await f.read()).narrative.operations[f.request.operationId].result.code,'MODEL_TIMEOUT');
});

test('final merge failure keeps validated map results as operation audit only and publishes no partial summary',async()=>{
 const f=await fixture(),generate=f.model.generate.bind(f.model);let dispatched=0;
 f.model.generate=async args=>{dispatched++;if(args.input.turns[0]?.kind==='intermediate_chapter_summary')throw Object.assign(Error('synthetic final merge failure'),{code:'MODEL_TRANSPORT_ERROR'});return generate(args);};
 await assert.rejects(perform(f),code('MODEL_TRANSPORT_ERROR'));const run=await f.read(),op=run.narrative.operations[f.request.operationId];
 assertNoPartial(run,f,'failed');assert.equal(dispatched,op.batching.totalCalls);assert.equal(op.batching.completedCalls,op.batching.batchCount);
 assert(op.stages.slice(0,-1).every(s=>s.status==='completed'&&s.result));assert.equal(op.stages.at(-1).status,'failed');
});

test('lost acknowledgement after final atomic rename reads the same receipt and replay never regenerates',async()=>{
 const f=await fixture();let injected=0;
 f.store.fault=(point,{data:run})=>{if(point==='afterRename'&&run.narrative?.operations?.[f.request.operationId]?.status==='completed'&&injected++===0)throw Object.assign(Error('synthetic lost acknowledgement'),{code:'EIO'});};
 const result=await perform(f),run=await f.read(),calls=f.calls.length;
 assert.equal(result.status,'completed');assert.equal(injected,1);assert.equal(run.narrative.chapterSummaries.length,1);
 assert.deepEqual(await perform(f),result);assert.equal(f.calls.length,calls);assert.deepEqual(authority(run),authority(f.run));portable(run);
});

test('impossible configured context fails planning before model dispatch without lowering its output cap',async()=>{
 const f=await fixture({capabilities:{contextWindow:4300,outputLimit:4096}});
 await assert.rejects(perform(f),e=>['CHAPTER_BATCH_CONTEXT_LIMIT','CHAPTER_BATCH_REDUCE_LIMIT','CHAPTER_BATCH_COUNT_LIMIT'].includes(e.code));
 assert.equal(f.calls.length,0);assert.equal(f.descriptions.length,1);assert.equal(f.capabilities.outputLimit,4096);assertNoPartial(await f.read(),f,'failed');
});

test('a legitimate 51-turn chapter is bounded by bytes/context rather than an arbitrary turn count',async()=>{
 const f=await fixture({turns:51,bytes:null}),before=await f.read();
 const result=await perform(f);assert.equal(result.status,'completed');assert.equal(result.created,true);assert.equal(f.descriptions.length,1);assert(f.calls.length>=1);
 const after=await f.read();assert.deepEqual(authority(after),authority(before));portable(after);
});

test('Host duplicate clicks share one bounded batch operation; live counts and final usage remain readable',async t=>{
 const f=await fixture(),entered=deferred(),release=deferred(),generate=f.model.generate;let first=true;
 f.model.generate=async args=>{if(first){first=false;entered.resolve();await release.promise;}return generate(args);};f.engine.model=f.model;
 const host=await new SceanHost({engine:f.engine,root:join(f.root,'host'),chapterModelsEnabled:true}).init();t.after(()=>host.close());
 const request={...f.request,kind:'chapterSummarize'};delete request.onProgress;
 const accepted=await host.jobs.submit(request);assert(accepted.pending);await entered.promise;
 const duplicate=await host.jobs.submit(request);assert(duplicate.pending);assert.equal(host.jobs.ledger.records.length,1);
 const live=await host.chapterStatus({runId:f.run.runId});assert(live.chapterWork.totalCalls>2);assert.equal(live.chapterWork.completedCalls,0);
 release.resolve();await host.jobs.active.get(f.run.runId).promise;
 const done=await host.jobs.status({runId:f.run.runId,operationId:request.operationId});assert.equal(done.status,'completed');
 const count=f.calls.length;assert.equal((await host.jobs.submit(request)).status,'completed');assert.equal(f.calls.length,count);
 const status=await host.chapterStatus({runId:f.run.runId});assert.equal(status.chapterWork,null);assert.equal(status.operations.at(-1).batching.completedCalls,count);assert.equal(status.operations.at(-1).usage.totalTokens,count*18);
 await assert.rejects(host.jobs.submit({...request,operationId:'stale-new-click'}),code('VERSION_CONFLICT'));assert.equal(f.calls.length,count);
 assert.deepEqual(authority(await f.read()),authority(f.run));portable(await f.read());
});

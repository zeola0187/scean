import test from 'node:test';
import assert from 'node:assert/strict';
import {planChapterBatches,executeChapterBatches,CHAPTER_BATCH_LIMITS} from '../core/chapter-batches.mjs';
import {validateChapterPayload} from '../core/chapter-summary.mjs';
import {hash,json} from '../core/contracts.mjs';
import {budgetStage} from '../core/context-budget.mjs';

const code=c=>e=>e.code===c;
const payload=(text='已提供原文中的合成事件仍待玩家回應。')=>({title:'合成章節',summary:text,keywords:['港口'],characters:['紀錄員'],locations:['碼頭'],plotThreads:['未決事項'],emotionalTone:'平靜'});
const turns=(n=4,body='合成紀錄員在港口觀察。')=>Array.from({length:n},(_,i)=>({turn:i+1,commitId:'synthetic-commit-'+(i+1),input:'合成玩家輸入 '+(i+1),body:body+' 第 '+(i+1)+' 回合'}));
const source=rows=>{const commitIds=rows.map(t=>t.commitId),sourceHashes=rows.map(t=>hash({commitId:t.commitId,input:t.input,body:t.body}));return{startTurn:rows[0].turn,endTurn:rows.at(-1).turn,commitIds,sourceHashes,sourceHash:hash({commitIds,sourceHashes}),runId:'synthetic-batch-run',chapterId:'synthetic-chapter',baseHead:rows.at(-1).commitId,baseVersion:rows.length,snapshotHash:'a'.repeat(64)};};
const options=(rows,extra={})=>({turns:rows,source:source(rows),detail:'precise',previousChapters:[],system:'你是合成章節摘要器。僅整理提供的資料。',instructions:'保留原文的關係與未決線索。',capabilities:{contextWindow:32768,outputLimit:4096},...extra});
function exactRows(bytes=232697){
 const rows=turns(27,'這是合成章節的公開故事正文。'.repeat(180));
 const size=Buffer.byteLength(json(rows)),extra=bytes-size;assert(extra>0);rows.at(-1).body+='界'.repeat(Math.floor(extra/3))+'x'.repeat(extra%3);assert.equal(Buffer.byteLength(json(rows)),bytes);return rows;
}
function reconstruct(plan){
 const result=new Map();for(const map of plan.maps)for(const s of map.input.turns){const key=s.turn;if(!result.has(key))result.set(key,{turn:s.turn,commitId:s.commitId,input:'',body:''});result.get(key)[s.field]+=s.text;}
 return [...result.values()];
}
const execute=(plan,extra={})=>executeChapterBatches(plan,{validatePayload:validateChapterPayload,call:async()=>({value:payload(),trace:{usage:{inputTokens:7,outputTokens:9,totalTokens:16}}}),...extra});

test('ordinary fitting chapter retains identical one-call packet and existing output reserve',async()=>{
 const rows=turns(),opts=options(rows),plan=planChapterBatches(opts),calls=[];
 assert.equal(plan.mode,'single');assert.equal(plan.totalCalls,1);assert.deepEqual(plan.single.input,{detail:opts.detail,range:{startTurn:1,endTurn:4},turns:rows,previousChapters:[],instructions:opts.instructions});assert.equal(plan.capabilities.outputLimit,4096);
 const result=await execute(plan,{call:async args=>{calls.push(args);return{value:payload(),trace:{usage:{inputTokens:7,outputTokens:9,totalTokens:16}}};}});
 assert.equal(calls.length,1);assert.equal(calls[0].stage,'chapter_summary');assert.equal(calls[0].phase,'single');assert.deepEqual(result.payload,payload());assert.equal(result.diagnostics.completedCalls,1);assert.deepEqual(result.diagnostics.usages,[{inputTokens:7,outputTokens:9,totalTokens:16}]);
});

test('27 turns / 232697 UTF8 bytes are covered exactly before multiple bounded map calls and one final merge',async()=>{
 const rows=exactRows(),before=json(rows),plan=planChapterBatches(options(rows)),calls=[],progress=[];assert.equal(plan.mode,'batched');assert.equal(plan.sourceBytes,232697);assert(plan.maps.length>1&&plan.maps.length<=16);assert.deepEqual(reconstruct(plan),rows);assert.equal(plan.sourceTurnsHash,hash(rows));
 for(const map of plan.maps){assert(map.bytes<=200000);assert(map.estimatedTotalTokens<=32768);assert.deepEqual(map.input.range.commitIds,plan.source.commitIds);assert.deepEqual(map.input.range.sourceHashes,plan.source.sourceHashes);assert.equal(map.input.range.startTurn,1);assert.equal(map.input.range.endTurn,27);}
 const result=await execute(plan,{onProgress:p=>progress.push(p),call:async args=>{calls.push(args);if(args.phase==='reduce'){assert.equal(args.input.turns.length,plan.maps.length);assert(args.input.turns.every(r=>r.kind==='intermediate_chapter_summary'));assert.deepEqual(args.input.range,plan.source);}return{value:payload(args.phase==='reduce'?'完整章節整合結果。':'這一批合成原文的中間摘要。'),trace:{usage:{inputTokens:7,outputTokens:9,totalTokens:16}}};}});
 assert.equal(calls.length,plan.maps.length+1);assert.equal(calls.filter(c=>c.phase==='reduce').length,1);assert.equal(result.payload.summary,'完整章節整合結果。');assert.equal(result.diagnostics.usages.length,calls.length);assert.equal(progress.at(-1).completedCalls,calls.length);assert.equal(json(rows),before);
});

test('multi-byte and astral characters split on safe Unicode and continuous UTF8 boundaries',()=>{
 const rows=turns(1,'漢字🙂𝄞é\n'.repeat(12000)),plan=planChapterBatches(options(rows));assert.equal(plan.mode,'batched');assert.deepEqual(reconstruct(plan),rows);
 for(const field of['input','body']){const list=plan.maps.flatMap(m=>m.input.turns).filter(s=>s.field===field);let next=0;for(const s of list){assert.equal(s.startByte,next);assert.equal(s.endByte-s.startByte,Buffer.byteLength(s.text));assert(!/\p{Surrogate}/u.test(s.text));next=s.endByte;}assert.equal(next,Buffer.byteLength(rows[0][field]));}
});

test('one oversized turn is segmented rather than dropped, summarized partially or assigned new chapter endpoints',async()=>{
 const rows=turns(1,'單一很長的合成回合。'.repeat(10000)),plan=planChapterBatches(options(rows,{capabilities:{contextWindow:65536,outputLimit:8192}}));assert(plan.maps.length>1);assert.deepEqual(reconstruct(plan),rows);
 for(const map of plan.maps){assert.equal(map.input.range.startTurn,1);assert.equal(map.input.range.endTurn,1);assert(map.input.turns.every(s=>s.turn===1&&s.commitId===rows[0].commitId));}
 const result=await execute(plan);assert.equal(result.diagnostics.completedCalls,plan.totalCalls);assert.equal(plan.capabilities.outputLimit,8192);
});

test('final merge is preflighted with bounded worst-case payloads and actual configured capacity',()=>{
 const plan=planChapterBatches(options(exactRows()));assert(plan.reduceWorstCase.fits);assert(plan.reduceWorstCase.bytes<=200000);assert(plan.reduceWorstCase.estimatedTotalTokens<=32768);assert(plan.mapOutputChars>=512&&plan.mapOutputChars<=2400);
 const tiny=options(turns(1,'x'.repeat(30000)),{capabilities:{contextWindow:4300,outputLimit:4096}});assert.throws(()=>planChapterBatches(tiny),e=>['CHAPTER_BATCH_CONTEXT_LIMIT','CHAPTER_BATCH_REDUCE_LIMIT','CHAPTER_BATCH_COUNT_LIMIT'].includes(e.code));assert.equal(tiny.capabilities.outputLimit,4096);
});

test('source, count, total size and configured limits reject before any dispatch',()=>{
 const rows=turns();const changed=source(rows);changed.commitIds[0]='other';assert.throws(()=>planChapterBatches({...options(rows),source:changed}),code('CHAPTER_BATCH_SOURCE_MISMATCH'));
 assert.throws(()=>planChapterBatches(options(turns(51))),code('CHAPTER_SOURCE_LIMIT'));
 assert.throws(()=>planChapterBatches(options(turns(1,'x'.repeat(16*200000)))),code('CHAPTER_BATCH_COUNT_LIMIT'));
 assert.throws(()=>planChapterBatches(options(rows,{maxBatchBytes:200001})),code('CHAPTER_BATCH_LIMIT_INVALID'));
 assert.throws(()=>planChapterBatches(options(rows,{maxBatches:17})),code('CHAPTER_BATCH_LIMIT_INVALID'));
 assert.throws(()=>planChapterBatches(options(rows,{capabilities:{contextWindow:Infinity}})),code('CHAPTER_BATCH_CAPABILITY_INVALID'));
 const bad=turns(1,'broken\ud800');assert.throws(()=>planChapterBatches(options(bad)),code('CHAPTER_BATCH_SOURCE_MISMATCH'));
});

test('unknown context stays unknown while byte batching remains bounded, without changing output settings',()=>{
 const rows=exactRows(),plan=planChapterBatches(options(rows,{capabilities:{contextWindow:null,outputLimit:8192}}));assert.equal(plan.mode,'batched');assert(plan.maps.every(m=>m.bytes<=200000&&m.contextKnown===false));assert.equal(plan.capabilities.contextWindow,null);assert.equal(plan.capabilities.outputLimit,8192);
});

test('map error stops immediately; no final output or implicit retry is returned',async()=>{
 const plan=planChapterBatches(options(exactRows())),calls=[];
 await assert.rejects(execute(plan,{call:async a=>{calls.push(a.phase);throw Object.assign(Error('synthetic map transport failure'),{code:'MODEL_TRANSPORT_ERROR'});}}),code('MODEL_TRANSPORT_ERROR'));assert.deepEqual(calls,['map']);
});

test('oversized intermediate or invalid final payload fail once rather than silently truncating or repairing',async()=>{
 const plan=planChapterBatches(options(exactRows()));let calls=0;
 await assert.rejects(execute(plan,{call:async()=>{calls++;return{value:payload('界'.repeat(plan.mapOutputChars))};}}),code('CHAPTER_BATCH_OUTPUT_LIMIT'));assert.equal(calls,1);
 calls=0;await assert.rejects(execute(plan,{call:async a=>{calls++;return{value:a.phase==='reduce'?{summary:'incomplete'}:payload()};}}),code('INVALID_CHAPTER_DATA'));assert.equal(calls,plan.totalCalls);
});

test('final merge transport failure preserves all existing errors and never returns a partial as final',async()=>{
 const plan=planChapterBatches(options(exactRows())),calls=[];
 await assert.rejects(execute(plan,{call:async a=>{calls.push(a.phase);if(a.phase==='reduce')throw Object.assign(Error('unknown final call result'),{code:'MODEL_TIMEOUT'});return{value:payload()};}}),code('MODEL_TIMEOUT'));assert.equal(calls.length,plan.totalCalls);assert.equal(calls.at(-1),'reduce');
});

test('cancel before dispatch or while a map call is in flight cannot dispatch a later map or merge',async()=>{
 const plan=planChapterBatches(options(exactRows())),first=new AbortController();first.abort();let calls=0;await assert.rejects(execute(plan,{signal:first.signal,call:async()=>{calls++;return{value:payload()};}}),code('CANCELLED'));assert.equal(calls,0);
 const controller=new AbortController();let entered;const began=new Promise(r=>entered=r),inFlight=execute(plan,{signal:controller.signal,call:async()=>{calls++;entered();return new Promise(()=>{});}});await began;controller.abort();await assert.rejects(inFlight,code('CANCELLED'));assert.equal(calls,1);
});

test('stale source before/after map or before final dispatch is rejected without new work',async()=>{
 const plan=planChapterBatches(options(exactRows()));let calls=0;
 await assert.rejects(execute(plan,{assertCurrent:async()=>false,call:async()=>{calls++;return{value:payload()};}}),code('CHAPTER_SOURCE_CHANGED'));assert.equal(calls,0);
 let current=true;await assert.rejects(execute(plan,{assertCurrent:async()=>current,call:async()=>{calls++;current=false;return{value:payload()};}}),code('CHAPTER_SOURCE_CHANGED'));assert.equal(calls,1);
 calls=0;let checked=0;await assert.rejects(execute(plan,{assertCurrent:async()=>++checked<=plan.maps.length*2,call:async()=>{calls++;return{value:payload()};}}),code('CHAPTER_SOURCE_CHANGED'));assert.equal(calls,plan.maps.length);
});

test('plans are immutable and source fingerprints reject tampering before generation',async()=>{
 const plan=planChapterBatches(options(exactRows()));assert(Object.isFrozen(plan));assert(Object.isFrozen(plan.maps[0].input.turns));const changed=structuredClone(plan);changed.source.commitIds[0]='different';let calls=0;await assert.rejects(execute(changed,{call:async()=>{calls++;return{value:payload()};}}),code('CHAPTER_BATCH_PLAN_CHANGED'));assert.equal(calls,0);
});

test('each actual dispatch input independently passes complete stage budget without excluded source fields',async()=>{
 const opts=options(exactRows()),plan=planChapterBatches(opts);
 await execute(plan,{call:async a=>{const bounded=budgetStage('chapter_summary',{system:opts.system,input:a.input},{contextWindow:32768,outputReserve:4096});assert.deepEqual(bounded.prompt.input,a.input);assert(bounded.diagnostics.includedEstimate+4096<=32768);assert(Buffer.byteLength(json(bounded.prompt))<=CHAPTER_BATCH_LIMITS.bytes);return{value:payload()};}});
});

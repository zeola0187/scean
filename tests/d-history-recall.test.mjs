import test from 'node:test';
import assert from 'node:assert/strict';
import {searchHistory,readHistory,pageHistory,historyLocator,HISTORY_REFERENCE_LABEL,HISTORY_RECALL_LIMITS} from '../core/history-recall.mjs';
const code=value=>e=>e.code===value;
const fixture=(count=3)=>({runId:'synthetic-research-ship',version:count,head:count?`commit-${count}`:null,turns:Array.from({length:count},(_,i)=>({turn:i+1,commitId:`commit-${i+1}`,requestId:`request-${i+1}`,input:`Player asks about route ${i+1}.`,body:`Kalt and Sio agree to return the brass key at port ${i+1}.`,stateBefore:{PRIVATE_STATE_CANARY:true},stateAfter:{PRIVATE_STATE_CANARY:true},memoryIds:['PRIVATE_MEMORY_ID'],playerHistoryIds:['PRIVATE_PLAYER_HISTORY'],trace:'PRIVATE_TRACE'})),retired:[],memories:[{id:'PRIVATE_MEMORY_ID',text:'Kalt alone knows SECRET_ENGINE_FAILURE',source:{id:'SECRET_SOURCE'},characterIds:['kalt']}],playerHistory:[{text:'PRIVATE_PLAYER_HISTORY'}],attempts:[{trace:'PRIVATE_TRACE'}],receipts:{}});

test('D2 literal search only active committed input/body and precise literal positions',()=>{
  const run=fixture();run.turns[0].body='Promise [key]. Promise [key].';const result=searchHistory(run,{query:'[key]'});
  assert.equal(result.label,HISTORY_REFERENCE_LABEL);assert.equal(result.hits.length,1);assert.deepEqual(result.hits[0].hitPositions,[{field:'body',start:8,end:13},{field:'body',start:23,end:28}]);
  assert.equal(result.hits[0].locator,historyLocator(run.runId,'commit-1'));
  for(const query of ['SECRET_ENGINE_FAILURE','PRIVATE_STATE_CANARY','PRIVATE_TRACE','PRIVATE_MEMORY_ID','PRIVATE_PLAYER_HISTORY','SECRET_SOURCE'])assert.equal(searchHistory(run,{query}).hits.length,0);
  assert(!JSON.stringify(result).includes('PRIVATE_'));assert.equal(result.hits[0].active,true);
});
test('D2 unicode case handling uses original UTF16 positions and literal metacharacters never execute',()=>{
  const run=fixture(1);run.turns[0].body='𠮷 Promise PROMISE [.*] 艾兒借出鑰匙';
  assert.equal(searchHistory(run,{query:'promise'}).hits[0].hitPositions[0].start,3);
  assert.equal(searchHistory(run,{query:'promise',caseSensitive:true}).hits.length,0);
  assert.equal(searchHistory(run,{query:'[.*]'}).hits.length,1);
  assert.equal(searchHistory(run,{query:'艾兒'}).hits.length,1);
});
test('D2 BM25 stable ranking searches multilingual story without embeddings',()=>{
  const run=fixture(4);run.turns[0].body='艾兒答應歸還鑰匙。未完成的承諾。';run.turns[1].body='different ship';
  const result=searchHistory(run,{query:'歸還鑰匙',mode:'bm25'});assert.equal(result.hits[0].commitId,'commit-1');assert(result.hits[0].score>0);assert.deepEqual(searchHistory(run,{query:'歸還鑰匙',mode:'bm25'}),result);
  assert.equal(searchHistory(run,{query:'unfindable',mode:'bm25'}).hits.length,0);
});
test('D2 search bounds are explicit and snippets/positions never unbounded',()=>{
  const run=fixture(30);run.turns[0].body='key '.repeat(2000);
  const result=searchHistory(run,{query:'key',limit:10});assert.equal(result.hits.length,10);assert.equal(result.hasMore,true);
  for(const hit of result.hits){assert(hit.snippet.length<=400);assert(hit.hitPositions.length<=32);}
  for(const query of ['', ' ', 'a'.repeat(513),null])assert.throws(()=>searchHistory(run,{query}),code('HISTORY_QUERY_INVALID'));
  for(const limit of [0,11,1.5])assert.throws(()=>searchHistory(run,{query:'key',limit}),code('HISTORY_SEARCH_LIMIT'));
  assert.throws(()=>searchHistory(run,{query:'key',mode:'embedding'}),code('HISTORY_SEARCH_MODE_INVALID'));
});
test('D2 read bounded neighboring original text with source locator and no hidden aggregate data',()=>{
  const run=fixture(5),before=structuredClone(run),result=readHistory(run,{commitId:'commit-3',radius:1});
  assert.deepEqual(result.turns.map(t=>t.turn),[2,3,4]);assert.equal(result.label,HISTORY_REFERENCE_LABEL);
  assert.deepEqual(Object.keys(result.turns[0]).sort(),['active','body','commitId','input','locator','runId','turn']);assert(!JSON.stringify(result).includes('PRIVATE_'));
  assert.deepEqual(run,before);assert.deepEqual(readHistory(run,{locator:result.turns[1].locator}),readHistory(run,{commitId:'commit-3'}));
});
test('D2 read rejects retired nonexistent crossRun malformed and oversized requests',()=>{
  const run=fixture(2);run.retired.push({commitId:'old-commit'});
  assert.throws(()=>readHistory(run,{commitId:'old-commit'}),code('HISTORY_COMMIT_RETIRED'));
  assert.throws(()=>readHistory(run,{commitId:'absent'}),code('HISTORY_COMMIT_NOT_FOUND'));
  assert.throws(()=>readHistory(run,{locator:'scean-history:other-run:commit-1'}),code('HISTORY_CROSS_RUN'));
  assert.throws(()=>readHistory(run,{runId:'other',commitId:'commit-1'}),code('HISTORY_CROSS_RUN'));
  assert.throws(()=>readHistory(run,{locator:'file:///private'}),code('HISTORY_LOCATOR_INVALID'));
  assert.throws(()=>readHistory(run,{locator:historyLocator(run.runId,'commit-1'),commitId:'commit-2'}),code('HISTORY_LOCATOR_MISMATCH'));
  for(const radius of [-1,2,100])assert.throws(()=>readHistory(run,{commitId:'commit-1',radius}),code('HISTORY_READ_RADIUS'));
  assert.throws(()=>readHistory(run,{commitId:'commit-1',maxChars:12001}),code('HISTORY_READ_LIMIT'));
  assert.throws(()=>readHistory(run,{commitId:'commit-1',maxChars:1}),code('HISTORY_READ_TOO_LARGE'));
  run.turns[0].body='x'.repeat(12001);assert.throws(()=>readHistory(run,{commitId:'commit-1'}),code('HISTORY_READ_TOO_LARGE'));assert.equal(run.turns[0].body.length,12001);
});
test('D2 rollback/regen exclusion follows commit identities even if replacement prose is identical',()=>{
  const run=fixture(3),old=run.turns.pop();run.retired.push({commitId:old.commitId});run.head=run.turns.at(-1).commitId;
  assert(!searchHistory(run,{query:'key'}).hits.some(h=>h.commitId===old.commitId));
  run.turns.push({...old,commitId:'replacement-3'});run.head='replacement-3';run.version+=2;
  assert.equal(readHistory(run,{commitId:'replacement-3'}).turns[0].body,old.body);
  assert.throws(()=>readHistory(run,{commitId:old.commitId}),code('HISTORY_COMMIT_RETIRED'));
  assert.deepEqual(searchHistory(run,{query:'key'}).hits.map(h=>h.commitId),['commit-1','commit-2','replacement-3']);
});
for(const count of [100,500,1000])test(`D3 ${count} turns page backward without gaps duplicates or aggregate disclosure`,()=>{
  const run=fixture(count),all=[];let cursor;
  do{const result=pageHistory(run,cursor?{cursor}:{});assert(result.turns.length<=10);assert(Buffer.byteLength(JSON.stringify(result))<=HISTORY_RECALL_LIMITS.pageBytes);assert.equal(result.totalActive,count);assert(!JSON.stringify(result).includes('PRIVATE_'));all.unshift(...result.turns.map(t=>t.turn));cursor=result.beforeCursor;assert.equal(result.hasMore,!!cursor);}while(cursor);
  assert.deepEqual(all,Array.from({length:count},(_,i)=>i+1));
});
test('D3 empty terminal and anchor page are explicit; malformed conflicting limits rejected',()=>{
  assert.equal(pageHistory(fixture(0)).status,'empty');const run=fixture(50),anchored=pageHistory(run,{anchorCommitId:'commit-17'});
  assert.deepEqual(anchored.turns.map(t=>t.turn),[8,9,10,11,12,13,14,15,16,17]);assert.equal(anchored.anchorCommitId,'commit-17');
  assert.throws(()=>pageHistory(run,{cursor:anchored.beforeCursor,anchorCommitId:'commit-2'}),code('HISTORY_PAGE_ARGUMENTS'));
  for(const limit of [0,21,Infinity])assert.throws(()=>pageHistory(run,{limit}),code('HISTORY_PAGE_LIMIT'));
  for(const cursor of ['', 'file:///private', 'x'.repeat(1025),Buffer.from('{}').toString('base64url')])assert.throws(()=>pageHistory(run,{cursor}),code('HISTORY_CURSOR_INVALID'));
});
test('D3 summary/version-only update keeps cursor; story append rollback replacement and crossRun reject',()=>{
  const run=fixture(30),cursor=pageHistory(run).beforeCursor;run.version++;run.summaries=[{text:'derived changed'}];assert.equal(pageHistory(run,{cursor}).turns.at(-1).turn,20);
  const other=structuredClone(run);other.runId='other-run';assert.throws(()=>pageHistory(other,{cursor}),code('HISTORY_CROSS_RUN'));
  run.turns.pop();run.head=run.turns.at(-1).commitId;assert.throws(()=>pageHistory(run,{cursor}),code('HISTORY_CURSOR_STALE'));
  run.turns.push({...run.turns.at(-1),turn:30,commitId:'replacement'});run.head='replacement';assert.throws(()=>pageHistory(run,{cursor}),code('HISTORY_CURSOR_STALE'));
});
test('D3 UTF8 byte budget reduces complete turns and cursor still yields every source exactly once',()=>{
  const run=fixture(12);for(const t of run.turns)t.body='船'.repeat(6000);
  let cursor,all=[];do{const result=pageHistory(run,cursor?{cursor}:{});assert(Buffer.byteLength(JSON.stringify(result))<=65536);assert(result.turns.length<=3);for(const t of result.turns)assert.equal(t.body.length,6000);all.unshift(...result.turns.map(t=>t.turn));cursor=result.beforeCursor;}while(cursor);
  assert.deepEqual(all,Array.from({length:12},(_,i)=>i+1));run.turns.at(-1).body='船'.repeat(23000);assert.throws(()=>pageHistory(run),code('HISTORY_PAGE_TURN_TOO_LARGE'));
});
test('D2/D3 corrupted active-vs-retired identity and invalid head fail closed',()=>{
  for(const mutate of [r=>r.retired.push({commitId:'commit-1'}),r=>r.turns.push({...r.turns[0]}),r=>r.head='bad',r=>r.receipts['request-1']={status:'retired'}]){
    const run=fixture();mutate(run);for(const call of [()=>pageHistory(run),()=>searchHistory(run,{query:'key'}),()=>readHistory(run,{commitId:'commit-1'})])assert.throws(call,code('HISTORY_INCONSISTENT'));
  }
});

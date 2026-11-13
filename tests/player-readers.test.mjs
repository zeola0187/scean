import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {playerWorldbook,playerRecap} from '../core/player-readers.mjs';
import {hash} from '../core/contracts.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';
import {backfillChapterSummary} from '../core/chapter-summary.mjs';
import {resolveSyntheticCreate} from '../fixtures/synthetic-catalog.mjs';

const code=c=>e=>e.code===c;
const raw=worldbook=>({runId:'synthetic-reader',version:3,head:'commit-three',turns:[],snapshot:{hash:'fixed-synthetic-snapshot',worldbook},narrative:{schemaVersion:1,currentSummaryId:null,summaries:[],chapters:[],operations:{}}});
const entry=(name,extra={})=>({name,content:'設定 '+name,keys:['not a read trigger'],...extra});
const list=run=>playerWorldbook(run).entries;
const detail=(run,id)=>playerWorldbook(run,{entryId:id}).entry;

test('reader requires authored public marks; model-key selection and enabled flags do not grant visibility',()=>{
 const run=raw({name:'UNMARKED_BOOK_NAME_CANARY',entries:[entry('unmarked'),entry('constant',{constant:true}),entry('public',{visibility:'public',enabled:false}),entry('access-public',{access:{kind:'world_public'}}),entry('PRIVATE_NAME_CANARY',{visibility:'private',content:'PRIVATE_CONTENT_CANARY'})]});
 const before=structuredClone(run),view=playerWorldbook(run);assert.deepEqual(view.entries.map(r=>r.title),['public','access-public']);assert.equal(view.total,2);assert(view.entries.every(r=>r.bookTitle==='世界設定'));assert(!JSON.stringify(view).includes('CANARY'));assert.deepEqual(run,before);
 for(const row of view.entries)assert(!Object.keys(detail(run,row.id)).some(k=>['keys','extensions','access','raw','source'].includes(k)));
});

test('public book permits unmarked children while private entry or extension always wins',()=>{
 const run=raw({name:'公開設定',visibility:'public',entries:[entry('inherited'),entry('explicit-public',{visibility:'public'}),entry('private',{visibility:'private'}),entry('restricted',{visibility:'restricted'}),entry('characters',{visibility:'characters'}),entry('owner',{contextScope:{kind:'character',characterId:'actor'}}),entry('extension-private',{visibility:'public',extensions:{visibility:'private'}}),entry('extension-public',{extensions:{visibility:'public'}})]});
 assert.deepEqual(list(run).map(r=>r.title),['inherited','explicit-public','extension-public']);assert(list(run).every(r=>r.bookTitle==='公開設定'));
});

test('private wrapper, book, card, data and extension block even explicitly public descendants',()=>{
 const e=entry('DO_NOT_DISCLOSE',{visibility:'public'}),forms=[{visibility:'private',book:{entries:[e]}},{spec:'lorebook_v3',visibility:'restricted',data:{entries:[e]}},{card:{visibility:'private',data:{character_book:{entries:[e]}}}},{card:{data:{visibility:'characters',character_book:{entries:[e]}}}},{entries:[e],extensions:{access:{kind:'private'}}},{entries:[e],scope:{kind:'player_only'}}];
 for(const source of forms)assert.equal(playerWorldbook(raw(source)).status,'empty');
 const run=raw({entries:[e]});run.snapshot.source={worldbook:{kind:'embedded'}};run.snapshot.card={visibility:'private',data:{character_book:structuredClone(run.snapshot.worldbook)}};assert.equal(list(run).length,0);
 delete run.snapshot.source;assert.equal(list(run).length,0);
});

test('recognized fixed book formats share public policy, including dictionary entries and duplicate saved sources',()=>{
 const b={name:'書',visibility:'public',entries:{a:entry('one'),b:entry('two')}};
 const forms=[b,{spec:'lorebook_v3',data:b},{book:b},{card:{data:{character_book:b}}},{data:{character_book:b}},{books:[b,{book:b}]}];
 for(const source of forms)assert.deepEqual(list(raw(source)).map(r=>r.title),['one','two']);
 const run=raw(structuredClone(b));run.snapshot.card={data:{character_book:b}};assert.equal(list(run).length,2);
});

test('search, directory and full detail are bounded; private content is not searchable or counted',()=>{
 const run=raw({entries:[...Array.from({length:65},(_,i)=>entry('entry '+i,{visibility:'public',content:'visible '+i})),entry('secret',{visibility:'private',content:'ONLY_PRIVATE_QUERY'})]});
 const page=playerWorldbook(run,{limit:30});assert.equal(page.entries.length,30);assert.equal(page.nextCursor,30);assert.equal(page.total,65);assert.equal(playerWorldbook(run,{cursor:60}).entries.length,5);
 assert.equal(playerWorldbook(run,{query:'ONLY_PRIVATE_QUERY'}).total,0);assert.equal(playerWorldbook(run,{query:'visible 64'}).entries.length,1);
 assert.throws(()=>playerWorldbook(run,{entryId:'../../snapshot'}),code('READER_QUERY_INVALID'));
 for(const args of[{query:'x'.repeat(201)},{cursor:-1},{limit:51},{contentOffset:Infinity}])assert.throws(()=>playerWorldbook(run,args),code('READER_QUERY_INVALID'));
 const id=page.entries[0].id;assert.throws(()=>detail(raw({entries:[]}),id),code('READER_ENTRY_NOT_FOUND'));
 assert.throws(()=>playerWorldbook(run,{expectedHead:'old'}),code('READER_SOURCE_CHANGED'));assert.throws(()=>playerWorldbook(run,{expectedSnapshotHash:'other'}),code('READER_SOURCE_CHANGED'));
});

test('long entry detail chunks reconstruct complete literal text without executing markup',()=>{
 const content='<script>PRIVATE_DATA_IS_NOT_SCRIPT</script>\n'+('合成敘事 '.repeat(9000));const run=raw({entries:[entry('長設定',{visibility:'public',content})]}),id=list(run)[0].id;let offset=0,result='';
 do{const row=playerWorldbook(run,{entryId:id,contentOffset:offset}).entry;assert(row.content.length<=12000);result+=row.content;offset=row.nextContentOffset;}while(offset!==null);
 assert.equal(result,content);
});

test('actual createRun fixes the reader source despite later authoring changes; reads never save or generate',async t=>{
 const root=await mkdtemp(join(tmpdir(),'scean-readers-fixed-'));t.after(()=>rm(root,{recursive:true,force:true}));let calls=0;const store=new DurableStore({root}),engine=new SceanEngine({postBody:false,store,model:{async generate(){calls++;throw Error('MODELS_FORBIDDEN');}},memory:{async retrieve(){throw Error('MEMORY_FORBIDDEN');}}});
 const request=resolveSyntheticCreate({cardId:'synthetic-observatory',revisionId:'r1',openingId:'cabin'});request.snapshot.worldbook.entries[0].visibility='public';const run=await engine.createRun(request),before=await store.read(run.runId),fingerprint=hash(before),revisionBefore=before.version;
 request.snapshot.worldbook.entries[0].content='NEW_WORKING_CARD_CONTENT';request.snapshot.revision='r2';const loaded=await store.read(run.runId),reader=playerWorldbook(loaded),text=detail(loaded,reader.entries[0].id).content;
 assert(!text.includes('NEW_WORKING_CARD_CONTENT'));assert.equal(hash(await store.read(run.runId)),fingerprint);assert.equal((await store.read(run.runId)).version,revisionBefore);assert.equal(calls,0);
});

test('recap uses only chapterSummaries payload, never rolling or fixed handoff summaries',()=>{
 const run=syntheticLongrun({turns:4,chapters:1});run.snapshot.chapterSummary='FIXED_HANDOFF_CANARY';run.narrative.summaries.push({text:'ROLLING_CANARY'});const row=run.narrative.chapters[0];
 const index=playerRecap(run);assert.equal(index.chapters.length,1);assert.equal(index.chapters[0].summaryAvailable,false);const d=playerRecap(run,{chapterId:row.id});assert.equal(d.status,'no_summary');assert.equal(d.chapter.summary,null);assert(!JSON.stringify(d).includes('CANARY'));assert(!Object.hasOwn(d,'operations'));assert(!Object.hasOwn(d,'settings'));
});

test('real chapter backfill exposes one valid payload and source links; pure reads leave the durable aggregate exact',async t=>{
 const run=syntheticLongrun({turns:4,chapters:1}),root=await mkdtemp(join(tmpdir(),'scean-reader-recap-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new DurableStore({root});await store.create(run);
 const engine=new SceanEngine({postBody:false,store,model:{async generate(){throw Error('STORY_MODEL_FORBIDDEN');}},memory:{async retrieve(){throw Error('MEMORY_FORBIDDEN');}}}),chapter=run.narrative.chapters[0],payload={title:'合成篇章',summary:'研究船停泊，船員等待玩家。',keywords:['港口'],characters:['船員'],locations:['研究船'],plotThreads:['下一趟航程'],emotionalTone:'平靜'};let calls=0;
 await backfillChapterSummary(engine,{runId:run.runId,chapterId:chapter.id,operationId:'reader-summary',expectedVersion:run.version,expectedHead:run.head},{enabled:true,model:{async generate(){calls++;return{text:JSON.stringify(payload),model:'synthetic-reader-model'};}}});
 const saved=await store.read(run.runId),before=hash(saved),view=playerRecap(saved,{chapterId:chapter.id});assert.deepEqual(view.chapter.summary,payload);assert.equal(view.chapter.source.startCommitId,saved.turns[0].commitId);assert.equal(view.chapter.source.endCommitId,saved.turns.at(-1).commitId);assert.equal(playerRecap(saved).chapters[0].summaryAvailable,true);assert.equal(hash(saved),before);assert.equal(hash(await store.read(run.runId)),before);assert.equal(calls,1);
 saved.turns[0].commitId='replacement-same-text';assert.equal(playerRecap(saved).chapters.length,0);assert.throws(()=>playerRecap(saved,{chapterId:chapter.id}),code('READER_CHAPTER_NOT_FOUND'));
});

test('missing chapters give a natural empty projection and stale/private source never exposes payload',()=>{
 assert.equal(playerRecap(raw({entries:[]})).status,'empty');const run=syntheticLongrun({turns:3,chapters:1}),c=run.narrative.chapters[0];c.visibility='private';assert.equal(playerRecap(run).chapters.length,0);assert.throws(()=>playerRecap(run,{chapterId:c.id}),code('READER_CHAPTER_NOT_FOUND'));assert.throws(()=>playerRecap(run,{chapterId:'../bad'}),code('READER_QUERY_INVALID'));
});

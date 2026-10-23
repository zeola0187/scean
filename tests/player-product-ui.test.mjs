import test from 'node:test';
import assert from 'node:assert/strict';
import {playerRecap} from '../core/player-readers.mjs';
import {hash} from '../core/contracts.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

function longDirectory(count=132){
 const turns=Array.from({length:count+1},(_,i)=>({turn:i+1,commitId:'commit-'+i,input:'合成輸入',body:'合成正文'}));
 const chapters=turns.slice(0,count).map((t,i)=>({id:'chapter-'+i,order:i+1,title:'章 '+i,startTurn:i+1,endTurn:i+1,commitIds:[t.commitId],sourceHashes:[hash({commitId:t.commitId,input:t.input,body:t.body})],visibility:'public',perspective:'public_story',current:true,status:'completed'}));
 const payload={title:'已保存摘要標題',summary:'摘要'.repeat(200),keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:null};
 return{runId:'synthetic-product',version:1,head:turns.at(-1).commitId,turns,snapshot:{hash:'fixed-synthetic'},narrative:{chapters,operations:{},chapterSummaries:[{id:'summary-one',chapterId:chapters[0].id,startTurn:1,endTurn:1,commitIds:chapters[0].commitIds,sourceHashes:chapters[0].sourceHashes,current:true,status:'completed',visibility:'public',perspective:'public_story',payload}]}};
}
test('chapter directory is bounded and all chapters beyond 128 remain reachable with exact original anchors',()=>{
 const run=longDirectory(),before=structuredClone(run),ids=[];let cursor=0;
 do{const page=playerRecap(run,{cursor,limit:30});assert(page.chapters.length<=30);ids.push(...page.chapters.map(c=>c.id));assert.equal(page.unarchived.source.startCommitId,run.turns.at(-1).commitId);cursor=page.nextCursor;}while(cursor!==null);
 assert.equal(ids.length,132);assert.equal(new Set(ids).size,132);assert.equal(playerRecap(run,{chapterId:'chapter-131'}).chapter.source.startCommitId,'commit-131');assert.deepEqual(run,before);
 const first=playerRecap(run).chapters[0];assert.equal(first.summaryPreview.length,320);assert(first.summaryTruncated);assert.equal(first.title,'已保存摘要標題');assert.equal(playerRecap(run,{chapterId:first.id}).chapter.summary.summary.length,400);
});
test('private, stale and changed summary payloads cannot become directory previews; original without chapters stays reachable',()=>{
 for(const alter of [s=>s.visibility='private',s=>s.current=false,s=>s.sourceHashes=['stale']]){const run=longDirectory(1);alter(run.narrative.chapterSummaries[0]);assert.equal(playerRecap(run).chapters[0].summaryPreview,null);}
 const run=longDirectory(1);run.narrative.chapters=[];run.narrative.chapterSummaries=[];const value=playerRecap(run);assert.equal(value.chapters.length,0);assert.equal(value.unarchived.source.startCommitId,'commit-0');assert.throws(()=>playerRecap(run,{limit:129}),e=>e.code==='READER_QUERY_INVALID');
});
function bridgeFixture({source={sourceSessionId:'exact-source',sourceSessionAvailable:true},gate}={}){
 const calls=[],opened=[],panels=[];let session='current-session';const bridge=createNativeBridge({getSessionId:()=>session,call:async request=>{calls.push(request);if(request.action==='context')return{cardScope:{cardId:'one'}};return gate?gate:source;},openSession:async id=>opened.push(id),selectPanel:async id=>panels.push(id)});
 return{bridge,calls,opened,panels,switchSession(){session='other-session';bridge.clearContext();}};
}
test('source return gets exact destination from scoped host read and leaves generation ownership untouched',async()=>{
 const f=bridgeFixture();await f.bridge.request('native.context');assert.deepEqual(await f.bridge.request('native.returnToAuthoring',{runId:'run-one'}),{opened:true,sourceSessionId:'exact-source'});assert.deepEqual(f.opened,['exact-source']);assert.deepEqual(f.panels,['local-scean-studio']);assert.equal(f.calls[1].action,'runView');assert.equal(f.calls[1].sessionId,'current-session');assert.equal(f.calls[1].cardScope.cardId,'one');assert(!f.calls.some(c=>c.action==='cancel'));await f.bridge.dispose();
});
test('source return rejects iframe supplied destinations, unknown source, inaccessible source and stale context',async()=>{
 for(const payload of [{runId:'one',sessionId:'injected'},{scriptId:'one',runId:'two'},{sessionId:'injected'},{}]){const f=bridgeFixture();await f.bridge.request('native.context');await assert.rejects(f.bridge.request('native.returnToAuthoring',payload),e=>e.code==='NATIVE_RETURN_TARGET_INVALID');assert.deepEqual(f.opened,[]);}
 for(const source of [{},{sourceSessionId:'source',sourceSessionAvailable:false}]){const f=bridgeFixture({source});await f.bridge.request('native.context');await assert.rejects(f.bridge.request('native.returnToAuthoring',{scriptId:'script-one'}),e=>['NATIVE_SOURCE_SESSION_UNKNOWN','NATIVE_SOURCE_SESSION_UNAVAILABLE'].includes(e.code));assert.deepEqual(f.opened,[]);}
 let release;const gate=new Promise(resolve=>release=resolve),f=bridgeFixture({gate});await f.bridge.request('native.context');const promise=f.bridge.request('native.returnToAuthoring',{runId:'run-one'});f.switchSession();release({sourceSessionId:'old-source',sourceSessionAvailable:true});await assert.rejects(promise,e=>e.code==='NATIVE_CONTEXT_STALE');assert.deepEqual(f.opened,[]);
});

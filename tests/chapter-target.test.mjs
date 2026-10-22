import test from 'node:test';import assert from 'node:assert/strict';
import {chapterEligibility,defaultChapterSettings} from '../core/chapter-summary.mjs';
import {targetChapterWindow,chapterAnalysisInput} from '../core/chapter-target.mjs';
import {estimateContextTokens} from '../core/context-budget.mjs';
import {hash} from '../core/contracts.mjs';
const settings=()=>({...defaultChapterSettings(),autoEnabled:true});
const run=(n,body)=>({turns:Array.from({length:n},(_,i)=>({turn:i+1,commitId:'commit-'+i,input:'繼續看看。',body})),narrative:{chapterSettings:settings(),chapters:[],operations:{}}});
test('CJK threshold uses the shared multilingual estimate and a six-turn preference cannot protect a whole long story',()=>{
 const r=run(6,'漢'.repeat(1500)),e=chapterEligibility(r);assert(e.eligible);assert(e.effectiveBufferTurns<6);assert(e.estimatedTokens>=12000);assert(e.endTurn>0);assert.equal(e.uncompressedEstimatedTokens,estimateContextTokens(r.turns));
});
test('one long committed turn can form one complete chapter even with the old default buffer of six',()=>{
 const r=run(1,'漢'.repeat(9000)),e=chapterEligibility(r);assert(e.eligible);assert.equal(e.startTurn,1);assert.equal(e.endTurn,1);assert.equal(e.effectiveBufferTurns,0);
});
test('many short turns near the target are not permanently limited by a fifty-turn candidate',()=>{
 const r=run(120,'漢'.repeat(80)),e=chapterEligibility(r);assert(e.eligible);assert(e.endTurn>50);assert(e.endTurn<120);assert(e.estimatedTokens<17000);
});
test('a no-endpoint decision expands its candidate when new complete turns arrive, without replaying an unchanged source',()=>{
 const r=run(8,'漢'.repeat(1100)),e=chapterEligibility(r),previous={kind:'chapter_auto',status:'completed',baseVersion:1,result:{created:false},candidate:{startTurn:1,endTurn:e.endTurn},eligibleEndTurn:e.eligibleEndTurn,autoPolicy:{candidateEstimatedTokens:e.estimatedTokens}};
 const before=targetChapterWindow(r,1,settings(),previous);r.turns.push(...Array.from({length:4},(_,i)=>({turn:9+i,commitId:'later-'+i,input:'繼續',body:'漢'.repeat(1100)})));
 const after=targetChapterWindow(r,1,settings(),previous);assert(after.endTurn>before.endTurn);assert(after.estimatedTokens>before.estimatedTokens);
});
test('explicit off and a genuinely below-threshold chapter stay ineligible without any model call',()=>{
 const r=run(2,'漢'.repeat(100));assert.equal(chapterEligibility(r).reason,'below_threshold');r.narrative.chapterSettings.autoEnabled=false;assert.equal(chapterEligibility(r).reason,'disabled');
});
test('endpoint excerpts are explicit, source-pinned and scalar aligned; they are never passed off as complete summary material',()=>{
 const turns=run(1,'開場🙂'+'漢'.repeat(70000)+'🙂自然段落結束。').turns,source={startTurn:1,endTurn:1,sourceHash:hash(turns)};
 const original=turns[0].body,value=chapterAnalysisInput(turns,source,{contextWindow:32768,outputLimit:4096},'分析完整回合結尾。');
 assert.equal(value.projection.mode,'explicit_endpoint_excerpts');assert.equal(value.projection.sourceHash,source.sourceHash);assert.equal(value.input.turns[0].analysisSource.complete,false);assert(!/\p{Surrogate}/u.test(value.input.turns[0].body));assert(value.input.turns[0].body.includes('中間原文未送入'));assert(value.input.turns[0].body.endsWith('🙂自然段落結束。'));assert(value.projection.deliveredBytes<value.projection.sourceBytes);assert.equal(turns[0].body,original);
});

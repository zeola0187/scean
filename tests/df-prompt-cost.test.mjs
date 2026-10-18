import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {measurePromptCost,promptSource} from '../fixtures/synthetic-df-prompt-source.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';

test('DF actual Director and Draft rolling metadata stays bounded at 100/500/1000 turns; Host retains complete source identities',async()=>{
  const rows=[];for(const turns of [100,500,1000])rows.push(await measurePromptCost(turns));
  for(const row of rows){assert.equal(row.sourceCommitCount,row.activeTurns-6);assert.deepEqual(row.observations.map(p=>p.stage),['director','draft']);for(const p of row.observations){assert(p.rollingMetadataBytes<512);assert(p.rollingMetadataEstimate<200);assert.equal(p.sourceCountDelivered,0);assert(!p.rollingKeys.includes('commitIds'));assert(p.rollingKeys.includes('startCommitId'));assert(p.rollingKeys.includes('endCommitId'));assert(p.recentCount<=6);}}
  for(const stage of ['director','draft']){const values=rows.map(r=>r.observations.find(p=>p.stage===stage));assert(Math.max(...values.map(v=>v.rollingMetadataBytes))-Math.min(...values.map(v=>v.rollingMetadataBytes))<=16);assert(Math.max(...values.map(v=>v.inputBytes))-Math.min(...values.map(v=>v.inputBytes))<=128);}
});
test('DF 1000-turn and 100-chapter history keeps legacy rolling compatibility and sends only3+8 in chapter mode',async t=>{
  const row=await measurePromptCost(1000,{chapters:100,backfill:true,withChapterContext:true});assert.equal(row.stageCounts.chapter_summary,100);assert.equal(row.chapters,100);for(const p of row.observations){assert(p.rollingMetadataBytes<512);assert(p.rollingMetadataEstimate<200);assert(p.inputBytes<12000);assert.equal(p.sourceCountDelivered,0);}
  assert.equal(row.chapterContextObservations.length,2);for(const p of row.chapterContextObservations){assert.equal(p.recentChapters,3);assert.equal(p.retrievedChapters,8);assert.equal(new Set(p.selectedSummaryIds).size,11);assert.equal(p.uncoveredTurns.length,9);}t.diagnostic(JSON.stringify({evidence:'long_history_3_plus_8',activeTurns:1000,archiveChapters:100,observations:row.chapterContextObservations,paidCalls:0,embeddingCalls:0}));
});
test('DF createRun accepts explicit chapter stage model selections and still rejects unrelated stages',async()=>{
  const root=await mkdtemp(join(tmpdir(),'scean-df-selection-')),store=new DurableStore({root}),engine=new SceanEngine({store,model:{async generate(){throw Error('No generation expected');}},memory:{async retrieve(){throw Error('No retrieval expected');}}});
  const snapshot=promptSource(0).snapshot,stageModelSelections={chapter_analysis:{provider:'synthetic',model:'offline-analysis'},chapter_summary:{provider:'synthetic',model:'offline-summary'}};
  const run=await engine.createRun({snapshot,runId:'df-explicit-stages',stageModelSelections});assert.deepEqual(run.stageModelSelections,stageModelSelections);await assert.rejects(engine.createRun({snapshot,runId:'df-unknown-stage',stageModelSelections:{semantic_reviewer:{provider:'synthetic',model:'forbidden'}}}),{code:'INVALID_MODEL_STAGE'});
});

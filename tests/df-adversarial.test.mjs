import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {hash} from '../core/contracts.mjs';
import {closeChapter,narrativeSourceHash} from '../core/narrative.mjs';
import {autoChapter,backfillChapterSummary,updateChapterSettings,validateChapterPayload} from '../core/chapter-summary.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {syntheticLongrun} from '../fixtures/synthetic-longrun-d.mjs';

// Independent synthetic contract review. No provider, network, production data or keys.
const copy=structuredClone;
const payload=()=>({title:'Research promise',summary:'The crew left the calibration unresolved.',keywords:['calibration'],characters:['Kalt'],locations:['ship'],plotThreads:['unfinished calibration'],emotionalTone:'uncertain'});
const analysis=(range,create=false)=>({shouldCreateChapter:create,optimalEndTurn:range.endTurn,suggestedTitle:'Research watch',keywords:['calibration'],characters:['Kalt'],locations:['ship'],plotThreads:['unfinished calibration'],emotionalTone:'uncertain',significantEvents:[]});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'scean-df-adversarial-')),store=new DurableStore({root}),run=syntheticLongrun({turns:16,bodyRepeats:20,runId:'synthetic-df-adversarial'});await store.create(run);const calls=[],model={async generate(a){calls.push(a);return{text:JSON.stringify(a.stage==='chapter_analysis'?analysis(a.input.range):payload()),model:'synthetic-adversarial'};}};return{store,run,calls,model,engine:new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:{retrieve:async()=>({records:[]})}})};}
async function args(f,operationId,extra={}){const r=await f.store.read(f.run.runId);return{runId:r.runId,operationId,expectedVersion:r.version,expectedHead:r.head,...extra};}
const resign=b=>{b.manifest.sha256=hash(b.run);return b;};
async function configured(){const f=await fixture();await updateChapterSettings(f.engine,await args(f,'settings',{settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:2,detail:'auto'}}));return f;}
let savedNoEndpoint;
async function noEndpointBundle(){savedNoEndpoint??=(async()=>{const f=await configured();await autoChapter(f.engine,await args(f,'no-endpoint'),{enabled:true});return encodeRunBundle(await f.store.read(f.run.runId));})();return copy(await savedNoEndpoint);}

test('DF adversarial default backfill persists a replayable and importable request without explicit detail',async()=>{
  const f=await fixture(),closed=await closeChapter(f.engine,await args(f,'close',{title:'Manual chapter'})),request=await args(f,'default-backfill',{chapterId:closed.chapterId});
  const result=await backfillChapterSummary(f.engine,request,{enabled:true});assert.equal(result.status,'completed');
  const restored=validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId)));
  assert.deepEqual(await backfillChapterSummary(f.engine,restored.narrative.operations['default-backfill'].request,{enabled:true}),result);assert.equal(f.calls.length,1);
});

test('DF adversarial import binds every new operation request to the containing Run',async()=>{
  const b=await noEndpointBundle(),op=b.run.narrative.operations['no-endpoint'];op.request.runId='another-synthetic-run';op.fingerprint=hash(op.request);assert.throws(()=>validateRunBundle(resign(b)));
});

test('DF adversarial import binds request operation ID to its durable receipt key',async()=>{
  const b=await noEndpointBundle(),op=b.run.narrative.operations['no-endpoint'];op.request.operationId='different-operation';op.fingerprint=hash(op.request);assert.throws(()=>validateRunBundle(resign(b)));
});

test('DF adversarial settings receipt status identity and Head cannot be forged',async()=>{
  const valid=await noEndpointBundle();for(const [key,value]of [['status','pending'],['operationId','foreign-operation'],['head','foreign-head']]){const b=copy(valid);b.run.narrative.operations.settings.result[key]=value;assert.throws(()=>validateRunBundle(resign(b)),`must bind settings result ${key}`);}
});

test('DF adversarial no-endpoint candidate must begin after the prior chapter instead of skipping sources',async()=>{
  const b=await noEndpointBundle(),op=b.run.narrative.operations['no-endpoint'];op.candidate.startTurn++;op.candidate.commitIds.shift();op.candidate.sourceHashes.shift();op.candidate.sourceHash=hash({commitIds:op.candidate.commitIds,sourceHashes:op.candidate.sourceHashes});assert.throws(()=>validateRunBundle(resign(b)));
});

test('DF adversarial no-endpoint operation preserves captured buffer and enabled settings proof',async()=>{
  const valid=await noEndpointBundle();for(const mutate of [o=>{o.eligibleEndTurn=999;},o=>{o.settingsSnapshot.autoEnabled=false;},o=>{o.settingsSnapshot.bufferTurns=0;},o=>{o.detail='precise';}]){const b=copy(valid);mutate(b.run.narrative.operations['no-endpoint']);assert.throws(()=>validateRunBundle(resign(b)));}
});

test('DF adversarial a late auto response cannot publish after an authoritative rollback',async()=>{
  const f=await configured(),entered=deferred(),release=deferred();let summaryCalls=0;
  f.model.generate=async a=>{if(a.stage==='chapter_analysis'){entered.resolve();await release.promise;return{text:JSON.stringify(analysis(a.input.range,true))};}summaryCalls++;return{text:JSON.stringify(payload())};};
  const work=autoChapter(f.engine,await args(f,'late-auto'),{enabled:true});await entered.promise;
  await f.engine.rollback(await args(f,'retire-head'));release.resolve();const result=await work,run=await f.store.read(f.run.runId);
  assert.equal(result.status,'stale');assert.equal(run.narrative.chapters.length,0);assert.equal(run.narrative.chapterSummaries.length,0);validateRunBundle(encodeRunBundle(run));
  assert.equal(summaryCalls,0,'retired pending analysis must not start a new summary stage');
});

test('DF adversarial summary fields are required even when their values may be null',()=>{
  for(const field of Object.keys(payload())){const p=payload();delete p[field];assert.throws(()=>validateChapterPayload(p),`required ${field}`);}
});

test('DF adversarial prior context proof cannot cite a superseded earlier chapter summary',async()=>{
  const f=await fixture(),chapterRun=syntheticLongrun({turns:16,bodyRepeats:20,chapters:3,runId:'synthetic-df-prior'});await f.store.create(chapterRun);f.run=chapterRun;
  const first=chapterRun.narrative.chapters[0],second=chapterRun.narrative.chapters[1];
  for(const [operationId,chapterId]of [['prior-one',first.id],['prior-two',first.id],['target',second.id]])await backfillChapterSummary(f.engine,await args(f,operationId,{chapterId,detail:'auto'}),{enabled:true});
  const b=encodeRunBundle(await f.store.read(f.run.runId)),records=b.run.narrative.chapterSummaries;
  assert.deepEqual(records[2].provenance.priorSummaryIds,[records[1].id]);records[2].provenance.priorSummaryIds=[records[0].id];assert.throws(()=>validateRunBundle(resign(b)));
});

test('DF adversarial source retired before operation start cannot become a no-endpoint candidate',async()=>{
  const f=await configured(),original=await f.store.read(f.run.runId),oldLast=original.turns.at(-1);await f.engine.rollback(await args(f,'retire-source'));
  // Replacement is a legitimate synthetic turn through the engine, not mutated authority.
  f.model.generate=async a=>a.stage==='director'?{text:'Continue.'}:a.stage==='draft'||a.stage==='prose'?{text:'The same research watch continued.'}:a.stage==='post_stat'?{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})}:{text:JSON.stringify(analysis(a.input.range))};
  await f.engine.turn({runId:f.run.runId,requestId:'replace-retired',input:'Continue synthetic watch.'});
  await updateChapterSettings(f.engine,await args(f,'unbuffer',{settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:0,detail:'auto'}}));
  await autoChapter(f.engine,await args(f,'after-retirement'),{enabled:true,autoPolicy:'legacy-buffer-v1'});const b=encodeRunBundle(await f.store.read(f.run.runId)),op=b.run.narrative.operations['after-retirement'];
  assert(b.run.retired.some(r=>r.commitId===oldLast.commitId&&r.retiredAtVersion<op.baseVersion));
  op.candidate.commitIds[15]=oldLast.commitId;op.candidate.sourceHashes[15]=narrativeSourceHash(oldLast);op.candidate.sourceHash=hash({commitIds:op.candidate.commitIds,sourceHashes:op.candidate.sourceHashes});assert.throws(()=>validateRunBundle(resign(b)));
});

test('DF adversarial malformed Unicode model output must not publish an unexportable chapter summary',async()=>{
  const f=await fixture(),closed=await closeChapter(f.engine,await args(f,'unicode-close',{title:'Research chapter'}));
  f.model.generate=async()=>({text:JSON.stringify({...payload(),summary:'Unpaired surrogate: \ud800'})});
  await assert.rejects(backfillChapterSummary(f.engine,await args(f,'unicode-backfill',{chapterId:closed.chapterId,detail:'auto'}),{enabled:true}));
  const run=await f.store.read(f.run.runId);assert.equal(run.narrative.chapterSummaries.length,0);validateRunBundle(encodeRunBundle(run));
});

test('DF adversarial a later-created then-retired replacement cannot be forged into an earlier analysis',async()=>{
  const f=await fixture();await updateChapterSettings(f.engine,await args(f,'zero-buffer',{settings:{autoEnabled:true,tokenThreshold:4000,bufferTurns:0,detail:'auto'}}));
  await autoChapter(f.engine,await args(f,'early-analysis'),{enabled:true});await f.engine.rollback(await args(f,'retire-original'));
  f.model.generate=async a=>a.stage==='director'?{text:'Continue.'}:a.stage==='draft'||a.stage==='prose'?{text:'A later replacement scene.'}:{text:JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]})};
  await f.engine.turn({runId:f.run.runId,requestId:'future-replacement',input:'A new synthetic watch.'});const future=(await f.store.read(f.run.runId)).turns.at(-1);
  await f.engine.rollback(await args(f,'retire-replacement'));const b=encodeRunBundle(await f.store.read(f.run.runId)),op=b.run.narrative.operations['early-analysis'];assert(future.commitVersion>op.baseVersion);
  op.candidate.commitIds[15]=future.commitId;op.candidate.sourceHashes[15]=narrativeSourceHash(future);op.candidate.sourceHash=hash({commitIds:op.candidate.commitIds,sourceHashes:op.candidate.sourceHashes});assert.throws(()=>validateRunBundle(resign(b)));
});

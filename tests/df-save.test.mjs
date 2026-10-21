import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash} from '../core/contracts.mjs';
import {SceanEngine} from '../core/engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {encodeRunBundle,validateRunBundle,SAVE_LIMITS} from '../core/save-bundle.mjs';
import {closeChapter,recoverNarrative} from '../core/narrative.mjs';
import {backfillChapterSummary,updateChapterSettings,autoChapter} from '../core/chapter-summary.mjs';
import {createHistoryFixture,playHistory,historyArgs,historyModel,syntheticHistoryMemory,HISTORY_C} from '../fixtures/synthetic-history-c.mjs';

const copy=structuredClone,code=c=>e=>e.code===c;
const resign=b=>{b.manifest.sha256=hash(b.run);return b;};
const settings={autoEnabled:true,detail:'auto',tokenThreshold:16000,bufferTurns:6};
const payload=n=>({title:'Synthetic generated title '+n,summary:'A public ship promise and unresolved repair task remain attributed to their speakers.',keywords:['promise'],characters:['Kalt','Aer'],locations:['research ship'],plotThreads:['unresolved repair'],emotionalTone:'uncertain'});
function chapterModel(){return{calls:[],async generate(args){this.calls.push(copy(args));assert.equal(args.stage,'chapter_summary');return{text:JSON.stringify(payload(this.calls.length)),model:'synthetic-chapter-save',usage:{inputTokens:64,outputTokens:48}};}};}
let oldFixture;
async function oldRun(){
  oldFixture??=(async()=>{const f=await createHistoryFixture();for(let chapter=1;chapter<=3;chapter++){
    await playHistory(f,chapter===1?'private':'quiet','old-'+chapter+'-a');await playHistory(f,'quiet','old-'+chapter+'-b');
    await closeChapter(f.engine,{...await historyArgs(f,'old-chapter-'+chapter),title:'Original manual chapter '+chapter});
  }return f.store.read(f.run.runId);})();return copy(await oldFixture);
}
async function source(){const run=await oldRun(),root=await mkdtemp(join(tmpdir(),'scean-df-save-')),store=new DurableStore({root});await store.create(run);const model=historyModel(),memory=syntheticHistoryMemory(),engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory});return{root,store,engine,model,memory,run};}
async function backfill(f,chapterId,operationId,model=chapterModel()) {return backfillChapterSummary(f.engine,{...await historyArgs(f,operationId),chapterId,detail:'precise'},{enabled:true,model});}
async function upgraded(){const f=await source();await updateChapterSettings(f.engine,{...await historyArgs(f,'chapter-settings'),settings});await backfill(f,f.run.narrative.chapters[0].id,'backfill-first');return f;}
async function freshStore(prefix='scean-df-import-'){const root=await mkdtemp(join(tmpdir(),prefix));return{root,store:new DurableStore({root})};}

test('D-final original three-manual-chapter v2 stays byte-equivalent through validate/re-export and does not auto-upgrade',async()=>{
  const run=await oldRun(),bundle=encodeRunBundle(run),restored=validateRunBundle(JSON.stringify(bundle));
  assert.equal(bundle.schemaVersion,2);assert.equal(restored.narrative.schemaVersion,1);assert.equal(restored.narrative.chapters.length,3);
  assert(!Object.hasOwn(restored.narrative,'chapterSummaries'));assert.deepEqual(encodeRunBundle(restored),bundle);assert.equal(restored.snapshot.hash,run.snapshot.hash);
  const f=await freshStore();await f.store.create(restored);const model=historyModel(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:f.root}),model,memory:syntheticHistoryMemory()});
  assert.deepEqual(await recoverNarrative(engine,restored.runId),{status:'unchanged'});assert.equal(model.calls.length,0);assert.deepEqual((await engine.store.read(restored.runId)).narrative,run.narrative);
});

test('D-final v3 backfills old chapters independently without changing their IDs, boundaries, titles, canonical story or Snapshot',async()=>{
  const f=await source(),before=copy(f.run),model=chapterModel();for(const [i,c]of before.narrative.chapters.entries())await backfill(f,c.id,'fill-'+i,model);
  const run=await f.store.read(f.run.runId),b=encodeRunBundle(run),restored=validateRunBundle(JSON.stringify(b));assert.equal(b.schemaVersion,3);assert.equal(restored.narrative.schemaVersion,2);
  assert.equal(restored.narrative.chapterSummaries.length,3);assert.equal(model.calls.length,3);assert.deepEqual(restored.narrative.chapters,before.narrative.chapters);
  for(const field of ['snapshot','turns','state','memories','playerHistory','stateProvenance','head'])assert.deepEqual(restored[field],before[field]);
  for(const c of restored.narrative.chapters){const row=restored.narrative.chapterSummaries.find(s=>s.chapterId===c.id);assert(row);assert.equal(row.current,true);assert.equal(row.status,'completed');assert.deepEqual(row.commitIds,c.commitIds);assert.deepEqual(row.sourceHashes,c.sourceHashes);}
  assert(!JSON.stringify(model.calls).includes(HISTORY_C.privateText));assert(!JSON.stringify(model.calls).includes('SYNTHETIC_KALT_PRIVATE_CALIBRATION'));
  assert.deepEqual(restored.narrative,run.narrative);
});

test('D-final strict bundle/domain version pairing rejects schema smuggling even with a recomputed manifest',async()=>{
  const f=await upgraded(),valid=encodeRunBundle(await f.store.read(f.run.runId));
  for(const schemaVersion of [0,2,5,'3'])assert.throws(()=>validateRunBundle({...valid,schemaVersion}),code('SAVE_FORMAT_VERSION'));
  assert.throws(()=>validateRunBundle({...valid,schemaVersion:1}),code('SAVE_FIELDS'));
  const old=encodeRunBundle(await oldRun());assert.throws(()=>validateRunBundle({...old,schemaVersion:3}),code('SAVE_FORMAT_VERSION'));
  const missing=copy(valid);delete missing.run.narrative;resign(missing);assert.throws(()=>validateRunBundle(missing),code('SAVE_FORMAT_VERSION'));
  const extra=copy(old);extra.run.narrative.chapterSummaries=[];resign(extra);assert.throws(()=>validateRunBundle(extra));
});

test('D-final v3 rejects forged chapter summary source, ACL, payload, ownership, receipt and unsupported schema',async()=>{
  const f=await upgraded(),valid=encodeRunBundle(await f.store.read(f.run.runId));
  for(const [mutationIndex,mutate] of [
    n=>{n.chapterSummaries[0].chapterId='nonexistent-chapter';},
    n=>{n.chapterSummaries[0].runId='cross-run';},
    n=>{n.chapterSummaries[0].visibility='private';},
    n=>{n.chapterSummaries[0].perspective='kalt';},
    n=>{n.chapterSummaries[0].sourceHashes[0]='0'.repeat(64);n.chapterSummaries[0].sourceHash=hash({commitIds:n.chapterSummaries[0].commitIds,sourceHashes:n.chapterSummaries[0].sourceHashes});},
    n=>{n.chapterSummaries[0].payload.summary='';},
    n=>{n.chapterSummaries[0].payload.keywords='not-an-array';},
    n=>{n.chapterSummaries[0].payload.emotionalTone={unexpected:'object'};},
    n=>{n.chapterSummaries[0].payload.extra='unexpected';},
    n=>{delete n.chapterSummaries[0].payload.title;delete n.operations['backfill-first'].stages.at(-1).result.title;},
    n=>{delete n.chapterSummaries[0].payload.emotionalTone;delete n.operations['backfill-first'].stages.at(-1).result.emotionalTone;},
    n=>{n.chapterSummaries[0].provenance.operationId='missing-operation';},
    n=>{n.chapterSummaries[0].provenance.usage={rawWorkingPacket:'SYNTHETIC_PRIVATE_WORKING_PACKET'};},
    n=>{n.chapterSummaries[0].provenance.model={rawWorkingPacket:'SYNTHETIC_PRIVATE_WORKING_PACKET'};},
    n=>{n.chapterSummaries[0].provenance.createdAt='not-a-date';},
    n=>{n.chapterSummaries[0].provenance.model='different-model';},
    n=>{n.chapterSummaries.push(copy(n.chapterSummaries[0]));},
    n=>{delete n.operations['backfill-first'];},
    n=>{n.chapterSettings.tokenThreshold=-1;},
    n=>{const op=n.operations['chapter-settings'];op.baseVersion=100000;op.request.expectedVersion=100000;op.result.version=100001;op.fingerprint=hash(op.request);},
    n=>{const op=n.operations['chapter-settings'];op.baseHead='nonexistent-commit';op.request.expectedHead=op.baseHead;op.result.head=op.baseHead;op.fingerprint=hash(op.request);},
    n=>{n.chapterSettings.providerCredentials={secret:'synthetic-rejected'};},
    n=>{n.schemaVersion=99;},
  ].entries()){const bad=copy(valid);mutate(bad.run.narrative);resign(bad);assert.throws(()=>validateRunBundle(bad),undefined,'forged chapter mutation '+mutationIndex);}
});

test('D-final rollback retires affected chapter summary, preserves previous chapter summaries and restart cannot revive it',async()=>{
  const f=await source();for(const [i,c]of f.run.narrative.chapters.entries())await backfill(f,c.id,'fill-'+i);
  await f.engine.rollback(await historyArgs(f,'retire-last'));const run=await f.store.read(f.run.runId),restored=validateRunBundle(encodeRunBundle(run));
  const rows=restored.narrative.chapterSummaries;assert.equal(rows.filter(s=>s.current).length,2);assert.equal(rows[2].status,'stale');assert.equal(rows[2].current,false);
  const imported=await freshStore();await imported.store.create(restored);const model=historyModel(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:imported.root}),model,memory:syntheticHistoryMemory()});await recoverNarrative(engine,restored.runId);assert.equal(model.calls.length,0);
  assert.deepEqual((await engine.store.read(restored.runId)).narrative,restored.narrative);
  const forged=encodeRunBundle(restored);forged.run.narrative.chapterSummaries[2].status='completed';forged.run.narrative.chapterSummaries[2].current=true;resign(forged);assert.throws(()=>validateRunBundle(forged));
});

test('D-final imported enabled preference is data only, replay returns existing receipt and preserves private ACL',async()=>{
  const f=await upgraded(),run=await f.store.read(f.run.runId),bundle=encodeRunBundle(run),restored=validateRunBundle(bundle),destination=await freshStore();await destination.store.create(restored);
  const model=historyModel(),memory=syntheticHistoryMemory(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:destination.root}),model,memory});await recoverNarrative(engine,run.runId);
  assert.equal(model.calls.length,0);assert.equal(restored.narrative.chapterSettings.autoEnabled,true);assert.equal((await engine.store.listRuns())[0].runId,run.runId);
  const operation=restored.narrative.operations['backfill-first'];const result=await backfillChapterSummary(engine,copy(operation.request),{enabled:true,model});assert.deepEqual(result,operation.result);assert.equal(model.calls.length,0);
  const recall=actor=>memory.retrieve({query:'pump seal fault',records:restored.memories,runId:restored.runId,characterId:actor,audience:'owner'});assert(JSON.stringify(await recall('kalt')).includes(HISTORY_C.privateText));assert(!JSON.stringify(await recall('sio')).includes(HISTORY_C.privateText));
  model.mode='quiet';await engine.turn({runId:run.runId,requestId:'after-v3-import',input:'Continue the synthetic journey.'});const next=await engine.store.read(run.runId);assert.equal(next.version,restored.version+1);assert.deepEqual(next.snapshot,restored.snapshot);validateRunBundle(encodeRunBundle(next));
});

test('D-final pending chapter backfill restore terminalizes without paid retry or new authoritative story',async()=>{
  const f=await source();let entered,release;const ready=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;}),controller=new AbortController();
  const request={...await historyArgs(f,'pending-backfill'),chapterId:f.run.narrative.chapters[0].id,detail:'auto',signal:controller.signal};
  const job=backfillChapterSummary(f.engine,request,{enabled:true,model:{async generate(){entered();await wait;return{text:JSON.stringify(payload(1))};}}});await ready;
  const run=validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId)));controller.abort();release();await assert.rejects(job);
  const destination=await freshStore();await destination.store.create(run);const model=historyModel(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root:destination.root}),model,memory:syntheticHistoryMemory()});await recoverNarrative(engine,run.runId);
  const restored=await engine.store.read(run.runId);assert.equal(restored.narrative.operations['pending-backfill'].status,'failed');assert.equal(model.calls.length,0);
  for(const key of ['turns','state','memories','playerHistory','snapshot'])assert.deepEqual(restored[key],run[key]);validateRunBundle(encodeRunBundle(restored));
});

test('D-final v3 retains 16 MiB and shared limits, rejects duplicate Run ID and publishes no partial import on fault',async()=>{
  assert.equal(SAVE_LIMITS.bytes,16*1024*1024);assert.equal(SAVE_LIMITS.turns,1000);assert.equal(SAVE_LIMITS.receipts,4096);assert.equal(SAVE_LIMITS.nodes,300000);assert.equal(SAVE_LIMITS.depth,64);
  assert.throws(()=>validateRunBundle(' '.repeat(SAVE_LIMITS.bytes+1)),code('SAVE_LIMIT'));
  const f=await upgraded(),bundle=encodeRunBundle(await f.store.read(f.run.runId));const tooLarge=copy(bundle);tooLarge.run.narrative.chapterSummaries[0].payload.summary='x'.repeat(SAVE_LIMITS.bytes);assert.throws(()=>validateRunBundle(tooLarge),code('SAVE_LIMIT'));
  const destination=await freshStore();const broken=new DurableStore({root:destination.root,fault(point){if(point==='beforeRename')throw Error('synthetic-v3-before-publish');}});await assert.rejects(broken.create(validateRunBundle(bundle)),/synthetic-v3-before-publish/);assert.deepEqual(await broken.listRuns(),[]);
  await destination.store.create(validateRunBundle(bundle));await assert.rejects(destination.store.create(validateRunBundle(bundle)),code('RUN_EXISTS'));
});


test('D-final auto chapter v3 preserves separate source endpoint and captured head without weakening old manual chapters',async()=>{
  const f=await createHistoryFixture();f.model.override=async({stage})=>['draft','prose'].includes(stage)?{text:'A public research journey with a pending promise. '.repeat(70)}:undefined;
  for(let turn=1;turn<=8;turn++)await playHistory(f,'quiet','auto-source-'+turn);
  await updateChapterSettings(f.engine,{...await historyArgs(f,'auto-settings'),settings:{autoEnabled:true,detail:'concise',tokenThreshold:4000,bufferTurns:2}});
  const stages=[];const model={async generate(args){stages.push(args.stage);return{text:JSON.stringify(args.stage==='chapter_analysis'?{shouldCreateChapter:true,optimalEndTurn:2,suggestedTitle:'A natural pause',keywords:['promise'],characters:['Kalt'],locations:['ship'],plotThreads:['pending promise'],emotionalTone:'uncertain',significantEvents:['A promise was made.']}:payload(1))};}};
  await autoChapter(f.engine,await historyArgs(f,'auto-create'),{enabled:true,model});assert.deepEqual(stages,['chapter_analysis','chapter_summary']);
  const run=await f.store.read(f.run.runId),bundle=encodeRunBundle(run),restored=validateRunBundle(bundle),chapter=restored.narrative.chapters[0];assert.equal(bundle.schemaVersion,3);assert.equal(chapter.endTurn,2);assert.equal(restored.turns.find(t=>t.commitId===chapter.baseHead).turn,8);assert.notEqual(chapter.commitIds.at(-1),chapter.baseHead);
  assert.deepEqual(restored.narrative,run.narrative);
  for(const mutate of [
    c=>{c.boundary.sourceEndCommitId=c.baseHead;},
    c=>{c.boundary.bufferTurns=0;},
    c=>{c.boundary.eligibleEndTurn=8;},
    c=>{c.provenance.algorithm='explicit-host-close-v1';},
  ]){const bad=copy(bundle);mutate(bad.run.narrative.chapters[0]);resign(bad);assert.throws(()=>validateRunBundle(bad));}
  const legacy=encodeRunBundle(await oldRun());legacy.run.narrative.chapters[0].baseHead=legacy.run.head;resign(legacy);assert.throws(()=>validateRunBundle(legacy));
  await f.engine.rollback(await historyArgs(f,'rollback-outside-auto-chapter'));const rolled=validateRunBundle(encodeRunBundle(await f.store.read(f.run.runId)));assert.equal(rolled.narrative.chapterSummaries[0].current,true);assert.equal(rolled.narrative.chapters[0].current,true);
});

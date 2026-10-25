import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {hash} from '../core/contracts.mjs';
import {encodeRunBundle,validateRunBundle,SAVE_LIMITS} from '../core/save-bundle.mjs';
import {updateSummary,closeChapter,recoverNarrative,selectNarrative,narrativeSourceHash} from '../core/narrative.mjs';
import {createHistoryFixture,playHistory,historyArgs,historyModel,syntheticHistoryMemory,HISTORY_C} from '../fixtures/synthetic-history-c.mjs';

const copy=structuredClone;
const code=c=>e=>e.code===c;
const resign=b=>{b.manifest.sha256=hash(b.run);return b;};
const summaryModel=()=>({calls:[],async generate(args){this.calls.push(copy(args));return{text:'Synthetic public ship summary: a promise, an exchange, an unresolved task; attributed uncertainty remains uncertain.',model:'deterministic-summary-fixture',usage:{inputTokens:100,outputTokens:30}};}});
const summary=async(f,operationId,endTurn,model=summaryModel())=>updateSummary(f.engine,{...await historyArgs(f,operationId),endTurn,recentWindow:1},{enabled:true,model});
const chapter=async(f,operationId,title)=>closeChapter(f.engine,{...await historyArgs(f,operationId),title});
async function simple(){const f=await createHistoryFixture();await playHistory(f,'private','origin');await playHistory(f,'quiet','next');await summary(f,'summary-one',1);await chapter(f,'chapter-one','Synthetic first chapter');return f;}

// No real card, model provider, embedding provider, SDK or existing gate is used.
test('D save preserves legal C v1 unchanged and never invents narrative or invokes a model on restore',async()=>{
  const f=await createHistoryFixture();await playHistory(f,'private','c-origin');const run=await f.store.read(f.run.runId),beforeCalls=f.model.calls.length;
  const b=encodeRunBundle(run),restored=validateRunBundle(JSON.stringify(b));assert.equal(b.schemaVersion,9);assert(!Object.hasOwn(restored,'narrative'));assert.equal(f.model.calls.length,beforeCalls);
  assert.deepEqual(encodeRunBundle(restored),b);assert.equal(restored.snapshot.hash,run.snapshot.hash);
});

test('D save v2 adds only validated derived narrative and retains original authority, snapshot hash and limits',async()=>{
  const f=await simple(),run=await f.store.read(f.run.runId),before=copy(run),b=encodeRunBundle(run),restored=validateRunBundle(JSON.stringify(b));
  assert.equal(b.schemaVersion,9);assert.equal(restored.schemaVersion,1);assert.deepEqual(restored.narrative,run.narrative);assert.deepEqual(run,before);
  for(const field of ['runId','version','head','snapshot','state','memories','playerHistory','stateProvenance','turns','retired'])assert.deepEqual(restored[field],run[field]);
  assert.deepEqual(SAVE_LIMITS,{bytes:16777216,depth:64,nodes:300000,turns:1000,retired:256,receipts:4096,records:100000});
  assert.equal(selectNarrative(restored).summary.id,run.narrative.currentSummaryId);
});

test('D save rejects hidden narrative in v1, incomplete v2, unsupported versions and narrative schema drift',async()=>{
  const f=await simple(),b=encodeRunBundle(await f.store.read(f.run.runId));
  const hidden=copy(b);hidden.schemaVersion=1;assert.throws(()=>validateRunBundle(hidden),code('SAVE_FORMAT_VERSION'));
  const absent=copy(b);delete absent.run.narrative;resign(absent);assert.throws(()=>validateRunBundle(absent),code('SAVE_DOMAINS'));
  for(const v of [0,3,'2'])assert.throws(()=>validateRunBundle({...b,schemaVersion:v}),code('SAVE_FORMAT_VERSION'));
  const malformed=copy(b);malformed.run.narrative.schemaVersion=99;resign(malformed);assert.throws(()=>validateRunBundle(malformed));
});

test('D save rejects rehashed source identity/hash/range and current claims, including identical text at another commit',async()=>{
  const f=await simple(),b=encodeRunBundle(await f.store.read(f.run.runId));
  for(const mutate of [
    n=>{n.summaries[0].runId='cross-run';},
    n=>{n.summaries[0].sourceHashes[0]='0'.repeat(64);n.summaries[0].sourceHash=hash({commitIds:n.summaries[0].commitIds,sourceHashes:n.summaries[0].sourceHashes});},
    n=>{n.summaries[0].commitIds[0]='other-commit';n.summaries[0].sourceHash=hash({commitIds:n.summaries[0].commitIds,sourceHashes:n.summaries[0].sourceHashes});},
    n=>{n.currentSummaryId='missing-summary';},
    n=>{n.summaries[0].status='stale';},
    n=>{n.chapters[0].commitIds.reverse();n.chapters[0].sourceHash=hash({commitIds:n.chapters[0].commitIds,sourceHashes:n.chapters[0].sourceHashes});},
    n=>{n.summaries[0].baseVersion=1000000;},
  ]){const broken=copy(b);mutate(broken.run.narrative);resign(broken);assert.throws(()=>validateRunBundle(broken));}
  const sameText={...b.run.turns[0],commitId:'identical-text-new-commit'};assert.notEqual(narrativeSourceHash(sameText),narrativeSourceHash(b.run.turns[0]));
});

test('D save strict narrative fields reject model working packets, provider data, forged provenance and duplicate IDs',async()=>{
  const f=await simple(),b=encodeRunBundle(await f.store.read(f.run.runId));
  for(const mutate of [
    n=>{n.rawTrace={privateMemory:'SYNTHETIC_PRIVATE_WORKING_PACKET'};},
    n=>{n.summaries[0].provenance.providerConfig={model:'secret route'};},
    n=>{n.operations['summary-one'].rawPrompt={memoryIds:['private-source']};},
    n=>{n.summaries[0].provenance.operationId='unrelated-operation';},
    n=>{n.summaries.push(copy(n.summaries[0]));},
    n=>{n.chapters[0].summaryVersion=999;},
    n=>{n.operations['summary-one'].request.endTurn=999;n.operations['summary-one'].fingerprint=hash(n.operations['summary-one'].request);},
    n=>{const op=copy(n.operations['summary-one']);op.operationId='orphan-op';op.request.operationId='orphan-op';op.result.operationId='orphan-op';op.fingerprint=hash(op.request);n.operations['orphan-op']=op;},
  ]){const broken=copy(b);mutate(broken.run.narrative);resign(broken);assert.throws(()=>validateRunBundle(broken));}
});

test('D save stale summary after rollback persists as explicit audit and cannot be laundered current',async()=>{
  const f=await simple();await f.engine.rollback(await historyArgs(f,'remove-second'));await f.engine.rollback(await historyArgs(f,'remove-first'));
  const run=await f.store.read(f.run.runId),b=encodeRunBundle(run),restored=validateRunBundle(b);assert.equal(restored.narrative.currentSummaryId,null);assert.equal(selectNarrative(restored).summary,null);
  assert.equal(restored.narrative.summaries[0].status,'stale');assert.equal(restored.narrative.chapters[0].status,'stale');
  const forged=copy(b),s=forged.run.narrative.summaries[0];s.status='completed';s.current=true;forged.run.narrative.currentSummaryId=s.id;resign(forged);assert.throws(()=>validateRunBundle(forged));
});

test('D save research ship three chapters, rolling summaries, rollback/regen, clean-root restore/restart and continuation preserve ACL and authority',async()=>{
  const a=await createHistoryFixture(),sm=summaryModel();
  await playHistory(a,'private','origin');await playHistory(a,'quiet','second');await chapter(a,'chapter-one','Departure');
  await playHistory(a,'quiet','third');await playHistory(a,'share','withdrawn-first');await summary(a,'rolling-one',3,sm);await chapter(a,'chapter-two','Withdrawn communication');
  await a.engine.rollback(await historyArgs(a,'rollback-exchange'));
  await playHistory(a,'share','withdrawn-second');a.model.mode='quiet';await a.engine.regenerate(await historyArgs(a,'regen-exchange',{requestId:'replacement'}));
  await playHistory(a,'quiet','fifth');await playHistory(a,'quiet','sixth');await summary(a,'rolling-two',5,sm);await chapter(a,'chapter-three','Revised journey');
  assert.equal(sm.calls.length,2);assert.deepEqual(sm.calls[1].input.turns.map(t=>t.turn),[4,5]);assert(sm.calls[1].input.previousSummary);
  assert(!JSON.stringify(sm.calls).includes(HISTORY_C.privateText));assert(!JSON.stringify(sm.calls).includes('SYNTHETIC_KALT_PRIVATE_CALIBRATION'));
  const original=await a.store.read(a.run.runId),bundle=encodeRunBundle(original),restored=validateRunBundle(JSON.stringify(bundle));
  assert.equal(restored.narrative.chapters.length,3);assert.equal(restored.narrative.chapters[1].status,'stale');assert.equal(restored.narrative.chapters[2].status,'completed');
  const root=await mkdtemp(join(tmpdir(),'scean-d-save-destination-')),store=new DurableStore({root});await store.create(restored);
  const restarted=new DurableStore({root}),model=historyModel(),memory=syntheticHistoryMemory(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:restarted,model,memory});
  assert.deepEqual(await restarted.read(restored.runId),restored);assert.equal(model.calls.length,0);assert.equal((await restarted.listRuns())[0].runId,restored.runId);
  for(const field of ['snapshot','turns','state','memories','playerHistory','stateProvenance','version','head','retired','narrative'])assert.deepEqual(restored[field],original[field]);
  assert.deepEqual(await recoverNarrative(engine,restored.runId),{status:'unchanged'});assert.equal(model.calls.length,0);
  const recall=actor=>memory.retrieve({query:'research pump seal fault',records:restored.memories,runId:restored.runId,characterId:actor,audience:'owner'});
  assert(JSON.stringify(await recall('kalt')).includes(HISTORY_C.privateText));assert(!JSON.stringify(await recall('sio')).includes(HISTORY_C.sharedText));
  const active=new Set(restored.turns.map(t=>t.commitId));for(const c of restored.narrative.chapters.filter(c=>c.current))assert(c.commitIds.every(id=>active.has(id)));
  model.mode='quiet';await engine.turn({runId:restored.runId,requestId:'continued-after-import',input:'Keep travelling.'});const continued=await restarted.read(restored.runId);assert.equal(continued.version,restored.version+1);assert.equal(continued.snapshot.hash,restored.snapshot.hash);assert(selectNarrative(continued).summary);validateRunBundle(encodeRunBundle(continued));
});

test('D save pending summary restore marks interruption without an automatic model call or paid retry',async()=>{
  const a=await createHistoryFixture();await playHistory(a,'private','origin');await playHistory(a,'quiet','second');let entered,release;
  const ready=new Promise(r=>{entered=r;}),wait=new Promise(r=>{release=r;}),controller=new AbortController();
  const request={...await historyArgs(a,'pending-summary'),endTurn:1,recentWindow:1,signal:controller.signal};
  const job=updateSummary(a.engine,request,{enabled:true,model:{async generate(){entered();await wait;return{text:'A late synthetic summary.'};}}});
  await ready;const restored=validateRunBundle(encodeRunBundle(await a.store.read(a.run.runId)));assert.equal(restored.narrative.operations['pending-summary'].status,'pending');
  controller.abort();release();await assert.rejects(job);
  const root=await mkdtemp(join(tmpdir(),'scean-d-pending-import-')),store=new DurableStore({root});await store.create(restored);const model=historyModel(),engine=new SceanEngine({unconfiguredWritingMode:'current',store:new DurableStore({root}),model,memory:syntheticHistoryMemory()});
  assert.equal((await recoverNarrative(engine,restored.runId)).status,'recovered');assert.equal(model.calls.length,0);
  const retried=await updateSummary(engine,{...request,signal:undefined},{enabled:true,model});assert.equal(retried.status,'failed');assert.equal(model.calls.length,0);
  const current=await engine.store.read(restored.runId);for(const field of ['turns','state','memories','playerHistory','snapshot'])assert.deepEqual(current[field],restored[field]);validateRunBundle(encodeRunBundle(current));
});

test('D save derived capacity and unsafe structure reject before publication without partial visible Run',async()=>{
  const f=await simple(),b=encodeRunBundle(await f.store.read(f.run.runId));
  for(const mutate of [
    n=>{n.summaries=Array.from({length:129},()=>copy(n.summaries[0]));},
    n=>{n.chapters=Array.from({length:129},()=>copy(n.chapters[0]));},
    n=>{for(let i=0;i<257;i++)n.operations['extra-'+i]=copy(n.operations['summary-one']);},
    n=>{n.summaries[0].text='x'.repeat(16001);},
    n=>{n.summaries[0].provenance.apiKey='SYNTHETIC_FORBIDDEN';},
  ]){const broken=copy(b);mutate(broken.run.narrative);resign(broken);assert.throws(()=>validateRunBundle(broken));}
  const root=await mkdtemp(join(tmpdir(),'scean-d-import-atomic-')),store=new DurableStore({root,fault(point){if(point==='beforeRename')throw Error('synthetic-before-publish');}});
  await assert.rejects(store.create(validateRunBundle(b)),/synthetic-before-publish/);assert.deepEqual(await store.listRuns(),[]);
  const normal=new DurableStore({root});await normal.create(validateRunBundle(b));await assert.rejects(normal.create(validateRunBundle(b)),code('RUN_EXISTS'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {DurableStore} from '../adapters/store.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createHistoryFixture,playHistory,historyArgs} from '../fixtures/synthetic-history-c.mjs';
import {closeChapter,updateSummary,narrativeSourceHash} from '../core/narrative.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash} from '../core/contracts.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function ready(){const f=await createHistoryFixture();await playHistory(f,'quiet','a');await playHistory(f,'quiet','b');await playHistory(f,'quiet','c');return f;}
const resign=b=>{b.manifest.sha256=hash(b.run);return b;};

test('D review changed same-ID pending summary request must reject fingerprint conflict at Host boundary',async()=>{
  const f=await ready(),host=await new SceanHost({engine:f.engine,root:join(f.root,'host'),summaryEnabled:true}).init(),entered=deferred(),release=deferred();
  f.model.override=async args=>{if(args.stage==='summary'){entered.resolve();await release.promise;return{text:'Synthetic public compression.'};}};
  const request={...await historyArgs(f,'pending-same-id'),endTurn:1,recentWindow:1};
  const work=host.summaryStart(request);await entered.promise;
  try{await assert.rejects(host.summaryStart({...request,endTurn:2}),{code:'OPERATION_ID_CONFLICT'});}finally{release.resolve();await work;}
});

test('D review import rejects chapter range forged to skip first active committed turn',async()=>{
  const f=await ready();await closeChapter(f.engine,{...await historyArgs(f,'chapter'),title:'Research chapter'});
  const bundle=encodeRunBundle(await f.store.read(f.run.runId)),chapter=bundle.run.narrative.chapters[0];
  chapter.startTurn=2;chapter.commitIds.shift();chapter.sourceHashes.shift();chapter.sourceHash=hash({commitIds:chapter.commitIds,sourceHashes:chapter.sourceHashes});
  assert.throws(()=>validateRunBundle(resign(bundle)));
});

test('D review import rejects operation ID duplicated across C history and D derived receipts',async()=>{
  const f=await ready();await f.engine.rollback(await historyArgs(f,'rollback-one'));await playHistory(f,'quiet','c-new');
  await updateSummary(f.engine,{...await historyArgs(f,'summary-one'),endTurn:1,recentWindow:1},{enabled:true,model:{generate:async()=>({text:'Synthetic public compression.'})}});
  const bundle=encodeRunBundle(await f.store.read(f.run.runId)),n=bundle.run.narrative,op=n.operations['summary-one'];
  delete n.operations['summary-one'];op.operationId='rollback-one';op.request.operationId='rollback-one';op.result.operationId='rollback-one';op.fingerprint=hash(op.request);n.operations['rollback-one']=op;n.summaries[0].provenance.operationId='rollback-one';
  assert.throws(()=>validateRunBundle(resign(bundle)));
});


test('D review importing pending summary marks interrupted instead of leaving a workerless pending operation',async()=>{
  const f=await ready(),entered=deferred(),release=deferred(),controller=new AbortController();
  const request={...await historyArgs(f,'import-pending'),endTurn:1,recentWindow:1,signal:controller.signal};
  const work=updateSummary(f.engine,request,{enabled:true,model:{generate:async()=>{entered.resolve();await release.promise;return{text:'Late synthetic response.'};}}});
  await entered.promise;const bundle=encodeRunBundle(await f.store.read(f.run.runId));controller.abort();release.resolve();await assert.rejects(work);
  const root=await mkdtemp(join(tmpdir(),'scean-d-review-import-')),store=new DurableStore({root:join(root,'store')});let calls=0;
  const engine=new f.engine.constructor({store,memory:f.memory,model:{generate:async()=>{calls++;throw Error('No import generation');}}}),host=await new SceanHost({engine,root:join(root,'host'),summaryEnabled:true}).init();
  const imported=await host.importRun({bundle,acknowledgement:'import-private-run-data'},{principal:'synthetic-review-operator',allowPrivateSaves:true});
  const status=await host.summaryStatus(f.run.runId);assert.equal(calls,0);assert(['failed','stale'].includes(status.operations[0].status),'imported pending operation must be marked interrupted without a provider retry');
  const restored=await store.read(f.run.runId);assert.equal(imported.version,restored.version);assert.equal(restored.version,bundle.run.version+1);
  assert.equal((await host.summaryStart({...request,signal:undefined})).status,'failed');assert.equal(calls,0);
  engine.model.generate=async()=>{calls++;return{text:'Explicit fresh synthetic compression.'};};
  const next={runId:f.run.runId,operationId:'explicit-after-import',expectedVersion:restored.version,expectedHead:restored.head,endTurn:1,recentWindow:1};
  assert.equal((await host.summaryStart(next)).status,'completed');assert.equal(calls,1);
  assert.equal((await host.runView({runId:f.run.runId})).version,restored.version+2);assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {hash} from '../core/contracts.mjs';
import {createHistoryFixture,playHistory,historyArgs,historyModel,syntheticHistoryMemory} from '../fixtures/synthetic-history-c.mjs';

test('C review import reconciles a cancellation-coded acknowledgement failure after publication',async()=>{
  const source=await createHistoryFixture();
  await playHistory(source,'private','review-private-origin');
  const bundle=encodeRunBundle(await source.store.read(source.run.runId));
  const root=await mkdtemp(join(tmpdir(),'scean-c-review-'));
  const controller=new AbortController();
  const store=new DurableStore({root:join(root,'store'),fault:point=>{
    if(point==='afterRename'){
      controller.abort();
      throw Object.assign(Error('synthetic acknowledgement cancelled after publication'),{code:'CANCELLED'});
    }
  }});
  const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model:historyModel(),memory:syntheticHistoryMemory()});
  const host=await new SceanHost({engine,root:join(root,'host')}).init();
  const result=await host.request({action:'importRun',bundle,acknowledgement:'import-private-run-data'},controller.signal,{principal:'synthetic-review-operator',allowPrivateSaves:true});
  assert.equal((await store.read(bundle.run.runId)).head,bundle.run.head,'the complete import already crossed the atomic publication boundary');
  assert.equal(result.ok,true,'a durable matching import must be reported as published even if its acknowledgement throws CANCELLED');
  assert.equal(result.value.imported,true);
  assert(host.listRuns().some(row=>row.runId===bundle.run.runId));
});

test('C review import cancellation before publication leaves no visible Run',async()=>{
  const source=await createHistoryFixture();
  await playHistory(source,'private','review-before-private');
  const bundle=encodeRunBundle(await source.store.read(source.run.runId));
  const root=await mkdtemp(join(tmpdir(),'scean-c-review-before-'));
  const controller=new AbortController();
  const store=new DurableStore({root:join(root,'store'),fault:point=>{
    if(point==='beforeRename'){
      controller.abort();
      throw Object.assign(Error('synthetic cancellation before publication'),{code:'CANCELLED'});
    }
  }});
  const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model:historyModel(),memory:syntheticHistoryMemory()});
  const host=await new SceanHost({engine,root:join(root,'host')}).init();
  const result=await host.request({action:'importRun',bundle,acknowledgement:'import-private-run-data'},controller.signal,{principal:'synthetic-review-operator',allowPrivateSaves:true});
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'CANCELLED');
  assert.deepEqual(await store.listRuns(),[]);
  assert.deepEqual(host.listRuns(),[]);
});

test('C review import rejects a corrupted operation fingerprint even with a recomputed bundle digest',async()=>{
  const source=await createHistoryFixture();
  await playHistory(source,'private','review-fingerprint-origin');
  await playHistory(source,'share','review-fingerprint-share');
  await source.engine.rollback(await historyArgs(source,'review-fingerprint-undo'));
  const bundle=encodeRunBundle(await source.store.read(source.run.runId));
  assert.doesNotThrow(()=>validateRunBundle(bundle));
  bundle.run.operationReceipts['review-fingerprint-undo'].fingerprint='0'.repeat(64);
  bundle.manifest.sha256=hash(bundle.run);
  assert.throws(()=>validateRunBundle(bundle),error=>error.code==='SAVE_OPERATION_REQUEST');
});

test('C review retired regeneration lineage must still identify its actual replacement',async()=>{
  const source=await createHistoryFixture();
  await playHistory(source,'private','review-lineage-origin');
  await playHistory(source,'share','review-lineage-exchange');
  source.model.mode='quiet';
  await source.engine.regenerate(await historyArgs(source,'review-lineage-regenerate',{requestId:'review-lineage-replacement'}));
  await source.engine.rollback(await historyArgs(source,'review-lineage-undo'));
  const bundle=encodeRunBundle(await source.store.read(source.run.runId));
  assert.doesNotThrow(()=>validateRunBundle(bundle));
  bundle.run.retired.find(row=>row.reason==='regenerate').replacedBy=bundle.run.turns[0].commitId;
  bundle.manifest.sha256=hash(bundle.run);
  assert.throws(()=>validateRunBundle(bundle));
});

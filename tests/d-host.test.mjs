import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {syntheticLongrun,D_PRIVATE} from '../fixtures/synthetic-longrun-d.mjs';
import {hash} from '../core/contracts.mjs';

async function fixture({enabled=false,model}={}){
  const root=await mkdtemp(join(tmpdir(),'scean-d-host-')),store=new DurableStore({root:join(root,'store')}),run=syntheticLongrun({turns:35});
  await store.create(run);let calls=0;
  const engine=new SceanEngine({postBody:false,unconfiguredWritingMode:'current',store,model:model??{async generate(){calls++;return {text:'Public derived summary.',model:'synthetic-d-host'};}},memory:{async retrieve(){return {records:[]};}}});
  const host=await new SceanHost({engine,root:join(root,'host'),summaryEnabled:enabled}).init();
  return {host,engine,store,run,calls:()=>calls};
}
const args=f=>({runId:f.run.runId,operationId:'summary-host-d',expectedVersion:f.run.version,expectedHead:f.run.head});
const authority=r=>hash({state:r.state,memories:r.memories,turns:r.turns,receipts:r.receipts,snapshot:r.snapshot});

test('D Host summary opt-in is explicit and disabled rejects before model or durable mutation',async()=>{
  const f=await fixture(),before=await f.store.read(f.run.runId);await assert.rejects(f.host.summaryStart(args(f)),{code:'SUMMARY_DISABLED'});
  assert.equal(hash(await f.store.read(f.run.runId)),hash(before));assert.equal(f.calls(),0);assert.equal((await f.host.summaryStatus(f.run.runId)).enabled,false);
});
test('D ordinary runView reads no audit/fullInspector and never returns all turns, private memories or all receipts',async()=>{
  const f=await fixture();f.engine.inspect=()=>{throw Error('FULL_INSPECTION_FORBIDDEN');};f.store.readAttempts=()=>{throw Error('AUDIT_READ_FORBIDDEN');};
  const view=await f.host.runView({runId:f.run.runId,requestId:'d-request-0035'});
  assert.equal(view.turnCount,35);assert.equal(view.lastTurn.turn,35);assert.equal(view.requestReceipt.status,'committed');
  assert.equal(view.turns,undefined);assert.equal(view.receipts,undefined);assert.equal(view.memories,undefined);assert(!JSON.stringify(view).includes(D_PRIVATE));
});
test('D Host actual summary stage commits only derived data and same operation is idempotent',async()=>{
  const f=await fixture({enabled:true}),before=await f.store.read(f.run.runId),result=await f.host.summaryStart(args(f));
  assert.equal(result.status,'completed');assert.equal(authority(await f.store.read(f.run.runId)),authority(before));assert.equal(f.calls(),1);
  assert.deepEqual(await f.host.summaryStart(args(f)),result);assert.equal(f.calls(),1);
  const status=await f.host.summaryStatus(f.run.runId);assert.equal(status.summaries.filter(s=>s.current).length,1);assert(!JSON.stringify(status).includes('sourceHashes'));
});
test('D Host exact summary cancellation preserves story and rejects stale identity',async()=>{
  let began,release;const started=new Promise(r=>began=r),pending=new Promise(r=>release=r);
  const f=await fixture({enabled:true,model:{async generate(){began();await pending;return {text:'Late text'};}}}),before=authority(f.run),job=f.host.summaryStart(args(f));
  const rejection=assert.rejects(job,{code:'CANCELLED'});await started;
  assert.equal(f.host.summaryCancel({runId:f.run.runId,operationId:'other'}).cancelRequested,false);
  assert.equal(f.host.summaryCancel(args(f)).cancelRequested,true);await rejection;release();
  const run=await f.store.read(f.run.runId);assert.equal(authority(run),before);assert.equal(run.narrative.operations['summary-host-d'].status,'cancelled');assert.equal(run.narrative.currentSummaryId,null);
});
test('D Host scoped page/read/search exclude private metadata and reject cross-run locator',async()=>{
  const f=await fixture(),page=await f.host.historyReadAction('historyPage',{runId:f.run.runId,limit:10});assert.equal(page.turns.length,10);
  const hits=await f.host.historyReadAction('historySearch',{runId:f.run.runId,query:'PROMISE_COMPASS'});assert.equal(hits.hits[0].turn,1);
  const read=await f.host.historyReadAction('historyRead',{runId:f.run.runId,locator:hits.hits[0].locator});assert.equal(read.turns[0].turn,1);
  assert(!JSON.stringify([page,hits,read]).includes(D_PRIVATE));await assert.rejects(f.host.runView({runId:'absent'}),{code:'RUN_NOT_FOUND'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {activeDraftReceipt} from '../isolated/web/view-model.mjs';
import {SceanHost} from '../plugin/host.mjs';
import {createHistoryFixture,playHistory,historyArgs} from '../fixtures/synthetic-history-c.mjs';

const input='Continue the research ship scene.';
async function fixture(){const f=await createHistoryFixture();f.hostRoot=join(f.root,'host');f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();return f;}
const draft=f=>({runId:f.run.runId,input,requestId:'request-d0'});
async function restart(f){return new SceanHost({engine:f.engine,root:f.hostRoot}).init();}
async function committed(f){return f.host.turn(draft(f));}
async function retire(f){return f.engine.rollback(await historyArgs(f,'rollback-d0'));}

test('D0 retired draftSave is retired, never committed; original request replay cannot generate',async()=>{const f=await fixture();await committed(f);await retire(f);const calls=f.model.calls.length,answer=await f.host.draftSave(draft(f));assert.equal(answer.status,'retired');assert.equal(answer.requestId,null);assert.equal(answer.retiredRequestId,'request-d0');assert.equal(answer.input,'');await assert.rejects(f.host.turn(draft(f)),{code:'REQUEST_RETIRED'});assert.equal(f.model.calls.length,calls);assert.equal((await f.host.progress(f.run.runId)).status,'retired');});

test('D0 draftGet and restart reconcile a persisted retired draft without restoring input or committed state',async()=>{const f=await fixture();await f.host.draftSave(draft(f));await playHistory(f,'quiet','request-d0');await retire(f);for(const host of [f.host,await restart(f)]){const answer=await host.draftGet(f.run.runId);assert.equal(answer.status,'retired');assert.equal(answer.requestId,null);assert.equal(answer.input,'');}assert.equal((await restart(f)).metadata.drafts[f.run.runId].status,'retired');});

test('D0 active canonical receipt reconciles an uncleaned draft; restart clears only active committed draft',async()=>{const f=await fixture();await f.host.draftSave(draft(f));await playHistory(f,'quiet','request-d0');assert.equal((await f.host.draftGet(f.run.runId)).status,'committed');assert.equal((await f.host.draftSave(draft(f))).status,'committed');assert.equal((await (await restart(f)).draftGet(f.run.runId)).status,'empty');});

test('D0 saved uncommitted and failed attempts retain same request and input; no false committed receipt',async()=>{const f=await fixture();await f.host.draftSave(draft(f));assert.equal((await f.host.draftGet(f.run.runId)).status,'saved');f.model.override=()=>{throw Object.assign(Error('synthetic model failure'),{code:'MODEL_TIMEOUT'});};await assert.rejects(committed(f));const host=await restart(f),saved=await host.draftGet(f.run.runId),progress=await host.progress(f.run.runId);assert.equal(saved.input,input);assert.equal(saved.requestId,'request-d0');assert.equal(progress.status,'failed');assert.equal(progress.requestOutcome.status,'not_committed');});

test('D0 interrupted pending attempt stays uncommitted and preserves draft after recovery',async()=>{const f=await fixture();await f.host.draftSave(draft(f));await f.store.writeAttempt(f.run.runId,{schemaVersion:1,attemptId:'interrupted-d0',requestId:'request-d0',runId:f.run.runId,status:'pending',input,startedAt:new Date().toISOString(),stages:[{stage:'draft',status:'pending'}],tools:[]});const host=await restart(f),p=await host.progress(f.run.runId);assert.equal(p.status,'failed');assert.equal(p.lastFailure.code,'INTERRUPTED_BEFORE_COMMIT');assert.equal(p.recovery,'interrupted_before_commit');assert.equal(p.requestOutcome.status,'not_committed');assert.equal((await host.draftGet(f.run.runId)).input,input);assert.equal(f.model.calls.length,0);});

test('D0 cached committed progress cannot resurrect a turn retired outside that Host instance',async()=>{const f=await fixture();await committed(f);assert.equal((await f.host.progress(f.run.runId)).status,'committed');await retire(f);const p=await f.host.progress(f.run.runId);assert.equal(p.status,'retired');assert.equal(p.requestOutcome.status,'retired');assert.deepEqual(p.events,[]);assert.equal(p.pending,false);assert.equal(p.commitId,undefined);});

test('D0 commit acknowledgement loss resolves from canonical receipt without duplicate generation',async()=>{const f=await fixture();f.store.fault=point=>{if(point==='afterRename')throw Object.assign(Error('synthetic acknowledgement lost'),{code:'EIO'});};const answer=await committed(f);assert(answer.commitId);const calls=f.model.calls.length;assert.equal((await f.host.progress(f.run.runId)).status,'committed');assert.equal((await f.host.draftGet(f.run.runId)).status,'empty');f.store.fault=null;await committed(f);assert.equal(f.model.calls.length,calls);});

test('D0 unknown acknowledgement remains unknown while canonical read unavailable; then resolves to absence or publication',async()=>{const f=await fixture();await f.host.draftSave(draft(f));const unknown={...draft(f),attemptId:null,stage:'commit',status:'unknown',events:[],lastFailure:{code:'COMMIT_OUTCOME_UNKNOWN'}};f.host.progressByRun.set(f.run.runId,unknown);const inspect=f.engine.inspect.bind(f.engine);f.engine.inspect=async()=>{throw Object.assign(Error('synthetic unavailable'),{code:'EIO'});};assert.equal((await f.host.progress(f.run.runId)).status,'unknown');f.engine.inspect=inspect;assert.equal((await f.host.progress(f.run.runId)).status,'failed');assert.equal((await f.host.progress(f.run.runId)).recovery,'confirmed_not_committed');assert.equal((await f.host.draftGet(f.run.runId)).requestId,'request-d0');await playHistory(f,'quiet','request-d0');assert.equal((await f.host.progress(f.run.runId)).status,'committed');});

test('D0 changed input cannot reuse active or retired receipt ID',async()=>{const f=await fixture();await committed(f);for(const retired of [false,true]){if(retired)await retire(f);await assert.rejects(f.host.draftSave({...draft(f),input:'different'}),{code:'IDEMPOTENCY_CONFLICT'});}});

test('D0 non-active non-retired inconsistent receipt is unknown, never inferred committed',async()=>{const f=await fixture();await f.host.draftSave(draft(f));await committed(f);const actualRead=f.store.read.bind(f.store);f.store.read=async id=>{const r=await actualRead(id);r.turns=[];return r;};assert.equal((await f.host.draftSave(draft(f))).status,'unknown');assert.equal((await f.host.progress(f.run.runId)).status,'unknown');});


test('D0 UI reconcile requires active committed receipt and never accepts retired/stale/missing result',()=>{
  const active={receipts:{r:{status:'committed',commitId:'c'}},turns:[{commitId:'c'}]};
  assert.equal(activeDraftReceipt(active,'r'),true);
  assert.equal(activeDraftReceipt({...active,receipts:{r:{status:'retired',commitId:'c'}}},'r'),false);
  assert.equal(activeDraftReceipt({...active,turns:[]},'r'),false);
  assert.equal(activeDraftReceipt({receipts:{r:{commitId:'c'}},turns:active.turns},'r'),false);
  assert.equal(activeDraftReceipt({requestReceipt:{requestId:'r',status:'committed',commitId:'c',active:true}},'r'),true);
  assert.equal(activeDraftReceipt({requestReceipt:{requestId:'other',status:'committed',commitId:'c',active:true}},'r'),false);
});

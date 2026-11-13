import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {SceanHost} from '../plugin/host.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {headOf} from '../core/history.mjs';
import {turnDurationView,formatTurnDuration,mountTurnDuration} from '../isolated/web/turn-duration.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const snapshot={schemaVersion:1,cardId:'duration-synthetic',revision:1,card:{name:'Synthetic clock'},worldbook:{entries:[]},preset:{},characters:[{id:'npc-a',name:'NPC-A',description:'Synthetic participant.'}]};
async function fixture(t,options={}){
 const parent=path.resolve(import.meta.dirname,'../.test-tmp/');await fs.mkdir(parent,{recursive:true});const root=await fs.mkdtemp(path.join(parent,'turn-duration-'));let clock=Date.UTC(2026,0,1);const calls=[];
 const store=new DurableStore({root:path.join(root,'store'),fault:(...args)=>options.fault?.(...args)});
 const model={async generate(args){clock+=1000;calls.push(args.stage);const custom=await options.override?.(args);if(custom)return custom;return {text:args.stage==='director'?JSON.stringify({handoffVersion:1,sceneIntent:'A synthetic quiet room.',knownFacts:[],effectiveConstraints:[],expressedCommitmentsOrRefusals:[],characterPositions:[],unknowns:[]}):args.stage==='post_stat'?'\u007b"contractVersion":2,"stateChanges":[],"memories":[]\u007d':'Synthetic final body.'};}};
 const engine=new SceanEngine({postBody:false,store,model,memory:new Memory()}),hostRoot=path.join(root,'host'),host=await new SceanHost({engine,root:hostRoot,now:()=>clock}).init();
 const run=await host.createRun({snapshot});t.after(async()=>{await host.close();await fs.rm(root,{recursive:true,force:true});});
 return {host,hostRoot,engine,store,runId:run.runId,calls,now:()=>clock,advance:ms=>clock+=ms};
}
async function request(f,kind='turn',extra={}){const run=await f.store.read(f.runId);return {kind,runId:f.runId,operationId:'op-one',requestId:'request-one',baseVersion:run.version,baseHead:headOf(run),...(kind==='turn'?{input:'Observe the synthetic room.'}:{}),...extra};}
async function finish(f,operationId='op-one'){await f.host.jobs.active.get(f.runId)?.promise;return f.host.jobs.status({runId:f.runId,operationId});}
const view=(timing,options={})=>turnDurationView(timing,{runId:timing.runId,...options});

test('Host duration spans all stages and a delayed canonical commit; no model completion means success',async t=>{
 const entered=deferred(),release=deferred(),published=deferred(),acknowledge=deferred();let f;f=await fixture(t,{fault:async(point)=>{if(f&&point==='beforeRename'){f.advance(5000);entered.resolve();await release.promise;f.advance(2000);}if(f&&point==='afterRename'){published.resolve();await acknowledge.promise;}}});t.after(()=>{release.resolve();acknowledge.resolve();});
 const r=await request(f);const accepted=await f.host.jobs.submit(r);assert.equal(accepted.generationTiming.status,'accepted');await entered.promise;
 const pending=await f.host.jobs.status({runId:f.runId,operationId:r.operationId});assert.equal(pending.pending,true);assert.match(view(pending.generationTiming).text,/生成中 00:08/);assert(!view(pending.generationTiming).text.includes('本輪用時'));assert.deepEqual(f.calls,['director','writer','post_stat']);
 release.resolve();await published.promise;const finishing=await f.host.jobs.status({runId:f.runId,operationId:r.operationId});assert.equal(finishing.status,'committed');assert.equal(view(finishing.generationTiming).text,'生成中 00:10');acknowledge.resolve();const done=await finish(f);assert.equal(done.status,'committed');assert.equal(view(done.generationTiming).text,'本輪用時 00:10');const end=done.generationTiming.finishedAt;
 f.advance(600000);const replay=await f.host.jobs.submit(r);assert.equal(replay.generationTiming.finishedAt,end);assert.equal(view(replay.generationTiming).text,'本輪用時 00:10');assert.equal(f.calls.length,3);
});
test('failed and cancelled operations freeze separately; a same-request explicit retry has its own operation clock',async t=>{
 let fail=true;const f=await fixture(t,{override:async()=>{if(fail)throw Object.assign(Error('Synthetic failure'),{code:'MODEL_FAILED'});}}),r=await request(f);
 await f.host.jobs.submit(r);const failed=await finish(f);assert.equal(view(failed.generationTiming).text,'本次失敗 00:01');f.advance(60000);fail=false;
 await f.host.jobs.submit({...r,operationId:'op-retry',retryOf:r.operationId});const done=await finish(f,'op-retry');assert.equal(view(done.generationTiming).text,'本輪用時 00:03');assert.notEqual(done.generationTiming.operationId,failed.generationTiming.operationId);assert.equal(done.generationTiming.requestId,failed.generationTiming.requestId);
 const prior=await f.host.jobs.status({runId:f.runId,operationId:r.operationId});assert.equal(view(prior.generationTiming).text,'本次失敗 00:01');assert.notEqual(done.generationTiming.attemptId,prior.generationTiming.attemptId);
});
test('normal cancellation and regenerate use the exact operation, with provisional generation never treated as final publication',async t=>{
 let hold=false;const entered=deferred(),release=deferred(),f=await fixture(t,{override:async({stage,signal})=>{if(hold&&stage==='writer'){entered.resolve();await Promise.race([release.promise,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{code:'CANCELLED'})),{once:true}))]);}}});t.after(()=>release.resolve());
 await f.host.jobs.submit(await request(f));await finish(f);hold=true;const regen=await request(f,'regenerate',{operationId:'regen-one',requestId:'regen-request'});await f.host.jobs.submit(regen);await entered.promise;
 const pending=await f.host.jobs.status({runId:f.runId,operationId:regen.operationId});assert.equal(pending.generationTiming.kind,'regenerate');assert.match(view(pending.generationTiming).text,/生成中/);
 f.host.jobs.cancel({runId:f.runId,operationId:regen.operationId});const cancelled=await finish(f,regen.operationId);assert.match(view(cancelled.generationTiming).text,/本次已取消/);assert.equal((await f.store.read(f.runId)).turns.length,1);
 hold=false;await f.host.jobs.submit(await request(f,'regenerate',{operationId:'regen-two',requestId:'regen-request-two'}));const done=await finish(f,'regen-two');assert.equal(done.status,'committed');assert.equal(view(done.generationTiming).text,'本輪用時 00:03');assert.equal((await f.store.read(f.runId)).turns.length,1);
});
test('refresh/restart retains a durable duration, later background work cannot extend it, and missing identities expose no unrelated clock',async t=>{
 const summaryEntered=deferred(),summaryRelease=deferred();t.after(()=>summaryRelease.resolve());const f=await fixture(t,{override:async({stage})=>{if(stage==='summary'){summaryEntered.resolve();await summaryRelease.promise;return {text:'A synthetic archive.'};}}});
 await f.engine.turn({runId:f.runId,input:'Earlier synthetic turn.',requestId:'seed'});const r=await request(f);await f.host.jobs.submit(r);const done=await finish(f);await f.host.close();f.advance(3600000);
 const host=await new SceanHost({engine:f.engine,root:f.hostRoot,now:f.now,summaryEnabled:true}).init();t.after(()=>host.close());const restored=await host.jobs.status({runId:f.runId});assert.equal(view(restored.generationTiming).text,'本輪用時 00:03');
 const current=await f.store.read(f.runId);await host.jobs.submit({kind:'summaryStart',runId:f.runId,operationId:'background-summary',baseVersion:current.version,baseHead:headOf(current),endTurn:1,recentWindow:1});await summaryEntered.promise;f.advance(600000);
 const background=await host.jobs.status({runId:f.runId});assert.equal(background.pending,true);assert.equal(background.kind,'summaryStart');assert.equal(background.generationTiming.operationId,r.operationId);assert.equal(background.generationTiming.finishedAt,done.generationTiming.finishedAt);assert.equal(view(background.generationTiming).text,'本輪用時 00:03');summaryRelease.resolve();await host.jobs.active.get(f.runId)?.promise;
 assert.equal((await host.jobs.status({runId:f.runId,operationId:'unknown-operation'})).generationTiming,null);
});
test('restart reconciliation of canonical success does not turn reboot time into completion time',async t=>{
 const f=await fixture(t),r=await request(f);await f.host.jobs.submit(r);await finish(f);await f.host.close();const file=path.join(f.hostRoot,'operations.json'),data=JSON.parse(await fs.readFile(file,'utf8'));data.records[0].status='running';delete data.records[0].finishedAt;await fs.writeFile(file,JSON.stringify(data));f.advance(3600000);
 const host=await new SceanHost({engine:f.engine,root:f.hostRoot,now:f.now}).init();t.after(()=>host.close());const restored=await host.jobs.status({runId:f.runId});assert.equal(restored.status,'committed');assert.equal(restored.generationTiming.finishedAt,null);assert.equal(view(restored.generationTiming).text,'本輪已保存 · 耗時未記錄');
});
test('unknown publication freezes its original operation end, then canonical read-only reconciliation confirms it without another generation',async t=>{
 let armed=false,blocked=false;const f=await fixture(t,{fault:async point=>{if(armed&&point==='afterRename'){blocked=true;throw Object.assign(Error('Synthetic acknowledgement loss'),{code:'EIO'});}}});
 const read=f.store.read.bind(f.store);f.store.read=async(...args)=>{if(blocked)throw Object.assign(Error('Synthetic temporary read loss'),{code:'EIO'});return read(...args);};
 armed=true;await f.host.jobs.submit(await request(f));await f.host.jobs.active.get(f.runId)?.promise;const row=f.host.jobs.ledger.records.at(-1);assert.equal(row.status,'unknown');const end=row.finishedAt;assert.equal(f.calls.length,3);
 blocked=false;f.advance(60000);const recovered=await f.host.jobs.status({runId:f.runId,operationId:row.operationId});assert.equal(recovered.status,'committed');assert.equal(recovered.generationTiming.finishedAt,end);assert.equal(view(recovered.generationTiming).text,'本輪用時 00:03');assert.equal(f.calls.length,3);assert.equal((await f.store.read(f.runId)).turns.length,1);
});
test('clock uses Host time plus monotonic local elapsed time; loss, unknown outcomes, invalid identities and format are explicit',()=>{
 const start='2026-01-01T00:00:00.000Z',timing={scope:'host_operation',runId:'r',operationId:'o',requestId:'q',kind:'turn',status:'running',startedAt:start,serverNow:'2026-01-01T00:01:32.000Z',finishedAt:null};
 assert.equal(view(timing,{receivedAt:3000,now:5000}).text,'生成中 01:34');assert.equal(view(timing,{disconnected:true}).text,'結果待確認 01:32');assert.equal(view({...timing,status:'unknown',finishedAt:timing.serverNow},{now:1000000}).text,'結果待確認 01:32');
 assert.equal(turnDurationView(timing,{runId:'another-run'}).hidden,true);assert.equal(view({...timing,kind:'chapterAuto'}).hidden,true);assert.equal(view({...timing,startedAt:'invalid'}).hidden,true);assert.equal(formatTurnDuration(3723000),'1:02:03');
 const element={setAttribute(){},textContent:'',hidden:true};let tick,clock=0;const ui=mountTurnDuration({element,now:()=>clock,interval:fn=>(tick=fn,1),clear(){}});ui.update(timing,{runId:'r'});clock=3000;tick();assert.equal(element.textContent,'生成中 01:35');ui.connection(false);assert.equal(element.textContent,'結果待確認 01:35');ui.clear();assert.equal(element.hidden,true);ui.dispose();
});

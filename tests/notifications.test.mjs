import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {SceanHost} from '../plugin/host.mjs';
import {TemporalFixtureEngine as SceanEngine} from '../fixtures/temporal-fixture-engine.mjs';
import {DurableStore} from '../adapters/store.mjs';
import {Memory} from '../core/memory.mjs';
import {headOf} from '../core/history.mjs';
import {createNotificationClient} from '../isolated/web/notifications.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';

const snapshot={schemaVersion:1,cardId:'notify-synthetic',revision:1,source:{provider:'@local/dsh-card-studio-scean-test',card:{id:'notify-synthetic',revision:1}},card:{name:'PRIVATE_SYNTHETIC_CARD'},worldbook:{entries:[]},preset:{},characters:[{id:'captain',name:'Synthetic captain',description:'Synthetic.'}]};
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(options={}){
  const parent=fileURLToPath(new URL('../evidence/notifications-test-temp/',import.meta.url));await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));const calls=[];
  const store=new DurableStore({root:join(root,'store')}),model={async generate(args){calls.push(args.stage);const override=await options.override?.(args);if(override!==undefined)return override;return {text:args.stage==='post_stat'?JSON.stringify({contractVersion:2,stateChanges:[],memories:[],playerHistory:[]}):'PRIVATE_SYNTHETIC_STORY'};}};
  const engine=new SceanEngine({unconfiguredWritingMode:'current',store,model,memory:new Memory()}),hostRoot=join(root,'host');
  const host=await new SceanHost({engine,root:hostRoot,notificationOptions:options.notificationOptions??{}}).init();
  const {runId}=await host.createRun({snapshot});return {host,store,engine,runId,root,hostRoot,calls};
}
async function request(f,extra={}){const run=await f.store.read(f.runId);return {runId:f.runId,requestId:'notify-request',operationId:'notify-operation',kind:'turn',baseVersion:run.version,baseHead:headOf(run),input:'PRIVATE_SYNTHETIC_INPUT',...extra};}
const dest={destinationId:'synthetic-destination'};
async function rpc(f,action,payload={}){const result=await f.host.request({action,...payload});if(!result.ok)throw Object.assign(new Error(result.error.message),result.error);return result.value;}
async function arm(f,q){return rpc(f,'notificationWatch',{...q,...dest});}
async function run(f,q){const ack=await rpc(f,'operationSubmit',q);await f.host.jobs.active.get(f.runId)?.promise;return ack;}
async function status(f){return rpc(f,'notificationStatus',dest);}
async function ready(f){return (await status(f)).watches.find(value=>value.status==='ready');}
async function claim(f,row){return rpc(f,'notificationClaim',{...dest,eventId:row.eventId});}

test('N01 canonical aggregate is the authority; a commit has one consumed presentation claim with no private metadata',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);assert.equal((await status(f)).watches[0].status,'watching');await run(f,q);
  const row=await ready(f),saved=await f.store.read(f.runId);assert(row);assert(saved.turns[0].body);assert(saved.state);assert(Array.isArray(saved.memories));assert(Array.isArray(saved.playerHistory));assert(saved.receipts[q.requestId]);
  assert.equal((await claim(f,row)).claimed,true);assert.equal((await claim(f,row)).claimed,false);assert.equal(f.calls.length,4);
  const journal=await readFile(join(f.hostRoot,'notifications.json'),'utf8');for(const secret of ['PRIVATE_SYNTHETIC_CARD','PRIVATE_SYNTHETIC_STORY','PRIVATE_SYNTHETIC_INPUT','Synthetic captain','bodyHash','prompt'])assert(!journal.includes(secret));await f.host.close();
});
test('N02 prose/token completion is not a save notification',async()=>{
  const entered=defer(),release=defer(),f=await fixture({override:async args=>{if(args.stage==='post_stat'){entered.resolve();await release.promise;}}}),q=await request(f);await arm(f,q);await rpc(f,'operationSubmit',q);await entered.promise;
  assert.equal((await status(f)).watches[0].status,'watching');assert.equal((await f.store.read(f.runId)).turns.length,0);release.resolve();await f.host.jobs.active.get(f.runId)?.promise;assert(await ready(f));await f.host.close();
});
test('N03 beforeRename disk failure has no completion event',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);f.store.fault=async point=>{if(point==='beforeRename')throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});};await run(f,q);assert.equal((await status(f)).watches[0].status,'watching');assert.equal((await f.store.read(f.runId)).turns.length,0);await f.host.close();
});
test('N04 published receipt survives afterRename ack and attempt checkpoint failure',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);f.store.fault=async point=>{if(point==='afterRename')throw Error('ack lost');};const write=f.store.writeAttempt.bind(f.store);f.store.writeAttempt=async(id,attempt)=>{if(attempt.status==='committed')throw Error('checkpoint lost');return write(id,attempt);};await run(f,q);
  const row=await ready(f);assert(row);assert.equal((await claim(f,row)).claimed,true);assert.equal(f.calls.length,4);await f.host.close();
});
test('N05 unreadable canonical is unknown until exact receipt can be reread',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const read=f.store.read.bind(f.store);f.store.read=async()=>{throw Error('temporarily unavailable');};const unknown=await status(f);assert.equal(unknown.watches[0].status,'watching');assert.equal(unknown.watches[0].reason,'outcome_unknown');f.store.read=read;assert(await ready(f));await f.host.close();
});
test('N06 cancelled before publication never notifies, cancellation after publication still uses receipt',async()=>{
  const entered=defer(),release=defer(),f=await fixture({override:async args=>{if(args.stage==='director'){entered.resolve();await release.promise;}}}),q=await request(f);await arm(f,q);await rpc(f,'operationSubmit',q);await entered.promise;await rpc(f,'cancel',{runId:f.runId,operationId:q.operationId});await f.host.jobs.active.get(f.runId)?.promise;release.resolve();assert.equal((await status(f)).watches[0].status,'watching');await f.host.close();
  const g=await fixture(),r=await request(g);await arm(g,r);g.store.fault=async point=>{if(point==='afterRename')g.host.cancel({runId:g.runId,operationId:r.operationId});};await run(g,r);assert(await ready(g));await g.host.close();
});
test('N07 explicit same-request failed retries notify only owning successful attempt',async()=>{
  let fail=true;const f=await fixture({override:async()=>{if(fail)throw Error('Synthetic model failure');}}),q=await request(f);await arm(f,q);await run(f,q);
  let r={...q,operationId:'notify-retry-one',retryOf:q.operationId};await arm(f,r);await run(f,r);assert.equal((await status(f)).watches[0].status,'watching');fail=false;r={...q,operationId:'notify-retry-two',retryOf:r.operationId};await arm(f,r);await run(f,r);assert(await ready(f));const attempts=await f.store.readAttempts(f.runId);assert.equal(attempts.filter(row=>row.status==='failed').length,2);assert.equal(attempts.filter(row=>row.status==='committed').length,1);await f.host.close();
});
test('N08 replay with new operation cannot rearm successful request or dispatch models',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const row=await ready(f);await claim(f,row);await run(f,{...q,operationId:'replay-operation'});assert.equal((await arm(f,{...q,operationId:'replay-operation'})).status,'consumed');assert.equal((await claim(f,row)).claimed,false);assert.equal(f.calls.length,4);await f.host.close();
});
test('N09/N10 restart reconstructs only persisted watches and stable store identity',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const storeId=f.host.notifications.ledger.state.storeId;await f.host.close();f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();assert.equal(f.host.notifications.ledger.state.storeId,storeId);const row=await ready(f);assert(row);await claim(f,row);await f.host.close();f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();assert.equal((await status(f)).watches[0].status,'consumed');assert.equal(f.calls.length,4);await f.host.close();
});
test('N11 durable consumed acknowledgement loss never replays an attempt',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const row=await ready(f);f.host.notifications.ledger.fault=async point=>{if(point==='afterRename')throw Error('claim ack lost');};await assert.rejects(claim(f,row),{code:'NOTIFICATION_LEDGER'});f.host.notifications.ledger.fault=null;assert.equal((await claim(f,row)).claimed,false);await f.host.close();
});
test('N12 pending retired event is suppressed and click rejects the retired commit',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const row=await ready(f),saved=await f.store.read(f.runId);await rpc(f,'rollback',{runId:f.runId,operationId:'rollback-one',expectedVersion:saved.version,expectedHead:headOf(saved),confirmation:'rollback-last-committed-turn'});assert.equal((await claim(f,row)).status,'suppressed');await assert.rejects(rpc(f,'notificationTarget',{...dest,eventId:row.eventId}),{code:'NOTIFICATION_TARGET_RETIRED'});await f.host.close();
});
test('N13/N14 provisional regenerate is not completion; outer replacement gets distinct event and rollback does not',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const original=await ready(f);await claim(f,original);
  const regen=await request(f,{kind:'regenerate',requestId:'regen-request',operationId:'regen-operation',input:undefined});await arm(f,regen);const before=f.store.read.bind(f.store);let sawProvisional=false;const commit=f.store.commit.bind(f.store);f.store.commit=async(...args)=>{sawProvisional=true;assert.equal((await status(f)).watches.find(row=>row.requestId===regen.requestId).status,'watching');return commit(...args);};await run(f,regen);f.store.commit=commit;assert(sawProvisional);const replacement=await ready(f);assert(replacement);assert.notEqual(replacement.commitId,original.commitId);assert.equal(replacement.kind,'regenerate');await assert.rejects(rpc(f,'notificationTarget',{...dest,eventId:original.eventId}),{code:'NOTIFICATION_TARGET_RETIRED'});assert.equal((await claim(f,replacement)).claimed,true);await f.host.close();
});
test('N15/N16 same Host claim is atomic across competing destinations and session changes cannot read targets',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);assert.equal((await rpc(f,'notificationWatch',{...q,destinationId:'other-destination'})).status,'other_destination');await run(f,q);const row=await ready(f);const claims=await Promise.all(Array.from({length:6},()=>claim(f,row)));assert.equal(claims.filter(value=>value.claimed).length,1);await assert.rejects(rpc(f,'notificationTarget',{...dest,eventId:row.eventId,sessionId:'other-session'}),{code:'NOTIFICATION_SCOPE_MISMATCH'});assert.equal((await rpc(f,'notificationStatus',{...dest,sessionId:'other-session'})).watches.length,0);await f.host.close();
});
test('N17 historical/imported commit has no new event, stop/re-enable does not reopen old watches, capacity fails closed',async()=>{
  const f=await fixture({notificationOptions:{capacity:1}}),q=await request(f);await run(f,q);assert.equal((await arm(f,q)).status,'historical');const next=await request(f,{requestId:'next-request',operationId:'next-operation'});await arm(f,next);await rpc(f,'notificationStop',dest);assert.equal((await arm(f,next)).status,'suppressed');const later=await request(f,{requestId:'later-request',operationId:'later-operation'});await assert.rejects(arm(f,later),{code:'NOTIFICATION_CAPACITY'});await run(f,next);assert.equal((await status(f)).watches[0].status,'suppressed');await f.host.close();
});
test('N19/N20 target is exact readonly commit; wrong attempt ownership and stale snapshot refuse success',async()=>{
  const f=await fixture(),q=await request(f);await arm(f,q);await run(f,q);const row=await ready(f),calls=f.calls.length;assert.deepEqual(await rpc(f,'notificationTarget',{...dest,eventId:row.eventId}),{runId:f.runId,commitId:row.commitId,eventId:row.eventId});assert.equal(f.calls.length,calls);
  const path=join(f.store.runDir(f.runId),'current.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.receipts[q.requestId].attemptId='not-owner';await writeFile(path,JSON.stringify(saved));assert.equal((await status(f)).watches[0].status,'watching');await assert.rejects(rpc(f,'notificationTarget',{...dest,eventId:row.eventId}),{code:'NOTIFICATION_TARGET_UNAVAILABLE'});await f.host.close();
});
function browser(options={}){
  const data=new Map(),timers=new Map(),notifications=[],toasts=[],targets=[];let permissions=0;
  class Notice{static permission=options.permission??'default';static async requestPermission(){permissions++;return Notice.permission=options.answer??'denied';}constructor(title,payload){if(options.throws)throw Error('Unsupported constructor');this.title=title;this.payload=payload;notifications.push(this);}close(){this.closed=true;}}
  const environment={crypto:{randomUUID},isSecureContext:options.secure??true,Notification:options.missing?undefined:Notice,document:{visibilityState:options.hidden?'hidden':'visible',hasFocus:()=>!options.hidden},localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)},setTimeout:fn=>{const id=randomUUID();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  return {environment,notifications,toasts,targets,data,timers,get permissions(){return permissions;}};
}
async function client(f,b,scope={}){const c=createNotificationClient({environment:b.environment,getScope:async()=>scope,call:(action,payload)=>rpc(f,action,payload),showToast:value=>b.toasts.push(value),onTarget:target=>b.targets.push(target)});return c;}
test('N18/N19 permission request only explicit enable; foreground toast is private and exact click never generates',async()=>{
  const f=await fixture(),b=browser({permission:'granted'}),c=await client(f,b),q=await request(f);await c.watch(q);await c.refresh();assert.equal(b.permissions,0);await run(f,q);await c.refresh();assert.equal(b.toasts.length,1);assert.equal(b.notifications.length,0);assert.equal(b.permissions,0);assert.equal(b.toasts[0].message,'本輪已保存');await b.toasts[0].open();assert.equal(b.targets[0].commitId,(await f.store.read(f.runId)).turns[0].commitId);assert.equal(f.calls.length,4);c.dispose();await f.host.close();
});
test('N18/N22 insecure/missing/default/denied capability degrades honestly without automatic permission',async()=>{
  for(const options of [{secure:false},{missing:true},{permission:'denied'},{permission:'default'}]){const f=await fixture(),b=browser(options),c=await client(f,b),q=await request(f);await c.watch(q);await run(f,q);await c.refresh();assert.equal(b.permissions,0);assert.equal(b.notifications.length,0);assert.equal(b.toasts.length,1);if(options.permission==='default'){await c.enable();assert.equal(b.permissions,1);}c.dispose();await f.host.close();}
});
test('N11/N18/N22 background opt-in uses one silent generic attempt; constructor failure never replays',async()=>{
  for(const throws of [false,true]){const f=await fixture(),b=browser({hidden:true,permission:'granted',throws}),c=await client(f,b),q=await request(f);await c.enable();await c.watch(q);await run(f,q);await c.refresh();await c.refresh();assert.equal(b.permissions,0);assert.equal(b.notifications.length,throws?0:1);assert.equal(b.toasts.length,throws?1:0);if(!throws){assert.deepEqual(b.notifications[0].payload.body,'本輪已保存，點擊查看。');assert.equal(b.notifications[0].payload.silent,true);assert(!JSON.stringify(b.notifications[0]).includes('PRIVATE_SYNTHETIC'));b.notifications[0].onerror();b.notifications[0].onerror();assert.equal(b.toasts.length,1);await c.refresh();assert.equal(b.notifications.length,1);}assert.equal(f.calls.length,4);c.dispose();await f.host.close();}
});
test('N15/N20 client click after Session change refuses target and no generation or wrong Run navigation occurs',async()=>{
  const f=await fixture(),b=browser(),scope={sessionId:'original-session'},c=createNotificationClient({environment:b.environment,getScope:async()=>({...scope}),call:(action,payload)=>rpc(f,action,payload),showToast:value=>b.toasts.push(value),onTarget:target=>b.targets.push(target)}),q=await request(f);await c.watch(q);await run(f,q);await c.refresh();scope.sessionId='different-session';await b.toasts[0].open();assert.equal(b.targets.length,0);assert.equal(b.toasts[1].error,true);assert.equal(f.calls.length,4);c.dispose();await f.host.close();
});
test('N17 corrupt notification sidecar disables only notifications and never dispatches historical events',async()=>{
  const f=await fixture();await f.host.close();await writeFile(join(f.hostRoot,'notifications.json'),'{"schemaVersion":1,"watches":"invalid"}');f.host=await new SceanHost({engine:f.engine,root:f.hostRoot}).init();assert.equal((await status(f)).available,false);await run(f,await request(f));assert.equal((await f.store.read(f.runId)).turns.length,1);await f.host.close();
});
test('N08 pending lost-ACK replay preserves original admitted operation watch',async()=>{
  const entered=defer(),release=defer(),f=await fixture({override:async args=>{if(args.stage==='director'){entered.resolve();await release.promise;}}}),q=await request(f);await arm(f,q);await rpc(f,'operationSubmit',q);await entered.promise;const duplicate={...q,operationId:'lost-ack-replay'};await arm(f,duplicate);assert.equal((await rpc(f,'operationSubmit',duplicate)).operationId,q.operationId);assert.equal(f.host.notifications.ledger.state.watches[0].operationId,q.operationId);release.resolve();await f.host.jobs.active.get(f.runId)?.promise;assert(await ready(f));assert.equal(f.calls.length,4);await f.host.close();
});
test('N15/N21 native Host notification actions retain exact current card and Session context checks',async()=>{
  const f=await fixture(),sessionId='notification-live-session',scope={provider:snapshot.source.provider,cardId:snapshot.cardId,authoringSessionId:sessionId,generation:'notification-generation'};let active=scope;
  const authority={requireCardScope:true,resolveCardScope:async id=>id===sessionId?active:null};
  const q=await request(f),scoped=(action,payload={})=>f.host.request({action,sessionId,cardScope:scope,...payload},undefined,authority);
  assert.equal((await scoped('notificationWatch',{...q,...dest})).ok,true);await run(f,q);const row=(await scoped('notificationStatus',dest)).value.watches.find(value=>value.status==='ready');
  assert.equal((await scoped('notificationTarget',{...dest,eventId:row.eventId})).ok,true);
  active={...scope,cardId:'other-card',generation:'other-generation'};
  for(const action of ['notificationStatus','notificationClaim','notificationTarget','notificationStop'])assert.equal((await scoped(action,{...dest,eventId:row.eventId})).error.code,'CARD_CONTEXT_CHANGED');
  const unauthorized=await f.host.request({action:'notificationTarget',sessionId,cardScope:active,...dest,eventId:row.eventId},undefined,authority);assert.equal(unauthorized.error.code,'CARD_SCOPE_MISMATCH');
  const currentStatus=await f.host.request({action:'notificationStatus',sessionId,cardScope:active,...dest},undefined,authority);assert.equal(currentStatus.value.watches.length,0);active=null;assert.equal((await scoped('notificationClaim',{...dest,eventId:row.eventId})).error.code,'CARD_CONTEXT_REQUIRED');assert.equal(f.calls.length,4);await f.host.close();
});
test('N18/N21 native bridge permission route stays in parent and panel dispose leaves top-level observer alive',async()=>{
  const sent=[],watched=[],enabled=[];let disposed=0,refreshed=0;
  const notifications={capabilities:()=>({supported:true,permission:'default',backgroundEnabled:false}),watch:async value=>watched.push(value),refresh:()=>{refreshed++;},dispose:()=>disposed++};
  const bridge=createNativeBridge({call:async value=>{sent.push(value);return value.action==='context'?{cardScope:{cardId:'synthetic-card'}}:{status:'accepted'};},getSessionId:()=> 'synthetic-session',notifications,enableNotifications:()=>{enabled.push('explicit-parent-button');return {status:'confirm_in_parent'};}});
  await bridge.request('native.context');assert.equal((await bridge.request('native.notificationCapabilities')).backgroundEnabled,false);assert.equal(enabled.length,0);await bridge.request('native.notificationEnable');assert.equal(enabled.length,1);assert.equal(sent.some(value=>value.action==='native.notificationEnable'),false);
  await assert.rejects(bridge.request('notificationWatch',{body:'arbitrary private notification'}),{code:'NATIVE_ACTION_DENIED'});
  await bridge.request('operationSubmit',{kind:'turn',runId:'synthetic-run',operationId:'synthetic-op'});assert.equal(watched.length,1);assert.equal(watched[0].sessionId,'synthetic-session');assert.equal(refreshed,1);await bridge.dispose();assert.equal(disposed,0);
});
test('N15/N21 card change during notification arm never dispatches a stale model operation',async()=>{
  const entered=defer(),release=defer(),sent=[];const bridge=createNativeBridge({call:async value=>{sent.push(value);return {cardScope:{cardId:'synthetic-card'}};},notifications:{watch:async()=>{entered.resolve();await release.promise;}}});
  await bridge.request('native.context');const pending=bridge.request('operationSubmit',{kind:'turn',runId:'synthetic-run',operationId:'synthetic-op'});await entered.promise;bridge.clearContext();release.resolve();await assert.rejects(pending,{code:'NATIVE_CONTEXT_STALE'});assert.equal(sent.some(value=>value.action==='operationSubmit'),false);await bridge.dispose();
});

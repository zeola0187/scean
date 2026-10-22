import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceClient} from '../cardstudio-bundle/lib/client-controller.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(options={}){
 let now=0,id=0,generation=0,visible=true;const timeouts=new Map(),intervals=new Map(),calls=[],errors=[],shown=[],phases=[];let presented=0,hidden=0;
 const row={id:'synthetic-session-A',cwd:'C:/Synthetic/CardStudio'},selection={document_id:'synthetic-card',revision:7};
 const client=new WorkspaceClient({root:row.cwd,pageId:'synthetic-browser-page',rpcTimeoutMs:1000,now:()=>now,isVisible:()=>visible,
 setTimer:fn=>{intervals.set(++id,fn);return id;},clearTimer:id=>intervals.delete(id),setDelay:(fn,ms)=>{timeouts.set(++id,{fn,at:now+ms});return id;},clearDelay:id=>timeouts.delete(id),
 hide(){hidden++;},present(){presented++;},show:value=>shown.push(value),notify:error=>errors.push(error),connectionChanged:value=>phases.push(value.phase),
 send:async(session,r,signal)=>{calls.push({session,...r,signal});if(options.respond){const result=options.respond(session,r,signal);if(result!==undefined)return result;}if(r.action==='acquire')return{ok:true,value:{lease_id:'lease-'+(++generation),agent_generation:generation,workspace_generation:'synthetic-host',page_id:r.page_id,lease_ms:90000,selection_status:{...selection,agent_generation:generation},authoring_scope:{mode:'content',epoch:2}}};return{ok:true,value:r.action==='renew'?{active:true,lease_ms:90000,selection_status:{...selection,agent_generation:generation}}:r.action==='capabilities'?{tools:[{name:'synthetic-card-tool'}],skills:[],authoring_scope:{mode:'content',epoch:2}}:{id:'synthetic-card',revision:8}};},
 sendScean:options.sendScean,
 });
 return{client,row,calls,errors,shown,phases,timeouts,intervals,get presented(){return presented;},get hidden(){return hidden;},setVisible:v=>visible=v,async open(){await client.transition(row);},async tick(ms){now+=ms;for(let n=0;n<30;n++){const due=[...timeouts].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timeouts.delete(due[0]);due[1].fn();await flush();}await flush();},acquires:()=>calls.filter(r=>r.action==='acquire'),releases:()=>calls.filter(r=>r.action==='release')};
}
test('first and repeated acquire failures retry with bounded exponential backoff, preserving Session view identity',async()=>{
 let failures=3;const f=fixture({respond:(_s,r)=>r.action==='acquire'&&failures-->0?{ok:false,error:{code:'SYNTHETIC_OFFLINE',message:'offline'}}:undefined});await f.open();const sequence=f.client.sequence;assert.equal(f.client.phase,'error');assert.equal(f.acquires().length,1);await f.tick(999);assert.equal(f.acquires().length,1);await f.tick(1);assert.equal(f.acquires().length,2);await f.tick(1999);assert.equal(f.acquires().length,2);await f.tick(1);assert.equal(f.acquires().length,3);await f.tick(4000);assert.equal(f.client.phase,'ready');assert.equal(f.acquires().length,4);assert.equal(f.client.sequence,sequence);assert.equal(f.presented,1);assert.equal(f.hidden,1);await f.client.close();assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);
});
test('initial workspace discovery failure also retries without leaving the conversation',async()=>{
 let fail=true;const f=fixture({respond:(_s,r)=>r.action==='workspace'?(fail?Promise.reject(Error('initial offline')):{ok:true,value:{workspace:'C:/Synthetic/CardStudio'}}):undefined});f.client.root=null;await f.open();assert.equal(f.client.phase,'error');assert.equal(f.acquires().length,0);fail=false;await f.tick(1000);await flush();assert.equal(f.client.phase,'ready');assert.equal(f.client.current.id,f.row.id);assert.equal(f.acquires().length,1);await f.client.close();
});
test('foreground/online resumes with no claim; hidden pages never acquire or renew',async()=>{
 let offline=true;const f=fixture({respond:()=>offline?Promise.reject(Error('offline')):undefined});await f.open();assert.equal(f.client.claim,null);offline=false;f.setVisible(false);await f.client.resume();await f.tick(5000);assert.equal(f.acquires().length,1);f.setVisible(true);await f.client.resume();assert.equal(f.client.phase,'ready');assert.equal(f.acquires().length,2);await f.client.close();
});
test('unsettled renewal aborts at its deadline and reacquires once without a Session remount',async()=>{
 const held=deferred();let renewSignal;const f=fixture({respond:(_s,r,signal)=>{if(r.action==='renew'){renewSignal=signal;return held.promise;}}});await f.open();const sequence=f.client.sequence,claim=f.client.claim,pending=f.client.heartbeat();await f.client.heartbeat();await f.tick(1000);await pending;assert(renewSignal.aborted);assert.equal(f.client.phase,'ready');assert.notEqual(f.client.claim.lease_id,claim.lease_id);assert.equal(f.client.sequence,sequence);assert.equal(f.presented,1);assert.equal(f.hidden,1);held.resolve({ok:true,value:{selection_status:{document_id:'wrong-old-card',revision:99}}});await flush();assert.equal(f.client.selectionStatus.document_id,'synthetic-card');await f.client.close();
});
test('late acquire cannot replace the new claim and is released by its exact page/lease identity',async()=>{
 const held=deferred();let first=true,oldSignal;const f=fixture({respond:(_s,r,signal)=>{if(r.action==='acquire'&&first){first=false;oldSignal=signal;return held.promise;}}});const opening=f.open();await flush();const firstPage=f.acquires()[0].page_id;await f.tick(1000);await opening;assert(oldSignal.aborted);assert.equal(f.client.phase,'error');await f.tick(1000);assert.equal(f.client.phase,'ready');const current=f.client.claim;assert.notEqual(f.acquires()[1].page_id,firstPage);held.resolve({ok:true,value:{page_id:firstPage,lease_id:'late-old-lease',agent_generation:'old'}});await flush();assert.equal(f.client.claim,current);assert(f.releases().some(r=>r.claim.lease_id==='late-old-lease'&&r.claim.page_id===firstPage));await f.client.close();
});
test('late capabilities after timeout cannot revive a superseded epoch or promote scope',async()=>{
 const held=deferred();let first=true;const f=fixture({respond:(_s,r)=>{if(r.action==='capabilities'&&first){first=false;return held.promise;}}});const opening=f.open();await flush();await f.tick(1000);await opening;await f.tick(1000);assert.equal(f.client.phase,'ready');const claim=f.client.claim;held.resolve({ok:true,value:{authoring_scope:{mode:'full',epoch:99},tools:[{name:'unwanted'}]}});await flush();assert.equal(f.client.claim,claim);assert.equal(f.client.authoringScope.mode,'content');assert.equal(f.shown.length,1);await f.client.close();
});
test('Session switch cancels hung renew; old responses cannot overwrite the replacement Session',async()=>{
 const held=deferred();const f=fixture({respond:(session,r)=>session==='synthetic-session-A'&&r.action==='renew'?held.promise:undefined});await f.open();const pending=f.client.heartbeat();await f.client.transition({...f.row,id:'synthetic-session-B'});await pending;assert.equal(f.client.current.id,'synthetic-session-B');const claim=f.client.claim;held.resolve({ok:false,error:{code:'STALE_WORKSPACE',message:'old'}});await flush();assert.equal(f.client.claim,claim);assert.equal(f.client.phase,'ready');await f.client.close();
});
test('close aborts permanently inflight lifecycle work and leaves no retry or heartbeat timers',async()=>{
 const held=deferred();const f=fixture({respond:(_s,r)=>r.action==='renew'?held.promise:undefined});await f.open();const pending=f.client.heartbeat();await f.client.close();await pending;assert.equal(f.client.phase,'inactive');assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);held.resolve({ok:false,error:{code:'STALE_WORKSPACE',message:'old'}});await flush();assert.equal(f.acquires().length,1);
});
test('stale write errors invalidate ready state, recover, and never replay the card write',async()=>{
 const f=fixture({respond:(_s,r)=>r.action==='patch'?{ok:false,error:{code:'STALE_WORKSPACE',message:'expired'}}:undefined});await f.open();await assert.rejects(f.client.call('patch',{document_id:'synthetic-card',expected_revision:7}),e=>e.code==='STALE_WORKSPACE');assert.equal(f.client.phase,'error');await f.tick(1000);assert.equal(f.client.phase,'ready');assert.equal(f.calls.filter(r=>r.action==='patch').length,1);assert.equal(f.client.sequence,1);await f.client.close();
});
test('unknown handoff receipt retains request identity and never automatically opens or resends a Run',async()=>{
 const starts=[];const f=fixture({sendScean:async(_s,r)=>{starts.push(r);throw Error('response lost after admission');}});await f.open();const request={mode:'start',request_id:'synthetic-request-identity',document_id:'synthetic-card',expected_revision:7};await assert.rejects(f.client.sceanControl(request),e=>e.code==='HANDOFF_UNCONFIRMED'&&e.details.request_id===request.request_id);await f.tick(1000);assert.equal(f.client.phase,'ready');assert.equal(starts.length,1);await assert.rejects(f.client.sceanControl(request),e=>e.code==='HANDOFF_UNCONFIRMED');assert.equal(starts[1].request_id,starts[0].request_id);assert.equal(starts[1].expected_revision,7);await f.client.close();
});
test('known pre-admission lease refusal does not claim an unknown commit and does not resend',async()=>{
 let count=0;const f=fixture({sendScean:async()=>{count++;return{ok:false,error:{code:'STALE_LEASE',message:'old lease'}};}});await f.open();await assert.rejects(f.client.sceanControl({mode:'start',request_id:'synthetic-id'}),e=>e.code==='STALE_LEASE');await f.tick(1000);assert.equal(count,1);await f.client.close();
});
test('archived Session is not repeatedly reacquired; explicit restoration/retry must pass Host admission',async()=>{
 let archived=true;const f=fixture({respond:(_s,r)=>r.action==='acquire'&&archived?{ok:false,error:{code:'SESSION_ARCHIVED',message:'archived'}}:undefined});await f.open();assert.equal(f.client.blocked,true);await f.client.resume();await f.tick(120000);assert.equal(f.acquires().length,1);archived=false;await f.client.retry();assert.equal(f.client.phase,'ready');await f.client.close();
});
test('expired local lease blocks writes immediately, before any RPC or story mutation',async()=>{
 const f=fixture();await f.open();await f.tick(90001);await assert.rejects(f.client.call('patch',{expected_revision:7}),e=>e.code==='STUDIO_RECONNECTING');assert.equal(f.calls.filter(r=>r.action==='patch').length,0);assert.notEqual(f.client.phase,'ready');await f.client.resume();assert.equal(f.client.phase,'ready');await f.client.close();
});
test('a retired view cannot send a handoff and is not mislabeled as an unknown commit',async()=>{
 let count=0;const f=fixture({sendScean:async()=>{count++;return{ok:true,value:{}};}});await f.open();const sequence=f.client.sequence;await f.client.transition({...f.row,id:'synthetic-session-B'});await assert.rejects(f.client.sceanControl({mode:'start',request_id:'synthetic-id'},sequence),e=>e.code==='CONNECTION_SUPERSEDED');assert.equal(count,0);await f.client.close();
});
test('a known old-lease scope receipt remains a receipt but cannot overwrite the recovered scope projection',async()=>{
 const ack=deferred(),f=fixture();f.client.sendScope=()=>ack.promise;await f.open();const old=f.client.claim,pending=f.client.setAuthoringScope('full');f.client.lost(Object.assign(Error('synthetic lease loss'),{code:'STALE_LEASE'}),old);await f.client.resume();assert.equal(f.client.authoringScope.mode,'content');ack.resolve({ok:true,value:{authoring_scope:{mode:'full',epoch:3}}});assert.equal((await pending).mode,'full');assert.equal(f.client.authoringScope.mode,'content');await f.client.close();
});

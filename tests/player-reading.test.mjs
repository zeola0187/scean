import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as model from '../isolated/web/view-model.mjs';
import {HistorySync} from '../isolated/web/history-sync.mjs';
import {mountTurnDuration} from '../isolated/web/turn-duration.mjs';
import {captureReadingAnchor,restoreReadingAnchor} from '../isolated/web/reading-layout.mjs';
import {showNotificationToast} from '../isolated/web/notifications.mjs';
import {mountAgentModels} from '../isolated/web/agent-models-ui.mjs';
import {mountTimeConfirmation} from '../isolated/web/time-confirmation-ui.mjs';

const source=await readFile(new URL('../isolated/web/app.mjs',import.meta.url),'utf8');
const run=(version,head,id='synthetic-run')=>({runId:id,version,head,turnCount:version,snapshot:{hash:'synthetic-snapshot'},state:{world:{}},lastTurn:{commitId:head,requestId:'own-request'},lastFailure:null});
const page=(version,head,ids,id='synthetic-run')=>({runId:id,version,head,turns:ids.map((commitId,i)=>({turn:i+1,commitId,input:'Synthetic action',body:'Synthetic body'})),hasMore:false,beforeCursor:null});
const receipt=(version,head)=>({runId:'synthetic-run',kind:'turn',status:'committed',pending:false,canonical:{version,head}});
function fixture({follow=true}={}){
 const elements=new Map(),calls=[],storage=new Map();let handler,ends=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,textContent:'',disabled:false,dataset:{},style:{},files:[],children:[],classList:{add(){},toggle(){}},setAttribute(){},removeAttribute(){},append(){},before(){},after(){},remove(){},querySelectorAll(){return [];},replaceChildren(){},addEventListener(){},close(){},focus(){}});return elements.get(id);};
 const reading={scrollTop:20,scrollHeight:1000,clientHeight:500,isConnected:false,getBoundingClientRect:()=>({top:0,bottom:500}),addEventListener(){}};
 const noop=()=>{},module=()=>({update:noop,reset:noop,dispose:noop});
 const context={...model,HistorySync,captureReadingAnchor,restoreReadingAnchor,crypto:webcrypto,isSecureContext:true,performance:{getEntriesByType:()=>[]},AbortController,DOMException,console,setTimeout,clearTimeout,setInterval(){},URL,Blob,
 document:{getElementById:element,createElement:tag=>element('created-'+elements.size+'-'+tag),querySelector:()=>element('queried'),querySelectorAll:()=>[],visibilityState:'visible',addEventListener(){}},window:{addEventListener(){}},sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
 createNotificationClient:()=>({watch:async()=>{},refresh(){},dispose(){}}),mountNotificationControls:()=>({render(){}}),showNotificationToast(){},mountPlayerIdeas:module,mountPlayerReaders:module,mountWorldRoutineReaders:module,renderDialogueBody:(el,item)=>{el.textContent=item.body;return {status:'neutral'};},mountRunRecycle:()=>({update(){},reset(){},addAction(){},lookup(){}}),mountPresentationPanel:module,
 mountPlayerShell:()=>({placeRecycle(){},setNavigation(){},story(){},show(){},committed(){},atEnd:()=>follow,reading,scrollEnd(){ends++;}}),mountStudio(){},mountCardFrontend:()=>({clear:noop,update:noop,history:noop,heartbeat:noop}),mountChapterSettings:()=>({refresh:noop}),mountWritingMode:()=>({select:noop}),mountProseStyle:()=>({select:noop}),mountPlayerIdentity:()=>({isBusy:()=>false,update:noop,refreshDefaults:noop}),mountOpeningSelection:()=>({setRun:noop,reset:noop,refresh:async()=>false}),fetch:()=>{throw Error('OFFLINE_ONLY');}};
 context.mountTurnDuration=options=>mountTurnDuration({...options,now:()=>0,interval:()=>0,clear(){}});
 context.mountAgentModels=options=>mountAgentModels({...options,document:context.document});
 context.mountTimeConfirmation=options=>mountTimeConfirmation({...options,document:context.document});
 vm.createContext(context);vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/^init\(\);\s*$/m,'')+`
 refreshNarrative=async()=>{};refreshModels=async()=>{};refreshRuns=async()=>{};
 renderRun=run=>{state.run=run;historySync.want(run);};renderChat=()=>{};
 globalThis.client={state,view,reconcile,poll,loadHistory,historySync,
  getHistory:()=>loadedTurns,getOwn:()=>submissionReading,getEpoch:()=>userScrollEpoch,async submitProbe({historical=false,duringSave=()=>{}}={}){historySync.historical=historical;state.draft=null;$('input').value='Synthetic input';saveDraft=async()=>{state.draft={input:'Synthetic input',requestId:'own-request'};await duringSave();};sendHostOperation=async()=>{};await submitTurn();},setApi(fn){api=fn;},ready(){initialized=true;},
  seed(run,page){view.select(run.runId);pageSerial++;state.run=run;loadedTurns=page.turns;historyPageState=page;historySync.reset();historySync.want(run);historySync.loaded(page);},
  own(){submissionReading={runId:view.runId,requestId:'own-request',scrollEpoch:userScrollEpoch,canLocate:true};},moved(){userScrollEpoch++;},nextPoll(){state.nextPollAt=0;historySync.retryAt=0;}};`,context);
 context.client.setApi(async(action,payload)=>{calls.push({action,payload});return handler(action,payload);});context.client.ready();context.client.seed(run(1,'c1'),page(1,'c1',['c1']));
 return {client:context.client,calls,element,reading,get ends(){return ends;},setApi(fn){handler=fn;}};
}
function latest(f,history){f.setApi(async(action,args)=>action==='runView'?run(2,'c2'):action==='operationStatus'?receipt(2,'c2'):action==='progress'?{runId:'synthetic-run',pending:false,canonical:{version:2,head:'c2'}}:action==='presentation'?{presentationRevision:0}:action==='historyPage'?history(args):Promise.reject(Error('Unexpected '+action)));}

test('saved canonical and loaded body acknowledge separately; failed read recovers by idle read-only poll without notification',async()=>{
 const f=fixture();let n=0;latest(f,()=>{if(!n++)throw Object.assign(Error('synthetic timeout'),{code:'CONNECTION_UNKNOWN'});return page(2,'c2',['c1','c2']);});
 await f.client.reconcile();assert.equal(f.client.state.run.head,'c2');assert.equal(f.client.historySync.loadedHead,'c1');assert(f.client.historySync.dirty);
 f.client.nextPoll();await f.client.poll();assert.equal(f.client.historySync.loadedHead,'c2');assert(!f.client.historySync.dirty);assert.equal(f.ends,0);
 assert(f.calls.every(r=>!['turn','regenerate','operationSubmit'].includes(r.action)));
});
test('stale head and version page responses remain dirty and a later read fixes them',async()=>{
 for(const stale of [page(1,'c1',['c1']),page(1,'c2',['c1','c2'])]){
  const f=fixture();let n=0;latest(f,()=>n++?page(2,'c2',['c1','c2']):stale);await f.client.reconcile();assert.equal(f.client.getHistory().at(-1).commitId,'c1');assert(f.client.historySync.dirty);f.client.nextPoll();await f.client.poll();assert.equal(f.client.getHistory().at(-1).commitId,'c2');
 }
});
test('intentional old-history page is current for its canonical head; no forced latest reload or scrolling',async()=>{
 const f=fixture({follow:false});latest(f,args=>args.anchorCommitId==='c1'?page(2,'c2',['c1']):page(2,'c2',['c1','c2']));await f.client.reconcile();
 assert.equal(f.client.getHistory().at(-1).commitId,'c1');assert(f.client.historySync.historical);assert(f.client.historySync.newAvailable);assert(!f.client.historySync.dirty);assert.equal(f.ends,0);
 f.client.nextPoll();await f.client.poll();assert.equal(f.calls.filter(r=>r.action==='historyPage').length,1);
});
test('old response after switching Run cannot replace selected history or clear its dirty acknowledgement',async()=>{
 const f=fixture();let done;latest(f,()=>new Promise(r=>done=r));const waiting=f.client.reconcile();while(!done)await new Promise(r=>setImmediate(r));
 f.client.seed(run(1,'other','other-run'),page(1,'other',['other'],'other-run'));done(page(2,'c2',['c1','c2']));await waiting;
 assert.equal(f.client.state.run.runId,'other-run');assert.equal(f.client.getHistory()[0].commitId,'other');assert.equal(f.client.historySync.runId,'other-run');
});
test('own submitted player line becomes the start anchor; manual movement during the read suppresses relocation',async()=>{
 for(const moved of [false,true]){
  const f=fixture();f.client.own();f.element('chat').querySelectorAll=selector=>selector.includes('.player')?[{dataset:{commitId:'c2'},classList:{add(){}},getBoundingClientRect:()=>({top:120})}]:[];
  latest(f,()=>{if(moved){f.client.moved();f.reading.scrollTop=61;}return page(2,'c2',['c1','c2']);});await f.client.reconcile();
  assert.equal(f.reading.scrollTop,moved?61:124);assert.equal(f.ends,0);
 }
});
test('only explicit latest action scrolls to story end; notification/reference locates player turn beginning',async()=>{
 const f=fixture();latest(f,()=>page(2,'c2',['c1','c2']));await f.client.reconcile();await f.client.loadHistory({latest:true});assert.equal(f.ends,1);await f.client.loadHistory({anchorCommitId:'c2'});assert.equal(f.ends,1);
});
test('history read backoff is bounded, successful read alone clears dirty, historical pages are legitimate',()=>{
 let now=0;const sync=new HistorySync({now:()=>now});sync.want(run(2,'c2'));sync.failed();assert(!sync.due());now=1000;assert(sync.due());assert(!sync.loaded(page(1,'c1',['c1'])));assert(sync.dirty);assert(sync.loaded(page(2,'c2',['c1']),{historical:true}));assert(sync.newAvailable);assert(!sync.dirty);
 for(let i=0;i<20;i++)sync.failed();assert.equal(sync.retryAt-now,30000);
});

function toastFixture(){
 let now=0,seq=0;const nodes=new Map(),timers=new Map(),listeners=new Map();
 const make=tag=>({tag,children:[],style:{},listeners:new Map(),setAttribute(){},append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},addEventListener(k,fn){this.listeners.set(k,fn);},removeEventListener(k){this.listeners.delete(k);},remove(){nodes.delete(this.id);this.removed=true;},contains(){return false;}});
 const doc={visibilityState:'visible',getElementById:id=>nodes.get(id),createElement:make,body:{append(n){nodes.set(n.id,n);}},addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k){listeners.delete(k);}};
 const env={document:doc,now:()=>now,setTimer(fn,ms){const id=++seq;timers.set(id,{fn,at:now+ms});return id;},clearTimer(id){timers.delete(id);}};
 return {doc,env,timers,nodes,advance(ms){now+=ms;for(const[id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},emit(k){listeners.get(k)?.();},get region(){return nodes.get('scean-save-toast');}};
}
test('successful toast counts six visible seconds; hover/focus/hidden pause without losing View',()=>{
 for(const paused of ['pointerenter','focusin','hidden']){
  const f=toastFixture();showNotificationToast({message:'saved',success:true,open(){}},f.env);f.advance(2000);
  if(paused==='hidden'){f.doc.visibilityState='hidden';f.emit('visibilitychange');}else f.region.listeners.get(paused)();
  f.advance(20000);assert(f.region);assert.equal(f.region.children.filter(x=>x.tag==='button')[0].textContent,'查看');
  if(paused==='hidden'){f.doc.visibilityState='visible';f.emit('visibilitychange');}else f.region.listeners.get(paused==='pointerenter'?'pointerleave':'focusout')({});
  f.advance(3999);assert(f.region);f.advance(1);assert(!f.region);
 }
});
test('error/unknown/action toast stays open, old timer cannot remove its replacement, scope clearing removes hooks',()=>{
 const f=toastFixture();showNotificationToast({message:'saved',success:true},f.env);const old=[...f.timers.values()][0].fn;
 showNotificationToast({message:'requires action',open(){},requiresAction:true},f.env);old();f.advance(60000);assert(f.region);
 showNotificationToast({message:'failure',success:true,error:true},f.env);assert.equal(f.timers.size,0);
 showNotificationToast({clear:true},f.env);assert(!f.region);assert.equal(f.timers.size,0);
});

test('fresh-page submit intent survives late layout and keeps the epoch from before draft persistence',async()=>{
 const fresh=fixture({follow:false});await fresh.client.submitProbe();assert.equal(fresh.client.getOwn().canLocate,true);
 const old=fixture({follow:false});await old.client.submitProbe({historical:true});assert.equal(old.client.getOwn().canLocate,false);
 const moved=fixture({follow:false});await moved.client.submitProbe({duringSave:()=>moved.client.moved()});assert.equal(moved.client.getOwn().scrollEpoch,0);assert.equal(moved.client.getEpoch(),1);
});

test('native parent toast can stay above the input area without inheriting iframe composer geometry',()=>{
 const f=toastFixture();showNotificationToast({message:'saved',success:true,placement:'top'},f.env);assert.equal(f.region.style.bottom,'auto');assert(f.region.style.top.includes('12px'));
 showNotificationToast({message:'saved',success:true},f.env);assert.equal(f.region.style.top,'auto');assert(f.region.style.bottom.includes('--scean-composer-height'));
});

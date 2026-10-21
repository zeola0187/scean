import {mountWritingMode} from '../isolated/web/writing-mode-ui.mjs';
import {mountProseStyle} from '../isolated/web/prose-style-ui.mjs';
import {mountPlayerIdentity} from '../isolated/web/player-identity-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import * as model from '../isolated/web/view-model.mjs';
import {createNativeBridge} from '../plugin/player-native-bridge.mjs';
import {nativeFrameBootstrap} from '../plugin/native-frame-source.mjs';
import {mountCardFrontend} from '../isolated/web/card-frontend.mjs';
import {mountChapterSettings} from '../isolated/web/chapter-settings-ui.mjs';
import {mountOpeningSelection} from '../isolated/web/opening-selection-ui.mjs';
import {captureReadingAnchor,restoreReadingAnchor} from '../isolated/web/reading-layout.mjs';

// Execute the actual shared app against a deterministic DOM/transport. The
// lifecycle functions, epoch guards and journal reads are not test copies.
const source=await readFile(new URL('../isolated/web/app.mjs',import.meta.url),'utf8');
const nativeFactorySource=await readFile(new URL('../plugin/native-client-source.mjs',import.meta.url),'utf8');
function fixture({secure=true,crypto=webcrypto,navigationType='navigate',priorViewer}={}){
  let targetResolver=async()=>null;
  const elements=new Map(),listeners=new Map(),storage=new Map(priorViewer?[['scean-draft-viewer',priorViewer]]:[]),windowListeners=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,value:'',checked:false,hidden:false,disabled:false,textContent:'',dataset:{},style:{},open:false,files:[],children:[],classList:{add(){},toggle(){}},setAttribute(){},removeAttribute(){},before(){},after(){},remove(){},querySelectorAll(){return [];},replaceChildren(){},append(){},close(){},focus(){},addEventListener(event,fn){listeners.set(`${id}:${event}`,fn);}});
    return elements.get(id);
  };
  const context={...model,captureReadingAnchor,restoreReadingAnchor,crypto,isSecureContext:secure,performance:{getEntriesByType:()=>[{type:navigationType}]},AbortController,DOMException,console,setTimeout,clearTimeout,setInterval(){},URL,Blob,
    document:{getElementById:element,createElement:tag=>element('generated-'+elements.size+'-'+tag),querySelector(){return element('queried-label');},querySelectorAll(){return [];},visibilityState:'visible',addEventListener(event,fn){listeners.set(event,fn);}},
    window:{addEventListener(event,fn){windowListeners.set(event,fn);}},
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    createNotificationClient:()=>({watch:async()=>{},refresh(){},dispose(){},target:eventId=>targetResolver(eventId)}),mountNotificationControls:()=>({render(){}}),showNotificationToast(){},
    mountPlayerShell:()=>({show(){},committed(){},atEnd:()=>false,reading:{scrollTop:0,scrollHeight:100,getBoundingClientRect:()=>({top:0,bottom:100})},scrollEnd(){}}),mountStudio(){}};
  context.mountCardFrontend=()=>mountCardFrontend({document:context.document,setTimer:()=>0,clearTimer(){}});
  context.mountChapterSettings=options=>mountChapterSettings({...options,document:context.document});
  context.mountWritingMode=options=>mountWritingMode({...options,document:context.document,makeId:()=>webcrypto.randomUUID()});
  context.mountProseStyle=options=>mountProseStyle({...options,document:context.document,makeId:()=>webcrypto.randomUUID()});
  context.mountPlayerIdentity=options=>mountPlayerIdentity({...options,document:context.document,makeId:()=>webcrypto.randomUUID()});
  context.mountOpeningSelection=options=>mountOpeningSelection({...options,document:context.document});
  vm.createContext(context);
  const executable=source.replace(/^import .*;\r?\n/gm,'').replace(/^init\(\);\s*$/m,'');
  vm.runInContext(executable+`\nconst actualReads={loadHistory,refreshNarrative,refreshChapters,loadInspector};const derivedResults={};const historyCalls=[];loadHistory=async options=>{historyCalls.push(options);};refreshNarrative=async()=>{};renderNarrative=value=>{derivedResults.narrative=value;};renderChapterIndex=value=>{derivedResults.chapters=value;};renderChat=()=>{};refreshModels=async()=>{};refreshRuns=async()=>{};renderRun=run=>{state.run=run;};globalThis.client={state,view,operations,outstandingOperations,viewerId,selectRun,reconcile,openNotificationTarget,actualReads,derivedResults,historyCalls,getHistory:()=>loadedTurns,sendHostOperation,submitTurn,poll,observeOperation,operationText,init,setApi(fn){api=fn;},ready(){initialized=true;},select(runId){view.select(runId);state.run={runId,version:1,head:null,turnCount:0,snapshot:{}};}};`,context);
  return {...context,client:context.client,element,storage,listeners,windowListeners,setTarget(fn){targetResolver=fn;}};
}
const failure=()=>Object.assign(new Error('Synthetic disconnected transport'),{code:'CONNECTION_UNKNOWN'});
const run=(runId='run-a',version=1,head=null)=>({runId,version,head,turnCount:head?1:0,snapshot:{},state:{world:{}},lastFailure:null});
const receipt=(overrides={})=>({runId:'run-a',operationId:'host-job',requestId:'request-a',kind:'turn',status:'committed',pending:false,canonical:{version:2,head:'commit-a'},...overrides});
const emptyProgress={runId:'run-a',pending:false,status:'not_recorded',events:[]};

test('unknown admission keeps its original identity locked and recovery never submits a second model job',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.ready();let online=false;const calls=[];
  client.setApi(async(action,payload)=>{
    calls.push({action,payload});if(!online)throw failure();
    if(action==='operationStatus')return receipt({operationId:payload.operationId});
    if(action==='runView')return {...run('run-a',2,'commit-a'),requestReceipt:{requestId:'request-a',status:'committed',commitId:'commit-a',active:true}};
    return emptyProgress;
  });
  f.element('input').value='Synthetic action';client.state.draft={input:'Synthetic action',requestId:'request-a'};
  await client.sendHostOperation('turn',{input:'Synthetic action',requestId:'request-a'});
  const first=calls.find(c=>c.action==='operationSubmit').payload;
  assert.equal(client.state.pending,true);assert.equal(client.state.operationUnknown,true);
  assert.equal(client.outstandingOperations.get('run-a').operationId,first.operationId);
  await client.submitTurn();assert.equal(calls.filter(c=>c.action==='operationSubmit').length,1);
  online=true;await client.poll({force:true});
  assert.equal(client.state.pending,false);assert.equal(client.state.operationUnknown,false);assert.equal(client.state.run.version,2);
  assert.equal(client.outstandingOperations.size,0);assert.equal(client.state.draft,null);
  assert.equal(calls.filter(c=>c.action==='operationSubmit').length,1);
  assert(calls.filter(c=>c.action==='operationStatus').every(c=>c.payload.operationId===first.operationId));
  const persisted=f.storage.get('scean-outstanding-operations');assert(!persisted.includes('Synthetic action'));
});

test('idle canonical polling discovers another browser commit without ever seeing pending',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.ready();let views=0;
  f.element('input').value='Local unfinished input';client.state.draft={input:'Local unfinished input',requestId:'local-input'};
  client.setApi(async action=>{
    if(action==='operationStatus')return receipt();if(action==='progress')return emptyProgress;
    if(action==='runView'){views++;return run('run-a',2,'commit-a');}throw new Error(action);
  });
  await client.poll();assert.equal(views,1);assert.equal(client.state.run.head,'commit-a');
  assert.equal(f.element('input').value,'Local unfinished input');assert.equal(client.state.draft.requestId,'local-input');
});

test('same-Run reconcile v2 delayed behind a completed v3 read cannot render v3 back to v2',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');let round=0,releaseV2;
  client.setApi(async action=>{
    if(action==='runView'){round++;return round===1?new Promise(resolve=>releaseV2=resolve):run('run-a',3,'commit-3');}
    const version=round===1?2:3,canonical={version,head:`commit-${version}`};
    if(action==='operationStatus')return receipt({operationId:`job-${version}`,status:'failed',canonical});
    return {...emptyProgress,canonical};
  });
  const older=client.reconcile(),newer=client.reconcile();await newer;
  assert.equal(client.state.run.version,3);assert.equal(client.state.lastOperation.operationId,'job-3');
  releaseV2(run('run-a',2,'commit-2'));await older;
  assert.equal(client.state.run.version,3);assert.equal(client.state.run.head,'commit-3');assert.equal(client.state.lastOperation.operationId,'job-3');
});

test('an older rejected canonical read cannot report an error after a newer same-Run read succeeds',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');let reads=0,rejectOlder;
  client.setApi(async action=>{
    if(action==='runView'){reads++;return reads===1?new Promise((resolve,reject)=>rejectOlder=reject):run('run-a',3,'commit-3');}
    return action==='operationStatus'?receipt({canonical:{version:3,head:'commit-3'}}):emptyProgress;
  });
  const older=client.reconcile();await client.reconcile();rejectOlder(failure());await older;
  assert.equal(client.state.run.version,3);assert.equal(f.element('turn-error').hidden,true);
});

test('polling retains bounded failure backoff when its nested canonical reconciliation fails',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.ready();
  client.setApi(async action=>{
    if(action==='runView')throw failure();
    return action==='operationStatus'?receipt({canonical:{version:3,head:'commit-3'}}):emptyProgress;
  });
  const before=Date.now();await client.poll();assert.equal(client.state.pollFailures,1);assert.equal(client.state.disconnected,true);assert(client.state.nextPollAt-before>=1900);
});

test('a later read still cannot lower the displayed version or change its head at the same version',async()=>{
  for(const [version,head] of [[2,'commit-2'],[3,'wrong-head']]){
    const f=fixture(),{client}=f;client.select('run-a');client.state.run=run('run-a',3,'commit-3');let reads=0;
    f.element('input').value='Preserved local draft';client.state.draft={input:'Preserved local draft',requestId:'local'};
    client.setApi(async action=>{
      if(action==='runView'){reads++;return run('run-a',version,head);}
      if(action==='operationStatus')return receipt({canonical:{version,head}});
      if(action==='progress')return {...emptyProgress,canonical:{version,head}};
      assert.fail('recovery must only read');
    });
    await client.reconcile();assert.equal(reads,3);assert.equal(client.state.run.version,3);assert.equal(client.state.run.head,'commit-3');
    assert.equal(client.state.draft.requestId,'local');assert.equal(f.element('input').value,'Preserved local draft');assert.match(f.element('turn-error').textContent,/CANONICAL_READ_INCONSISTENT/);
  }
});

test('mixed Run/receipt/progress snapshots are reread before clearing an input, receipt identity or pending lock',async()=>{
  for(const mismatched of ['receipt','progress']){
    const f=fixture(),{client}=f;client.select('run-a');let reads=0,releaseConsistent;
    const operation={...client.operations.start('run-a','request-a',()=> 'owned-job'),kind:'turn'};
    client.state.pending=true;client.state.localTurn=operation;client.outstandingOperations.set('run-a',operation);
    client.state.draft={input:'Unconfirmed input',requestId:'request-a'};f.element('input').value='Unconfirmed input';
    client.setApi(async action=>{
      if(action==='runView'){reads++;return reads===1?run('run-a',2,'commit-2'):new Promise(resolve=>releaseConsistent=resolve);}
      const version=reads===1?(mismatched===action.replace('operationStatus','receipt')?3:2):3;
      if(action==='operationStatus')return receipt({operationId:'owned-job',canonical:{version,head:`commit-${version}`}});
      if(action==='progress')return {...emptyProgress,canonical:{version,head:`commit-${version}`}};
      assert.fail(action);
    });
    const loading=client.reconcile();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,2);assert.equal(client.state.run.version,1);assert.equal(client.state.pending,true);assert.equal(client.state.draft.requestId,'request-a');assert.equal(client.outstandingOperations.size,1);
    releaseConsistent({...run('run-a',3,'commit-3'),requestReceipt:{requestId:'request-a',status:'committed',commitId:'commit-3',active:true}});await loading;
    assert.equal(client.state.run.version,3);assert.equal(client.state.pending,false);assert.equal(client.state.draft,null);assert.equal(client.outstandingOperations.size,0);
  }
});

test('initial selectRun v2 cannot overwrite a newer same-selection reconcile v3 or restore its old draft',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.state.pending=true;let round=0,releaseV2;
  client.setApi(async(action,payload)=>{
    if(action==='runView'){round++;return round===1?new Promise(resolve=>releaseV2=resolve):run('run-b',3,'commit-3');}
    const version=round===1?2:3,canonical={version,head:`commit-${version}`};
    if(action==='draftGet')return {input:version===2?'Old draft':'New draft',requestId:version===2?'old-draft':'new-draft'};
    if(action==='operationStatus')return receipt({runId:payload.runId,canonical});
    return {...emptyProgress,runId:payload.runId,canonical};
  });
  const selecting=client.selectRun('run-b');await client.reconcile();assert.equal(client.state.run.version,3);assert.equal(client.state.draft.requestId,'new-draft');
  releaseV2(run('run-b',2,'commit-2'));await selecting;
  assert.equal(client.state.run.version,3);assert.equal(client.state.draft.requestId,'new-draft');assert.equal(f.element('input').value,'New draft');
});

test('delayed dependent history/chapter/Inspector reads cannot install data from an older canonical head',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.state.run=run('run-a',3,'commit-3');
  f.element('inspector').open=true;
  client.setApi(async action=>action==='historyPage'?{runId:'run-a',head:'commit-2',turns:[{turn:1,commitId:'retired',body:'Old body'}],hasMore:false}:{...run('run-a',2,'commit-2'),chapters:[],summaries:[]});
  await client.actualReads.loadHistory();await client.actualReads.refreshChapters();await client.actualReads.loadInspector();
  assert.equal(client.getHistory().length,0);assert.equal(client.derivedResults.chapters,undefined);assert(!f.element('inspection').textContent.includes('commit-2'));
  let release;client.state.run=run('run-a',2,'commit-2');client.setApi(()=>new Promise(resolve=>release=resolve));
  const history=client.actualReads.loadHistory();client.state.run=run('run-a',3,'commit-3');
  release({runId:'run-a',head:'commit-2',turns:[{turn:1,commitId:'old'}],hasMore:false});await history;assert.equal(client.getHistory().length,0);
});

test('unversioned narrative status is displayed only when a following canonical check still matches the Run',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.state.run=run('run-a',2,'commit-2');const calls=[];
  client.setApi(async action=>{calls.push(action);return action==='summaryStatus'?{summaries:[{id:'stale'}]}:receipt({canonical:{version:3,head:'commit-3'}});});
  await client.actualReads.refreshNarrative();assert.equal(client.derivedResults.narrative,undefined);assert.deepEqual(calls,['summaryStatus','operationStatus']);
});

test('a notification target resolving after user navigation cannot select its older Run',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');let release;
  f.setTarget(()=>new Promise(resolve=>release=resolve));client.setApi(()=>assert.fail('stale notification must not start selection'));
  const target={eventId:'event-a',runId:'run-a',commitId:'commit-a'},opening=client.openNotificationTarget(target);
  client.select('run-b');release(target);await opening;assert.equal(client.view.runId,'run-b');assert.equal(client.historyCalls.length,0);
});

test('a notification selection superseded by another Run cannot load its anchor into the new Run',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.state.pending=true;let release;
  const target={eventId:'event-b',runId:'run-b',commitId:'commit-b'};f.setTarget(async()=>target);
  client.setApi(async(action,payload)=>{
    if(action==='runView')return new Promise(resolve=>release=resolve);
    if(action==='draftGet')return {input:''};
    return action==='operationStatus'?receipt({runId:payload.runId,canonical:{version:2,head:'commit-b'}}):{...emptyProgress,runId:payload.runId};
  });
  const opening=client.openNotificationTarget(target);await new Promise(resolve=>setImmediate(resolve));client.select('run-c');
  release(run('run-b',2,'commit-b'));await opening;assert.equal(client.view.runId,'run-c');assert.equal(client.historyCalls.length,0);
});

test('Run navigation detaches accepted turn and narrative work without any cancellation request',async()=>{
  for(const kind of ['turn','summaryStart','chapterSummarize']){
    const f=fixture(),{client}=f;client.select('run-a');client.state.pending=true;
    client.operations.start('run-a','q',()=> 'background-job');client.state.localTurn={runId:'run-a',operationId:'background-job',kind};
    client.observeOperation(receipt({kind,operationId:'background-job',pending:true,status:'running'}),emptyProgress);
    const calls=[];client.setApi(async(action,payload)=>{calls.push(action);if(action==='runView')return run(payload.runId);if(action==='draftGet')return {input:''};if(action==='operationStatus')return receipt({runId:payload.runId,operationId:null,requestId:null,kind:null,status:'not_recorded',canonical:{version:1,head:null}});return {...emptyProgress,runId:payload.runId};});
    await client.selectRun('run-b');assert.equal(client.view.runId,'run-b');assert(!calls.some(action=>/cancel/i.test(action)),kind);
    assert.equal(client.state.pending,false);
  }
});

test('a delayed admission response cannot mutate a different Run or a fresh selection of the same Run',async()=>{
  for(const next of ['run-b','run-a']){
    const f=fixture(),{client}=f;client.select('run-a');let release;
    client.setApi(async action=>action==='operationSubmit'?new Promise(resolve=>release=resolve):assert.fail('stale callback must not reconcile'));
    const pending=client.sendHostOperation('turn',{input:'Synthetic',requestId:'q'});
    await new Promise(resolve=>setImmediate(resolve));client.select(next);client.state.pending=false;client.state.submitting=false;client.state.localTurn=null;
    release(receipt({status:'accepted',pending:true}));await pending;
    assert.equal(client.state.run.runId,next);assert.equal(client.state.pending,false);assert.equal(client.state.run.version,1);
  }
});

test('definitive not_found releases only the matching recovery identity, while another browser pending job retains the lock',()=>{
  const f=fixture(),{client}=f;client.select('run-a');
  client.outstandingOperations.set('run-a',{runId:'run-a',operationId:'original',kind:'turn'});
  client.observeOperation(receipt({operationId:'different',status:'not_found'}),emptyProgress);assert.equal(client.outstandingOperations.size,1);
  client.observeOperation(receipt({operationId:'original',status:'not_found'}),{...emptyProgress,pending:true,operationId:'other-browser'});
  assert.equal(client.outstandingOperations.size,0);assert.equal(client.state.pending,true);assert.equal(client.operations.target('run-a').operationId,'other-browser');
});

test('an acknowledged same-request dedup adopts the Host operation identity for status lookup',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');const lookedUp=[];
  client.setApi(async(action,payload)=>{
    if(action==='operationSubmit')return receipt({operationId:'previous-admission',status:'failed'});
    if(action==='operationStatus'){lookedUp.push(payload.operationId);return receipt({operationId:'previous-admission',status:'failed',canonical:{version:1,head:null}});}
    return action==='runView'?run():emptyProgress;
  });
  await client.sendHostOperation('turn',{input:'Synthetic',requestId:'request-a'});
  assert.deepEqual(lookedUp,['previous-admission']);assert.equal(client.outstandingOperations.size,0);assert.equal(client.state.lastOperation.operationId,'previous-admission');
});

test('only explicit Retry after a confirmed retryable terminal receipt sends retryOf with unchanged request/input',async()=>{
  for(const explicit of [false,true]){
    const f=fixture(),{client}=f;client.select('run-a');
    f.element('input').value='Preserved failed input';client.state.draft={input:'Preserved failed input',requestId:'request-a'};
    client.state.lastOperation=receipt({operationId:'failed-job',status:'failed'});
    let submitted;
    client.setApi(async(action,payload)=>{
      if(action==='operationSubmit'){submitted=payload;return receipt({operationId:payload.operationId,status:'accepted',pending:true});}
      if(action==='operationStatus')return receipt({operationId:payload.operationId,status:'running',pending:true,canonical:{version:1,head:null}});
      if(action==='runView')return run();return emptyProgress;
    });
    await client.submitTurn(explicit);
    assert.equal(submitted.requestId,'request-a');assert.equal(submitted.input,'Preserved failed input');
    assert.equal(submitted.retryOf,explicit?'failed-job':undefined);assert.notEqual(submitted.operationId,'failed-job');
    assert.equal(submitted.viewerId,client.viewerId);assert.equal(submitted.baseVersion,1);assert.equal(submitted.baseHead,null);
  }
});

test('an old explicit cancel response cannot reconcile or release a new operation owner',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.operations.start('run-a','request-a',()=> 'old-job');
  client.state.pending=true;let release;const calls=[];
  client.setApi(async(action,payload)=>{calls.push({action,payload});return new Promise(resolve=>release=resolve);});
  const cancelling=f.listeners.get('cancel:click')();
  client.operations.start('run-a','new-request',()=> 'new-job');
  release({cancelRequested:true});await cancelling;
  assert.equal(calls.length,1);assert.equal(calls[0].action,'cancel');assert.equal(calls[0].payload.operationId,'old-job');
  assert.equal(client.operations.target('run-a').operationId,'new-job');assert.equal(client.state.pending,true);
});

test('an old submission finally cannot release a newer same-Run submission while its status read settles',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');let release;
  client.setApi(async(action,payload)=>{
    if(action==='operationSubmit')return receipt({operationId:payload.operationId,status:'accepted',pending:true});
    if(action==='runView')return new Promise(resolve=>release=resolve);
    return action==='operationStatus'?receipt():emptyProgress;
  });
  const prior=client.sendHostOperation('turn',{input:'Prior input',requestId:'request-a'});
  await new Promise(resolve=>setImmediate(resolve));
  client.state.localTurn={...client.operations.start('run-a','new-request',()=> 'new-submission'),kind:'turn'};
  client.state.submitting=true;client.state.pending=true;
  release(run());await prior;
  assert.equal(client.state.submitting,true);assert.equal(client.state.pending,true);assert.equal(client.state.localTurn.operationId,'new-submission');
});

test('offline polling uses bounded backoff; browser resume events request authoritative recovery',async()=>{
  const f=fixture(),{client}=f;client.select('run-a');client.ready();client.setApi(async()=>{throw failure();});
  for(let count=0;count<8;count++){client.state.nextPollAt=0;const before=Date.now();await client.poll();assert(client.state.nextPollAt-before<=30100);}
  assert.equal(client.state.pollFailures,6);for(const event of ['online','focus','pageshow'])assert.equal(typeof f.windowListeners.get(event),'function');
});

test('insecure contexts render an actionable error before any UUID or transport use',async()=>{
  let randomCalls=0;const f=fixture({secure:false,crypto:{randomUUID(){randomCalls++;throw new Error('must not be called');}}});
  f.client.setApi(()=>assert.fail('no transport before secure context check'));await f.client.init();
  assert.equal(randomCalls,0);assert.match(f.element('create-error').textContent,/SECURE_CONTEXT_REQUIRED/);assert.match(f.element('create-error').textContent,/HTTPS/);
});

test('reload and history restore reuse their tab draft viewer; new/duplicated navigation gets its own identity',()=>{
  const priorViewer='00000000-0000-4000-8000-000000000001';
  for(const navigationType of ['reload','back_forward'])assert.equal(fixture({navigationType,priorViewer}).client.viewerId,priorViewer);
  const fresh=fixture({navigationType:'navigate',priorViewer});assert.notEqual(fresh.client.viewerId,priorViewer);
  assert.equal(fresh.storage.get('scean-draft-viewer'),fresh.client.viewerId);
  assert.notEqual(fixture({navigationType:'reload',priorViewer:'malformed'}).client.viewerId,'malformed');
});

test('native bootstrap and context expose only the stable viewer for their authenticated Session',async()=>{
  let sessionId='session-a';const viewers=new Map([['session-a','viewer-a'],['session-b','viewer-b']]);
  const bridge=createNativeBridge({getSessionId:()=>sessionId,getViewerId:session=>viewers.get(session),selectPanel(){},call:async request=>request.action==='context'?{cardScope:{cardId:'card-'+request.sessionId}}:{}});
  assert.equal((await bridge.request('native.bootstrap')).viewerId,'viewer-a');
  assert.equal((await bridge.request('native.context')).viewerId,'viewer-a');
  sessionId='session-b';bridge.clearContext();assert.equal((await bridge.request('native.context')).viewerId,'viewer-b');
});

test('native job actions preserve authenticated Session/card scope and deny unrelated expansion',async()=>{
  const calls=[],bridge=createNativeBridge({getSessionId:()=> 'session-a',selectPanel(){},call:async request=>{calls.push(request);return request.action==='context'?{cardScope:{cardId:'card-a',generation:'context-a'}}:{};}});
  await bridge.request('native.context');
  for(const action of ['operationSubmit','operationStatus'])await bridge.request(action,{runId:'run-a',operationId:'job-a'});
  for(const request of calls.slice(1)){assert.equal(request.sessionId,'session-a');assert.equal(request.cardScope.cardId,'card-a');}
  await assert.rejects(bridge.request('fetch',{url:'http://example.invalid'}),{code:'NATIVE_ACTION_DENIED'});
  await bridge.dispose();assert.equal(calls.filter(c=>c.action==='cancel').length,0);
});

test('native presentation storage sanitizes settings, preserves saved normal and never calls Host',async()=>{
  const layoutDefaults={darkPalette:'forest',readingWidth:'wide',leftCollapsed:false,rightCollapsed:false};
  const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),stored=new Map(),writes=[];
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{stored.set(key,value);writes.push(value);}}});
  try{
    const bridge=createNativeBridge({selectPanel(){},call:()=>assert.fail('presentation is local only')});
    assert.deepEqual(await bridge.request('native.presentationGet'),{schemaVersion:1,theme:'system',readingSize:'large',...layoutDefaults,persistence:'default'});assert.equal(writes.length,0);
    stored.set('scean.presentation.v1',JSON.stringify({schemaVersion:1,theme:'dark',readingSize:'normal',unexpected:'PRIVATE'}));
    assert.deepEqual(await bridge.request('native.presentationGet'),{schemaVersion:1,theme:'dark',readingSize:'normal',...layoutDefaults,persistence:'saved'});
    await bridge.request('native.presentationSave',{schemaVersion:1,theme:'light',readingSize:'large',unexpected:'PRIVATE'});
    assert(!writes.at(-1).includes('PRIVATE'));assert.deepEqual(JSON.parse(writes.at(-1)),{schemaVersion:1,theme:'light',readingSize:'large',...layoutDefaults});
    stored.set('scean.presentation.v1',JSON.stringify({schemaVersion:1,theme:'dark',readingSize:'normal',padding:'x'.repeat(1024)}));
    assert.deepEqual(await bridge.request('native.presentationGet'),{schemaVersion:1,theme:'system',readingSize:'large',...layoutDefaults,persistence:'default'});
    stored.set('scean.presentation.v1',JSON.stringify({schemaVersion:1,theme:'dark',readingSize:'normal',padding:'字'.repeat(400)}));
    assert.deepEqual(await bridge.request('native.presentationGet'),{schemaVersion:1,theme:'system',readingSize:'large',...layoutDefaults,persistence:'default'});
    await assert.rejects(bridge.request('native.presentationSave',{schemaVersion:1,theme:'invalid',readingSize:'large'}),{code:'NATIVE_PRESENTATION_INVALID'});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage unavailable');}});
    assert.equal((await bridge.request('native.presentationGet')).persistence,'unavailable');
    assert.equal((await bridge.request('native.presentationSave',{schemaVersion:1,theme:'dark',readingSize:'large'})).persistence,'unavailable');
  }finally{if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}
});

test('native presentation environment reads parent device media without any Host RPC',async()=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'matchMedia');let dark=true;
  Object.defineProperty(globalThis,'matchMedia',{configurable:true,value:query=>{assert.equal(query,'(prefers-color-scheme: dark)');return {matches:dark};}});
  try{
    const bridge=createNativeBridge({selectPanel(){},call:()=>assert.fail('system presentation environment never contacts Host')});
    assert.deepEqual(await bridge.request('native.presentationEnvironment'),{dark:true});dark=false;
    assert.deepEqual(await bridge.request('native.presentationEnvironment'),{dark:false});
  }finally{if(prior)Object.defineProperty(globalThis,'matchMedia',prior);else delete globalThis.matchMedia;}
});

test('native presentation events accept only booleans on the dedicated parent port and replay the sanitized latest value',()=>{
  const listeners=new Map(),parent={},context={parent,DOMException,window:{addEventListener:(event,handler)=>listeners.set(event,handler),removeEventListener:event=>listeners.delete(event)}};
  vm.createContext(context);vm.runInContext(`(${nativeFrameBootstrap.toString()})();`,context);
  const native=context.__SCEAN_NATIVE__,received=[],spoofPort={start(){},postMessage(){}};
  const unsubscribe=native.onPresentation(value=>received.push(value));
  const connect=listeners.get('message');connect({source:{},data:{kind:'scean-native-connect'},ports:[spoofPort]});assert.equal(spoofPort.onmessage,undefined);
  const port={start(){},postMessage(){}};connect({source:parent,data:{kind:'scean-native-connect'},ports:[port]});
  assert.equal(listeners.has('message'),false);
  for(const dark of ['true',1,null,{},undefined])port.onmessage({data:{kind:'presentation-environment',dark}});
  assert.equal(received.length,0);
  port.onmessage({data:{kind:'presentation-environment',dark:true,privateData:'must not cross'}});
  assert.equal(received.length,1);assert.deepEqual(Object.keys(received[0]),['dark']);assert.equal(received[0].dark,true);assert.equal(Object.isFrozen(received[0]),true);
  const replay=[];const stopReplay=native.onPresentation(value=>replay.push(value));assert.equal(replay[0].dark,true);
  unsubscribe();port.onmessage({data:{kind:'presentation-environment',dark:false}});assert.equal(received.length,1);assert.equal(replay.at(-1).dark,false);stopReplay();
  const ignoredPort={start(){},postMessage(){}};connect({source:parent,data:{kind:'scean-native-connect'},ports:[ignoredPort]});assert.equal(ignoredPort.onmessage,undefined);
  assert(nativeFactorySource.includes("sandbox:'allow-scripts allow-downloads allow-forms'"));assert.equal(nativeFactorySource.includes('allow-same-origin'),false);
});

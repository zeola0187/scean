import {writingStyleLibraryView,styleSelectionAvailability,importWritingStylePack} from '../core/writing-style-library.mjs';
import {writingModeAvailability} from '../core/writing-mode.mjs';
import {playerName,bindPlayerIdentity} from '../core/player-identity.mjs';
import {headOf} from '../core/history.mjs';
import {VERSION} from './version.mjs';
import {normalizeStudioHandoffSnapshot} from './studio-handoff.mjs';
import {OpeningSelections} from './opening-selection.mjs';
import {snapshotCardScope,sameCardScope,sameCardContext} from './card-scope.mjs';
import {updateSummary,closeChapter,recoverNarrative,narrativeView,selectNarrative,invalidateNarrative} from '../core/narrative.mjs';
import {updateChapterSettings,chapterEligibility,autoChapter,backfillChapterSummary,chapterSummaryView} from '../core/chapter-summary.mjs';
import {chapterContextSources} from '../core/chapter-recall.mjs';
import {searchHistory,readHistory,pageHistory} from '../core/history-recall.mjs';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,rename,open} from 'node:fs/promises';
import {join} from 'node:path';
import {safeFailure} from '../core/engine.mjs';
import {safeId,hash} from '../core/contracts.mjs';
import {AgentDiagnostics} from './agent-diagnostics.mjs';
import {publicInspection,publicSnapshot,publicTurnResult,publicRunView} from '../core/inspection.mjs';
import {playerHistoryForView} from '../core/memory-policy.mjs';
import {encodeRunBundle,validateRunBundle} from '../core/save-bundle.mjs';
import {HostJobs,JOB_OWNER} from './job-host.mjs';
import {HostNotifications} from './notification-host.mjs';
import {FRONTEND_PROFILE} from '../core/frontend.mjs';
import {CHAPTER_SETTINGS_ACTIONS} from './chapter-settings.mjs';

function fail(code,message){throw Object.assign(new Error(message),{code});}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function plain(value){return JSON.parse(JSON.stringify(value));}
// Host drafts/progress are derived. Only an active canonical turn makes a
// receipt committed; C retirement receipts deliberately retain request IDs.
function requestOutcome(run,requestId){
  const receipt=run.receipts?.[requestId];
  if(!receipt)return {status:'not_committed'};
  if(receipt.status==='retired')return {status:'retired',commitId:receipt.commitId};
  const turn=run.turns?.find(t=>t.commitId===receipt.commitId&&t.requestId===requestId);
  return turn?{status:'committed',commitId:turn.commitId}:{status:'unknown'};
}
function terminalDraft(run,draft){
  const outcome=requestOutcome(run,draft.requestId);
  if(outcome.status==='not_committed')return null;
  if(outcome.status==='unknown')return {...plain(draft),status:'unknown',requestOutcome:outcome};
  return {runId:run.runId,input:'',requestId:null,status:outcome.status,...(outcome.status==='retired'?{retiredRequestId:draft.requestId}:{})};
}
export class SceanHost {
  constructor({engine,root,now=()=>Date.now(),bindingTtlMs=86400000,summaryEnabled=false,chapterModelsEnabled=false,chapterRetrievalEnabled=false,chapterProviderSettings,chapterRuntimeFactory,onChapterConfigurationChanged,maxConcurrentOperations=4,jobLedgerOptions={},notificationOptions={}}) {
    this.summaryEnabled=summaryEnabled===true;this.summaryRunning=new Map();
    this.chapterModelsEnabled=chapterModelsEnabled===true;this.chapterRunning=new Map();this.chapterAutoArmed=new Set();this.closing=false;
    this.writerSummaryArmed=new Set();this.automaticSummaryFailures=new Map();
    this.chapterRetrievalEnabled=chapterRetrievalEnabled===true;this.chapterContextArmed=new Set();
    this.chapterProviderSettings=chapterProviderSettings;this.chapterRuntimeFactory=chapterRuntimeFactory;this.onChapterConfigurationChanged=onChapterConfigurationChanged;this.globalSettingsUpdating=false;this.globalSettingsRevision=null;
    this.engine=engine;this.root=root;this.now=now;this.bindingTtlMs=bindingTtlMs;this.openings=new OpeningSelections(this);
    if(!Number.isSafeInteger(maxConcurrentOperations)||maxConcurrentOperations<1||maxConcurrentOperations>16)fail('HOST_CONCURRENCY','Use a Host concurrency limit between 1 and 16.');
    this.maxConcurrentOperations=maxConcurrentOperations;this.auxRunning=new Map();this.jobs=new HostJobs(this,jobLedgerOptions);this.notifications=new HostNotifications(this,notificationOptions);
    this.agentDiagnostics=new AgentDiagnostics(this);this.diagnosticGrants=new Map();this.running=new Map();this.activeOperations=new Map();this.usedOperations=new Set();this.progressByRun=new Map();this.draftQueues=new Map();this.metadata={schemaVersion:1,runs:[],bindings:[],drafts:{}};this.writeQueue=Promise.resolve();
  }
  async init(){
    await mkdir(this.root,{recursive:true});
    try{this.metadata=JSON.parse(await readFile(join(this.root,'host.json'),'utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(this.metadata.schemaVersion!==1||!Array.isArray(this.metadata.runs)||!Array.isArray(this.metadata.bindings))fail('HOST_METADATA','Invalid SCEAN host metadata.');
    this.metadata.drafts??={};this.metadata.pageDrafts??={};
    for(const row of this.metadata.openingSelections??[])this.openings.rows.set(row.offerId,row);
    this.metadata.playerDefaults??={schemaVersion:1,revision:0,name:null};
    const defaults=this.metadata.playerDefaults;if(defaults.schemaVersion!==1||!Number.isSafeInteger(defaults.revision)||defaults.revision<0||defaults.name!==null&&playerName(defaults.name)!==defaults.name)fail('PLAYER_SETTINGS_INVALID','主角預設設定格式不正確。');
    if(Object.keys(defaults).some(k=>!['schemaVersion','revision','name','operationId','fingerprint'].includes(k))||defaults.revision===0&&(defaults.operationId!==undefined||defaults.fingerprint!==undefined)||defaults.revision>0&&(!defaults.operationId||defaults.fingerprint!==hash({name:defaults.name,expectedRevision:defaults.revision-1,operationId:defaults.operationId})))fail('PLAYER_SETTINGS_INVALID','主角預設設定格式不正確。');
    // Canonical store is authoritative: restore runs after a crash between create and host-index publication.
    if(this.engine.store?.listRuns){
      this.metadata.runs=await this.engine.store.listRuns();
      for(const row of this.metadata.runs){
        try{
          await this.engine.store.withRunLock(row.runId,()=>this.engine.store.recoverAttempts(row.runId));
          await recoverNarrative(this.engine,row.runId);
          const run=await this.engine.store.read(row.runId),draft=this.metadata.drafts[row.runId];
          for(const [viewerId,pageDraft]of Object.entries(this.metadata.pageDrafts[row.runId]??{})){const terminal=terminalDraft(run,pageDraft);if(terminal)this.metadata.pageDrafts[row.runId][viewerId]=terminal;}
          if(draft?.requestId&&run.receipts?.[draft.requestId]?.inputHash===hash(draft.input)){
            const terminal=terminalDraft(run,draft);
            if(terminal?.status==='committed')delete this.metadata.drafts[row.runId];
            else if(terminal)this.metadata.drafts[row.runId]=terminal;
          }
        }catch(error){if(error.code!=='RUN_BUSY')throw error;}
      }
      await this.persist();
    }
    await this.jobs.init();await this.notifications.init();
    if(this.chapterProviderSettings){
      try{this.applyChapterProviderConfiguration(await this.chapterProviderSettings.status({transport:false}),false);}
      catch{this.chapterModelsEnabled=false;this.chapterRetrievalEnabled=false;this.engine.chapterRecall=undefined;this.globalSettingsRevision=null;}
    }
    return this;
  }
  async persist(){
    this.metadata.openingSelections=[...this.openings.rows.values()].map(({promise,...row})=>row.result&&row.requestId?{...row,snapshot:{cardId:row.snapshot.cardId,revision:row.snapshot.revision,hash:row.snapshot.hash,source:{card:{sha256:row.snapshot.source?.card?.sha256}}},options:[],initialState:undefined}:row);
    const content=JSON.stringify(this.metadata,null,2);
    const op=this.writeQueue.catch(()=>{}).then(async()=>{
      const temp=join(this.root,`host.${randomUUID()}.tmp`);
      const handle=await open(temp,'wx',0o600);
      try{await handle.writeFile(content,'utf8');await handle.sync();}finally{await handle.close();}
      await rename(temp,join(this.root,'host.json'));
      let dir;try{dir=await open(this.root,'r');await dir.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','EACCES','ENOTSUP','EBADF'].includes(error.code))throw error;}finally{await dir?.close();}
    });this.writeQueue=op;await op;
  }
  capabilities(){return {schemaVersion:1,plugin:'@local/dsh-scean',version:VERSION,hotReload:false,cardFrontend:{apiMajor:1,profiles:[FRONTEND_PROFILE],cardScripts:false,worldActions:false,derivedDisplays:false},independentRunLifecycle:true,hostOwnedOperations:true,operationJournalVersion:1,notificationVersion:1,maxConcurrentOperations:this.maxConcurrentOperations,pageDrafts:true,playerIdentity:{schemaVersion:1,saveBundleVersion:6,macro:'{{user}}',frontendMacros:false},writingModes:{default:'single_writer',choices:['single_writer'],legacyCompatibility:['current','materials'],loading:'host_whitelist_stage_delivery',version:1,modelStagesAdded:0,newStageNames:['writer','writer_repair'],ordinaryNoToolsCalls:{legacy:4,single_writer:3},workflows:{current:['director','draft','prose','post_stat'],materials:['director','draft','prose','post_stat'],single_writer:['director','writer','validation','post_stat']},supplementalLookup:false},inspectionReadOnly:true,traceCoverage:'public_projection_with_authorized_private_diagnostics',availability:['not_recorded','not_called','accepted','running','pending','failed','cancelled','committed','completed','interrupted','unknown']};}
  mutationBusy(runId,job){return this.running.has(runId)||this.summaryRunning.has(runId)||this.chapterRunning.has(runId)||this.auxRunning.has(runId)||this.jobs.active.has(runId)&&this.jobs.active.get(runId)!==job;}
  assertMutationAvailable(runId,job){
    if(this.closing)fail('HOST_CLOSING','Host is closing.');
    if(this.globalSettingsUpdating)fail('CHAPTER_SETTINGS_BUSY','全域設定正在保存，請稍後再送出故事。');
    if(this.mutationBusy(runId,job))fail('RUN_BUSY','A canonical Run operation is active.');
    const active=new Set([...this.running.keys(),...this.summaryRunning.keys(),...this.chapterRunning.keys(),...this.auxRunning.keys(),...this.jobs.active.keys()]);
    if(!active.has(runId)&&active.size>=this.maxConcurrentOperations)fail('HOST_BUSY','The Host operation limit has been reached.');
  }
  async auxiliaryMutation(request,work){
    this.requireRun(request.runId);this.assertMutationAvailable(request.runId,request[JOB_OWNER]);const owner={};this.auxRunning.set(request.runId,owner);
    try{return await work();}finally{if(this.auxRunning.get(request.runId)===owner)this.auxRunning.delete(request.runId);}
  }
  applyChapterProviderConfiguration(status,disarm=true){
    const flags=status.settings.flags;
    this.chapterModelsEnabled=flags.chapterModelsEnabled;this.chapterRetrievalEnabled=flags.chapterRetrievalEnabled;
    if(this.chapterRuntimeFactory)this.engine.chapterRecall=this.chapterRuntimeFactory(status);
    this.globalSettingsRevision=status.revision;
    if(disarm){this.chapterAutoArmed.clear();this.chapterContextArmed.clear();this.writerSummaryArmed.clear();this.automaticSummaryFailures.clear();}
  }
  async chapterProviderAction(request,signal,authority){
    if(!authority.principal||authority.allowGlobalSettings!==true)fail('CHAPTER_SETTINGS_DENIED','只有已驗證的舞臺操作者可讀寫全域設定。');
    if(!this.chapterProviderSettings)fail('CHAPTER_SETTINGS_STORAGE_UNAVAILABLE','此 Host 未提供安全憑證儲存，不能保存金鑰。');
    if(request.action==='chapterProviderSettings'){
      const saved=await this.chapterProviderSettings.status(),idle=!this.globalSettingsUpdating&&!this.running.size&&!this.summaryRunning.size&&!this.chapterRunning.size&&!this.auxRunning.size&&!this.jobs.active.size;
      if(!saved.saveOutcomeUncertain&&idle&&saved.revision!==this.globalSettingsRevision){this.applyChapterProviderConfiguration(saved);try{await this.onChapterConfigurationChanged?.(saved);}catch{}}
      return {...saved,appliedRevision:this.globalSettingsRevision,runtimeApplied:!saved.saveOutcomeUncertain&&this.globalSettingsRevision===saved.revision};
    }
    if(this.closing)fail('HOST_CLOSING','Host 正在關閉。');
    if(this.globalSettingsUpdating||this.running.size||this.summaryRunning.size||this.chapterRunning.size||this.auxRunning.size||this.jobs.active.size)fail('CHAPTER_SETTINGS_BUSY','故事或模型工作進行中，請完成或取消後再保存全域設定。');
    this.globalSettingsUpdating=true;
    try{
      const result=await this.chapterProviderSettings.save(request,signal,{clear:request.action==='chapterProviderClear'});
      this.applyChapterProviderConfiguration(result);
      let runtimeStatus='updated';try{await this.onChapterConfigurationChanged?.(result);}catch{runtimeStatus='not_recorded';}
      return {...result,appliedRevision:this.globalSettingsRevision,runtimeApplied:true,runtimeStatus,chapterRunsArmed:0};
    }catch(error){
      if(error.code==='CHAPTER_SETTINGS_SAVE_UNKNOWN'){this.chapterModelsEnabled=false;this.chapterRetrievalEnabled=false;this.engine.chapterRecall=undefined;this.globalSettingsRevision=null;this.chapterAutoArmed.clear();this.chapterContextArmed.clear();this.writerSummaryArmed.clear();try{await this.onChapterConfigurationChanged?.({saveOutcomeUncertain:true});}catch{}}
      throw error;
    }finally{this.globalSettingsUpdating=false;}
  }
  async playerDefaultsAction(request,signal,authority){
    if(!authority.principal||authority.allowGlobalSettings!==true)fail('PLAYER_SETTINGS_DENIED','只有已驗證的舞臺操作者可設定預設主角名稱。');
    const current=this.metadata.playerDefaults;
    if(request.action==='playerDefaults')return plain(current);
    if(this.closing)fail('HOST_CLOSING','Host 正在關閉。');
    const name=request.name===null?null:playerName(request.name);safeId(request.operationId);
    const fingerprint=hash({name,expectedRevision:request.expectedRevision,operationId:request.operationId});
    if(current.operationId===request.operationId){if(current.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','請保留原設定重試。');return plain(current);}
    if(this.playerDefaultsBusy)fail('PLAYER_SETTINGS_BUSY','主角設定正在保存。');
    if(request.expectedRevision!==current.revision)fail('VERSION_CONFLICT','主角預設已更新，請重新讀取。');
    signal?.throwIfAborted();this.playerDefaultsBusy=true;
    const next={schemaVersion:1,revision:current.revision+1,name,operationId:request.operationId,fingerprint};
    this.metadata.playerDefaults=next;
    try{await this.persist();return plain(next);}
    catch(error){let actual;try{actual=JSON.parse(await readFile(join(this.root,'host.json'),'utf8')).playerDefaults;}catch{}
      if(actual?.fingerprint===fingerprint)return plain(next);
      this.metadata.playerDefaults=current;throw error;
    }finally{this.playerDefaultsBusy=false;}
  }
  async createRun({snapshot,initialState,runId,openingId,modelSelection,stageModelSelections,playerName}={}){
    if(!snapshot||snapshot.schemaVersion!==1)fail('SNAPSHOT','A saved schemaVersion 1 snapshot is required.');
    const run=await this.engine.createRun({snapshot:plain(snapshot),initialState:initialState??{world:{},characters:{}},...(runId?{runId}:{}),...(openingId!==undefined?{openingId}:{}),...(modelSelection!==undefined?{modelSelection}:{}),...(stageModelSelections!==undefined?{stageModelSelections}:{}),...(playerName!==undefined?{playerName}:{})});
    const id=run.runId??run.id;
    if(!id)fail('CORE_CONTRACT','Core did not return a run identity.');
    if(!this.metadata.runs.some(r=>r.runId===id))this.metadata.runs.push({runId:id,cardId:snapshot.cardId,revision:snapshot.revision,createdAt:new Date(this.now()).toISOString()});
    await this.persist();return {runId:id,snapshot:publicSnapshot(run.snapshot),run:publicInspection(run)};
  }
  listRuns(){return plain(this.metadata.runs);}
  async refreshRuns(){if(this.engine.store?.listRuns)this.metadata.runs=await this.engine.store.listRuns();return this.listRuns();}
  async scopedRuns(scope){
    if(!scope)return [];
    const rows=await this.refreshRuns(),visible=[];
    // The derived index is not an authorization source. Check saved snapshots.
    for(const row of rows){const run=await this.engine.store.read(row.runId);if(sameCardScope(scope,snapshotCardScope(run.snapshot)))visible.push({...row,cardId:run.snapshot.cardId,revision:run.snapshot.revision,title:String(run.snapshot.card?.data?.name??run.snapshot.card?.name??run.snapshot.cardId).slice(0,500)});}
    return visible;
  }
  async assertRunCardScope(runId,scope){
    this.requireRun(runId);
    const run=await this.engine.store.read(runId);
    if(!sameCardScope(scope,snapshotCardScope(run.snapshot)))fail('CARD_SCOPE_MISMATCH','此 Run 不屬於目前對話選取的卡片。請回 Studio 選卡。');
  }
  requireRun(runId){safeId(runId);if(!this.metadata.runs.some(r=>r.runId===runId))fail('RUN_NOT_FOUND','Unknown SCEAN run.');}
  async draftSave(request,owner){
    this.requireRun(request.runId);
    const prior=this.draftQueues.get(request.runId)??Promise.resolve();
    const operation=prior.catch(()=>{}).then(()=>this.writeDraft(request,owner));
    this.draftQueues.set(request.runId,operation);
    try{return await operation;}finally{if(this.draftQueues.get(request.runId)===operation)this.draftQueues.delete(request.runId);}
  }
  async writeDraft({runId,input,requestId,viewerId},owner){
    this.requireRun(runId);safeId(requestId);
    if(typeof input!=='string'||input.length>20000)fail('INPUT','Enter bounded player text.');
    if(viewerId!==undefined)safeId(viewerId);
    const pages=this.metadata.pageDrafts[runId]??{};
    if(viewerId!==undefined&&!Object.hasOwn(pages,viewerId)&&Object.keys(pages).length>=64)fail('DRAFT_CAPACITY','Close old page drafts before opening more editors.');
    const drafts=viewerId===undefined?this.metadata.drafts:(this.metadata.pageDrafts[runId]??={}),key=viewerId??runId,prior=drafts[key];
    if(prior?.requestId===requestId&&prior.input!==input)fail('IDEMPOTENCY_CONFLICT','Use a new requestId for changed input.');
    if(this.running.has(runId)&&this.running.get(runId)!==owner)fail('RUN_BUSY','An active turn owns this draft.');
    const run=await this.engine.store.read(runId);
    if(this.running.has(runId)&&this.running.get(runId)!==owner)fail('RUN_BUSY','An active turn owns this draft.');
    if(run.receipts?.[requestId]){
      if(run.receipts[requestId].inputHash!==hash(input))fail('IDEMPOTENCY_CONFLICT','Use a new requestId for changed input.');
      return terminalDraft(run,{runId,input,requestId});
    }
    const next={runId,input,requestId,updatedAt:new Date(this.now()).toISOString(),status:'saved'};
    drafts[key]=next;
    try{await this.persist();}catch(error){if(prior===undefined)delete drafts[key];else drafts[key]=prior;error.category='persistence';throw error;}
    return plain(next);
  }
  async draftGet(runId,viewerId){
    this.requireRun(runId);if(viewerId!==undefined)safeId(viewerId);const draft=viewerId===undefined?this.metadata.drafts[runId]:this.metadata.pageDrafts[runId]?.[viewerId];
    if(!draft?.requestId)return plain(draft??{runId,input:'',requestId:null,status:'empty'});
    const run=await this.engine.store.read(runId);
    return terminalDraft(run,draft)??plain(draft);
  }
  async progress(runId){
    this.requireRun(runId);
    const run=await this.engine.store.read(runId),canonical={version:run.version,head:headOf(run)};
    const backgroundOwner=this.summaryRunning.get(runId)??this.chapterRunning.get(runId),background=run.narrative?.operations?.[backgroundOwner?.operationId];
    if(background?.status==='pending')return {runId,operationId:background.operationId,requestId:null,kind:background.kind==='summary'?'summaryStart':'chapterAuto',stage:background.kind,status:'pending',pending:true,canonical,version:canonical.version,head:canonical.head};
    const current=this.progressByRun.get(runId),pending=this.mutationBusy(runId);
    if(current&&pending)return {...plain(current),pending:true,canonical,version:canonical.version,head:canonical.head};
    let inspected;
    try{inspected=await this.engine.inspect(runId);}catch(error){
      if(current?.lastFailure?.code==='COMMIT_OUTCOME_UNKNOWN')return {...plain(current),pending:false,status:'unknown',requestOutcome:{status:'unknown'},canonical,version:canonical.version,head:canonical.head};
      throw error;
    }
    const attempt=current?.attemptId?inspected.attempts.find(a=>a.attemptId===current.attemptId):inspected.attempts.at(-1);
    const base=current?{...plain(current),pending:false}:{runId,requestId:attempt?.requestId??null,operationId:attempt?.operationId??null,attemptId:attempt?.attemptId??null,pending,stage:attempt?.commit?'commit':attempt?.stages?.at(-1)?.stage??null,status:attempt?.status??'not_recorded',sequence:0,events:[],lastFailure:inspected.lastFailure};
    // History-operation progress has its own durable receipt (including a later
    // retired replacement); do not confuse rollback completion with a turn.
    const operation=inspected.operationReceipts?.[base.operationId];
    const outcome=operation?{status:operation.result.status}:requestOutcome(inspected,base.requestId);
    base.requestOutcome=outcome;
    if(['committed','retired','unknown'].includes(outcome.status)){
      base.status=outcome.status;if(outcome.commitId)base.commitId=outcome.commitId;
      if(outcome.status==='committed')base.lastFailure=null;
      if(outcome.status==='retired'){base.events=[];delete base.commitId;base.lastFailure=null;}
    }else if(base.lastFailure?.code==='COMMIT_OUTCOME_UNKNOWN'){
      // The read succeeded and found no publication. Preserve input for a same-ID retry.
      base.status='failed';base.recovery='confirmed_not_committed';
    }
    if(attempt?.recovery)base.recovery=attempt.recovery;
    return {...base,canonical,version:canonical.version,head:canonical.head};
  }
  async turn({runId,input,requestId,signal,operationId,baseVersion,baseHead,viewerId,[JOB_OWNER]:job}){
    if(!this.metadata.runs.some(r=>r.runId===runId))fail('RUN_NOT_FOUND','Unknown SCEAN run.');
    if(typeof input!=='string'||!input.trim()||input.length>20000)fail('INPUT','Enter bounded player text.');
    if(typeof requestId!=='string'||!requestId)fail('REQUEST_ID','A stable requestId is required.');
    safeId(requestId);
    // A published receipt is readable even while subsequent derived work is
    // finishing. This path never reserves, drafts, schedules or calls a model.
    if(this.mutationBusy(runId,job)){
      const run=await this.engine.store.read(runId),receipt=run.receipts?.[requestId];
      if(receipt){
        if(receipt.inputHash!==hash(input))fail('IDEMPOTENCY_CONFLICT','Use a new requestId for changed input.');
        if(receipt.status==='retired')fail('REQUEST_RETIRED','This request belongs to a retired turn.');
        if(!run.turns.some(turn=>turn.requestId===requestId&&turn.commitId===receipt.commitId))fail('COMMIT_OUTCOME_UNKNOWN','The canonical receipt is inconsistent.');
        return publicTurnResult(receipt.result);
      }
    }
    this.assertMutationAvailable(runId,job);
    operationId??=`operation-${randomUUID()}`;safeId(operationId);
    const operationKey=`${runId}:${operationId}`;if(this.usedOperations.has(operationKey))fail('OPERATION_ID_REUSED','Each execution attempt needs a new operationId.');
    this.usedOperations.add(operationKey);
    const owner={runId,requestId,operationId,attemptId:null};this.activeOperations.set(runId,owner);
    const controller=new AbortController();this.running.set(runId,controller);
    const progress={runId,requestId,operationId,attemptId:null,stage:'memory',status:'pending',sequence:0,events:[]};this.progressByRun.set(runId,progress);
    try{
      await this.draftSave({runId,input,requestId,...(viewerId===undefined?{}:{viewerId})},controller);
      const result=await this.engine.turn({runId,input,requestId,operationId,baseVersion,baseHead,chapterContextEnabled:this.chapterContextArmed.has(runId),signal:signal?AbortSignal.any([controller.signal,signal]):controller.signal,onProgress:event=>{owner.attemptId=event.attemptId;const owned={...event,operationId};Object.assign(progress,owned);progress.events.push(owned);if(progress.events.length>100)progress.events.shift();}});
      Object.assign(progress,{stage:'commit',status:'committed',commitId:result.commitId});
      const summary=this.metadata.runs.find(row=>row.runId===runId);if(summary)Object.assign(summary,{version:result.version,turnCount:result.turn,updatedAt:new Date(this.now()).toISOString()});
      if(this.metadata.drafts[runId]?.requestId===requestId){delete this.metadata.drafts[runId];try{await this.persist();}catch{progress.draftCleanup='pending_restart_reconciliation';}}
      if(viewerId!==undefined&&this.metadata.pageDrafts[runId]?.[viewerId]?.requestId===requestId){delete this.metadata.pageDrafts[runId][viewerId];try{await this.persist();}catch{progress.draftCleanup='pending_restart_reconciliation';}}
      this.scheduleChapterAfterTurn(runId,result.commitId);
      return publicTurnResult(result);
    }catch(error){const failure=error.sceanFailure??safeFailure(error,progress.stage);Object.assign(progress,{status:failure.code==='COMMIT_OUTCOME_UNKNOWN'?'unknown':failure.category==='cancelled'?'cancelled':'failed',lastFailure:failure});throw error;}
    finally{if(this.activeOperations.get(runId)===owner){this.running.delete(runId);this.activeOperations.delete(runId);}}
  }
  cancel({runId,operationId,requestId,attemptId}){
    const job=this.jobs.cancel({runId,operationId,requestId,attemptId});if(job)return job;
    const controller=this.running.get(runId),owner=this.activeOperations.get(runId);
    const rejected=reason=>({runId,cancelRequested:false,status:'not_called',reason});
    if(!controller||!owner)return rejected('not_running');
    if(operationId===undefined&&(typeof attemptId!=='string'||!attemptId))return rejected('identity_required');
    if(operationId!==undefined&&operationId!==owner.operationId)return rejected('operation_mismatch');
    if(requestId!==undefined&&requestId!==owner.requestId)return rejected('request_mismatch');
    if(attemptId!==undefined&&attemptId!==owner.attemptId)return rejected('attempt_mismatch');
    controller.abort(Object.assign(new Error('SCEAN turn cancelled.'),{code:'CANCELLED'}));
    return {runId,operationId:owner.operationId,requestId:owner.requestId,attemptId:owner.attemptId,cancelRequested:true,status:'pending'};
  }
  async inspect(runId){this.requireRun(runId);return {...publicInspection(await this.engine.inspect(runId)),host:{pending:this.mutationBusy(runId),capabilities:this.capabilities()}};}
  async runView(request){
    this.requireRun(request.runId);if(request.requestId!==undefined)safeId(request.requestId);
    const run=await this.engine.store.read(request.runId),progress=this.progressByRun.get(request.runId);
    return {...publicRunView(run,request),lastFailure:progress?.lastFailure??null,host:{pending:this.mutationBusy(request.runId),capabilities:this.capabilities()}};
  }
  async historyReadAction(action,request){
    this.requireRun(request.runId);const run=await this.engine.store.read(request.runId);
    return ({historySearch:searchHistory,historyRead:readHistory,historyPage:pageHistory}[action])(run,request);
  }
  async summaryStatus(runId){this.requireRun(runId);const run=await this.engine.store.read(runId),chapterMode=this.chapterContextArmed.has(runId);return {...narrativeView(run),enabled:this.summaryEnabled,contextMode:chapterMode?'chapter_3_plus_8':'legacy_rolling',coverage:chapterMode?chapterContextSources(run).diagnostics:selectNarrative(run,{recentWindow:this.engine.recentWindow}).diagnostics,autoArmed:this.writerSummaryArmed.has(runId)};}
  async summaryStart(request,signal){
    this.requireRun(request.runId);safeId(request.operationId);
    const fingerprint=hash({runId:request.runId,operationId:request.operationId,expectedVersion:request.expectedVersion,expectedHead:request.expectedHead,endTurn:request.endTurn??null,recentWindow:request.recentWindow??6});
    const existing=this.summaryRunning.get(request.runId);
    if(existing){if(existing.operationId===request.operationId&&existing.fingerprint!==fingerprint)fail('OPERATION_ID_CONFLICT','The operation identity belongs to different summary inputs.');if(existing.operationId===request.operationId)return {status:'pending',operationId:request.operationId};fail('SUMMARY_BUSY','A summary is active.');}
    this.assertMutationAvailable(request.runId,request[JOB_OWNER]);
    const controller=new AbortController(),owner={controller,operationId:request.operationId,fingerprint};this.summaryRunning.set(request.runId,owner);
    try{return await updateSummary(this.engine,{...request,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal},{enabled:this.summaryEnabled});}
    finally{if(this.summaryRunning.get(request.runId)===owner)this.summaryRunning.delete(request.runId);await this.refreshRuns().catch(()=>{});}
  }
  summaryCancel(request){
    this.requireRun(request.runId);safeId(request.operationId);const job=this.jobs.cancel(request);if(job?.cancelRequested)return job;const owner=this.summaryRunning.get(request.runId);
    if(!owner||owner.operationId!==request.operationId)return job??{status:'not_called',cancelRequested:false};
    owner.controller.abort();return {status:'pending',cancelRequested:true,operationId:request.operationId};
  }
  async chapterStatus(request){
    this.requireRun(request.runId);const run=await this.engine.store.read(request.runId);
    const attempts=await this.engine.store.readAttempts(run.runId),lastRecall=attempts.at(-1)?.assemblyDiagnostics?.chapterRecall??null;
    return {...chapterSummaryView(run,request.chapterId),enabled:this.chapterModelsEnabled,autoArmed:this.chapterAutoArmed.has(request.runId),writerSummaryEnabled:this.summaryEnabled,writerSummaryArmed:this.writerSummaryArmed.has(request.runId),chapterRetrievalEnabled:this.chapterRetrievalEnabled,chapterContextArmed:this.chapterContextArmed.has(request.runId),chapterPorts:this.engine.chapterRecall?.capabilities()??{embedding:false,rerank:false},lastRecall,automaticFailure:this.automaticSummaryFailures.get(request.runId)??null};
  }
  async chapterSettings(request,signal){
    let schedule=false;
    const result=await this.auxiliaryMutation(request,async()=>{
      if(request.writerSummaryEnabled!==undefined&&typeof request.writerSummaryEnabled!=='boolean')fail('INVALID_CHAPTER_SETTINGS','Writer summary consent must be a boolean.');
      if(request.chapterContextEnabled!==undefined&&typeof request.chapterContextEnabled!=='boolean')fail('INVALID_CHAPTER_SETTINGS','Chapter context consent must be a boolean.');
      if(request.chapterContextEnabled===true){
        if(request.writerSummaryEnabled===true)fail('CHAPTER_CONTEXT_MODE_CONFLICT','Choose chapter context or legacy rolling context.');
        if(!this.chapterRetrievalEnabled||request.settings?.autoEnabled!==true)fail('CHAPTER_RECALL_UNAVAILABLE','Chapter retrieval must be enabled by the Host and explicitly armed.');
        const ports=this.engine.chapterRecall?.capabilities();if(!ports?.embedding)fail('CHAPTER_EMBEDDING_UNAVAILABLE','Configure the chapter embedding port.');if(!ports.rerank)fail('CHAPTER_RERANK_UNAVAILABLE','Configure the chapter rerank port.');
      }
      if(request.settings?.autoEnabled===true&&!this.chapterModelsEnabled)fail('CHAPTER_DISABLED','Chapter model work is not enabled on this Host.');
      if(request.writerSummaryEnabled===true&&(!this.summaryEnabled||request.settings?.autoEnabled!==true))fail('SUMMARY_DISABLED','Automatic Writer compression requires both Host capabilities and explicit automatic chapter opt-in.');
      const replay=(await this.engine.store.read(request.runId)).narrative?.operations?.[request.operationId];
      const result=await updateChapterSettings(this.engine,{...request,signal});
      // A replay cannot grant the new paid Writer authority after restart.
      if(replay&&(request.writerSummaryEnabled===true||request.chapterContextEnabled===true))return result;
      if(request.settings?.autoEnabled===true)this.chapterAutoArmed.add(request.runId);
      if(request.settings?.autoEnabled===false)this.chapterAutoArmed.delete(request.runId);
      this.writerSummaryArmed.delete(request.runId);this.automaticSummaryFailures.delete(request.runId);
      this.chapterContextArmed.delete(request.runId);
      if(request.writerSummaryEnabled===true){this.writerSummaryArmed.add(request.runId);schedule=true;}
      if(request.chapterContextEnabled===true){this.chapterContextArmed.add(request.runId);schedule=true;}
      await this.refreshRuns();return result;
    });
    if(schedule){const run=await this.engine.store.read(request.runId);this.scheduleChapterAfterTurn(request.runId,headOf(run));}
    return result;
  }
  async chapterStart(action,request,signal){
    this.requireRun(request.runId);safeId(request.operationId);
    if(this.closing)fail('HOST_CLOSING','Host is closing.');
    const fingerprint=hash({action,runId:request.runId,operationId:request.operationId,expectedVersion:request.expectedVersion,expectedHead:request.expectedHead,chapterId:request.chapterId??null,detail:request.detail??null});
    const existing=this.chapterRunning.get(request.runId);
    if(existing){
      if(existing.operationId===request.operationId&&existing.fingerprint!==fingerprint)fail('OPERATION_ID_CONFLICT','Chapter operation identity belongs to different inputs.');
      if(existing.operationId===request.operationId)return {status:'pending',operationId:request.operationId};
      fail('CHAPTER_BUSY','Chapter work is active.');
    }
    this.assertMutationAvailable(request.runId,request[JOB_OWNER]);
    const controller=new AbortController(),owner={controller,operationId:request.operationId,fingerprint,promise:null};
    this.chapterRunning.set(request.runId,owner);
    const method=action==='chapterAuto'?autoChapter:backfillChapterSummary;
    const work=(async()=>{
      try{
        const workSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
        const result=await method(this.engine,{...request,signal:workSignal},{enabled:this.chapterModelsEnabled});
        if(action==='chapterAuto'&&this.writerSummaryArmed.has(request.runId)&&!this.chapterContextArmed.has(request.runId)){
          if(result.status!=='completed')fail(result.code??'AUTOMATIC_CHAPTER_INCOMPLETE','Automatic chapter work requires explicit recovery.');
          if(result.created)await this.completeAutomaticSummary(request.runId,workSignal);
        }
        return result;
      }
      catch(error){if(action==='chapterAuto')this.disarmAutomatic(request.runId,error);throw error;}
      finally{if(this.chapterRunning.get(request.runId)===owner)this.chapterRunning.delete(request.runId);await this.refreshRuns().catch(()=>{});}
    })();owner.promise=work;return work;
  }
  chapterCancel(request){
    this.requireRun(request.runId);safeId(request.operationId);const job=this.jobs.cancel(request);if(job)return job;const owner=this.chapterRunning.get(request.runId);
    if(!owner||owner.operationId!==request.operationId)return {status:'not_called',cancelRequested:false};
    owner.controller.abort(Object.assign(new Error('Chapter work cancelled.'),{code:'CANCELLED'}));
    return {status:'pending',cancelRequested:true,operationId:request.operationId};
  }
  disarmAutomatic(runId,error){
    this.chapterAutoArmed.delete(runId);this.writerSummaryArmed.delete(runId);
    this.automaticSummaryFailures.set(runId,{code:/^[A-Z0-9_]{1,64}$/.test(error.code??'')?error.code:'AUTOMATIC_SUMMARY_FAILED',recovery:'explicit_rearm_or_manual_summary'});
  }
  automaticSummaryRequest(run){
    invalidateNarrative(run);
    const covered=selectNarrative(run).summary?.endTurn??0,last=run.narrative?.chapters.filter(c=>c.current&&c.status==='completed').at(-1);
    if(!last||last.endTurn<=covered)return null;
    const recentWindow=Math.max(1,run.narrative.chapterSettings?.bufferTurns??this.engine.recentWindow??6),endTurn=Math.min(last.endTurn,covered+50,run.turns.length-recentWindow);
    // Rolling's existing contract retains at least one original even when the
    // chapter buffer is zero. A later cycle can finish that closed range.
    if(endTurn<=covered)return null;
    return {runId:run.runId,operationId:`summary-auto-${hash({runId:run.runId,commitId:run.turns[endTurn-1].commitId,consent:run.narrative.chapterSettings.operationId}).slice(0,40)}`,expectedVersion:run.version,expectedHead:headOf(run),endTurn,recentWindow};
  }
  async completeAutomaticSummary(runId,signal){
    if(this.closing||!this.writerSummaryArmed.has(runId))return;
    const request=this.automaticSummaryRequest(await this.engine.store.read(runId));if(!request)return;
    const controller=new AbortController(),owner={controller,operationId:request.operationId,fingerprint:hash({runId:request.runId,operationId:request.operationId,expectedVersion:request.expectedVersion,expectedHead:request.expectedHead,endTurn:request.endTurn,recentWindow:request.recentWindow})};
    this.summaryRunning.set(runId,owner);
    try{
      const result=await updateSummary(this.engine,{...request,signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal},{enabled:this.summaryEnabled});
      if(result.status!=='completed')fail(result.code??'AUTOMATIC_SUMMARY_INCOMPLETE','Automatic Writer compression requires explicit recovery.');
    }finally{if(this.summaryRunning.get(runId)===owner)this.summaryRunning.delete(runId);}
  }
  scheduleChapterAfterTurn(runId,commitId){
    if(!this.chapterModelsEnabled||!this.chapterAutoArmed.has(runId)||this.closing)return;
    // Work starts after the RP controller has released ownership. Its result is
    // independent from the already committed RP response and uses a stable ID.
    const work=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
      // Admission remains reserved through durable job finalization. Let the
      // owning turn finish that bookkeeping before checking background capacity.
      const finishing=this.jobs.active.get(runId);if(['turn','chapterSettings','regenerate'].includes(finishing?.row.kind))await finishing.promise;
      if(this.closing||!this.chapterAutoArmed.has(runId)||this.mutationBusy(runId))return;
      const run=await this.engine.store.read(runId);
      if(headOf(run)!==commitId)return;
      // Repair a known closed range first; never analyze it again. One bounded
      // delta per cycle keeps catch-up work and paid calls predictable.
      const catchup=this.writerSummaryArmed.has(runId)?this.automaticSummaryRequest(run):null;
      if(catchup){const result=await this.summaryStart(catchup);if(result.status!=='completed')fail(result.code??'AUTOMATIC_SUMMARY_INCOMPLETE','Automatic Writer compression requires recovery.');return;}
      if(!chapterEligibility(run).eligible)return;
      await this.chapterStart('chapterAuto',{runId,operationId:`chapter-auto-${hash({commitId,consent:run.narrative.chapterSettings.operationId}).slice(0,40)}`,expectedVersion:run.version,expectedHead:headOf(run)});
    }).catch(error=>this.disarmAutomatic(runId,error));
    this.chapterBackground??=new Set();this.chapterBackground.add(work);work.finally(()=>this.chapterBackground.delete(work));
  }
  async chapterClose(request,signal){return this.auxiliaryMutation(request,async()=>{const result=await closeChapter(this.engine,{...request,signal});await this.refreshRuns();return result;});}
  async historyMutation(action,request,signal){
    this.requireRun(request.runId);safeId(request.operationId);
    if(action==='rollback'&&request.confirmation!=='rollback-last-committed-turn')fail('HISTORY_CONFIRMATION_REQUIRED','Confirm removal of the last committed turn.');
    this.assertMutationAvailable(request.runId,request[JOB_OWNER]);
    const controller=new AbortController(),owner={runId:request.runId,operationId:request.operationId,requestId:request.requestId??null,attemptId:null};
    this.running.set(request.runId,controller);this.activeOperations.set(request.runId,owner);
    const progress={...owner,stage:action,status:'pending',sequence:0,events:[]};this.progressByRun.set(request.runId,progress);
    try{
      const result=await this.engine[action]({...request,chapterContextEnabled:this.chapterContextArmed.has(request.runId),signal:signal?AbortSignal.any([signal,controller.signal]):controller.signal,onProgress:event=>{owner.attemptId=event.attemptId;Object.assign(progress,event,{operationId:request.operationId});progress.events.push({...event,provisional:true});if(progress.events.length>100)progress.events.shift();}});
      Object.assign(progress,{status:result.status,stage:action,version:result.version});
      await this.refreshRuns();await this.persist().catch(()=>{});
      return {...publicTurnResult(result),...Object.fromEntries(['kind','operationId','head','retiredCommitId','retiredBy','retiredAtVersion'].filter(k=>result[k]!==undefined).map(k=>[k,result[k]]))};
    }catch(error){Object.assign(progress,{status:controller.signal.aborted?'cancelled':'failed',lastFailure:safeFailure(error,action)});throw error;}
    finally{if(this.activeOperations.get(request.runId)===owner){this.running.delete(request.runId);this.activeOperations.delete(request.runId);}}
  }
  requireSaveAuthority(action,request,authority){
    if(authority?.allowPrivateSaves!==true||!authority.principal||request.acknowledgement!==`${action}-private-run-data`)fail('SAVE_AUTHORIZATION_REQUIRED','Explicit operator acknowledgement of private Run data is required.');
  }
  async exportRun(request,authority,signal){
    this.requireSaveAuthority('export',request,authority);this.requireRun(request.runId);
    if(this.mutationBusy(request.runId))fail('RUN_BUSY','Wait for the Run operation to finish.');
    return this.engine.store.withRunLock(request.runId,async()=>{signal?.throwIfAborted();const run=await this.engine.store.read(request.runId);const style=await this.engine.proseStyle(request.runId);const mode=await this.engine.writingMode(request.runId);const bundle=encodeRunBundle({...run,...(style.revision>0?{proseStyle:style}:{}),...(mode.revision>0?{writingMode:mode}:{})});signal?.throwIfAborted();return bundle;},{signal});
  }
  async importRun(request,authority,signal){
    this.requireSaveAuthority('import',request,authority);signal?.throwIfAborted();
    const run=validateRunBundle(request.bundle);signal?.throwIfAborted();
    try{await this.engine.store.create(run,{signal});}
    catch(error){
      if(['RUN_EXISTS','RUN_BUSY'].includes(error.code))throw error;
      let recovered;try{recovered=await this.engine.store.read(run.runId);}catch{throw error;}
      if(hash(encodeRunBundle(recovered))!==hash(encodeRunBundle(run)))throw error;
    }
    await recoverNarrative(this.engine,run.runId);
    const restored=await this.engine.store.read(run.runId);
    this.engine.memory.clearCache?.();await this.refreshRuns();await this.persist().catch(()=>{});
    return {imported:true,runId:restored.runId,version:restored.version,head:restored.head};
  }
  diagnosticsGrant({runId,viewerId,acknowledgement},authority={}){
    this.requireRun(runId);safeId(viewerId);
    if(authority.allowPrivateDiagnostics!==true||!authority.principal||acknowledgement!=='show-private-character-context-for-this-run')fail('DIAGNOSTICS_AUTHORIZATION_REQUIRED','Explicit operator authorization is required for private diagnostics.');
    for(const [key,row] of this.diagnosticGrants)if(row.expiresAt<=this.now()||row.principal===authority.principal&&row.viewerId===viewerId)this.diagnosticGrants.delete(key);
    if(this.diagnosticGrants.size>=128)fail('DIAGNOSTICS_GRANT_LIMIT','Close old diagnostic views first.');
    const grantToken=randomUUID()+randomUUID(),expiresAt=this.now()+10*60*1000;
    this.diagnosticGrants.set(grantToken,{runId,viewerId,principal:authority.principal,expiresAt});
    return {runId,grantToken,expiresAt,scope:'operator-private'};
  }
  diagnosticGrantRow({runId,viewerId,grantToken},authority={}){
    this.requireRun(runId);const row=this.diagnosticGrants.get(grantToken);
    if(authority.allowPrivateDiagnostics!==true||!row||row.principal!==authority.principal||row.runId!==runId||row.viewerId!==viewerId||row.expiresAt<=this.now())fail('DIAGNOSTICS_DENIED','Private diagnostics grant is absent, expired, revoked, or belongs to another viewer/run.');
    return row;
  }
  async diagnosticsRead(request,authority,signal){
    signal?.throwIfAborted();
    const row=this.diagnosticGrantRow(request,authority),run=await this.engine.inspect(request.runId);
    signal?.throwIfAborted();
    this.diagnosticGrantRow(request,authority);
    return {...run,playerHistoryView:playerHistoryForView(run.playerHistory??[],{runId:run.runId,audience:'player-history'}),diagnostics:{scope:'operator-private',expiresAt:row.expiresAt,sharedExportAllowed:false}};
  }
  diagnosticsRevoke(request,authority){this.diagnosticGrantRow(request,authority);this.diagnosticGrants.delete(request.grantToken);return {runId:request.runId,revoked:true};}
  async startFromStudio({snapshot,authoringSessionId,generation,initialState,playerName,requestId,signal}){
    signal?.throwIfAborted();this.validateOwner(authoringSessionId,generation);
    snapshot=normalizeStudioHandoffSnapshot(snapshot);
    if(playerName===undefined&&snapshot.card?.data&&snapshotCardScope(snapshot))return this.openings.prepare({snapshot,authoringSessionId,generation,initialState,requestId,signal});
    const created=await this.createRun({snapshot,initialState,...(playerName!==undefined?{playerName}:{})});
    const binding=this.issueBinding(created.runId,authoringSessionId,generation);
    await this.persist();return {runId:created.runId,binding};
  }
  validateOwner(session,generation){if(typeof session!=='string'||!session||session.length>256||!(typeof generation==='string'&&generation.length>0&&generation.length<=256||Number.isSafeInteger(generation)&&generation>=0))fail('INSPECTION_OWNER','Valid authoring identity and exact generation required.');}
  issueBinding(runId,authoringSessionId,generation){
    const row={binding:randomUUID()+randomUUID(),runId,authoringSessionId,generation,expiresAt:this.now()+this.bindingTtlMs,access:'read-only'};
    this.metadata.bindings.push(row);return row.binding;
  }
  bindingRow({runId,binding,authoringSessionId,generation},allowPriorGeneration=false){
    this.validateOwner(authoringSessionId,generation);
    const row=this.metadata.bindings.find(r=>equal(r.binding,binding));
    if(!row||row.runId!==runId||row.authoringSessionId!==authoringSessionId||(!allowPriorGeneration&&row.generation!==generation)||row.expiresAt<this.now())fail('INSPECTION_DENIED','Inspection binding is missing, expired, or belongs to another run/session/generation.');
    return row;
  }
  async inspectFromStudio(request){request.signal?.throwIfAborted();this.bindingRow(request);if(request.cardScope)await this.assertRunCardScope(request.runId,request.cardScope);return this.inspect(request.runId);}
  async attachInspection({runId,priorBinding,authoringSessionId,generation,cardScope}){
    this.bindingRow({runId,binding:priorBinding,authoringSessionId,generation},true);
    if(cardScope)await this.assertRunCardScope(runId,cardScope);
    const binding=this.issueBinding(runId,authoringSessionId,generation);await this.persist();return {runId,binding};
  }
  async request(request,signal,authority={}){
    try{
      signal?.throwIfAborted();
      if(['playerDefaults','playerDefaultsSave'].includes(request.action))return {ok:true,value:await this.playerDefaultsAction(request,signal,authority)};
      if(CHAPTER_SETTINGS_ACTIONS.has(request.action))return {ok:true,value:await this.chapterProviderAction(request,signal,authority)};
      let value;
      let scope;
      if(authority.requireCardScope){
        // Revocation only removes a token owned by this authenticated viewer;
        // it must still work after navigating away from its original card.
        if(request.action==='diagnosticsRevoke')return {ok:true,value:this.diagnosticsRevoke(request,authority)};
        scope=await authority.resolveCardScope?.(request.sessionId)??null;
        if(request.action==='context')return {ok:true,value:{cardScope:scope}};
        if(request.action!=='capabilities'&&request.action!=='models'){
          if(!scope){if(request.action==='list')return {ok:true,value:[]};fail('CARD_CONTEXT_REQUIRED','請在目前對話的 Card Studio 選取一張卡，再開啟舞臺。');}
          if(!sameCardContext(scope,request.cardScope))fail('CARD_CONTEXT_CHANGED','目前對話或卡片已變更，請重新整理舞臺。');
          if(request.runId)await this.assertRunCardScope(request.runId,scope);
          // New Runs use Studio's existing saved-revision/lease handoff only.
          if(request.action==='create')fail('CARD_SCOPED_STUDIO_REQUIRED','請透過目前卡片的 Studio 交接已保存版本，建立新局。');
          if(request.action==='importRun'){
            this.requireSaveAuthority('import',request,authority);
            const imported=validateRunBundle(request.bundle);
            if(!sameCardScope(scope,snapshotCardScope(imported.snapshot)))fail('CARD_SCOPE_MISMATCH','備份不屬於目前卡片，未匯入。請回 Studio 選取對應卡片。');
          }
        }
      }
      switch(request.action){
        case 'capabilities':value=this.capabilities();break;
        case 'list':value=authority.requireCardScope?await this.scopedRuns(scope):await this.refreshRuns();break;
        case 'openingPrepare':case 'openingOffer':case 'openingStart':case 'openingCancel':
          if(!authority.requireCardScope||!scope)fail('CARD_CONTEXT_REQUIRED','選開場需要目前對話已選取的 Studio 卡片。');
          value=request.action==='openingPrepare'?await this.openings.reopen(request,scope,()=>authority.resolveCardScope(request.sessionId),signal):request.action==='openingOffer'?this.openings.get(scope):request.action==='openingCancel'?await this.openings.cancel(request,scope):await this.openings.start(request,scope,()=>authority.resolveCardScope(request.sessionId),signal);break;
        case 'playerBind':value=await this.auxiliaryMutation(request,()=>bindPlayerIdentity(this.engine,{...request,signal}));await this.refreshRuns();break;
        case 'progress':value=await this.progress(request.runId);break;
        case 'operationSubmit':value=await this.jobs.submit(request,signal);break;
        case 'operationStatus':value=await this.jobs.status(request);break;
        case 'notificationWatch':value=await this.notifications.watch(request);break;
        case 'notificationStatus':value=await this.notifications.status(request);break;
        case 'notificationClaim':value=await this.notifications.claim(request);break;
        case 'notificationTarget':value=await this.notifications.target(request);break;
        case 'notificationStop':value=await this.notifications.stop(request);break;
        case 'draftSave':value=await this.draftSave(request);break;
        case 'draftGet':value=await this.draftGet(request.runId,request.viewerId);break;
        case 'create':value=await this.createRun(request);break;
        case 'turn':value=await this.turn({...request,signal});break;
        case 'rollback':value=await this.historyMutation('rollback',request,signal);break;
        case 'regenerate':value=await this.historyMutation('regenerate',request,signal);break;
        case 'exportRun':value=await this.exportRun(request,authority,signal);break;
        case 'importRun':value=await this.importRun(request,authority,signal);break;
        case 'cancel':value=this.cancel(request);break;
        case 'runView':value=await this.runView(request);break;
        case 'historySearch':case 'historyRead':case 'historyPage':value=await this.historyReadAction(request.action,request);break;
        case 'summaryStatus':value=await this.summaryStatus(request.runId);break;
        case 'summaryStart':value=await this.summaryStart(request,signal);break;
        case 'summaryCancel':value=this.summaryCancel(request);break;
        case 'chapterStatus':value=await this.chapterStatus(request);break;
        case 'chapterSettings':value=await this.chapterSettings(request,signal);break;
        case 'chapterSummarize':case 'chapterAuto':value=await this.chapterStart(request.action,request,signal);break;
        case 'chapterCancel':value=this.chapterCancel(request);break;
        case 'chapterClose':value=await this.chapterClose(request,signal);break;
        case 'inspect':value=await this.inspect(request.runId);break;
        case 'diagnosticsGrant':value=this.diagnosticsGrant(request,authority);break;
        case 'diagnosticsRead':value=await this.diagnosticsRead(request,authority,signal);break;
        case 'diagnosticsRevoke':value=this.diagnosticsRevoke(request,authority);break;
        case 'writingMode':case 'writingModeSave':
          if(!authority.principal||authority.allowGlobalSettings!==true)fail('WRITING_MODE_DENIED','寫作方式只供已驗證的舞臺操作者使用。');
          this.requireRun(request.runId);if(this.closing)fail('HOST_CLOSING');
          if(request.action==='writingMode')value={...await this.engine.writingMode(request.runId),availability:await writingModeAvailability()};
          else{const work=this.engine.updateWritingMode({...request,signal});this.writingModeSaves??=new Set();this.writingModeSaves.add(work);try{value=await work;}finally{this.writingModeSaves.delete(work);}}break;
        case 'proseStyle':case 'proseStyleSave':case 'writingStylesImport':
          if(!authority.principal||authority.allowGlobalSettings!==true)fail('PROSE_STYLE_DENIED','文風設定只供已驗證的舞臺操作者使用。');
          this.requireRun(request.runId);if(this.closing)fail('HOST_CLOSING');
          if(request.action==='proseStyle'){const config=await this.engine.proseStyle(request.runId);value={...config,library:await writingStyleLibraryView(this.engine.store),selectionAvailability:await styleSelectionAvailability(this.engine.store,config.skill)};}
          else if(request.action==='writingStylesImport'){const work=importWritingStylePack(this.engine.store,{...request,signal});this.proseStyleSaves??=new Set();this.proseStyleSaves.add(work);try{value=await work;}finally{this.proseStyleSaves.delete(work);}}
          else{const work=this.engine.updateProseStyle({...request,signal});this.proseStyleSaves??=new Set();this.proseStyleSaves.add(work);try{value=await work;}finally{this.proseStyleSaves.delete(work);}}break;
        case 'banList':value=await this.auxiliaryMutation(request,async()=>publicInspection(await this.engine.updateBanList({runId:request.runId,banList:request.banList,expectedVersion:request.expectedVersion})));break;
        default:fail('ACTION','Unknown SCEAN operation.');
      }
      return {ok:true,value};
    }catch(e){const failure=signal?.aborted?safeFailure({code:'CANCELLED'},'request'):e.sceanFailure??safeFailure(e,'request','SCEAN_ERROR');return {ok:false,error:failure,lastFailure:failure};}
  }
  async close(){this.closing=true;await Promise.allSettled([...(this.proseStyleSaves??[]),...(this.writingModeSaves??[])]);this.chapterProviderSettings?.close();this.chapterAutoArmed.clear();this.writerSummaryArmed.clear();this.chapterContextArmed.clear();const chapterTasks=[...this.chapterRunning.values()].map(o=>o.promise);for(const {controller} of this.chapterRunning.values())controller.abort(Object.assign(new Error('Host closed.'),{code:'CANCELLED'}));for(const {controller} of this.summaryRunning.values())controller.abort();this.agentDiagnostics.rows.clear();this.diagnosticGrants.clear();for(const c of this.running.values())c.abort(Object.assign(new Error('SCEAN plugin unloaded.'),{code:'CANCELLED'}));await this.jobs.close();await Promise.allSettled([...chapterTasks,...(this.chapterBackground??[])]);}
}

import {JobLedger,JOB_PENDING} from './job-ledger.mjs';
import {headOf} from '../core/history.mjs';
import {safeId,hash} from '../core/contracts.mjs';
import {safeFailure} from '../core/engine.mjs';
import {publicTurnResult} from '../core/inspection.mjs';
import {validateChapterSettings} from '../core/chapter-summary.mjs';

export const JOB_OWNER=Symbol('host-admitted-operation');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const copy=value=>JSON.parse(JSON.stringify(value));
const KINDS=new Set(['turn','regenerate','rollback','summaryStart','chapterSummarize','chapterAuto','chapterClose','chapterSettings']);
function normalize(request){
  const {kind,runId,operationId}=request;if(!KINDS.has(kind))fail('OPERATION_KIND');safeId(runId);safeId(operationId);
  const baseVersion=request.baseVersion??request.expectedVersion,baseHead=Object.hasOwn(request,'baseHead')?request.baseHead:request.expectedHead;
  if(!Number.isSafeInteger(baseVersion)||baseVersion<0||!(baseHead===null||typeof baseHead==='string'))fail('HISTORY_EXPECTATION_REQUIRED');
  if(baseHead!==null)safeId(baseHead);
  if(request.expectedVersion!==undefined&&request.expectedVersion!==baseVersion||request.expectedHead!==undefined&&request.expectedHead!==baseHead)fail('HISTORY_EXPECTATION_REQUIRED');
  const input={runId,operationId,expectedVersion:baseVersion,expectedHead:baseHead};let requestId=null,semantic={kind,runId,baseVersion,baseHead};
  if(['turn','regenerate'].includes(kind)){requestId=safeId(request.requestId);input.requestId=requestId;semantic.requestId=requestId;}
  if(kind==='turn'){
    if(typeof request.input!=='string'||!request.input.trim()||request.input.length>20000)fail('INPUT');
    input.input=request.input;input.baseVersion=baseVersion;input.baseHead=baseHead;semantic.input=request.input;
    if(request.viewerId!==undefined)input.viewerId=safeId(request.viewerId);
  }else if(kind!=='regenerate')semantic.operationId=operationId;
  if(kind==='regenerate'){if(request.guidance!==undefined&&(typeof request.guidance!=='string'||request.guidance.length>10000))fail('INVALID_TEXT');input.guidance=request.guidance??'';semantic.guidance=input.guidance;}
  if(kind==='rollback'){if(request.confirmation!=='rollback-last-committed-turn')fail('HISTORY_CONFIRMATION_REQUIRED');input.confirmation=request.confirmation;}
  if(kind==='summaryStart'){
    input.endTurn=request.endTurn??null;input.recentWindow=request.recentWindow??6;
    if(input.endTurn!==null&&(!Number.isInteger(input.endTurn)||input.endTurn<1||input.endTurn>1000)||!Number.isInteger(input.recentWindow)||input.recentWindow<1||input.recentWindow>50)fail('INVALID_RECENT_WINDOW');
    Object.assign(semantic,{endTurn:input.endTurn,recentWindow:input.recentWindow});
  }
  if(kind==='chapterClose'){if(typeof request.title!=='string'||!request.title.trim()||request.title.length>200)fail('INVALID_TEXT');input.title=request.title;semantic.title=input.title;}
  if(kind==='chapterSettings'){
    input.settings=validateChapterSettings(request.settings);semantic.settings=input.settings;
    if(request.writerSummaryEnabled!==undefined){if(typeof request.writerSummaryEnabled!=='boolean')fail('INVALID_CHAPTER_SETTINGS');input.writerSummaryEnabled=request.writerSummaryEnabled;semantic.writerSummaryEnabled=request.writerSummaryEnabled;}
    if(request.chapterContextEnabled!==undefined){if(typeof request.chapterContextEnabled!=='boolean')fail('INVALID_CHAPTER_SETTINGS');input.chapterContextEnabled=request.chapterContextEnabled;semantic.chapterContextEnabled=request.chapterContextEnabled;}
  }
  if(kind==='chapterSummarize'){input.chapterId=safeId(request.chapterId);input.detail=request.detail??null;if(input.detail!==null&&!['concise','auto','precise'].includes(input.detail))fail('INVALID_CHAPTER_SETTINGS');Object.assign(semantic,{chapterId:input.chapterId,detail:input.detail});}
  const canonicalKind={rollback:'rollback',regenerate:'regenerate',summaryStart:'summary',chapterClose:'chapter',chapterSettings:'chapter_settings',chapterAuto:'chapter_auto',chapterSummarize:'chapter_backfill'}[kind];
  const canonical={kind:canonicalKind,runId,operationId,expectedVersion:baseVersion,expectedHead:baseHead};
  if(kind==='regenerate')Object.assign(canonical,{requestId,guidance:input.guidance});
  if(kind==='summaryStart')Object.assign(canonical,{endTurn:input.endTurn,recentWindow:input.recentWindow});
  if(kind==='chapterClose')canonical.title=input.title;
  if(kind==='chapterSettings')canonical.settings=input.settings;
  if(kind==='chapterSummarize')Object.assign(canonical,{chapterId:input.chapterId,detail:input.detail});
  return {input,row:{runId,operationId,requestId,kind,baseVersion,baseHead,fingerprint:hash(semantic),...(kind==='turn'?{inputHash:hash(input.input)}:{canonicalFingerprint:hash(canonical)})}};
}
export class HostJobs {
  constructor(host,options={}){this.host=host;this.ledger=new JobLedger(host.root,options);this.active=new Map();this.admissions=Promise.resolve();}
  async init(){
    await this.ledger.init();
    for(const row of this.ledger.records)if(JOB_PENDING.has(row.status)||row.status==='unknown'){
      const run=await this.host.engine.store.read(row.runId),outcome=this.outcome(row,run);
      // Recovery time is not the time an interrupted operation finished.
      if(!row.finishedAt)row.timingEndMissing=true;
      Object.assign(row,{status:outcome?.status??'interrupted',finishedAt:row.finishedAt??new Date(this.host.now()).toISOString(),recovery:outcome?'canonical_receipt_reconciled':'host_interrupted_no_replay'});
      if(outcome?.binding)Object.assign(row,outcome.binding);
      if(!outcome)row.failure=safeFailure({code:'HOST_INTERRUPTED_NO_AUTORETRY'},'request');
    }
    await this.ledger.persist();return this;
  }
  turnRequestOutcome(row,run){
    const receipt=run.receipts?.[row.requestId];if(!receipt)return null;
    if(receipt.inputHash!==row.inputHash)fail('IDEMPOTENCY_CONFLICT');
    if(receipt.status==='retired'){
      const owner=this.ledger.records.findLast(value=>value.runId===row.runId&&value.kind==='turn'&&value.requestId===row.requestId&&value.attemptId===receipt.attemptId&&value.commitId===receipt.commitId);
      return {status:'retired',operationId:owner?.operationId??null,attemptId:receipt.attemptId??null,commitId:receipt.commitId};
    }
    const turn=run.turns.find(value=>value.commitId===receipt.commitId&&value.requestId===row.requestId),result=receipt.result;
    if(!turn||!turn.attemptId||receipt.attemptId!==turn.attemptId||result?.trace?.attemptId!==turn.attemptId||result.commitId!==turn.commitId||result.requestId!==row.requestId)return {status:'unknown'};
    return {status:'committed',operationId:result.trace.operationId??null,attemptId:turn.attemptId,commitId:turn.commitId};
  }
  outcome(row,run){
    if(row.kind==='turn'){
      const request=this.turnRequestOutcome(row,run);if(!request)return null;
      // requestId survives an explicit retry; operationId and attemptId do not.
      // A later attempt's receipt must never relabel an earlier failed/cancelled
      // operation or expose its body as the earlier operation's result.
      if(request.status==='retired')return row.attemptId===request.attemptId&&row.commitId===request.commitId?{status:'retired',result:{status:'retired',commitId:request.commitId},binding:{attemptId:request.attemptId,commitId:request.commitId}}:null;
      if(request.status==='unknown')return run.receipts[row.requestId]?.result?.trace?.operationId===row.operationId?{status:'unknown'}:null;
      if(request.operationId!==row.operationId)return null;
      return {status:'committed',result:publicTurnResult(run.receipts[row.requestId].result),binding:{attemptId:request.attemptId,commitId:request.commitId}};
    }
    const operation=run.operationReceipts?.[row.operationId]??run.narrative?.operations?.[row.operationId];
    if(!operation)return null;
    if(operation.fingerprint!==row.canonicalFingerprint)fail('OPERATION_ID_CONFLICT');
    if(operation.status==='pending')return null;
    const result=operation.result;if(!result)return null;
    return {status:result.status,result:row.kind==='regenerate'?{...publicTurnResult(result),...Object.fromEntries(['kind','operationId','head','retiredCommitId','retiredBy','retiredAtVersion'].filter(k=>result[k]!==undefined).map(k=>[k,result[k]]))}:copy(result)};
  }
  generationTiming(row,run){
    // A later background summary must not extend or replace the last turn's clock.
    const target=['turn','regenerate'].includes(row?.kind)?row:this.ledger.records.findLast(r=>r.runId===run.runId&&['turn','regenerate'].includes(r.kind));
    if(!target)return null;
    const outcome=this.outcome(target,run),progress=this.host.progressByRun.get(run.runId);
    const attemptId=outcome?.binding?.attemptId??target.attemptId??(progress?.operationId===target.operationId&&progress?.requestId===target.requestId?progress.attemptId:null);
    const finishing=outcome?.status==='committed'&&!target.finishedAt&&this.active.get(run.runId)?.row===target;
    return {scope:'host_operation',runId:run.runId,operationId:target.operationId,requestId:target.requestId,attemptId:attemptId??null,kind:target.kind,
      status:finishing?'running':outcome?.status??target.status,startedAt:target.acceptedAt,finishedAt:target.timingEndMissing?null:target.finishedAt??null,serverNow:new Date(this.host.now()).toISOString()};
  }
  async view(row,run){
    run??=await this.host.engine.store.read(row?.runId);
    const outcome=row?this.outcome(row,run):null,requestOutcome=row?.kind==='turn'?this.turnRequestOutcome(row,run):null,owner=this.active.get(run.runId),progress=this.host.progressByRun.get(run.runId);
    const ownedProgress=owner?.row===row&&progress?.operationId===row?.operationId&&progress?.requestId===row?.requestId?progress:null;
    const interrupted=row?.recovery==='host_shutdown_no_replay'&&!['committed','completed','retired'].includes(outcome?.status);
    const status=interrupted?'interrupted':outcome?.status??row?.status??'not_recorded';
    return {runId:run.runId,operationId:row?.operationId??null,requestId:row?.requestId??null,kind:row?.kind??null,status,pending:!!row&&JOB_PENDING.has(status),canonical:{version:run.version,head:headOf(run)},
      ...(row?{acceptedAt:row.acceptedAt,...(row.finishedAt?{finishedAt:row.finishedAt}:{}),...(row.recovery?{recovery:row.recovery}:{}),...(!['committed','completed','retired'].includes(status)&&row.failure?{failure:copy(row.failure)}:{})}:{}),
      ...(outcome?.result?{result:outcome.result}:{}),...(requestOutcome?{requestOutcome}:{}),...(ownedProgress?{attemptId:ownedProgress.attemptId??null,stage:ownedProgress.stage,sequence:ownedProgress.sequence}:row?.attemptId?{attemptId:row.attemptId}:{}),
      generationTiming:this.generationTiming(row,run),...(row?{}:{pending:this.host.mutationBusy(run.runId)})};
  }
  async status(request){
    this.host.requireRun(request.runId);if(request.operationId!==undefined)safeId(request.operationId);if(request.requestId!==undefined)safeId(request.requestId);
    const records=this.ledger.records.filter(row=>row.runId===request.runId),row=records.findLast(row=>(request.operationId===undefined||row.operationId===request.operationId)&&(request.requestId===undefined||row.requestId===request.requestId))??null;
    const identified=request.operationId!==undefined||request.requestId!==undefined;
    if(identified&&!row&&request.operationId!==undefined&&request.requestId===undefined){
      const run=await this.host.engine.store.read(request.runId),op=run.narrative?.operations?.[request.operationId];
      if(op&&['summary','chapter_auto'].includes(op.kind))return {runId:run.runId,operationId:op.operationId,requestId:null,kind:op.kind==='summary'?'summaryStart':'chapterAuto',status:op.status,pending:op.status==='pending',canonical:{version:run.version,head:headOf(run)},...(op.result?{result:copy(op.result)}:{})};
    }
    const view=await this.view(identified?row:records.at(-1)??null,await this.host.engine.store.read(request.runId));
    return identified&&!row?{...view,status:'not_found',pending:false,operationId:request.operationId??null,requestId:request.requestId??null,generationTiming:null}:view;
  }
  submit(request,signal){
    const admission=this.admissions.catch(()=>{}).then(()=>this.admit(request,signal));this.admissions=admission;return admission;
  }
  async admit(request,signal){
    signal?.throwIfAborted();if(this.host.closing)fail('HOST_CLOSING');
    const {row,input}=normalize(request);this.host.requireRun(row.runId);
    const operation=this.ledger.records.find(r=>r.runId===row.runId&&r.operationId===row.operationId),priorRequest=row.requestId?this.ledger.records.findLast(r=>r.runId===row.runId&&r.requestId===row.requestId):null;
    const existing=operation??priorRequest;
    if(existing){
      if(existing.fingerprint!==row.fingerprint)fail(priorRequest?'IDEMPOTENCY_CONFLICT':'OPERATION_ID_CONFLICT');
      if(operation||request.retryOf===undefined)return this.view(existing);
      safeId(request.retryOf);
      if(request.retryOf!==priorRequest.operationId||!['failed','cancelled','interrupted'].includes(priorRequest.status))fail('OPERATION_RETRY_CONFLICT');
      if(this.outcome(priorRequest,await this.host.engine.store.read(row.runId)))return this.view(priorRequest);
      row.retryOf=request.retryOf;
    }else if(request.retryOf!==undefined)fail('OPERATION_RETRY_CONFLICT');
    if(this.ledger.records.length>=this.ledger.capacity)fail('HOST_JOB_CAPACITY');
    this.host.assertMutationAvailable(row.runId);
    const run=await this.host.engine.store.withRunLock(row.runId,async()=>{
      signal?.throwIfAborted();const run=await this.host.engine.store.read(row.runId),outcome=this.outcome(row,run),requestOutcome=row.kind==='turn'?this.turnRequestOutcome(row,run):null;
      // Admission may have waited behind another Run. A delete+restore during
      // that wait must not admit a stale page even when story head is unchanged.
      if((request.expectedLifecycleRevision??0)!==(run.recycle?.revision??0))fail('RUN_LIFECYCLE_CHANGED');
      if(requestOutcome?.status==='retired')fail('REQUEST_RETIRED');
      if(!outcome&&!requestOutcome){if(run.version!==row.baseVersion)fail('VERSION_CONFLICT');if(headOf(run)!==row.baseHead)fail('HISTORY_HEAD_CONFLICT');}
      return run;
    },{signal});
    // Admission and reservation precede the first await after checking the maps.
    this.host.assertMutationAvailable(row.runId);signal?.throwIfAborted();
    const requestOutcome=row.kind==='turn'?this.turnRequestOutcome(row,run):null;
    if(requestOutcome?.status==='committed'&&requestOutcome.operationId&&requestOutcome.operationId!==row.operationId){
      safeId(requestOutcome.operationId);
      if(this.ledger.records.some(value=>value.runId===row.runId&&value.operationId===requestOutcome.operationId))fail('OPERATION_ID_CONFLICT');
      row.operationId=requestOutcome.operationId;input.operationId=requestOutcome.operationId;
    }
    const outcome=this.outcome(row,run);Object.assign(row,{status:outcome?.status??(requestOutcome?'unknown':'accepted'),acceptedAt:new Date(this.host.now()).toISOString()});
    if(outcome?.binding)Object.assign(row,outcome.binding);
    const owner={row,controller:new AbortController(),promise:null};this.active.set(row.runId,owner);this.ledger.records.push(row);
    try{await this.ledger.persist();}
    catch(error){row.status='interrupted';row.failure=safeFailure({code:'HOST_JOB_LEDGER'},'request');this.active.delete(row.runId);throw Object.assign(error,{code:'HOST_JOB_LEDGER'});}
    if(outcome||requestOutcome){this.active.delete(row.runId);return this.view(row,run);}
    // From this point the caller's HTTP/RPC signal is deliberately disconnected.
    // The only cancellation sources are an exact operator cancel or Host close.
    owner.promise=new Promise(resolve=>setImmediate(resolve)).then(()=>this.execute(owner,input));
    owner.promise.catch(()=>{});return this.view(row,run);
  }
  async execute(owner,input){
    const {row,controller}=owner;
    try{
      if(controller.signal.aborted)fail('CANCELLED');row.status='running';await this.ledger.persist();
      const request={...input,[JOB_OWNER]:owner},host=this.host;let result;
      if(row.kind==='turn')result=await host.turn({...request,signal:controller.signal});
      else if(['rollback','regenerate'].includes(row.kind))result=await host.historyMutation(row.kind,request,controller.signal);
      else if(row.kind==='summaryStart')result=await host.summaryStart(request,controller.signal);
      else if(['chapterAuto','chapterSummarize'].includes(row.kind))result=await host.chapterStart(row.kind,request,controller.signal);
      else result=await host[row.kind](request,controller.signal);
      row.status=result.status??'completed';
    }catch(error){
      const shutdown=controller.signal.aborted&&owner.cancelSource==='host_shutdown';
      row.status=controller.signal.aborted?(shutdown?'interrupted':'cancelled'):'failed';row.failure=shutdown?safeFailure({code:'HOST_SHUTDOWN'},row.kind):error.sceanFailure??safeFailure(error,row.kind);
      if(shutdown)row.recovery='host_shutdown_no_replay';
    }
    finally{
      const progress=this.host.progressByRun.get(row.runId);if(progress?.operationId===row.operationId&&progress?.requestId===row.requestId&&progress.attemptId)row.attemptId=progress.attemptId;
      try{const outcome=this.outcome(row,await this.host.engine.store.read(row.runId));if(outcome){if(row.recovery!=='host_shutdown_no_replay'||['committed','completed','retired'].includes(outcome.status))row.status=outcome.status;if(outcome.binding)Object.assign(row,outcome.binding);if(['committed','completed','retired'].includes(outcome.status))delete row.failure;}}
      catch{row.status='unknown';row.failure=safeFailure({code:'COMMIT_OUTCOME_UNKNOWN'},row.kind);}
      row.finishedAt=new Date(this.host.now()).toISOString();
      await this.ledger.persist().catch(()=>{row.recovery='ledger_write_pending_canonical_reconciliation';});
      if(this.active.get(row.runId)===owner)this.active.delete(row.runId);
    }
  }
  cancel(request){
    const owner=this.active.get(request.runId);if(!owner)return null;
    const {row}=owner,attemptId=this.host.activeOperations.get(request.runId)?.attemptId??null;
    const rejected=reason=>({runId:request.runId,cancelRequested:false,status:'not_called',reason});
    if(request.operationId===undefined&&(typeof request.attemptId!=='string'||!request.attemptId))return rejected('identity_required');
    if(request.operationId!==undefined&&request.operationId!==row.operationId)return rejected('operation_mismatch');
    if(request.requestId!==undefined&&request.requestId!==row.requestId)return rejected('request_mismatch');
    if(request.attemptId!==undefined&&request.attemptId!==attemptId)return rejected('attempt_mismatch');
    row.status='cancel-requested';owner.cancelSource='explicit';owner.controller.abort(Object.assign(new Error('Explicit operation cancel.'),{code:'CANCELLED'}));this.ledger.persist().catch(()=>{});
    return {runId:row.runId,operationId:row.operationId,requestId:row.requestId,attemptId,cancelRequested:true,status:'pending'};
  }
  async close(){for(const owner of this.active.values()){owner.cancelSource??='host_shutdown';owner.controller.abort(Object.assign(new Error('Host closed.'),{code:'CANCELLED'}));}await Promise.allSettled([...this.active.values()].map(owner=>owner.promise));await this.ledger.queue.catch(()=>{});}
}

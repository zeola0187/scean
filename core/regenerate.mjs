import {SceanError,clone,safeId,checkAbort,text} from './contracts.mjs';
import {historyRequest,retireHead,publishHistory,headOf} from './history.mjs';

/** Generate with the unchanged pipeline against an in-memory predecessor. */
export async function regenerateLast(engine,request){
  safeId(request.runId);safeId(request.requestId);
  if(request.guidance!==undefined&&request.guidance!=='')text(request.guidance,10000);
  checkAbort(request.signal);
  return engine.store.withRunLock(request.runId,async()=>{
    const run=await engine.store.read(request.runId),checked=historyRequest(run,request,'regenerate');
    if(checked.receipt)return checked.receipt;
    if(run.receipts?.[request.requestId])throw new SceanError(run.receipts[request.requestId].status==='retired'?'REQUEST_RETIRED':'IDEMPOTENCY_CONFLICT');
    const original=run.turns.at(-1),attempts=new Map();
    const proseStyle=await engine.proseStyle(run.runId),writingMode=await engine.writingMode(run.runId);
    let candidate=retireHead(run,{operationId:request.operationId,reason:'regenerate'});
    // Version stays at current v; only context is from the preceding story head.
    const virtual={
      provisionalTemporalRestore:candidate.storyClock?.sourceRef,
      root:engine.store.root,settlementDispatches:(...a)=>engine.store.settlementDispatches(...a),reserveSettlementDispatch:(...a)=>engine.store.reserveSettlementDispatch(...a),readAttempt:(...a)=>engine.store.readAttempt(...a),
      withRunLock:async(_id,fn)=>fn(),read:async()=>({...clone(candidate),proseStyle:clone(proseStyle),writingMode:clone(writingMode)}),recoverAttempts:async()=>{},readAttempts:async()=>engine.store.readAttempts(run.runId),
      writeAttempt:async(_id,attempt)=>{attempts.set(attempt.attemptId,clone(attempt));await engine.store.writeAttempt(run.runId,{...clone(attempt),provisional:true});},
      commit:async(_id,version,next,{signal}={})=>{checkAbort(signal);if(version!==run.version||next.version!==run.version+1)throw new SceanError('VERSION_CONFLICT');candidate=clone(next);for(const key of ['proseStyle','writingMode']){if(Object.hasOwn(run,key))candidate[key]=clone(run[key]);else delete candidate[key];}return clone(candidate);},
    };
    const isolated=new engine.constructor({store:virtual,model:engine.model,memory:engine.memory,chapterRecall:engine.chapterRecall,recentWindow:engine.recentWindow,unconfiguredWritingMode:engine.unconfiguredWritingMode,postBody:engine.postBody});
    const progress=event=>{try{request.onProgress?.({...event,provisional:true,...(event.stage==='commit'&&event.status==='committed'?{status:'validated'}:{})});}catch{}};
    const persistAttempts=async status=>{for(const attempt of attempts.values()){
      attempt.status=status;attempt.provisional=status!=='committed';
      if(attempt.commit)attempt.commit.status=status;
      if(status==='failed'||status==='cancelled')attempt.error={code:status==='cancelled'?'CANCELLED':'REGENERATION_NOT_PUBLISHED',stage:'regenerate'};
      await engine.store.writeAttempt(run.runId,attempt).catch(()=>{});
    }};
    try{
      const generated=await isolated.turn({runId:run.runId,input:original.input,requestId:request.requestId,operationId:request.operationId,writingGuidance:request.guidance??'',chapterContextEnabled:request.chapterContextEnabled===true,signal:request.signal,onProgress:progress});
      checkAbort(request.signal);
      candidate.retired.at(-1).replacedBy=generated.commitId;
      const result={...generated,kind:'regenerate',operationId:request.operationId,head:generated.commitId,retiredCommitId:headOf(run)};
      candidate.operationReceipts[request.operationId]={kind:'regenerate',request:checked.semantic,fingerprint:checked.fingerprint,result};
      const published=await publishHistory(engine,run,candidate,request.operationId,request.signal);
      await persistAttempts('committed');
      try{request.onProgress?.({runId:run.runId,requestId:request.requestId,operationId:request.operationId,attemptId:generated.trace.attemptId,stage:'commit',status:'committed',provisional:false});}catch{}
      return published;
    }catch(error){await persistAttempts(request.signal?.aborted?'cancelled':'failed');throw error;}
  },{signal:request.signal});
}

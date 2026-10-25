import {retireWorldRoutine} from './world-routine.mjs';
import {temporalRestore} from './state-operations.mjs';
import {invalidateNarrative} from './narrative.mjs';
import {SceanError,clone,hash,safeId,checkAbort,json} from './contracts.mjs';

export const HISTORY_LIMITS=Object.freeze({turns:1000,retired:256,receipts:4096,operationReceipts:4096});
export const headOf=run=>run.head===undefined?(run.turns?.at(-1)?.commitId??null):run.head;
const fail=code=>{throw new SceanError(code);};
export function assertHistoryCapacity(run,{retire=false,operation=false,turn=false,extraReceipt=false}={}){
  if(!Number.isSafeInteger(run.version)||run.version<0||run.version===Number.MAX_SAFE_INTEGER)fail('HISTORY_CAPACITY_EXCEEDED');
  if((run.turns?.length??0)+(turn?1:0)>HISTORY_LIMITS.turns||Object.keys(run.receipts??{}).length+Object.keys(run.operationReceipts??{}).length+Object.keys(run.narrative?.operations??{}).length+(turn?1:0)+(operation?1:0)+(extraReceipt?1:0)>HISTORY_LIMITS.receipts||
    (run.retired?.length??0)+(retire?1:0)>HISTORY_LIMITS.retired||Object.keys(run.operationReceipts??{}).length+(operation?1:0)>HISTORY_LIMITS.operationReceipts)fail('HISTORY_CAPACITY_EXCEEDED');
}
export function historyRequest(run,request,kind){
  safeId(request.operationId);
  const semantic={kind,runId:run.runId,operationId:request.operationId,expectedVersion:request.expectedVersion,expectedHead:request.expectedHead,
    ...(kind==='regenerate'?{requestId:request.requestId,guidance:request.guidance??''}:{})};
  if(!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<0||!(request.expectedHead===null||typeof request.expectedHead==='string'))fail('HISTORY_EXPECTATION_REQUIRED');
  if(request.expectedHead!==null)safeId(request.expectedHead);
  if(run.narrative?.operations?.[request.operationId])fail('OPERATION_ID_CONFLICT');
  const fingerprint=hash(semantic),receipt=run.operationReceipts?.[request.operationId];
  if(receipt){if(receipt.fingerprint!==fingerprint||receipt.kind!==kind)fail('OPERATION_ID_CONFLICT');return {receipt:clone(receipt.result),fingerprint};}
  if(run.version!==request.expectedVersion)fail('VERSION_CONFLICT');
  if(headOf(run)!==request.expectedHead)fail('HISTORY_HEAD_CONFLICT');
  if(!run.turns?.length)fail('NO_COMMITTED_TURN');
  assertHistoryCapacity(run,{retire:true,operation:true,extraReceipt:kind==='regenerate'});return {fingerprint,semantic};
}
/** Construct the predecessor without publishing or modifying the input aggregate. */
export function retireHead(run,{operationId,reason,replacedBy=null,version=run.version+1}){
  const target=run.turns?.at(-1);if(!target)fail('NO_COMMITTED_TURN');
  if(headOf(run)!==target.commitId||hash(run.state)!==hash(target.stateAfter))fail('HISTORY_INCONSISTENT');
  const predecessor=run.turns.at(-2)?.stateAfter??run.baselineState;
  if(predecessor&&hash(target.stateBefore)!==hash(predecessor))fail('HISTORY_INCONSISTENT');
  if(target.stateProvenanceAfter&&json(run.stateProvenance)!==json(target.stateProvenanceAfter))fail('HISTORY_INCONSISTENT');
  const owns=(records,ids)=>{
    if(!Array.isArray(ids)||new Set(ids).size!==ids.length)fail('HISTORY_INCONSISTENT');
    const actual=records.filter(r=>r.source?.commitId===target.commitId).map(r=>r.id).sort();
    if(json(actual)!==json([...ids].sort()))fail('HISTORY_INCONSISTENT');
    return records.filter(r=>!ids.includes(r.id));
  };
  const next=clone(run),receipt=next.receipts?.[target.requestId];
  if(!receipt||receipt.commitId!==target.commitId||receipt.status==='retired')fail('HISTORY_INCONSISTENT');
  next.memories=owns(next.memories,target.memoryIds);
  next.playerHistory=owns(next.playerHistory??[],target.playerHistoryIds??[]);
  next.state=clone(target.stateBefore);next.turns.pop();next.head=next.turns.at(-1)?.commitId??null;
  if(next.stateProvenance!==undefined){
    const prior=next.stateProvenance.filter(row=>row.source?.id!==target.commitId);
    if(target.stateProvenanceBefore&&json(prior)!==json(target.stateProvenanceBefore))fail('HISTORY_INCONSISTENT');
    next.stateProvenance=prior;
  }
  next.receipts[target.requestId]={status:'retired',inputHash:receipt.inputHash,commitId:receipt.commitId,attemptId:receipt.attemptId??target.attemptId,retiredBy:operationId,retiredAtVersion:version};
  next.operationReceipts??={};
  for(const row of Object.values(next.operationReceipts))if(row.result?.commitId===target.commitId){
    row.result={...Object.fromEntries(['kind','runId','operationId','version','head','retiredCommitId','requestId','commitId'].filter(k=>row.result[k]!==undefined).map(k=>[k,row.result[k]])),status:'retired',retiredBy:operationId,retiredAtVersion:version};
  }
  next.retired=[...(next.retired??[]),{commitId:target.commitId,requestId:target.requestId,attemptId:target.attemptId,turn:target.turn,...(run.storyClock?{worldActivityBefore:clone(target.worldActivityBefore),worldActivityAfter:clone(target.worldActivityAfter),...(target.timeResolution?.calendarCut?{calendarCut:clone(target.timeResolution.calendarCut)}:{})}:{}),bodyHash:target.bodyHash,reason,operationId,retiredAtVersion:version,replacedBy}];
  temporalRestore(run,next,target,operationId);retireWorldRoutine(next,operationId);
  return invalidateNarrative(next);
}
export async function publishHistory(engine,run,next,operationId,signal){
  checkAbort(signal);
  try{await engine.store.commit(run.runId,run.version,next,{signal});}
  catch(error){
    let recovered;try{recovered=await engine.store.read(run.runId);}catch{throw new SceanError('COMMIT_OUTCOME_UNKNOWN');}
    const receipt=recovered.operationReceipts?.[operationId];
    if(!receipt||receipt.fingerprint!==next.operationReceipts[operationId].fingerprint)throw error;
    engine.memory.clearCache?.();return clone(receipt.result);
  }
  engine.memory.clearCache?.();return clone(next.operationReceipts[operationId].result);
}
export async function rollbackLast(engine,request){
  safeId(request.runId);checkAbort(request.signal);
  return engine.store.withRunLock(request.runId,async()=>{
    const run=await engine.store.read(request.runId),checked=historyRequest(run,request,'rollback');
    if(checked.receipt)return checked.receipt;
    const next=retireHead(run,{operationId:request.operationId,reason:'rollback'});
    next.version=run.version+1;next.updatedAt=new Date().toISOString();
    const result={status:'committed',kind:'rollback',runId:run.runId,operationId:request.operationId,version:next.version,head:next.head,retiredCommitId:headOf(run)};
    next.operationReceipts[request.operationId]={kind:'rollback',request:checked.semantic,fingerprint:checked.fingerprint,result};
    return publishHistory(engine,run,next,request.operationId,request.signal);
  },{signal:request.signal});
}

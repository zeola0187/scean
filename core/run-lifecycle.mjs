// Recoverable Run lifecycle lives in the canonical aggregate. Story version,
// Snapshot, body, State and Memory are never rewritten by these transitions.
import {clone,hash,safeId,checkAbort,SceanError} from './contracts.mjs';
const fail=code=>{throw new SceanError(code);};
export function runLifecycle(run){
 const value=run.recycle;
 if(value===undefined)return {schemaVersion:1,revision:0,status:'active',receipts:[]};
 if(!value||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!['active','trashed'].includes(value.status)||!Array.isArray(value.receipts)||value.receipts.length!==value.revision||value.receipts.length>1024||!Number.isFinite(Date.parse(value.changedAt)))fail('RUN_LIFECYCLE_CORRUPT');
 const seen=new Set();for(const [i,row]of value.receipts.entries()){if(!row||row.revision!==i+1||!['trash','restore'].includes(row.action)||!/^[a-f0-9]{64}$/.test(row.fingerprint??'')||!Number.isFinite(Date.parse(row.at))||seen.has(row.operationId))fail('RUN_LIFECYCLE_CORRUPT');safeId(row.operationId);seen.add(row.operationId);}
 if(value.status!==(value.receipts.at(-1)?.action==='trash'?'trashed':'active'))fail('RUN_LIFECYCLE_CORRUPT');
 return clone(value);
}
export function assertRunActive(run){if(runLifecycle(run).status!=='active')fail('RUN_TRASHED');return run;}
export function lifecycleView(run,operationId){
 const life=runLifecycle(run),receipt=operationId?life.receipts.find(row=>row.operationId===operationId):null;
 return {runId:run.runId,status:life.status,lifecycleRevision:life.revision,version:run.version,head:run.head??null,...(life.changedAt?{changedAt:life.changedAt}:{}),...(operationId?{operationId,operationStatus:receipt?'committed':'not_found',...(receipt?{appliedLifecycleRevision:receipt.revision,action:receipt.action}:{})}:{})};
}
export async function changeRunLifecycle(store,{runId,action,operationId,expectedLifecycleRevision,expectedVersion,expectedHead,confirmed,signal,now=Date.now}){
 safeId(runId);safeId(operationId);if(!['trash','restore'].includes(action))fail('RUN_LIFECYCLE_ACTION');
 if(confirmed!==true)fail('RUN_LIFECYCLE_CONFIRM_REQUIRED');
 if(!Number.isSafeInteger(expectedLifecycleRevision)||expectedLifecycleRevision<0||!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!(expectedHead===null||typeof expectedHead==='string'))fail('RUN_LIFECYCLE_EXPECTATION_REQUIRED');
 const fingerprint=hash({runId,action,operationId,expectedLifecycleRevision,expectedVersion,expectedHead});
 // Share the canonical writer fence; also exclude the existing independent
 // editorial saves without changing their normal in-generation behavior.
 return store.withRunLock(runId,()=>store.withRunLock(runId,()=>store.withRunLock(runId,async()=>{
  checkAbort(signal);const run=await store.read(runId,{includeTrashed:true}),life=runLifecycle(run),receipt=life.receipts.find(row=>row.operationId===operationId);
  if(receipt){if(receipt.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return {...lifecycleView(run,operationId),replayed:true};}
  if(life.revision!==expectedLifecycleRevision)fail('RUN_LIFECYCLE_CHANGED');
  if(run.version!==expectedVersion)fail('VERSION_CONFLICT');if((run.head??null)!==expectedHead)fail('HISTORY_HEAD_CONFLICT');
  if(life.status!==(action==='trash'?'active':'trashed'))fail('RUN_LIFECYCLE_CHANGED');
  if(life.receipts.length>=1024)fail('RUN_LIFECYCLE_CAPACITY');
  if((await store.readAttempts(runId)).some(row=>row.status==='pending')||Object.values(run.narrative?.operations??{}).some(row=>row.status==='pending'))fail('RUN_LIFECYCLE_UNRESOLVED');
  if(Object.values(run.receipts??{}).some(row=>row.status!=='retired'&&!run.turns.some(t=>t.commitId===row.commitId)))fail('RUN_LIFECYCLE_UNRESOLVED');
  const at=new Date(now()).toISOString(),revision=life.revision+1;
  const next={...run,recycle:{schemaVersion:1,revision,status:action==='trash'?'trashed':'active',changedAt:at,receipts:[...life.receipts,{operationId,action,revision,at,fingerprint}]}};
  try{await store.atomic(store.currentFile(runId),next,{signal,commit:true});}
  catch(error){let actual;try{actual=await store.read(runId,{includeTrashed:true});}catch{fail('RUN_LIFECYCLE_OUTCOME_UNKNOWN');}
   if(runLifecycle(actual).receipts.some(row=>row.operationId===operationId&&row.fingerprint===fingerprint))return {...lifecycleView(actual,operationId),recovered:true};throw error;
  }
  return lifecycleView(next,operationId);
 },{signal,namespace:'writing-mode'}),{signal,namespace:'prose-style'}),{signal});
}

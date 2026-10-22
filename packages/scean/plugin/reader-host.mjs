import {safeId,SceanError} from '../core/contracts.mjs';
import {collaborationView,attemptCanonical} from '../core/collaboration-reader.mjs';
import {ownerWorldbook} from '../core/owner-worldbook.mjs';
import {runLifecycle} from '../core/run-lifecycle.mjs';
import {sameCardContext,sameCardScope,snapshotCardScope} from './card-scope.mjs';
const fail=code=>{throw new SceanError(code);};
export const OPERATOR_READ_ACTIONS=new Set(['playerCollaboration','ownerWorldbook']);
export function requireReaderAuthority(action,authority){
 if(!authority.principal||authority.allowGlobalSettings!==true||action==='ownerWorldbook'&&authority.allowPrivateDiagnostics!==true)fail('PLAYER_READER_DENIED');
}
const generation=row=>['turn','regenerate'].includes(row?.kind);
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?v:null;
function metadata(row){return {operationId:row.operationId,attemptId:row.attemptId??null,kind:row.kind,status:row.status??'not_recorded',acceptedAt:stamp(row.acceptedAt),finishedAt:stamp(row.finishedAt)};}
/** UI-only bounded read adapter. No recovery, audit append, grant, or model call. */
export class PlayerReaders {
 constructor(host){this.host=host;this.reading=0;}
 async read(request,signal,authority,scope){
  requireReaderAuthority(request.action,authority);signal?.throwIfAborted();
  const host=this.host;host.requireRun(request.runId);safeId(request.runId);
  if(this.reading>=4)fail('PLAYER_READER_BUSY');this.reading++;
  try{
   const before=await host.engine.store.read(request.runId),life=runLifecycle(before);
   if(request.expectedLifecycleRevision!==undefined&&request.expectedLifecycleRevision!==life.revision)fail('RUN_LIFECYCLE_CHANGED');
   const principal=authority.principal;
   const confirm=async()=>{
    signal?.throwIfAborted();requireReaderAuthority(request.action,authority);
    if(authority.principal!==principal)fail('PLAYER_READER_DENIED');
    const latest=await host.engine.store.read(request.runId);signal?.throwIfAborted();
    if(latest.snapshot.hash!==before.snapshot.hash||runLifecycle(latest).revision!==life.revision)fail('READER_SOURCE_CHANGED');
    if(authority.requireCardScope){const current=await authority.resolveCardScope?.(request.sessionId);if(!sameCardContext(scope,current)||!sameCardContext(current,request.cardScope))fail('CARD_CONTEXT_CHANGED');}
    // Scope resolution is asynchronous; recycle/restore may have occurred while
    // it waited. Finish with a fresh canonical source/lifecycle check.
    const final=authority.requireCardScope?await host.engine.store.read(request.runId):latest;
    if(final.snapshot.hash!==before.snapshot.hash||runLifecycle(final).revision!==life.revision)fail('READER_SOURCE_CHANGED');
    signal?.throwIfAborted();requireReaderAuthority(request.action,authority);if(authority.principal!==principal)fail('PLAYER_READER_DENIED');
    if(authority.requireCardScope&&!sameCardScope(scope,snapshotCardScope(latest.snapshot)))fail('CARD_SCOPE_MISMATCH');
    return final;
   };
   if(request.action==='ownerWorldbook'){const value=ownerWorldbook(before,request);await confirm();return value;}
   const rows=(host.jobs?.ledger?.records??[]).filter(row=>row.runId===request.runId&&generation(row));
   const progress=host.progressByRun?.get(request.runId);
   const withAttempt=row=>({...row,attemptId:row.attemptId??(progress?.operationId===row.operationId&&progress?.requestId===row.requestId?progress.attemptId:null)});
   const operations=rows.slice(-100).map(withAttempt);
   let operation=null,attemptId=request.attemptId??null;
   if(request.operationId!==undefined){safeId(request.operationId);operation=operations.find(row=>row.operationId===request.operationId)??rows.find(row=>row.operationId===request.operationId);if(!operation)return collaborationView(await confirm(),{sourceStatus:'association_unknown',reason:'operation_not_recorded_for_run'},request);operation=withAttempt(operation);}
   if(request.commitId!==undefined){safeId(request.commitId);const turn=(before.turns??[]).find(t=>t.commitId===request.commitId),retired=Object.values(before.receipts??{}).find(r=>r.status==='retired'&&r.commitId===request.commitId);const owner=turn?.attemptId??retired?.attemptId??retired?.result?.trace?.attemptId;if(!owner)return collaborationView(await confirm(),{sourceStatus:'association_unknown',reason:'commit_owner_not_recorded'},request);if(attemptId&&attemptId!==owner)fail('READER_SOURCE_CHANGED');attemptId=owner;}
   if(attemptId)safeId(attemptId);
   if(!operation&&attemptId)operation=operations.find(row=>row.attemptId===attemptId)??null;
   if(!operation&&!attemptId){operation=operations.at(-1)??null;if(!operation)attemptId=before.turns?.at(-1)?.attemptId??null;}
   if(operation){if(attemptId&&operation.attemptId&&attemptId!==operation.attemptId)fail('READER_SOURCE_CHANGED');attemptId??=operation.attemptId;}
   let attempt=null,sourceStatus='not_recorded',reason='no_saved_generation_checkpoint';
   if(attemptId){
    try{attempt=await host.engine.store.readAttempt(request.runId,attemptId);sourceStatus='saved';reason=null;}
    catch(error){
     if(error.code==='ATTEMPT_NOT_FOUND'){sourceStatus=['accepted','running','cancel-requested'].includes(operation?.status)?'source_pending':'source_missing';reason=operation?.kind==='regenerate'?'regenerate_raw_checkpoints_are_in_memory_until_completion':'selected_checkpoint_not_available';}
     else if(['ATTEMPT_CORRUPT','ATTEMPT_TOO_LARGE','ATTEMPT_IDENTITY_MISMATCH'].includes(error.code)){sourceStatus=error.code==='ATTEMPT_IDENTITY_MISMATCH'?'association_unknown':'source_corrupt';reason=error.code;}
     else{sourceStatus='read_failed';reason='checkpoint_read_failed';}
    }
   }else if(operation){sourceStatus=['accepted','running','cancel-requested'].includes(operation.status)?'source_pending':'not_recorded';reason=operation.kind==='regenerate'?'regenerate_raw_checkpoints_are_in_memory_until_completion':'attempt_locator_not_yet_recorded';}
   if(attempt&&operation&&(attempt.requestId!==operation.requestId||attempt.operationId&&attempt.operationId!==operation.operationId)){attempt=null;sourceStatus='association_unknown';reason='attempt_operation_identity_mismatch';}
   const latest=await confirm();
   const choices=operations.slice().reverse().map(row=>{const canonical=row.attemptId?attemptCanonical(latest,row.attemptId,row.requestId):{status:'not_committed'};return {...metadata(row),canonicalStatus:canonical.status,turnLabel:canonical.turn??null};});
   return collaborationView(latest,{attempt,operation,attempts:choices,sourceStatus,reason},request);
  }finally{this.reading--;}
 }
}

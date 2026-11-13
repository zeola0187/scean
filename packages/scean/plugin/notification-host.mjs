import {NotificationLedger} from './notification-ledger.mjs';
import {hash,safeId} from '../core/contracts.mjs';
import {headOf} from '../core/history.mjs';
import {snapshotCardScope,sameCardScope} from './card-scope.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const identity=value=>safeId(value);
/** Canonical receipt validation is the only completion authority. Neither job
 * status, progress, attempt checkpoints nor model callbacks establish success. */
export class HostNotifications {
  constructor(host,options={}){this.host=host;this.ledger=new NotificationLedger(host.root,options);this.watchTtlMs=options.watchTtlMs??86400000;this.deliveryTtlMs=options.deliveryTtlMs??300000;this.claimQueue=Promise.resolve();}
  async init(){await this.ledger.init();return this;}
  scope(request,run){
    const card=snapshotCardScope(run.snapshot);
    if(request.cardScope&&!sameCardScope(request.cardScope,card))fail('CARD_SCOPE_MISMATCH');
    return {sessionId:identity(request.sessionId??'isolated'),cardProvider:card?.provider??'isolated',cardId:identity(card?.cardId??run.snapshot.cardId)};
  }
  matches(row,request,scope){return row.destinationId===request.destinationId&&row.sessionId===scope.sessionId&&row.cardProvider===scope.cardProvider&&row.cardId===scope.cardId;}
  public(row){return {watchId:row.id,runId:row.runId,requestId:row.requestId,kind:row.kind,status:row.status,...(row.reason?{reason:row.reason}:{}),...(row.event?{eventId:row.event.eventId,commitId:row.event.commitId}: {})};}
  async watch(request){
    const {runId,requestId,operationId,kind,baseVersion,baseHead}=request;
    for(const id of [runId,requestId,operationId,request.destinationId])identity(id);
    if(!['turn','regenerate','settlementResume'].includes(kind)||!Number.isSafeInteger(baseVersion)||baseVersion<0||!(baseHead===null||typeof baseHead==='string'))fail('NOTIFICATION_WATCH_INVALID');
    if(baseHead!==null)identity(baseHead);this.host.requireRun(runId);
    // A lost-ACK replay can arrive while the original pipeline owns the Run
    // lock. Its existing watch is readonly and must keep the admitted owner.
    const prior=this.ledger.state?.watches.find(row=>row.id===hash({runId,requestId,kind}));
    if(prior&&(prior.operationId===operationId||request.retryOf===undefined)){
      const scope=this.scope(request,await this.host.engine.store.read(runId));
      return this.matches(prior,request,scope)?this.public(prior):{status:'other_destination'};
    }
    return this.host.engine.store.withRunLock(runId,async()=>{
      const run=await this.host.engine.store.read(runId),scope=this.scope(request,run),now=this.host.now();
      const id=hash({runId,requestId,kind});
      return this.ledger.transaction(next=>{
        const existing=next.watches.find(row=>row.id===id);
        // Replays cannot choose a new destination or reopen a consumed watch.
        if(existing){
          if(!this.matches(existing,request,scope))return {status:'other_destination'};
          if(existing.status==='watching'&&existing.operationId!==operationId&&!run.receipts?.[requestId]&&run.version===baseVersion&&headOf(run)===baseHead){
            const prior=this.host.jobs.ledger.records.find(row=>row.runId===runId&&row.operationId===existing.operationId);
            if(request.retryOf===existing.operationId&&['failed','cancelled','interrupted'].includes(prior?.status))existing.operationId=operationId;
          }
          return this.public(existing);
        }
        // A pre-existing canonical receipt is history, never a new notification.
        if(run.receipts?.[requestId]||run.operationReceipts?.[operationId])return {status:'historical'};
        if(run.version!==baseVersion||headOf(run)!==baseHead)fail('NOTIFICATION_FENCE_STALE');
        if(next.watches.length>=this.ledger.capacity)fail('NOTIFICATION_CAPACITY');
        const row={id,runId,requestId,operationId,kind,destinationId:request.destinationId,...scope,snapshotHash:run.snapshot.hash,baseVersion,baseHead,createdAt:now,expiresAt:now+this.watchTtlMs,status:'watching'};
        next.watches.push(row);return this.public(row);
      });
    });
  }
  canonical(row,run){
    if(run.snapshot.hash!==row.snapshotHash)return {status:'suppressed',reason:'snapshot_changed'};
    const card=snapshotCardScope(run.snapshot);
    if((card?.provider??'isolated')!==row.cardProvider||(card?.cardId??run.snapshot.cardId)!==row.cardId)return {status:'suppressed',reason:'card_changed'};
    const receipt=run.receipts?.[row.requestId];
    if(receipt?.status==='retired')return {status:'suppressed',reason:'retired'};
    if(!receipt)return {status:'watching'};
    const turn=run.turns?.find(value=>value.commitId===receipt.commitId&&value.requestId===row.requestId);
    if(!turn||!turn.attemptId||receipt.attemptId!==turn.attemptId||receipt.result?.trace?.attemptId!==turn.attemptId||receipt.result?.commitId!==turn.commitId||receipt.result?.requestId!==row.requestId||receipt.result?.trace?.operationId!==row.operationId)return {status:'unknown'};
    if(!Number.isSafeInteger(turn.commitVersion)||turn.commitVersion<=row.baseVersion||!Number.isFinite(Date.parse(turn.committedAt)))return {status:'unknown'};
    const job=this.host.jobs.ledger.records.find(value=>value.runId===row.runId&&value.operationId===row.operationId&&value.requestId===row.requestId&&value.kind===row.kind&&value.baseVersion===row.baseVersion&&value.baseHead===row.baseHead);
    if(!job)return {status:'unknown'};
    if(row.kind==='regenerate'){
      const operation=run.operationReceipts?.[row.operationId];
      if(operation?.kind!=='regenerate'||operation.result?.status!=='committed'||operation.result?.commitId!==turn.commitId)return {status:'unknown'};
    }
    return {status:'ready',event:{eventId:hash({storeId:this.ledger.state.storeId,runId:row.runId,commitId:turn.commitId,kind:row.kind}),commitId:turn.commitId,attemptId:turn.attemptId,commitVersion:turn.commitVersion,committedAt:Date.parse(turn.committedAt)}};
  }
  async reconcile(row){
    if(row.status==='suppressed')return row;
    if(this.host.now()>row.expiresAt)return {...row,status:'suppressed',reason:'expired'};
    let result;try{result=this.canonical(row,await this.host.engine.store.read(row.runId));}catch(error){if(error.code==='RUN_TRASHED')return {...row,status:'suppressed',reason:'run_recycled'};return {...row,status:row.status==='consumed'?'consumed':'watching',reason:'outcome_unknown'};}
    if(result.status==='unknown')return {...row,status:row.status==='consumed'?'consumed':'watching',reason:'outcome_unknown'};
    if(result.status==='suppressed')return {...row,...result};
    if(row.status==='consumed')return row;
    if(result.status==='ready'&&this.host.now()-result.event.committedAt>this.deliveryTtlMs)return {...row,event:result.event,status:'suppressed',reason:'delivery_expired'};
    return {...row,...result};
  }
  async status(request){
    identity(request.destinationId);const sessionId=identity(request.sessionId??'isolated');
    if(!this.ledger.available)return {available:false,watches:[],pending:false};
    return this.ledger.transaction(async next=>{
      const visible=[];
      for(let index=0;index<next.watches.length;index++){
        const row=next.watches[index];if(row.destinationId!==request.destinationId||row.sessionId!==sessionId)continue;
        // Native scoped callers may only observe their current authorized card.
        if(request.cardScope&&(row.cardProvider!==request.cardScope.provider||row.cardId!==request.cardScope.cardId))continue;
        next.watches[index]=await this.reconcile(row);visible.push(this.public(next.watches[index]));
      }
      const pending=visible.some(row=>{
        if(row.status==='ready')return true;if(row.status!=='watching')return false;
        const watch=next.watches.find(value=>value.id===row.watchId),job=this.host.jobs.ledger.records.find(value=>value.runId===watch.runId&&value.operationId===watch.operationId);
        return !job||!['failed','cancelled','interrupted','stale','retired'].includes(job.status);
      });
      return {available:true,storeId:next.storeId,watches:visible.filter(row=>row.status==='ready').concat(visible.filter(row=>row.status!=='ready').slice(-32)).slice(0,64),pending};
    });
  }
  async exact(request){
    identity(request.destinationId);identity(request.eventId);
    const row=this.ledger.state?.watches.find(value=>value.event?.eventId===request.eventId);
    if(!row)fail('NOTIFICATION_TARGET_UNAVAILABLE');
    this.host.requireRun(row.runId);const run=await this.host.engine.store.read(row.runId),scope=this.scope(request,run);
    if(!this.matches(row,request,scope))fail('NOTIFICATION_SCOPE_MISMATCH');
    return {row,run};
  }
  claim(request){const result=this.claimQueue.catch(()=>{}).then(()=>this.claimOne(request));this.claimQueue=result;return result;}
  async claimOne(request){
    const {row}=await this.exact(request);
    return this.host.engine.store.withRunLock(row.runId,()=>this.ledger.transaction(async next=>{
      const index=next.watches.findIndex(value=>value.id===row.id),current=await this.reconcile(next.watches[index]);next.watches[index]=current;
      if(current.status!=='ready')return {claimed:false,status:current.status};
      current.status='consumed';current.consumedAt=this.host.now();
      return {claimed:true,...this.public(current),target:{eventId:current.event.eventId,runId:current.runId,commitId:current.event.commitId},presentation:'saved'};
    }));
  }
  async target(request){
    const {row}=await this.exact(request),current=await this.reconcile(row);
    if(current.status==='suppressed')fail('NOTIFICATION_TARGET_RETIRED');
    const result=this.canonical(row,await this.host.engine.store.read(row.runId));
    if(result.status!=='ready'||result.event.eventId!==request.eventId)fail('NOTIFICATION_TARGET_UNAVAILABLE');
    return {runId:row.runId,commitId:result.event.commitId,eventId:request.eventId};
  }
  async stop(request){
    identity(request.destinationId);const sessionId=identity(request.sessionId??'isolated');if(request.runId)identity(request.runId);
    return this.ledger.transaction(next=>{
      for(const row of next.watches)if(row.destinationId===request.destinationId&&row.sessionId===sessionId&&(!request.runId||row.runId===request.runId)&&(!request.cardScope||row.cardProvider===request.cardScope.provider&&row.cardId===request.cardScope.cardId)&&row.status!=='consumed'){row.status='suppressed';row.reason='stopped';}
      return {stopped:true};
    });
  }
}

import {playerTemplateSpans} from '../core/player-text.mjs';
import {playerName} from '../core/player-identity.mjs';
import {randomUUID} from 'node:crypto';
import {validateSnapshot,clone} from '../core/contracts.mjs';
import {snapshotCardScope,sameCardScope} from './card-scope.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
// Keep original card indexes: a blank main opening must not renumber alternatives.
export function savedOpenings(snapshot){
  const data=snapshot.card?.data??snapshot.card;
  return [data?.first_mes,...(Array.isArray(data?.alternate_greetings)?data.alternate_greetings:[])]
    .flatMap((text,index)=>typeof text==='string'&&text.trim()?[{index,id:'studio-opening-'+index,title:index?'替代開場 '+index:'主開場',text}]:[]);
}
export function selectSavedOpening(snapshot,index){
  const opening=savedOpenings(snapshot).find(row=>row.index===index);
  if(!Number.isSafeInteger(index)||!opening)fail('OPENING_INDEX','這個開場不屬於已保存版本，請重新交接。');
  const fixed=clone(snapshot);delete fixed.hash;
  fixed.opening={id:opening.id,title:opening.title,text:opening.text};
  return validateSnapshot(fixed);
}

// A pending choice is not a Run. Only authenticated, current Studio context may
// consume it. Retries use one deterministic Run ID, including publication errors.
export class OpeningSelections {
  constructor(host,{ttlMs=600000}={}){this.host=host;this.ttlMs=ttlMs;this.rows=new Map();}
  async prepare({snapshot,authoringSessionId,generation,initialState,signal}){
    const fixed=validateSnapshot(snapshot),options=savedOpenings(fixed);
    for(const [id,row] of this.rows)if(!row.promise&&(row.expiresAt<this.host.now()||row.authoringSessionId===authoringSessionId&&row.generation===generation&&!row.result))this.rows.delete(id);
    if(!options.length)fail('OPENING_EMPTY','這張已保存卡沒有非空開場，請回 Studio 保存開場後再交接。');
    const scope=snapshotCardScope(fixed);
    if(!scope)fail('OPENING_CARD_SCOPE','選開場需要可確認的 Studio 已保存卡片。');
    if(this.rows.size>=64)fail('OPENING_CAPACITY','待選開場過多，請稍後重新交接。');
    const offerId=randomUUID();
    this.rows.set(offerId,{offerId,scope,snapshot:fixed,options,authoringSessionId,generation,initialState:clone(initialState),expiresAt:this.host.now()+this.ttlMs,runId:'opening-'+offerId});
    return {openingRequired:true,openingOfferId:offerId};
  }
  current(row,scope){
    if(!row||row.expiresAt<this.host.now())fail('OPENING_EXPIRED','待選開場已取消或過期，請回 Studio 重新交接。');
    if(!sameCardScope(row.scope,scope)||row.authoringSessionId!==scope.authoringSessionId||row.generation!==scope.generation||row.snapshot.revision!==scope.savedRevision||row.snapshot.source?.card?.sha256!==scope.savedSha256)
      fail('OPENING_STALE','卡片、保存版本或對話已變更，請回 Studio 重新交接。');
  }
  get(scope){
    const row=[...this.rows.values()].reverse().find(row=>!row.result&&!row.cancelled&&row.authoringSessionId===scope.authoringSessionId&&sameCardScope(row.scope,scope));
    if(!row)return null;
    this.current(row,scope);
    return {offerId:row.offerId,cardId:row.snapshot.cardId,revision:row.snapshot.revision,snapshotHash:row.snapshot.hash,expiresAt:row.expiresAt,options:row.options.map(o=>({...clone(o),...(playerTemplateSpans(o.text)!==undefined?{textSpans:playerTemplateSpans(o.text)}:{})})),defaultPlayerName:this.host.metadata.playerDefaults.name};
  }
  bound(request,scope){
    const row=this.rows.get(request.offerId);this.current(row,scope);
    if(request.cardId!==row.snapshot.cardId||request.revision!==row.snapshot.revision||request.snapshotHash!==row.snapshot.hash)fail('OPENING_STALE','開場選擇不屬於目前交接版本，請重新交接。');
    return row;
  }
  async reopen(request,scope,resolveScope,signal){
    const run=await this.host.engine.store.read(request.runId),current=await resolveScope();
    this.current({scope:snapshotCardScope(run.snapshot),snapshot:run.snapshot,authoringSessionId:scope.authoringSessionId,generation:scope.generation,expiresAt:this.host.now()+this.ttlMs},current);
    signal?.throwIfAborted();
    return this.prepare({snapshot:run.snapshot,authoringSessionId:current.authoringSessionId,generation:current.generation,initialState:run.snapshot.stateBlueprint?undefined:run.baselineState,signal});
  }
  async start(request,scope,resolveScope,signal){
    const row=this.bound(request,scope);
    if(row.cancelled)fail('OPENING_EXPIRED','待選開場已取消，請回 Studio 重新交接。');
    const snapshot=selectSavedOpening(row.snapshot,request.openingIndex),name=playerName(request.playerName);
    if(row.selectedIndex!==undefined&&(row.selectedIndex!==request.openingIndex||row.playerName!==name))fail('OPENING_ALREADY_STARTED','此選擇已用於開局；請重新交接以另開故事。');
    if(row.result)return clone(row.result);
    if(row.promise)return row.promise;
    signal?.throwIfAborted();row.selectedIndex=request.openingIndex;row.playerName=name;
    const job=(async()=>{
      let existing;try{existing=await this.host.engine.store.read(row.runId);}catch(error){if(error.code!=='RUN_NOT_FOUND')throw error;}
      this.current(row,await resolveScope());signal?.throwIfAborted();
      row.admitted=true;
      // After this admission point, publication drains to a receipt; closing the
      // page or cancelling its request cannot erase an already accepted Run.
      if(existing){if(existing.snapshot.hash!==snapshot.hash||existing.playerIdentity?.name!==name)fail('OPENING_RUN_CONFLICT','開局保存結果不符，請重新整理故事列表。');await this.host.refreshRuns();}
      else await this.host.createRun({snapshot,initialState:row.initialState,runId:row.runId,openingId:snapshot.opening.id,playerName:name});
      row.result={runId:row.runId,binding:this.host.issueBinding(row.runId,row.authoringSessionId,row.generation)};
      try{await this.host.persist();}catch(error){row.result=null;throw error;}
      return clone(row.result);
    })();
    row.promise=job;try{return await job;}finally{row.promise=null;if(!row.admitted&&!row.result){delete row.selectedIndex;delete row.playerName;}}
  }
  cancel(request,scope){
    const row=this.bound(request,scope);
    if(row.promise)fail('OPENING_START_PENDING','開局結果尚待確認，請重試原選擇以查回同一故事。');
    if(row.result)return {cancelled:false,runId:row.result.runId};
    row.cancelled=true;return {cancelled:true};
  }
}

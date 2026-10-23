import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {DurableStore} from '../adapters/store.mjs';
import {safeId,hash,clone,validateSnapshot,SceanError} from './contracts.mjs';

// Separate aggregates and lock namespace: no Run, card or authoring file is
// changed by publication. Identity is the request, never the content hash.
export class ScriptStore extends DurableStore {
  runDir(scriptId){return join(this.root,'scripts',safeId(scriptId));}
  identity(authoringSessionId,requestId){safeId(requestId);return 'script-'+hash({authoringSessionId,requestId});}
  async read(scriptId){
    try{
      const row=JSON.parse(await readFile(join(this.runDir(scriptId),'record.json'),'utf8'));
      if(row.schemaVersion!==1||row.scriptId!==scriptId||row.scriptHash!==validateSnapshot(row.snapshot).hash||row.fingerprint!==hash({snapshot:row.snapshot,review:row.review,authoringSessionId:row.sourceSessionId}))throw new SceanError('SCRIPT_CORRUPT');
      return row;
    }catch(error){if(error.code==='ENOENT')throw new SceanError('SCRIPT_NOT_FOUND');throw error;}
  }
  async list(){
    let entries;try{entries=await readdir(join(this.root,'scripts'),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const rows=[];for(const entry of entries.filter(e=>e.isDirectory())){try{rows.push(await this.read(entry.name));}catch(error){if(error.code!=='SCRIPT_NOT_FOUND')throw error;}}
    return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.scriptId.localeCompare(b.scriptId));
  }
  async publish({snapshot,authoringSessionId,generation,requestId,review,now=Date.now(),signal}){
    const scriptId=this.identity(authoringSessionId,requestId),fixed=validateSnapshot(snapshot);
    // An absent semantic review is honestly recorded, never manufactured as a pass.
    const recordedReview=review===undefined?{status:'not_recorded'}:clone(review);
    const fingerprint=hash({snapshot:fixed,review:recordedReview,authoringSessionId});
    return this.withRunLock(scriptId,async()=>{
      let prior;try{prior=await this.read(scriptId);}catch(error){if(error.code!=='SCRIPT_NOT_FOUND')throw error;}
      if(prior){if(prior.fingerprint!==fingerprint)throw new SceanError('SCRIPT_REQUEST_CONFLICT');return prior;}
      signal?.throwIfAborted();
      const row={schemaVersion:1,scriptId,scriptHash:fixed.hash,snapshot:fixed,fingerprint,review:recordedReview,sourceSessionId:authoringSessionId,sourceGeneration:generation,requestId,createdAt:new Date(now).toISOString()};
      // Record and receipt publish in one rename. Recovery always rereads this
      // canonical aggregate, including a failure after the rename succeeded.
      try{await this.atomic(join(this.runDir(scriptId),'record.json'),row,{signal,commit:true});}
      catch(error){let actual;try{actual=await this.read(scriptId);}catch(readError){if(readError.code!=='SCRIPT_NOT_FOUND')throw new SceanError('SCRIPT_PUBLISH_UNKNOWN');}
        if(actual?.fingerprint===fingerprint)return actual;throw error;}
      return clone(row);
    },{signal});
  }
}

export function scriptSummary(row){return {scriptId:row.scriptId,scriptHash:row.scriptHash,title:String(row.snapshot.card?.data?.name??row.snapshot.card?.name??row.snapshot.cardId).slice(0,500),cardId:row.snapshot.cardId,revision:row.snapshot.revision,sourceSessionId:row.sourceSessionId,createdAt:row.createdAt,review:{status:typeof row.review?.status==='string'?row.review.status:'not_recorded'},receipt:{status:'committed',requestId:row.requestId,scriptId:row.scriptId,scriptHash:row.scriptHash}};}

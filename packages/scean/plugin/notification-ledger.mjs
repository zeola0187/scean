import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeId} from '../core/contracts.mjs';

const fail=()=>{throw Object.assign(new Error('Notification journal unavailable.'),{code:'NOTIFICATION_LEDGER'});};
const clone=value=>JSON.parse(JSON.stringify(value));
const statuses=new Set(['watching','ready','consumed','suppressed']);
/** This sidecar is deliberately outside Run bundles and contains no story input,
 * output, model settings, credentials or replayable model requests. No eviction:
 * when full, new watches fail closed without affecting canonical operations. */
export class NotificationLedger {
  constructor(root,{capacity=1024,fault}={}){this.root=root;this.capacity=capacity;this.fault=fault;this.queue=Promise.resolve();this.state=null;this.available=true;}
  validate(value){
    if(value?.schemaVersion!==1||!Array.isArray(value.watches)||value.watches.length>this.capacity)fail();
    safeId(value.storeId);const ids=new Set();
    const keys=new Set(['id','runId','requestId','operationId','kind','destinationId','sessionId','cardProvider','cardId','snapshotHash','baseVersion','baseHead','createdAt','expiresAt','status','event','reason','consumedAt']);
    for(const row of value.watches){
      if(Object.keys(row).some(key=>!keys.has(key)))fail();
      for(const key of ['id','runId','requestId','operationId','destinationId','sessionId','cardId'])safeId(row[key]);
      if(ids.has(row.id)||!statuses.has(row.status)||!['turn','regenerate'].includes(row.kind)||!/^[a-f0-9]{64}$/.test(row.snapshotHash)||!Number.isSafeInteger(row.baseVersion)||row.baseVersion<0||!Number.isFinite(row.createdAt)||!Number.isFinite(row.expiresAt))fail();
      if(row.baseHead!==null)safeId(row.baseHead);ids.add(row.id);
      if(row.event){
        if(Object.keys(row.event).some(key=>!['eventId','commitId','attemptId','commitVersion','committedAt'].includes(key)))fail();
        for(const key of ['eventId','commitId','attemptId'])safeId(row.event[key]);
        if(!Number.isSafeInteger(row.event.commitVersion)||!Number.isFinite(row.event.committedAt))fail();
      }
    }
    return value;
  }
  async read(){const raw=await readFile(join(this.root,'notifications.json'),'utf8');if(Buffer.byteLength(raw)>2_000_000)fail();return this.validate(JSON.parse(raw));}
  async init(){
    await mkdir(this.root,{recursive:true});
    try{this.state=await this.read();}
    catch(error){if(error.code!=='ENOENT'){this.available=false;return this;}this.state={schemaVersion:1,storeId:randomUUID(),watches:[]};try{await this.write(this.state);}catch{this.available=false;}}
    return this;
  }
  async write(next){
    const file=join(this.root,'notifications.json'),temporary=join(this.root,`notifications.${randomUUID()}.tmp`);let handle;
    try{
      handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(next),'utf8');await handle.sync();await handle.close();handle=null;
      await this.fault?.('beforeRename');
      for(let retry=0;;retry++){try{await rename(temporary,file);break;}catch(error){if(retry>=2||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,10*(retry+1)));}}
      let dir;try{dir=await open(this.root,'r');await dir.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','EACCES','ENOTSUP','EBADF'].includes(error.code))throw error;}finally{await dir?.close();}
      await this.fault?.('afterRename');
    }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  transaction(work){
    const operation=this.queue.catch(()=>{}).then(async()=>{
      if(!this.available||!this.state)fail();const next=clone(this.state),result=await work(next);
      this.validate(next);if(JSON.stringify(next)===JSON.stringify(this.state))return result;
      try{await this.write(next);this.state=next;}
      catch{try{this.state=await this.read();}catch{this.available=false;}fail();}
      return result;
    });this.queue=operation;return operation;
  }
}

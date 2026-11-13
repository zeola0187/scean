import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {safeId} from '../core/contracts.mjs';

export const JOB_PENDING=new Set(['accepted','running','cancel-requested']);
const STATUSES=new Set([...JOB_PENDING,'committed','completed','retired','failed','cancelled','interrupted','stale','unknown']);
/** Admission evidence only. Canonical Run receipts remain the publication authority.
 * Records never contain prompts, provider output, tokens or replayable inputs.
 * No eviction: exhausting the bounded journal fails closed instead of forgetting IDs.
 */
export class JobLedger {
  constructor(root,{capacity=4096,fault}={}){this.root=root;this.capacity=capacity;this.fault=fault;this.records=[];this.queue=Promise.resolve();}
  async init(){
    await mkdir(this.root,{recursive:true});
    try{
      const data=JSON.parse(await readFile(join(this.root,'operations.json'),'utf8'));
      if(![1,2].includes(data.schemaVersion)||!Array.isArray(data.records)||data.records.length>this.capacity)throw new Error('Invalid operation journal.');
      const ids=new Set();
      for(const row of data.records){safeId(row.runId);safeId(row.operationId);if(row.requestId!==null)safeId(row.requestId);const key=`${row.runId}:${row.operationId}`;if(ids.has(key)||!STATUSES.has(row.status)||row.timeConfirmationHash!==undefined&&!/^[a-f0-9]{64}$/.test(row.timeConfirmationHash)||!/^[a-f0-9]{64}$/.test(row.fingerprint))throw new Error('Invalid operation record.');ids.add(key);}
      this.records=data.records;
    }catch(error){if(error.code!=='ENOENT')throw Object.assign(new Error('Operation journal cannot be read safely.'),{code:'HOST_JOB_LEDGER'});}
    return this;
  }
  async persist(){
    const op=this.queue.catch(()=>{}).then(async()=>{
      const temporary=join(this.root,`operations.${randomUUID()}.tmp`);let handle;
      try{
        handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify({schemaVersion:this.records.some(r=>r.kind==='settlementResume')?2:1,records:this.records}),'utf8');await handle.sync();await handle.close();handle=null;
        await this.fault?.('beforeRename');
        for(let retry=0;;retry++){try{await rename(temporary,join(this.root,'operations.json'));break;}catch(error){if(retry>=2||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,10*(retry+1)));}}
        let dir;try{dir=await open(this.root,'r');await dir.sync();}catch(error){if(!['EPERM','EISDIR','EINVAL','EACCES','ENOTSUP','EBADF'].includes(error.code))throw error;}finally{await dir?.close();}
        await this.fault?.('afterRename');
      }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });this.queue=op;return op;
  }
}

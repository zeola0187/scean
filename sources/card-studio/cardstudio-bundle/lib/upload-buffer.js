import { randomUUID } from 'node:crypto';
import { fail } from './codec.js';

export const UPLOAD_LIMIT=32*1024*1024;
export const UPLOAD_CHUNK=256*1024;
const SESSION_BUDGET=64*1024*1024;
const ownerInfo=owner=>typeof owner==='string'?{session:owner,key:JSON.stringify([owner])}:{session:owner?.sessionId,key:JSON.stringify([owner?.sessionId,owner?.pageId,owner?.leaseId])};

/** Bounded, short-lived UI uploads. No user paths, filesystem or model messages. */
export class UploadBuffer {
  constructor({now=Date.now}={}){this.now=now;this.rows=new Map();}
  sweep(){for(const [id,row] of this.rows)if(row.expires<=this.now())this.rows.delete(id);}
  clear(session){for(const [id,row] of this.rows)if(session===undefined||row.session===session)this.rows.delete(id);}
  clearOwner(owner){const key=ownerInfo(owner).key;for(const [id,row] of this.rows)if(row.owner===key)this.rows.delete(id);}
  begin(session,{name,size,type}){
    this.sweep();
    if(typeof name!=='string'||name.length>255||!/^.+\.(json|png)$/i.test(name)||/[\\/\0]/.test(name))fail('UPLOAD_NAME','Drop one JSON or PNG file.');
    if(!Number.isSafeInteger(size)||size<1||size>UPLOAD_LIMIT)fail('UPLOAD_LIMIT','Drop files up to 32 MiB; use the imports folder for the existing import workflow.');
    if(!['card','worldbook'].includes(type))fail('UPLOAD_TYPE','Choose character card or standalone worldbook.');
    const owner=ownerInfo(session);if(typeof owner.session!=='string'||!owner.session.trim())fail('UPLOAD_OWNER','A trusted upload owner is required.');
    this.clearOwner(session);
    if(this.rows.size>=32||[...this.rows.values()].filter(row=>row.session===owner.session).reduce((sum,row)=>sum+row.size,0)+size>SESSION_BUDGET||[...this.rows.values()].reduce((sum,row)=>sum+row.size,0)+size>128*1024*1024)fail('UPLOAD_BUSY','The bounded upload memory budget is in use.');
    const id=randomUUID();this.rows.set(id,{session:owner.session,owner:owner.key,name,size,type,received:0,chunks:[],expires:this.now()+120000});
    return {upload_id:id,chunk_bytes:UPLOAD_CHUNK,size};
  }
  get(session,id){this.sweep();const row=this.rows.get(id);if(!row||row.owner!==ownerInfo(session).key)fail('UPLOAD_EXPIRED','This upload expired or belongs to another page or Session.');return row;}
  append(session,{upload_id,offset,base64}){
    const row=this.get(session,upload_id);
    if(offset!==row.received)fail('UPLOAD_ORDER','Upload chunk is out of order.');
    if(typeof base64!=='string'||base64.length>Math.ceil(UPLOAD_CHUNK/3)*4||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail('UPLOAD_BYTES','Invalid upload chunk.');
    const bytes=Buffer.from(base64,'base64');
    if(bytes.toString('base64')!==base64||bytes.length>UPLOAD_CHUNK||row.received+bytes.length>row.size)fail('UPLOAD_BYTES','Upload size does not match the selected file.');
    row.chunks.push(bytes);row.received+=bytes.length;row.expires=this.now()+120000;return {received:row.received,size:row.size};
  }
  finish(session,id){const row=this.get(session,id);if(row.received!==row.size)fail('UPLOAD_INCOMPLETE','The selected file has not finished uploading.');this.rows.delete(id);return {...row,bytes:Buffer.concat(row.chunks,row.size)};}
  abort(session,id){this.get(session,id);this.rows.delete(id);return {cancelled:true};}
}

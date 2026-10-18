import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contained } from './card-service.js';
import { fail,sha,crc32,strictJson,canonical } from './codec.js';
import { decodeDocument } from './document-projection.js';

export const DOWNLOAD_CHUNK=256*1024;
export const DOWNLOAD_LIMIT=64*1024*1024;
const ownerKey=owner=>JSON.stringify([owner.sessionId,owner.pageId,owner.leaseId]);
const safeMember=name=>typeof name==='string'&&name.length<=240&&!path.isAbsolute(name)&&!/[\\:\0]/.test(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');

// ZIP store format: no compression, execution, symlink entries or caller paths.
export function exportZip(files){
  const local=[],central=[];let offset=0;
  for(const file of files){
    if(!safeMember(file.name))fail('DOWNLOAD_PATH','Unsafe export member.');
    const name=Buffer.from(file.name),crc=crc32(file.bytes),head=Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(0x21,12);
    head.writeUInt32LE(crc,14);head.writeUInt32LE(file.bytes.length,18);head.writeUInt32LE(file.bytes.length,22);head.writeUInt16LE(name.length,26);
    local.push(head,name,file.bytes);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(file.bytes.length,20);entry.writeUInt32LE(file.bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=head.length+name.length+file.bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

/** Ephemeral authenticated-RPC downloads of already exported bytes only.
 * Receipt identities are bound to a live page, Session, saved revision and hash.
 * Nothing survives Host restart and no HTTP listener or filesystem API is added. */
export class ExportDownloads {
  constructor({now=Date.now,ttlMs=300000,limit=DOWNLOAD_LIMIT,totalLimit=128*1024*1024}={}){this.now=now;this.ttlMs=ttlMs;this.limit=limit;this.totalLimit=totalLimit;this.rows=new Map();}
  sweep(){for(const [id,row] of this.rows)if(row.receipt.expires_at<=this.now())this.rows.delete(id);}
  clear(sessionId,pageId,leaseId){for(const [id,row] of this.rows)if(sessionId===undefined||row.owner.sessionId===sessionId&&(pageId===undefined||row.owner.pageId===pageId&&(leaseId===undefined||row.owner.leaseId===leaseId)))this.rows.delete(id);}
  async issue(root,owner,result,saved,signal){
    this.sweep();signal?.throwIfAborted();
    if(!owner?.sessionId||!owner.pageId||!owner.leaseId||result.id!==saved.id||result.revision!==saved.revision)fail('DOWNLOAD_REVISION','Export does not match the selected saved revision.');
    const read=async(relative,remaining)=>{
      const file=await contained(root,relative,{existing:true}),stat=await fs.lstat(file);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size<1||stat.size>remaining)fail('DOWNLOAD_LIMIT','Browser download exceeds the bounded export limit.');
      const handle=await fs.open(file,'r');
      try{const before=await handle.stat();if(before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size)fail('DOWNLOAD_CHANGED','Export changed while reading.');const bytes=Buffer.alloc(stat.size);let offset=0;while(offset<bytes.length){signal?.throwIfAborted();const r=await handle.read(bytes,offset,Math.min(DOWNLOAD_CHUNK,bytes.length-offset),offset);if(!r.bytesRead)fail('DOWNLOAD_CHANGED','Export changed while reading.');offset+=r.bytesRead;}const after=await handle.stat(),current=await fs.lstat(await contained(root,relative,{existing:true}));if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.ino!==current.ino||after.dev!==current.dev||current.isSymbolicLink())fail('DOWNLOAD_CHANGED','Export changed while reading.');return bytes;}finally{await handle.close();}
    };
    let bytes,filename,mediaType;
    if(result.card){
      const manifestBytes=await read(result.path+'/manifest.json',1024*1024),manifest=strictJson(manifestBytes.toString('utf8'));
      if(manifest.revision!==saved.revision||(manifest.cardSha256??manifest.sha256)!==saved.sha256||manifest.document_id!==undefined&&manifest.document_id!==saved.id||!Array.isArray(manifest.files)||manifest.files.length>160)fail('DOWNLOAD_RECEIPT','Export manifest does not match the saved revision.');
      const names=new Set(),files=[];let total=manifestBytes.length;
      for(const member of manifest.files){
        if(!safeMember(member.name)||names.has(member.name)||!/^[a-f0-9]{64}$/.test(member.sha256))fail('DOWNLOAD_PATH','Unsafe or duplicate export member.');names.add(member.name);
        const contents=await read(result.path+'/'+member.name,this.limit-total);total+=contents.length;if(sha(contents)!==member.sha256)fail('DOWNLOAD_CHANGED','Export member hash changed.');files.push({name:member.name,bytes:contents});
      }
      if(!files.some(file=>file.name===result.card&&sha(file.bytes)===saved.sha256))fail('DOWNLOAD_RECEIPT','Export card hash does not match the saved revision.');
      for(const file of result.files??[])if(file.name==='manifest.json'?sha(manifestBytes)!==file.sha256:!manifest.files.some(member=>member.name===file.name&&member.sha256===file.sha256))fail('DOWNLOAD_RECEIPT','Export receipt differs from its manifest.');
      files.push({name:'manifest.json',bytes:manifestBytes});bytes=exportZip(files);filename=path.basename(result.path)+'.zip';mediaType='application/zip';
    }else{
      bytes=await read(result.path,this.limit);if(sha(bytes)!==result.sha256||canonical(decodeDocument(bytes,saved.type).card)!==canonical(saved.card))fail('DOWNLOAD_CHANGED','Export hash or card differs from its receipt.');filename=path.basename(result.path);mediaType=filename.endsWith('.png')?'image/png':'application/json';
    }
    signal?.throwIfAborted();if(bytes.length>this.limit)fail('DOWNLOAD_LIMIT','Browser download exceeds 64 MiB; use the Host export for larger bundles.');
    const owned=[...this.rows].filter(([,row])=>ownerKey(row.owner)===ownerKey(owner));while(owned.length>=4){this.rows.delete(owned.shift()[0]);}
    if(this.rows.size>=16||[...this.rows.values()].reduce((n,row)=>n+row.bytes.length,0)+bytes.length>this.totalLimit)fail('DOWNLOAD_BUSY','Download memory budget is in use. Release earlier receipts or wait for expiry.');
    const receipt={receipt_id:randomUUID(),document_id:saved.id,revision:saved.revision,source_sha256:saved.sha256,sha256:sha(bytes),filename,media_type:mediaType,size:bytes.length,expires_at:this.now()+this.ttlMs,chunk_bytes:DOWNLOAD_CHUNK};this.rows.set(receipt.receipt_id,{owner:{...owner},receipt,bytes});return {...receipt};
  }
  request(owner,request){
    this.sweep();
    const allowed=request?.mode==='chunk'?['mode','receipt_id','document_id','expected_revision','sha256','offset']:['mode','receipt_id','document_id','expected_revision','sha256'];
    if(!request||!['chunk','release'].includes(request.mode)||Object.keys(request).some(key=>!allowed.includes(key)))fail('DOWNLOAD_ARGUMENT','Use a bounded export receipt request; paths are not accepted.');
    const row=this.rows.get(request.receipt_id);
    if(!row||ownerKey(row.owner)!==ownerKey(owner))fail('DOWNLOAD_EXPIRED','Download receipt expired or belongs to another page or Session.');
    const receipt=row.receipt;
    if(request.document_id!==receipt.document_id||request.expected_revision!==receipt.revision||request.sha256!==receipt.sha256)fail('DOWNLOAD_RECEIPT','Download identity, revision or hash differs from the export receipt.');
    if(request.mode==='release'){this.rows.delete(request.receipt_id);return {released:true};}
    if(!Number.isSafeInteger(request.offset)||request.offset<0||request.offset>=row.bytes.length||request.offset%DOWNLOAD_CHUNK)fail('DOWNLOAD_OFFSET','Use the receipt chunk boundary.');
    const chunk=row.bytes.subarray(request.offset,request.offset+DOWNLOAD_CHUNK);return {...receipt,offset:request.offset,base64:chunk.toString('base64'),complete:request.offset+chunk.length===row.bytes.length};
  }
}

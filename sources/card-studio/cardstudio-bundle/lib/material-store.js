import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contained,atomicReplace } from './card-service.js';
import { canonical,sha,strictJson,fail,clone } from './codec.js';
import { assertNarrativeText } from './authoring-scope.js';
import { retrieveLexical } from './library-retrieval.js';

export const materialLimits=Object.freeze({body:65536,recordBytes:256*1024,items:2000,indexBody:32768,indexCharacters:16*1024*1024,read:12000,page:20,sources:8,candidates:20,expiryMs:24*60*60*1000});
export const digest=value=>sha(Buffer.from(canonical(value)));
export const identity=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export const hashOK=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const recycleId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function recordHash(record){const {record_sha256,...body}=record;return digest(body);}
export function text(value,name,max,empty=false){if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max)fail('MATERIAL_LIMIT',name+' must be bounded readable text.');assertNarrativeText(value,name);return value;}
export function content(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','title','summary','body','use_notes','aliases','tags','source_refs','derived_from'].includes(k)))fail('MATERIAL_ARGUMENT','Use a thin narrative material, never a card/runtime envelope.');
  if(!['character','worldbook'].includes(input.kind))fail('MATERIAL_KIND','Choose a whole character or reusable worldbook setting.');
  const out={kind:input.kind,title:text(input.title,'title',200),summary:text(input.summary,'summary',1200),body:text(input.body,'body',materialLimits.body),use_notes:text(input.use_notes,'use_notes',8000)};
  for(const field of ['aliases','tags'])if(input[field]!==undefined){if(!Array.isArray(input[field])||input[field].length>16)fail('MATERIAL_LIMIT','At most 16 free aliases/tags.');out[field]=input[field].map(v=>text(v,field,100));}
  if(input.derived_from!==undefined){if(!Array.isArray(input.derived_from)||input.derived_from.length>20||input.derived_from.some(v=>!identity(v)))fail('MATERIAL_ID','Invalid prior material IDs.');out.derived_from=clone(input.derived_from);}
  return out;
}
export class MaterialStore {
  constructor(root,{now=Date.now,limits={},beforePublish}={}){this.root=root;this.now=now;this.limits={...materialLimits,...limits};this.beforePublish=beforePublish;this.rows=[];this.generation=randomUUID();this.complete=false;this.scanned=false;this.queue=Promise.resolve();this.directories=new Map();}
  async init(){
    for(const rel of ['materials','materials/items','materials/sources','materials/receipts','.cardstudio-scean','.cardstudio-scean/material-candidates','.cardstudio-scean/material-selections','.cardstudio-scean/material-recycle']){
      const file=await contained(this.root,rel);await fs.mkdir(file,{recursive:true});const stat=await fs.lstat(file);
      if(!stat.isDirectory()||stat.isSymbolicLink())fail('MATERIAL_PATH','Material directories cannot be redirected.');this.directories.set(rel,{dev:stat.dev,ino:stat.ino});
    }
  }
  async boundary(rel,existing=false){
    for(const [dir,expected] of this.directories)if(rel===dir||rel.startsWith(dir+'/')){const target=await contained(this.root,dir,{existing:true}),stat=await fs.lstat(target);if(stat.isSymbolicLink()||!stat.isDirectory()||stat.dev!==expected.dev||stat.ino!==expected.ino)fail('MATERIAL_PATH','Material directory identity changed. Reopen workspace.');}
    const target=await contained(this.root,rel,{existing});
    try{const stat=await fs.lstat(target);if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())fail('MATERIAL_PATH','Material files cannot be redirected.');}catch(e){if(e.code!=='ENOENT'||existing)throw e;}return target;
  }
  async json(rel,maxBytes=this.limits.recordBytes){
    const file=await this.boundary(rel,true),before=await fs.lstat(file);if(!before.isFile()||before.size>maxBytes)fail('MATERIAL_LIMIT','Invalid/oversized material record.');
    const handle=await fs.open(file,'r');try{const st=await handle.stat();if(st.ino!==before.ino||st.size!==before.size)fail('MATERIAL_CHANGED','File changed.');const data=Buffer.alloc(st.size);let n=0;while(n<data.length){const r=await handle.read(data,n,data.length-n,n);if(!r.bytesRead)fail('MATERIAL_CHANGED','File changed.');n+=r.bytesRead;}const after=await handle.stat(),current=await fs.lstat(await this.boundary(rel,true));if(st.ino!==current.ino||st.size!==after.size||st.mtimeMs!==after.mtimeMs||st.ctimeMs!==current.ctimeMs)fail('MATERIAL_CHANGED','File changed.');return strictJson(data.toString('utf8'),{maxBytes});}finally{await handle.close();}
  }
  async save(rel,value,signal,fence=()=>{}){const bytes=Buffer.from(JSON.stringify(value)+'\n');if(bytes.length>this.limits.recordBytes&&rel.startsWith('materials/items/'))fail('MATERIAL_LIMIT','Material record exceeds 256 KiB; split only when meaning requires it.');const filename=await this.boundary(rel);signal?.throwIfAborted();await fence();await atomicReplace(filename,bytes,signal,async()=>{await this.boundary(rel);await fence();});}
  serial(fn){const job=this.queue.catch(()=>{}).then(fn);this.queue=job;return job;}
  async receipt(extractionId){if(!identity(extractionId))fail('MATERIAL_ID','Invalid extraction ID.');try{const r=await this.json('materials/receipts/'+extractionId+'.json',1024*1024);if(r.extraction_id!==extractionId||r.receipt_sha256!==digest(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='receipt_sha256'))))fail('MATERIAL_VERIFY','Receipt mismatch.');return r;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async item(id,expected){
    if(!identity(id)||expected!==undefined&&!hashOK(expected))fail('MATERIAL_ID','Use an observed material ID and hash.');const record=await this.json('materials/items/'+id+'.json');
    if(record.schema_version!==1||record.material_id!==id||recordHash(record)!==record.record_sha256||expected!==undefined&&expected!==record.record_sha256)fail('MATERIAL_CHANGED','Material identity/hash changed. Read the new record before selecting.');
    content(Object.fromEntries(Object.entries(record).filter(([k])=>['kind','title','summary','body','use_notes','aliases','tags','derived_from'].includes(k))));
    if(!Array.isArray(record.provenance)||!record.provenance.length||record.provenance.length>8)fail('MATERIAL_VERIFY','Missing source provenance.');
    const receipt=await this.receipt(record.extraction_id);if(!receipt?.accepted.some(r=>r.material_id===id&&r.record_sha256===record.record_sha256))fail('MATERIAL_UNPUBLISHED','Material has no published human extraction receipt.');return record;
  }
  // Visibility only. Immutable material bytes, publication receipts and shared
  // source evidence stay at their original locations for historical references.
  async recycleState(record){
    if(!recycleId(record.material_id)||!hashOK(record.record_sha256))fail('MATERIAL_ID','Use an observed material ID and hash.');
    const directory=async()=>{try{await this.boundary('.cardstudio-scean/material-recycle',true);}catch(e){if(e.code==='MATERIAL_PATH')throw e;fail('MATERIAL_RECYCLE_STATE','Material recycle state is unavailable. Material files were retained.');}};
    await directory();
    let state;try{state=await this.json('.cardstudio-scean/material-recycle/'+record.material_id+'.json',4096);}catch(e){if(e.code==='ENOENT'){await directory();return {recycled:false,recycle_revision:0};}if(e.code==='MATERIAL_PATH')throw e;fail('MATERIAL_RECYCLE_STATE','Material recycle state cannot be verified. Material files were retained.');}
    const allowed=['schema_version','material_id','record_sha256','recycled','recycle_revision','operation_id','expected_recycle_revision','changed_at','session_id','state_sha256'];
    if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).some(k=>!allowed.includes(k))||state.schema_version!==1||state.material_id!==record.material_id||state.record_sha256!==record.record_sha256||typeof state.recycled!=='boolean'||!Number.isSafeInteger(state.recycle_revision)||state.recycle_revision<1||state.expected_recycle_revision!==state.recycle_revision-1||!recycleId(state.operation_id)||typeof state.changed_at!=='string'||typeof state.session_id!=='string'||!state.session_id.trim()||state.state_sha256!==digest(Object.fromEntries(Object.entries(state).filter(([k])=>k!=='state_sha256'))))fail('MATERIAL_RECYCLE_STATE','Material recycle state cannot be verified. No material was changed.');
    return state;
  }
  async activeItem(id,expected){const record=await this.item(id,expected);if((await this.recycleState(record)).recycled)fail('MATERIAL_RECYCLED','This material is in the recycle bin. Restore it before selecting or creating a new card.');return record;}
  async recycle(request,sessionId,signal,fence=()=>{}){
    return this.serial(async()=>{
      if(!recycleId(request.material_id)||!hashOK(request.record_sha256)||!recycleId(request.operation_id)||!Number.isSafeInteger(request.expected_recycle_revision)||request.expected_recycle_revision<0||request.expected_recycle_revision===Number.MAX_SAFE_INTEGER||!['recycle','restore'].includes(request.mode))fail('MATERIAL_ID','Use the current material ID, hash, recycle revision and operation ID.');
      const record=await this.item(request.material_id,request.record_sha256),state=await this.recycleState(record),recycled=request.mode==='recycle';
      if(state.operation_id===request.operation_id){
        if(state.expected_recycle_revision!==request.expected_recycle_revision||state.recycled!==recycled||state.session_id!==sessionId)fail('MATERIAL_RECYCLE_CHANGED','Operation identity changed. Refresh the material list.');
        return {...this.summary(record),recycled:state.recycled,recycle_revision:state.recycle_revision,idempotent:true};
      }
      if(state.recycle_revision!==request.expected_recycle_revision||state.recycled===recycled)fail('MATERIAL_RECYCLE_CHANGED','Material recycle state changed. Refresh before trying again.');
      const next={schema_version:1,material_id:record.material_id,record_sha256:record.record_sha256,recycled,recycle_revision:state.recycle_revision+1,operation_id:request.operation_id,expected_recycle_revision:state.recycle_revision,changed_at:new Date(this.now()).toISOString(),session_id:sessionId};next.state_sha256=digest(next);
      const check=async()=>{signal?.throwIfAborted();await fence();await this.item(record.material_id,record.record_sha256);const current=await this.recycleState(record);if(current.recycle_revision!==state.recycle_revision)fail('MATERIAL_RECYCLE_CHANGED','Material recycle state changed. Refresh before trying again.');};
      await this.save('.cardstudio-scean/material-recycle/'+record.material_id+'.json',next,signal,check);
      return {...this.summary(record),recycled,recycle_revision:next.recycle_revision,idempotent:false};
    });
  }
  async visibleRows(recycled=false){const rows=[];for(const row of this.rows){const state=await this.recycleState(row);if(state.recycled===recycled)rows.push({...row,recycled:state.recycled,recycle_revision:state.recycle_revision});}return rows;}
  summary(r){return {material_id:r.material_id,record_sha256:r.record_sha256,kind:r.kind,title:r.title,summary:r.summary,aliases:r.aliases??[],tags:r.tags??[],created_at:r.created_at,body_characters:r.body.length,coverage:'summary-only'};}
  async rebuild(signal){return this.serial(async()=>{
    const directory=await this.boundary('materials/items',true),rows=[],diagnostics=[];let count=0,characters=0,complete=true;
    const dir=await fs.opendir(directory);for await(const file of dir){signal?.throwIfAborted();if(++count>this.limits.items){complete=false;diagnostics.push({code:'ITEM_BUDGET'});break;}if(!file.isFile()||!file.name.endsWith('.json')){diagnostics.push({code:'IGNORED_FILE'});complete=false;continue;}
      try{const r=await this.item(file.name.slice(0,-5)),segments=[];for(const field of ['title','summary','aliases','tags','body','use_notes']){const raw=Array.isArray(r[field])?r[field].join('\n'):r[field]??'',value=raw.slice(0,Math.max(0,Math.min(field==='body'?this.limits.indexBody:raw.length,this.limits.indexCharacters-characters)));segments.push({field:field==='title'?'name':field,locator:'material/'+field,text:value,total_characters:raw.length,text_complete:value.length===raw.length});characters+=value.length;}rows.push({...this.summary(r),item_id:r.material_id,segments,coverage:segments.some(x=>!x.text_complete)?'partial-index':'indexed-fields'});}catch(e){diagnostics.push({file:file.name,code:e.code??'MATERIAL_PARSE'});complete=false;}
    }
    const generation=randomUUID(),cache={schema_version:1,index_generation:generation,complete,diagnostics,rows};await this.save('.cardstudio-scean/material-index.json',cache,signal);this.rows=rows;this.generation=generation;this.complete=complete;this.diagnostics=diagnostics;this.scanned=true;return this.status();
  });}
  status(){return {index_generation:this.generation,complete:this.complete,total:this.rows.length,coverage:'bounded-record-index',diagnostics:this.diagnostics??[],capabilities:{lexical:true,embedding:'unavailable',vector:'unavailable'},limits:this.limits};}
  async catalog(args={},signal,{recycled=false}={}){if(!this.scanned)await this.rebuild(signal);const offset=args.offset??0,limit=args.limit??20;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20||args.kind!==undefined&&!['character','worldbook'].includes(args.kind))fail('MATERIAL_BUDGET','Catalog pages are at most 20.');const rows=(await this.visibleRows(recycled)).filter(r=>!args.kind||r.kind===args.kind),items=[];for(const row of rows.slice(offset,offset+limit)){try{items.push({...this.summary(await this.item(row.material_id,row.record_sha256)),recycled:row.recycled,recycle_revision:row.recycle_revision});}catch(e){items.push({material_id:row.material_id,state:'changed',error:e.code});}}return {...this.status(),items,total:rows.length,offset,limit,next_offset:offset+limit<rows.length?offset+limit:null,coverage:'summary-only'};}
  async search(args,signal){if(!this.scanned)await this.rebuild(signal);const found=retrieveLexical(args.query,await this.visibleRows(),args),items=[],stale=[];for(const hit of found.hits){try{const r=await this.item(hit.row.material_id,hit.row.record_sha256);items.push({...this.summary(r),recycled:false,recycle_revision:hit.row.recycle_revision,score:hit.score,evidence:hit.evidence,index_coverage:hit.row.coverage});}catch(e){stale.push({material_id:hit.row.material_id,code:e.code});}}const {hits,...details}=found;return {...this.status(),...details,items,stale,coverage:'partial',scope:'Bounded lexical candidates; read complete body/use_notes before adaptation. No semantic merge.'};}
  async read(args){const r=await this.item(args.material_id,args.record_sha256);if(!hashOK(args.record_sha256))fail('MATERIAL_HASH','Read requires the exact record hash.');const field=args.field??'body',offset=args.offset??0,budget=args.budget??8000;if(!['body','use_notes','summary','provenance'].includes(field)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(budget)||budget<1||budget>12000)fail('MATERIAL_BUDGET','Use body/use_notes/summary/provenance, offset and 1..12000 characters.');const raw=field==='provenance'?JSON.stringify(r.provenance,null,2):r[field];return {...this.summary(r),field,text:raw.slice(offset,offset+budget),raw_start:Math.min(offset,raw.length),raw_end:Math.min(offset+budget,raw.length),total_characters:raw.length,text_complete:offset===0&&budget>=raw.length,next_offset:offset+budget<raw.length?offset+budget:null,coverage:offset===0&&budget>=raw.length?'complete-field':'partial',use_notes:r.use_notes,provenance:r.provenance};}
  async trace(args){const r=await this.item(args.material_id,args.record_sha256),sources=[];for(const p of r.provenance){if(!hashOK(p.source_sha256)||!['json','png'].includes(p.snapshot_format)||p.snapshot!=='materials/sources/'+p.source_sha256+'.'+p.snapshot_format)fail('MATERIAL_VERIFY','Invalid snapshot identity.');const file=await this.boundary(p.snapshot,true),st=await fs.lstat(file);if(!st.isFile()||st.size>32*1024*1024)fail('MATERIAL_VERIFY','Invalid snapshot.');const bytes=await fs.readFile(file);if(sha(bytes)!==p.source_sha256)fail('MATERIAL_VERIFY','Source snapshot hash mismatch.');sources.push({...p,snapshot_verified:true});}return {material_id:r.material_id,record_sha256:r.record_sha256,sources,coverage:'snapshot-identity',semantic_verification:'Human review required; byte integrity is not semantic verification.'};}
}

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { contained,atomicReplace } from './card-service.js';
import { sha,canonical,fail,compatibilityWarnings } from './codec.js';
import { decodeDocument,documentSegments,projectDocument,rawEntries,entrySummary,sourceEntryLocator } from './document-projection.js';
import { retrieveLexical,retrievalCapabilities } from './library-retrieval.js';

export const libraryLimits=Object.freeze({depth:4,entries:2000,fileBytes:32*1024*1024,scanBytes:256*1024*1024,cardCharacters:32768,indexCharacters:64*1024*1024,segmentsPerCard:256,scanMs:10000});
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const abort=signal=>signal?.throwIfAborted();
const page=(offset=0,limit=20)=>{if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)fail('BUDGET','Pages are at most 20 items.');return {offset,limit};};
export class LibraryIndex {
  constructor(root,{limits={},sourcePath=null}={}){this.root=root;this.sourcePath=sourcePath;this.limits={...libraryLimits,...limits};this.rows=new Map();this.generation=randomUUID();this.complete=false;this.queue=Promise.resolve();this.closed=false;this.controller=new AbortController();this.lastScan=0;this.diagnostics=[];}
  async init(){
    this.sourceLocation=this.sourcePath??path.join(this.root,'library');
    // Only the legacy default is created. A selected source is never written.
    if(!this.sourcePath)await fs.mkdir(await contained(this.root,'library'),{recursive:true});
    const stat=await fs.lstat(this.sourceLocation);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('LIBRARY_PATH','Library source must be an ordinary directory.');
    this.sourceRoot=await fs.realpath(this.sourceLocation);
    const metadata=await fs.realpath(path.join(this.root,'.cardstudio-scean')),overlap=path.relative(this.sourceRoot,metadata),inside=path.relative(metadata,this.sourceRoot);
    if(!inside||inside!=='..'&&!inside.startsWith('..'+path.sep)&&!path.isAbsolute(inside))fail('LIBRARY_PATH','Library source cannot be inside Card Studio metadata.');
    if(!overlap||overlap!=='..'&&!overlap.startsWith('..'+path.sep)&&!path.isAbsolute(overlap))fail('LIBRARY_PATH','Library source cannot contain Card Studio metadata.');
    const probe=await fs.opendir(this.sourceRoot);await probe.close();
    this.sourceRootStat=stat;this.rootId=sha(Buffer.from(this.sourceRoot.toLowerCase()));
    this.cacheRelative=this.sourcePath?'.cardstudio-scean/library/'+this.rootId:'.cardstudio-scean/library';
    for(const relative of [...new Set(['.cardstudio-scean/library',this.cacheRelative])]){
      const target=await contained(this.root,relative);await fs.mkdir(target,{recursive:true});
      const st=await fs.lstat(target);if(!st.isDirectory()||st.isSymbolicLink())fail('LIBRARY_PATH','Derived cache must not be redirected.');
    }
    this.cacheRoot=await fs.realpath(await contained(this.root,this.cacheRelative,{existing:true}));
    this.cacheRootStat=await fs.lstat(this.cacheRoot);
  }
  async cacheBoundary(){
    for(const relative of ['.cardstudio-scean','.cardstudio-scean/library',this.cacheRelative]){const target=await contained(this.root,relative,{existing:true});if((await fs.lstat(target)).isSymbolicLink())fail('LIBRARY_PATH','Derived cache must not be redirected.');}
    const stat=await fs.lstat(this.cacheRoot);
    if(stat.dev!==this.cacheRootStat.dev||stat.ino!==this.cacheRootStat.ino||await fs.realpath(await contained(this.root,this.cacheRelative,{existing:true}))!==this.cacheRoot)fail('LIBRARY_PATH','Derived cache root changed.');
  }
  async boundary(relative=''){
    const root=this.sourcePath?this.sourceLocation:await contained(this.root,'library',{existing:true}),stat=await fs.lstat(root);
    if(stat.isSymbolicLink()||!stat.isDirectory()||stat.dev!==this.sourceRootStat.dev||stat.ino!==this.sourceRootStat.ino||await fs.realpath(root)!==this.sourceRoot)fail('ROOT_CHANGED','Library root changed. Reopen the workspace.');
    if(relative&&(path.isAbsolute(relative)||/[\0:]/.test(relative)||relative.split(/[\\/]/).some(x=>!x||x==='.'||x==='..')))fail('LIBRARY_PATH','Invalid source location.');
    let target=root;
    for(const part of relative?relative.split('/'):[]){target=path.join(target,part);const st=await fs.lstat(target);if(st.isSymbolicLink())fail('LIBRARY_PATH','Symlinks and junctions are excluded.');}
    const real=await fs.realpath(target),rel=path.relative(this.sourceRoot,real);
    if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail('LIBRARY_PATH','Source leaves library.');
    return target;
  }
  async stableRead(relative,signal){
    abort(signal);const target=await this.boundary(relative),before=await fs.lstat(target);
    if(!before.isFile())fail('LIBRARY_PATH','Only ordinary source files are readable.');
    if(before.size<1||before.size>this.limits.fileBytes)fail('LIBRARY_LIMIT','Source is empty or exceeds the file budget.');
    const handle=await fs.open(target,'r');
    try{
      const first=await handle.stat();if(!sameStat(before,first))fail('SOURCE_PENDING','Source is being replaced.');
      // Bounded positional read: a file growing during a read cannot exceed the budget.
      const bytes=Buffer.alloc(first.size);let offset=0;
      while(offset<bytes.length){abort(signal);const read=await handle.read(bytes,offset,Math.min(1024*1024,bytes.length-offset),offset);if(!read.bytesRead)fail('SOURCE_PENDING','Source changed while reading.');offset+=read.bytesRead;}
      const after=await handle.stat(),current=await fs.lstat(await this.boundary(relative));
      if(!sameStat(first,after)||!sameStat(after,current))fail('SOURCE_PENDING','Source changed while reading.');
      abort(signal);return {bytes,source_sha256:sha(bytes),stat:after};
    }finally{await handle.close();}
  }
  serial(fn){const job=this.queue.catch(()=>{}).then(()=>{if(this.closed)fail('CLOSING','Library is closed.');return fn();});this.queue=job;return job;}
  async scan(signal){signal=AbortSignal.any([this.controller.signal,...signal?[signal]:[]]);return this.serial(async()=>{
    abort(signal);await this.boundary();const next=new Map(),diagnostics=[];let count=0,bytes=0,characters=0,complete=true;const start=Date.now();
    const walk=async(relative,depth)=>{
      abort(signal);let directory;
      try{directory=await fs.opendir(await this.boundary(relative));}catch(error){if(error.name==='AbortError')throw error;complete=false;diagnostics.push({code:error.code??'SCAN_DIRECTORY',relative_path:relative});return;}
      for await(const entry of directory){
        abort(signal);if(++count>this.limits.entries||Date.now()-start>this.limits.scanMs){complete=false;diagnostics.push({code:'SCAN_BUDGET'});break;}
        const rel=relative?relative+'/'+entry.name:entry.name;
        try{
          const target=await this.boundary(rel),stat=await fs.lstat(target);
          if(stat.isDirectory()){
            if(depth>=this.limits.depth){complete=false;diagnostics.push({code:'DEPTH_LIMIT',relative_path:rel});}else await walk(rel,depth+1);
          }else if(stat.isFile()&&/\.(png|json)$/i.test(entry.name)){
            const item_id='lib-'+sha(Buffer.from(this.rootId+'\0'+rel)).slice(0,32);
            let source;
            try{
              if(bytes+stat.size>this.limits.scanBytes){complete=false;diagnostics.push({code:'SCAN_BYTE_BUDGET'});break;}
              source=await this.stableRead(rel,signal);bytes+=source.bytes.length;const decoded=decodeDocument(source.bytes,'card');
              const segments=[];let used=0,truncated=false;
              for(const segment of documentSegments(decoded)){
                if(segments.length>=this.limits.segmentsPerCard){truncated=true;break;}
                const available=Math.max(0,Math.min(this.limits.cardCharacters-used,this.limits.indexCharacters-characters));
                const text=segment.text.slice(0,available);if(text.length<segment.text.length)truncated=true;
                if(text.length){segments.push({...segment,text,total_characters:segment.text.length,text_complete:text.length===segment.text.length});used+=text.length;characters+=text.length;}
              }
              const warnings=[...(decoded.warnings??[]),...compatibilityWarnings(decoded.card)];
              next.set(item_id,{item_id,relative_path:rel,source_sha256:source.source_sha256,identity:sha(Buffer.from(canonical(decoded.card))),name:decoded.card.data.name.slice(0,200),format:decoded.kind,tags:(decoded.card.data.tags??[]).slice(0,16).map(x=>x.slice(0,100)),segments,coverage:truncated?'partial':'indexed-fields',warnings:warnings.slice(0,20),omitted_warnings:Math.max(0,warnings.length-20),state:'ready'});
            }catch(error){if(error.name==='AbortError')throw error;next.set(item_id,{item_id,relative_path:rel,name:entry.name.slice(0,200),state:'error',error:{code:error.code??'PARSE',message:'Source could not be read/parsed; other cards remain available.'},...source?{source_sha256:source.source_sha256}:{}});}
          }
        }catch(error){if(error.name==='AbortError')throw error;diagnostics.push({code:error.code??'LIBRARY_PATH',relative_path:rel});}
        if(count%50===0)await yieldLoop();
      }
    };
    await walk('',0);abort(signal);await this.boundary();
    // Unvisited old rows survive an incomplete scan, visibly unverified, never called deleted.
    if(!complete)for(const [id,row] of this.rows)if(!next.has(id))next.set(id,{...row,state:'unverified'});
    const generation=randomUUID(),manifest={schema_version:1,projection_version:'card-fields-v1',lexical_version:'cjk-fields-v1',root_id:this.rootId,index_generation:generation,complete,limits:this.limits,diagnostics:diagnostics.slice(0,100),items:[...next.values()]};
    await this.cacheBoundary();await atomicReplace(await contained(this.root,this.cacheRelative+'/index.json'),Buffer.from(JSON.stringify(manifest)),signal);
    this.rows=next;this.generation=generation;this.complete=complete;this.lastScan=Date.now();this.diagnostics=manifest.diagnostics;
    return this.status();
  });}
  status(){return {index_generation:this.generation,complete:this.complete,source:'library/',source_path:this.sourceRoot,root_id:this.rootId,source_count:this.rows.size,limits:this.limits,diagnostics:this.diagnostics,capabilities:retrievalCapabilities,scan_time:this.lastScan||null};}
  async ensure(signal){if(!this.lastScan)await this.scan(signal);}
  summary(row){const {segments,identity,...summary}=row;return summary;}
  groups(){const groups=new Map();for(const row of this.rows.values()){const key=row.state==='ready'?row.identity:row.item_id;const group=groups.get(key)??[];group.push(row);groups.set(key,group);}return [...groups.values()].map(group=>group.sort((a,b)=>a.relative_path.localeCompare(b.relative_path)));}
  async verified(args,signal){
    if(typeof args.item_id!=='string'||!/^lib-[a-f0-9]{32}$/.test(args.item_id)||!/^([a-f0-9]{64})$/.test(args.source_sha256??''))fail('SOURCE_ID','Use an observed library item ID and complete source hash.');
    const row=this.rows.get(args.item_id);if(!row||row.state!=='ready')fail('SOURCE_UNAVAILABLE','Source is unavailable; rescan library.');
    let source;try{source=await this.stableRead(row.relative_path,signal);}catch(error){if(error.code==='ENOENT')fail('SOURCE_DELETED','Source was deleted or renamed. Rescan library.');throw error;}
    if(source.source_sha256!==args.source_sha256||row.source_sha256!==args.source_sha256)fail('SOURCE_CHANGED','Source hash changed. Rescan and use the new result.');
    return {row,...source,decoded:decodeDocument(source.bytes,'card')};
  }
  async list(args,signal){
    const {offset,limit}=page(args.offset,args.limit);await this.ensure(signal);const groups=this.groups(),items=[];
    for(const group of groups.slice(offset,offset+limit)){
      const row=group[0],image=group.find(x=>x.format==='png');let freshness='unverified';
      if(row.state==='ready')try{await this.verified(row,signal);freshness='verified';}catch(error){if(error.name==='AbortError')throw error;freshness=error.code??'SOURCE_UNAVAILABLE';}
      items.push({...this.summary(row),freshness,source_count:group.length,image_source:image?{item_id:image.item_id,source_sha256:image.source_sha256,relative_path:image.relative_path}:null,identity_basis:group.length>1?'Exact canonical complete selected main card, including unknown fields. Images, bytes and inactive PNG metadata remain distinct source versions.':'Independent source; filenames/approximate similarity are not identity.'});
    }
    return {...this.status(),items,total:groups.length,offset,limit};
  }
  async variants(args,signal){
    const {row}=await this.verified(args,signal),{offset,limit}=page(args.offset,args.limit);
    const versions=[...this.rows.values()].filter(x=>x.state==='ready'&&x.identity===row.identity),items=[];
    for(const version of versions.slice(offset,offset+limit)){try{await this.verified(version,signal);items.push({...this.summary(version),freshness:'verified'});}catch(error){if(error.name==='AbortError')throw error;items.push({...this.summary(version),freshness:error.code??'SOURCE_UNAVAILABLE'});}}
    return {...this.status(),items,total:versions.length,offset,limit};
  }
  async search(args,signal){
    await this.ensure(signal);const representatives=this.groups().map(g=>g[0]).filter(x=>x.state==='ready');
    const result=retrieveLexical(args.query,representatives,args),items=[],stale=[];
    for(const hit of result.hits){try{await this.verified(hit.row,signal);items.push({...this.summary(hit.row),score:hit.score,evidence:hit.evidence,freshness:'verified'});}catch(error){if(error.name==='AbortError')throw error;stale.push({item_id:hit.row.item_id,code:error.code??'SOURCE_UNAVAILABLE'});}}
    const {hits,...retrieval}=result;return {...this.status(),...retrieval,items,stale,coverage:'partial',scope:'Bounded indexed fields and top candidates; no fact/quantity verification.',limit:args.limit??8};
  }
  async readEvidence(args,signal){const source=await this.verified(args,signal);return {...this.summary(source.row),...projectDocument(source.decoded,args),index_generation:this.generation};}
  async read(args,signal){return this.readEvidence(args,signal);}
  async entries(args,signal){const {decoded,row}=await this.verified(args,signal),{offset,limit}=page(args.offset,args.limit),book=decoded.card.data.character_book,entries=rawEntries(book);return {...this.summary(row),items:entries.slice(offset,offset+limit).map((entry,i)=>{const summary=entrySummary(book,entry,'source-entry:'+String(offset+i));return {...summary,comment:summary.comment.slice(0,200),keys:summary.keys.slice(0,16).map(x=>x.slice(0,100)),index:offset+i,entry_locator:sourceEntryLocator(entry,offset+i,book)};}),total:entries.length,offset,limit,coverage:'partial'};}
  async entry(args,signal){
    const {decoded,row}=await this.verified(args,signal);if(!Number.isSafeInteger(args.entry_index)||args.entry_index<0)fail('LOCATOR','Use an observed nonnegative entry index.');
    const book=decoded.card.data.character_book,entry=rawEntries(book)[args.entry_index];if(!entry)fail('ENTRY_NOT_FOUND','Unknown source entry.');
    const locators=[];let count=0;
    for(const segment of documentSegments(decoded)){if(segment.entry_locator?.index>args.entry_index)break;if(segment.entry_locator?.index===args.entry_index){count++;if(locators.length<16)locators.push(segment.locator);}}
    return {...this.summary(row),entry_locator:sourceEntryLocator(entry,args.entry_index,book),...projectDocument(decoded,{locators,offset:args.offset,budget:args.budget}),omitted_entry_segments:Math.max(0,count-16)};
  }
  async operation(args,signal){
    const actions={list:['offset','limit'],search:['query','query_terms','limit'],read:['item_id','source_sha256','fields','locators','offset','budget'],entries:['item_id','source_sha256','offset','limit'],entry:['item_id','source_sha256','entry_index','offset','budget'],variants:['item_id','source_sha256','offset','limit'],refresh:[],rebuild:[]},admitted=actions[args?.action];
    if(!admitted||Object.keys(args).some(x=>x!=='action'&&!admitted.includes(x)))fail('LIBRARY_ARGUMENT','Choose a bounded Library operation; arbitrary paths, URLs, credentials and source mutations are refused.');
    if(['refresh','rebuild'].includes(args.action))return this.scan(signal);
    return this[args.action](args,signal);
  }
  async close(){this.closed=true;this.controller.abort();await Promise.allSettled([this.queue]);}
}

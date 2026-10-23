import {SceanError,hash} from './contracts.mjs';
import {chapterSummaryView,validateChapterPayload} from './chapter-summary.mjs';

// Player reading is deliberately stricter than model-context selection. A key
// match, enabled flag or unlabelled author text never grants player visibility.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const denied=v=>object(v)&&(Object.hasOwn(v,'contextScope')||v.scope?.kind==='player_only'||v.role==='player_history'||v.visibility!==undefined&&v.visibility!=='public'||v.access?.kind!==undefined&&v.access.kind!=='world_public');
const publicMark=v=>object(v)&&(v.visibility==='public'||v.access?.kind==='world_public');
const containers=v=>object(v)?[v,...(object(v.extensions)?[v.extensions]:[])]:[];
const blocked=values=>values.some(v=>containers(v).some(denied));
const marked=values=>values.some(v=>containers(v).some(publicMark));
const fail=code=>{throw new SceanError(code);};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const title=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):fallback;
const headOf=run=>run.head??run.turns?.at(-1)?.commitId??null;
function identity(run,args){
  if(!object(run)||typeof run.runId!=='string'||!object(run.snapshot)||typeof run.snapshot.hash!=='string')fail('READER_RUN_REQUIRED');
  if(args.expectedSnapshotHash!==undefined&&args.expectedSnapshotHash!==run.snapshot.hash||args.expectedHead!==undefined&&args.expectedHead!==headOf(run))fail('READER_SOURCE_CHANGED');
  return{schemaVersion:1,runId:run.runId,snapshotHash:run.snapshot.hash,version:run.version,head:headOf(run)};
}
function unwrap(raw){
  const chain=[];let value=raw;
  for(let i=0;i<8&&object(value);i++){
    chain.push(value);
    if(value.spec==='lorebook_v3'){value=value.data;continue;}
    if(value.card?.data?.character_book){chain.push(value.card,value.card.data);value=value.card.data.character_book;continue;}
    if(value.data?.character_book){chain.push(value.data);value=value.data.character_book;continue;}
    if(value.book){value=value.book;continue;}
    return{book:value,chain};
  }
  return{book:null,chain};
}
function candidates(snapshot){
  const rows=[],embedded=snapshot.card?.data?.character_book;
  if(embedded!==undefined)rows.push({raw:embedded,path:'embedded',parents:[snapshot.card,snapshot.card?.data]});
  const raw=snapshot.worldbooks??snapshot.worldbook;
  const list=Array.isArray(raw)?raw:Array.isArray(raw?.books)?raw.books:[raw];
  for(const[index,value]of list.entries())if(value!==undefined&&value!==null){
    const parents=Array.isArray(raw?.books)?[raw]:[];
    const sameEmbedded=embedded!==undefined&&snapshot.source?.worldbook?.kind!=='saved_document'&&hash(unwrap(value).book)===hash(unwrap(embedded).book);
    if(snapshot.source?.worldbook?.kind==='embedded'||value===embedded||sameEmbedded)parents.push(snapshot.card,snapshot.card?.data);
    rows.push({raw:value,path:'worldbook-'+index,parents,publicParents:Array.isArray(raw?.books)?[raw]:[]});
  }
  return rows;
}
function visibleEntries(run){
  const result=[],seen=new Set();
  for(const candidate of candidates(run.snapshot)){
    const{book,chain}=unwrap(candidate.raw),ancestors=[...candidate.parents,...chain];
    if(!object(book)||blocked(ancestors))continue;
    const rows=Array.isArray(book.entries)?book.entries.map((v,i)=>[String(i),v]):object(book.entries)?Object.entries(book.entries):[];
    const bookPublic=marked([...chain,...(candidate.publicParents??[])]),bookTitle=bookPublic?title(book.name,'世界設定'):'世界設定';
    for(const[key,entry]of rows){
      if(!object(entry)||typeof entry.content!=='string'||!entry.content.trim()||blocked([entry])||!bookPublic&&!marked([entry]))continue;
      const entryTitle=title(entry.name??entry.comment,'設定條目');
      // Exact duplicate display content is collapsed only after authorization;
      // a hidden/private twin cannot suppress or influence a public entry.
      const duplicate=hash({bookTitle,title:entryTitle,content:entry.content});if(seen.has(duplicate))continue;seen.add(duplicate);
      result.push({id:'entry-'+hash({runId:run.runId,snapshotHash:run.snapshot.hash,path:candidate.path,key}).slice(0,24),title:entryTitle,bookTitle,content:entry.content});
    }
  }
  return result;
}

/** Pure, bounded projection of the fixed Snapshot. Host authorizes the Run. */
export function playerWorldbook(run,args={}){
  const stamp=identity(run,args),query=args.query??'',cursor=args.cursor??0,limit=args.limit??30,offset=args.contentOffset??0;
  if(typeof query!=='string'||query.length>200||!integer(cursor,0,10000)||!integer(limit,1,50)||!integer(offset,0,8*1024*1024)||args.entryId!==undefined&&(typeof args.entryId!=='string'||!/^entry-[a-f0-9]{24}$/.test(args.entryId)))fail('READER_QUERY_INVALID');
  const all=visibleEntries(run);
  if(args.entryId!==undefined){
    const selected=all.find(r=>r.id===args.entryId);if(!selected)fail('READER_ENTRY_NOT_FOUND');
    const content=selected.content.slice(offset,offset+12000),next=offset+content.length;
    return{...stamp,kind:'worldbook',status:'ready',entry:{id:selected.id,title:selected.title,bookTitle:selected.bookTitle,content,contentOffset:offset,nextContentOffset:next<selected.content.length?next:null}};
  }
  const needle=query.trim().toLocaleLowerCase(),filtered=needle?all.filter(r=>(r.title+'\n'+r.content).toLocaleLowerCase().includes(needle)):all;
  const page=filtered.slice(cursor,cursor+limit);
  return{...stamp,kind:'worldbook',status:all.length?'ready':'empty',entries:page.map(({id,title,bookTitle})=>({id,title,bookTitle})),total:filtered.length,nextCursor:cursor+page.length<filtered.length?cursor+page.length:null};
}

/** Only active structured chapter payloads; no rolling or handoff summaries. */
export function playerRecap(run,args={}){
  const stamp=identity(run,args),id=args.chapterId,cursor=args.cursor??0,limit=args.limit??30;
  if(!integer(cursor,0,10000)||!integer(limit,1,128)||id!==undefined&&(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)))fail('READER_QUERY_INVALID');
  const active=c=>integer(c.startTurn,1,run.turns?.length??0)&&integer(c.endTurn,c.startTurn,run.turns.length)&&Array.isArray(c.commitIds)&&Array.isArray(c.sourceHashes)&&c.commitIds.length===c.endTurn-c.startTurn+1&&c.commitIds.every((commit,i)=>{const t=run.turns[c.startTurn+i-1];return commit===t.commitId&&c.sourceHashes[i]===hash({commitId:t.commitId,input:t.input,body:t.body});});
  const publicIds=new Set((run.narrative?.chapters??[]).filter(c=>c.visibility==='public'&&c.perspective==='public_story'&&active(c)).map(c=>c.id));
  if(id!==undefined&&!publicIds.has(id))fail('READER_CHAPTER_NOT_FOUND');
  const narrowed=run.narrative?{...run,narrative:{...run.narrative,chapterSummaries:(run.narrative.chapterSummaries??[]).filter(s=>s.visibility==='public'&&s.perspective==='public_story')}}:run;
  const view=chapterSummaryView(narrowed,id);
  const rows=view.chapters.filter(c=>publicIds.has(c.id)&&c.current&&c.status==='completed');
  const chapters=rows.map(c=>{
    const record=narrowed.narrative?.chapterSummaries?.find(s=>s.id===c.summaryId);
    const payload=record?validateChapterPayload(record.payload):null;
    return{id:c.id,order:c.order,title:payload?.title??c.title,startTurn:c.startTurn,endTurn:c.endTurn,summaryAvailable:!!c.summaryId,summaryPreview:payload?.summary.slice(0,320)??null,summaryTruncated:(payload?.summary.length??0)>320,summaryStatus:c.summaryStatus,source:{startCommitId:c.source.startCommitId,endCommitId:c.source.endCommitId}};
  });
  if(id===undefined){
    const start=Math.max(0,...rows.map(c=>c.endTurn)),remaining=(run.turns??[]).slice(start);
    const unarchived=remaining.length?{title:'尚未歸檔的原文',startTurn:start+1,endTurn:run.turns.length,source:{startCommitId:remaining[0].commitId,endCommitId:remaining.at(-1).commitId}}:null;
    return{...stamp,kind:'recap',status:chapters.length||unarchived?'ready':'empty',chapters:chapters.slice(cursor,cursor+limit),total:chapters.length,nextCursor:cursor+limit<chapters.length?cursor+limit:null,unarchived};
  }
  const row=rows.find(c=>c.id===id);if(!row)fail('READER_CHAPTER_NOT_FOUND');
  return{...stamp,kind:'recap',status:row.summary?'ready':'no_summary',chapter:{...chapters.find(c=>c.id===id),summary:row.summary?validateChapterPayload(row.summary):null}};
}

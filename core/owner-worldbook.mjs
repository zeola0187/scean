import {SceanError,hash} from './contracts.mjs';

// Human/operator-only fixed-Snapshot projection. Authorization belongs to Host;
// this pure module must never be used as an Agent context or permission grant.
export const OWNER_WORLDBOOK_WIRE_BYTES=48*1024;
const PARSER_VERSION=1,MAX_ENTRIES=20000;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const bytes=v=>Buffer.byteLength(JSON.stringify(v),'utf8');
const fail=code=>{throw new SceanError(code);};
const sensitive=[
  /\b(?:sk-proj-|sk-|gh[pousr]_|github_pat_|AIza)[A-Za-z0-9_-]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)/g,
  /\b(?:authorization|api[_ -]?key|operator[_ -]?token|access[_ -]?token|grantToken|cookie|password)\s*[:=]\s*["']?[A-Za-z0-9._~+\/=;-]{12,}["']?/gi,
];
function safeText(value,max=Infinity){
  let text=value,redacted=false,truncated=false;
  for(const pattern of sensitive)text=text.replace(pattern,()=>{redacted=true;return '[敏感片段未提供]';});
  if(!text.isWellFormed()){text=text.toWellFormed();truncated=true;}
  if(text.length>max){text=unicodeSlice(text,0,max);truncated=true;}
  return {text,redacted,truncated};
}
function unicodeSlice(text,start,end){
  if(end<text.length&&end>0&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  return text.slice(start,end);
}
function unwrap(raw){
  let book=raw;const chain=[];
  for(let i=0;i<8;i++){
    if(!object(book))return {book:null,chain};chain.push(book);
    if(book.spec==='lorebook_v3'){book=book.data;continue;}
    if(book.card?.data&&Object.hasOwn(book.card.data,'character_book')){chain.push(book.card,book.card.data);book=book.card.data.character_book;continue;}
    if(book.data&&Object.hasOwn(book.data,'character_book')){chain.push(book.data);book=book.data.character_book;continue;}
    if(Object.hasOwn(book,'book')){book=book.book;continue;}
    return {book,chain};
  }
  return {book:null,chain};
}
function candidates(snapshot){
  const rows=[],embedded=snapshot.card?.data;
  if(object(embedded)&&Object.hasOwn(embedded,'character_book'))rows.push({raw:embedded.character_book,path:'card.data.character_book',source:snapshot.source?.card,parents:[snapshot.card,embedded]});
  const raw=snapshot.worldbooks??snapshot.worldbook;
  if(raw!==undefined&&raw!==null){
    const list=Array.isArray(raw)?raw:Array.isArray(raw?.books)?raw.books:[raw];
    for(const[index,value]of list.entries())rows.push({raw:value,path:Array.isArray(raw)||Array.isArray(raw?.books)?`worldbooks:${index}`:'worldbook',source:object(value?.source)?value.source:snapshot.source?.worldbook,parents:Array.isArray(raw?.books)?[raw]:[]});
  }else if(snapshot.source?.worldbook?.kind==='saved_document')rows.push({raw:null,path:'worldbook',source:snapshot.source.worldbook,parents:[],missing:true});
  return rows;
}
function visibility(values){
  let publicValue=false,other;
  for(const value of values.filter(object).flatMap(v=>[v,...object(v.extensions)?[v.extensions]:[]])){
    if(Object.hasOwn(value,'contextScope')||value.scope?.kind==='player_only'||value.role==='player_history')return 'restricted';
    if(value.visibility!==undefined){if(value.visibility!=='public')return typeof value.visibility==='string'?safeText(value.visibility,80).text:'unmarked';publicValue=true;}
    if(value.access?.kind!==undefined){if(value.access.kind==='world_public')publicValue=true;else other=typeof value.access.kind==='string'?safeText(value.access.kind,80).text:'restricted';}
  }
  return other??(publicValue?'public':'unmarked');
}
function enabled(values){
  if(values.some(v=>v?.enabled===false||v?.disable===true))return false;
  return values.some(v=>v?.enabled===true||v?.disable===false)?true:null;
}
const scalarFields=['enabled','disable','constant','selective','selectiveLogic','selective_logic','insertion_order','order','priority','displayIndex','position','case_sensitive','caseSensitive','match_whole_words','matchWholeWords','use_regex','useRegex'];
const keyFields=['keys','key','secondary_keys','keysecondary'];
function metadata(entry){
  const out={};let redacted=false,truncated=false;
  function value(v){
    if(typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||v===null)return v;
    if(typeof v==='string'){const s=safeText(v,1000);redacted||=s.redacted;truncated||=s.truncated;return s.text;}
    if(v!==undefined)truncated=true;return undefined;
  }
  for(const key of scalarFields){const v=value(entry[key]??entry.extensions?.[key]);if(v!==undefined)out[key]=v;}
  for(const key of keyFields){const raw=entry[key];if(raw===undefined)continue;if(typeof raw==='string')out[key]=value(raw);else if(Array.isArray(raw)){if(raw.length>64)truncated=true;out[key]=raw.slice(0,64).map(value).filter(v=>typeof v==='string');if(out[key].length!==Math.min(raw.length,64))truncated=true;}else truncated=true;}
  if(typeof entry.comment==='string')out.comment=value(entry.comment);
  // Optional metadata must not prevent the complete entry content from paging.
  while(bytes(out)>8192){const keys=Object.keys(out);const longest=keys.sort((a,b)=>bytes(out[b])-bytes(out[a]))[0];if(!longest)break;const v=out[longest];if(Array.isArray(v)&&v.length>1)v.pop();else if(typeof v==='string'&&v.length>200)out[longest]=unicodeSlice(v,0,Math.floor(v.length/2));else delete out[longest];truncated=true;}
  return {value:out,redacted,truncated};
}
function project(run){
  const sourceRows=candidates(run.snapshot),entries=[],books=[];
  const coverage={status:'complete',books:sourceRows.length,entries:0,invalidEntries:0,unsupportedBooks:0,missingBooks:0,sensitiveOmissions:0,truncatedMetadata:0,entryLimitReached:false,scope:'recognized_snapshot_worldbook_entries',credentialScreening:'known_patterns_only'};
  for(const candidate of sourceRows){
    const {book,chain}=unwrap(candidate.raw),bookTitle=safeText(typeof book?.name==='string'&&book.name.trim()?book.name:'世界書',200),id='book-'+hash({snapshotHash:run.snapshot.hash,path:candidate.path}).slice(0,24);
    const descriptor={id,title:bookTitle.text,sourcePath:candidate.path,status:'ready'};
    const sourceId=candidate.source?.documentId??candidate.source?.id??book?.id;
    if(typeof sourceId==='string'){const safe=safeText(sourceId,128);descriptor.sourceId=safe.text;if(safe.redacted)coverage.sensitiveOmissions++;if(safe.truncated)coverage.truncatedMetadata++;}
    const revision=candidate.source?.revision??book?.revision??book?.version;
    if(typeof revision==='number'&&Number.isFinite(revision))descriptor.revision=revision;
    else if(typeof revision==='string'){const safe=safeText(revision,80);descriptor.revision=safe.text;if(safe.redacted)coverage.sensitiveOmissions++;if(safe.truncated)coverage.truncatedMetadata++;}
    if(bookTitle.redacted)coverage.sensitiveOmissions++;if(bookTitle.truncated)coverage.truncatedMetadata++;
    const rawEntries=book?.entries;
    if(!object(book)||!Array.isArray(rawEntries)&&!object(rawEntries)){descriptor.status=candidate.missing||candidate.raw===null?'source_missing':'unsupported_source';if(descriptor.status==='source_missing')coverage.missingBooks++;else coverage.unsupportedBooks++;books.push(descriptor);continue;}
    books.push(descriptor);
    for(const[key,entry]of (Array.isArray(rawEntries)?rawEntries.map((v,i)=>[String(i),v]):Object.entries(rawEntries))){
      coverage.entries++;if(entries.length>=MAX_ENTRIES){coverage.entryLimitReached=true;continue;}
      const valid=object(entry)&&typeof entry.content==='string'&&entry.content.isWellFormed(),rawTitle=object(entry)?entry.name??entry.comment:undefined,title=safeText(typeof rawTitle==='string'&&rawTitle.trim()?rawTitle:'未命名條目',200),content=safeText(valid?entry.content:'此條目內容無法解析。'),settings=metadata(object(entry)?entry:{});
      const redacted=title.redacted||content.redacted||settings.redacted,truncated=title.truncated||settings.truncated;
      if(!valid)coverage.invalidEntries++;if(redacted)coverage.sensitiveOmissions++;if(truncated)coverage.truncatedMetadata++;
      entries.push({id:'entry-'+hash({runId:run.runId,snapshotHash:run.snapshot.hash,path:candidate.path,key}).slice(0,24),title:title.text,bookTitle:descriptor.title,bookId:id,visibility:visibility([entry,...chain,...candidate.parents]),enabled:enabled([entry,...chain,...candidate.parents]),status:valid?(entry.content.length?'ready':'empty'):'source_corrupt',triggerStatus:'not_checked',sensitiveOmissions:redacted,content:content.text,metadata:settings.value});
    }
  }
  coverage.status=!sourceRows.length||coverage.missingBooks===sourceRows.length?'source_missing':coverage.unsupportedBooks===sourceRows.length?'unsupported_source':coverage.unsupportedBooks||coverage.missingBooks||coverage.invalidEntries||coverage.sensitiveOmissions||coverage.truncatedMetadata||coverage.entryLimitReached?'partial':'complete';
  return {entries,books,coverage};
}
function cursorOffset(cursor,identity,query){
  if(cursor===undefined||cursor===null||cursor===0)return 0;
  if(typeof cursor!=='string'||cursor.length>1200||!/^[A-Za-z0-9_-]+$/.test(cursor))fail('READER_QUERY_INVALID');
  let row;try{row=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{fail('READER_QUERY_INVALID');}
  if(!object(row)||Object.keys(row).some(k=>!['schemaVersion','runId','snapshotHash','readRevision','queryHash','offset'].includes(k))||row.schemaVersion!==1||!integer(row.offset,0,MAX_ENTRIES))fail('READER_QUERY_INVALID');
  if(row.runId!==identity.runId||row.snapshotHash!==identity.snapshotHash||row.readRevision!==identity.readRevision||row.queryHash!==hash(query))fail('READER_PAGE_CHANGED');return row.offset;
}
const makeCursor=(offset,identity,query)=>Buffer.from(JSON.stringify({schemaVersion:1,runId:identity.runId,snapshotHash:identity.snapshotHash,readRevision:identity.readRevision,queryHash:hash(query),offset})).toString('base64url');

/** Pure owner read model. Calling it never changes model selection or source data. */
export function ownerWorldbook(run,args={}){
  if(!object(run)||typeof run.runId!=='string'||!object(run.snapshot)||typeof run.snapshot.hash!=='string')fail('READER_RUN_REQUIRED');
  if(args.runId!==undefined&&args.runId!==run.runId||args.expectedSnapshotHash!==undefined&&args.expectedSnapshotHash!==run.snapshot.hash)fail('READER_SOURCE_CHANGED');
  const query=args.query??'',limit=args.limit??30,offset=args.contentOffset??0;
  if(typeof query!=='string'||query.length>200||!query.isWellFormed()||!integer(limit,1,50)||!integer(offset,0,16*1024*1024)||args.entryId!==undefined&&(typeof args.entryId!=='string'||!/^entry-[a-f0-9]{24}$/.test(args.entryId)))fail('READER_QUERY_INVALID');
  const projected=project(run),readRevision=hash({parserVersion:PARSER_VERSION,runId:run.runId,snapshotHash:run.snapshot.hash,cardId:run.snapshot.cardId??null,revision:run.snapshot.revision??null,sources:candidates(run.snapshot).map(c=>({path:c.path,raw:c.raw,source:c.source??null}))}),coverage=projected.coverage;
  const cardId=typeof run.snapshot.cardId==='string'?safeText(run.snapshot.cardId,128):null,revision=typeof run.snapshot.revision==='string'?safeText(run.snapshot.revision,80):null;
  if(cardId?.redacted||revision?.redacted){coverage.sensitiveOmissions++;coverage.status='partial';}if(cardId?.truncated||revision?.truncated){coverage.truncatedMetadata++;coverage.status='partial';}
  const source={kind:'fixed_run_snapshot',cardId:cardId?.text??null,revision:revision?.text??(typeof run.snapshot.revision==='number'&&Number.isFinite(run.snapshot.revision)?run.snapshot.revision:null)};
  const base={schemaVersion:1,kind:'owner_worldbook',runId:run.runId,snapshotHash:run.snapshot.hash,head:run.head??run.turns?.at(-1)?.commitId??null,version:run.version,readRevision,source,coverage,books:projected.books.slice(0,8)};
  if(projected.books.length>base.books.length){coverage.bookMetadataOmitted=projected.books.length-base.books.length;coverage.status='partial';}
  const status=coverage.status==='complete'?(projected.entries.length?'ready':'empty'):coverage.status;
  if(args.entryId!==undefined){
    const entry=projected.entries.find(r=>r.id===args.entryId);if(!entry)fail('READER_ENTRY_NOT_FOUND');
    if(offset>entry.content.length||offset>0&&offset<entry.content.length&&/[\uDC00-\uDFFF]/.test(entry.content[offset])&&/[\uD800-\uDBFF]/.test(entry.content[offset-1]))fail('READER_QUERY_INVALID');
    let end=Math.min(entry.content.length,offset+12000),content=unicodeSlice(entry.content,offset,end);end=offset+content.length;
    const response=()=>({...base,status,entry:{...entry,content,contentOffset:offset,nextContentOffset:end<entry.content.length?end:null}});
    while(bytes(response())>OWNER_WORLDBOOK_WIRE_BYTES&&content.length>0){content=unicodeSlice(content,0,Math.floor(content.length*.75));end=offset+content.length;}
    if(bytes(response())>OWNER_WORLDBOOK_WIRE_BYTES||end===offset&&offset<entry.content.length)fail('READER_PAGE_TOO_LARGE');return response();
  }
  const start=cursorOffset(args.cursor,base,query),needle=query.trim().toLocaleLowerCase(),all=needle?projected.entries.filter(r=>(r.title+'\n'+r.bookTitle+'\n'+r.content).toLocaleLowerCase().includes(needle)):projected.entries;
  if(start>all.length)fail('READER_QUERY_INVALID');let page=all.slice(start,start+limit);
  const response=()=>({...base,status,entries:page.map(({content,metadata,...entry})=>entry),total:all.length,nextCursor:start+page.length<all.length?makeCursor(start+page.length,base,query):null});
  while(bytes(response())>OWNER_WORLDBOOK_WIRE_BYTES&&page.length>1)page=page.slice(0,-1);
  if(bytes(response())>OWNER_WORLDBOOK_WIRE_BYTES)fail('READER_PAGE_TOO_LARGE');return response();
}

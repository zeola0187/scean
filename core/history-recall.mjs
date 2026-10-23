import {SceanError,hash,safeId} from './contracts.mjs';
import {publicTurnDialogue} from './dialogue-projection.mjs';
import {bm25,tokenizeForSparseRecall} from './memory.mjs';
import {headOf,HISTORY_LIMITS} from './history.mjs';

export const HISTORY_REFERENCE_LABEL='Historical reference — not a current event';
export const HISTORY_RECALL_LIMITS=Object.freeze({queryChars:512,hits:10,snippetChars:400,positions:32,radius:1,readChars:12000,pageTurns:20,pageBytes:131072,cursorChars:1024});
const fail=code=>{throw new SceanError(code);};
const integer=(value,fallback,min,max,code)=>{const n=value===undefined?fallback:value;if(!Number.isSafeInteger(n)||n<min||n>max)fail(code);return n;};
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
function active(run,requestedRunId){
  safeId(run.runId);if(requestedRunId!==undefined&&requestedRunId!==run.runId)fail('HISTORY_CROSS_RUN');
  if(!Array.isArray(run.turns)||run.turns.length>HISTORY_LIMITS.turns)fail('HISTORY_INCONSISTENT');
  const ids=new Set(),retired=new Set((run.retired??[]).map(t=>t.commitId));
  for(const t of run.turns){
    safeId(t.commitId);
    if(ids.has(t.commitId)||retired.has(t.commitId)||!Number.isSafeInteger(t.turn)||t.turn<1||typeof t.input!=='string'||typeof t.body!=='string')fail('HISTORY_INCONSISTENT');
    if(run.receipts?.[t.requestId]?.status==='retired')fail('HISTORY_INCONSISTENT');
    ids.add(t.commitId);
  }
  if(headOf(run)!==(run.turns.at(-1)?.commitId??null))fail('HISTORY_INCONSISTENT');
  return run.turns;
}
export function historyLocator(runId,commitId){safeId(runId);safeId(commitId);return `scean-history:${runId}:${commitId}`;}
function targetId(run,options){
  let id=options.commitId;
  if(options.locator!==undefined){
    if(typeof options.locator!=='string'||options.locator.length>280)fail('HISTORY_LOCATOR_INVALID');
    const parts=options.locator.split(':');if(parts.length!==3||parts[0]!=='scean-history')fail('HISTORY_LOCATOR_INVALID');
    if(parts[1]!==run.runId)fail('HISTORY_CROSS_RUN');
    if(id!==undefined&&id!==parts[2])fail('HISTORY_LOCATOR_MISMATCH');id=parts[2];
  }
  try{safeId(id);}catch{fail('HISTORY_LOCATOR_INVALID');}return id;
}
function locate(run,turns,id){const index=turns.findIndex(t=>t.commitId===id);if(index<0)fail((run.retired??[]).some(t=>t.commitId===id)?'HISTORY_COMMIT_RETIRED':'HISTORY_COMMIT_NOT_FOUND');return index;}
function publicTurn(run,t,presentation=false){return {...(presentation?publicTurnDialogue(run,t):{}),runId:run.runId,turn:t.turn,commitId:t.commitId,active:true,locator:historyLocator(run.runId,t.commitId),input:t.input,body:t.body};}
const base=(kind,run)=>({kind,label:HISTORY_REFERENCE_LABEL,runId:run.runId,head:headOf(run)});
function positions(text,terms,caseSensitive){
  const found=[];
  for(const term of terms){
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp(escaped,caseSensitive?'gu':'giu');
    for(const match of text.matchAll(pattern)){found.push({start:match.index,end:match.index+match[0].length});if(found.length>=HISTORY_RECALL_LIMITS.positions)break;}
    if(found.length>=HISTORY_RECALL_LIMITS.positions)break;
  }
  return [...new Map(found.map(p=>[`${p.start}:${p.end}`,p])).values()].sort((a,b)=>a.start-b.start||a.end-b.end).slice(0,HISTORY_RECALL_LIMITS.positions);
}
/** Reads active public story only. Never reads the Memory database or model traces. */
export function searchHistory(run,options={}){
  const turns=active(run,options.runId),{query}=options,mode=options.mode??'literal';
  if(typeof query!=='string'||!query.trim()||query.length>HISTORY_RECALL_LIMITS.queryChars)fail('HISTORY_QUERY_INVALID');
  if(!['literal','bm25'].includes(mode))fail('HISTORY_SEARCH_MODE_INVALID');
  if(options.caseSensitive!==undefined&&typeof options.caseSensitive!=='boolean')fail('HISTORY_QUERY_INVALID');
  const limit=integer(options.limit,5,1,HISTORY_RECALL_LIMITS.hits,'HISTORY_SEARCH_LIMIT'),sensitive=options.caseSensitive??false;
  let candidates;
  if(mode==='bm25'){
    const chunks=turns.map((t,index)=>({id:t.commitId,text:`${t.input}\n${t.body}`,keywords:[],characterIds:[],locationIds:[],itemIds:[],storyBeatIds:[],endPosition:index}));
    candidates=bm25({query,characters:[],locations:[],items:[],storyBeats:[]},chunks).filter(r=>r.score>0).map(r=>({turn:turns[r.chunk.endPosition],score:r.score}));
  }else candidates=turns.map(turn=>({turn,score:1}));
  const terms=mode==='literal'?[query]:[...new Set(tokenizeForSparseRecall(query))].filter(Boolean),hits=[];
  for(const {turn:t,score} of candidates){
    const hitPositions=['input','body'].flatMap(field=>positions(t[field],terms,sensitive).map(p=>({field,...p}))).slice(0,HISTORY_RECALL_LIMITS.positions);
    if(mode==='literal'&&!hitPositions.length)continue;
    const field=hitPositions[0]?.field??'body',first=hitPositions.find(p=>p.field===field)?.start??0,start=Math.max(0,first-100),snippet=t[field].slice(start,start+HISTORY_RECALL_LIMITS.snippetChars);
    hits.push({runId:run.runId,turn:t.turn,commitId:t.commitId,active:true,locator:historyLocator(run.runId,t.commitId),snippet,snippetField:field,snippetStart:start,hitPositions,score});
  }
  return {...base('history_search',run),mode,hits:hits.slice(0,limit),hasMore:hits.length>limit};
}
export function readHistory(run,options={}){
  const turns=active(run,options.runId),radius=integer(options.radius,0,0,HISTORY_RECALL_LIMITS.radius,'HISTORY_READ_RADIUS'),maxChars=integer(options.maxChars,HISTORY_RECALL_LIMITS.readChars,1,HISTORY_RECALL_LIMITS.readChars,'HISTORY_READ_LIMIT');
  const id=targetId(run,options),index=locate(run,turns,id),selected=turns.slice(Math.max(0,index-radius),index+radius+1);
  const chars=selected.reduce((sum,t)=>sum+t.input.length+t.body.length,0);
  if(chars>maxChars)fail('HISTORY_READ_TOO_LARGE');
  return {...base('history_read',run),targetCommitId:id,chars,turns:selected.map(t=>publicTurn(run,t))};
}
const historyDigest=(run,turns)=>hash({runId:run.runId,head:headOf(run),commits:turns.map(t=>t.commitId)});
function encodeCursor(run,digest,commitId,edge='beforeCommitId'){return Buffer.from(JSON.stringify({v:1,runId:run.runId,head:headOf(run),digest,[edge]:commitId}),'utf8').toString('base64url');}
function decodeCursor(value,edge='beforeCommitId'){
  if(typeof value!=='string'||!value.length||value.length>HISTORY_RECALL_LIMITS.cursorChars||!/^[A-Za-z0-9_-]+$/.test(value))fail('HISTORY_CURSOR_INVALID');
  let cursor;try{cursor=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{fail('HISTORY_CURSOR_INVALID');}
  const keys=[edge,'digest','head','runId','v'].sort().join(',');
  if(!cursor||Array.isArray(cursor)||cursor.v!==1||Object.keys(cursor).sort().join(',')!==keys||typeof cursor.digest!=='string'||typeof cursor[edge]!=='string')fail('HISTORY_CURSOR_INVALID');
  return cursor;
}
/** Legacy cursor walks backward. Chapter-start anchors and afterCursor walk
 * forward, preserving whole turns, stable IDs. */
export function pageHistory(run,options={}){
  const turns=active(run,options.runId),limit=integer(options.limit,10,1,HISTORY_RECALL_LIMITS.pageTurns,'HISTORY_PAGE_LIMIT'),digest=historyDigest(run,turns);
  if([options.cursor,options.afterCursor,options.anchorCommitId].filter(value=>value!==undefined).length>1)fail('HISTORY_PAGE_ARGUMENTS');
  if(options.anchorPosition!==undefined&&(!['start','end'].includes(options.anchorPosition)||options.anchorCommitId===undefined))fail('HISTORY_PAGE_ARGUMENTS');
  if(Object.hasOwn(options,'expectedHead')&&options.expectedHead!==headOf(run))fail('HISTORY_CURSOR_STALE');
  const forward=options.afterCursor!==undefined||options.anchorPosition==='start';
  let start=0,end=turns.length;
  if(options.cursor!==undefined||options.afterCursor!==undefined){
    const edge=forward?'afterCommitId':'beforeCommitId',c=decodeCursor(forward?options.afterCursor:options.cursor,edge);
    if(c.runId!==run.runId)fail('HISTORY_CROSS_RUN');if(c.head!==headOf(run)||c.digest!==digest)fail('HISTORY_CURSOR_STALE');
    const index=turns.findIndex(t=>t.commitId===c[edge]);if(index<0)fail('HISTORY_CURSOR_STALE');
    if(forward)start=index+1;else end=index;
  }
  if(options.anchorCommitId!==undefined){const index=locate(run,turns,options.anchorCommitId);if(forward)start=index;else end=index+1;}
  if(forward)end=Math.min(turns.length,start+limit);else start=Math.max(0,end-limit);
  let presentation=options.presentation===true;
  const projected=new Map(),project=t=>{const key=t.commitId+':'+presentation;if(!projected.has(key))projected.set(key,publicTurn(run,t,presentation));return projected.get(key);};
  const response=()=>({...base('history_page',run),status:end>start?'page':turns.length?'end':'empty',turns:turns.slice(start,end).map(project),hasMore:start>0&&start<turns.length,beforeCursor:start>0&&start<turns.length?encodeCursor(run,digest,turns[start].commitId,'beforeCommitId'):null,hasLater:end<turns.length,afterCursor:end<turns.length&&end>0?encodeCursor(run,digest,turns[end-1].commitId,'afterCommitId'):null,anchorCommitId:options.anchorCommitId??null,totalActive:turns.length});
  let result=response();
  // Shrink whole turns first: optional color data must not disappear merely
  // because several otherwise valid turns share one page.
  while(bytes(result)>HISTORY_RECALL_LIMITS.pageBytes&&end-start>1){if(forward)end--;else start++;result=response();}
  // A single oversized sidecar may degrade, but never truncate its prose or
  // silently claim that all requested presentation data was delivered.
  if(presentation&&bytes(result)>HISTORY_RECALL_LIMITS.pageBytes){
    presentation=false;result={...response(),presentationWarning:{code:'HISTORY_PRESENTATION_TOO_LARGE',turn:turns[start].turn}};
  }
  if(bytes(result)>HISTORY_RECALL_LIMITS.pageBytes)fail('HISTORY_PAGE_TURN_TOO_LARGE');
  return result;
}

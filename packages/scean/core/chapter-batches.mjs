// Bounded chapter-summary map/reduce. This module owns no Run, State, Memory,
// checkpoint or receipt writes; the existing chapter transaction owns publish.
import {SceanError,clone,hash,json,checkAbort} from './contracts.mjs';
import {budgetStage} from './context-budget.mjs';

export const CHAPTER_BATCH_LIMITS=Object.freeze({turns:50,batches:16,bytes:200000,mapOutputChars:2400,minMapOutputChars:512});
const fail=(code,message)=>{throw new SceanError(code,message??code);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const textBytes=text=>Buffer.byteLength(text,'utf8');
const scalar=text=>typeof text==='string'&&!/\p{Surrogate}/u.test(text);
const same=(a,b)=>json(a)===json(b);
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
const compactBudget=d=>Object.fromEntries(['contextWindow','outputReserve','includedEstimate','overheadReserve','toolReserve','candidateEstimate','requiredEstimate'].map(k=>[k,d[k]]));

function sourceFor(turns,source){
 if(!Array.isArray(turns)||!turns.length||turns.length>CHAPTER_BATCH_LIMITS.turns||!source||typeof source!=='object')fail('CHAPTER_SOURCE_LIMIT');
 const allowed=['startTurn','endTurn','commitIds','sourceHashes','sourceHash','runId','chapterId','chapterVersion','baseHead','baseVersion','snapshotHash'];
 if(Object.keys(source).some(k=>!allowed.includes(k))||!integer(source.startTurn,1,Number.MAX_SAFE_INTEGER)||source.endTurn!==source.startTurn+turns.length-1||!Array.isArray(source.commitIds)||!Array.isArray(source.sourceHashes)||source.commitIds.length!==turns.length||source.sourceHashes.length!==turns.length)fail('CHAPTER_BATCH_SOURCE_MISMATCH');
 const seen=new Set();
 for(let i=0;i<turns.length;i++){
  const t=turns[i];
  if(!t||Object.keys(t).some(k=>!['turn','commitId','input','body'].includes(k))||t.turn!==source.startTurn+i||typeof t.commitId!=='string'||!t.commitId||seen.has(t.commitId)||!scalar(t.input)||!scalar(t.body)||source.commitIds[i]!==t.commitId||source.sourceHashes[i]!==hash({commitId:t.commitId,input:t.input,body:t.body}))fail('CHAPTER_BATCH_SOURCE_MISMATCH');
  seen.add(t.commitId);
 }
 if(source.sourceHash!==hash({commitIds:source.commitIds,sourceHashes:source.sourceHashes})||textBytes(json(source))>20000)fail('CHAPTER_BATCH_SOURCE_MISMATCH');
 return clone(source);
}
function bounds(options){
 const maxBatches=options.maxBatches??CHAPTER_BATCH_LIMITS.batches,maxBatchBytes=options.maxBatchBytes??CHAPTER_BATCH_LIMITS.bytes;
 if(!integer(maxBatches,2,CHAPTER_BATCH_LIMITS.batches)||!integer(maxBatchBytes,1024,CHAPTER_BATCH_LIMITS.bytes))fail('CHAPTER_BATCH_LIMIT_INVALID');
 return{maxBatches,maxBatchBytes};
}
const range=source=>clone(source);
function capacity(system,input,capabilities,maxBatchBytes){
 const bounded=budgetStage('chapter_summary',{system,input},{contextWindow:capabilities?.contextWindow,outputReserve:capabilities?.outputLimit});
 if(!same(bounded.prompt.input,input))fail('CHAPTER_BATCH_PACKET_FILTERED');
 const d=bounded.diagnostics,bytes=textBytes(json(bounded.prompt));
 const required=d.includedEstimate+(d.outputReserve??0)+(d.overheadReserve??0)+(d.toolReserve??0);
 return{fits:bytes<=maxBatchBytes&&(!d.contextWindow||required<=d.contextWindow),bytes,estimatedTotalTokens:required,budget:compactBudget(d),contextKnown:d.contextWindow>0};
}
function partialInstruction(instructions,maxChars){return instructions+'\n這是同一章的部分原文，可能含同一回合的連續片段。只整理提供的片段，不猜測未提供的部分；分段不是新的回合或章界。回傳相同的七欄章節摘要 JSON，作為未正式保存的中間摘要。完整 JSON 不超過 '+maxChars+' 個字元，保留具名人物、關係、承諾、物品與未決線索。';}
function mergeInstruction(instructions){return instructions+'\n以下是同一完整章節按原文順序得到的中間摘要，不是原始回合，也不是已保存的事件或新的世界狀態。整合所有分段為一份七欄完整章節摘要，保留來源歸屬、未決線索與角色知識界線，不擴寫、不新增事件。章界、原文及來源身分均不得改變。';}
const partialSource=s=>({turn:s.turn,commitId:s.commitId,field:s.field,startByte:s.startByte,endByte:s.endByte,totalBytes:s.totalBytes,sourceHash:s.sourceHash,textHash:s.textHash,segmentHash:s.segmentHash});
function segment(turn,field,text,startByte,sourceHash){return{kind:'committed_turn_segment',turn:turn.turn,commitId:turn.commitId,field,text,startByte,endByte:startByte+textBytes(text),totalBytes:textBytes(turn[field]),sourceHash,textHash:hash(turn[field]),segmentHash:hash(text)};}
function mapInput(base,segments,index,total,maxChars){return{detail:base.detail,range:{...range(base.source),batch:{index,total}},turns:clone(segments),previousChapters:clone(base.previousChapters),instructions:partialInstruction(base.instructions,maxChars)};}
function reduceInput(base,maps,payloads){return{detail:base.detail,range:range(base.source),turns:maps.map((m,index)=>({kind:'intermediate_chapter_summary',batch:index+1,segments:m.input.turns.map(partialSource),payload:clone(payloads[index])})),previousChapters:clone(base.previousChapters),instructions:mergeInstruction(base.instructions)};}
function worstPayload(characters){
 const p={title:null,summary:'x',keywords:[],characters:[],locations:[],plotThreads:[],emotionalTone:null};
 const fixed=json(p).length-1;p.summary='☃'.repeat(Math.min(10000,Math.max(1,characters-fixed)));return p;
}
function prefixEnd(text,end){return end>0&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end])?end-1:end;}
function largestPrefix(text,fits){
 let lo=1,hi=text.length,best=0;
 while(lo<=hi){const middle=Math.floor((lo+hi)/2),end=prefixEnd(text,middle);if(end===0){lo=middle+1;continue;}if(fits(text.slice(0,end))){best=end;lo=middle+1;}else hi=middle-1;}
 return best;
}
function verifyCoverage(turns,maps,source){
 const rows=maps.flatMap(m=>m.input.turns),reconstructed=[];let index=0;
 for(let i=0;i<turns.length;i++){
  const t=turns[i],copy={turn:t.turn,commitId:t.commitId,input:'',body:''};
  for(const field of['input','body']){
   let byte=0,seen=false;
   while(index<rows.length&&rows[index].turn===t.turn&&rows[index].field===field){const s=rows[index++];seen=true;if(s.commitId!==t.commitId||s.startByte!==byte||s.endByte!==byte+textBytes(s.text)||s.totalBytes!==textBytes(t[field])||s.sourceHash!==source.sourceHashes[i]||s.textHash!==hash(t[field])||s.segmentHash!==hash(s.text)||!scalar(s.text))fail('CHAPTER_BATCH_COVERAGE');copy[field]+=s.text;byte=s.endByte;}
   if(!seen||byte!==textBytes(t[field])||copy[field]!==t[field])fail('CHAPTER_BATCH_COVERAGE');
  }
  reconstructed.push(copy);
 }
 if(index!==rows.length||!same(turns,reconstructed))fail('CHAPTER_BATCH_COVERAGE');
 return hash(reconstructed);
}

/** Plan the entire bounded operation before dispatching any model request.
 * outputLimit is the existing described limit, never changed to fit the plan.
 * Map *text* bounds are prompt/schema limits, not provider max_tokens edits. */
export function planChapterBatches(options={}){
 const {turns,source,detail='auto',previousChapters=[],instructions='',system='',capabilities:described={}}=options;
 const capabilities={contextWindow:described?.contextWindow??null,outputLimit:described?.outputLimit??null};
 if(Object.values(capabilities).some(v=>v!==null&&!integer(v,1,Number.MAX_SAFE_INTEGER)))fail('CHAPTER_BATCH_CAPABILITY_INVALID');
 const fixedSource=sourceFor(turns,source),limits=bounds(options);
 if(!['concise','auto','precise'].includes(detail)||typeof instructions!=='string'||typeof system!=='string'||instructions.length>16000||system.length>16000||!Array.isArray(previousChapters)||previousChapters.length>3||textBytes(json(previousChapters))>24000)fail('CHAPTER_BATCH_INPUT_LIMIT');
 if(textBytes(json(turns))>limits.maxBatches*limits.maxBatchBytes)fail('CHAPTER_BATCH_COUNT_LIMIT');
 const base={detail,source:fixedSource,previousChapters:clone(previousChapters),instructions},plain={detail,range:{startTurn:source.startTurn,endTurn:source.endTurn},turns:clone(turns),previousChapters:clone(previousChapters),instructions};
 const single=capacity(system,plain,capabilities,limits.maxBatchBytes);
 if(single.fits){const plan={schemaVersion:1,mode:'single',source:fixedSource,sourceFingerprint:hash(fixedSource),sourceTurnsHash:hash(turns),sourceBytes:textBytes(json(turns)),system,capabilities:clone(capabilities),limits,single:{input:plain,...single},maps:[],mapOutputChars:null,totalCalls:1};return freeze({...plan,planHash:hash(plan)});}
 const maps=[];let pending=[];
 const packet=segments=>mapInput(base,segments,limits.maxBatches,limits.maxBatches,CHAPTER_BATCH_LIMITS.mapOutputChars);
 const fits=segments=>capacity(system,packet(segments),capabilities,limits.maxBatchBytes).fits;
 const flush=()=>{if(!pending.length)return;maps.push({input:packet(pending)});pending=[];if(maps.length>limits.maxBatches)fail('CHAPTER_BATCH_COUNT_LIMIT');};
 for(let i=0;i<turns.length;i++){
  const t=turns[i],whole=['input','body'].map(field=>segment(t,field,t[field],0,fixedSource.sourceHashes[i]));
  if(fits([...pending,...whole])){pending.push(...whole);continue;}
  if(pending.length)flush();
  if(fits(whole)){pending=whole;continue;}
  for(const field of['input','body']){
   let remaining=t[field],offset=0;
   if(remaining===''){const empty=segment(t,field,'',0,fixedSource.sourceHashes[i]);if(!fits([...pending,empty])){flush();if(!fits([empty]))fail('CHAPTER_BATCH_CONTEXT_LIMIT');}pending.push(empty);continue;}
   while(remaining.length){
    const count=largestPrefix(remaining,part=>fits([...pending,segment(t,field,part,offset,fixedSource.sourceHashes[i])]));
    if(!count){if(pending.length){flush();continue;}fail('CHAPTER_BATCH_CONTEXT_LIMIT');}
    const part=remaining.slice(0,count);pending.push(segment(t,field,part,offset,fixedSource.sourceHashes[i]));offset+=textBytes(part);remaining=remaining.slice(count);if(remaining.length)flush();
   }
  }
 }
 flush();if(maps.length<2)fail('CHAPTER_BATCH_CONTEXT_LIMIT');
 let maxChars=0,lo=CHAPTER_BATCH_LIMITS.minMapOutputChars,hi=CHAPTER_BATCH_LIMITS.mapOutputChars;
 while(lo<=hi){const candidate=Math.floor((lo+hi)/2),input=reduceInput(base,maps,maps.map(()=>worstPayload(candidate)));if(capacity(system,input,capabilities,limits.maxBatchBytes).fits){maxChars=candidate;lo=candidate+1;}else hi=candidate-1;}
 if(!maxChars)fail('CHAPTER_BATCH_REDUCE_LIMIT');
 for(let i=0;i<maps.length;i++){maps[i].input=mapInput(base,maps[i].input.turns,i+1,maps.length,maxChars);Object.assign(maps[i],capacity(system,maps[i].input,capabilities,limits.maxBatchBytes));if(!maps[i].fits)fail('CHAPTER_BATCH_CONTEXT_LIMIT');}
 const sourceTurnsHash=verifyCoverage(turns,maps,fixedSource),plan={schemaVersion:1,mode:'batched',source:fixedSource,sourceFingerprint:hash(fixedSource),sourceTurnsHash,sourceBytes:textBytes(json(turns)),system,capabilities:clone(capabilities),limits,base,maps,mapOutputChars:maxChars,totalCalls:maps.length+1,reduceWorstCase:capacity(system,reduceInput(base,maps,maps.map(()=>worstPayload(maxChars))),capabilities,limits.maxBatchBytes)};
 return freeze({...plan,planHash:hash(plan)});
}

function validatePlan(plan){const{planHash,...value}=plan??{};if(plan?.schemaVersion!==1||!['single','batched'].includes(plan.mode)||hash(value)!==planHash||hash(plan.source)!==plan.sourceFingerprint)fail('CHAPTER_BATCH_PLAN_CHANGED');}
const usageOf=result=>result?.trace?.usage??result?.usage??null;
async function current(assertCurrent,source,signal){checkAbort(signal);if(assertCurrent){const state=await assertCurrent(clone(source));if(state!==undefined&&state!==null&&state!==true)fail('CHAPTER_SOURCE_CHANGED');}checkAbort(signal);}
async function abortableCall(call,args,signal){
 checkAbort(signal);if(!signal)return call(args);
 let listener;const interrupted=new Promise((_,reject)=>{listener=()=>reject(new SceanError('CANCELLED'));signal.addEventListener('abort',listener,{once:true});});
 try{return await Promise.race([Promise.resolve().then(()=>{checkAbort(signal);return call(args);}),interrupted]);}finally{signal.removeEventListener('abort',listener);}
}

/** call uses chapter_summary throughout and returns existing {value,trace}, or
 * a plain payload. Only the returned final payload is eligible for publishing. */
export async function executeChapterBatches(plan,{call,validatePayload,assertCurrent,onProgress,signal}={}){
 validatePlan(plan);if(typeof call!=='function'||typeof validatePayload!=='function')fail('CHAPTER_BATCH_CALLBACK_REQUIRED');
 let completed=0;const usages=[];
 const dispatch=async(input,phase,index)=>{
  await current(assertCurrent,plan.source,signal);const checked=capacity(plan.system,input,plan.capabilities,plan.limits.maxBatchBytes);if(!checked.fits)fail(phase==='reduce'?'CHAPTER_BATCH_REDUCE_LIMIT':'CHAPTER_BATCH_CONTEXT_LIMIT');
  await onProgress?.({phase,index,mapBatches:plan.maps.length,totalCalls:plan.totalCalls,completedCalls:completed,sourceHash:plan.source.sourceHash});
  const result=await abortableCall(call,{stage:'chapter_summary',phase,index,total:plan.totalCalls,input:clone(input),source:clone(plan.source),signal},signal);
  await current(assertCurrent,plan.source,signal);const payload=await validatePayload(result?.value??result);checkAbort(signal);
  if(phase==='map'&&json(payload).length>plan.mapOutputChars)fail('CHAPTER_BATCH_OUTPUT_LIMIT');
  completed++;usages.push(usageOf(result));await onProgress?.({phase,index,mapBatches:plan.maps.length,totalCalls:plan.totalCalls,completedCalls:completed,sourceHash:plan.source.sourceHash,usage:usageOf(result)});return clone(payload);
 };
 if(plan.mode==='single'){const payload=await dispatch(plan.single.input,'single',1);return{payload,diagnostics:{mode:'single',mapBatches:0,totalCalls:1,completedCalls:completed,sourceBytes:plan.sourceBytes,sourceHash:plan.source.sourceHash,sourceTurnsHash:plan.sourceTurnsHash,usages}};}
 const partial=[];
 for(let i=0;i<plan.maps.length;i++)partial.push(await dispatch(plan.maps[i].input,'map',i+1));
 const merged=reduceInput(plan.base,plan.maps,partial),payload=await dispatch(merged,'reduce',plan.totalCalls);
 return{payload,diagnostics:{mode:'batched',mapBatches:plan.maps.length,totalCalls:plan.totalCalls,completedCalls:completed,mapOutputChars:plan.mapOutputChars,sourceBytes:plan.sourceBytes,sourceHash:plan.source.sourceHash,sourceTurnsHash:plan.sourceTurnsHash,usages}};
}

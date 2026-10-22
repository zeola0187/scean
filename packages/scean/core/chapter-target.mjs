import {estimateContextTokens,CONTEXT_ESTIMATE_METHOD} from './context-budget.mjs';
import {SceanError,hash,json,clone} from './contracts.mjs';

export const CHAPTER_TARGET_POLICY='token-target-v2';
export const MAX_CHAPTER_TURNS=1000; // Same hard bound as the existing Run.
const publicTurn=t=>({turn:t.turn,commitId:t.commitId,input:t.input,body:t.body});

/** A saved buffer is a preference, not permission to keep arbitrarily large
 * originals forever. Keep at most a quarter-target tail, then find a complete
 * turn near the target. No text/State/chapter is changed here. */
export function targetChapterWindow(run,startTurn,settings,previous){
 const turns=run.turns.slice(startTurn-1).map(publicTurn),threshold=settings.tokenThreshold;
 if(!turns.length)return {startTurn,endTurn:startTurn-1,eligibleEndTurn:startTurn-1,estimatedTokens:0,uncompressedEstimatedTokens:0,effectiveBufferTurns:0,targetEndTurn:startTurn-1,estimateMethod:CONTEXT_ESTIMATE_METHOD};
 const weights=turns.map(t=>estimateContextTokens(t)+1),prefix=[0];for(const weight of weights)prefix.push(prefix.at(-1)+weight);
 const countTokens=(a,b)=>b>a?prefix[b]-prefix[a]+1:2;
 let effectiveBufferTurns=0;
 for(let n=1;n<=Math.min(settings.bufferTurns,turns.length-1);n++){
  if(countTokens(turns.length-n,turns.length)>threshold/4)break;
  effectiveBufferTurns=n;
 }
 const eligibleEndTurn=run.turns.length-effectiveBufferTurns;
 let targetEndTurn=run.turns.length;
 for(let n=1;n<=turns.length;n++)if(countTokens(0,n)>=threshold){targetEndTurn=startTurn+n-1;break;}
 let endTurn=Math.min(targetEndTurn,eligibleEndTurn);
 // A previous no-endpoint decision must see new complete turns. Reusing the
 // same target prefix forever would never discover a later scene ending.
 if(previous?.candidate?.startTurn===startTurn&&previous.result?.created===false){
  endTurn=Math.max(endTurn,Math.min(eligibleEndTurn,previous.candidate.endTurn+Math.max(0,eligibleEndTurn-previous.eligibleEndTurn)));
 }
 const candidate=turns.slice(0,Math.max(0,endTurn-startTurn+1));
 return {startTurn,endTurn,eligibleEndTurn,estimatedTokens:countTokens(0,candidate.length),uncompressedEstimatedTokens:countTokens(0,turns.length),effectiveBufferTurns,targetEndTurn,estimateMethod:CONTEXT_ESTIMATE_METHOD};
}

const byteLength=v=>Buffer.byteLength(json(v));
const scalarPrefix=(text,n)=>n>0&&n<text.length&&/[\uD800-\uDBFF]/.test(text[n-1])&&/[\uDC00-\uDFFF]/.test(text[n])?n-1:n;
function excerpt(text,limit){
 if(text.length<=limit)return{text,complete:true,ranges:[[0,text.length]]};
 const front=scalarPrefix(text,Math.floor(limit/3)),backStart=scalarPrefix(text,text.length-(limit-front));
 return{text:text.slice(0,front)+'\n[中間原文未送入端點分析；完整來源保留供正式摘要]\n'+text.slice(backStart),complete:false,ranges:[[0,front],[backStart,text.length]]};
}
/** Endpoint analysis can inspect explicit excerpts when one whole committed
 * turn exceeds its transport/context. This is never the summary source: every
 * selected original byte still goes through the existing bounded summarizer. */
export function chapterAnalysisInput(turns,source,capabilities={},system=''){
 const range={startTurn:source.startTurn,endTurn:source.endTurn,sourceHash:source.sourceHash};
 const instructions='只選給定完整已提交回合的結尾，盡量接近目標範圍尾端的自然停頓或場景轉換。若沒有自然切點，shouldCreateChapter=false。若有明示的分析片段，未顯示的中段是未知，不得猜測；仍只能選完整回合結尾。章名與摘要稍後根據所選完整原文生成，本分析不更新正文、State或Memory。';
 const fits=input=>byteLength({system,input})<=200000&&(!Number.isSafeInteger(capabilities.contextWindow)||capabilities.contextWindow<=0||estimateContextTokens(system)+estimateContextTokens(input)+(capabilities.outputLimit??4096)<=capabilities.contextWindow);
 const full={range,turns:clone(turns),instructions};
 if(fits(full))return{input:full,projection:{mode:'complete',sourceHash:source.sourceHash,sourceBytes:byteLength(turns),deliveredBytes:byteLength(turns),excerptTurns:0}};
 let limit=Math.max(32,...turns.map(t=>t.input.length+t.body.length));
 while(limit>=32){
  const projected=turns.map(t=>{
   const input=excerpt(t.input,Math.max(16,Math.floor(limit/4))),body=excerpt(t.body,Math.max(16,limit-Math.floor(limit/4)));
   return{turn:t.turn,commitId:t.commitId,input:input.text,body:body.text,analysisSource:{sourceHash:hash({commitId:t.commitId,input:t.input,body:t.body}),complete:input.complete&&body.complete,inputRanges:input.ranges,bodyRanges:body.ranges,rangeUnit:'UTF-16 scalar-aligned offsets; original text unchanged'}};
  });
  const input={range,turns:projected,instructions};
  if(fits(input))return{input,projection:{mode:'explicit_endpoint_excerpts',sourceHash:source.sourceHash,sourceBytes:byteLength(turns),deliveredBytes:byteLength(projected),excerptTurns:projected.filter(t=>!t.analysisSource.complete).length}};
  limit=Math.floor(limit*.7);
 }
 throw new SceanError('CHAPTER_ANALYSIS_CONTEXT_LIMIT');
}

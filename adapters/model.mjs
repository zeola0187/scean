import { randomUUID, createHash } from 'node:crypto';

// Provider maximum is a validation ceiling, not a request default or a price limit.
export const MODEL_OUTPUT_LIMIT = 384000;
export const DEFAULT_STAGE_MAX_TOKENS = Object.freeze({ director:4096, character:4096, adjudicate:4096, draft:4096, prose:8192, post_stat:4096, summary:4096, chapter_analysis:4096, chapter_summary:4096, chapter_rerank:4096 });
export const VERIFIED_PRICING = Object.freeze({ verifiedAt:'2026-10-15', source:'https://api-docs.deepseek.com/quick_start/pricing/', model:'deepseek-flash', servedModel:'DeepSeek-V4.1-Flash', maxOutput:MODEL_OUTPUT_LIMIT, billing:'provider-reported-only; unknown remains null' });
export function outputLimits({maxTokens,stageMaxTokens={},providerOutputLimit}={}) {
  if(!stageMaxTokens||typeof stageMaxTokens!=='object'||Array.isArray(stageMaxTokens))throw safeError('INVALID_MAX_TOKENS');
  for(const [stage,value] of Object.entries(stageMaxTokens))if(!Object.hasOwn(DEFAULT_STAGE_MAX_TOKENS,stage)||!Number.isSafeInteger(value)||value<1||providerOutputLimit!==undefined&&value>providerOutputLimit)throw safeError('INVALID_MAX_TOKENS');
  if(maxTokens!==undefined&&(!Number.isSafeInteger(maxTokens)||maxTokens<1||providerOutputLimit!==undefined&&maxTokens>providerOutputLimit))throw safeError('INVALID_MAX_TOKENS');
  return stage=>stageMaxTokens[stage]??maxTokens??DEFAULT_STAGE_MAX_TOKENS[stage]??4096;
}
export function safeError(code,message=code){return Object.assign(new Error(message),{code,safeMessage:message});}
export function safeFailure(error,signal){
  if(signal?.aborted||error?.name==='AbortError')return safeError('CANCELLED','Request was cancelled; this turn was not committed.');
  if(error?.name==='TimeoutError')return safeError('MODEL_TIMEOUT','Model request timed out; this turn was not committed.');
  // Only errors created inside this adapter carry safeMessage. Never persist raw provider messages.
  if(error?.safeMessage)return error;
  return safeError('MODEL_TRANSPORT_ERROR','Model transport failed; provider details were withheld.');
}
export function reportedCost(usage){return Number.isFinite(usage?.cost)&&usage.cost>=0?usage.cost:null;}
export function safeUsage(usage){return usage?Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','inputTokens','outputTokens','totalTokens','cacheReadTokens','cacheWriteTokens','cacheReadInputTokens','cacheWriteInputTokens'].filter(k=>Number.isFinite(usage[k])&&usage[k]>=0).map(k=>[k,usage[k]])):null;}
export function safeContext(context={}){return Object.fromEntries(['runId','attemptId','requestId'].filter(k=>typeof context[k]==='string').map(k=>[k,context[k].slice(0,160)]));}
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateBase(base){const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.hostname!=='api.deepseek.com')throw safeError('UNAUTHORIZED_DEEPSEEK_ENDPOINT');return url.toString().replace(/\/$/,'');}
export function parseCompletion(data){
  const choice=data.choices?.[0];
  if(!choice||!['stop','tool_calls'].includes(choice.finish_reason))throw safeError(choice?.finish_reason==='length'?'MODEL_OUTPUT_TRUNCATED':'MODEL_INCOMPLETE','Model did not return complete output; this turn was not committed.');
  const m=choice.message??{};
  const toolCalls=(m.tool_calls??[]).map(t=>{
    if(!t.id||t.type!=='function'||!t.function?.name)throw safeError('INVALID_TOOL_CALL');
    let args;try{args=JSON.parse(t.function.arguments);}catch{throw safeError('INVALID_TOOL_ARGUMENTS');}
    if(!args||typeof args!=='object'||Array.isArray(args))throw safeError('INVALID_TOOL_ARGUMENTS');
    return {id:t.id,name:t.function.name,arguments:args};
  });
  if(choice.finish_reason==='tool_calls'&&!toolCalls.length)throw safeError('MISSING_TOOL_CALLS');
  if(!toolCalls.length&&(typeof m.content!=='string'||!m.content.trim()))throw safeError('EMPTY_MODEL_CONTENT');
  return {text:typeof m.content==='string'?m.content:'',toolCalls,usage:safeUsage(data.usage),model:data.model??null,finishReason:choice.finish_reason};
}
export class DeepSeekModel {
  constructor({budget,usageLedger=budget,fetchImpl=fetch,baseUrl=process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com',apiKey=process.env.DEEPSEEK_API_KEY,model='deepseek-flash',caseId='interactive',maxTokens,stageMaxTokens,timeoutMs=180000,onTrace=async()=>{}}={}){
    if(!usageLedger||!apiKey)throw safeError('MODEL_CONFIGURATION_MISSING');
    if(!['deepseek-v4-flash','deepseek-flash'].includes(model))throw safeError('UNAUTHORIZED_MODEL');
    this.limit=outputLimits({maxTokens,stageMaxTokens,providerOutputLimit:MODEL_OUTPUT_LIMIT});this.ledger=usageLedger;this.fetch=fetchImpl;this.baseUrl=validateBase(baseUrl);this.apiKey=apiKey;this.model=model;this.caseId=caseId;this.timeoutMs=timeoutMs;this.onTrace=onTrace;
  }
  async describe({stage='director'}={}){return {capabilities:{contextWindow:null,outputLimit:this.limit(stage)},capacitySource:'unreported_no_platform_quota'};}
  async generate({stage,system,input,tools,signal,context={}}){
    if(signal?.aborted)throw safeError('ABORTED_BEFORE_REQUEST');
    const maxTokens=this.limit(stage);
    const body={model:this.model,messages:[{role:'system',content:system},{role:'user',content:typeof input==='string'?input:JSON.stringify(input)}],max_tokens:maxTokens,temperature:0.7,stream:false,thinking:{type:'disabled'}};
    if(tools?.length){body.tools=tools;body.tool_choice='auto';}
    const inputBytes=Buffer.byteLength(JSON.stringify(body),'utf8');
    const id=await this.ledger.reserve({kind:'generation',caseId:this.caseId,requestId:randomUUID(),meta:{provider:'deepseek-official',model:this.model,stage,inputBytes,maxTokens,...safeContext(context)}});
    let response,data,parsed,failure;
    try{
      response=await this.fetch(this.baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.apiKey}`},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]):AbortSignal.timeout(this.timeoutMs)});
      if(!response.ok)throw safeError('PROVIDER_HTTP_'+response.status,'Provider returned HTTP '+response.status+'; this turn was not committed.');
      data=await response.json();parsed=parseCompletion(data);return parsed;
    }catch(error){failure=safeFailure(error,signal);throw failure;}
    finally{
      const usage=safeUsage(data?.usage),actualCostUsd=reportedCost(data?.usage);
      await this.ledger.settle(id,{actualCostUsd,usage,status:failure?'failed':'completed'});
      await this.onTrace({reservationId:id,caseId:this.caseId,...safeContext(context),stage,provider:'deepseek-official',requestedModel:this.model,returnedModel:data?.model??null,httpStatus:response?.status??null,status:failure?'failed':'completed',failureCode:failure?.code??null,requestHash:sha(body),inputBytes,maxTokens,usage,billedCostUsd:actualCostUsd,finishReason:parsed?.finishReason??null,toolCalls:parsed?.toolCalls??[],text:parsed?.text??null});
    }
  }
}
export function createOpenRouterEmbedding({budget,usageLedger=budget,apiKey=process.env['OpenRouter API Key'],fetchImpl=fetch,caseId='embedding',onTrace=async()=>{}}={}){
  if(!usageLedger||!apiKey)throw safeError('EMBEDDING_CONFIGURATION_MISSING');
  return async(texts,{signal,kind='document',context={}}={})=>{
    if(signal?.aborted)throw safeError('ABORTED_BEFORE_REQUEST');
    if(!Array.isArray(texts)||!texts.length||texts.length>16||texts.some(t=>typeof t!=='string'))throw safeError('INVALID_EMBEDDING_BATCH');
    const input=kind==='query'?texts.map(t=>'Instruct: Given the current roleplay scene, retrieve relevant past events, current states, places, objects and habits.\nQuery: '+t):texts;
    const body={model:'qwen/qwen3-embedding-8b',input,encoding_format:'float',provider:{only:['nebius'],allow_fallbacks:false}};
    const id=await usageLedger.reserve({kind:'embedding',caseId,requestId:randomUUID(),meta:{provider:'openrouter/nebius',model:body.model,inputBytes:Buffer.byteLength(JSON.stringify(body),'utf8'),...safeContext(context)}});
    let response,data,status='failed',failure;
    try{
      response=await fetchImpl('https://openrouter.ai/api/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
      if(!response.ok)throw safeError('EMBEDDING_HTTP_'+response.status,'Embedding provider returned HTTP '+response.status+'.');
      data=await response.json();const rows=[...(data.data??[])].sort((a,b)=>a.index-b.index);
      if(rows.length!==texts.length||rows.some((r,i)=>r.index!==i||!Array.isArray(r.embedding)||!r.embedding.length||r.embedding.some(x=>!Number.isFinite(x)))||rows.some(r=>r.embedding.length!==rows[0].embedding.length))throw safeError('INVALID_EMBEDDING_RESPONSE');
      status='completed';return rows.map(r=>r.embedding);
    }catch(error){failure=safeFailure(error,signal);throw failure;}
    finally{
      const usage=safeUsage(data?.usage),actualCostUsd=reportedCost(data?.usage);
      await usageLedger.settle(id,{actualCostUsd,usage,status});
      await onTrace({reservationId:id,caseId,...safeContext(context),kind:'embedding',model:body.model,provider:'nebius',httpStatus:response?.status??null,status,failureCode:failure?.code??null,count:texts.length,usage,billedCostUsd:actualCostUsd,requestHash:sha(body)});
    }
  };
}

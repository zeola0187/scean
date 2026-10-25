import {randomUUID,createHash} from 'node:crypto';
import {safeError,safeContext,safeUsage} from './model.mjs';

const failure=(code)=>safeError(code);
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const costs=data=>Number.isFinite(data?.usage?.cost)&&data.usage.cost>=0?data.usage.cost:null;
async function dispatch({spec,kind,body,signal,context,usageLedger,fetchImpl}){
  signal?.throwIfAborted();const id=await usageLedger.reserve({kind:kind==='embedding'?'embedding':'generation',caseId:'native-scean-chapter-'+kind,requestId:randomUUID(),meta:{...safeContext(context),provider:kind==='embedding'?spec.provider:spec.mode,model:spec.model,globalSettingsRevision:spec.revision,stage:kind==='rerank'?'chapter_rerank':undefined,inputBytes:Buffer.byteLength(JSON.stringify(body)),requestHash:sha(body)}});
  let data,status='failed';
  try{
    const response=await fetchImpl(spec.baseUrl+(kind==='embedding'?'/embeddings':'/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+spec.apiKey},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
    if(!response.ok)throw failure('CHAPTER_PROVIDER_HTTP_'+response.status);
    data=await response.json();if(Buffer.byteLength(JSON.stringify(data))>2*1024*1024)throw failure('CHAPTER_PROVIDER_RESPONSE_LIMIT');status='completed';return data;
  }catch(error){
    if(signal?.aborted)throw failure('CANCELLED');
    if(/^CHAPTER_PROVIDER_HTTP_[1-5]\d\d$/.test(error.code??'')||error.code==='CHAPTER_PROVIDER_RESPONSE_LIMIT')throw error;
    throw failure('CHAPTER_PROVIDER_REQUEST_FAILED');
  }finally{await usageLedger.settle(id,{status,actualCostUsd:costs(data),usage:safeUsage(data?.usage)});}
}
/** Configured adapters resolve only their own credential record, at dispatch time. */
export function configuredChapterPorts({settings,nativeModel,legacyNativeModel=nativeModel,usageLedger,fetchImpl=fetch}){
  return {
    embed:async({texts,kind='document',signal,context={}})=>{
      if(!Array.isArray(texts)||texts.length<1||texts.length>16||texts.some(t=>typeof t!=='string'))throw failure('INVALID_EMBEDDING_BATCH');
      const spec=await settings.runtime('embedding'),instruct=spec.provider==='openrouter'&&spec.model.includes('qwen3-embedding');
      const input=kind==='query'&&instruct?texts.map(t=>'Instruct: Given the current roleplay scene, retrieve relevant past events, current states, places, objects and habits.\nQuery: '+t):texts;
      const body={model:spec.model,input,encoding_format:'float',...(spec.provider==='openrouter'&&spec.nebiusOnly?{provider:{only:['nebius'],allow_fallbacks:false}}:{})};
      const data=await dispatch({spec,kind:'embedding',body,signal,context,usageLedger,fetchImpl}),rows=[...(data.data??[])].sort((a,b)=>a.index-b.index);
      if(rows.length!==texts.length||rows.some((r,i)=>r.index!==i||!Array.isArray(r.embedding)||r.embedding.length<1||r.embedding.length>8192||r.embedding.some(v=>!Number.isFinite(v)))||rows.some(r=>r.embedding.length!==rows[0].embedding.length))throw failure('INVALID_EMBEDDING_RESPONSE');
      return rows.map(r=>r.embedding);
    },
    rerankModel:{
      async describe(args={}){
        const spec=await settings.runtime('rerank');
        if(spec.mode==='dsh_current'||spec.mode==='dsh_model')return (spec.revision===0?legacyNativeModel:nativeModel).describe({...args,context:spec.revision===0?args.context:rerankContext(args.context,spec)});
        return {capabilities:{contextWindow:null,outputLimit:4096},selectionSource:'global_chapter_settings',requested:{provider:spec.mode,model:spec.model}};
      },
      async generate(args){
        if(args.stage!=='chapter_rerank')throw failure('INVALID_MODEL_STAGE');
        const spec=await settings.runtime('rerank');
        if(spec.mode==='dsh_current'||spec.mode==='dsh_model')return (spec.revision===0?legacyNativeModel:nativeModel).generate({...args,context:spec.revision===0?args.context:rerankContext(args.context,spec)});
        const body={model:spec.model,messages:[{role:'system',content:args.system},{role:'user',content:JSON.stringify(args.input)}],response_format:{type:'json_object'},...(spec.mode==='openai'?{max_completion_tokens:4096}:{max_tokens:4096})};
        const data=await dispatch({spec,kind:'rerank',body,signal:args.signal,context:args.context??{},usageLedger,fetchImpl}),choice=data.choices?.[0];
        if(typeof choice?.message?.content!=='string'||choice.message.content.length>20000||choice.message.tool_calls?.length)throw failure('CHAPTER_RERANK_INVALID');
        return {text:choice.message.content,finishReason:choice.finish_reason??'stop',usage:safeUsage(data.usage),model:spec.model};
      },
    },
  };
}
function rerankContext(context={},spec){
  if(context.routePin)return context;
  const {modelSelection,stageModelSelections,...rest}=context;
  return spec.mode==='dsh_model'?{...rest,stageModelSelections:{chapter_rerank:{provider:spec.provider,model:spec.model}}}:rest;
}

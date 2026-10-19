// DSH 0.2.0-rc.2 native port. Credentials and routing belong to existing DSH services.
import {randomUUID} from 'node:crypto';
import {outputLimits,safeError,safeUsage,safeContext} from '../adapters/model.mjs';
import {RP_MODEL_STAGES} from '../core/contracts.mjs';
const codes=new Set(['NO_ADAPTER','UNKNOWN','AUTH','QUOTA','ACCOUNT_QUOTA','RATE_LIMIT','SERVER','CONTEXT_WINDOW_EXCEEDED','TIMEOUT','TRANSPORT','ABORTED','INVALID_REQUEST','REQUEST_EXTENSION','EMPTY_RESPONSE','MALFORMED_RESPONSE','STREAM_CLOSED','MISSING_CREDENTIAL','INVALID_CREDENTIAL','UNSUPPORTED_CONTENT','INVALID_REPLAY_STATE','UNSUPPORTED_REASONING_EFFORT','INVALID_MODEL_INFO','INVALID_MODEL_CONTEXT','INVALID_MODEL_MAX_TOKENS','INVALID_MODEL_REASONING']);
const retryable=code=>['MODEL_TIMEOUT','MODEL_TRANSPORT_ERROR','TIMEOUT','TRANSPORT','RATE_LIMIT','SERVER','HTTP_429'].includes(code)||/^HTTP_5\d\d$/.test(code);
const error=(code,category='model')=>Object.assign(safeError(code,`Generation failed (${code}); incomplete output was not accepted.`),{category});
const rpStage=stage=>RP_MODEL_STAGES.includes(stage);
function describedLimit(value){if(value===undefined||value===null)return null;if(!Number.isSafeInteger(value)||value<1)throw error('INVALID_MODEL_MAX_TOKENS');return value;}
const finishKinds=new Set(['stop','tool-calls','max-tokens','aborted','error']);
function selection(value){
  if(!value||typeof value.provider!=='string'||!value.provider.trim()||typeof value.model!=='string'||!value.model.trim()||value.provider.length>160||value.model.length>160)throw error('MODEL_SELECTION_REQUIRED');
  if(value.reasoningEffort!==undefined&&(typeof value.reasoningEffort!=='string'||!value.reasoningEffort||value.reasoningEffort.length>80))throw error('INVALID_REASONING_EFFORT');
  return {provider:value.provider,model:value.model,...value.reasoningEffort===undefined?{}:{reasoningEffort:value.reasoningEffort}};
}
function normalizeFailure(e,signal){
  if(signal.aborted)return signal.reason?.code==='MODEL_TIMEOUT'?error('MODEL_TIMEOUT'):error('CANCELLED','cancelled');
  if(e?.safeMessage)return e;
  if(codes.has(e?.code)||/^HTTP_[1-5]\d\d$/.test(e?.code??''))return error(e.code);
  return error('MODEL_TRANSPORT_ERROR');
}
function deadline(parent,timeoutMs){
  const controller=new AbortController();
  const cancel=()=>controller.abort(error('CANCELLED','cancelled'));
  parent?.addEventListener('abort',cancel,{once:true});if(parent?.aborted)cancel();
  const timer=setTimeout(()=>controller.abort(error('MODEL_TIMEOUT')),timeoutMs);
  let rejectAbort;const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
  const notify=()=>rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort',notify,{once:true});if(controller.signal.aborted)notify();
  return {signal:controller.signal,run:task=>Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task();}),aborted]),close(){clearTimeout(timer);parent?.removeEventListener('abort',cancel);controller.signal.removeEventListener('abort',notify);}};
}
export function createNativeModelPort({llm,agentDefaultModel,budget,usageLedger=budget,generationGate,selection:configuredSelection,stageSelections={},maxTokens,stageMaxTokens,timeoutMs=180000,technicalRetries=0,onTrace=async()=>{}}){
  if(!llm?.stream||!llm?.resolveModelInfo||!usageLedger?.reserve||!usageLedger?.settle)throw new TypeError('DSH LLM capability service and durable usage journal are required.');
  if(generationGate&&(!generationGate.reserve||!generationGate.settle))throw new TypeError('Generation gate must support durable reserve/settle.');
  if(!Number.isInteger(technicalRetries)||technicalRetries<0||technicalRetries>1)throw new TypeError('At most one technical retry is allowed.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw new TypeError('Invalid stage timeout.');
  const limit=outputLimits({maxTokens,stageMaxTokens});
  const backgroundSource=stage=>stageMaxTokens?.[stage]!==undefined?'plugin_stage_limit':maxTokens!==undefined?'plugin_limit':'scean_stage_default';
  async function resolveSelection(stage,context){
    const candidates=[[context.stageModelSelections?.[stage],'run_stage'],[context.modelSelection,'run'],[stageSelections?.[stage],'plugin_stage'],[configuredSelection,'plugin']];
    const chosen=candidates.find(([value])=>value!=null);
    return {requested:selection(chosen?chosen[0]:await agentDefaultModel?.currentSelection()),selectionSource:chosen?chosen[1]:'dsh_current_selection'};
  }
  return {
    async describe({stage='director',context={},signal}={}){
      const scope=deadline(signal,timeoutMs);
      try{return await scope.run(async()=>{const route=await resolveSelection(stage,context);const info=await llm.resolveModelInfo(route.requested.provider,route.requested.model,scope.signal);const outputLimit=rpStage(stage)?describedLimit(info.defaultMaxTokens):limit(stage);return {...route,capabilities:{outputLimit,outputLimitSource:rpStage(stage)?outputLimit===null?'adapter_default_unknown':'dsh_model_default':backgroundSource(stage),outputLimitPhase:'model_description',providerFinalOutputLimit:null,contextWindow:info.context?.contextWindow??null,defaultMaxTokens:info.defaultMaxTokens??null,reasoningEfforts:info.reasoning?.efforts?.map(x=>x.id)??[],defaultReasoningEffort:info.reasoning?.defaultEffort??null,toolUpdate:info.toolUpdate??null}};});}
      catch(e){throw normalizeFailure(e,scope.signal);}finally{scope.close();}
    },
    async generate({stage,system,input,tools,signal,context={}}){
      if(signal?.aborted)throw error('CANCELLED','cancelled');
      const text=typeof input==='string'?input:JSON.stringify(input);
      const toolDefinitions=(tools??[]).map(t=>t.function??t).map(t=>({name:t.name,description:t.description??'',parameters:t.parameters??t.inputSchema??{type:'object'}}));
      const requestBytes=Buffer.byteLength(String(system??'')+text+JSON.stringify(toolDefinitions),'utf8')+1024;
      const attempts=[];
      const selectionScope=deadline(signal,timeoutMs);let selected;
      try{selected=await selectionScope.run(()=>resolveSelection(stage,context));}catch(e){throw normalizeFailure(e,selectionScope.signal);}finally{selectionScope.close();}
      for(let attempt=0;attempt<=technicalRetries;attempt++){
        const scope=deadline(signal,timeoutMs),requestId=randomUUID();
        let reservationId,gateId,route,usage=null,actualCostUsd=null,result,failure,finishKind=null;
        try{
          result=await scope.run(async()=>{
            const requested=selected.requested;
            // Omit RP maxTokens: the SDK owns provider/model defaults and any
            // protocol-specific context/thinking adjustments. Never substitute
            // the historical stage defaults or a guessed provider hard limit.
            const config={...requested,...rpStage(stage)?{}:{maxTokens:limit(stage)}};
            const prepared=llm.prepareCall?await llm.prepareCall(config,scope.signal):null;
            let effective=prepared?.config,info;
            if(!prepared){
              // Older SDK/test ports have no one-shot handle. Materialize only
              // disclosed defaults; absent output capacity remains omitted.
              info=await llm.resolveModelInfo(requested.provider,requested.model,scope.signal);
              const effort=requested.reasoningEffort??info.reasoning?.defaultEffort;
              if(requested.reasoningEffort!==undefined&&!info.reasoning?.efforts?.some(x=>x.id===requested.reasoningEffort))throw error('UNSUPPORTED_REASONING_EFFORT');
              const output=rpStage(stage)?describedLimit(info.defaultMaxTokens):limit(stage);
              effective={...config,...effort===undefined?{}:{reasoningEffort:effort},...output===null?{}:{maxTokens:output}};
            }
            const sdkLimit=describedLimit(effective.maxTokens);
            const outputSource=rpStage(stage)?sdkLimit===null?'adapter_default_unknown':prepared?'dsh_sdk_prepared':'dsh_model_default_legacy':backgroundSource(stage);
            // DSH contextWindow is total context metadata; defaultMaxTokens is
            // a generation default, not a maximum-output reservation. Heuristic
            // input estimates cannot authoritatively reject or trim this call.
            // prepareCall / provider enforce actual hard limits and report errors.
            route={requested:{...requested},effective:{provider:effective.provider,model:effective.model,maxTokens:sdkLimit,...effective.reasoningEffort===undefined?{}:{reasoningEffort:effective.reasoningEffort}},selectionSource:selected.selectionSource,parameterSource:{maxTokens:outputSource,reasoningEffort:requested.reasoningEffort!==undefined?selected.selectionSource:effective.reasoningEffort!==undefined?'dsh_model_default':'omitted'},outputBudget:{policy:rpStage(stage)?'dsh_rp_inheritance':'scean_background',sdkResolvedMaxTokens:sdkLimit,source:outputSource,phase:prepared?'sdk_prepared':'legacy_description',snapshotBound:!!prepared,adapterDefaultApplied:prepared?.adapterDefaults?.maxTokens===true,contextWindow:describedLimit(prepared?.context?.contextWindow??info?.context?.contextWindow),providerFinalMaxTokens:null,providerFinalSource:'not_exposed_by_sdk'},responseModel:null,responseModelSource:'not_reported',usageSource:'not_reported'};
            scope.signal.throwIfAborted();
            const request={kind:'generation',caseId:`${context.requestId??'interactive'}:${stage}`,requestId,retry:attempt,meta:{...safeContext(context),provider:effective.provider,model:effective.model,stage,inputBytes:requestBytes,maxTokens:sdkLimit}};
            // Durable reservations are awaited before provider dispatch; pending counts survive a crash.
            try{if(generationGate)gateId=await generationGate.reserve(request);reservationId=await usageLedger.reserve(request);}catch(e){throw error(e?.code==='GENERATION_LIMIT_REACHED'?'GENERATION_LIMIT_REACHED':'MODEL_JOURNAL_RESERVE_FAILED','persistence');}
            scope.signal.throwIfAborted();
            const options={...effective,system:String(system??''),messages:[{role:'user',content:[{type:'text',text}]}],signal:scope.signal,purpose:'scean',sessionId:'scean-'+requestId,...toolDefinitions.length?{tools:toolDefinitions}:{}};
            const blocks=new Map();let finish;
            for await(const chunk of (prepared?prepared.stream(options):llm.stream(options))){
              scope.signal.throwIfAborted();
              if(chunk.type==='text-delta'){const block=blocks.get(chunk.index)??{type:'text',text:''};if(block.type==='text')block.text+=chunk.text??'';blocks.set(chunk.index,block);}
              else if(chunk.type==='tool-call-delta'){const block=blocks.get(chunk.index)??{type:'tool-call',id:'',name:'',arguments:''};if(chunk.id)block.id=chunk.id;if(chunk.name)block.name=chunk.name;block.arguments+=chunk.argumentsDelta??'';blocks.set(chunk.index,block);}
              else if(chunk.type==='block-end'&&['text','tool-call'].includes(chunk.block?.type))blocks.set(chunk.index,chunk.block);
              else if(chunk.type==='usage'){usage=safeUsage(chunk.usage);route.usageSource='dsh_sdk_usage';}
              else if(chunk.type==='finish'){
                finish=chunk.reason;
                finishKind=finishKinds.has(finish?.kind)?finish.kind:'unknown';
                // Select one public identity field only. Replay blocks may contain hidden metadata.
                const responseModel=chunk.replayState?.response?.responseModel;
                if(typeof responseModel==='string'&&responseModel.trim().length>0&&responseModel.length<=160){route.responseModel=responseModel;route.responseModelSource='sdk_response_replay_metadata';}
              }
              // Requested SDK source.model does not prove the HTTP response's model identity.
              if(typeof chunk.responseModel==='string'&&chunk.responseModel.trim().length>0&&chunk.responseModel.length<=160){route.responseModel=chunk.responseModel;route.responseModelSource='sdk_response_metadata';}
            }
            scope.signal.throwIfAborted();
            if(!finish||!['stop','tool-calls'].includes(finish.kind)){
              const providerCode=finish?.failure?.code;
              const code=finish?.kind==='max-tokens'?'MODEL_OUTPUT_TRUNCATED':finish?.kind==='aborted'?'CANCELLED':codes.has(providerCode)||/^HTTP_[1-5]\d\d$/.test(providerCode??'')?providerCode:'STREAM_INCOMPLETE';
              throw error(code,code==='CANCELLED'?'cancelled':'model');
            }
            const publicBlocks=[...blocks.entries()].sort(([a],[b])=>a-b).map(([,v])=>v);
            let toolCalls;try{toolCalls=publicBlocks.filter(b=>b.type==='tool-call').map(b=>({id:String(b.id??'').split('__thought__')[0],name:b.name,arguments:typeof b.arguments==='string'?JSON.parse(b.arguments):b.arguments}));}catch{throw error('INVALID_TOOL_ARGUMENTS');}
            if(finish.kind==='tool-calls'&&!toolCalls.length)throw error('MISSING_TOOL_CALLS');
            if(toolCalls.some(t=>!t.id||!t.name||!t.arguments||typeof t.arguments!=='object'||Array.isArray(t.arguments)))throw error('INVALID_TOOL_CALL');
            if(!toolCalls.length&&!publicBlocks.some(b=>b.type==='text'&&b.text.trim()))throw error('EMPTY_RESPONSE');
            if(stage!=='director'&&toolCalls.length)throw error('UNEXPECTED_TOOL');
            return {text:publicBlocks.filter(b=>b.type==='text').map(b=>b.text).join(''),...toolCalls.length?{toolCalls}:{},usage,model:effective.provider+'/'+effective.model,route};
          });
        }catch(e){failure=normalizeFailure(e,scope.signal);}finally{scope.close();}
        const status=failure?(failure.code==='CANCELLED'?'cancelled':'failed'):'completed';
        const receipt={requestId,attempt,reservationId:reservationId??null,stage,status,...failure?{code:failure.code}:{},finishKind,route:route??null,usage,actualCostUsd};
        attempts.push(receipt);
        try{
          if(reservationId!==undefined)await usageLedger.settle(reservationId,{actualCostUsd,usage,status});
          if(gateId!==undefined)await generationGate.settle(gateId,{actualCostUsd,usage,status});
          await onTrace({...safeContext(context),...receipt});
        }catch{failure=error('MODEL_JOURNAL_SETTLE_FAILED','persistence');}
        if(signal?.aborted)failure=error('CANCELLED','cancelled');
        if(!failure)return {...result,attempts};
        if(attempt===technicalRetries||failure.category!=='model'||!retryable(failure.code)){failure.attempts=attempts;throw failure;}
      }
    }
  };
}

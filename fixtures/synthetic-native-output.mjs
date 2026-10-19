// Offline acceptance adapter: real SDK, invented responses, no provider I/O.
import {AsyncLocalStorage} from 'node:async_hooks';
import {Context} from '@deepseek-ai/cordis';
import {LlmRuntime,LlmAdapter,LlmError} from '@deepseek-ai/dsh-llm';
import {createNativeModelPort} from '../plugin/native-model.mjs';

export async function createSyntheticNativeOutputModel(oracle,{maxTokens=12288}={}){
  const ctx=new Context();await ctx.plugin(LlmRuntime);const scope=new AsyncLocalStorage(),proposals=[],calls=[];let serial=0;
  class Adapter extends LlmAdapter{
    async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:maxTokens,context:{contextWindow:1048576},reasoning:{efforts:[{id:'low',name:'Low'}],defaultEffort:'low'}};}
    async prepareCall(provider,id){
      const request=scope.getStore();if(!request)throw Error('SYNTHETIC_STAGE_SCOPE_REQUIRED');
      return {model:await this.resolveModel(provider,id),stream:async function*(options){
        calls.push({stage:request.stage,maxTokens:options.maxTokens,reasoningEffort:options.reasoningEffort});let reply;
        try{reply=await oracle.generate(request);}catch(e){const code={MODEL_TRANSPORT_ERROR:'TRANSPORT',MODEL_TIMEOUT:'TIMEOUT',CANCELLED:'ABORTED'}[e.code]??e.code??'UNKNOWN';throw new LlmError('Synthetic offline transport failure',code);}
        for(const [index,call]of (reply.toolCalls??[]).entries())yield {type:'block-end',index,block:{type:'tool-call',id:call.id,name:call.name,arguments:JSON.stringify(call.arguments)}};
        if(reply.text)yield {type:'block-end',index:100,block:{type:'text',text:reply.text}};
        yield {type:'finish',reason:{kind:reply.toolCalls?.length?'tool-calls':'stop'}};
      }};
    }
  }
  ctx.llm.registerAdapter(['synthetic-inherited'],new Adapter());
  const llm={resolveModelInfo:(...a)=>ctx.llm.resolveModelInfo(...a),stream:(...a)=>ctx.llm.stream(...a),prepareCall:(config,...a)=>{proposals.push({hasMaxTokens:Object.hasOwn(config,'maxTokens'),provider:config.provider,model:config.model});return ctx.llm.prepareCall(config,...a);}};
  const port=createNativeModelPort({llm,agentDefaultModel:{currentSelection:()=>({provider:'synthetic-inherited',model:'offline-output-model'})},usageLedger:{async reserve(){return 'synthetic-ui-'+(++serial);},async settle(){}}});
  return {model:{describe:(...a)=>port.describe(...a),generate:request=>scope.run(request,()=>port.generate(request))},close:()=>ctx.fiber.dispose(),receipt:()=>({layer:'actual LlmRuntime / synthetic adapter / real native port',dshOutputDefault:maxTokens,proposals,calls,allRpRequestsOmittedMaxTokens:proposals.every(p=>!p.hasMaxTokens),allDispatchesInheritedDefault:calls.every(c=>c.maxTokens===maxTokens),externalModelCalls:0,credentialsRead:false})};
}

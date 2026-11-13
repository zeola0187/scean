import {createHash} from 'node:crypto';

export const methodHash=fn=>createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');
export function installOutputDefaultGuard(adapter,{expectedMethodHash,onOmission=()=>{}}={}){
 const original=adapter?.streamWithSnapshot;
 if(typeof original!=='function'||methodHash(original)!==expectedMethodHash)return {active:false,reason:'unsupported_sdk_method',dispose(){}};
 const descriptor=Object.getOwnPropertyDescriptor(adapter,'streamWithSnapshot');
 function wrapped(options,snapshot){
  if(options?.provider!=='openrouter'||options.maxTokens!==undefined)return original.call(this,options,snapshot);
  const profile=snapshot?.profiles?.get('openrouter');
  if(!profile||profile.configuredMaxTokens?.has(options.model))return original.call(this,options,snapshot);
  const models=snapshot.models;
  const proxy=new Proxy(models,{get(target,key){
   if(key!=='streamSimple'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
   return (model,context,piOptions)=>{
    if(model.provider!=='openrouter'||model.api!=='openai-completions')return target.streamSimple(model,context,piOptions);
    const prior=piOptions.onPayload;
    return target.streamSimple(model,context,{...piOptions,onPayload:async(payload,exactModel)=>{
     const supplied=prior?await prior(payload,exactModel):undefined,base=supplied===undefined?payload:supplied,next={...base};
     const removed=next.max_completion_tokens??next.max_tokens??null;
     delete next.max_tokens;delete next.max_completion_tokens;
     try{onOmission({provider:'openrouter',model:model.id,removedMaxTokens:Number.isSafeInteger(removed)?removed:null});}catch{}
     return next;
    }});
   };
  }});
  return original.call(this,options,{...snapshot,models:proxy});
 }
 Object.defineProperty(adapter,'streamWithSnapshot',{value:wrapped,writable:true,configurable:true});
 return {active:true,reason:'verified_sdk_method',dispose(){
  if(adapter.streamWithSnapshot!==wrapped)return;
  if(descriptor)Object.defineProperty(adapter,'streamWithSnapshot',descriptor);else delete adapter.streamWithSnapshot;
 }};
}

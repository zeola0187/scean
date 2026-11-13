// Offline fixtures written before W29 supplied plain Writer text and Stat v2.
// Upgrade ONLY their successful synthetic response transport to the new protocol.
// Malformed JSON, unknown citations, explicit wrong refs and invalid domain
// changes remain invalid. Never imported by product or live acceptance runtime.
import {SceanEngine} from '../core/engine.mjs';
const wrapped=new WeakMap();
function transport(response,a){
 if(!response||typeof response.text!=='string'||response.toolCalls?.length)return response;
 const temporal=a.input.assembly?.temporal??a.input.context?.temporal??a.input.temporal;
 if(!temporal)return response;
 let v;try{v=JSON.parse(response.text);}catch{}
 if(a.stage==='director'&&a.input.handoffContract&&v?.handoffVersion===1)v={candidateRef:temporal.candidateRef,...v};
 else if(a.stage==='post_stat'&&v&&typeof v==='object')v={candidateRef:temporal.candidateRef,temporalCheck:{status:'consistent'},...v};
 else if(a.stage==='writer'){
  if(v?.sceanWriter===1)v={candidateRef:temporal.candidateRef,...v};
  else if(!response.text.trim().startsWith('{')&&!response.text.trim().startsWith('```'))v={sceanWriter:1,finalBody:response.text,candidateRef:temporal.candidateRef};
  else if(!v&&response.text.includes('"dialogue":'))return {...response,text:response.text.replace('"dialogue":','"candidateRef":'+JSON.stringify(temporal.candidateRef)+',"dialogue":')};
 }
 return v?{...response,text:JSON.stringify(v)}:response;
}
export function temporalFixtureModel(model){
 if(!model?.generate)return model;if(wrapped.has(model))return wrapped.get(model);
 const proxy=new Proxy(model,{get(target,key,receiver){if(key==='generate')return async a=>transport(await target.generate(a),a);return Reflect.get(target,key,receiver);}});wrapped.set(model,proxy);wrapped.set(proxy,proxy);return proxy;
}
export class TemporalFixtureEngine extends SceanEngine{
 constructor(options){super({...options,model:temporalFixtureModel(options?.model)});}
 get model(){return this._temporalFixtureModel;}
 set model(value){this._temporalFixtureModel=temporalFixtureModel(value);}
}

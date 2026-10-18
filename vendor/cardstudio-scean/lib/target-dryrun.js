import { canonical,clone,fail } from './codec.js';
import { validateTargetState,reduceTargetUpdate } from './target-state.js';

export function dryrunTarget(definition,cases) {
  if(!Array.isArray(cases)||cases.length<1||cases.length>16||Buffer.byteLength(canonical(cases))>65536)fail('TARGET_DRYRUN_LIMIT','Provide 1–16 synthetic cases, at most 64 KiB total.');
  const initial=validateTargetState(definition,definition.initialState),results=[];
  for(const [index,item] of cases.entries()){
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['name','role','payload','message','previous_snapshot','previous_case','expect'].includes(k)))fail('TARGET_DRYRUN_CASE','Use bounded data-only payload/message cases.');
    if(item.name!==undefined&&(typeof item.name!=='string'||item.name.length>120))fail('TARGET_DRYRUN_CASE','Case names are at most 120 characters.');
    if(Object.hasOwn(item,'payload')===Object.hasOwn(item,'message'))fail('TARGET_DRYRUN_CASE','Provide payload OR message.');
    if(item.role!==undefined&&!['assistant','user','system'].includes(item.role))fail('TARGET_DRYRUN_CASE','Unsupported synthetic role.');
    if(item.previous_case!==undefined&&typeof item.previous_case!=='boolean'||item.previous_case&&(!index||Object.hasOwn(item,'previous_snapshot')))fail('TARGET_PREVIOUS_INVALID','A previous-case chain requires an earlier case and no explicit previous snapshot.');
    let previous=clone(initial),previousSource='target initialState';
    if(item.previous_case){previous=clone(results.at(-1).state);previousSource='previous synthetic case';}
    else if(Object.hasOwn(item,'previous_snapshot')){
      const snapshot=item.previous_snapshot;
      if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.profile!==definition.profile||snapshot.definition!==definition.digest||!snapshot.state)fail('TARGET_PREVIOUS_INVALID','Synthetic previous snapshot must match current profile and definition digest.');
      try{previous=validateTargetState(definition,snapshot.state);}catch(error){fail('TARGET_PREVIOUS_INVALID',error.message,{path:error.path??'/'});}
      previousSource='author-supplied synthetic snapshot; freshness unverified';
    }
    const message=Object.hasOwn(item,'payload')?'<state-update>'+JSON.stringify(item.payload).replaceAll('<','\\u003c')+'</state-update>':item.message;
    const result=reduceTargetUpdate(definition,{role:item.role??'assistant',message},previous,validateTargetState);
    if(item.expect!==undefined&&!['accepted','rejected','no_update'].includes(item.expect))fail('TARGET_DRYRUN_CASE','expect must be accepted/rejected/no_update.');
    results.push({case:index,name:item.name??null,previousSource,...result,...item.expect?{expected:item.expect,expectationMatched:item.expect===result.status}:{}});
  }
  if(Buffer.byteLength(canonical(results))>65536)fail('TARGET_DRYRUN_LIMIT','Dryrun evidence exceeds 64 KiB; split the cases into smaller requests.');
  return {definitionDigest:definition.digest,results,fixtureOnly:true,runtimeVerified:false,coverage:'Shared pure message reducer and typed validator only; no script evaluation, event, persistence or final prompt injection.'};
}

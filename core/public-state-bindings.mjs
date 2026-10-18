import {json,safeId,clone,SceanError} from './contracts.mjs';
import {publicBlueprintState} from './state-blueprint.mjs';
export const bindingKey=v=>json([v.scope,v.characterId??null,v.category,v.key]);
export function admitPublicBindings(bindings,bp,prefix='FRONTEND'){
 const fail=(s,details)=>{throw Object.assign(new SceanError(prefix+'_'+s),details?{details}:{});},own=(v,k)=>Object.hasOwn(v??{},k);
 const fields=(v,required,optional=[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!own(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail('FIELDS');};
 if(!Array.isArray(bindings)||bindings.length>64)fail('BINDINGS_LIMIT');
 const declarations=new Map(bp.variables.map(v=>[bindingKey(v),v])),types=new Map();
 for(const b of bindings){fields(b,['alias','target','type']);safeId(b.alias);if(types.has(b.alias)||['__proto__','constructor','prototype'].includes(b.alias))fail('ALIAS');fields(b.target,['scope','category','key'],['characterId']);const d=declarations.get(bindingKey(b.target));
  if(!d)fail('BINDING_MISSING',{alias:b.alias});if(d.visibility!=='public')fail('BINDING_UNAUTHORIZED',{alias:b.alias});if(d.type!==b.type)fail('BINDING_TYPE',{alias:b.alias,expected:d.type});types.set(b.alias,d.type==='enum'?'string':d.type);
 }
 return types;
}
export function publicBindingValues(bindings,bp,state){
 const declared=publicBlueprintState(bp,state).declared,values={};
 for(const b of bindings){const v=declared.find(v=>bindingKey(v)===bindingKey(b.target));values[b.alias]=!v?{status:'unavailable'}:v.known?{status:'known',type:b.type,value:clone(v.value)}:{status:'unknown',type:b.type};}
 return values;
}

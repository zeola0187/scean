import { SceanError, clone, json } from './contracts.mjs';

function reject(code,path='/',reason='object_required',position) { const error = new SceanError(code); error.category = 'tool'; error.validation={path,reason};if(Number.isSafeInteger(position)&&position>=0&&position<=200000)Object.assign(error.validation,{position,positionUnit:'utf16_json_body'}); throw error; }
function fields(value, keys,path='/') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value))) reject('CHARACTER_ADVICE_FIELDS',path,'object_required');
  const missing=keys.find(key=>!Object.hasOwn(value,key));if(missing)reject('CHARACTER_ADVICE_FIELDS',(path==='/'?'':path)+'/'+missing,'missing_fields');
  if(Object.keys(value).some(key=>!keys.includes(key)))reject('CHARACTER_ADVICE_FIELDS',path,'unexpected_fields');
}
function bounded(value,path, max = 4000) {
  if (typeof value !== 'string' || value.length > max) reject('CHARACTER_ADVICE_SHAPE',path,typeof value==='string'?'limit':'string_required');
}
function strings(value,path) {
  if (!Array.isArray(value) || value.length > 20) reject('CHARACTER_ADVICE_SHAPE',path,Array.isArray(value)?'limit':'array_required');
  value.forEach((entry,i)=>bounded(entry,path+'/'+i));
}

export function characterAdviceOutputContract(characterId){
  const string={type:'string',maxLength:4000},strings={type:'array',maxItems:20,items:string};
  const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
  return {schema:object({adviceVersion:{const:1},characterId:{const:characterId},observable:object({attitude:string,intent:string}),publicUtterances:strings,withheld:strings,internal:object({notes:strings}),intendedDisclosures:{type:'array',maxItems:20,items:object({topic:{type:'string',maxLength:500},publicText:string})}}),
    example:{adviceVersion:1,characterId,observable:{attitude:'',intent:''},publicUtterances:[],withheld:[],internal:{notes:[]},intendedDisclosures:[]},
    rules:['All seven top-level keys are required. intendedDisclosures is top-level, never inside internal.','internal contains only notes. All arrays may be empty.','withheld and internal stay private; do not move them into public fields. Disclosures are proposals, not events.']};
}

/**
 * Structural publication boundary, not a semantic secrecy reviewer.
 * A character may propose deliberately disclosing information. Those proposed
 * words remain advice, never an event or an automatic state/memory write.
 * Free text can paraphrase a secret: this projection cannot prove it did not.
 */
export function projectCharacterAdvice(raw, { characterId }) {
  let advice;
  try { advice = typeof raw==='string'?JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, '$1')):raw; } catch(error) { const position=/\bposition (\d+)\b/.exec(error.message??'');reject('CHARACTER_ADVICE_JSON','/','invalid_json',position?Number(position[1]):undefined); }
  fields(advice, ['adviceVersion', 'characterId', 'observable', 'publicUtterances', 'withheld', 'internal', 'intendedDisclosures']);
  if (advice.adviceVersion !== 1) reject('CHARACTER_ADVICE_VERSION','/adviceVersion','version');
  if (advice.characterId !== characterId) reject('CHARACTER_ADVICE_IDENTITY','/characterId','identity');
  fields(advice.observable, ['attitude', 'intent'],'/observable');
  bounded(advice.observable.attitude,'/observable/attitude'); bounded(advice.observable.intent,'/observable/intent');
  strings(advice.publicUtterances,'/publicUtterances'); strings(advice.withheld,'/withheld');
  fields(advice.internal, ['notes'],'/internal'); strings(advice.internal.notes,'/internal/notes');
  if (!Array.isArray(advice.intendedDisclosures) || advice.intendedDisclosures.length > 20) reject('CHARACTER_ADVICE_SHAPE','/intendedDisclosures',Array.isArray(advice.intendedDisclosures)?'limit':'array_required');
  for (const [i,disclosure] of advice.intendedDisclosures.entries()) {
    const path='/intendedDisclosures/'+i;
    fields(disclosure, ['topic', 'publicText'],path); bounded(disclosure.topic,path+'/topic',500); bounded(disclosure.publicText,path+'/publicText');
  }
  if (json(advice).length > 40000) reject('CHARACTER_ADVICE_TOO_LARGE','/','limit');
  return {
    adviceVersion: 1, characterId, kind: 'advice_not_event',
    observable: clone(advice.observable), publicUtterances: clone(advice.publicUtterances),
    intendedDisclosures: clone(advice.intendedDisclosures),
  };
}

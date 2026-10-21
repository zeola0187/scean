// Per-Run editorial settings; never part of its immutable Snapshot or story state.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {hash,clone,safeId,checkAbort,SceanError} from './contracts.mjs';
import {loadStyleSkill,styleSkillReference,validateStyleSkillReference} from './writing-style-library.mjs';
const fail=code=>{throw new SceanError(code);};
export const PROSE_STYLE_LIMIT=12000;
export function normalizeProseStyle(value){
  if(typeof value!=='string'&&value!==null)fail('PROSE_STYLE_INVALID');
  const text=value===null?null:value.trim()||null;
  if(text&&(text.length>PROSE_STYLE_LIMIT||Buffer.byteLength(text,'utf8')>48000||/\p{Surrogate}/u.test(text)))fail('PROSE_STYLE_INVALID');
  return text;
}
export const defaultProseStyle=runId=>({schemaVersion:1,runId,revision:0,text:null,hash:hash('')});
export function validateProseStyle(value,runId){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schemaVersion','runId','revision','text','hash','skill','operationId','fingerprint'].includes(k))||value.schemaVersion!==1||value.runId!==runId||!Number.isSafeInteger(value.revision)||value.revision<0||normalizeProseStyle(value.text)!==value.text||value.hash!==hash(value.text??''))fail('PROSE_STYLE_CORRUPT');
  if(value.skill){validateStyleSkillReference(value.skill);if(value.text===null||value.skill.sha256!==value.hash)fail('PROSE_STYLE_CORRUPT');}else if(Object.hasOwn(value,'skill'))fail('PROSE_STYLE_CORRUPT');
  if(value.revision===0){if(value.text!==null||value.skill||value.operationId!==undefined||value.fingerprint!==undefined)fail('PROSE_STYLE_CORRUPT');}
  else{safeId(value.operationId);if(value.fingerprint!==hash({text:value.text,...(value.skill?{skill:value.skill}:{}),expectedRevision:value.revision-1,operationId:value.operationId}))fail('PROSE_STYLE_CORRUPT');}
  return clone(value);
}
export const proseStyleFile=(store,runId)=>path.join(store.runDir(runId),'prose-style.json');
export async function readRunProseStyle(store,run){
  let value=run.proseStyle??defaultProseStyle(run.runId);
  if(typeof store.runDir==='function')try{value=JSON.parse(await store.retrySharingViolation(()=>readFile(proseStyleFile(store,run.runId),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
  return validateProseStyle(value,run.runId);
}
export async function saveRunProseStyle(store,{runId,text,skillId,skillHash,expectedRevision,operationId,signal}){
  safeId(runId);safeId(operationId);text=normalizeProseStyle(text);
  if((skillId===undefined||skillId===null)&&skillHash!==undefined)fail('STYLE_SKILL_INVALID');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('PROSE_STYLE_REVISION_REQUIRED');
  return store.withRunLock(runId,async()=>{
    checkAbort(signal);const run=await store.read(runId),current=await readRunProseStyle(store,run);
    if(current.operationId===operationId){const sameSelection=skillId==null?!current.skill:current.skill?.id===skillId&&(skillHash===undefined||current.skill.sha256===skillHash);if(current.text!==text||current.revision!==expectedRevision+1||!sameSelection)fail('IDEMPOTENCY_CONFLICT');return current;}
    if(current.revision!==expectedRevision)fail('VERSION_CONFLICT');
    let skill;if(skillId!==undefined&&skillId!==null){const selected=await loadStyleSkill(store,skillId,skillHash);if(text!==selected.text)fail('STYLE_SKILL_TEXT_MISMATCH');skill=styleSkillReference(selected);}
    const fingerprint=hash({text,...(skill?{skill}:{}),expectedRevision,operationId});
    const next={schemaVersion:1,runId,revision:current.revision+1,text,hash:hash(text??''),...(skill?{skill}:{}),operationId,fingerprint};
    try{await store.atomic(proseStyleFile(store,runId),next,{signal,commit:true});return next;}
    catch(error){let actual;try{actual=await readRunProseStyle(store,run);}catch{fail('PROSE_STYLE_SAVE_UNKNOWN');}if(actual.fingerprint===fingerprint)return actual;throw error;}
  },{signal,namespace:'prose-style'});
}
export function pinProseStyle(style){return {schemaVersion:1,revision:style.revision,text:style.text,hash:style.hash,source:style.skill?'run_skill':style.text===null?'legacy':'run',...(style.skill?{skill:clone(style.skill)}:{})};}
export async function captureRunProseStyle(store,style){
 if(style.skill){const selected=await loadStyleSkill(store,style.skill.id,style.skill.sha256);if(selected.text!==style.text||selected.version!==style.skill.version||selected.label!==style.skill.label)fail('STYLE_SKILL_CHANGED');}
 return pinProseStyle(style);
}
export function validateProseStylePin(value){
  if(!value||value.schemaVersion!==1||Object.keys(value).some(k=>!['schemaVersion','revision','text','hash','source','skill'].includes(k))||!Number.isSafeInteger(value.revision)||value.revision<0||normalizeProseStyle(value.text)!==value.text||value.hash!==hash(value.text??'')||value.source!==(value.skill?'run_skill':value.text===null?'legacy':'run'))fail('PROSE_STYLE_PIN_CORRUPT');if(value.skill){validateStyleSkillReference(value.skill);if(value.text===null||value.skill.sha256!==value.hash)fail('PROSE_STYLE_PIN_CORRUPT');}else if(Object.hasOwn(value,'skill'))fail('PROSE_STYLE_PIN_CORRUPT');return clone(value);
}
export function proseStyleReference(value){const {schemaVersion,revision,hash,source,skill}=validateProseStylePin(value);return {schemaVersion,revision,hash,source,...(skill?{skill}:{})};}
export function validateProseStyleReference(value){
  if(!value||Object.keys(value).some(k=>!['schemaVersion','revision','hash','source','skill'].includes(k))||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!['legacy','run','run_skill'].includes(value.source)||typeof value.hash!=='string'||!/^[a-f0-9]{64}$/.test(value.hash))fail('PROSE_STYLE_PIN_CORRUPT');if(value.skill){validateStyleSkillReference(value.skill);if(value.source!=='run_skill'||value.skill.sha256!==value.hash)fail('PROSE_STYLE_PIN_CORRUPT');}else if(value.source==='run_skill'||Object.hasOwn(value,'skill'))fail('PROSE_STYLE_PIN_CORRUPT');return value;
}

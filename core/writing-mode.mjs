import {SINGLE_WRITER_SKILLS,SINGLE_DIRECTOR_SYSTEM} from './writer-workflow.mjs';
// Fixed Host-loaded original methods; no user-supplied path, import or Agent file tool.
import {readFile,lstat} from 'node:fs/promises';import path from 'node:path';
import {hash,clone,safeId,checkAbort,SceanError} from './contracts.mjs';
import {estimateContextTokens} from './context-budget.mjs';
const fail=code=>{throw new SceanError(code);};
export const WRITING_SKILLS=Object.freeze([
  {
    "id": "scene-materials",
    "stage": "director",
    "version": 1,
    "sha256": "4eabc15fcd1b5d13cba351b0272271a802402860657ff4535f5529eec6d3f55b",
    "relative": "../runtime-skills/scene-materials/SKILL.md"
  },
  {
    "id": "scene-writing",
    "stage": "draft",
    "version": 1,
    "sha256": "f9e8500fdc43acf7817d93baf0398d6c650d3a61221b8c4f51b5d74362edfffa",
    "relative": "../runtime-skills/scene-writing/SKILL.md"
  }
].map(row=>Object.freeze(row)));
const skillsForMode=mode=>mode==='current'?[]:mode==='materials'?WRITING_SKILLS:SINGLE_WRITER_SKILLS;
export const WRITING_MODE_VERSION=1;
export function writingModeName(mode){if(!['current','materials','single_writer'].includes(mode))fail('WRITING_MODE_UNKNOWN');return mode;}
export const defaultWritingMode=(runId,mode='single_writer')=>({schemaVersion:1,runId,revision:0,mode});
export function validateWritingMode(value,runId){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schemaVersion','runId','revision','mode','operationId','fingerprint'].includes(k))||value.schemaVersion!==1||value.runId!==runId||!Number.isSafeInteger(value.revision)||value.revision<0)fail('WRITING_MODE_CORRUPT');
 writingModeName(value.mode);
 if(value.revision===0){if(!['current','single_writer'].includes(value.mode)||value.operationId!==undefined||value.fingerprint!==undefined)fail('WRITING_MODE_CORRUPT');}
 else{safeId(value.operationId);if(value.fingerprint!==hash({mode:value.mode,expectedRevision:value.revision-1,operationId:value.operationId}))fail('WRITING_MODE_CORRUPT');}
 return clone(value);
}
export const writingModeFile=(store,runId)=>path.join(store.runDir(runId),'writing-mode.json');
export async function readRunWritingMode(store,run,unconfiguredMode='single_writer'){
 let value=run.writingMode??defaultWritingMode(run.runId,unconfiguredMode);
 if(typeof store.runDir==='function')try{value=JSON.parse(await store.retrySharingViolation(()=>readFile(writingModeFile(store,run.runId),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
 return validateWritingMode(value,run.runId);
}
export async function loadWritingSkills(mode,{read=readFile,stat=lstat}={}){
 writingModeName(mode);if(mode==='current')return [];
 const result=[];
 for(const row of skillsForMode(mode)){const url=new URL(row.relative,import.meta.url);let bytes;
  try{if((await stat(url)).isSymbolicLink())fail('WRITING_SKILL_UNAVAILABLE');bytes=await read(url);}catch{fail('WRITING_SKILL_UNAVAILABLE');}
  if(bytes.length>20000||hash(bytes.toString('utf8'))!==row.sha256)fail('WRITING_SKILL_CHANGED');
  const text=bytes.toString('utf8');result.push({id:row.id,stage:row.stage,version:row.version,sha256:row.sha256,text,bytes:bytes.length,estimatedTokens:estimateContextTokens(text)});
 }return result;
}
export async function writingModeAvailability(options){
 const availability={current:{status:'available'}};
 for(const mode of ['materials','single_writer'])try{await loadWritingSkills(mode,options);availability[mode]={status:'available'};}
 catch(error){availability[mode]={status:'unavailable',code:['WRITING_SKILL_UNAVAILABLE','WRITING_SKILL_CHANGED'].includes(error.code)?error.code:'WRITING_SKILL_UNAVAILABLE'};}
 return availability;
}
const methodHash=(mode,skills)=>hash({mode,version:WRITING_MODE_VERSION,skills:skills.map(({id,stage,version,sha256})=>({id,stage,version,sha256}))});
export async function captureWritingMode(config,options){
 const skills=await loadWritingSkills(config.mode,options);return {schemaVersion:1,mode:config.mode,revision:config.revision,version:WRITING_MODE_VERSION,loading:'host_whitelist_stage_delivery',hash:methodHash(config.mode,skills),skills};
}
export function validateWritingModePin(pin){
 if(!pin||pin.schemaVersion!==1||Object.keys(pin).some(k=>!['schemaVersion','mode','revision','version','loading','hash','skills'].includes(k))||!Number.isSafeInteger(pin.revision)||pin.revision<0||pin.version!==WRITING_MODE_VERSION||pin.loading!=='host_whitelist_stage_delivery'||!Array.isArray(pin.skills))fail('WRITING_MODE_PIN_CORRUPT');
 writingModeName(pin.mode);const expected=skillsForMode(pin.mode);
 if(pin.skills.length!==expected.length)fail('WRITING_SKILL_CHANGED');
 for(let i=0;i<expected.length;i++){const a=pin.skills[i],b=expected[i];if(Object.keys(a).some(k=>!['id','stage','version','sha256','text','bytes','estimatedTokens'].includes(k))||a.id!==b.id||a.stage!==b.stage||a.version!==b.version||a.sha256!==b.sha256||typeof a.text!=='string'||hash(a.text)!==b.sha256||a.bytes!==Buffer.byteLength(a.text,'utf8')||a.estimatedTokens!==estimateContextTokens(a.text))fail('WRITING_SKILL_CHANGED');}
 if(pin.hash!==methodHash(pin.mode,pin.skills))fail('WRITING_MODE_PIN_CORRUPT');return clone(pin);
}
export function writingModeReference(pin){const value=validateWritingModePin(pin);return {...value,skills:value.skills.map(({text,...rest})=>rest)};}
export function validateWritingModeReference(value){
 if(!value||value.schemaVersion!==1||Object.keys(value).some(k=>!['schemaVersion','mode','revision','version','loading','hash','skills'].includes(k))||!Number.isSafeInteger(value.revision)||value.revision<0||value.version!==1||value.loading!=='host_whitelist_stage_delivery'||!Array.isArray(value.skills))fail('WRITING_MODE_PIN_CORRUPT');
 writingModeName(value.mode);if(value.skills.length!==(value.mode==='current'?0:2))fail('WRITING_MODE_PIN_CORRUPT');
 for(let i=0;i<value.skills.length;i++){const a=value.skills[i],b=skillsForMode(value.mode)[i];if(Object.keys(a).some(k=>!['id','stage','version','sha256','bytes','estimatedTokens'].includes(k))||a.id!==b.id||a.stage!==b.stage||a.version!==1||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||a.bytes<1||!Number.isSafeInteger(a.estimatedTokens)||a.estimatedTokens<1)fail('WRITING_MODE_PIN_CORRUPT');}
 if(value.hash!==methodHash(value.mode,value.skills))fail('WRITING_MODE_PIN_CORRUPT');return value;
}
export async function saveRunWritingMode(store,{runId,mode,expectedRevision,operationId,signal}){
 safeId(runId);safeId(operationId);writingModeName(mode);
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('WRITING_MODE_REVISION_REQUIRED');
 const fingerprint=hash({mode,expectedRevision,operationId});
 return store.withRunLock(runId,async()=>{checkAbort(signal);const run=await store.read(runId),current=await readRunWritingMode(store,run);
  if(current.operationId===operationId){if(current.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return current;}
  if(current.revision!==expectedRevision)fail('VERSION_CONFLICT');
  // Verify a newly selected method before publishing, without generating anything.
  await loadWritingSkills(mode);checkAbort(signal);
  const next={schemaVersion:1,runId,revision:current.revision+1,mode,operationId,fingerprint};
  try{await store.atomic(writingModeFile(store,runId),next,{signal,commit:true});return next;}
  catch(error){let actual;try{actual=await readRunWritingMode(store,run);}catch{fail('WRITING_MODE_SAVE_UNKNOWN');}if(actual.fingerprint===fingerprint)return actual;throw error;}
 },{signal,namespace:'writing-mode'});
}
export function systemsForWritingMode(base,pin){
 if(pin.mode==='current')return base;
 if(pin.mode==='single_writer')return {...base,director:SINGLE_DIRECTOR_SYSTEM};
 return {...base,director:base.director+'\nSelected workflow: materials organization. The Host supplies writingSkill from a fixed packaged whitelist. Follow that stage method within all existing factual, public-brief, tool, privacy and player-agency contracts. For this mode the public brief is a relevant material inventory, not a prewritten complete plot. Tool availability and round limits are unchanged.',
 draft:base.draft+'\nSelected workflow: scene writing from the Director material inventory. writingSkill is the Host-loaded original Draft method. Use it to organize the scene within every existing factual, identity, refusal, safety and player-agency contract. The inventory and Character Advice are not already performed events. Return the ordinary draft only.'};
}

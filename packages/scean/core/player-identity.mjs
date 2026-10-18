import {SceanError,clone,hash,safeId,checkAbort} from './contracts.mjs';
import {projectTemplateText,projectPlayerCard,projectPlayerPreset} from './player-text.mjs';
const fail=code=>{throw new SceanError(code);};
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function playerName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\u0000-\u001f\u007f-\u009f]|\{\{|\}\}/u.test(value))fail('INVALID_PLAYER_NAME');
  // Reject malformed Unicode; display names otherwise remain literal Unicode text.
  if(!value.isWellFormed())fail('INVALID_PLAYER_NAME');
  return value.trim();
}
export function playerContext(run){
  const value=run.playerIdentity;
  return value?{actorId:'player',name:value.name,boundVersion:value.boundVersion}:null;
}
export function validatePlayerIdentity(value,run){
  if(value===undefined)return;
  const keys=['schemaVersion','name','boundVersion','afterTurn',...(value?.adoption?['adoption']:[])];
  if(!fields(value,keys)||value.schemaVersion!==1||playerName(value.name)!==value.name||!Number.isSafeInteger(value.boundVersion)||value.boundVersion<0||value.boundVersion>run.version||!Number.isSafeInteger(value.afterTurn)||value.afterTurn<0||value.afterTurn>value.boundVersion)fail('INVALID_PLAYER_IDENTITY');
  if(value.boundVersion===0){if(value.afterTurn!==0||value.adoption)fail('INVALID_PLAYER_IDENTITY');}
  else{
    const a=value.adoption;
    if(!fields(a,['operationId','expectedVersion','expectedHead','fingerprint'])||a.expectedVersion!==value.boundVersion-1||!(a.expectedHead===null||typeof a.expectedHead==='string'))fail('INVALID_PLAYER_IDENTITY');
    safeId(a.operationId);if(a.expectedHead!==null)safeId(a.expectedHead);
    const prior=[...(run.turns??[]),...(run.retired??[])].find(t=>t.commitId===a.expectedHead);
    if(a.expectedHead===null?value.afterTurn!==0:!prior||prior.turn!==value.afterTurn)fail('INVALID_PLAYER_IDENTITY');
    if(a.fingerprint!==hash({runId:run.runId,name:value.name,operationId:a.operationId,expectedVersion:a.expectedVersion,expectedHead:a.expectedHead}))fail('INVALID_PLAYER_IDENTITY');
  }
  return clone(value);
}
export function openingDisplay(run){
  const raw=run.snapshot.opening?.text??run.snapshot.card?.data?.first_mes??run.snapshot.card?.first_mes??'';
  return run.playerIdentity?.boundVersion===0?projectTemplateText(raw,run.playerIdentity.name):raw;
}
export function projectPlayerSources(sources,run){
  const name=run.playerIdentity?.name,copy=clone(sources);
  copy.card=projectPlayerCard(copy.card,name);copy.preset=projectPlayerPreset(copy.preset,name);
  if(copy.selectedOpening&&run.playerIdentity?.boundVersion===0)copy.selectedOpening.text=projectTemplateText(copy.selectedOpening.text,name);
  return copy;
}
export async function bindPlayerIdentity(engine,request){
  const {runId,operationId,expectedVersion,expectedHead,signal}=request,name=playerName(request.name);
  safeId(runId);safeId(operationId);if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!(expectedHead===null||typeof expectedHead==='string'))fail('HISTORY_EXPECTATION_REQUIRED');if(expectedHead!==null)safeId(expectedHead);
  const fingerprint=hash({runId,name,operationId,expectedVersion,expectedHead});checkAbort(signal);
  return engine.store.withRunLock(runId,async()=>{
    const run=await engine.store.read(runId);validatePlayerIdentity(run.playerIdentity,run);
    const result=value=>({runId,version:value.boundVersion,playerIdentity:clone(value),status:'committed'});
    if(run.playerIdentity){if(run.playerIdentity.adoption?.operationId===operationId){if(run.playerIdentity.adoption.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return result(run.playerIdentity);}fail('PLAYER_NAME_ALREADY_BOUND');}
    if(run.version>=Number.MAX_SAFE_INTEGER)fail('HISTORY_CAPACITY_EXCEEDED');
    if(run.operationReceipts?.[operationId]||run.narrative?.operations?.[operationId])fail('OPERATION_ID_CONFLICT');
    if(run.version!==expectedVersion)fail('VERSION_CONFLICT');if((run.head??null)!==expectedHead)fail('HISTORY_HEAD_CONFLICT');
    checkAbort(signal);
    const binding={schemaVersion:1,name,boundVersion:run.version+1,afterTurn:run.turns.length,adoption:{operationId,expectedVersion,expectedHead,fingerprint}};
    const next={...run,version:run.version+1,updatedAt:new Date().toISOString(),playerIdentity:binding};
    try{await engine.store.commit(runId,run.version,next,{signal});}
    catch(error){let actual;try{actual=await engine.store.read(runId);}catch{fail('COMMIT_OUTCOME_UNKNOWN');}if(actual.playerIdentity?.adoption?.fingerprint!==fingerprint)throw error;}
    return result(binding);
  },{signal});
}

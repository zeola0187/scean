// Model routing is Host metadata. It is never Prompt or portable story data.
import {readFile} from 'node:fs/promises';
import {routineMetadataRebase} from './world-routine.mjs';
import path from 'node:path';
import {clone,hash,safeId,SceanError,checkAbort} from './contracts.mjs';

export const MODEL_ROLES=Object.freeze(['director','character','writer','stat','calendar','forum','summary','ideas']);
export const MODEL_ROLE_INHERITANCE=Object.freeze({calendar:'stat',forum:'character'});
export const MODEL_STAGE_ROLES=Object.freeze({calendar_plan:'calendar',forum_post:'forum',forum_reply:'forum',diary:'character',director:'director',character:'character',writer:'writer',writer_repair:'writer',draft:'writer',prose:'writer',prose_repair:'writer',adjudicate:'stat',post_stat:'stat',summary:'summary',chapter_analysis:'summary',chapter_summary:'summary',ideas:'ideas'});
export const MODEL_STAGES=Object.freeze([...Object.keys(MODEL_STAGE_ROLES),'chapter_rerank']);
const fail=code=>{throw new SceanError(code);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function fields(v,keys,code='MODEL_SETTINGS_INVALID'){if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)))fail(code);}
function text(v,max=160){if(typeof v!=='string'||!v.trim()||v!==v.trim()||v.length>max||/[\x00-\x1f]/.test(v))fail('INVALID_MODEL_SELECTION');return v;}
export function modelSelection(v){fields(v,['provider','model','reasoningEffort'],'INVALID_MODEL_SELECTION');return {provider:text(v.provider),model:text(v.model),...(v.reasoningEffort===undefined?{}:{reasoningEffort:text(v.reasoningEffort,64)})};}
export function modelPreferences(v){fields(v,MODEL_ROLES);return Object.fromEntries(MODEL_ROLES.map(role=>[role,v[role]==null?null:modelSelection(v[role])]));}
export const defaultModelSettings=scope=>({schemaVersion:1,scope,revision:0,roles:modelPreferences({})});
function settingsFile(store,scope){return scope==='@global'?path.join(store.root,'settings','agent-models.json'):path.join(store.runDir(scope),'agent-models.json');}
function validateSettings(v,scope){
  fields(v,['schemaVersion','scope','revision','roles','operationId','fingerprint'],'MODEL_SETTINGS_CORRUPT');
  const normalized=modelPreferences(v.roles),oldRoles=['director','character','writer','stat','summary','ideas'];
  if(v.schemaVersion!==1||v.scope!==scope||!Number.isSafeInteger(v.revision)||v.revision<0||oldRoles.some(k=>!Object.hasOwn(v.roles,k))||hash(v.roles)!==hash(Object.fromEntries(Object.keys(v.roles).map(k=>[k,normalized[k]]))))fail('MODEL_SETTINGS_CORRUPT');
  if(v.revision===0){if(v.operationId!==undefined||v.fingerprint!==undefined||Object.values(v.roles).some(Boolean))fail('MODEL_SETTINGS_CORRUPT');}
  else{safeId(v.operationId);if(v.fingerprint!==hash({roles:v.roles,expectedRevision:v.revision-1,operationId:v.operationId}))fail('MODEL_SETTINGS_CORRUPT');}
  return {...clone(v),roles:normalized};
}
export async function readModelSettings(store,scope){
  if(scope!=='@global')safeId(scope);
  try{return validateSettings(JSON.parse(await store.retrySharingViolation(()=>readFile(settingsFile(store,scope),'utf8'))),scope);}
  catch(e){if(e.code==='ENOENT')return defaultModelSettings(scope);if(e instanceof SyntaxError)fail('MODEL_SETTINGS_CORRUPT');throw e;}
}
export async function saveModelSettings(store,{scope,roles,expectedRevision,operationId,signal},validate){
  if(scope!=='@global')safeId(scope);safeId(operationId);roles=modelPreferences(roles);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('MODEL_SETTINGS_REVISION_REQUIRED');
  const requestedRoles=roles,providedRoles=arguments[1].roles;
  return store.withRunLock(scope==='@global'?'global-agent-models':scope,async()=>{
    checkAbort(signal);if(scope!=='@global')await store.read(scope);const current=await readModelSettings(store,scope);
    roles={...requestedRoles,...Object.fromEntries(['calendar','forum'].filter(k=>!Object.hasOwn(providedRoles,k)).map(k=>[k,current.roles[k]]))};const fingerprint=hash({roles,expectedRevision,operationId});
    const legacyFingerprint=!Object.hasOwn(providedRoles,'calendar')&&!Object.hasOwn(providedRoles,'forum')?hash({roles:Object.fromEntries(['director','character','writer','stat','summary','ideas'].map(k=>[k,roles[k]])),expectedRevision,operationId}):null;
    if(current.operationId===operationId){if(current.fingerprint!==fingerprint&&current.fingerprint!==legacyFingerprint)fail('IDEMPOTENCY_CONFLICT');return current;}
    if(current.revision!==expectedRevision)fail('VERSION_CONFLICT');
    for(const selected of Object.values(roles).filter(Boolean))await validate(selected,signal);
    const next={schemaVersion:1,scope,revision:current.revision+1,roles,operationId,fingerprint};
    try{await store.atomic(settingsFile(store,scope),next,{signal,commit:true});return next;}
    catch(e){let actual;try{actual=await readModelSettings(store,scope);}catch{fail('MODEL_SETTINGS_SAVE_UNKNOWN');}if(actual.fingerprint===fingerprint)return actual;throw e;}
  },{signal,namespace:scope==='@global'?'agent-model-defaults':'agent-models'});
}
export function validateRoutePin(v,{run,requestId,kind,inputHash=null,expectedHash=null}){
  fields(v,['schemaVersion','runId','requestId','kind','snapshotHash','baseVersion','baseHead','inputHash','globalRevision','runRevision','routes','rerank','hash'],'MODEL_ROUTE_PIN_CORRUPT');
  const {hash:sum,...body}=v;
  if(v.schemaVersion!==1||v.runId!==run.runId||v.requestId!==requestId||v.kind!==kind||v.snapshotHash!==run.snapshot.hash||sum!==hash(body)||!Number.isSafeInteger(v.globalRevision)||!Number.isSafeInteger(v.runRevision))fail('MODEL_ROUTE_PIN_CORRUPT');
  const frozen=expectedHash!==null&&kind==='world_routine'&&expectedHash===v.hash&&run.worldRoutine?.jobs.some(j=>j.id===requestId&&j.routePin?.requestId===requestId&&j.routePin.hash===expectedHash&&hash(j.basis)===inputHash);
  if(expectedHash!==null&&!frozen)fail('MODEL_ROUTE_PIN_CORRUPT');
  if(v.inputHash!==inputHash||!frozen&&(v.baseVersion!==run.version&&!routineMetadataRebase(run,v.baseVersion,v.baseHead)||v.baseHead!==(run.head??null)))fail('MODEL_ROUTE_REQUEST_CHANGED');
  fields(v.routes,MODEL_STAGES,'MODEL_ROUTE_PIN_CORRUPT');
  for(const stage of MODEL_STAGES){const route=v.routes[stage];if(route===null)continue;fields(route,['requested','selectionSource'],'MODEL_ROUTE_PIN_CORRUPT');modelSelection(route.requested);if(typeof route.selectionSource!=='string'||route.selectionSource.length>64)fail('MODEL_ROUTE_PIN_CORRUPT');}
  return clone(v);
}
export async function captureRoutePin(store,{run,requestId,kind='turn',inputHash=null,signal,expectedHash=null,lockHeld=false,requiredStage},resolve){
  safeId(run.runId);safeId(requestId);if(!['turn','chapter','summary','ideas','world_routine'].includes(kind))fail('MODEL_ROUTE_KIND');
  const file=path.join(store.runDir(run.runId),'model-route-pins',kind+'-'+requestId+'.json');
  const work=async()=>{
    checkAbort(signal);
    try{return validateRoutePin(JSON.parse(await store.retrySharingViolation(()=>readFile(file,'utf8'))),{run,requestId,kind,inputHash,expectedHash});}
    catch(e){if(e instanceof SyntaxError)fail('MODEL_ROUTE_PIN_CORRUPT');if(e.code!=='ENOENT')throw e;}
    if(expectedHash!==null)fail('MODEL_ROUTE_PIN_MISSING');
    const body={schemaVersion:1,runId:run.runId,requestId,kind,snapshotHash:run.snapshot.hash,baseVersion:run.version,baseHead:run.head??null,inputHash,...await resolve()},pin={...body,hash:hash(body)};
    if(requiredStage&&!pin.routes[requiredStage])fail('MODEL_SELECTION_REQUIRED');
    validateRoutePin(pin,{run,requestId,kind,inputHash});
    // A failed/uncertain checkpoint never authorizes provider dispatch.
    await store.atomic(file,pin,{signal,commit:true});return clone(pin);
  };
  if(lockHeld){if(!store.held.has(run.runId))fail('MODEL_ROUTE_LOCK_REQUIRED');return work();}
  return store.withRunLock(run.runId,work,{signal,namespace:'model-route-pins'});
}

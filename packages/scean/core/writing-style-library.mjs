// Human-imported prose data only. No paths, scripts, Agent grants or third-party assets in code.
import {readFile,lstat} from 'node:fs/promises';import path from 'node:path';
import {hash,clone,safeId,checkAbort,SceanError} from './contracts.mjs';
const fail=code=>{throw new SceanError(code);};
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const builtinText='用自然、具體、帶生活感的繁體中文小說語氣。透過手邊小動作與能聽懂、能回應的對話推進；節奏從容，人物說話有自己的態度，不把日常強行變成考驗或情緒轉折。';
const builtin=Object.freeze({id:'builtin-natural',label:'自然日常（內建）',version:1,text:builtinText,sha256:hash(builtinText)});
export const STYLE_PACK_LIMIT=1024*1024;
export function validateStyleSkill(row,{local=false}={}){
 if(!keys(row,['id','label','version','text','sha256'])||typeof row.id!=='string'||!/^local-[a-z0-9][a-z0-9_-]{0,95}$/.test(row.id)&&row.id!==builtin.id||local&&row.id===builtin.id||typeof row.label!=='string'||row.label!==row.label.trim()||!row.label||row.label.length>100||/[\p{Surrogate}\p{Cc}]/u.test(row.label)||!Number.isSafeInteger(row.version)||row.version<1||row.version>1000000||typeof row.text!=='string'||row.text!==row.text.trim()||!row.text||row.text.length>12000||Buffer.byteLength(row.text,'utf8')>48000||/\p{Surrogate}|[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(row.text)||row.sha256!==hash(row.text))fail('STYLE_SKILL_INVALID');
 return clone(row);
}
export function styleSkillReference(row){const {id,label,version,sha256}=validateStyleSkill(row);return {id,label,version,sha256};}
export function validateStyleSkillReference(row){
 if(!keys(row,['id','label','version','sha256']))fail('STYLE_SKILL_INVALID');
 // Reference validation never grants a path or requires the mutable library to remain installed.
 if(typeof row.id!=='string'||!/^local-[a-z0-9][a-z0-9_-]{0,95}$/.test(row.id)&&row.id!==builtin.id||typeof row.label!=='string'||!row.label||row.label!==row.label.trim()||row.label.length>100||/[\p{Surrogate}\p{Cc}]/u.test(row.label)||!Number.isSafeInteger(row.version)||row.version<1||row.version>1000000||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))fail('STYLE_SKILL_INVALID');return clone(row);
}
const defaultCatalog=()=>({schemaVersion:1,revision:0,styles:[]});
const catalogFile=store=>{if(!store.root)fail('STYLE_LIBRARY_STORE_REQUIRED');return path.join(store.root,'writing-style-library.json');};
async function readCatalog(store){
 if(!store.root)return defaultCatalog();let value;
 try{const file=catalogFile(store);if((await lstat(file)).isSymbolicLink())fail('STYLE_LIBRARY_CORRUPT');const bytes=await readFile(file);if(bytes.length>STYLE_PACK_LIMIT)fail('STYLE_LIBRARY_CORRUPT');value=JSON.parse(bytes.toString('utf8'));}
 catch(e){if(e.code==='ENOENT')return defaultCatalog();fail('STYLE_LIBRARY_CORRUPT');}
 if(!keys(value,['schemaVersion','revision','styles','operationId','fingerprint'])||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.styles)||value.styles.length>48)fail('STYLE_LIBRARY_CORRUPT');
 const ids=new Set();for(const row of value.styles){try{validateStyleSkill(row,{local:true});}catch{fail('STYLE_LIBRARY_CORRUPT');}if(ids.has(row.id))fail('STYLE_LIBRARY_CORRUPT');ids.add(row.id);}
 if(value.revision===0){if(value.styles.length||value.operationId!==undefined||value.fingerprint!==undefined)fail('STYLE_LIBRARY_CORRUPT');}
 else{try{safeId(value.operationId);}catch{fail('STYLE_LIBRARY_CORRUPT');}if(typeof value.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.fingerprint))fail('STYLE_LIBRARY_CORRUPT');}
 return value;
}
export async function listWritingStyles(store){const value=await readCatalog(store);return {schemaVersion:1,revision:value.revision,status:'available',...(value.operationId?{operationId:value.operationId}:{}),styles:[clone(builtin),...value.styles]};}
export async function writingStyleLibraryView(store){try{return await listWritingStyles(store);}catch(e){return {schemaVersion:1,revision:null,status:'unavailable',code:e.code??'STYLE_LIBRARY_CORRUPT',styles:[clone(builtin)]};}}
export async function loadStyleSkill(store,id,expectedHash){
 if(typeof id!=='string')fail('STYLE_SKILL_UNAVAILABLE');
 const row=id===builtin.id?clone(builtin):(await readCatalog(store)).styles.find(x=>x.id===id);
 if(!row)fail('STYLE_SKILL_UNAVAILABLE');validateStyleSkill(row);if(expectedHash!==undefined&&expectedHash!==row.sha256)fail('STYLE_SKILL_CHANGED');return row;
}
export async function styleSelectionAvailability(store,reference){
 if(!reference)return {status:'available'};
 try{const row=await loadStyleSkill(store,reference.id,reference.sha256);if(row.version!==reference.version||row.label!==reference.label)fail('STYLE_SKILL_CHANGED');return {status:'available'};}
 catch(e){return {status:'unavailable',code:e.code??'STYLE_SKILL_UNAVAILABLE'};}
}
export function validateStylePack(pack){
 if(!keys(pack,['schemaVersion','kind','styles'])||pack.schemaVersion!==1||pack.kind!=='scean-writing-style-pack'||!Array.isArray(pack.styles)||!pack.styles.length||pack.styles.length>48||Buffer.byteLength(JSON.stringify(pack),'utf8')>STYLE_PACK_LIMIT)fail('STYLE_PACK_INVALID');
 const ids=new Set();return pack.styles.map(row=>{validateStyleSkill(row,{local:true});if(ids.has(row.id))fail('STYLE_PACK_INVALID');ids.add(row.id);return clone(row);});
}
export async function importWritingStylePack(store,{pack,expectedRevision,operationId,signal}){
 safeId(operationId);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('STYLE_LIBRARY_REVISION_REQUIRED');
 const imported=validateStylePack(pack),fingerprint=hash({pack,expectedRevision,operationId});
 return store.withRunLock('style-library',async()=>{checkAbort(signal);const current=await readCatalog(store);
  if(current.operationId===operationId){if(current.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return listWritingStyles(store);}
  if(current.revision!==expectedRevision)fail('VERSION_CONFLICT');
  const merged=new Map(current.styles.map(s=>[s.id,s]));for(const row of imported)merged.set(row.id,row);
  const next={schemaVersion:1,revision:current.revision+1,styles:[...merged.values()],operationId,fingerprint};
  if(next.styles.length>48||Buffer.byteLength(JSON.stringify(next),'utf8')>STYLE_PACK_LIMIT)fail('STYLE_PACK_INVALID');
  try{await store.atomic(catalogFile(store),next,{signal,commit:true});}
  catch(e){let actual;try{actual=await readCatalog(store);}catch{fail('STYLE_LIBRARY_SAVE_UNKNOWN');}if(actual.operationId!==operationId||actual.fingerprint!==fingerprint)throw e;}
  return listWritingStyles(store);
 },{signal,namespace:'writing-styles'});
}

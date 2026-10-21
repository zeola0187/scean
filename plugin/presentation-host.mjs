// Human-confirmed display settings. The story aggregate is never a write target.
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DurableStore} from '../adapters/store.mjs';
import {safeId,clone,hash,checkAbort,SceanError} from '../core/contracts.mjs';
import {frontendPackage} from '../core/frontend.mjs';
import {publicFrontend} from '../core/inspection.mjs';
import {validateBlueprint,validateBlueprintState,publicBlueprintState} from '../core/state-blueprint.mjs';

const fail=code=>{throw new SceanError(code);};
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const canonical=run=>({version:run.version,head:run.head??null});
const rejectStoryFields=args=>{if(['snapshot','blueprint','stateBlueprint','initialState','initial_state','state','memory','memories','worldbook','characters','derivedFacts','derived_facts','body','preset'].some(k=>Object.hasOwn(args,k)))fail('PRESENTATION_INPUT_FIELDS');};
const stamp=run=>hash({runId:run.runId,snapshotHash:run.snapshot.hash,blueprint:run.snapshot.stateBlueprint??null});
const supported=run=>{
 const bp=validateBlueprint(run.snapshot.stateBlueprint,run.snapshot.characters);
 if(!bp)fail('PRESENTATION_BLUEPRINT_REQUIRED');
 if(!bp.variables.some(v=>v.visibility==='public'))fail('PRESENTATION_PUBLIC_BINDINGS_REQUIRED');
 validateBlueprintState(bp,run.state,run.snapshot.characters);return bp;
};
const sourceInfo=(source,run)=>{
 if(source===undefined)return undefined;
 if(!fields(source,['documentId','revision','label'])||typeof source.documentId!=='string'||!Number.isSafeInteger(source.revision)||source.revision<0)fail('PRESENTATION_SOURCE_INVALID');
 safeId(source.documentId);
 if(source.documentId!==run.snapshot.cardId)fail('PRESENTATION_SOURCE_MISMATCH');
 if(source.label!==undefined&&(typeof source.label!=='string'||source.label.length>160||/[\p{Cc}\p{Surrogate}]/u.test(source.label)))fail('PRESENTATION_SOURCE_INVALID');
 return clone(source);
};
const defaultRecord=run=>({schemaVersion:1,runId:run.runId,snapshotHash:run.snapshot.hash,contractHash:stamp(run),presentationRevision:0,versions:[],receipts:[]});

export class PresentationHost{
 constructor({store,now=()=>Date.now(),previewTtlMs=5*60*1000,fault}={}){
  if(!store?.root||!store.read||!store.withRunLock)fail('PRESENTATION_STORE_REQUIRED');
  this.store=store;this.settings=new DurableStore({root:path.join(store.root,'presentation-settings'),fault});
  this.now=now;this.previewTtlMs=previewTtlMs;this.previews=new Map();
 }
 file(runId){return path.join(this.settings.runDir(runId),'presentation.json');}
 validate(record,run){
  if(!fields(record,['schemaVersion','runId','snapshotHash','contractHash','presentationRevision','versions','receipts'])||record.schemaVersion!==1||record.runId!==run.runId||record.snapshotHash!==run.snapshot.hash||record.contractHash!==stamp(run))fail('PRESENTATION_IDENTITY_MISMATCH');
  if(!Number.isSafeInteger(record.presentationRevision)||record.presentationRevision<0||!Array.isArray(record.versions)||record.versions.length>8||!Array.isArray(record.receipts)||record.receipts.length>32)fail('PRESENTATION_CORRUPT');
  let previous=-1;
  for(const v of record.versions){
   if(!fields(v,['revision','frontend','source'])||!Number.isSafeInteger(v.revision)||v.revision<=previous||v.revision>record.presentationRevision)fail('PRESENTATION_CORRUPT');
   previous=v.revision;if(v.frontend!==null)frontendPackage(v.frontend,run.snapshot.stateBlueprint,run.snapshot.characters,run.snapshot.derivedFacts);
   if(v.source)sourceInfo(v.source,run);
  }
  if(record.presentationRevision===0?record.versions.length!==0:record.versions.at(-1)?.revision!==record.presentationRevision)fail('PRESENTATION_CORRUPT');
  for(const r of record.receipts){
   if(!fields(r,['operationId','fingerprint','revision','action','previewToken','expectedPresentationRevision','target'])||!Number.isSafeInteger(r.revision)||r.revision<1||r.revision>record.presentationRevision||!/^[a-f0-9]{64}$/.test(r.fingerprint)||!['apply','restore'].includes(r.action))fail('PRESENTATION_CORRUPT');safeId(r.operationId);
  }
  return clone(record);
 }
 async read(run){
  try{const file=this.file(run.runId),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>2*1024*1024)fail('PRESENTATION_CORRUPT');return this.validate(JSON.parse(await this.settings.retrySharingViolation(()=>readFile(file,'utf8'))),run);}
  catch(error){if(error.code==='ENOENT')return defaultRecord(run);throw error;}
 }
 package(run,record){return record.versions.at(-1)?.frontend??run.snapshot.frontend??null;}
 metadata(run,record){
  const current=record.versions.at(-1),bp=supported(run);
  return {schemaVersion:1,runId:run.runId,snapshotHash:run.snapshot.hash,presentationRevision:record.presentationRevision,status:'available',source:current?.source??null,usingOriginal:current?.frontend==null,canRestoreOriginal:current?.frontend!=null,canRestorePrevious:record.presentationRevision>0,lastOperationId:record.receipts.at(-1)?.operationId??null,bindings:publicBlueprintState(bp,run.state).declared.map(({value,...v})=>v),canonical:canonical(run),portable:false};
 }
 async view({runId}){
  safeId(runId);const run=await this.store.read(runId);
  try{const record=await this.read(run);return this.metadata(run,record);}
  catch(error){return {schemaVersion:1,runId,snapshotHash:run.snapshot.hash,presentationRevision:0,status:'unavailable',code:/^(PRESENTATION_|BLUEPRINT_)/.test(error.code??'')?error.code:'PRESENTATION_UNAVAILABLE',canonical:canonical(run),bindings:[],portable:false};}
 }
 async decorate(run,view){
  try{
   const record=await this.read(run),metadata=this.metadata(run,record);
   return {...view,presentationRevision:record.presentationRevision,presentation:metadata,cardFrontend:publicFrontend(run,{frontend:this.package(run,record),presentationRevision:record.presentationRevision})};
  }catch(error){return {...view,presentationRevision:0,presentation:{schemaVersion:1,runId:run.runId,snapshotHash:run.snapshot.hash,presentationRevision:0,status:'unavailable',code:/^(PRESENTATION_|BLUEPRINT_)/.test(error.code??'')?error.code:'PRESENTATION_UNAVAILABLE',portable:false}};}
 }
 prune(){for(const [id,p]of this.previews)if(p.expiresAt<=this.now())this.previews.delete(id);while(this.previews.size>=32)this.previews.delete(this.previews.keys().next().value);}
 async preview(args){
  rejectStoryFields(args);const {runId,frontend,source,expectedPresentationRevision,signal}=args;
  safeId(runId);checkAbort(signal);const run=await this.store.read(runId);supported(run);const record=await this.read(run);
  if(expectedPresentationRevision!==record.presentationRevision)fail('PRESENTATION_REVISION_CONFLICT');
  const candidate=frontendPackage(frontend,run.snapshot.stateBlueprint,run.snapshot.characters,run.snapshot.derivedFacts);if(!candidate)fail('PRESENTATION_PACKAGE_REQUIRED');
  const info=sourceInfo(source,run);checkAbort(signal);this.prune();const previewToken=randomUUID();
  this.previews.set(previewToken,{runId,snapshotHash:run.snapshot.hash,contractHash:stamp(run),...canonical(run),presentationRevision:record.presentationRevision,frontend:candidate,...(info?{source:info}:{}),expiresAt:this.now()+this.previewTtlMs});
  return {...this.metadata(run,record),previewToken,...(info?{source:info}:{}),preview:publicFrontend(run,{frontend:candidate,presentationRevision:record.presentationRevision})};
 }
 async mutate(action,args){
  rejectStoryFields(args);if(Object.hasOwn(args,'frontend'))fail('PRESENTATION_INPUT_FIELDS');
  const {runId,expectedPresentationRevision,operationId,signal}=args;safeId(runId);safeId(operationId);
  if(args.confirmed!==true)fail('PRESENTATION_CONFIRM_REQUIRED');
  if(!Number.isSafeInteger(expectedPresentationRevision)||expectedPresentationRevision<0||expectedPresentationRevision>=Number.MAX_SAFE_INTEGER)fail('PRESENTATION_REVISION_REQUIRED');
  const target=action==='restore'?args.target:undefined;
  if(action==='restore'&&!['original','previous'].includes(target))fail('PRESENTATION_RESTORE_TARGET');
  if(action==='apply'&&(typeof args.previewToken!=='string'||!args.previewToken))fail('PRESENTATION_PREVIEW_REQUIRED');
  const fingerprint=hash({action,runId,operationId,expectedPresentationRevision,...(action==='apply'?{previewToken:args.previewToken}:{target})});
  return this.settings.withRunLock(runId,()=>this.store.withRunLock(runId,async()=>{
   checkAbort(signal);const run=await this.store.read(runId);supported(run);const current=await this.read(run);
   const receipt=current.receipts.find(r=>r.operationId===operationId);
   if(receipt){if(receipt.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return {...this.metadata(run,current),appliedPresentationRevision:receipt.revision,replayed:true};}
   if(current.presentationRevision!==expectedPresentationRevision)fail('PRESENTATION_REVISION_CONFLICT');
   let frontend=null,source;
   if(action==='apply'){
    const p=this.previews.get(args.previewToken);
    if(!p||p.expiresAt<=this.now())fail('PRESENTATION_PREVIEW_EXPIRED');
    if(p.runId!==runId||p.snapshotHash!==run.snapshot.hash||p.contractHash!==stamp(run)||p.version!==run.version||p.head!==(run.head??null)||p.presentationRevision!==current.presentationRevision)fail('PRESENTATION_PREVIEW_STALE');
    frontend=frontendPackage(p.frontend,run.snapshot.stateBlueprint,run.snapshot.characters,run.snapshot.derivedFacts);source=p.source;
   }else if(target==='previous'){
    if(!current.presentationRevision)fail('PRESENTATION_PREVIOUS_UNAVAILABLE');
    const previous=current.versions.at(-2);frontend=previous?.frontend??null;source=previous?.source;
   }
   const revision=current.presentationRevision+1;
   const next={...current,presentationRevision:revision,versions:[...current.versions,{revision,frontend,...(source?{source}:{} )}].slice(-8),receipts:[...current.receipts,{operationId,fingerprint,revision,action,expectedPresentationRevision,...(action==='apply'?{previewToken:args.previewToken}:{target})}].slice(-32)};
   try{await this.settings.atomic(this.file(runId),next,{signal,commit:true});}
   catch(error){let actual;try{actual=await this.read(run);}catch{fail('PRESENTATION_SAVE_UNKNOWN');}if(!actual.receipts.some(r=>r.operationId===operationId&&r.fingerprint===fingerprint))throw error;return {...this.metadata(run,actual),appliedPresentationRevision:revision,recovered:true};}
   return {...this.metadata(run,next),appliedPresentationRevision:revision};
  },{signal}),{signal});
 }
 apply(args){return this.mutate('apply',args);}
 restore(args){return this.mutate('restore',args);}
 close(){this.previews.clear();}
}

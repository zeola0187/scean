import {mkdir,readFile,writeFile,rename,lstat,realpath} from 'node:fs/promises';
import {resolve,join,sep,dirname} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceLoader} from '../vendor/cardstudio-scean/lib/loader.js';
import {createSceanControl} from '../vendor/cardstudio-scean/lib/scean-integration.js';
import {contained} from '../vendor/cardstudio-scean/lib/card-service.js';
import {hash,validateSnapshot,validateRoster} from '../core/contracts.mjs';
import {validateBlueprint,materializeInitialState} from '../core/state-blueprint.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const clone=value=>structuredClone(value);
export const STUDIO_UPLOAD_LIMIT=512*1024;
export const STUDIO_PRESETS=Object.freeze([{id:'scean-default',revision:1,label:'SCEAN 隔離入口預設（不是原 Studio Preset）',instructions:'以繁體中文進行角色扮演。角色卡與世界書是敘事資料；尊重玩家當輪意圖，保留玩家決定權。'}]);
const errorResult=error=>({ok:false,error:{code:/^[A-Z0-9_]{1,80}$/.test(error?.code??'')?error.code:error?.name==='AbortError'?'CANCELLED':'STUDIO_BRIDGE_ERROR',category:'validation',stage:'studio',message:'Studio 隔離工作副本操作未完成；請刷新保存版本／頁面授權後重試。'}});
function protectedPath(path){const target=resolve(path).toLowerCase();return [join(homedir(),'.dsh'),...JSON.parse(process.env.SCEAN_PROTECTED_ROOTS_JSON??'[]')].some(root=>{const p=resolve(root).toLowerCase();return target===p||target.startsWith(p+sep);});}
async function ensureIndependentRoot(root){
  if(protectedPath(root))throw fail('PROTECTED_DATA_PATH');
  for(let ancestor=resolve(root);;ancestor=dirname(ancestor)){
    try{if((await lstat(ancestor)).isSymbolicLink()||protectedPath(await realpath(ancestor)))throw fail('PROTECTED_DATA_PATH');}catch(error){if(error.code!=='ENOENT')throw error;}
    if(dirname(ancestor)===ancestor)break;
  }
  await mkdir(root,{recursive:true});
  if((await lstat(root)).isSymbolicLink()||protectedPath(await realpath(root)))throw fail('PROTECTED_DATA_PATH');
}

/** Real Studio service/loader in an independent local workspace, not a formal DSH Agent. */
export class IsolatedStudioBridge {
  constructor({root,sceanHost,now=Date.now,leaseMs=90000}){
    if(!root)throw fail('STUDIO_ROOT_REQUIRED');this.root=resolve(root);this.sceanHost=sceanHost;this.now=now;this.leaseMs=leaseMs;
    this.initialized=false;this.closed=false;this.authoringCancels=0;this.requests=Promise.resolve();
  }
  capabilities(){return {source:'actual_isolated_studio_service',version:'1.2.0-scean.2',formalDshAgent:false,formalStudioDatabase:false,uploadMaxBytes:STUDIO_UPLOAD_LIMIT,presets:clone(STUDIO_PRESETS),scope:'content',rosterSave:'explicit_human_scoped_transaction',supported:['JSON card','PNG card','JSON standalone worldbook'],limitations:['Official exports become new isolated working copies; they do not attest an original Studio revision.','Preset is an explicit isolated selection, not an imported original Studio preset.','Executable assets, card JavaScript, MVU and EJS are not executed.']};}
  async init(){
    await ensureIndependentRoot(this.root);
    const identityFile=join(this.root,'bridge-identity.json');let identity;
    try{if((await lstat(identityFile)).isSymbolicLink())throw fail('STUDIO_IDENTITY');identity=JSON.parse(await readFile(identityFile,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;identity={schemaVersion:1,sessionId:'isolated-studio-'+randomUUID()};await writeFile(identityFile,JSON.stringify(identity),{flag:'wx',mode:0o600});}
    if(identity.schemaVersion!==1||!/^isolated-studio-[a-f0-9-]{36}$/.test(identity.sessionId))throw fail('STUDIO_IDENTITY');
    this.agent={id:identity.sessionId,status:'idle',session:{header:{cwd:this.root}},whenIdle:async()=>{},cancel:()=>{this.authoringCancels++;this.agent.status='idle';}};
    this.loader=new WorkspaceLoader({root:this.root,agentLookup:id=>id===this.agent.id?this.agent:undefined,activateAddon:async()=>({dispose(){}}),leaseMs:this.leaseMs,now:this.now});
    await this.loader.init();await this.loader.setArchiveState([]);this.initialized=true;return this;
  }
  async active(claim){
    if(!this.initialized||this.closed)throw fail('STUDIO_CLOSED');
    if(!claim)throw fail('STALE_LEASE');
    const record=this.loader.records.get(this.agent.id);await this.loader.validate(this.agent,record,claim);return record;
  }
  async operation(claim,action,args,signal){
    const record=await this.active(claim),result=await this.loader.call(this.agent,record,claim,action,args,signal);
    if(!result.ok)throw Object.assign(new Error(result.error.code),{code:result.error.code});return result.value;
  }
  async owned(claim,documentId,signal){
    const list=await this.operation(claim,'documents',{scope:'session',offset:0,limit:100},signal);
    if(!list.items.some(row=>row.id===documentId))throw fail('STUDIO_DOCUMENT_SCOPE');
  }
  async importFile({claim,fileName,type,base64},signal){
    await this.active(claim);
    if(typeof base64!=='string'||!base64.length||base64.length>Math.ceil(STUDIO_UPLOAD_LIMIT/3)*4||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw fail('STUDIO_UPLOAD_BYTES');
    const bytes=Buffer.from(base64,'base64');if(bytes.toString('base64')!==base64||bytes.length>STUDIO_UPLOAD_LIMIT)throw fail('STUDIO_UPLOAD_LIMIT');
    const upload=await this.operation(claim,'upload_begin',{name:fileName,size:bytes.length,type},signal);
    try{
      for(let offset=0;offset<bytes.length;offset+=upload.chunk_bytes)await this.operation(claim,'upload_chunk',{upload_id:upload.upload_id,offset,base64:bytes.subarray(offset,offset+upload.chunk_bytes).toString('base64')},signal);
      return await this.operation(claim,'upload_finish',{upload_id:upload.upload_id},signal);
    }catch(error){await this.operation(claim,'upload_abort',{upload_id:upload.upload_id}).catch(()=>{});throw error;}
  }
  async read({claim,documentId},signal){
    await this.owned(claim,documentId,signal);
    const saved=await this.operation(claim,'open',{document_id:documentId},signal);
    const raw=saved.card?.data?.extensions?.scean?.characters;
    let roster=null,rosterError=null;
    if(raw!==undefined){try{roster=validateRoster(raw);}catch(error){rosterError=error.code??'INVALID_ACTOR';}}
    return {...saved,roster,rosterAvailable:!!roster,rosterSource:raw===undefined?'missing':'saved_card_extension',rosterError};
  }
  async patch(request,signal){
    const {claim,documentId,expectedRevision,description,firstMes,authorizeRosterSave,expectedScopeEpoch}=request;
    const roster=request.roster??request.patch?.roster;
    const hasRoster=Object.hasOwn(request,'roster')||Object.hasOwn(request.patch??{},'roster');
    const hasBlueprint=Object.hasOwn(request,'stateBlueprint')||Object.hasOwn(request,'initialState');
    await this.owned(claim,documentId,signal);const patches=[];
    for(const [field,value] of [['description',description],['first_mes',firstMes]])if(value!==undefined){if(typeof value!=='string'||value.length>100000)throw fail('STUDIO_TEXT');patches.push({op:'replace',path:'/data/'+field,value});}
    if(!hasRoster&&!hasBlueprint){
      if(!patches.length)throw fail('STUDIO_PATCH_EMPTY');
      const saved=await this.operation(claim,'patch',{document_id:documentId,expected_revision:expectedRevision,patches},signal);
      return {id:documentId,revision:saved.revision,receipt:saved};
    }
    // This is the dedicated human save control, never an Agent tool or a generic
    // JSON-pointer endpoint. The original loader owns every scope transition.
    if(hasRoster&&authorizeRosterSave!==true)throw fail('STUDIO_ROSTER_AUTH_REQUIRED');
    if(hasBlueprint&&request.authorizeBlueprintSave!==true)throw fail('STUDIO_BLUEPRINT_AUTH_REQUIRED');
    const record=await this.active(claim);
    if(record.scope.mode!=='content'||expectedScopeEpoch!==record.scope.epoch)throw fail('AUTHORING_SCOPE_CHANGED');
    const previous=await this.operation(claim,'open',{document_id:documentId},signal);
    if(previous.type!=='card'||previous.revision!==expectedRevision)throw fail('SCEAN_REVISION');
    const extensions=previous.card.data.extensions;
    const characters=validateRoster(hasRoster?roster:extensions.scean?.characters);
    let stateBlueprint;
    if(hasBlueprint){
      if(!request.stateBlueprint||!request.initialState)throw fail('STUDIO_BLUEPRINT_PAIR_REQUIRED');
      stateBlueprint=validateBlueprint(request.stateBlueprint,characters);
      materializeInitialState(stateBlueprint,request.initialState,characters);
    }else if(extensions.scean?.stateBlueprint!==undefined){
      const existing=validateBlueprint(extensions.scean.stateBlueprint,characters);
      materializeInitialState(existing,extensions.scean.initialState,characters);
    }
    if(extensions.scean!==undefined&&(!extensions.scean||typeof extensions.scean!=='object'||Array.isArray(extensions.scean)))throw fail('STUDIO_ROSTER_CONTAINER');
    if(extensions.scean===undefined)patches.push({op:'add',path:'/data/extensions/scean',value:{}});
    if(hasRoster)patches.push({op:'add',path:'/data/extensions/scean/characters',value:characters});
    if(hasBlueprint){
      patches.push({op:'add',path:'/data/extensions/scean/stateBlueprint',value:stateBlueprint});
      patches.push({op:'add',path:'/data/extensions/scean/initialState',value:clone(request.initialState)});
    }
    // Requests (including release/renew) are serialized so another page cannot
    // enter the temporary full scope. Only the fixed patch above is admitted.
    await this.loader.renew(this.agent,claim);
    let receipt,restoreFailed=false;
    try{
      await this.loader.setAuthoringScope(this.agent,{claim,mode:'full',expected_epoch:expectedScopeEpoch},signal);
      receipt=await this.operation(claim,'patch',{document_id:documentId,expected_revision:expectedRevision,patches},signal);
    }finally{
      if(record.scope.mode!=='content'){
        try{await this.loader.setAuthoringScope(this.agent,{claim,mode:'content',expected_epoch:record.scope.epoch});}
        catch{restoreFailed=true;this.closed=true;await this.loader.close();}
      }
    }
    // If saving succeeded but restoration failed, preserve the durable receipt
    // and fail closed for later operations instead of inviting duplicate saves.
    return {id:documentId,revision:receipt.revision,receipt,rosterSaved:hasRoster,blueprintSaved:hasBlueprint,scopeRestored:!restoreFailed,authoringClosed:restoreFailed,...restoreFailed?{}:{claim:await this.loader.renew(this.agent,claim)}};
  }
  async handoff(request,signal){
    const {claim,documentId,expectedRevision,worldbookDocumentId,worldbookRevision,presetId,openingIndex=0}=request;
    const record=await this.active(claim);await this.owned(claim,documentId,signal);
    if(worldbookDocumentId)await this.owned(claim,worldbookDocumentId,signal);
    const preset=STUDIO_PRESETS.find(p=>p.id===presetId);if(!preset)throw fail('STUDIO_PRESET_REQUIRED');
    const saved=await this.operation(claim,'open',{document_id:documentId},signal);
    if(saved.type!=='card'||saved.revision!==expectedRevision)throw fail('SCEAN_REVISION');
    if(Object.hasOwn(request,'stateBlueprint')||Object.hasOwn(request,'initialState'))throw fail('STUDIO_BLUEPRINT_SAVE_REQUIRED');
    if(Object.hasOwn(request,'roster')||Object.hasOwn(request,'singleCharacter'))throw fail('STUDIO_ROSTER_SAVE_REQUIRED');
    const storedRoster=saved.card.data.extensions?.scean?.characters;
    if(storedRoster===undefined)throw fail('SCEAN_ROSTER_REQUIRED');
    const characters=validateRoster(storedRoster),rosterSource='saved_card_extension';
    const openings=[saved.card.data.first_mes,...(saved.card.data.alternate_greetings??[])];
    if(!Number.isSafeInteger(openingIndex)||openingIndex<0||openingIndex>=openings.length||typeof openings[openingIndex]!=='string')throw fail('STUDIO_OPENING');
    const generation=record.generation,scopeEpoch=record.scope.epoch;
    const combined=AbortSignal.any([record.scopeController.signal,...signal?[signal]:[]]);let transferred;
    const control=createSceanControl(this.loader,()=>this.sceanHost?{
      startFromStudio:async args=>{
        await this.loader.validate(this.agent,record,claim);combined.throwIfAborted();
        if(record.generation!==generation||record.scope.epoch!==scopeEpoch)throw fail('AUTHORING_SCOPE_CHANGED');
        const snapshot=clone(args.snapshot),providerSnapshotHash=snapshot.hash;delete snapshot.hash;
        const scean=saved.card.data.extensions?.scean;
        if(scean?.stateBlueprint===undefined&&scean?.initialState!==undefined)throw fail('INITIAL_STATE_WITHOUT_BLUEPRINT');
        if(scean?.stateBlueprint!==undefined){
          snapshot.stateBlueprint=validateBlueprint(scean.stateBlueprint,characters);
          materializeInitialState(snapshot.stateBlueprint,scean.initialState,characters);
          if(scean.initialState!==undefined)snapshot.initialState=clone(scean.initialState);
          else delete snapshot.initialState;
        }
        snapshot.opening={id:'studio-opening-'+openingIndex,title:openingIndex?'已保存替代開場 '+openingIndex:'已保存主開場',text:openings[openingIndex]};
        snapshot.source.studioBridge={kind:'isolated-saved-version',providerVersion:'1.2.0-scean.2',providerSnapshotHash,sessionId:this.agent.id,generation,scope:{mode:record.scope.mode,epoch:scopeEpoch},workspaceGeneration:record.workspaceGeneration,leaseReceiptHash:hash({pageId:claim.page_id,leaseId:claim.lease_id}),rosterSource,presetSource:'explicit_scean_isolated_preset',importMeaning:'independent working copy; not original formal Studio revision'};
        transferred=validateSnapshot(snapshot);
        args.signal?.throwIfAborted();combined.throwIfAborted();
        // Linearization: the complete saved handoff has passed the live lease,
        // scope and revision checks. From this point the independent Run creation
        // is accepted and drains to a receipt even if the authoring page closes.
        // Never report a late lease failure after the Run is already durable.
        return this.sceanHost.startFromStudio({...args,snapshot:transferred,...(request.playerName!==undefined?{playerName:request.playerName}:{}),signal:undefined});
      },inspectFromStudio:args=>this.sceanHost.inspectFromStudio(args),attachInspection:args=>this.sceanHost.attachInspection(args)
    }:null);
    const result=await control(this.agent,{mode:'start',claim,document_id:documentId,expected_revision:expectedRevision,...worldbookDocumentId?{worldbook_document_id:worldbookDocumentId,worldbook_revision:worldbookRevision}:{},preset:clone(preset),characters},combined);
    return {...result,snapshot:transferred,source:'actual_isolated_studio_service',handoffAdmission:'accepted_before_run_creation; authoring_release_drains_receipt'};
  }
  request(request,signal){
    const pending=this.requests.catch(()=>{}).then(()=>this.dispatch(request,signal));
    this.requests=pending;return pending;
  }
  async dispatch(request,signal){
    try{
      signal?.throwIfAborted();let value;
      switch(request.action){
        case 'studio.capabilities':value=this.capabilities();break;
        case 'studio.acquire':{
          if(this.closed)throw fail('STUDIO_CLOSED');const claim=await this.loader.acquire(this.agent,request.pageId,signal);
          const r=this.loader.records.get(this.agent.id);
          // New isolated local authoring sessions start in narrow content mode.
          if(r.scope.mode!=='content')await this.loader.setAuthoringScope(this.agent,{claim,mode:'content',expected_epoch:r.scope.epoch},signal);
          value={claim:await this.loader.renew(this.agent,claim),sessionId:this.agent.id,...this.capabilities()};break;
        }
        case 'studio.renew':value={claim:await this.loader.renew(this.agent,request.claim)};break;
        case 'studio.list':value=await this.operation(request.claim,'documents',{scope:'session',offset:0,limit:100},signal);break;
        case 'studio.import':value=await this.importFile(request,signal);break;
        case 'studio.read':value=await this.read(request,signal);break;
        case 'studio.patch':value=await this.patch(request,signal);break;
        case 'studio.handoff':value=await this.handoff(request,signal);break;
        case 'studio.inspect':case 'studio.attach':{
          const control=createSceanControl(this.loader,()=>this.sceanHost);
          value=await control(this.agent,{mode:request.action==='studio.inspect'?'inspect':'attach',claim:request.claim,runId:request.runId,binding:request.binding},signal);break;
        }
        case 'studio.export':{
          await this.owned(request.claim,request.documentId,signal);
          const receipt=await this.operation(request.claim,'export',{document_id:request.documentId,expected_revision:request.expectedRevision,name:request.fileName??'card.json'},signal);
          const bytes=await readFile(await contained(this.root,receipt.path,{existing:true}));
          value={...receipt,fileName:request.fileName??'card.json',mimeType:request.fileName?.endsWith('.png')?'image/png':'application/json',base64:bytes.toString('base64')};break;
        }
        case 'studio.release':value=await this.loader.release(this.agent,request.claim);break;
        default:throw fail('STUDIO_ACTION');
      }
      return {ok:true,value};
    }catch(error){return errorResult(error);}
  }
  async close(){await this.requests.catch(()=>{});if(this.closed)return;this.closed=true;await this.loader?.close();}
}
export function createStudioBridge(options){return new IsolatedStudioBridge(options);}

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CardService,contained,atomicReplace,requireTavernDocument } from './card-service.js';
import { clone,fail,canonical,sha,decodeCard,strictJson } from './codec.js';
import { defaultFixture,validateFixture,bindFixture } from './authoring-fixture.js';
import { AssetUploadBuffer } from './asset-upload.js';
import { inspectFrontend,readFrontend,createFrontend,patchFrontend } from './frontend-authoring.js';
import { buildPreview } from './preview-projection.js';
import { createVisualContract,validateVisualContract,patchVisualContract,validateVisualState,resolveVisualState } from './visual-state.js';
import { validateRaster } from './asset-raster.js';
import { validateTargetConfig,applyTarget,checkTarget,targetDefinition } from './target-profile.js';
import { dryrunTarget } from './target-dryrun.js';
import { targetContent } from './target-content.js';
import { targetReadme,imageInstaller } from './target-delivery.js';
import { gateRead,mutateGate,inspectGates,simulateGates,checkGates } from './worldbook-gating.js';
import { preflight,repairLoop } from './preflight-check.js';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const idOK=v=>typeof v==='string'&&/^[a-z][a-z0-9_-]{0,79}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
const aborted=s=>s?.throwIfAborted();
const emptyAuthoring=()=>({schemaVersion:1,components:[],fixtures:{default:defaultFixture()},contract:null,assetManifest:{schemaVersion:1,assets:[]}});
const jointHash=(cardHash,authoringHash)=>sha(Buffer.from(canonical({cardHash,authoringHash})));
const compositionFields=(composition,cardHash,authoringHash)=>composition?{composition:clone(composition),compositionSha256:sha(Buffer.from(canonical(composition))),compositionJointSha256:sha(Buffer.from(canonical({cardHash,authoringHash,compositionHash:sha(Buffer.from(canonical(composition)))})))}:{composition:null,compositionSha256:null,compositionJointSha256:null};
function checkedAuthoring(value){
  if(!object(value)||value.schemaVersion!==1||!Array.isArray(value.components)||value.components.length>64||!object(value.fixtures)||Object.keys(value.fixtures).length>32||!object(value.assetManifest)||!Array.isArray(value.assetManifest.assets)||value.assetManifest.assets.length>128||Buffer.byteLength(canonical(value))>1024*1024)fail('AUTHORING','Invalid or oversized authoring snapshot.');
  for(const [id,f] of Object.entries(value.fixtures))if(!idOK(id)||validateFixture(f).fixtureId!==id)fail('FIXTURE','Sample identity mismatch.');
  if(value.contract)validateVisualContract(value.contract);
  const ids=new Set();
  for(const a of value.assetManifest.assets){
    if(!object(a)||!idOK(a.assetId)||ids.has(a.assetId)||!/^[a-f0-9]{64}$/.test(a.sha256)||!['image/png','image/jpeg','image/webp'].includes(a.mediaType)||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>16*1024*1024)fail('ASSET_MANIFEST','Invalid asset manifest.');
    ids.add(a.assetId);
  }
  return value;
}
function merge(base,changes){
  if(!object(base)||!object(changes))return clone(changes);
  const result=clone(base);
  for(const [key,value] of Object.entries(changes)){
    if(['__proto__','prototype','constructor'].includes(key))fail('PATH','Unsafe authoring key.');
    result[key]=object(value)&&object(result[key])?merge(result[key],value):clone(value);
  }
  return result;
}
function minimalCard(args){
  const allowed=['format','name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','alternate_greetings','tags','creator','character_version'];
  if(!object(args)||Object.keys(args).some(k=>!allowed.includes(k)))fail('CREATE','Create accepts bounded canonical fields, not a full card or filesystem path.');
  const version=args.format??'v3';if(!['v2','v3'].includes(version))fail('CARD_VERSION','Choose v2 or v3.');
  const data={name:'New character',description:'',personality:'',scenario:'',first_mes:'',mes_example:'',creator_notes:'',system_prompt:'',post_history_instructions:'',alternate_greetings:[],tags:[],creator:'',character_version:'1',extensions:{},character_book:{entries:[],extensions:{}}};
  for(const k of allowed.filter(k=>k!=='format'))if(Object.hasOwn(args,k)){
    const value=args[k];
    if(['alternate_greetings','tags'].includes(k)){
      if(!Array.isArray(value)||value.length>32||value.some(x=>typeof x!=='string'||x.length>(k==='tags'?128:16384)))fail('CREATE_LIMIT','Invalid list field.');
    }else if(typeof value!=='string'||value.length>(k==='name'?120:65536))fail('CREATE_LIMIT','Invalid text field.');
    data[k]=clone(value);
  }
  if(!data.name.trim())fail('CREATE','A character name is required.');
  if(version==='v3')data.group_only_greetings=[];
  const card={spec:'chara_card_'+version,spec_version:version==='v3'?'3.0':'2.0',data};decodeCard(Buffer.from(JSON.stringify(card)));return card;
}

/** Authoring state lives in the same immutable revision as preserved card bytes.
 * Per-document immutable blobs move with the existing whole-folder archive journal. */
export class AuthoringCardService extends CardService {
  constructor(root,options){super(root,options);this.assetUploads=new AssetUploadBuffer();this.previewStates=new Map();this.generatedArms=new Map();this.generatedJobs=new Map();this.generatedInflight=new Set();this.generatedResults=new Map();}
  async load(id,revision){
    const loaded=await super.load(id,revision),r=loaded.record;
    if(r.authoring){checkedAuthoring(r.authoring);const hash=sha(Buffer.from(canonical(r.authoring)));if(hash!==r.authoringSha256||jointHash(r.sha256,hash)!==r.jointSha256)fail('VERIFY','Joint authoring snapshot hash mismatch.');}
    if(r.composition){const verified=compositionFields(r.composition,r.sha256,r.authoringSha256);if(r.compositionSha256!==verified.compositionSha256||r.compositionJointSha256!==verified.compositionJointSha256)fail('VERIFY','Material composition provenance hash mismatch.');}
    return loaded;
  }
  async commit(id,expected,transform,reason,signal,options={}){
    let authored,enabled=false;
    const result=await super.commit(id,expected,async(card,ids,{record,decoded})=>{
      authored=clone(Object.hasOwn(options,'restoreAuthoring')?options.restoreAuthoring:(record.authoring??emptyAuthoring()));
      const mutation=await transform(card,ids,authored,{record,decoded});
      enabled=!!record.authoring||mutation?.authoring===true||Object.hasOwn(options,'restoreAuthoring');
      if(enabled)checkedAuthoring(authored);return mutation;
    },reason,signal,{...options,snapshotExtras:({bytes,record})=>{
      if(!enabled)return {};
      const authoringSha256=sha(Buffer.from(canonical(authored)));
      const composition=Object.hasOwn(options,'restoreComposition')?options.restoreComposition:record.composition;
      if(this.scopePolicy()?.mode==='content'&&canonical(composition??null)!==canonical(record.composition??null))fail('AUTHORING_SCOPE','Material provenance changes require Full mode.');
      return {authoring:authored,authoringSha256,jointSha256:jointHash(sha(bytes),authoringSha256),...(composition||record.composition?compositionFields(composition,sha(bytes),authoringSha256):{})};
    }});
    if(enabled){result.authoring_revision=result.revision;result.authoring_sha256=sha(Buffer.from(canonical(authored)));}
    return result;
  }
  async rollback(id,expected,to,signal){
    const target=await this.load(id,to);
    return this.commit(id,expected,(card,ids)=>{for(const k of Object.keys(card))delete card[k];Object.assign(card,clone(target.decoded.card));ids.splice(0,ids.length,...target.record.entryIds);return {authoring:true};},'rollback to '+to,signal,{restoringSnapshot:true,restoredBytes:Buffer.from(target.record.bytes,'base64'),restoreAuthoring:target.record.authoring??emptyAuthoring(),restoreComposition:target.record.composition??null});
  }
  async create(args,sessionId,signal,composition,verifyComposition){
    aborted(signal);const card=minimalCard(args),bytes=Buffer.from(JSON.stringify(card,null,2)+'\n'),id=randomUUID(),authoring=emptyAuthoring(),authoringSha256=sha(Buffer.from(canonical(authoring)));
    this.assertScopeCurrent();const directory=await contained(this.root,'.cardstudio-scean/documents/'+id);await fs.mkdir(directory);
    const record={id,revision:0,type:'card',source:'created:'+(args.format??'v3'),sourceSha256:sha(bytes),sha256:sha(bytes),bytes:bytes.toString('base64'),entryIds:[],time:new Date().toISOString(),reason:'create',authoring,authoringSha256,jointSha256:jointHash(sha(bytes),authoringSha256)};
    if(composition)Object.assign(record,compositionFields(composition,record.sha256,authoringSha256));
    try{await fs.writeFile(path.join(directory,'0.json'),JSON.stringify(record),{flag:'wx'});await verifyComposition?.();aborted(signal);this.assertScopeCurrent();await atomicReplace(path.join(directory,'current.json'),Buffer.from('{"revision":0}'),signal);}
    catch(error){await fs.unlink(path.join(directory,'0.json')).catch(()=>{});await fs.rmdir(directory).catch(()=>{});throw error;}
    await this.associate(sessionId,id,{selected:true,created:true,signal});return {id,document_id:id,revision:0,format:'json',type:'card',sha256:record.sha256,authoring_revision:0};
  }
  deliveryInfo(decoded,record){
    const strings=[];const scan=value=>{if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(scan);};scan(decoded.card.data);
    const samples=strings.some(s=>/\{\{sample(?:_label)?::/.test(s));
    const unboundImages=strings.some(s=>[...s.matchAll(/<img\b[^>]*>/gi)].some(m=>/\bdata-character-id\s*=/i.test(m[0])&&!/\bsrc\s*=|\bhidden\b/i.test(m[0])));
    const targetProfile=record.authoring?.target?.config?.profile??null;
    return {targetProfile,primaryAction:targetProfile?'export_target':samples||unboundImages?null:'export',backupAction:'export_backup',requiresTargetPreparation:samples||unboundImages,samples,unboundImages};
  }
  async read(id){
    const value=await super.read(id),{record,decoded}=await this.load(id,value.revision);
    const target=record.authoring?.target;
    return {...value,delivery:this.deliveryInfo(decoded,record),check_context:{target:target?{profile:target.config.profile,definitionDigest:target.definitionDigest}:null,cases_hash:sha(canonical([]))},...(record.composition?{material_composition:clone(record.composition),material_composition_sha256:record.compositionSha256}:{})};
  }
  async state(id){const loaded=await this.load(id);return {...loaded,authoring:clone(loaded.record.authoring??emptyAuthoring())};}
  async check(args){
    const state=await this.state(args.document_id),{record,decoded}=state;
    if(args.expected_revision!==undefined&&record.revision!==args.expected_revision)fail('REVISION_CONFLICT','Read the current revision before checking.');
    const result=await preflight({...state,delivery:this.deliveryInfo(decoded,record),exportAction:args.export_action,name:args.name,cases:args.cases??[],readBlob:a=>this.readBlob(record.id,a)});
    if((await this.load(record.id)).record.revision!==record.revision)fail('REVISION_CONFLICT','The document changed during checking.');
    return result;
  }
  async checkedExport(args,export_action){
    const check=await this.check({...args,export_action});
    if(!check.exportAllowed){const code=check.items.some(i=>i.code==='EXPORT_PURPOSE_REQUIRED')?'EXPORT_PURPOSE_REQUIRED':export_action==='export_target'?'TARGET_NOT_READY':'PREFLIGHT_FAILED';fail(code,'Export blocked by preflight FAIL: '+[...new Set(check.items.filter(i=>i.severity==='FAIL').map(i=>i.code))].join(', '),{check});}
    return check;
  }
  async repair(args,signal){
    this.repairStops??=new Map();
    const initial=await this.check(args),key=args.document_id+':'+initial.export_action,previous=this.repairStops.get(key);
    if(previous?.revision===initial.revision)return {result:initial,rounds:[],stop:'already_stopped',previousStop:previous.stop};
    const outcome=await repairLoop({check:()=>this.check({...args,expected_revision:undefined}),patch:async(plans,revision)=>{
      aborted(signal);
      if(!plans.length||plans.length>64)fail('REPAIR_PLAN','Only a bounded batch of internally verified plans is accepted.');
      const fresh=await this.check({...args,expected_revision:revision}),allowed=fresh.items.filter(item=>item.repair?.kind==='gate_rebind').map(item=>canonical(item.repair));
      if(plans.some(plan=>!allowed.includes(canonical(plan))))fail('REPAIR_PLAN','Repair eligibility changed; no batch was committed.');
      await this.commit(args.document_id,revision,(card,ids,a)=>{
        for(const plan of plans)mutateGate(card,ids,a,{action:'patch',entry_id:plan.entry_id,expected_source_hash:plan.expected_source_hash,rule:plan.rule});
        return {authoring:true};
      },'bounded batch Gate repair',signal);
    }});
    if(outcome.stop!=='complete')this.repairStops.set(key,{revision:outcome.result.revision,stop:outcome.stop});else this.repairStops.delete(key);
    if(this.repairStops.size>128)this.repairStops.delete(this.repairStops.keys().next().value);
    return outcome;
  }
  async target(args,signal){
    const {record,decoded,authoring}=await this.state(args.document_id);
    if(args.action==='read')return {id:record.id,revision:record.revision,target:authoring.target??null};
    if(args.action==='check')return {id:record.id,revision:record.revision,...checkTarget(decoded.card,authoring)};
    if(args.action==='dryrun'){
      if(!authoring.target)fail('TARGET_MISSING','Configure the supported target before payload dryrun.');
      if(args.expected_revision!==undefined&&args.expected_revision!==record.revision)fail('REVISION_CONFLICT','Read the current revision before dryrun.');
      const definition=targetDefinition(authoring.target.config,authoring),result=dryrunTarget(definition,args.cases);
      if((await this.load(record.id)).record.revision!==record.revision)fail('REVISION_CONFLICT','Target changed during dryrun.');
      return {id:record.id,revision:record.revision,...result};
    }
    if(!['configure','patch','rebuild'].includes(args.action))fail('ACTION','Choose read/check/configure/patch/rebuild.');
    return this.commit(record.id,args.expected_revision,(card,ids,a)=>{
      let config;
      if(args.action==='configure'){
        if(a.target)fail('TARGET_EXISTS','Use patch/rebuild for an existing target.');
        config=validateTargetConfig(args.config,a.contract);
      }else{
        if(!a.target)fail('TARGET_MISSING','Configure the target first.');config=clone(a.target.config);
        if(args.action==='patch'){
          if(args.expected_source_hash!==sha(config.source))fail('TARGET_SOURCE_CONFLICT','Read the current target source before editing.');
          if(typeof args.old_text!=='string'||!args.old_text||typeof args.new_text!=='string'||config.source.split(args.old_text).length!==2)fail('TARGET_PATCH','The exact old text must occur once.');
          config.source=config.source.replace(args.old_text,()=>args.new_text);
        }
      }
      applyTarget(card,a,config,ids);return {authoring:true};
    },'target '+args.action,signal);
  }
  async targetSource(args,signal){
    const {record,decoded}=await this.state(args.document_id);
    if(['list','read'].includes(args.action))return {id:record.id,revision:record.revision,content:targetContent(decoded.card,args)};
    return this.commit(record.id,args.expected_revision,(card)=>{targetContent(card,args);return {authoring:true};},'target source '+args.action,signal);
  }
  async gating(args,signal){
    const {record,decoded,authoring}=await this.state(args.document_id);
    const context={id:record.id,revision:record.revision};
    if(args.action==='inspect')return {...context,...inspectGates(decoded.card,record.entryIds,authoring)};
    if(args.action==='read')return {...context,...gateRead(decoded.card,record.entryIds,authoring,args.entry_id)};
    if(args.action==='evaluate')return {...context,...simulateGates(decoded.card,record.entryIds,authoring,args)};
    if(!['create','patch','remove','edit_body'].includes(args.action))fail('ACTION','Choose inspect/read/create/patch/remove/edit_body/evaluate.');
    return this.commit(record.id,args.expected_revision,(card,ids,a)=>{mutateGate(card,ids,a,args);return {authoring:true,entry_id:args.entry_id};},'worldbook gate '+args.action,signal);
  }
  async exportTarget(args,sessionId,signal){
    const preflight=await this.checkedExport(args,'export_target');
    const {record,decoded,authoring}=await this.state(args.document_id);
    if(record.revision!==args.expected_revision)fail('REVISION_CONFLICT','Refresh before export.');
    const checked=checkTarget(decoded.card,authoring);if(!checked.ready)fail('TARGET_NOT_READY',JSON.stringify(checked.diagnostics));
    requireTavernDocument(decoded,{exporting:true});
    const name=args.name??'tauritavern';if(typeof name!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(name))fail('EXPORT_NAME','Use a safe ASCII bundle name.');
    if(authoring.assetManifest.assets.reduce((sum,a)=>sum+a.bytes,0)>256*1024*1024)fail('EXPORT_LIMIT','Bundle assets exceed 256 MiB.');
    // Verify every blob before opening a deliverable directory.
    const assets=[];for(const a of authoring.assetManifest.assets)assets.push({meta:a,bytes:await this.readBlob(record.id,a)});
    const folder=await this.exportDirectory(sessionId,record.id,decoded.card.data.name,signal),relative=folder+'/'+name+'-r'+record.revision+'-'+randomUUID().slice(0,8),target=await contained(this.root,relative);
    await fs.mkdir(target);const files=[];
    const write=async(name,bytes)=>{aborted(signal);const dest=path.join(target,name);await fs.writeFile(dest,bytes,{flag:'wx'});if(sha(await fs.readFile(dest))!==sha(bytes))fail('VERIFY','Bundle reread mismatch.');files.push({name,sha256:sha(bytes)});};
    try{
      const cardName=decoded.kind==='png'?'card.png':'card.json';await write(cardName,Buffer.from(record.bytes,'base64'));
      await fs.mkdir(path.join(target,'assets'));const unique=new Map();
      for(const a of assets){const filename=a.meta.sha256+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[a.meta.mediaType]);if(!unique.has(filename)){await write('assets/'+filename,a.bytes);unique.set(filename,{filename,sha256:a.meta.sha256,bytes:a.meta.bytes,mediaType:a.meta.mediaType});}}
      await write('assets-manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,namespace:authoring.target.config.namespace,assets:[...unique.values()]},null,2)+'\n'));
      await write('README.zh-TW.txt',Buffer.from(targetReadme));await write('Import-Images.ps1',Buffer.from('\uFEFF'+imageInstaller));
      await write('manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,document_id:record.id,revision:record.revision,sha256:record.sha256,check:checked,files:[...files]},null,2)+'\n'));
      return {id:record.id,revision:record.revision,path:relative,card:cardName,files,deliveryKind:'target-package',primaryDelivery:true,...checked,preflight};
    }catch(error){await fs.writeFile(path.join(target,'INCOMPLETE.txt'),'Incomplete target export.').catch(()=>{});throw error;}
  }
  async frontend(args,signal){
    const {record,decoded,authoring}=await this.state(args.document_id);
    const discovered=inspectFrontend(decoded.card,authoring.components,record.entryIds);
    if(args.action==='inspect')return {id:record.id,revision:record.revision,...discovered};
    if(args.action==='read'){
      const value=readFrontend(decoded.card,args.component_id,discovered.components,record.entryIds);
      return {...value,id:record.id,revision:record.revision,component_revision:value.revision,source_hash:value.source_hash??value.sourceHash,component_id:args.component_id};
    }
    if(!['create','patch'].includes(args.action))fail('ACTION','Choose inspect/read/create/patch.');
    return this.commit(record.id,args.expected_revision,(card,ids,a)=>{
      const components=inspectFrontend(card,a.components,ids).components;
      const value=args.action==='create'?createFrontend(card,args,ids,components):patchFrontend(card,args,components,ids);
      for(const k of Object.keys(card))delete card[k];Object.assign(card,value.card);a.components=value.components;
      return {authoring:true};
    },'frontend '+args.action,signal);
  }
  async fixture(args,signal){
    const {record,authoring}=await this.state(args.document_id),id=args.fixture_id??'default';if(!idOK(id))fail('FIXTURE','Invalid sample ID.');
    if(args.action==='read')return {id:record.id,revision:record.revision,fixture:authoring.fixtures[id]??null};
    if(args.action!=='patch')fail('ACTION','Choose read/patch.');
    const fixture=validateFixture({...args.fixture,schemaVersion:1,fixtureId:id});
    return this.commit(record.id,args.expected_revision,(_card,_ids,a)=>{a.fixtures[id]=fixture;return {authoring:true};},'authoring fixture',signal);
  }
  async visual(args,signal){
    const {record,authoring}=await this.state(args.document_id);
    if(args.action==='read')return {id:record.id,revision:record.revision,contract:authoring.contract};
    if(args.action==='validate'){
      if(!authoring.contract)fail('VISUAL_CONTRACT','Create a visual contract first.');
      return {id:record.id,revision:record.revision,...validateVisualState(authoring.contract,args.state,{previous:args.previous,sequence:args.sequence})};
    }
    if(!['create','patch'].includes(args.action))fail('ACTION','Choose create/read/validate/patch.');
    return this.commit(record.id,args.expected_revision,(_card,_ids,a)=>{
      if(args.action==='create'){if(a.contract)fail('VISUAL_CONTRACT','A contract already exists; patch it.');a.contract=createVisualContract(args.contract??{});}
      else{if(!a.contract)fail('VISUAL_CONTRACT','Create a visual contract first.');a.contract=patchVisualContract(a.contract,args.changes);}
      return {authoring:true};
    },'visual contract '+args.action,signal);
  }
  async assetDirectory(id,{create=false}={}){
    let parent=this.root;
    for(const part of ['.cardstudio-scean','documents',id,'assets']){
      const target=path.join(parent,part);
      if(create&&part==='assets')await fs.mkdir(target).catch(e=>{if(e.code!=='EEXIST')throw e;});
      const stat=await fs.lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink())fail('ASSET_PATH','Asset directories must be owned regular directories.');parent=target;
    }
    return await contained(this.root,'.cardstudio-scean/documents/'+id+'/assets',{existing:true});
  }
  async saveBlob(id,bytes,meta,signal){
    this.assertScopeCurrent();const directory=await this.assetDirectory(id,{create:true}),filename=path.join(directory,meta.sha256);aborted(signal);
    let handle;
    try{handle=await fs.open(filename,'wx');await handle.writeFile(bytes);await handle.sync();}
    catch(error){if(error.code!=='EEXIST')throw error;const stat=await fs.lstat(filename);if(!stat.isFile()||stat.isSymbolicLink()||sha(await fs.readFile(filename))!==meta.sha256)fail('VERIFY','Immutable asset hash mismatch.');}
    finally{await handle?.close();}
    aborted(signal);
  }
  async importAsset(id,expected,bytes,signal){
    const metadata=validateRaster(bytes),assetId='asset_'+randomUUID().replaceAll('-','');
    const receipt=await this.commit(id,expected,async(_card,_ids,a)=>{
      if(a.assetManifest.assets.length>=128)fail('ASSET_LIMIT','Too many assets in this document.');
      await this.saveBlob(id,bytes,metadata,signal);a.assetManifest.assets.push({assetId,...metadata,provenance:{kind:'user-selected'}});return {authoring:true};
    },'import selected raster asset',signal);
    return {...receipt,asset_id:assetId,mediaType:metadata.mediaType,width:metadata.width,height:metadata.height,validation:metadata.validation};
  }
  async assets(args,signal,sessionId){
    if(args.action==='generated_status'){await this.generatedJobs.get(sessionId);return this.generatedResults.get(sessionId)??{armed:this.generatedArms.has(sessionId)};}
    if(args.action==='cancel_generated'){this.generatedArms.delete(sessionId);return {armed:false};}
    if(args.action==='arm_generated'){
      const {record,authoring}=await this.state(args.document_id);
      if(record.revision!==args.expected_revision)fail('REVISION_CONFLICT','Refresh before arming generation.');
      if(this.generatedArms.has(sessionId)||this.generatedJobs.has(sessionId)||this.generatedInflight.has(sessionId))fail('GENERATED_BUSY','此對話已有待處理的圖片交付。');
      const character=authoring.contract?.characters[args.character_id];if(!character?.expressions.includes(args.expression))fail('VISUAL_CONTRACT','Choose a declared character/expression.');
      this.generatedArms.set(sessionId,{scopePolicy:this.scopePolicy(),document_id:record.id,character_id:args.character_id,expression:args.expression,contractHash:sha(canonical(authoring.contract)),expires:Date.now()+10*60*1000});this.generatedResults.delete(sessionId);
      return {armed:true,document_id:record.id,character_id:args.character_id,expression:args.expression,next_tool:'generate_image',expires_minutes:10};
    }
    if(args.action==='import'){
      const row=this.assetUploads.get(sessionId,args.upload_id);
      if(row.document_id!==args.document_id||row.expected_revision!==args.expected_revision)fail('UPLOAD_DOCUMENT','Selected upload belongs to a different document or revision.');
      const upload=this.assetUploads.finish(sessionId,args.upload_id);
      return this.importAsset(upload.document_id,upload.expected_revision,upload.bytes,signal);
    }
    const {record,authoring}=await this.state(args.document_id);
    if(args.action==='list')return {id:record.id,revision:record.revision,assets:authoring.assetManifest.assets.map(a=>({...a,asset_id:a.assetId}))};
    if(!['link','unlink'].includes(args.action)||!idOK(args.asset_id))fail('ASSET','Choose a known asset ID and link/unlink.');
    return this.commit(record.id,args.expected_revision,(_card,_ids,a)=>{
      const asset=a.assetManifest.assets.find(x=>x.assetId===args.asset_id);if(!asset)fail('ASSET','Unknown asset ID.');
      if(!a.contract||!idOK(args.character_id)||!a.contract.characters[args.character_id])fail('VISUAL_CONTRACT','Choose an existing character.');
      const character=a.contract.characters[args.character_id];if(!character.expressions.includes(args.expression))fail('VISUAL_STATE','Choose a declared expression.');
      const variants=character.variants??=[];
      if(args.action==='link'){
        const previous=variants.find(x=>x.expression===args.expression&&!Object.keys(x.dimensions??{}).length);
        if(previous)previous.assetId=args.asset_id;else variants.push({expression:args.expression,assetId:args.asset_id});
      }else character.variants=variants.filter(x=>!(x.assetId===args.asset_id&&x.expression===args.expression));
      a.contract.contractRevision++;validateVisualContract(a.contract);return {authoring:true};
    },'visual asset '+args.action,signal);
  }
  async readBlob(id,asset){
    const directory=await this.assetDirectory(id),filename=path.join(directory,asset.sha256),stat=await fs.lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==asset.bytes)fail('ASSET_PATH','Invalid immutable asset.');
    const bytes=await fs.readFile(filename);if(sha(bytes)!==asset.sha256)fail('VERIFY','Asset hash mismatch.');validateRaster(bytes);return bytes;
  }
  async importGenerated(arm,bytes,provenance,signal){
    if(arm.expires<Date.now())fail('GENERATED_EXPIRED','圖片交付設定已逾時。');
    const {record}=await this.state(arm.document_id),metadata=validateRaster(bytes),assetId='asset_'+randomUUID().replaceAll('-','');
    const receipt=await this.commit(record.id,record.revision,async(_card,_ids,a)=>{
      if(sha(canonical(a.contract))!==arm.contractHash)fail('GENERATED_CONFLICT','生圖期間視覺契約已變更；未自動覆寫連結。');
      if(a.assetManifest.assets.length>=128)fail('ASSET_LIMIT','Too many assets in this document.');
      await this.saveBlob(record.id,bytes,metadata,signal);
      a.assetManifest.assets.push({assetId,...metadata,provenance:{kind:'agnes-admitted-attachment',...provenance}});
      const c=a.contract.characters[arm.character_id],previous=c.variants.find(v=>v.expression===arm.expression&&!Object.keys(v.dimensions??{}).length);
      if(previous)previous.assetId=assetId;else c.variants.push({expression:arm.expression,assetId});a.contract.contractRevision++;
      return {authoring:true};
    },'import and link admitted generated image',signal);
    return {...receipt,asset_id:assetId,character_id:arm.character_id,expression:arm.expression};
  }
  async preview(args,sessionId,signal){
    const {record,decoded,authoring}=await this.state(args.document_id),fixture=authoring.fixtures[args.fixture_id??'default'];if(!fixture)fail('FIXTURE','Unknown authoring sample.');
    if(![360,390,768,1024].includes(args.viewport))fail('PREVIEW','Choose a supported viewport.');
    const source=args.component_id==='target'&&authoring.target?{source:authoring.target.config.source,sourceHash:sha(authoring.target.config.source)}:readFrontend(decoded.card,args.component_id,inspectFrontend(decoded.card,authoring.components,record.entryIds).components,record.entryIds),key=sessionId+':'+record.id+':'+record.revision;
    let visual={},stateResult={diagnostics:[]};
    if(authoring.contract){
      const previous=this.previewStates.get(key);stateResult=validateVisualState(authoring.contract,args.state??{schemaVersion:1,contractRevision:authoring.contract.contractRevision,sequence:(previous?.sequence??-1)+1,mode:'patch',characters:{}},{previous:previous?.state});
      visual=resolveVisualState(authoring.contract,stateResult.state,authoring.assetManifest);this.previewStates.set(key,{state:stateResult.state,sequence:stateResult.sequence});
      if(this.previewStates.size>128)this.previewStates.delete(this.previewStates.keys().next().value);
    }
    const assetMap={},diagnostics=[];
    // Only assets referenced by this bounded source or the active visual result are admitted.
    const selected=new Set(Object.values(visual.characters??{}).map(x=>x.assetId).filter(Boolean));
    for(const a of authoring.assetManifest.assets)if(source.source.includes(a.assetId))selected.add(a.assetId);
    let total=0;
    for(const assetId of selected){
      const a=authoring.assetManifest.assets.find(x=>x.assetId===assetId);if(!a)continue;
      try{const bytes=await this.readBlob(record.id,a);total+=bytes.length;if(total>24*1024*1024)fail('PREVIEW_LIMIT','Preview assets exceed the memory limit.');assetMap[assetId]={validated:true,mediaType:a.mediaType,dataUrl:'data:'+a.mediaType+';base64,'+bytes.toString('base64'),width:a.width,height:a.height};if(a.validation==='structural')diagnostics.push({code:'ASSET_BROWSER_DECODE_REQUIRED',asset_id:assetId,message:'JPEG/WebP passed structural validation; the UI must decode before display.'});}
      catch(error){diagnostics.push({code:'ASSET_UNAVAILABLE',asset_id:assetId,message:'The selected local asset could not be admitted.'});}
    }
    aborted(signal);const result=buildPreview(source.source,{fixture:bindFixture(fixture),visual,assets:assetMap,viewport:args.viewport,targetProfile:'authoring-static-v1'});
    const html=result.html;if(typeof html!=='string'||Buffer.byteLength(html)>36*1024*1024)fail('PREVIEW_LIMIT','Preview projection is too large.');
    return {id:record.id,revision:record.revision,preview_id:randomUUID(),source_hash:source.source_hash??source.sourceHash,fixture_hash:sha(Buffer.from(canonical(fixture))),html,viewport:args.viewport,state:stateResult.state,diagnostics:[...(result.diagnostics??[]),...(stateResult.diagnostics??[]),...(visual.diagnostics??[]),...diagnostics],capabilities:{cardJavaScript:false,network:false,hostRPC:false,target:'authoring-static-v1'}};
  }
  async exportBundle(args,sessionId,signal){
    const preflight=await this.checkedExport(args,'export_bundle');
    const {record,decoded,authoring}=await this.state(args.document_id);if(record.revision!==args.expected_revision)fail('REVISION_CONFLICT','Refresh before export.');
    const name=args.name??'authoring';if(typeof name!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(name))fail('EXPORT_NAME','Use a safe ASCII bundle name.');
    requireTavernDocument(decoded,{exporting:true});
    if(authoring.assetManifest.assets.reduce((sum,a)=>sum+a.bytes,0)>256*1024*1024)fail('EXPORT_LIMIT','Bundle assets exceed 256 MiB.');
    const folder=await this.exportDirectory(sessionId,record.id,decoded.card.data.name,signal),relative=folder+'/'+name+'-r'+record.revision+'-'+randomUUID().slice(0,8),target=await contained(this.root,relative);await fs.mkdir(target);
    const cardName=decoded.kind==='png'?'card.png':'card.json',files=[];
    const write=async(name,bytes)=>{aborted(signal);const dest=path.join(target,name);await fs.writeFile(dest,bytes,{flag:'wx'});if(sha(await fs.readFile(dest))!==sha(bytes))fail('VERIFY','Bundle reread mismatch.');files.push({name,sha256:sha(bytes)});};
    try{
      await write(cardName,Buffer.from(record.bytes,'base64'));await write('authoring.json',Buffer.from(JSON.stringify(authoring,null,2)+'\n'));
      await fs.mkdir(path.join(target,'assets'));
      const exportedDigests=new Set();
      for(const asset of authoring.assetManifest.assets){
        // Stable asset IDs may intentionally share the same immutable bytes.
        // Validate every reference, then write each content-addressed blob once.
        const bytes=await this.readBlob(record.id,asset);
        if(!exportedDigests.has(asset.sha256)){await write('assets/'+asset.sha256,bytes);exportedDigests.add(asset.sha256);}
      }
      await write('README.txt',Buffer.from('CardStudio authoring bundle v1\nOnly card.json/card.png is a standard card interchange file. authoring.json and assets/ are authoring data, not an installed SillyTavern runtime. External state/asset rendering needs an explicit target adapter. Card scripts and external resources were preserved, not executed.\n'));
      await write('manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,revision:record.revision,cardSha256:record.sha256,authoringSha256:sha(Buffer.from(canonical(authoring))),jointSha256:jointHash(record.sha256,sha(Buffer.from(canonical(authoring)))),files},null,2)+'\n'));
      return {id:record.id,revision:record.revision,path:relative,card:cardName,file_count:files.length,files:files.slice(0,24),omitted_files:Math.max(0,files.length-24),preflight,deliveryKind:'authoring-backup-bundle',primaryDelivery:false,ready:false,runtimeVerified:false,compatibility:'authoring backup only; sidecar/assets require explicit target adapter'};
    }catch(error){ // Never leave a successful-looking partial bundle.
      const marker=path.join(target,'INCOMPLETE.txt');await fs.writeFile(marker,'Incomplete authoring export; no runtime validation was performed.\n').catch(()=>{});throw error;
    }
  }
  async export(id,expected,name,signal,sessionId,backup=false,cases=[]){
    const preflight=await this.checkedExport({document_id:id,expected_revision:expected,name,cases},backup?'export_backup':'export');
    const {decoded,record}=await this.load(id,expected),delivery=this.deliveryInfo(decoded,record),diagnostics=[];
    if(!backup&&(delivery.targetProfile||delivery.requiresTargetPreparation))fail('EXPORT_PURPOSE_REQUIRED','Use export_target for the selected playable target. To preserve raw authoring bytes explicitly choose export_backup; a backup is never ready for RP.');
    const receipt=await super.export(id,expected,name,signal,sessionId);
    if(delivery.samples)diagnostics.push({code:'RAW_EXPORT_SAMPLE_BINDINGS',severity:'warning',message:'This backup preserves unresolved authoring sample markers.'});
    if(delivery.unboundImages)diagnostics.push({code:'RAW_EXPORT_UNBOUND_IMAGES',severity:'warning',message:'This backup preserves character image bindings without src.'});
    if(record.authoring?.assetManifest?.assets?.length)diagnostics.push({code:'RAW_EXPORT_EXTERNAL_ASSETS',severity:'warning',message:'A single card file does not include authoring raster assets. Use the target package for RP delivery.'});
    diagnostics.push(...checkGates(decoded.card,record.authoring??emptyAuthoring()).map(d=>({...d,severity:'warning'})));
    return {...receipt,deliveryKind:backup?'authoring-backup':'raw-card',primaryDelivery:false,ready:false,runtimeVerified:false,requiresTargetPreparation:delivery.requiresTargetPreparation,diagnostics,preflight};
  }
  async performOperation(action,args,signal,context={}){
    if(['check','repair'].includes(action)){
      aborted(signal);if(typeof context.sessionId!=='string'||!context.sessionId.trim())fail('SESSION','A trusted Session is required.');await this.lifecycle.assertReady(context.sessionId);
      if(!object(args)||Object.keys(args).some(k=>!['action','document_id','expected_revision','export_action','name','cases'].includes(k)))fail('AUTHORING_ARGUMENT','Only bounded preflight arguments are accepted.');
      // No associate(), preview state, persisted report or snapshot writes on check.
      return {ok:true,value:action==='check'?await this.check(args):await this.repair(args,signal)};
    }
    if(!['create','frontend','fixture','visual_contract','asset','preview','export','export_bundle','target','target_source','gating','export_target','export_backup','asset_upload_begin','asset_upload_chunk','asset_upload_finish','asset_upload_abort'].includes(action))return super.performOperation(action,args,signal,context);
    aborted(signal);await this.lifecycle.assertReady(context.sessionId);if(typeof context.sessionId!=='string'||!context.sessionId.trim())fail('SESSION','A trusted Session is required.');await this.associations();
    const admitted={
      frontend:['action','document_id','expected_revision','component_id','target','entry_id','regex_id','source','expected_source_hash','old_text','new_text'],
      fixture:['action','document_id','expected_revision','fixture_id','fixture'],
      visual_contract:['action','document_id','expected_revision','contract','changes','state','previous','sequence'],
      asset:['action','document_id','expected_revision','upload_id','asset_id','character_id','expression'],
      preview:['document_id','component_id','fixture_id','viewport','state'],
      // Legacy export ignores caller sessionId; trusted context exclusively owns the destination.
      export:['action','document_id','expected_revision','name','cases','sessionId'],
      export_bundle:['action','document_id','expected_revision','name','cases'],
      target:['action','document_id','expected_revision','config','expected_source_hash','old_text','new_text','cases'],
      target_source:['action','document_id','expected_revision','kind','content_id','source','find_regex','expected_source_hash','old_text','new_text'],
      gating:['action','document_id','expected_revision','entry_id','expected_source_hash','rule','values','snapshot','old_text','new_text'],
      export_target:['action','document_id','expected_revision','name','cases'],
      export_backup:['action','document_id','expected_revision','name','cases'],
      asset_upload_begin:['document_id','expected_revision','name','size'],
      asset_upload_chunk:['upload_id','offset','base64'],
      asset_upload_finish:['upload_id'],asset_upload_abort:['upload_id']
    }[action];
    if(!object(args)||admitted&&Object.keys(args).some(k=>!admitted.includes(k)))fail('AUTHORING_ARGUMENT','Use only admitted authoring arguments; paths, URLs, credentials and host locators are not accepted.');
    let value;
    if(action==='create')value=await this.create(args,context.sessionId,signal);
    else if(action==='frontend')value=await this.frontend(args,signal);
    else if(action==='fixture')value=await this.fixture(args,signal);
    else if(action==='visual_contract')value=await this.visual(args,signal);
    else if(action==='asset')value=await this.assets(args,signal,context.sessionId);
    else if(action==='preview')value=await this.preview(args,context.sessionId,signal);
    else if(action==='export_bundle')value=await this.exportBundle(args,context.sessionId,signal);
    else if(action==='target')value=await this.target(args,signal);
    else if(action==='target_source')value=await this.targetSource(args,signal);
    else if(action==='gating')value=await this.gating(args,signal);
    else if(action==='export_target')value=await this.exportTarget(args,context.sessionId,signal);
    else if(action==='export'||action==='export_backup')value=await this.export(args.document_id,args.expected_revision,args.name,signal,context.sessionId,action==='export_backup',args.cases);
    else if(action==='asset_upload_begin'){const {record}=await this.load(args.document_id);if(record.revision!==args.expected_revision)fail('REVISION_CONFLICT','Refresh before uploading.');value=this.assetUploads.begin(context.sessionId,args);}
    else if(action==='asset_upload_chunk')value=this.assetUploads.append(context.sessionId,args);
    else if(action==='asset_upload_abort')value=this.assetUploads.abort(context.sessionId,args.upload_id);
    else if(action==='asset_upload_finish'){const upload=this.assetUploads.finish(context.sessionId,args.upload_id);value=await this.importAsset(upload.document_id,upload.expected_revision,upload.bytes,signal);await this.associate(context.sessionId,upload.document_id,{signal});}
    if(args.document_id&&!action.startsWith('asset_upload_')&&!(action==='target'&&args.action==='dryrun'))await this.associate(context.sessionId,args.document_id,{signal});
    return {ok:true,value};
  }
  async close(){this.generatedArms.clear();this.generatedInflight.clear();await Promise.allSettled([...this.generatedJobs.values()]);this.generatedResults.clear();this.assetUploads.clear();this.previewStates.clear();await super.close();}
}

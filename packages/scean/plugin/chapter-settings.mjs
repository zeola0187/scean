import {createHash,randomUUID,generateKeyPairSync,privateDecrypt,createDecipheriv,constants} from 'node:crypto';

const clone=value=>structuredClone(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const fields=(value,names)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!names.includes(k)))fail('CHAPTER_SETTINGS_INVALID');};
const bool=value=>{if(typeof value!=='boolean')fail('CHAPTER_SETTINGS_INVALID');return value;};
const bounded=(value,max=160)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\x00-\x1f]/.test(value))fail('CHAPTER_SETTINGS_INVALID');return value.trim();};
const HTTP=['openrouter','openai','compatible'];
const base={openrouter:'https://openrouter.ai/api/v1',openai:'https://api.openai.com/v1'};
export const CHAPTER_SETTINGS_ACTIONS=new Set(['chapterProviderSettings','chapterProviderSave','chapterProviderClear']);
export function chapterSettingsDefaults(config={}){
  return {flags:{chapterModelsEnabled:config.chapterModelsEnabled===true,chapterRetrievalEnabled:config.chapterRetrievalEnabled===true,chapterEmbeddingEnabled:config.chapterEmbeddingEnabled===true||config.enableExistingEmbedding===true},
    embedding:{provider:'openrouter',model:'qwen/qwen3-embedding-8b',baseUrl:base.openrouter,nebiusOnly:true,environmentFallback:true},
    rerank:{mode:'dsh_current',provider:'',model:'',baseUrl:'',environmentFallback:false}};
}
function endpoint(value){
  const text=bounded(value,500);let url;try{url=new URL(text);}catch{fail('CHAPTER_SETTINGS_ENDPOINT');}
  if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('CHAPTER_SETTINGS_ENDPOINT');
  return url.href.replace(/\/+$/,'');
}
export function validateChapterProviderSettings(value){
  fields(value,['flags','embedding','rerank']);fields(value.flags,['chapterModelsEnabled','chapterRetrievalEnabled','chapterEmbeddingEnabled']);
  const flags=Object.fromEntries(['chapterModelsEnabled','chapterRetrievalEnabled','chapterEmbeddingEnabled'].map(k=>[k,bool(value.flags[k])]));
  fields(value.embedding,['provider','model','baseUrl','nebiusOnly','environmentFallback']);
  const e=value.embedding;if(!HTTP.includes(e.provider))fail('CHAPTER_SETTINGS_INVALID');
  const embedding={provider:e.provider,model:bounded(e.model),baseUrl:endpoint(e.baseUrl),nebiusOnly:bool(e.nebiusOnly),environmentFallback:bool(e.environmentFallback)};
  if(base[e.provider]&&embedding.baseUrl!==base[e.provider]||e.provider!=='openrouter'&&embedding.nebiusOnly)fail('CHAPTER_SETTINGS_ENDPOINT');
  fields(value.rerank,['mode','provider','model','baseUrl','environmentFallback']);const r=value.rerank;
  if(!['dsh_current','dsh_model',...HTTP].includes(r.mode))fail('CHAPTER_SETTINGS_INVALID');
  const rerank={mode:r.mode,provider:'',model:'',baseUrl:'',environmentFallback:bool(r.environmentFallback)};
  if(r.mode==='dsh_model'){rerank.provider=bounded(r.provider);rerank.model=bounded(r.model);}
  else if(HTTP.includes(r.mode)){rerank.model=bounded(r.model);rerank.baseUrl=endpoint(r.baseUrl);if(base[r.mode]&&rerank.baseUrl!==base[r.mode])fail('CHAPTER_SETTINGS_ENDPOINT');}
  else if(r.provider!==''||r.model!==''||r.baseUrl!==''||rerank.environmentFallback)fail('CHAPTER_SETTINGS_INVALID');
  if(r.mode==='dsh_model'&&(r.baseUrl!==''||rerank.environmentFallback))fail('CHAPTER_SETTINGS_INVALID');
  return {flags,embedding,rerank};
}
const binding=(settings,kind)=>kind==='embedding'?digest({provider:settings.embedding.provider,baseUrl:settings.embedding.baseUrl}):HTTP.includes(settings.rerank.mode)?digest({provider:settings.rerank.mode,baseUrl:settings.rerank.baseUrl}):null;
export function chapterEnvironmentName(settings,kind){
  const provider=kind==='embedding'?settings.embedding.provider:settings.rerank.mode;
  return provider==='openrouter'?'OpenRouter API Key':provider==='openai'?'OPENAI_API_KEY':kind==='embedding'?'SCEAN_CHAPTER_EMBEDDING_API_KEY':'SCEAN_CHAPTER_RERANK_API_KEY';
}
const available=credentials=>typeof credentials?.readRecord==='function'&&typeof credentials?.modifyRecord==='function';
const secret=value=>{if(typeof value!=='string'||!value.trim()||value.length>4096||/[\s\x00-\x1f]/.test(value)||/^[*•●·]+$/.test(value))fail('CHAPTER_SETTINGS_KEY_INVALID');return value;};

/** Owns one opaque native credential record, never a generic credential browser. */
export class ChapterProviderSettings {
  #transport;#closed=false;#uncertain;
  constructor({credentials,credentialSource=()=>credentials,scope,config={},environment=name=>process.env[name],nativeSelection=()=>null,writable=true}={}){
    this.credentialSource=credentialSource;this.defaults=chapterSettingsDefaults(config);this.environment=environment;this.nativeSelection=nativeSelection;this.writable=writable;
    this.recordKey='scean-chapter-settings/host-'+digest({scope}).slice(0,40);
  }
  get credentials(){return this.credentialSource();}
  get storageAvailable(){return available(this.credentials)&&this.writable;}
  async record(){
    if(!available(this.credentials))return {schemaVersion:1,revision:0,settings:clone(this.defaults),keys:{}};
    let record;try{record=await this.credentials.readRecord(this.recordKey);}catch{fail('CHAPTER_SETTINGS_STORAGE_UNAVAILABLE');}
    if(record===undefined)return {schemaVersion:1,revision:0,settings:clone(this.defaults),keys:{}};
    const p=record.payload;if(record.kind!=='grant'||p?.schemaVersion!==1||!Number.isSafeInteger(p.revision)||p.revision<1||!p.keys)fail('CHAPTER_SETTINGS_STORAGE_INVALID');
    return {...p,settings:validateChapterProviderSettings(p.settings)};
  }
  keyStatus(record,kind){
    const settings=record.settings,spec=settings[kind],http=kind==='embedding'||HTTP.includes(spec.mode),stored=record.keys[kind];
    const storedAvailable=!!stored?.value&&stored.binding===binding(settings,kind),environmentName=chapterEnvironmentName(settings,kind),ambient=this.environment(environmentName),envAvailable=typeof ambient==='string'&&!!ambient.trim();
    if(!http){let selected;try{selected=this.nativeSelection();}catch{}const configured=spec.mode==='dsh_model'||record.revision===0||!!selected?.provider&&!!selected?.model;return {stored:!!stored?.value,environmentAvailable:false,environmentEnabled:false,source:'dsh',configured,selectionRequired:!configured};}
    return {stored:storedAvailable,environmentAvailable:envAvailable,environmentEnabled:spec.environmentFallback,environmentName,source:storedAvailable?'stored':spec.environmentFallback&&envAvailable?'environment':'none',configured:storedAvailable||spec.environmentFallback&&envAvailable};
  }
  publicRecord(record,{transport=false}={}){
    const result={schemaVersion:1,revision:record.revision,settings:clone(record.settings),storageAvailable:this.storageAvailable,storage:'dsh_native_credential_record',saved:record.revision>0,lastOperationId:record.lastOperationId??null,
      embeddingKey:this.keyStatus(record,'embedding'),rerankKey:this.keyStatus(record,'rerank'),providerConnectivity:'not_tested',scope:'host_profile_all_runs',saveStartsModelWork:false,runConsent:'explicit_per_launch_and_run'};
    let selection;try{selection=this.nativeSelection();}catch{}if(selection?.provider&&selection?.model)result.nativeSelection={provider:selection.provider,model:selection.model};
    if(transport&&this.storageAvailable){
      this.#transport??={...generateKeyPairSync('rsa',{modulusLength:2048}),keyId:randomUUID()};
      result.keyTransport={keyId:this.#transport.keyId,publicKey:this.#transport.publicKey.export({format:'jwk'}),algorithm:'RSA-OAEP-256/AES-256-GCM'};
    }
    return result;
  }
  async status({transport=true}={}){
    const record=await this.record();if(this.#uncertain&&record.lastOperationId===this.#uncertain.operationId)this.#uncertain=undefined;
    return {...this.publicRecord(record,{transport}),saveOutcomeUncertain:!!this.#uncertain};
  }
  decodeKeys(request){
    if(request.sealedKeys==null)return {};
    const envelope=request.sealedKeys;fields(envelope,['keyId','wrappedKey','iv','ciphertext']);
    if(!this.#transport||envelope.keyId!==this.#transport.keyId)fail('CHAPTER_SETTINGS_KEY_EXPIRED');
    for(const k of ['wrappedKey','iv','ciphertext'])if(typeof envelope[k]!=='string'||envelope[k].length>24000||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope[k]))fail('CHAPTER_SETTINGS_KEY_INVALID');
    try{
      const aes=privateDecrypt({key:this.#transport.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64')),iv=Buffer.from(envelope.iv,'base64'),data=Buffer.from(envelope.ciphertext,'base64');
      if(aes.length!==32||iv.length!==12||data.length<17)fail('CHAPTER_SETTINGS_KEY_INVALID');
      const cipher=createDecipheriv('aes-256-gcm',aes,iv);cipher.setAAD(Buffer.from(JSON.stringify({operationId:request.operationId,expectedRevision:request.expectedRevision,settings:request.settings})));cipher.setAuthTag(data.subarray(-16));
      const value=JSON.parse(Buffer.concat([cipher.update(data.subarray(0,-16)),cipher.final()]).toString('utf8'));fields(value,['embedding','rerank']);
      return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,secret(v)]));
    }catch(error){if(error.code==='CHAPTER_SETTINGS_KEY_EXPIRED')throw error;fail('CHAPTER_SETTINGS_KEY_INVALID');}
  }
  async save(request,signal,{clear=false}={}){
    fields(request,['action','operationId','expectedRevision','settings','sealedKeys','confirmation','sessionId','cardScope']);
    if(!this.storageAvailable)fail('CHAPTER_SETTINGS_STORAGE_UNAVAILABLE');
    if(this.#closed)fail('HOST_CLOSING');
    if(this.#uncertain&&(await this.status({transport:false})).saveOutcomeUncertain)fail('CHAPTER_SETTINGS_SAVE_UNKNOWN');
    if(typeof request.operationId!=='string'||!/^[\w-]{1,160}$/.test(request.operationId)||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)fail('CHAPTER_SETTINGS_INVALID');
    if(clear&&request.confirmation!=='clear-shared-chapter-settings')fail('CHAPTER_SETTINGS_CLEAR_CONFIRMATION');
    const settings=clear?chapterSettingsDefaults():validateChapterProviderSettings(request.settings);
    if(clear){for(const k of Object.keys(settings.flags))settings.flags[k]=false;settings.embedding.environmentFallback=false;}
    const fingerprint=digest({clear,settings:request.settings??null,sealedKeys:request.sealedKeys??null}),key=this.recordKey;let committed;
    if(settings.flags.chapterRetrievalEnabled&&(!settings.flags.chapterModelsEnabled||!settings.flags.chapterEmbeddingEnabled))fail('CHAPTER_SETTINGS_DEPENDENCY');
    signal?.throwIfAborted();
    try{
      committed=await this.credentials.modifyRecord(key,current=>{
        signal?.throwIfAborted();if(this.#closed)fail('HOST_CLOSING');
        const prior=current?.payload??{schemaVersion:1,revision:0,settings:clone(this.defaults),keys:{}};
        if(current&&current.kind!=='grant'||prior.schemaVersion!==1||!Number.isSafeInteger(prior.revision)||!prior.keys)fail('CHAPTER_SETTINGS_STORAGE_INVALID');
        if(prior.lastOperationId===request.operationId){if(prior.lastFingerprint!==fingerprint)fail('CHAPTER_SETTINGS_OPERATION_CONFLICT');return undefined;}
        if(prior.revision!==request.expectedRevision)fail('CHAPTER_SETTINGS_VERSION_CONFLICT');
        const replacement=clear?{}:this.decodeKeys(request),keys=clear?{}:clone(prior.keys);
        for(const kind of ['embedding','rerank']){
          if(replacement[kind]){if(!binding(settings,kind))fail('CHAPTER_SETTINGS_KEY_INVALID');keys[kind]={value:replacement[kind],binding:binding(settings,kind)};}
          else if(keys[kind]&&binding(settings,kind)&&keys[kind].binding!==binding(settings,kind))fail('CHAPTER_SETTINGS_KEY_DESTINATION_CHANGED');
        }
        const proposed={settings,keys};
        if(settings.flags.chapterRetrievalEnabled&&this.keyStatus(proposed,'rerank').selectionRequired)fail('CHAPTER_SETTINGS_MODEL_REQUIRED');
        if(settings.flags.chapterEmbeddingEnabled&&!this.keyStatus(proposed,'embedding').configured||settings.flags.chapterRetrievalEnabled&&!this.keyStatus(proposed,'rerank').configured)fail('CHAPTER_SETTINGS_KEY_REQUIRED');
        return {kind:'grant',payload:{schemaVersion:1,revision:prior.revision+1,settings,keys,lastOperationId:request.operationId,lastFingerprint:fingerprint}};
      });
    }catch(error){
      if(['CHAPTER_SETTINGS_INVALID','CHAPTER_SETTINGS_DEPENDENCY','CHAPTER_SETTINGS_KEY_REQUIRED','CHAPTER_SETTINGS_MODEL_REQUIRED','CHAPTER_SETTINGS_KEY_INVALID','CHAPTER_SETTINGS_KEY_EXPIRED','CHAPTER_SETTINGS_VERSION_CONFLICT','CHAPTER_SETTINGS_OPERATION_CONFLICT','CHAPTER_SETTINGS_STORAGE_INVALID','CHAPTER_SETTINGS_KEY_DESTINATION_CHANGED','HOST_CLOSING'].includes(error.code)||error.name==='AbortError')throw error;
      this.#uncertain={operationId:request.operationId};fail('CHAPTER_SETTINGS_SAVE_UNKNOWN');
    }
    if(committed?.kind!=='grant'){this.#uncertain={operationId:request.operationId};fail('CHAPTER_SETTINGS_SAVE_UNKNOWN');}
    return {...this.publicRecord(committed.payload,{transport:true}),outcome:'saved',operationId:request.operationId};
  }
  async runtime(kind){
    if(this.#uncertain)fail('CHAPTER_SETTINGS_SAVE_UNKNOWN');
    const record=await this.record(),spec=clone(record.settings[kind]),status=this.keyStatus(record,kind),stored=record.keys[kind];
    if(kind==='rerank'&&!HTTP.includes(spec.mode))return {...spec,revision:record.revision,settings:record.settings};
    const apiKey=status.source==='stored'?stored.value:status.source==='environment'?this.environment(status.environmentName):null;
    if(!apiKey)fail(kind==='embedding'?'CHAPTER_EMBEDDING_UNAVAILABLE':'CHAPTER_RERANK_UNAVAILABLE');
    return {...spec,apiKey,revision:record.revision,settings:record.settings};
  }
  close(){this.#closed=true;this.#transport=undefined;}
}
